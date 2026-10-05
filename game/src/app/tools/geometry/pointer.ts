// Pure pointer-math thresholds, moved verbatim from app/Viewport.tsx.
// A press only becomes a drag after both a hold time and a pixel travel, so a
// quick tap stays one cell even if the pointer jitters.

/** Hold this long (and move) before a press becomes a rectangle drag, not a click. */
export const LONG_PRESS_MS = 160
/** Pointer travel in pixels that counts as a drag. */
export const DRAG_PX = 4

export function isMoved(d: { sx: number; sy: number }, e: { clientX: number; clientY: number }): boolean {
  return Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_PX
}
