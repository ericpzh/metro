// Train cab end (车头) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Stock } from '../../../sim/stock.ts'

/**
 * One cab end (车头), the assembly the reference photographs show: the silver
 * shell carried on to the nose, the dark face mask with the tall centre
 * windscreen and the two crew-door windows, the red 广州 mark, the twin lamp
 * clusters low at the corners, the marker bars high at the corners, the cream
 * bumper band and cheek swoosh, the number plates and the coupler hanging under
 * the nose.
 *
 * `nose` is the consist-local x of the end face and `outward` the sign that end
 * faces (+1 for the leading end of a `dirSign >= 0` train). `head` selects the
 * lamps: white head lamps on the end that leads, red tail lamps on the end that
 * trails. Both ends wear the same body.
 */
export function buildCab(g: THREE.Group, mats: ModelMaterials, s: Stock, nose: number, outward: number, head: boolean): void {
  const d = outward
  const lamp = head ? mats.headlight : mats.taillight
  const faceW = s.width * 0.86
  /** A box `dist` metres out along the nose's own axis, thickness `sx`. */
  const out = (mat: THREE.Material, dist: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh =>
    slab(g, mat, nose + d * dist, y, z, sx, sy, sz)

  // Shell, roof cap and underframe continue the car's silhouette to the nose.
  out(mats.trainBody, -1, 0, 1.72, 2, s.width, 2.44)
  out(mats.trainRoof, -1, 0, 3.05, 2, s.width - 0.2, 0.2)
  out(mats.trainDark, -1, 0, 0.42, 2, s.width - 0.1, 0.5)
  // The dark face mask, proud of the end wall so it reads from any angle.
  out(mats.trainDark, -0.03, 0, 1.98, 0.14, faceW, 1.94)
  // Cream bumper band under the mask.
  out(mats.trainTrim, 0.05, 0, 0.98, 0.16, faceW, 0.3)
  // Windows: the tall centre windscreen and the two crew-door windows beside it.
  out(mats.trainGlass, 0.06, 0, 2.24, 0.05, s.width * 0.22, 0.92)
  for (const wy of [-1, 1]) out(mats.trainGlass, 0.06, wy * s.width * 0.3, 2.16, 0.05, s.width * 0.2, 0.76)
  // The 广州地铁 mark below the windscreen, in the nose's own plane.
  plate(g, mats.trainMark, 0.46, 0.54, nose + d * 0.09, 0, 1.46, d > 0 ? Math.PI / 2 : -Math.PI / 2)
  // Marker bars high at the corners, sunk in a dark housing.
  for (const wy of [-1, 1]) {
    out(mats.trainDark, 0.03, wy * s.width * 0.29, 2.78, 0.08, 0.5, 0.16)
    out(lamp, 0.08, wy * s.width * 0.29, 2.78, 0.06, 0.42, 0.09)
  }
  // Twin-lens lamp clusters low at the corners.
  for (const wy of [-1, 1]) {
    const cy = wy * s.width * 0.31
    out(mats.trainDark, 0.04, cy, 1.38, 0.1, 0.62, 0.42)
    for (const wx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 10), lamp)
      // A cylinder's axis is +y; the cab's outward axis is ±x, so tip it over.
      lens.rotation.z = Math.PI / 2
      lens.position.set(nose + d * 0.1, cy + wx * 0.14, 1.38)
      g.add(lens)
    }
    // Number plate on the skirt corner.
    out(mats.white, 0.05, wy * s.width * 0.33, 0.72, 0.05, 0.32, 0.13)
  }
  // Coupler hanging under the nose.
  out(mats.darkSteel, 0.3, 0, 0.42, 0.5, 0.6, 0.46)
  out(mats.gateRed, 0.45, 0, 0.45, 0.12, 0.34, 0.26)
}

export class CabModel extends PieceBuilder {
  readonly kind = 'cab'
  build(g: THREE.Group, s: Stock, nose: number, outward: number, head: boolean): void {
    buildCab(g, this.ctx.mats, s, nose, outward, head)
  }
}

