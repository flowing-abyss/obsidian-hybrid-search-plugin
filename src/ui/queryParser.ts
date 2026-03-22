type SearchMode = 'hybrid' | 'semantic' | 'fulltext' | 'title';

interface ParsedQuery {
  query: string;
  overrides: {
    mode?: SearchMode;
    limit?: number;
    tag?: string | string[];
    scope?: string | string[];
    rerank?: boolean;
    threshold?: number;
  };
}

const MODE_MAP: Record<string, SearchMode> = {
  hybrid: 'hybrid',
  hyb: 'hybrid',
  semantic: 'semantic',
  sem: 'semantic',
  full: 'fulltext',
  fulltext: 'fulltext',
  title: 'title',
};

export function parseQuery(input: string): ParsedQuery {
  let remaining = input;
  const overrides: ParsedQuery['overrides'] = {};

  // 1. Prefix mode: hybrid: | hyb: | semantic: | sem: | full: | fulltext: | title:
  const modePrefix = /^(hybrid|hyb|semantic|sem|fulltext|full|title):\s*/i;
  const modeMatch = modePrefix.exec(remaining);
  if (modeMatch) {
    overrides.mode = MODE_MAP[modeMatch[1]!.toLowerCase()];
    remaining = remaining.slice(modeMatch[0].length);
  }

  // 2. limit:N
  remaining = remaining.replace(/(?<!@)\blimit:\s*(\d+)/gi, (_, n: string) => {
    overrides.limit = parseInt(n, 10);
    return ' ';
  });

  // 2b. threshold: / th:
  remaining = remaining.replace(/(?<!@)\bth(?:reshold)?:\s*(\d*\.?\d+)/gi, (_, n: string) => {
    const val = parseFloat(n);
    if (!isNaN(val)) overrides.threshold = val;
    return ' ';
  });

  // 3. tags: / tag:
  const tagMatches: string[] = [];
  remaining = remaining.replace(/\btags?:\s*(-?\S+)/gi, (_, t: string) => {
    tagMatches.push(t);
    return ' ';
  });
  if (tagMatches.length === 1) {
    overrides.tag = tagMatches[0];
  } else if (tagMatches.length > 1) {
    overrides.tag = tagMatches;
  }

  // 4. folder: / folders:
  const scopeMatches: string[] = [];
  remaining = remaining.replace(/\bfolders?:\s*(-?\S+)/gi, (_, s: string) => {
    scopeMatches.push(s);
    return ' ';
  });
  if (scopeMatches.length === 1) {
    overrides.scope = scopeMatches[0];
  } else if (scopeMatches.length > 1) {
    overrides.scope = scopeMatches;
  }

  // 5. @postfix operators — value-bearing (must run before simple to avoid partial match)
  remaining = remaining.replace(
    /@(th(?:reshold)?|lim(?:it)?):(\S+)/gi,
    (_, op: string, val: string) => {
      const lower = op.toLowerCase();
      if (lower === 'th' || lower === 'threshold') {
        const v = parseFloat(val);
        if (!isNaN(v)) overrides.threshold = v;
      } else {
        const v = parseInt(val, 10);
        if (!isNaN(v)) overrides.limit = v;
      }
      return ' ';
    },
  );

  // 5b. @postfix operators — simple (mode, rerank; bare th/lim without value stripped silently)
  remaining = remaining.replace(
    /@(hybrid|hyb|semantic|sem|fulltext|full|title|rerank|threshold|th|limit|lim)\b/gi,
    (_, op: string) => {
      const lower = op.toLowerCase();
      if (lower === 'rerank') overrides.rerank = true;
      else if (MODE_MAP[lower]) overrides.mode = MODE_MAP[lower];
      return ' ';
    },
  );

  const query = remaining.trim().replace(/\s+/g, ' ');
  return { query, overrides };
}
