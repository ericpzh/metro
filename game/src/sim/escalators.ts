// Escalators (扶梯) — GAME-SPEC §5.1 / §7.8.
//
// An escalator is fixed-length equipment, and it comes in the four lengths of
// `sim/rampLengths.ts`: 超短 rises 2 m over a 3 m run, 短 3 m over 5 m, 中 4 m over
// 6 m — the one-storey piece the game shipped with — and 长 8 m over 12 m. All
// four run along the placement rotation at the catalogue slope.
// `dir` only orders `from`/`to` — the single
// one-way travel the sim and the label read — so an up and a down piece share
// one footprint.
//
// This is the *one* definition of a pre-placed escalator. The builder
// (`build/model.ts`, the 扶梯 button) and the reference station
// (`data/reference-station.ts`, the demo's pre-placed runs) both build from it,
// so the demo re-uses the equipment's exact piece and dimensions. Pure data —
// no three, no DOM.

import type { Module, Vec3i } from './types.ts'
import { RAMP_LENGTH_DEFAULT, rampLengthOf, rampLengthSpec, type RampLength } from './rampLengths.ts'
import { STAIR_RISE, STAIR_RUN, stairFacing } from './stairs.ts'
import { ESCALATOR_BAND, ESCALATOR_BALUSTRADE, ESCALATOR_SKIRT_INSET, ESCALATOR_TRANSITION_LENGTH } from './constants.ts'

type Escalator = Extract<Module, { type: 'escalator' }>

/**
 * The pieces that share the escalator's run geometry: the escalator itself and
 * the flat 自动步道 (`sim/walkways.ts`), which is the same piece with no climb.
 * Every function below that reads only `from`/`to`/`cfg.width` — the band and
 * body widths, the run's centring shift and the landings — takes one of these,
 * so the walkway renders and carves with the escalator's own numbers.
 */
type RampPiece = Escalator | Extract<Module, { type: 'walkway' }>

/** Level treads follow a smooth bend into each flat landing (§5.1), then return under the comb. */
export function escalatorStepHeight(along: number, len: number, risePerM: number, horizontalPerM: number): number {
  const bend = Math.min(ESCALATOR_TRANSITION_LENGTH / horizontalPerM, len / 4)
  const bottom = (u: number): number => u <= -bend ? 0 : u < bend ? risePerM * (u + bend) ** 2 / (4 * bend) : risePerM * u
  return along <= len / 2 ? bottom(along) : len * risePerM - bottom(len - along)
}

/** Clear moving band and glass spacing; the wide piece adds one whole block (§5.1). */
export function escalatorBandWidth(m: RampPiece): number {
  return ESCALATOR_BAND + (m.cfg.width === 2 ? 1 : 0) - 2 * ESCALATOR_SKIRT_INSET
}

export function escalatorBalustradeWidth(m: RampPiece): number {
  return escalatorBodyWidth(m) - 2 * ESCALATOR_SKIRT_INSET
}

/** The metal casing retains the original envelope while the glass moves inward. */
export function escalatorBodyWidth(m: RampPiece): number {
  return ESCALATOR_BALUSTRADE + (m.cfg.width === 2 ? 1 : 0)
}

/**
 * The body is centred between its two cells; graph endpoints stay on integer cells.
 *
 * The centring shift is derived from the run's **low → high** order, which is the
 * climb direction for a ramp. A **level** run (a walkway) has no `z` to order by,
 * so the tie is broken on the plan position: without that, an up and a down
 * walkway would shift to opposite sides of their own cells and one of the pair
 * would sit a block off its landings.
 */
export function escalatorRun(m: RampPiece): { from: Vec3i; to: Vec3i } {
  const lowerFirst = m.from.z !== m.to.z
    ? m.from.z < m.to.z
    : m.from.x !== m.to.x
      ? m.from.x < m.to.x
      : m.from.y < m.to.y
  const lower = lowerFirst ? m.from : m.to
  const upper = lowerFirst ? m.to : m.from
  const len = Math.hypot(upper.x - lower.x, upper.y - lower.y)
  const half = m.cfg.width === 2 && len > 0 ? 0.5 / len : 0
  const dx = (upper.y - lower.y) * half
  const dy = -(upper.x - lower.x) * half
  const shift = (p: Vec3i): Vec3i => ({ x: p.x + dx, y: p.y + dy, z: p.z })
  return { from: shift(m.from), to: shift(m.to) }
}

/** All floor cells supporting the two ends of this single piece. */
export function escalatorLandings(m: RampPiece): Vec3i[] {
  if (m.cfg.width !== 2) return [m.from, m.to]
  const run = escalatorRun(m)
  const dx = 2 * (run.from.x - m.from.x)
  const dy = 2 * (run.from.y - m.from.y)
  return [m.from, m.to, ...[m.from, m.to].map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }))]
}

/** Cells of horizontal run for one storey — the 中 piece (`sim/rampLengths.ts`). */
export const ESCALATOR_RUN = STAIR_RUN
/** Blocks of climb for one storey. */
export const ESCALATOR_RISE = STAIR_RISE

/** Endpoints are authoritative, including pieces loaded from older saves. */
export function escalatorLength(m: Escalator): RampLength {
  return rampLengthOf(m.to.z - m.from.z, Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y))
}

export type EscalatorDir = 'up' | 'down'

/** The other travel direction, cycled with Tab. */
export function nextEscalatorDir(dir: EscalatorDir): EscalatorDir {
  return dir === 'up' ? 'down' : 'up'
}

/**
 * `base` is the lower landing, and `length` the piece's size — 超短 2 m over 3 m
 * through 长 8 m over 12 m (`sim/rampLengths.ts`), 中 by default.
 * `dir` orders `from`/`to` (up: base → top, down: top → base) without moving the
 * run, so up and down share one footprint.
 */
export function escalatorModule(base: Vec3i, rot: number, dir: EscalatorDir, id: string, width: 1 | 2 = 1, length: RampLength = RAMP_LENGTH_DEFAULT): Module {
  const [dx, dy] = stairFacing(rot)
  const { run, rise } = rampLengthSpec(length)
  const lower: Vec3i = { x: base.x, y: base.y, z: base.z }
  const upper: Vec3i = {
    x: base.x + dx * run,
    y: base.y + dy * run,
    z: base.z + rise,
  }
  const up = dir !== 'down'
  return {
    id,
    type: 'escalator',
    x: base.x,
    y: base.y,
    z: base.z,
    rot,
    from: up ? lower : upper,
    to: up ? upper : lower,
    cfg: { dir: up ? 'up' : 'down', ...(width === 2 ? { width } : {}) },
  }
}
