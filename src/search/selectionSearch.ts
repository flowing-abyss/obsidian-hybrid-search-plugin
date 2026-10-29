import type { SearchOptions, SearchResult, SearchService } from './contracts';

interface SelectionQuery {
  path: string;
  text: string;
  sourceText?: string;
}

const PASSAGE_LENGTH = 500;

/**
 * Long prose is not a keyword query: large FTS expressions can block the search server.
 * Whole notes can reuse their indexed chunks; partial selections query every passage
 * with at most two requests in flight. Only this transient scope uses rank fusion.
 */
export async function searchSelection(
  client: SearchService,
  selection: SelectionQuery,
  limit: number,
  isCurrent: () => boolean,
  acceptResult: (result: SearchResult) => boolean = () => true,
): Promise<SearchResult[] | null> {
  const options: SearchOptions = { limit: limit + 1, anchors: true, snippetLength: 400 };
  if (!isCurrent()) return null;
  if (selection.text.length <= PASSAGE_LENGTH) {
    const results = await client.search(selection.text, { ...options, mode: 'hybrid' });
    return isCurrent() ? results.filter(acceptResult) : null;
  }
  if (isWholeNote(selection)) {
    const results = await client.search('', { ...options, notePath: selection.path });
    if (!isCurrent()) return null;
    if (results.length) return results.filter(acceptResult);
  }

  const passages = splitPassages(selection.text);
  const ranked = new Map<string, { result: SearchResult; score: number; bestRank: number }>();
  for (let start = 0; start < passages.length; start += 2) {
    if (!isCurrent()) return null;
    const results = await Promise.allSettled(
      passages
        .slice(start, start + 2)
        .map((passage) => client.search(passage, { ...options, mode: 'hybrid' })),
    );
    if (!isCurrent()) return null;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    for (const batch of results) {
      if (batch.status !== 'fulfilled') continue;
      const seen = new Set<string>();
      batch.value.forEach((result, rank) => {
        if (!acceptResult(result)) return;
        const path = result.path.normalize('NFC');
        if (seen.has(path)) return;
        seen.add(path);
        const previous = ranked.get(path);
        const score = (previous?.score ?? 0) + 1 / (60 + rank + 1);
        ranked.set(path, {
          result: previous && previous.bestRank <= rank ? previous.result : result,
          bestRank: Math.min(previous?.bestRank ?? rank, rank),
          score,
        });
      });
    }
  }
  return [...ranked.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit + 1)
    .map((item) => item.result);
}

function isWholeNote({ text, sourceText }: SelectionQuery): boolean {
  if (sourceText === undefined) return false;
  const selected = text.trim();
  if (selected === sourceText.trim()) return true;
  // Obsidian's properties UI can keep YAML outside an editor's Select all range.
  const body = sourceText.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u, '');
  return selected === body.trim();
}

function splitPassages(text: string): string[] {
  const chars = Array.from(text);
  const passages: string[] = [];
  for (let start = 0; start < chars.length;) {
    let end = Math.min(start + PASSAGE_LENGTH, chars.length);
    if (end < chars.length) {
      // Prefer a nearby paragraph/word boundary, but never drop separators or tail text.
      for (let index = end - 1; index >= start + PASSAGE_LENGTH / 2; index--) {
        if (/\s/u.test(chars[index]!)) {
          end = index + 1;
          break;
        }
      }
    }
    passages.push(chars.slice(start, end).join(''));
    start = end;
  }
  return passages;
}
