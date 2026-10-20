import { msg, type MessageKey } from './i18n.ts'
// The fixed lengths a run comes in — 扶梯 (escalator), 单跑楼梯 (straight stair)
// and every turning stair — GAME-SPEC §5.1.
//
// A run is fixed equipment: it climbs `rise` metres over `run` cells of
// horizontal travel, and both ends land on the block grid. The **endpoints are
// authoritative** (`escalatorModule` / `stairFlightsFor` write them), so a piece
// loaded from an older save reads its length back from its span and no `cfg`
// flag has to be migrated.
//
// The catalogue is measured in **metres of climb**, and comes in two families:
//
//   single floor (扶梯 and every stair): 超短 2, 短 3, 中 4, 长 5 m
//   double floor (扶梯 only):          超短 6, 短 7, 中 8, 长 9, 超长 10 m
//
// The single-floor family fills the station's storey: a five-metre station's
// one-storey run is 长 5 m, the default a fresh piece is built at.
//
// `run` is the **stair's** catalogue run: the 2:3 slope the reference staircase
// has always had (2 m over 3 m … 10 m over 15 m), rounded up to whole cells so
// both ends stay on the block grid. The escalator is laid at a strict 30° inside
// those integer landings (`escalatorLengthSpec`), so two pieces of one length
// climb the same metres while their horizontal runs differ.
//
// Pure data — no three, no DOM.

/** Which family a run's rise comes from: one floor, or two. */
export type RampSpan = 'single' | 'double'

/**
 * The run sizes. `ultra-long` belongs to the double-floor family alone; the
 * single-floor family stops at 长 5 m.
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

/** The one-floor family: every 扶梯 and every 楼梯, 2 m to 5 m of climb. */
export const RAMP_LENGTHS: readonly RampLengthSpec[] = [
  { id: 'ultra-short', rise: 2, run: 3, label: 'ultra_short' },
  { id: 'short', rise: 3, run: 5, label: 'short' },
  { id: 'medium', rise: 4, run: 6, label: 'medium' },
  { id: 'long', rise: 5, run: 8, label: 'long' },
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

/** The piece a fresh 双层 扶梯 is built at in a five-metre station: 超长, 10 m. */
export const DOUBLE_RAMP_LENGTH_DEFAULT: RampLength = 'ultra-long'

/** The family a span builds from, in catalogue order. */
export function rampLengthsFor(span: RampSpan = 'single'): readonly RampLengthSpec[] {
  return span === 'double' ? DOUBLE_RAMP_LENGTHS : RAMP_LENGTHS
}

/** The catalogue entry for `id` in `span`; an id that span cannot spell falls back to its default. */
export function rampLengthSpec(id: RampLength | undefined, span: RampSpan = 'single'): RampLengthSpec {
  const family = rampLengthsFor(span)
  return family.find((s) => s.id === id) ?? rampLengthSpec(span === 'double' ? DOUBLE_RAMP_LENGTH_DEFAULT : RAMP_LENGTH_DEFAULT, span)
}

/**
 * The length a fresh piece of `span` is built at when the document names one:
 * the entry closest to the storey it climbs (or to two storeys, for 双层). A new
 * five-metre station arms 长 5 m / 超长 10 m.
 */
export function defaultRampLength(_storeyHeight = 5, span: RampSpan = 'single'): RampLength {
  return span === 'double' ? DOUBLE_RAMP_LENGTH_DEFAULT : RAMP_LENGTH_DEFAULT
}

/** The next length in the span's cycle (wraps). */
export function nextRampLength(id: RampLength, span: RampSpan = 'single'): RampLength {
  const family = rampLengthsFor(span)
  const i = family.findIndex((s) => s.id === id)
  return family[(i + 1) % family.length].id
}

/** The name the Tab tile wears for a length: 超短 / 短 / 中 / 长 / 超长. */
export function rampLengthLabel(id: RampLength | undefined, span: RampSpan = 'single'): string {
  return msg(rampLengthSpec(id, span).label)
}

/**
 * The catalogue entry a **placed** run's span names, read from its endpoints —
 * the way every other property of a loaded piece is read. The rise dominates
 * the comparison, because an escalator's 30° run and a stair's 2:3 run differ
 * for the same length; the nearest entry wins, so the 4 m / 8 m pieces an older
 * save carries come back as 中 / 长 with no flag stored on them, and a span the
 * catalogue never built still arms the closest tile rather than nothing at all.
 */
export function rampLengthOf(rise: number, run: number, span: RampSpan = 'single'): RampLength {
  const climb = Math.abs(rise)
  const travel = Math.abs(run)
  const family = rampLengthsFor(span)
  let best: RampLength = span === 'double' ? DOUBLE_RAMP_LENGTH_DEFAULT : RAMP_LENGTH_DEFAULT
  let bestError = Infinity
  for (const s of family) {
    const error = Math.abs(s.rise - climb) * 4 + Math.abs(s.run - travel)
    if (error < bestError) {
      bestError = error
      best = s.id
    }
  }
  return best
}
