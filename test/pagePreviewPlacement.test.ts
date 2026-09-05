import { describe, expect, it } from 'vitest';
import { calculatePagePreviewCompanionPlacement } from '../src/ui/pagePreviewPlacement';

const previewRect = {
  left: 600,
  top: 300,
  right: 1200,
  bottom: 700,
  width: 600,
  height: 400,
};

describe('calculatePagePreviewCompanionPlacement', () => {
  it('places the companion below when its rendered height fits', () => {
    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect,
        viewportWidth: 1900,
        viewportHeight: 1200,
        contentHeight: 180,
      }),
    ).toEqual({ side: 'below', left: 0, top: 408, width: 600, maxHeight: 180 });
  });

  it('places the companion on the right when below is too short', () => {
    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect,
        viewportWidth: 1900,
        viewportHeight: 792,
        contentHeight: 180,
      }),
    ).toEqual({ side: 'right', left: 608, top: 0, width: 600, maxHeight: 180 });
  });

  it('places the companion on the left when below and right do not fit', () => {
    const rightEdgeRect = {
      ...previewRect,
      left: 1292,
      right: 1892,
    };

    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect: rightEdgeRect,
        viewportWidth: 1900,
        viewportHeight: 792,
        contentHeight: 180,
      }),
    ).toEqual({ side: 'left', left: -608, top: 0, width: 600, maxHeight: 180 });
  });

  it('caps content height at the native preview height', () => {
    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect,
        viewportWidth: 1900,
        viewportHeight: 1200,
        contentHeight: 900,
      })?.maxHeight,
    ).toBe(400);
  });

  it('includes companion borders in its border-box maximum height', () => {
    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect,
        viewportWidth: 1900,
        viewportHeight: 1200,
        contentHeight: 180,
        borderHeight: 2,
      })?.maxHeight,
    ).toBe(182);
  });

  it('uses a constrained below placement when no side fits but 96 pixels remain', () => {
    const narrowRect = { ...previewRect, left: 305, right: 905 };

    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect: narrowRect,
        viewportWidth: 1210,
        viewportHeight: 808,
        contentHeight: 180,
      }),
    ).toEqual({ side: 'below', left: 0, top: 408, width: 600, maxHeight: 100 });
  });

  it('returns null when no placement provides a usable companion', () => {
    const narrowRect = { ...previewRect, left: 305, right: 905 };

    expect(
      calculatePagePreviewCompanionPlacement({
        previewRect: narrowRect,
        viewportWidth: 1210,
        viewportHeight: 790,
        contentHeight: 180,
      }),
    ).toBeNull();
  });
});
