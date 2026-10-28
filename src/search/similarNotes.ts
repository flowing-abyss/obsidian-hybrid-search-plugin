import type { SearchResult, SearchService } from './contracts';

export interface SimilarNotesOptions {
  limit: number;
  threshold: number;
  anchors?: boolean;
}

export interface SimilarNotesFetchResult {
  results: SearchResult[];
  scoreMode: 'similarity' | 'structural';
}

export async function fetchSimilarNotesDetailed(
  client: Pick<SearchService, 'search'>,
  path: string,
  options: SimilarNotesOptions,
): Promise<SimilarNotesFetchResult> {
  const nfcPath = path.normalize('NFC');
  const semantic = await client.search('', {
    notePath: path,
    limit: options.limit + 1,
    ...(options.anchors && { anchors: true }),
    ...(options.threshold > 0 && { threshold: options.threshold }),
  });
  const filteredSemantic = semantic.filter((result) => result.path.normalize('NFC') !== nfcPath);
  if (filteredSemantic.length > 0) {
    return { results: filteredSemantic.slice(0, options.limit), scoreMode: 'similarity' };
  }
  if (options.threshold > 0) {
    return { results: [], scoreMode: 'similarity' };
  }

  const related = await client.search(path, { related: true, limit: options.limit + 1 });
  return {
    results: related
      .filter((result) => result.path.normalize('NFC') !== nfcPath)
      .slice(0, options.limit),
    scoreMode: 'structural',
  };
}
