/* eslint-disable sonarjs/super-linear-regex -- existing Markdown statistics patterns; covered by note statistics fixtures */
export interface NoteTextStats {
  words: number;
  characters: number;
  cjkCharacters: number;
  pages: number;
  readingMinutes: number;
  headings: number;
  listItems: number;
  paragraphs: number;
  quoteBlocks: number;
  callouts: number;
  frontmatterFields: number;
  tags: number;
  aliases: number;
}

const WORDS_PER_MINUTE = 265;
const CJK_CHARS_PER_MINUTE = 500;
const WORDS_PER_PAGE = 300;

export function computeNoteTextStats(
  content: string,
  frontmatter?: Record<string, unknown>,
): NoteTextStats {
  const body = stripFrontmatter(content);
  const visibleBody = normalizeVisibleMarkdown(body);
  const cjkCharacters = countCjkCharacters(visibleBody);
  const wordText = visibleBody.replace(CJK_CHARACTER_PATTERN, ' ');
  const words = wordText.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  const characters = visibleBody.replace(/\s/g, '').length;
  const headings = body.match(/^\s*#{1,6}\s+\S.*$/gm)?.length ?? 0;
  const listItems = body.match(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\S.*$/gm)?.length ?? 0;
  const quoteBlocks = countQuoteBlocks(body);
  const callouts = countCalloutBlocks(body);
  const paragraphs = visibleBody
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter((part) => Boolean(part.replace(/^#+\s+/gm, '').trim())).length;
  const frontmatterFields = frontmatter ? Object.keys(frontmatter).length : 0;
  const frontmatterTags = countFrontmatterValues(frontmatter?.['tags'] ?? frontmatter?.['tag']);
  const inlineTags = new Set(
    Array.from(visibleBody.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu), (match) => match[2]),
  ).size;
  const aliases = countFrontmatterValues(frontmatter?.['aliases'] ?? frontmatter?.['alias']);
  const readingMinutes = Math.max(
    1,
    Math.ceil(words / WORDS_PER_MINUTE + cjkCharacters / CJK_CHARS_PER_MINUTE),
  );
  const pages = (words + cjkCharacters) / WORDS_PER_PAGE;
  return {
    words,
    characters,
    cjkCharacters,
    pages,
    readingMinutes,
    headings,
    listItems,
    paragraphs,
    quoteBlocks,
    callouts,
    frontmatterFields,
    tags: frontmatterTags + inlineTags,
    aliases,
  };
}

const CJK_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

function normalizeVisibleMarkdown(content: string): string {
  return content
    .replace(/(^|\n)(```|~~~)[\s\S]*?(?:\n\2[ \t]*(?=\n|$)|$)/g, '\n')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\[\^[^\]]+\]:.*(?:\n[ \t]+.*)*/gm, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/!\[[^\]]*?\]\([^)]+?\)/g, ' ')
    .replace(/\[([^\]]*?)\]\([^)]+?\)/g, '$1')
    .replace(/\[([^\]]*?)\]\[[^\]]*?\]/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, (_, linkText: string) => displayLinkText(linkText))
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~=`>|[\]{}()]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function displayLinkText(linkText: string): string {
  return linkText.replace(/^.*\//, '').replace(/\.md$/i, '').trim();
}

function countCjkCharacters(content: string): number {
  let count = 0;
  CJK_CHARACTER_PATTERN.lastIndex = 0;
  while (CJK_CHARACTER_PATTERN.exec(content)) count++;
  return count;
}

function countCalloutBlocks(content: string): number {
  return content.match(/^\s*>\s*\[![^\]]+\]/gim)?.length ?? 0;
}

function countQuoteBlocks(content: string): number {
  let count = 0;
  let inQuoteBlock = false;
  let currentBlockIsCallout = false;
  const quoteLinePattern = /^\s*>\s?(.*)$/;
  for (const line of content.split(/\r?\n/)) {
    const quoteMatch = quoteLinePattern.exec(line);
    if (!quoteMatch) {
      if (inQuoteBlock && !currentBlockIsCallout) count++;
      inQuoteBlock = false;
      currentBlockIsCallout = false;
      continue;
    }
    if (!inQuoteBlock) {
      inQuoteBlock = true;
      currentBlockIsCallout = /^\s*\[![^\]]+\]/i.test(quoteMatch[1] ?? '');
    }
  }
  if (inQuoteBlock && !currentBlockIsCallout) count++;
  return count;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
}

function countFrontmatterValues(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean).length;
  }
  return value == null ? 0 : 1;
}

/* eslint-enable sonarjs/super-linear-regex -- end of Markdown statistics patterns */
