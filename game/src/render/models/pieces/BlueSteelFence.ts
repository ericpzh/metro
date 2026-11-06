import * as THREE from 'three'
import { fenceTube, ownedMaterial, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import type { FenceArms } from '../../../sim/fences.ts'
import { omitModelDetail, panelModelDetail } from '../../modelDetail.ts'

/** Powder-coated steel construction fencing: framed mesh above a solid kick panel. */
export function drawBlueSteelFence(g: THREE.Group, ctx: ModuleContext, arms: FenceArms): void {
  const blue = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: 0x175585, metalness: 0.7, roughness: 0.43 }))
  const { x0, x1, y0, y1, capE, capW, capN, capS } = arms
  const rail = (a: number, b: number, alongY: boolean): void => {
    const at = (s: number, z: number): [number, number, number] => alongY ? [0, s, z] : [s, 0, z]
    for (const z of [0.06, 0.72, 1.975]) fenceTube(g, blue, at(a, z), at(b, z), 0.025)
    const mid = (a + b) / 2
    panelModelDetail(slab(g, blue, alongY ? 0 : mid, alongY ? mid : 0, 0.39,
      alongY ? 0.018 : b - a, alongY ? b - a : 0.018, 0.6), alongY ? 'x' : 'y')
    // Clip both diagonal wire families to each arm, including corner half-panels.
    const bottom = 0.75, top = 1.95
    for (const slope of [-1, 1]) {
      for (let intercept = bottom - b - 2; intercept <= top + b + 2; intercept += 0.14) {
        const lo = Math.max(a + 0.006, slope > 0 ? bottom - intercept : intercept - top)
        const hi = Math.min(b - 0.006, slope > 0 ? top - intercept : intercept - bottom)
        if (hi - lo < 0.001) continue
        omitModelDetail(fenceTube(g, blue, at(lo, slope * lo + intercept), at(hi, slope * hi + intercept), 0.004), true)
      }
    }
  }
  if (x1 > x0) rail(x0, x1, false)
  if (y1 > y0) rail(y0, y1, true)
  const post = (x: number, y: number): void => {
    slab(g, blue, x, y, 1, 0.045, 0.045, 2)
    slab(g, blue, x, y, 0.015, 0.08, 0.08, 0.03)
  }
  post(0, 0)
  if (capE) post(0.46, 0)
  if (capW) post(-0.46, 0)
  if (capN) post(0, 0.46)
  if (capS) post(0, -0.46)
}
