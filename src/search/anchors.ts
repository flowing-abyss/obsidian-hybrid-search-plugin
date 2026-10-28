import type { MatchAnchor } from './contracts';

/** The primary anchor is the one scrollTo/highlight logic should target — semantic when present. */
export function getPrimaryAnchor(source: {
  previewAnchors?: MatchAnchor[];
  primaryAnchorIndex?: number;
}): MatchAnchor | undefined {
  const anchors = source.previewAnchors;
  if (!anchors || anchors.length === 0) return undefined;
  const index =
    typeof source.primaryAnchorIndex === 'number' && source.primaryAnchorIndex >= 0
      ? source.primaryAnchorIndex
      : 0;
  return anchors[index] ?? anchors[0];
}

/** Resolve an anchor's real character offset in `content`, validating charStart against
 *  matchText and falling back to a literal search when the offset doesn't line up. */
export function getAnchorOffset(content: string, anchor: MatchAnchor): number {
  if (
    typeof anchor.charStart === 'number' &&
    anchor.charStart >= 0 &&
    anchor.charStart <= content.length
  ) {
    if (!anchor.matchText || content.startsWith(anchor.matchText, anchor.charStart)) {
      return anchor.charStart;
    }
  }
  if (!anchor.matchText) return -1;
  return content.indexOf(anchor.matchText);
}

export function offsetToEditorPosition(
  content: string,
  offset: number,
): { line: number; ch: number } {
  let line = 0;
  let lineStart = 0;
  const boundedOffset = Math.max(0, Math.min(offset, content.length));
  for (let index = 0; index < boundedOffset; index++) {
    if (content.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, ch: boundedOffset - lineStart };
}
