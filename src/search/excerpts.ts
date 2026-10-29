import { getPrimaryAnchor } from './anchors';
import type { SearchResult } from './contracts';

interface HighlightRange {
  start: number;
  end: number;
}

export type ExcerptHighlighter = (text: string) => HighlightRange[];

export interface ResultExcerpt {
  text: string;
  section?: string;
  sectionTitle?: string;
  highlights: HighlightRange[];
}

const INPUT_LIMIT = 4096;
const EXCERPT_LIMIT = 280;

export function getExcerptRequestOptions(
  query: string,
  hasNotePath: boolean,
  display: { showResultSnippets: boolean; showPreview: boolean; scrollToSnippet: boolean },
): { snippetLength: number; anchors: boolean } {
  const previewNeedsContext = display.showPreview && display.scrollToSnippet;
  const needed = hasNotePath
    ? previewNeedsContext
    : Boolean(query.trim()) && (display.showResultSnippets || previewNeedsContext);
  return { snippetLength: needed ? 400 : 0, anchors: needed };
}

/** Compile once per parsed query, preserving literal punctuation in identifiers. */
export function getQueryTerms(query: string): string[] {
  return [...new Set(query.slice(0, 1024).normalize('NFC').split(/\s+/))]
    .map((token) => token.replace(/^["']|["']$/g, ''))
    .filter((token) => token.length <= 64 && /[\p{L}\p{N}]/u.test(token))
    .slice(0, 20)
    .sort((a, b) => b.length - a.length);
}

export function createExcerptHighlighter(query: string): ExcerptHighlighter {
  const tokens = getQueryTerms(query);
  if (!tokens.length) return () => [];
  const pattern = new RegExp(
    tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'giu',
  );
  return (text) => {
    pattern.lastIndex = 0;
    return Array.from(text.slice(0, INPUT_LIMIT).matchAll(pattern), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
  };
}

/** Display-only cleanup, never used to resolve a position in a Markdown file. */
export function excerptPlainText(source = ''): string {
  const text = source
    .slice(0, INPUT_LIMIT)
    .normalize('NFC')
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  // Protect code before removing HTML or emphasis: Array<string> and __init__
  // are literal content inside a code span, not markup to discard.
  const parts: string[] = [];
  const delimiters = /`+|~{3,}/g;
  let cursor = 0;
  for (let opening = delimiters.exec(text); opening; opening = delimiters.exec(text)) {
    const delimiter = opening[0];
    const from = opening.index + delimiter.length;
    const end = text.indexOf(delimiter, from);
    if (end < 0) continue;
    let code = text.slice(from, end);
    if (delimiter.length >= 3 && code.includes('\n')) code = code.slice(code.indexOf('\n') + 1);
    parts.push(stripMarkup(text.slice(cursor, opening.index)), code);
    cursor = end + delimiter.length;
    delimiters.lastIndex = cursor;
  }
  parts.push(stripMarkup(text.slice(cursor)));
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function stripMarkup(text: string): string {
  return (
    text
      // Backend windows can begin/end inside a link. Keep the visible alias or
      // label instead of exposing its clipped target; code spans stay protected.
      .replace(/^(\.{3}|…)?[^\]\n[|]*\|([^\]\n]+)\]\]/, '$1$2')
      .replace(/^[ \t]*(?:```|~~~).*$/gm, '')
      .replace(/!\[\[[^\]\n]*\]\]/g, '')
      .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
      .replace(/\[\[([^\]\n[]+)\]\]/g, (_match, target: string) => target.split('|').pop() ?? '')
      .replace(/\[\[([^\]\n[]+)$/, (_match, target: string) => target.split('|').pop() ?? '')
      .replace(/\[([^\]\n[]+)\]\([^)\n]*\)/g, '$1')
      .replace(/\[([^\]\n[]+)\]\([^)\n]*$/, '$1')
      .replace(/<[^<>\n]*>/g, ' ')
      .replace(/^[ \t]*(?:#{1,6}|>)[ \t]+/gm, '')
      .replace(/^\[![^\]\n]+\][+-]?[ \t]*/gm, '')
      .replace(/^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
      .replace(/^[ \t]*\d+\.[ \t]+/gm, '')
      .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|[.,!?]|$)/g, '$1$2')
  );
}

function boundedWindow(text: string, focus: number, limit: number): string {
  // Work in code points so truncation never produces a broken surrogate pair.
  const points = Array.from(text);
  if (points.length <= limit) return text;
  const focusPoint = Array.from(text.slice(0, focus)).length;
  const start = Math.min(Math.max(0, focusPoint - 60), points.length - limit);
  const end = start + limit;
  return `${start ? '…' : ''}${points.slice(start, end).join('').trim()}${end < points.length ? '…' : ''}`;
}

export function prepareResultExcerpt(
  result: Pick<SearchResult, 'snippet' | 'previewAnchors' | 'primaryAnchorIndex'>,
  highlight: ExcerptHighlighter,
): ResultExcerpt | undefined {
  const anchor = getPrimaryAnchor(result);
  const match = excerptPlainText(anchor?.matchText);
  const headingPath = anchor?.headingPath?.slice(0, INPUT_LIMIT).normalize('NFC') ?? '';
  let snippetSource = result.snippet?.slice(0, INPUT_LIMIT).normalize('NFC') ?? '';
  // The CLI can prefix the full breadcrumb on its own line. The section label
  // already presents it; only remove a prefix that exactly matches this anchor.
  if (headingPath && snippetSource.replace(/\r\n/g, '\n').startsWith(`${headingPath}\n`)) {
    snippetSource = snippetSource.slice(headingPath.length).trimStart();
  }
  const snippet = excerptPlainText(snippetSource);
  // A backend snippet can come from a different chunk than its primary anchor.
  const matchOffset = match ? snippet.indexOf(match) : -1;
  const source = match && matchOffset < 0 ? match : snippet;
  if (!/[\p{L}\p{N}\p{S}]/u.test(source)) return undefined;
  const focus = highlight(source)[0]?.start ?? Math.max(0, matchOffset);
  const text = boundedWindow(source, focus, EXCERPT_LIMIT);
  const section = match ? excerptPlainText(headingPath.split(' > ').pop()) : '';
  return {
    text,
    ...(section && { section: boundedWindow(section, 0, 60), sectionTitle: headingPath }),
    highlights: highlight(text),
  };
}
