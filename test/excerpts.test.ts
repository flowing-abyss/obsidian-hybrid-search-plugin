import { describe, expect, it } from 'vitest';
import type { MatchAnchor, SearchResult } from '../src/search/contracts';
import { createExcerptHighlighter, prepareResultExcerpt } from '../src/search/excerpts';

const result: SearchResult = { path: 'note.md', title: 'Note', score: 0.8, tags: [], aliases: [] };
const anchor = (matchText: string, headingPath = 'Parent > Section'): MatchAnchor => ({
  kind: 'semantic',
  headingPath,
  matchText,
  charStart: null,
  charEnd: null,
});
const excerpt = (data: Partial<SearchResult>, query = '') =>
  prepareResultExcerpt({ ...result, ...data }, createExcerptHighlighter(query));

describe('result excerpt preparation', () => {
  it('cleans links clipped by backend snippet boundaries while retaining their labels', () => {
    expect(
      excerpt({
        snippet:
          '...Long note title|alias]];\n- **More** [[Folder/Another|second alias]];\nReference [source](https://host/path',
        previewAnchors: [anchor('note title|alias]];')],
      })?.text,
    ).toBe('...alias; More second alias; Reference source');
    expect(excerpt({ snippet: 'Read [[Folder/Long note|part of label' })?.text).toBe(
      'Read part of label',
    );
    expect(excerpt({ snippet: '`target|alias]]` and `[label](url`' })?.text).toBe(
      'target|alias]] and [label](url',
    );
  });
  it('keeps a late literal match visible inside coherent anchor context', () => {
    const matchText = 'Opening context '.repeat(5);
    const prepared = excerpt(
      {
        snippet: matchText + 'more context '.repeat(20) + 'needle at the end',
        previewAnchors: [anchor(matchText.trim())],
      },
      'needle',
    );
    expect(prepared?.text).toContain('needle');
    expect(prepared?.highlights).toHaveLength(1);
  });

  it.each(['`Array<string>`', '`__init__`', '```ts\nArray<string> __init__\n```'])(
    'preserves literal code inside %s',
    (snippet) => {
      const prepared = excerpt({ snippet }, 'Array<string> __init__');
      expect(prepared?.text).toBe(
        snippet.includes('\n') ? 'Array<string> __init__' : snippet.slice(1, -1),
      );
      expect(prepared?.highlights.length).toBe(snippet.includes('\n') ? 2 : 1);
    },
  );

  it('removes only the matching backend breadcrumb and retains the full section tooltip', () => {
    const prepared = excerpt({
      snippet: 'Parent > Section\nA matching passage',
      previewAnchors: [anchor('matching passage')],
    });
    expect(prepared?.text).toBe('A matching passage');
    expect(prepared?.section).toBe('Section');
    expect(prepared?.sectionTitle).toBe('Parent > Section');
  });

  it('removes Obsidian callout markers without discarding their title or body', () => {
    expect(excerpt({ snippet: '> [!Hint]+ A title\n> Useful body' })?.text).toBe(
      'A title Useful body',
    );
    expect(excerpt({ snippet: '`[!Hint]+`' })?.text).toBe('[!Hint]+');
  });

  it('omits absent, empty and markup-only excerpts', () => {
    for (const snippet of [undefined, '', ' \n ', '---', '![[image.png]]', '```\n```', '<br>']) {
      expect(excerpt({ snippet })).toBeUndefined();
    }
  });

  it('uses the selected anchor instead of assigning its section to unrelated context', () => {
    const prepared = excerpt({
      snippet: 'Unrelated introduction',
      previewAnchors: [anchor('First'), anchor('Relevant passage')],
      primaryAnchorIndex: 1,
    });
    expect(prepared?.text).toBe('Relevant passage');
    expect(prepared?.section).toBe('Section');
  });

  it('retains context when it contains the primary match', () => {
    const prepared = excerpt(
      {
        snippet: 'Before **relevant passage** and after.',
        previewAnchors: [anchor('relevant passage')],
      },
      'relevant',
    );
    expect(prepared?.text).toBe('Before relevant passage and after.');
    expect(prepared?.section).toBe('Section');
  });

  it('does not label fallback context with a textless anchor heading', () => {
    expect(
      excerpt({ snippet: 'Introduction', previewAnchors: [anchor('')] })?.section,
    ).toBeUndefined();
  });

  it('does not confuse punctuation when checking anchor context', () => {
    expect(
      excerpt({ snippet: 'const foobar = 1', previewAnchors: [anchor('foo_bar')] })?.text,
    ).toBe('foo_bar');
    expect(excerpt({ snippet: 'path ab', previewAnchors: [anchor('a\\b')] })?.text).toBe('a\\b');
  });

  it('prepares common Markdown as text while preserving technical identifiers', () => {
    expect(
      excerpt({
        snippet:
          '# Heading\n\n**Bold** with [[Note|alias]], [label](https://example.test) and `foo_bar` FN+D C++. ![[image.png]]',
      })?.text,
    ).toBe('Heading Bold with alias, label and foo_bar FN+D C++.');
  });

  it('bounds input and output and puts literal query matches inside the window', () => {
    const prepared = excerpt(
      { snippet: `${'prefix '.repeat(100)}C++ target ${'suffix '.repeat(1000)}` },
      'C++',
    );
    expect(prepared?.text.length).toBeLessThanOrEqual(282);
    expect(prepared?.text).toContain('C++');
    expect(prepared?.text.startsWith('…')).toBe(true);
    expect(prepared?.text.endsWith('…')).toBe(true);
  });

  it('bounds long headings and does not split emoji when truncating', () => {
    const prepared = excerpt({ previewAnchors: [anchor('🧠'.repeat(1000), 'x'.repeat(1000))] });
    expect(prepared?.section!.length).toBeLessThanOrEqual(61);
    expect(prepared?.text).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });

  it('does not invent a literal highlight for a semantic paraphrase', () => {
    expect(
      excerpt({ snippet: 'A different way of organizing ideas.' }, 'knowledge management')
        ?.highlights,
    ).toEqual([]);
  });
});

describe('literal excerpt highlighting', () => {
  it('escapes punctuation and highlights Cyrillic, CJK and NFC text', () => {
    const text = 'FN+D C++ foo_bar a\\b заметки 知识 café';
    const highlighter = createExcerptHighlighter('FN+D C++ foo_bar a\\b ЗАМЕТКИ 知识 cafe\u0301');
    expect(highlighter(text).map(({ start, end }) => text.slice(start, end))).toEqual(
      text.split(' '),
    );
    expect(highlighter('FNxD C fooXbar ab')).toEqual([]);
  });

  it('is reusable across rows and prefers the longest overlapping literal', () => {
    const highlight = createExcerptHighlighter('foo foo_bar foo');
    expect(highlight('foo_bar')).toEqual([{ start: 0, end: 7 }]);
    expect(highlight('foo_bar')).toEqual([{ start: 0, end: 7 }]);
  });

  it('ignores empty, punctuation-only and excessive query tokens', () => {
    expect(createExcerptHighlighter('.* + [ ]')('anything')).toEqual([]);
    expect(createExcerptHighlighter(`${'a'.repeat(10000)} valid`)('valid')).toEqual([]);
  });
});
