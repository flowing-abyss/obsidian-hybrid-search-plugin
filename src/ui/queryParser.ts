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
    frontmatter?: string | string[];
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

const RESERVED_POSTFIX_NAMES = new Set([
  'hybrid',
  'hyb',
  'semantic',
  'sem',
  'fulltext',
  'full',
  'title',
  'rerank',
  'limit',
  'lim',
  'threshold',
  'th',
]);

/** Trims, strips any leading "@", and lowercases a postfix name so stored settings and
 *  typed queries compare equal regardless of how the user entered it. */
export function normalizePostfixName(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function isReservedPostfixName(name: string): boolean {
  return RESERVED_POSTFIX_NAMES.has(normalizePostfixName(name));
}

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

  // 3. tags: / tag: — leading "-" excludes (Obsidian-style: -tag:value), "#" on the value is optional.
  // The "-" must be at the start of the query or preceded by whitespace, so a hyphen inside an
  // unrelated compound word (e.g. "sub-tag:x") is never mistaken for the exclusion prefix.
  const tagMatches: string[] = [];
  remaining = remaining.replace(
    /(?:^|\s)(-)?\btags?:\s*#?(\S+)/gi,
    (_, minus: string | undefined, t: string) => {
      tagMatches.push((minus ? '-' : '') + t);
      return ' ';
    },
  );

  // 3b. #tag shorthand — #tagname or -#tagname (Obsidian-style tag filter)
  remaining = remaining.replace(
    /(^|\s)(-?)#([\w/-]+)/g,
    (_, space: string, minus: string, t: string) => {
      tagMatches.push(minus + t);
      return space;
    },
  );

  if (tagMatches.length === 1) {
    overrides.tag = tagMatches[0];
  } else if (tagMatches.length > 1) {
    overrides.tag = tagMatches;
  }

  // 4. folder: / folders: / path: / paths: — leading "-" excludes (Obsidian-style: -folder:value);
  //    quoted values allowed for names containing spaces, e.g. folder:"My Folder". Same whitespace
  //    anchoring as tag: above, so a hyphen inside a compound word isn't mistaken for exclusion.
  const scopeMatches: string[] = [];
  remaining = remaining.replace(
    /(?:^|\s)(-)?\b(?:folders?|paths?):\s*("[^"]+"|\S+)/gi,
    (_, minus: string | undefined, raw: string) => {
      const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      scopeMatches.push((minus ? '-' : '') + value);
      return ' ';
    },
  );
  if (scopeMatches.length === 1) {
    overrides.scope = scopeMatches[0];
  } else if (scopeMatches.length > 1) {
    overrides.scope = scopeMatches;
  }

  // 4b. @postfix operators — value-bearing (must run before inline filters to avoid partial match)
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

  // 4c. @postfix operators — simple (mode, rerank; bare th/lim without value stripped silently)
  remaining = remaining.replace(
    /@(hybrid|hyb|semantic|sem|fulltext|full|title|rerank|threshold|th|limit|lim)\b/gi,
    (_, op: string) => {
      const lower = op.toLowerCase();
      if (lower === 'rerank') overrides.rerank = true;
      else if (MODE_MAP[lower]) overrides.mode = MODE_MAP[lower];
      return ' ';
    },
  );

  // 5. Inline property filters: property:value like status:pending, priority:high
  // Matches any word followed by colon (except known operators like limit, threshold, tag, folder)
  // Supports exclusion prefix: -property:value
  const KNOWN_OPERATORS = [
    'limit',
    'lim',
    'threshold',
    'th',
    'tag',
    'tags',
    'folder',
    'folders',
    'path',
    'paths',
    'rerank',
    'semantic',
    'sem',
    'hybrid',
    'hyb',
    'fulltext',
    'full',
    'title',
  ];
  const fmMatches: string[] = [];
  /* eslint-disable sonarjs/slow-regex, sonarjs/duplicates-in-character-class -- frontmatter property parsing with lookbehind and quoted strings */
  remaining = remaining.replace(
    /(?<!@)(-?)([a-zA-Z_][\w-]*):\s*(-?"[^"]+"|-?\S+)/gi,
    /* eslint-enable sonarjs/slow-regex, sonarjs/duplicates-in-character-class -- frontmatter property parsing completed */
    (_, minus: string, op: string, match: string) => {
      if (KNOWN_OPERATORS.includes(op.toLowerCase())) return _;
      // Remove surrounding quotes if present
      const value = match.startsWith('"') && match.endsWith('"') ? match.slice(1, -1) : match;
      fmMatches.push(minus + op + ':' + value);
      return ' ';
    },
  );
  if (fmMatches.length === 1) {
    overrides.frontmatter = fmMatches[0];
  } else if (fmMatches.length > 1) {
    overrides.frontmatter = fmMatches;
  }

  const query = remaining.trim().replace(/\s+/g, ' ');
  return { query, overrides };
}

/** Appends a user-configured default filter string (e.g. "-tag:archive -folder:Templates")
 *  to a raw query before it's handed to parseQuery(), so it's always applied without
 *  the user having to retype it on every search. Because it's appended (not prepended),
 *  start-anchored operators like the mode prefix (hybrid:, title:, ...) won't take effect
 *  here — only tag:/folder:/path:/property: style operators are safe to put in this field. */
export function applyDefaultFilters(query: string, defaultFilters: string): string {
  const filters = defaultFilters.trim();
  if (!filters) return query;
  return `${query} ${filters}`.trim();
}

export interface CustomPostfix {
  name: string;
  filters: string;
}

/** Expands user-defined @name shortcuts (e.g. "@work" -> "-tag:personal folder:work")
 *  before the query is handed to parseQuery(). Matching is case-insensitive; "@" must be at
 *  the start of the query or preceded by whitespace (so "foo@work.com" isn't mangled), and the
 *  name must not be followed by another word character (so "@work" doesn't also match inside
 *  "@workshop", even for names ending in punctuation). All configured postfixes are matched in
 *  a single pass over the original query, so one postfix's expansion can never itself trigger
 *  another postfix's expansion. Reserved/duplicate names are expected to already be filtered
 *  out of `postfixes` by the settings layer. */
export function applyCustomPostfixes(query: string, postfixes: CustomPostfix[]): string {
  const entries = postfixes
    .map(({ name, filters }) => ({ name: normalizePostfixName(name), filters: filters.trim() }))
    .filter((p) => p.name && p.filters);
  if (!entries.length) return query;

  const filtersByName = new Map(entries.map((p) => [p.name, p.filters]));
  const alternation = entries.map((p) => p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?:^|\\s)@(${alternation})(?!\\w)`, 'gi');

  const result = query.replace(pattern, (_match, name: string) => {
    return ` ${filtersByName.get(name.toLowerCase())!} `;
  });
  return result.trim().replace(/\s+/g, ' ');
}
