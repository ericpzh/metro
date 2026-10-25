import { msg, type MessageKey } from './i18n.ts'
import { STOREY_HEIGHT } from './constants.ts'
// The fixed lengths a run comes in — 扶梯 (escalator), 单跑楼梯 (straight stair)
// and every turning stair — GAME-SPEC §5.1.
//
// A run is fixed equipment: it climbs `rise` metres over `run` cells of
// horizontal travel, and both ends land on the block grid. The **endpoints are
// authoritative** (`escalatorModule` / `stairFlightsFor` write them), so a piece
// loaded from an older save reads its length back from its endpoints.
//
// The catalogue is measured in **metres of climb**, and comes in two families:
//
//   single floor (扶梯 and every 楼梯):  超短 2, 短 3, 中 4, 长 5, 超长 6 m
//   double floor (扶梯 only):            超短 7, 短 8, 中 9, 长 10, 超长 11 m
//
// The single-floor family fills the station's storey: a five-metre station's
// one-storey run is 长 5 m, the default a fresh piece is built at. Both pieces
// also climb 超长 6 m — one metre above 长 — for the uneven floors the 电梯
// already spans (a six-metre mezzanine).
//
// The two families are **contiguous**: the 单层 tops out at 6 m and the 双层
// starts at 7 m, so a climb names its own family. The 双层 family keeps the same
// one-metre spacing, with 长 10 m — exactly two five-metre storeys — as its
// default.
//
// `run` is the **stair's** catalogue run: the 2:3 slope the reference staircase
// has always had (2 m over 3 m … 6 m over 9 m), rounded up to whole cells so
// both ends stay on the block grid. The escalator is laid at a strict 30° inside
// those integer landings (`escalatorLengthSpec`), so two pieces of one length
// climb the same metres while their horizontal runs differ.
//
// Pure data — no three, no DOM.

/** Which family a run's rise comes from: one floor, or two. */
export type RampSpan = 'single' | 'double' | 'triple'

/**
 * Which piece a one-floor length belongs to. Both families carry all five rungs;
 * the parameter stays because the builder and the label still ask with the
 * piece's name, and the 双层 family ignores it.
 */
export type RampFamily = 'escalator' | 'stair'

/**
 * The run sizes. `ultra-long` is the 超长 6 m rung on one floor and the 双层
 * 扶梯's 超长 11 m rung on two.
 */
export type RampLength = 'ultra-short' | 'short' | 'medium' | 'long' | 'ultra-long'

export interface RampLengthSpec {
  id: RampLength
  /** Metres of climb between the two landings. */
  rise: number
  /** Cells of horizontal run, landing centre to landing centre, for a stair. */
  run: number
  /** The catalogue key the action tile names the size with. */
  label: MessageKey
}

/** The one-floor family: 2 m to 6 m of climb, shared by the 扶梯 and every 楼梯. */
export const RAMP_LENGTHS: readonly RampLengthSpec[] = [
  { id: 'ultra-short', rise: 2, run: 3, label: 'ultra_short' },
  { id: 'short', rise: 3, run: 5, label: 'short' },
  { id: 'medium', rise: 4, run: 6, label: 'medium' },
  { id: 'long', rise: 5, run: 8, label: 'long' },
  { id: 'ultra-long', rise: 6, run: 9, label: 'ultra_long' },
]

/** The stair's name for the same one-floor family. */
export const STAIR_LENGTHS: readonly RampLengthSpec[] = RAMP_LENGTHS

/** The two-floor family: 双层 扶梯 only, 7 m to 11 m of climb. */
export const DOUBLE_RAMP_LENGTHS: readonly RampLengthSpec[] = [
  { id: 'ultra-short', rise: 7, run: 11, label: 'ultra_short' },
  { id: 'short', rise: 8, run: 12, label: 'short' },
  { id: 'medium', rise: 9, run: 14, label: 'medium' },
  { id: 'long', rise: 10, run: 15, label: 'long' },
  { id: 'ultra-long', rise: 11, run: 17, label: 'ultra_long' },
]

/**
 * The piece a fresh one-floor 扶梯 / 楼梯 is built at **in a five-metre
 * station**: 长, 5 m of climb.
 */
export const RAMP_LENGTH_DEFAULT: RampLength = 'long'

/** A fresh 楼梯 is built at the same 长 5 m the 扶梯 beside it uses. */
export const STAIR_LENGTH_DEFAULT: RampLength = RAMP_LENGTH_DEFAULT

/**
 * The piece a fresh 双层 扶梯 is built at in a five-metre station: 长, 10 m —
 * exactly two storeys, even though the family now runs one metre further.
 */
export const DOUBLE_RAMP_LENGTH_DEFAULT: RampLength = 'long'

/**
 * The family a span builds from, in catalogue order. `family` only matters on one
 * floor: the 双层 family is the 扶梯's own, and a 楼梯 never spans two.
 */
export const TRIPLE_RAMP_LENGTHS: readonly RampLengthSpec[] = DOUBLE_RAMP_LENGTHS.map((s) => ({ ...s, rise: s.rise + 5, run: Math.ceil((s.rise + 5) * 1.5) }))

export function rampSpanOf(rise: number): RampSpan {
  return Math.abs(rise) > 11 ? 'triple' : Math.abs(rise) > 6 ? 'double' : 'single'
}

export function rampLengthsFor(span: RampSpan = 'single', family: RampFamily = 'escalator'): readonly RampLengthSpec[] {
  if (span === 'triple') return TRIPLE_RAMP_LENGTHS
  if (span === 'double') return DOUBLE_RAMP_LENGTHS
  return family === 'stair' ? STAIR_LENGTHS : RAMP_LENGTHS
}

/**
 * The catalogue entry for `id` in `span` and `family`; an id the catalogue cannot
 * spell falls back to that family's default, so an older or newer save still arms
 * a tile. Both one-floor families spell every rung.
 */
export function rampLengthSpec(id: RampLength | undefined, span: RampSpan = 'single', family: RampFamily = 'escalator'): RampLengthSpec {
  const list = rampLengthsFor(span, family)
  return list.find((s) => s.id === id) ?? rampLengthSpec(defaultRampLength(5, span, family), span, family)
}

/** The 楼梯 family's entry for `id` (the same five-rung one-floor family). */
export function stairLengthSpec(id?: RampLength, span: RampSpan = 'single'): RampLengthSpec {
  return rampLengthSpec(id, span, 'stair')
}

/**
 * The length a fresh piece of `span` and `family` is built at when the document
 * names one: the entry closest to the storey it climbs (or to two storeys, for
 * 双层). A new five-metre station arms 长 5 m / 长 10 m.
 */
export function defaultRampLength(_storeyHeight = STOREY_HEIGHT, span: RampSpan = 'single', family: RampFamily = 'escalator'): RampLength {
  if (span === 'double') return DOUBLE_RAMP_LENGTH_DEFAULT
  return family === 'stair' ? STAIR_LENGTH_DEFAULT : RAMP_LENGTH_DEFAULT
}

/**
 * The next length in the span and family's cycle (wraps). The armed id is first
 * resolved into that family, so the tile the player sees is the piece that will
 * be built.
 */
export function nextRampLength(id: RampLength, span: RampSpan = 'single', family: RampFamily = 'escalator'): RampLength {
  const list = rampLengthsFor(span, family)
  const current = rampLengthSpec(id, span, family).id
  const i = list.findIndex((s) => s.id === current)
  return list[(i + 1) % list.length].id
}

/** The name the Tab tile wears for a length: 超短 / 短 / 中 / 长 / 超长. */
export function rampLengthLabel(id: RampLength | undefined, span: RampSpan = 'single', family: RampFamily = 'escalator'): string {
  return msg(rampLengthSpec(id, span, family).label)
}

/**
 * The catalogue entry a **placed** run's span names, read from its endpoints —
 * the way every other property of a loaded piece is read. The rise dominates
 * the comparison, because an escalator's 30° run and a stair's 2:3 run differ
 * for the same length; the nearest entry wins, so the 4 m / 8 m pieces an older
 * save carries come back as 中 / 长 with no flag stored on them, and a span the
 * catalogue never built still arms the closest tile rather than nothing at all.
 */
export function rampLengthOf(rise: number, run: number, span: RampSpan = 'single', family: RampFamily = 'escalator'): RampLength {
  const climb = Math.abs(rise)
  const travel = Math.abs(run)
  const list = rampLengthsFor(span, family)
  let best: RampLength = span === 'double' ? DOUBLE_RAMP_LENGTH_DEFAULT : family === 'stair' ? STAIR_LENGTH_DEFAULT : RAMP_LENGTH_DEFAULT
  let bestError = Infinity
  for (const s of list) {
    const error = Math.abs(s.rise - climb) * 4 + Math.abs(s.run - travel)
    if (error < bestError) {
      bestError = error
      best = s.id
    }
  }
  return best
}
