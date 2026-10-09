// Escalators (扶梯) — GAME-SPEC §5.1 / §7.8.
//
// An escalator is fixed-length equipment: 短 rises 4 m over a 6 m run;
// 长 rises 8 m over a 12 m run along its placement rotation.
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
import { STAIR_RISE, STAIR_RUN, stairFacing } from './stairs.ts'
import { ESCALATOR_BAND, ESCALATOR_BALUSTRADE, ESCALATOR_SKIRT_INSET, ESCALATOR_TRANSITION_LENGTH } from './constants.ts'

type Escalator = Extract<Module, { type: 'escalator' }>

/** Level treads follow a smooth bend into each flat landing (§5.1), then return under the comb. */
export function escalatorStepHeight(along: number, len: number, risePerM: number, horizontalPerM: number): number {
  const bend = Math.min(ESCALATOR_TRANSITION_LENGTH / horizontalPerM, len / 4)
  const bottom = (u: number): number => u <= -bend ? 0 : u < bend ? risePerM * (u + bend) ** 2 / (4 * bend) : risePerM * u
  return along <= len / 2 ? bottom(along) : len * risePerM - bottom(len - along)
}

/** Clear moving band and glass spacing; the wide piece adds one whole block (§5.1). */
export function escalatorBandWidth(m: Escalator): number {
  return ESCALATOR_BAND + (m.cfg.width === 2 ? 1 : 0) - 2 * ESCALATOR_SKIRT_INSET
}

export function escalatorBalustradeWidth(m: Escalator): number {
  return escalatorBodyWidth(m) - 2 * ESCALATOR_SKIRT_INSET
}

/** The metal casing retains the original envelope while the glass moves inward. */
export function escalatorBodyWidth(m: Escalator): number {
  return ESCALATOR_BALUSTRADE + (m.cfg.width === 2 ? 1 : 0)
}

/** The body is centred between its two cells; graph endpoints stay on integer cells. */
export function escalatorRun(m: Escalator): { from: Vec3i; to: Vec3i } {
  const lower = m.from.z < m.to.z ? m.from : m.to
  const upper = m.from.z < m.to.z ? m.to : m.from
  const len = Math.hypot(upper.x - lower.x, upper.y - lower.y)
  const half = m.cfg.width === 2 && len > 0 ? 0.5 / len : 0
  const dx = (upper.y - lower.y) * half
  const dy = -(upper.x - lower.x) * half
  const shift = (p: Vec3i): Vec3i => ({ x: p.x + dx, y: p.y + dy, z: p.z })
  return { from: shift(m.from), to: shift(m.to) }
}

/** All floor cells supporting the two ends of this single piece. */
export function escalatorLandings(m: Escalator): Vec3i[] {
  if (m.cfg.width !== 2) return [m.from, m.to]
  const run = escalatorRun(m)
  const dx = 2 * (run.from.x - m.from.x)
  const dy = 2 * (run.from.y - m.from.y)
  return [m.from, m.to, ...[m.from, m.to].map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }))]
}

/** Cells of horizontal run for one storey (the equipment's fixed length). */
export const ESCALATOR_RUN = STAIR_RUN
/** Blocks of climb for one storey. */
export const ESCALATOR_RISE = STAIR_RISE

/** 长 spans two 4 m storeys at the short piece's slope (§5.1). */
export const ESCALATOR_LONG_RISE = 2 * ESCALATOR_RISE
export const ESCALATOR_LONG_RUN = 2 * ESCALATOR_RUN

/** Endpoints are authoritative, including pieces loaded from older saves. */
export function escalatorIsLong(m: Escalator): boolean {
  return Math.abs(m.to.z - m.from.z) === ESCALATOR_LONG_RISE
}

export type EscalatorDir = 'up' | 'down'

/** The other travel direction, cycled with Tab. */
export function nextEscalatorDir(dir: EscalatorDir): EscalatorDir {
  return dir === 'up' ? 'down' : 'up'
}

/**
 * `base` is the lower landing. 短 climbs one storey along `rot`; 长 climbs two.
 * `dir` orders `from`/`to` (up: base → top, down: top → base) without moving the
 * run, so up and down share one footprint.
 */
export function escalatorModule(base: Vec3i, rot: number, dir: EscalatorDir, id: string, width: 1 | 2 = 1, long = false): Module {
  const [dx, dy] = stairFacing(rot)
  const run = long ? ESCALATOR_LONG_RUN : ESCALATOR_RUN
  const rise = long ? ESCALATOR_LONG_RISE : ESCALATOR_RISE
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
