import { describe, expect, it } from 'vitest';
import {
  applyCustomPostfixes,
  applyDefaultFilters,
  isReservedPostfixName,
  normalizePostfixName,
  parseQuery,
} from '../src/ui/queryParser';

describe('parseQuery — mode prefix operators', () => {
  it('hybrid: sets mode and strips operator', () => {
    const { query, overrides } = parseQuery('hybrid: zettelkasten');
    expect(overrides.mode).toBe('hybrid');
    expect(query).toBe('zettelkasten');
  });

  it('hybrid: without space', () => {
    const { query, overrides } = parseQuery('hybrid:zettelkasten');
    expect(overrides.mode).toBe('hybrid');
    expect(query).toBe('zettelkasten');
  });

  it('hyb: abbreviation', () => {
    const { query, overrides } = parseQuery('hyb: запрос');
    expect(overrides.mode).toBe('hybrid');
    expect(query).toBe('запрос');
  });

  it('semantic: sets mode', () => {
    const { query, overrides } = parseQuery('semantic: vector search');
    expect(overrides.mode).toBe('semantic');
    expect(query).toBe('vector search');
  });

  it('sem: abbreviation', () => {
    const { overrides } = parseQuery('sem:query');
    expect(overrides.mode).toBe('semantic');
  });

  it('full: sets fulltext mode', () => {
    const { overrides } = parseQuery('full: bm25');
    expect(overrides.mode).toBe('fulltext');
  });

  it('fulltext: sets fulltext mode', () => {
    const { overrides } = parseQuery('fulltext:bm25');
    expect(overrides.mode).toBe('fulltext');
  });

  it('title: sets title mode', () => {
    const { query, overrides } = parseQuery('title: Zettelkasten');
    expect(overrides.mode).toBe('title');
    expect(query).toBe('Zettelkasten');
  });

  it('no mode prefix: overrides.mode is undefined', () => {
    const { overrides } = parseQuery('plain query');
    expect(overrides.mode).toBeUndefined();
  });
});

describe('parseQuery — limit operator', () => {
  it('limit:20 extracts limit', () => {
    const { query, overrides } = parseQuery('hybrid: запрос limit:20');
    expect(overrides.limit).toBe(20);
    expect(query).toBe('запрос');
  });

  it('limit: 20 with space', () => {
    const { overrides } = parseQuery('limit: 20 запрос');
    expect(overrides.limit).toBe(20);
  });

  it('limit not present: undefined', () => {
    const { overrides } = parseQuery('some query');
    expect(overrides.limit).toBeUndefined();
  });
});

describe('parseQuery — tag operators', () => {
  it('tags: extracts tag', () => {
    const { query, overrides } = parseQuery('tags:computer_science notes');
    expect(overrides.tag).toBe('computer_science');
    expect(query).toBe('notes');
  });

  it('tag: (singular) also works', () => {
    const { overrides } = parseQuery('tag: pkm query');
    expect(overrides.tag).toBe('pkm');
  });

  it('-tag: excludes (Obsidian-style: leading - before the operator)', () => {
    const { overrides } = parseQuery('-tag:spam query');
    expect(overrides.tag).toBe('-spam');
  });

  it('tag:#value strips the optional leading # on the value', () => {
    const { overrides } = parseQuery('tag:#pkm query');
    expect(overrides.tag).toBe('pkm');
  });

  it('-tag:#value and -tag:value behave identically', () => {
    const withHash = parseQuery('-tag:#archive query');
    const withoutHash = parseQuery('-tag:archive query');
    expect(withHash.overrides.tag).toBe('-archive');
    expect(withoutHash.overrides.tag).toBe('-archive');
  });

  it('multiple tag: operators → array', () => {
    const { overrides } = parseQuery('tag:pkm tag:cs query');
    expect(overrides.tag).toEqual(['pkm', 'cs']);
  });

  it('mix of include and exclude tag: operators → array', () => {
    const { overrides } = parseQuery('tag:pkm -tag:archive query');
    expect(overrides.tag).toEqual(['pkm', '-archive']);
  });

  it('a hyphen inside an unrelated compound word is not mistaken for the exclusion prefix', () => {
    // Falls through to the generic hyphenated-property filter (like due-date:), not a tag exclusion.
    const { query, overrides } = parseQuery('sub-tag:x query');
    expect(overrides.tag).toBeUndefined();
    expect(overrides.frontmatter).toBe('sub-tag:x');
    expect(query).toBe('query');
  });
});

describe('parseQuery — #tag shorthand', () => {
  it('#tag extracts tag filter', () => {
    const { query, overrides } = parseQuery('#pkm notes');
    expect(overrides.tag).toBe('pkm');
    expect(query).toBe('notes');
  });

  it('#tag at end of query', () => {
    const { query, overrides } = parseQuery('notes #pkm');
    expect(overrides.tag).toBe('pkm');
    expect(query).toBe('notes');
  });

  it('-#tag excludes tag', () => {
    const { query, overrides } = parseQuery('notes -#archive');
    expect(overrides.tag).toBe('-archive');
    expect(query).toBe('notes');
  });

  it('nested tag #category/subcategory', () => {
    const { overrides } = parseQuery('#category/cs notes');
    expect(overrides.tag).toBe('category/cs');
  });

  it('multiple #tags → array', () => {
    const { overrides } = parseQuery('#pkm #cs notes');
    expect(overrides.tag).toEqual(['pkm', 'cs']);
  });

  it('#tag mixed with tag: operator', () => {
    const { overrides } = parseQuery('#pkm tag:cs notes');
    expect(overrides.tag).toEqual(['cs', 'pkm']); // tag: processed before #tag
  });

  it('#tag with mode prefix', () => {
    const { query, overrides } = parseQuery('sem: notes #pkm');
    expect(overrides.mode).toBe('semantic');
    expect(overrides.tag).toBe('pkm');
    expect(query).toBe('notes');
  });
});

describe('parseQuery — folder operators', () => {
  it('folder: extracts scope', () => {
    const { query, overrides } = parseQuery('folder:sources query');
    expect(overrides.scope).toBe('sources');
    expect(query).toBe('query');
  });

  it('folders: (plural) also works', () => {
    const { overrides } = parseQuery('folders: notes query');
    expect(overrides.scope).toBe('notes');
  });

  it('-folder: excludes (Obsidian-style: leading - before the operator)', () => {
    const { overrides } = parseQuery('-folder:archive query');
    expect(overrides.scope).toBe('-archive');
  });

  it('path: is an alias for folder:', () => {
    const { query, overrides } = parseQuery('path:sources query');
    expect(overrides.scope).toBe('sources');
    expect(query).toBe('query');
  });

  it('-path: excludes, same as -folder:', () => {
    const { overrides } = parseQuery('-path:archive query');
    expect(overrides.scope).toBe('-archive');
  });

  it('folder: with a quoted value containing spaces', () => {
    const { overrides } = parseQuery('folder:"My Folder" query');
    expect(overrides.scope).toBe('My Folder');
  });

  it('-folder: with a quoted value containing spaces', () => {
    const { overrides } = parseQuery('-folder:"My Folder" query');
    expect(overrides.scope).toBe('-My Folder');
  });

  it('multiple folder: operators → array', () => {
    const { overrides } = parseQuery('folder:notes folder:projects query');
    expect(overrides.scope).toEqual(['notes', 'projects']);
  });
});

describe('parseQuery — property/frontmatter operators', () => {
  it('property: extracts frontmatter filter', () => {
    const { query, overrides } = parseQuery('meeting status:todo');
    expect(overrides.frontmatter).toBe('status:todo');
    expect(query).toBe('meeting');
  });

  it('prop: shorthand also works', () => {
    const { query, overrides } = parseQuery('notes priority:high');
    expect(overrides.frontmatter).toBe('priority:high');
    expect(query).toBe('notes');
  });

  it('frontmatter: full form also works', () => {
    const { query, overrides } = parseQuery('query status:done');
    expect(overrides.frontmatter).toBe('status:done');
    expect(query).toBe('query');
  });

  it('property: with exclusion prefix -', () => {
    const { overrides } = parseQuery('notes -status:done');
    expect(overrides.frontmatter).toBe('-status:done');
  });

  it('property: with quoted value', () => {
    const { overrides } = parseQuery('notes status:"in progress"');
    expect(overrides.frontmatter).toBe('status:in progress');
  });

  it('multiple property: operators → array (AND logic)', () => {
    const { overrides } = parseQuery('notes status:todo priority:high');
    expect(overrides.frontmatter).toEqual(['status:todo', 'priority:high']);
  });

  it('property: mixed with tag:', () => {
    const { overrides } = parseQuery('notes tag:pkm status:done');
    expect(overrides.tag).toBe('pkm');
    expect(overrides.frontmatter).toBe('status:done');
  });

  it('property: at the end of query', () => {
    const { query, overrides } = parseQuery('meeting notes status:todo');
    expect(overrides.frontmatter).toBe('status:todo');
    expect(query).toBe('meeting notes');
  });

  it('property: with mode prefix', () => {
    const { query, overrides } = parseQuery('sem: notes status:urgent');
    expect(overrides.mode).toBe('semantic');
    expect(overrides.frontmatter).toBe('status:urgent');
    expect(query).toBe('notes');
  });

  it('property: with limit', () => {
    const { overrides } = parseQuery('notes status:todo limit:5');
    expect(overrides.frontmatter).toBe('status:todo');
    expect(overrides.limit).toBe(5);
  });

  it('property: with hyphenated name', () => {
    const { overrides } = parseQuery('notes due-date:2025-01-01');
    expect(overrides.frontmatter).toBe('due-date:2025-01-01');
  });

  it('property: hyphenated with exclusion prefix', () => {
    const { overrides } = parseQuery('notes -due-date:2025-01-01');
    expect(overrides.frontmatter).toBe('-due-date:2025-01-01');
  });
});

describe('parseQuery — threshold operators', () => {
  it('threshold:0.9 sets threshold', () => {
    const { query, overrides } = parseQuery('запрос threshold:0.9');
    expect(overrides.threshold).toBe(0.9);
    expect(query).toBe('запрос');
  });

  it('th:0.9 abbreviation sets threshold', () => {
    const { query, overrides } = parseQuery('запрос th:0.9');
    expect(overrides.threshold).toBe(0.9);
    expect(query).toBe('запрос');
  });

  it('th: with space', () => {
    const { overrides } = parseQuery('запрос th: 0.5');
    expect(overrides.threshold).toBe(0.5);
  });

  it('threshold: with mode prefix', () => {
    const { overrides } = parseQuery('sem: notes threshold:0.7');
    expect(overrides.mode).toBe('semantic');
    expect(overrides.threshold).toBe(0.7);
  });

  it('@th:0.9 abbreviation sets threshold', () => {
    const { query, overrides } = parseQuery('запрос @th:0.9');
    expect(overrides.threshold).toBe(0.9);
    expect(query).toBe('запрос');
  });

  it('@th without value: ignored', () => {
    const { overrides } = parseQuery('запрос @th');
    expect(overrides.threshold).toBeUndefined();
  });
});

describe('parseQuery — @postfix operators', () => {
  it('@semantic sets mode', () => {
    const { query, overrides } = parseQuery('запрос @semantic');
    expect(overrides.mode).toBe('semantic');
    expect(query).toBe('запрос');
  });

  it('@sem abbreviation', () => {
    const { overrides } = parseQuery('запрос @sem');
    expect(overrides.mode).toBe('semantic');
  });

  it('@hybrid sets mode', () => {
    const { overrides } = parseQuery('запрос @hybrid');
    expect(overrides.mode).toBe('hybrid');
  });

  it('@hyb abbreviation', () => {
    const { overrides } = parseQuery('запрос @hyb');
    expect(overrides.mode).toBe('hybrid');
  });

  it('@title sets title mode', () => {
    const { query, overrides } = parseQuery('запрос @title');
    expect(overrides.mode).toBe('title');
    expect(query).toBe('запрос');
  });

  it('@full sets fulltext mode', () => {
    const { overrides } = parseQuery('запрос @full');
    expect(overrides.mode).toBe('fulltext');
  });

  it('@fulltext sets fulltext mode', () => {
    const { overrides } = parseQuery('запрос @fulltext');
    expect(overrides.mode).toBe('fulltext');
  });

  it('@rerank enables reranking', () => {
    const { overrides } = parseQuery('запрос @rerank');
    expect(overrides.rerank).toBe(true);
  });

  it('@threshold:0.5 sets threshold', () => {
    const { query, overrides } = parseQuery('запрос @threshold:0.5');
    expect(overrides.threshold).toBe(0.5);
    expect(query).toBe('запрос');
  });

  it('@threshold without value: ignored', () => {
    const { overrides } = parseQuery('запрос @threshold');
    expect(overrides.threshold).toBeUndefined();
  });

  it('@limit:10 sets limit', () => {
    const { query, overrides } = parseQuery('запрос @limit:10');
    expect(overrides.limit).toBe(10);
    expect(query).toBe('запрос');
  });

  it('@lim:10 sets limit', () => {
    const { query, overrides } = parseQuery('запрос @lim:10');
    expect(overrides.limit).toBe(10);
    expect(query).toBe('запрос');
  });

  it('@lim without value: ignored', () => {
    const { overrides } = parseQuery('запрос @lim');
    expect(overrides.limit).toBeUndefined();
  });
});

describe('parseQuery — combinations', () => {
  it('hybrid: query limit:20', () => {
    const { query, overrides } = parseQuery('hybrid: запрос limit:20');
    expect(overrides.mode).toBe('hybrid');
    expect(overrides.limit).toBe(20);
    expect(query).toBe('запрос');
  });

  it('hybrid:query limit:20 without spaces', () => {
    const { query, overrides } = parseQuery('hybrid:запрос limit:20');
    expect(overrides.mode).toBe('hybrid');
    expect(overrides.limit).toBe(20);
    expect(query).toBe('запрос');
  });

  it('mode prefix + tag + folder', () => {
    const { query, overrides } = parseQuery('sem: notes tag:pkm folder:sources');
    expect(overrides.mode).toBe('semantic');
    expect(overrides.tag).toBe('pkm');
    expect(overrides.scope).toBe('sources');
    expect(query).toBe('notes');
  });

  it('query with @sem at end overrides prefix mode', () => {
    // @-suffix mode wins over nothing when no prefix mode
    const { overrides } = parseQuery('query @sem');
    expect(overrides.mode).toBe('semantic');
  });

  it('multiple @operators in one query all parsed', () => {
    const { query, overrides } = parseQuery('запрос @sem @rerank');
    expect(overrides.mode).toBe('semantic');
    expect(overrides.rerank).toBe(true);
    expect(query).toBe('запрос');
  });

  it('@operators anywhere in the string, not just at the end', () => {
    const { query, overrides } = parseQuery('@rerank запрос @sem');
    expect(overrides.rerank).toBe(true);
    expect(overrides.mode).toBe('semantic');
    expect(query).toBe('запрос');
  });

  it('@operator in the middle of query', () => {
    const { query, overrides } = parseQuery('one @hyb two');
    expect(overrides.mode).toBe('hybrid');
    expect(query).toBe('one two');
  });

  it('@threshold and @rerank together', () => {
    const { overrides } = parseQuery('query @threshold:0.3 @rerank');
    expect(overrides.threshold).toBe(0.3);
    expect(overrides.rerank).toBe(true);
  });

  it('empty query returns empty string', () => {
    const { query } = parseQuery('');
    expect(query).toBe('');
  });

  it('only operators, no query text', () => {
    const { query, overrides } = parseQuery('hybrid: limit:10');
    expect(query).toBe('');
    expect(overrides.mode).toBe('hybrid');
    expect(overrides.limit).toBe(10);
  });

  it('query with multiple spaces collapsed', () => {
    const { query } = parseQuery('hybrid: one   two');
    expect(query).toBe('one two');
  });
});

describe('applyDefaultFilters', () => {
  it('returns the query unchanged when defaultFilters is empty', () => {
    expect(applyDefaultFilters('project notes', '')).toBe('project notes');
  });

  it('returns the query unchanged when defaultFilters is whitespace only', () => {
    expect(applyDefaultFilters('project notes', '   ')).toBe('project notes');
  });

  it('appends a non-empty defaultFilters with a single space', () => {
    expect(applyDefaultFilters('project notes', '-tag:archive')).toBe('project notes -tag:archive');
  });

  it('trims surrounding whitespace from defaultFilters before appending', () => {
    expect(applyDefaultFilters('project notes', '  -folder:Templates  ')).toBe(
      'project notes -folder:Templates',
    );
  });

  it('combines with parseQuery so defaults apply alongside typed filters', () => {
    const combined = applyDefaultFilters('project notes', '-tag:archive');
    const { query, overrides } = parseQuery(combined);
    expect(query).toBe('project notes');
    expect(overrides.tag).toBe('-archive');
  });

  it('appended filters accumulate into an array alongside a typed tag filter', () => {
    const combined = applyDefaultFilters('project tag:work', '-tag:archive');
    const { query, overrides } = parseQuery(combined);
    expect(query).toBe('project');
    expect(overrides.tag).toEqual(['work', '-archive']);
  });
});

describe('normalizePostfixName / isReservedPostfixName', () => {
  it('trims, strips a leading @, and lowercases', () => {
    expect(normalizePostfixName('  @Work  ')).toBe('work');
  });

  it('strips multiple leading @', () => {
    expect(normalizePostfixName('@@work')).toBe('work');
  });

  it('recognizes built-in postfix names as reserved, case-insensitively', () => {
    expect(isReservedPostfixName('rerank')).toBe(true);
    expect(isReservedPostfixName('SEM')).toBe(true);
    expect(isReservedPostfixName('@Hybrid')).toBe(true);
  });

  it('does not flag a custom name as reserved', () => {
    expect(isReservedPostfixName('work')).toBe(false);
  });
});

describe('applyCustomPostfixes', () => {
  it('returns the query unchanged when there are no postfixes', () => {
    expect(applyCustomPostfixes('project notes', [])).toBe('project notes');
  });

  it('expands a matching @name to its configured filters', () => {
    const result = applyCustomPostfixes('project @work', [
      { name: 'work', filters: '-tag:personal folder:work' },
    ]);
    expect(result).toBe('project -tag:personal folder:work');
  });

  it('is case-insensitive when matching the trigger', () => {
    const result = applyCustomPostfixes('project @WORK', [
      { name: 'work', filters: '-tag:personal' },
    ]);
    expect(result).toBe('project -tag:personal');
  });

  it('does not match a longer word that merely starts with the postfix name', () => {
    const result = applyCustomPostfixes('project @workshop', [
      { name: 'work', filters: '-tag:personal' },
    ]);
    expect(result).toBe('project @workshop');
  });

  it('expands every occurrence and every configured postfix', () => {
    const postfixes = [
      { name: 'work', filters: '-tag:personal' },
      { name: 'urgent', filters: 'tag:urgent' },
    ];
    const result = applyCustomPostfixes('@work notes @urgent @work', postfixes);
    expect(result).toBe('-tag:personal notes tag:urgent -tag:personal');
  });

  it('skips entries with an empty name or empty filters', () => {
    const result = applyCustomPostfixes('project @work', [
      { name: '', filters: '-tag:personal' },
      { name: 'work', filters: '   ' },
    ]);
    expect(result).toBe('project @work');
  });

  it('composes with parseQuery so the expanded filters are picked up as real operators', () => {
    const expanded = applyCustomPostfixes('project @work', [
      { name: 'work', filters: '-tag:personal folder:work' },
    ]);
    const { query, overrides } = parseQuery(expanded);
    expect(query).toBe('project');
    expect(overrides.tag).toBe('-personal');
    expect(overrides.scope).toBe('work');
  });

  it('does not expand @name inside an email-like token (requires a boundary before @)', () => {
    const result = applyCustomPostfixes('contact foo@work.com about it', [
      { name: 'work', filters: '-tag:personal' },
    ]);
    expect(result).toBe('contact foo@work.com about it');
  });

  it('matches a name ending in punctuation without needing a trailing word character', () => {
    const result = applyCustomPostfixes('search @c++ notes', [{ name: 'c++', filters: 'tag:cpp' }]);
    expect(result).toBe('search tag:cpp notes');
  });

  it('does not chain: one postfix expansion referencing @other is not itself expanded', () => {
    const result = applyCustomPostfixes('@a', [
      { name: 'a', filters: '@b' },
      { name: 'b', filters: 'tag:should-not-expand' },
    ]);
    expect(result).toBe('@b');
  });
});

describe('@similar operator', () => {
  it.each([
    ['@sim', { kind: 'active' }],
    ['@similar', { kind: 'active' }],
    ['@sim:[[Zettelkasten]]', { kind: 'note', ref: 'Zettelkasten' }],
    ['@sim:[[Areas/PKM#Метод]]', { kind: 'note', ref: 'Areas/PKM#Метод' }],
    ['@sim:"Areas/My Note.md"', { kind: 'note', ref: 'Areas/My Note.md' }],
    ['@sim:Areas/PKM.md', { kind: 'note', ref: 'Areas/PKM.md' }],
  ])('parses %s', (input, expected) => {
    const { query, overrides } = parseQuery(input);
    expect(overrides.similar).toEqual(expected);
    expect(query).toBe('');
  });

  it('combines with a tag filter', () => {
    const { query, overrides } = parseQuery('@sim #system/meta');
    expect(overrides.similar).toEqual({ kind: 'active' });
    expect(overrides.tag).toBe('system/meta');
    expect(query).toBe('');
  });

  it('combines with an explicit target and a folder filter', () => {
    const { overrides } = parseQuery('@sim:"Areas/My Note.md" folder:Projects');
    expect(overrides.similar).toEqual({ kind: 'note', ref: 'Areas/My Note.md' });
    expect(overrides.scope).toBe('Projects');
  });

  it('does not leak the operator into a frontmatter filter', () => {
    const { overrides } = parseQuery('@sim:Areas/PKM.md');
    expect(overrides.frontmatter).toBeUndefined();
  });

  it('protects a quoted path containing a hash', () => {
    const { overrides } = parseQuery('@sim:"Areas/My #1 Note.md"');
    expect(overrides.similar).toEqual({ kind: 'note', ref: 'Areas/My #1 Note.md' });
    expect(overrides.tag).toBeUndefined();
  });

  it('does not match @simple', () => {
    const { query, overrides } = parseQuery('@simple');
    expect(overrides.similar).toBeUndefined();
    expect(query).toBe('@simple');
  });

  it('drops free text alongside the operator', () => {
    const { query, overrides } = parseQuery('пкм система @sim #system/meta');
    expect(overrides.similar).toEqual({ kind: 'active' });
    expect(query).toBe('пкм система');
  });

  it('reserves sim and similar as postfix names', () => {
    expect(isReservedPostfixName('sim')).toBe(true);
    expect(isReservedPostfixName('@Similar')).toBe(true);
  });

  it('still treats a bare sim: as a frontmatter filter', () => {
    const { overrides } = parseQuery('sim:value');
    expect(overrides.frontmatter).toBe('sim:value');
  });
});
