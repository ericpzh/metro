// Bench (座椅) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { officeChair } from './OfficeChair.ts'
import { omitModelDetail, panelModelDetail, tubeModelDetail, setModelDetail } from '../../modelDetail.ts'
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
  const g = new THREE.Group()
  const model = spec.style === 'steel' ? steelBench(ctx.mats, spec.w)
    : spec.style === 'wood' ? woodBench(ctx.mats, spec.w)
    : spec.style === 'office' ? officeChair(ctx.mats) : seatBench(ctx.mats, spec.w)
  if (spec.style === 'office') model.rotation.z = Math.PI
  g.add(model)
  const [dx, dy] = rotateLocal(mod.rot, (spec.w - 1) / 2, 0)
  // Keep the bench on the opposite edge so its front faces into the tile.
  const edgeInset = 0.5 - 0.85 / 2
  const [ex, ey] = rotateLocal(mod.rot, 0, edgeInset)
  g.position.set(mod.x + 0.5 + dx + ex, mod.y + 0.5 + dy + ey, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  return g
}

/** The stainless platform bench: a seat pan on two posts, with no back. */
function steelBench(mats: ModelMaterials, w: number): THREE.Group {
  const g = new THREE.Group()
  const span = w === 1 ? 0.9 : 1.9
  // Seat pan, with a turned-down front lip over a heavier apron.
  panelModelDetail(slab(g, mats.steel, 0, -0.02, 0.46, span, 0.4, 0.06), 'z')
  omitModelDetail(slab(g, mats.steel, 0, 0.17, 0.4, span, 0.05, 0.14))
  omitModelDetail(slab(g, mats.darkSteel, 0, -0.02, 0.4, span - 0.08, 0.3, 0.03))
  // A post and a floor plate near each end.
  for (const x of [-span / 2 + 0.18, span / 2 - 0.18]) {
    tubeModelDetail(slab(g, mats.steel, x, -0.02, 0.24, 0.07, 0.16, 0.42))
    omitModelDetail(slab(g, mats.darkSteel, x, -0.02, 0.015, 0.16, 0.22, 0.03))
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
    omitModelDetail(slab(g, mats.white, cx, -0.04, 0.4, seatW - 0.08, 0.4, 0.05))
    panelModelDetail(slab(g, mats.trainSeat, cx, -0.04, 0.46, seatW - 0.12, 0.42, 0.08), 'z')
    omitModelDetail(slab(g, mats.white, cx, -0.38, 0.78, seatW - 0.08, 0.05, 0.6))
    panelModelDetail(slab(g, mats.trainSeat, cx, -0.32, 0.78, seatW - 0.12, 0.1, 0.56))
  }
  // A white arm frame at every seat edge, plus a rear top rail tying them together.
  for (let i = 0; i <= seats; i++) {
    const bx = -span / 2 + seatW * i
    tubeModelDetail(slab(g, mats.white, bx, -0.04, 0.24, 0.07, 0.16, 0.44))
    omitModelDetail(slab(g, mats.white, bx, 0.08, 0.64, 0.07, 0.34, 0.06))
    omitModelDetail(slab(g, mats.white, bx, 0.23, 0.57, 0.06, 0.06, 0.14))
    omitModelDetail(slab(g, mats.darkSteel, bx, -0.04, 0.015, 0.14, 0.16, 0.03))
  }
  omitModelDetail(slab(g, mats.white, 0, -0.4, 1.08, span, 0.05, 0.05))
  return g
}

/** Timber slats and rectangular steel end frames. */
function woodBench(mats: ModelMaterials, w: number): THREE.Group {
  const g = new THREE.Group(), span = w - 0.1
  for (let i = 0; i < 5; i++) {
    const slat = slab(g, i % 2 ? mats.wood : mats.woodLight, 0, -0.23 + i * 0.105, 0.46, span, 0.085, 0.055)
    slat.name = 'wood-bench-slat'
    const low = new THREE.BoxGeometry(span, 0.085, 0.055)
    low.setIndex(Array.from(low.index!.array.slice(24, 30))); low.clearGroups()
    setModelDetail(slat, low)
  }
  for (const y of [-0.31, 0.29]) omitModelDetail(slab(g, mats.darkSteel, 0, y, 0.445, span, 0.045, 0.09))
  for (const x of [-span / 2 + 0.07, span / 2 - 0.07]) {
    for (const y of [-0.285, 0.265]) omitModelDetail(slab(g, mats.darkSteel, x, y, 0.235, 0.065, 0.065, 0.43))
    for (const z of [0.035, 0.42]) {
      const rail = slab(g, mats.darkSteel, x, -0.01, z, 0.065, 0.61, 0.07)
      if (z === 0.035) {
        const low = new THREE.BoxGeometry(0.065, 0.61, 0.43).translate(0, 0, 0.18)
        low.setIndex(Array.from(low.index!.array.slice(0, 6))); low.clearGroups()
        setModelDetail(rail, low)
      } else omitModelDetail(rail)
    }
  }
  return g
}

export class BenchModel extends PieceBuilder {
  readonly kind = 'bench'
  build(mod: Extract<Module, { type: 'bench' }>): THREE.Group {
    return buildBench(this.ctx, mod)
  }
}

