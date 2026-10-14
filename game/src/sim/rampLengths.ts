import { msg, type MessageKey } from './i18n.ts'
// The fixed lengths a straight run comes in — 扶梯 (escalator) and 单跑楼梯
// (single-run stair) — GAME-SPEC §5.1.
//
// A run is fixed equipment: it climbs `rise` blocks over `run` cells of
// horizontal travel, and both ends land on the block grid. The **endpoints are
// authoritative** (`escalatorModule` / `stairFlightsFor` write them), so a piece
// loaded from an older save reads its length back from its span and no `cfg`
// flag has to be migrated: 中 and 长 *are* the original 4 m / 8 m pieces, only
// renamed when the family grew its two shorter sizes.
//
// 中 and 长 keep the catalogue slope 2:3 the reference escalator has always had
// (`test/ramp-join.test.mjs` derives its caps from 6 / 4). Every length wants that
// same slope, but a run may not land between blocks, and 3 m of climb wants 4.5
// cells of run. The rounding therefore goes **up**, to five cells: 31.0°, a
// shallower escalator than the 33.7° reference rather than a steeper one — four
// cells would be 36.9°, past the 35° a real escalator is built at.
//
// Pure data — no three, no DOM. The four pieces, and what the tile reads:
//
//   超短 ultra-short   rises 2 m over a 3 m run — half a storey, a short hop
//   短   short         rises 3 m over a 5 m run — three quarters of a storey
//   中   medium        rises 4 m over a 6 m run — one storey, the shipped piece
//   长   long          rises 8 m over a 12 m run — two storeys, at 中's slope

export type RampLength = 'ultra-short' | 'short' | 'medium' | 'long'

export interface RampLengthSpec {
  id: RampLength
  /** Blocks (metres) of climb between the two landings. */
  rise: number
  /** Cells of horizontal run, landing centre to landing centre. */
  run: number
  /** The catalogue key the action tile names the size with. */
  label: MessageKey
}

export const RAMP_LENGTHS: readonly RampLengthSpec[] = [
  { id: 'ultra-short', rise: 2, run: 3, label: 'ultra_short' },
  { id: 'short', rise: 3, run: 5, label: 'short' },
  { id: 'medium', rise: 4, run: 6, label: 'medium' },
  { id: 'long', rise: 8, run: 12, label: 'long' },
]

/** The piece a fresh 扶梯 / 单跑楼梯 is built at: one storey, 4 m over 6 cells. */
export const RAMP_LENGTH_DEFAULT: RampLength = 'medium'

/** The catalogue entry for `id`; an id a save cannot spell falls back to 中. */
export function rampLengthSpec(id: RampLength | undefined): RampLengthSpec {
  return RAMP_LENGTHS.find((s) => s.id === id) ?? RAMP_LENGTHS[2]
}

/** The next length the action tile cycles to (超短 → 短 → 中 → 长 → 超短). */
export function nextRampLength(id: RampLength): RampLength {
  const i = RAMP_LENGTHS.findIndex((s) => s.id === id)
  return RAMP_LENGTHS[(i + 1) % RAMP_LENGTHS.length].id
}

/** The name the Tab tile wears for a length: 超短 / 短 / 中 / 长. */
export function rampLengthLabel(id: RampLength | undefined): string {
  return msg(rampLengthSpec(id).label)
}

/**
 * The catalogue entry a **placed** run's span names, read from its endpoints —
 * the way every other property of a loaded piece is read. The nearest entry wins
 * by rise and run together, so the 4 m / 8 m pieces an older save carries come
 * back as 中 / 长 with no flag stored on them, and a span the catalogue never
 * built (an off-grid run a save predates) still arms the closest tile rather than
 * nothing at all.
 */
export function rampLengthOf(rise: number, run: number): RampLength {
  const span = Math.abs(rise)
  const travel = Math.abs(run)
  let best: RampLength = RAMP_LENGTH_DEFAULT
  let bestError = Infinity
  for (const s of RAMP_LENGTHS) {
    const error = Math.abs(s.rise - span) + Math.abs(s.run - travel)
    if (error < bestError) {
      bestError = error
      best = s.id
    }
  }
  return best
}
