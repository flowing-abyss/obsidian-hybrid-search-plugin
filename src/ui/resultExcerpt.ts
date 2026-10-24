import type { MatchAnchor, SearchResult } from '../ipc';
import { getPrimaryAnchor, offsetToEditorPosition } from './noteUtils';

function headingText(text: string): string {
  const title = text.trim().replace(/^#{1,6}\s+/, '');
  const closing = title.lastIndexOf(' ');
  return closing >= 0 && /^#+$/.test(title.slice(closing + 1))
    ? title.slice(0, closing).trimEnd()
    : title;
}

/** Plain text only: never invoke MarkdownRenderer or resolve an embed. */
function excerptText(text: string): string {
  /* eslint-disable sonarjs/slow-regex -- applied only to the bounded snippet, never the full note */
  return text
    .replace(/!\[\[[^\]\n]*\]\]/g, '')
    .replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, '')
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2')
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, '$1')
    .replace(/[*`~]/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+]\s+)/, '')
    .trim();
  /* eslint-enable sonarjs/slow-regex */
}

function bodyLines(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (/^[-*_]{3,}$/.test(trimmed) || (trimmed.includes('|') && /^[\s:|-]+$/.test(trimmed)))
      return [];
    const plain = excerptText(line);
    if (!plain || /^#{1,6}\s/.test(line.trimStart())) return [];
    if (!plain.startsWith('|')) return [plain];
    const end = plain.endsWith('|') ? plain.length - 1 : plain.length;
    return [
      plain
        .slice(1, end)
        .split('|')
        .map((cell) => cell.trim())
        .join(' · '),
    ];
  });
}

export function appendResultExcerpt(
  parent: HTMLElement,
  result: SearchResult,
  queryWords: string[],
): void {
  const anchor = getPrimaryAnchor(result);
  const heading = anchor?.headingPath?.split(' > ').map(headingText).join(' > ');
  if (heading) {
    const el = parent.createDiv({ cls: 'hybrid-search-result-heading' });
    el.title = heading;
    appendHighlightedText(el, heading, queryWords);
  }
  const snippet = (result.snippet ?? '').slice(0, 4000);
  let lines = snippet.split(/\r?\n/);
  if (anchor?.matchText) {
    const needle = excerptText(anchor.matchText);
    const matchLine = lines.findIndex((line) => excerptText(line).includes(needle));
    if (needle && matchLine >= 0) {
      const startsWithHeading = /^\s*#{1,6}\s/.test(lines[matchLine]!);
      lines = lines.slice(matchLine + (startsWithHeading ? 1 : 0));
      const nextHeading = lines.findIndex((line) => /^\s*#{1,6}\s/.test(line));
      if (nextHeading >= 0) lines = lines.slice(0, nextHeading);
    } else {
      // The primary anchor can refer to a different chunk than the BM25 snippet.
      lines = [anchor.matchText.slice(0, 4000)];
    }
  }
  const text = bodyLines(lines.join('\n')).join(' ');
  const el = parent.createDiv({ cls: 'hybrid-search-result-snippet' });
  if (text) appendHighlightedText(el, text, queryWords);
  else {
    el.textContent = '暂无可用片段';
    el.classList.add('hybrid-search-result-snippet-empty');
  }
}

function appendHighlightedText(parent: HTMLElement, text: string, words: string[]): void {
  const tokens = [...new Set(words.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!tokens.length) {
    parent.textContent = text;
    return;
  }
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'giu');
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(text.slice(end, match.index));
    parent.createEl('mark', { cls: 'hybrid-search-result-word-match', text: match[0] });
    end = match.index + match[0].length;
  }
  parent.append(text.slice(end));
}

/** Validate against the current source; chunk offsets are not full-file coordinates.
 * Repeated text is accepted only when the full heading hierarchy identifies one occurrence. */
export function resultMatchPosition(content: string, anchor: MatchAnchor) {
  const needle = normalizedMatch(anchor.matchText);
  if (!needle) return undefined;
  const wanted = anchor.headingPath?.split(' > ').map(headingText).join(' > ');
  const matches: number[] = [];
  for (const { line, start, heading } of sourceLines(content)) {
    if (wanted && heading !== wanted) continue;
    const { text: plain, columns } = sourceText(line);
    const index = plain.indexOf(needle);
    if (index < 0) continue;
    if (plain.indexOf(needle, index + 1) >= 0) return undefined;
    matches.push(start + columns[index]!);
    if (matches.length > 1) return undefined;
  }
  return matches.length === 1 ? offsetToEditorPosition(content, matches[0]!) : undefined;
}

function* sourceLines(content: string) {
  const headings: Array<{ level: number; text: string }> = [];
  let offset = 0;
  let frontmatter = content.startsWith('---\n') || content.startsWith('---\r\n');
  let fence = '';
  for (const line of content.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    if (frontmatter) {
      if (start > 0 && /^---\r?$/.test(line)) frontmatter = false;
      continue;
    }
    const fenced = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenced) {
      if (!fence) fence = fenced[1]!;
      else if (fenced[1]![0] === fence[0] && fenced[1]!.length >= fence.length) fence = '';
    }
    if (!fence && !fenced) {
      const heading = /^ {0,3}(#{1,6})\s+/.exec(line);
      if (heading) {
        const level = heading[1]!.length;
        while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
        headings.push({ level, text: headingText(line) });
      }
    }
    yield { line, start, heading: headings.map((h) => h.text).join(' > ') };
  }
}

function normalizedMatch(text: string): string {
  return text
    .replace(/[*_`~\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep source columns while removing emphasis and collapsing whitespace in one pass. */
function sourceText(line: string): { text: string; columns: number[] } {
  let text = '';
  const columns: number[] = [];
  for (let column = 0; column < line.length; column++) {
    const char = line[column]!;
    if ('*_`~\\'.includes(char)) continue;
    if (/\s/.test(char)) {
      if (!text || text.endsWith(' ')) continue;
      text += ' ';
    } else text += char;
    columns.push(column);
  }
  return { text: text.trimEnd(), columns };
}
