// Escalators (扶梯) — GAME-SPEC §5.1 / §7.8.
//
// An escalator is fixed-length equipment, exactly like a straight stair: it
// climbs one storey over `ESCALATOR_RUN` cells along its placement rotation,
// rising `ESCALATOR_RISE` blocks. `dir` only orders `from`/`to` — the single
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

/** Cells of horizontal run for one storey (the equipment's fixed length). */
export const ESCALATOR_RUN = STAIR_RUN
/** Blocks of climb for one storey. */
export const ESCALATOR_RISE = STAIR_RISE

export type EscalatorDir = 'up' | 'down'

/** The other travel direction, cycled with Tab. */
export function nextEscalatorDir(dir: EscalatorDir): EscalatorDir {
  return dir === 'up' ? 'down' : 'up'
}

/**
 * The one escalator piece. `base` is the cell it is dropped on: the lower
 * landing, and it climbs `ESCALATOR_RUN` cells along `rot` to the storey above.
 * `dir` orders `from`/`to` (up: base → top, down: top → base) without moving the
 * run, so up and down share one footprint.
 */
export function escalatorModule(base: Vec3i, rot: number, dir: EscalatorDir, id: string): Module {
  const [dx, dy] = stairFacing(rot)
  const lower: Vec3i = { x: base.x, y: base.y, z: base.z }
  const upper: Vec3i = {
    x: base.x + dx * ESCALATOR_RUN,
    y: base.y + dy * ESCALATOR_RUN,
    z: base.z + ESCALATOR_RISE,
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
    cfg: { dir: up ? 'up' : 'down' },
  }
}
