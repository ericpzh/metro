import { msg, type MessageKey } from './i18n.ts'
import { STOREY_HEIGHT } from './constants.ts'
// The fixed lengths a run comes in — 扶梯 (escalator), 单跑楼梯 (straight stair)
// and every turning stair — GAME-SPEC §5.1.
//
// A run is fixed equipment: it climbs `rise` metres over `run` cells of
// horizontal travel, and both ends land on the block grid. The **endpoints are
// authoritative** (`escalatorModule` / `stairFlightsFor` write them), so a piece
// loaded from an older save reads its length back from its span and no `cfg`
// flag has to be migrated.
//
// The catalogue is measured in **metres of climb**, and comes in three families:
//
//   single floor (扶梯):        超短 2, 短 3, 中 4, 长 5 m
//   single floor (every 楼梯):  超短 2, 短 3, 中 4, 长 5, 超长 6 m
//   double floor (扶梯 only):   超短 6, 短 7, 中 8, 长 9, 超长 10 m
//
// The single-floor family fills the station's storey: a five-metre station's
// one-storey run is 长 5 m, the default a fresh piece is built at. A **stair**
// climbs one metre further than its 扶梯 twin: 超长 6 m is one metre above 长 and
// serves the uneven floors the 电梯 already spans (a six-metre mezzanine), while
// a 单层 扶梯 stops at 长 — six metres of escalator climb is the 双层 超短 piece,
// and one 30° run cannot be both.
//
// `run` is the **stair's** catalogue run: the 2:3 slope the reference staircase
// has always had (2 m over 3 m … 6 m over 9 m), rounded up to whole cells so
// both ends stay on the block grid. The escalator is laid at a strict 30° inside
// those integer landings (`escalatorLengthSpec`), so two pieces of one length
// climb the same metres while their horizontal runs differ.
//
// Pure data — no three, no DOM.

/** Which family a run's rise comes from: one floor, or two. */
export type RampSpan = 'single' | 'double'

/**
 * Which piece a one-floor length belongs to. Only a 楼梯 grows the 超长 rung; the
 * 扶梯's one-floor family stops at 长 and its second family is 双层.
 */
export type RampFamily = 'escalator' | 'stair'

/**
 * The run sizes. `ultra-long` is the 楼梯's 超长 6 m rung on one floor, and the
 * 双层 扶梯's 超长 10 m rung on two.
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

/** The one-floor 扶梯 family: 2 m to 5 m of climb. */
export const RAMP_LENGTHS: readonly RampLengthSpec[] = [
  { id: 'ultra-short', rise: 2, run: 3, label: 'ultra_short' },
  { id: 'short', rise: 3, run: 5, label: 'short' },
  { id: 'medium', rise: 4, run: 6, label: 'medium' },
  { id: 'long', rise: 5, run: 8, label: 'long' },
]

/**
 * The one-floor stair family: every 扶梯 size plus 超长 6 m, one metre above 长.
 * A 扶梯 never takes this rung — its 6 m run is the 双层 超短 piece.
 */
export const STAIR_LENGTHS: readonly RampLengthSpec[] = [
  ...RAMP_LENGTHS,
  { id: 'ultra-long', rise: 6, run: 9, label: 'ultra_long' },
]

/** The two-floor family: 双层 扶梯 only, 6 m to 10 m of climb. */
export const DOUBLE_RAMP_LENGTHS: readonly RampLengthSpec[] = [
  { id: 'ultra-short', rise: 6, run: 9, label: 'ultra_short' },
  { id: 'short', rise: 7, run: 11, label: 'short' },
  { id: 'medium', rise: 8, run: 12, label: 'medium' },
  { id: 'long', rise: 9, run: 14, label: 'long' },
  { id: 'ultra-long', rise: 10, run: 15, label: 'ultra_long' },
]

/**
 * The piece a fresh one-floor 扶梯 / 楼梯 is built at **in a five-metre
 * station**: 长, 5 m of climb.
 */
export const RAMP_LENGTH_DEFAULT: RampLength = 'long'

/** A fresh 楼梯 is built at the same 长 5 m the 扶梯 beside it uses. */
export const STAIR_LENGTH_DEFAULT: RampLength = RAMP_LENGTH_DEFAULT

/** The piece a fresh 双层 扶梯 is built at in a five-metre station: 超长, 10 m. */
export const DOUBLE_RAMP_LENGTH_DEFAULT: RampLength = 'ultra-long'

/**
 * The family a span builds from, in catalogue order. `family` only matters on one
 * floor: the 双层 family is the 扶梯's own, and a 楼梯 never spans two.
 */
export function rampLengthsFor(span: RampSpan = 'single', family: RampFamily = 'escalator'): readonly RampLengthSpec[] {
  if (span === 'double') return DOUBLE_RAMP_LENGTHS
  return family === 'stair' ? STAIR_LENGTHS : RAMP_LENGTHS
}

/**
 * The catalogue entry for `id` in `span` and `family`; an id that family cannot
 * spell falls back to its default. A 扶梯 asked for the 楼梯's 超长 therefore
 * builds 长 5 m, and a 楼梯 asked for a 双层 id builds 长 too.
 */
export function rampLengthSpec(id: RampLength | undefined, span: RampSpan = 'single', family: RampFamily = 'escalator'): RampLengthSpec {
  const list = rampLengthsFor(span, family)
  return list.find((s) => s.id === id) ?? rampLengthSpec(defaultRampLength(5, span, family), span, family)
}

/** The 楼梯 family's entry for `id`; the one-floor sizes plus 超长 6 m. */
export function stairLengthSpec(id?: RampLength): RampLengthSpec {
  return rampLengthSpec(id, 'single', 'stair')
}

/**
 * The length a fresh piece of `span` and `family` is built at when the document
 * names one: the entry closest to the storey it climbs (or to two storeys, for
 * 双层). A new five-metre station arms 长 5 m / 超长 10 m.
 */
export function defaultRampLength(_storeyHeight = STOREY_HEIGHT, span: RampSpan = 'single', family: RampFamily = 'escalator'): RampLength {
  if (span === 'double') return DOUBLE_RAMP_LENGTH_DEFAULT
  return family === 'stair' ? STAIR_LENGTH_DEFAULT : RAMP_LENGTH_DEFAULT
}

/**
 * The next length in the span and family's cycle (wraps). The armed id is first
 * resolved into that family, so a 楼梯's 超长 arms an 扶梯 as 长 before it wraps
 * to 超短 — the tile the player sees is the piece the escalator will build.
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
