/**
 * The pointer's drag size label (plan 27 §7).
 *
 * The C# cell tool publishes its footprint badge on the bridge as `cells.measure`
 * (`{ length, width }` in metres, one cell to the metre — pinned by
 * `StationCellToolTests`), and the web game draws the same figure beside the cursor via
 * `ctx.showMeasure` (`BlockTool`'s "length × width", `RoadTool`'s `road_measure`). This
 * module is that figure's one owner on the shell side: the wording and the decision to
 * show it at all, so the presenter stays a dumb renderer and the rule is testable without
 * a browser.
 */

/** The shape the C# `cells` payload publishes for the footprint badge. */
export interface CellsMeasure {
  length: number
  width: number
}

/** The `cells` object as the bridge carries it (only the fields this module reads). */
export interface CellsPayload {
  kind?: string
  ok?: boolean
  measure?: CellsMeasure | null
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The two gesture families that show a size while they are in flight: a **rect** drag
 * (a run of cells, a floor patch, a delete, a wall line) and a **road** stroke. A single
 * click's one-by-one footprint is still a size, and the reference shows it too — the label
 * simply reads 1 × 1 — so the only rule is "a live plan with a measured footprint".
 */
const MEASURED_KINDS = new Set(['add', 'floor', 'ceiling', 'cut', 'erase', 'wall', 'delete'])

/** True when this `cells` payload is a footprint the pointer should label. */
export function wantsMeasure(cells: CellsPayload | null | undefined): boolean {
  if (!cells || typeof cells.kind !== 'string' || !MEASURED_KINDS.has(cells.kind)) return false
  const measure = cells.measure
  return !!measure && isCount(measure.length) && isCount(measure.width)
}

/**
 * The label's words, or an empty string when there is nothing to show. Length first, then
 * width, in whole metres — the same order and unit the reference's `showMeasure` uses.
 */
export function measureText(cells: CellsPayload | null | undefined, language: 'zh' | 'en' = 'zh'): string {
  if (!cells || !wantsMeasure(cells)) return ''
  const measure = cells.measure!
  const length = Math.round(measure.length)
  const width = Math.round(measure.width)
  return language === 'en' ? `${length} × ${width} m` : `${length} × ${width} 米`
}

/**
 * Where the label sits relative to the canvas: just right of and below the pointer, which is
 * the offset the web game's own measure chip uses so the cursor never covers the numbers.
 */
export const MEASURE_OFFSET = { x: 18, y: 20 } as const

/** The label's position for a pointer at (`clientX`, `clientY`) inside a canvas at `rect`. */
export function measurePosition(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number } | null,
): { left: number; top: number } {
  const left = clientX - (rect?.left ?? 0) + MEASURE_OFFSET.x
  const top = clientY - (rect?.top ?? 0) + MEASURE_OFFSET.y
  return { left, top }
}
