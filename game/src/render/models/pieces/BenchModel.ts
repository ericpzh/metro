// Bench (座椅) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModelMaterials, ModuleContext } from '../PieceBuilder.ts'
import { benchSpec } from '../../../sim/benches.ts'
import { normRot, rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/* ----------------------------------------------------------------- bench */

/**
 * Bench (座椅, 装饰): one of the `sim/benches.ts` variants. The `steel` family is
 * the platform bench — a stainless seat pan on two posts with no back — while
 * the `seat` family is an upholstered seat with a back and arm rests that chains
 * into a row (a 2 m bench is two seats sharing a middle arm). Both run along
 * local +x with their back on the local −y side, so a run tiles against a
 * platform wall and the placement rotation turns the whole piece. The group is
 * placed at the run's centre, so a two-cell bench spans both of its cells.
 */
function buildBench(ctx: ModuleContext, mod: Extract<Module, { type: 'bench' }>): THREE.Group {
  const spec = benchSpec(mod.cfg.variant)
  const g = spec.style === 'steel' ? steelBench(ctx.mats, spec.w) : seatBench(ctx.mats, spec.w)
  const [dx, dy] = rotateLocal(mod.rot, (spec.w - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  return g
}

/** The stainless platform bench: a seat pan on two posts, with no back. */
function steelBench(mats: ModelMaterials, w: number): THREE.Group {
  const g = new THREE.Group()
  const span = w === 1 ? 0.9 : 1.9
  // Seat pan, with a turned-down front lip over a heavier apron.
  slab(g, mats.steel, 0, -0.02, 0.46, span, 0.4, 0.06)
  slab(g, mats.steel, 0, 0.17, 0.4, span, 0.05, 0.14)
  slab(g, mats.darkSteel, 0, -0.02, 0.4, span - 0.08, 0.3, 0.03)
  // A post and a floor plate near each end.
  for (const x of [-span / 2 + 0.18, span / 2 - 0.18]) {
    slab(g, mats.steel, x, -0.02, 0.24, 0.07, 0.16, 0.42)
    slab(g, mats.darkSteel, x, -0.02, 0.015, 0.16, 0.22, 0.03)
  }
  return g
}

/** The upholstered seat: a blue cushion and back on a white frame, one per metre. */
function seatBench(mats: ModelMaterials, w: number): THREE.Group {
  const g = new THREE.Group()
  const seats = w
  const span = w === 1 ? 0.9 : 1.9
  const seatW = span / seats
  // A blue cushion and back for each seat, so a 2 m piece reads as two chained seats.
  for (let s = 0; s < seats; s++) {
    const cx = -span / 2 + seatW * (s + 0.5)
    slab(g, mats.white, cx, -0.04, 0.4, seatW - 0.08, 0.4, 0.05)
    slab(g, mats.trainSeat, cx, -0.04, 0.46, seatW - 0.12, 0.42, 0.08)
    slab(g, mats.white, cx, -0.38, 0.78, seatW - 0.08, 0.05, 0.6)
    slab(g, mats.trainSeat, cx, -0.32, 0.78, seatW - 0.12, 0.1, 0.56)
  }
  // A white arm frame at every seat edge, plus a rear top rail tying them together.
  for (let i = 0; i <= seats; i++) {
    const bx = -span / 2 + seatW * i
    slab(g, mats.white, bx, -0.04, 0.24, 0.07, 0.16, 0.44)
    slab(g, mats.white, bx, 0.08, 0.64, 0.07, 0.34, 0.06)
    slab(g, mats.white, bx, 0.23, 0.57, 0.06, 0.06, 0.14)
    slab(g, mats.darkSteel, bx, -0.04, 0.015, 0.14, 0.16, 0.03)
  }
  slab(g, mats.white, 0, -0.4, 1.08, span, 0.05, 0.05)
  return g
}

export class BenchModel extends PieceBuilder {
  readonly kind = 'bench'
  build(mod: Extract<Module, { type: 'bench' }>): THREE.Group {
    return buildBench(this.ctx, mod)
  }
}

