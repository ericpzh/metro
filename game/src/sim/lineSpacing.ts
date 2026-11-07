import { msg } from './i18n.ts'

/**
 * The 间隔 values the rail's line-placement tile cycles: **zero to six whole
 * blocks between two placed pieces**.
 *
 * The value is the number of empty cells the run leaves between one piece's
 * footprint and the next — never the pitch, which also counts the piece itself
 * (`lineStep` in `app/tools/geometry/linePlacement.ts`). 超短 is 0 and is the
 * default: a fresh run is continuous, with no gap to explain.
 *
 * The names are the same seven marks the 扶梯 / 电梯 / 栏杆 length cycles already
 * use, so a player who has read one length tile can read this one.
 */
export const LINE_SPACINGS = [0, 1, 2, 3, 4, 5, 6] as const
export type LineSpacing = typeof LINE_SPACINGS[number]
export const LINE_SPACING_DEFAULT: LineSpacing = 0

export interface LineSpacingOption {
  value: LineSpacing
  label: string
}

export const LINE_SPACING_OPTIONS: readonly LineSpacingOption[] = [
  { value: 0, label: msg('ultra_short') },
  { value: 1, label: msg('short') },
  { value: 2, label: msg('medium_short') },
  { value: 3, label: msg('medium') },
  { value: 4, label: msg('medium_long') },
  { value: 5, label: msg('long') },
  { value: 6, label: msg('ultra_long') },
]

/** Coerce a stored/cycled value onto the seven-rung ladder. */
export function lineSpacing(value: number): LineSpacing {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  const clamped = Math.min(LINE_SPACINGS.length - 1, Math.max(0, rounded))
  return LINE_SPACINGS[clamped]
}

/** The label of a spacing mark. */
export function lineSpacingLabel(value: number): string {
  return LINE_SPACING_OPTIONS[lineSpacing(value)].label
}

/** Step one rung on, wrapping 超长 back to 超短. */
export function nextLineSpacing(value: number): LineSpacing {
  return LINE_SPACINGS[(lineSpacing(value) + 1) % LINE_SPACINGS.length]
}

/**
 * The boxes the 间隔 tile always shows: two active pieces plus up to six empty
 * blocks between them. Keeping the row at eight means the tile's content is a
 * **line** the active pair moves along, not a pair that grows and shrinks.
 */
export const SPACING_BOX_COUNT = 8

/**
 * The indices of the two **active** boxes in that eight-box row: this piece and
 * the next one, with `gap` outlined boxes between them. The pair is centred in
 * the row, so 超短 sits in the middle and the gap opens symmetrically outward
 * until 超长 fills the row end to end.
 */
export function spacingActiveBoxes(gap: number, count = SPACING_BOX_COUNT): [number, number] {
  const blocks = Math.min(6, lineSpacing(gap))
  const span = Math.min(count, blocks + 2)
  const start = Math.max(0, Math.floor((count - span) / 2))
  return [start, start + blocks + 1]
}
