export interface ExplodedFloorRow {
  elevation: number
  floorVisible: boolean
  wallsVisible: boolean
}

export function clampExplodedFloorPanelPosition(
  anchorPx: readonly [number, number],
  panelWidth: number,
  panelHeight: number,
  bounds: { left: number; top: number; width: number; height: number },
): { left: number; top: number } {
  const minLeft = bounds.left + 8
  const maxLeft = Math.max(minLeft, bounds.left + bounds.width - panelWidth - 8)
  const minTop = bounds.top + 8
  const maxTop = Math.max(minTop, bounds.top + bounds.height - panelHeight - 8)
  return {
    left: Math.max(minLeft, Math.min(maxLeft, anchorPx[0] + 12)),
    top: Math.max(minTop, Math.min(maxTop, anchorPx[1] - panelHeight / 2)),
  }
}
