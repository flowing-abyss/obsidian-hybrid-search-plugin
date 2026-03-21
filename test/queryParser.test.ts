import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/ui/queryParser';

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

  it('tag: with exclusion prefix -', () => {
    const { overrides } = parseQuery('tag:-spam query');
    expect(overrides.tag).toBe('-spam');
  });

  it('multiple tag: operators → array', () => {
    const { overrides } = parseQuery('tag:pkm tag:cs query');
    expect(overrides.tag).toEqual(['pkm', 'cs']);
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

  it('folder: with exclusion prefix -', () => {
    const { overrides } = parseQuery('folder:-archive query');
    expect(overrides.scope).toBe('-archive');
  });

  it('multiple folder: operators → array', () => {
    const { overrides } = parseQuery('folder:notes folder:projects query');
    expect(overrides.scope).toEqual(['notes', 'projects']);
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
