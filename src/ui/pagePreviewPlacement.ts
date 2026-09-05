export type PagePreviewPlacementSide = 'below' | 'right' | 'left';

export interface PagePreviewCompanionPlacement {
  side: PagePreviewPlacementSide;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export interface PagePreviewPlacementInput {
  previewRect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
  viewportWidth: number;
  viewportHeight: number;
  contentHeight: number;
  borderHeight?: number;
  gap?: number;
  minimumHeight?: number;
}

export function calculatePagePreviewCompanionPlacement({
  previewRect,
  viewportWidth,
  viewportHeight,
  contentHeight,
  borderHeight = 0,
  gap = 8,
  minimumHeight = 96,
}: PagePreviewPlacementInput): PagePreviewCompanionPlacement | null {
  const desiredHeight = Math.min(contentHeight + borderHeight, previewRect.height);
  const availableBelow = Math.max(0, viewportHeight - previewRect.bottom - gap);
  const availableRight = Math.max(0, viewportWidth - previewRect.right - gap);
  const availableLeft = Math.max(0, previewRect.left - gap);
  const common = { width: previewRect.width, maxHeight: desiredHeight };

  if (desiredHeight <= availableBelow) {
    return { side: 'below', left: 0, top: previewRect.height + gap, ...common };
  }
  if (previewRect.width <= availableRight) {
    return { side: 'right', left: previewRect.width + gap, top: 0, ...common };
  }
  if (previewRect.width <= availableLeft) {
    return { side: 'left', left: -previewRect.width - gap, top: 0, ...common };
  }
  if (availableBelow >= minimumHeight) {
    return {
      side: 'below',
      left: 0,
      top: previewRect.height + gap,
      width: previewRect.width,
      maxHeight: availableBelow,
    };
  }
  return null;
}
