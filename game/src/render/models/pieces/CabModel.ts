// Train cab end (车头) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PieceBuilder, slab, plate } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Stock } from '../../../sim/stock.ts'
import { cabShellGeometry } from './TrainShell.ts'

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
  const rounded = (mat: THREE.Material, dist: number, y: number, z: number, sx: number, sy: number, sz: number, radius: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 5, radius), mat)
    mesh.position.set(nose + d * dist, y, z)
    g.add(mesh)
    return mesh
  }

  // Shell, roof cap and underframe continue the car's silhouette to the nose.
  const shell = new THREE.Mesh(cabShellGeometry(s.width), mats.trainBody)
  shell.name = 'cab-shell'
  shell.rotation.z = d > 0 ? 0 : Math.PI
  shell.position.set(nose - d * 1.4, 0, 1.82)
  g.add(shell)
  out(mats.trainDark, -1, 0, 0.39, 2, 1.25, 0.22)
  // The dark face mask, proud of the end wall so it reads from any angle.
  rounded(mats.trainDark, -0.16, 0, 2.04, 0.7, faceW, 2.05, 0.32)
  // Cream bumper band under the mask.
  rounded(mats.trainTrim, -0.08, 0, 0.98, 0.38, faceW, 0.3, 0.13)
  // Windows: the tall centre windscreen and the two crew-door windows beside it.
  rounded(mats.trainGlass, 0.2, 0, 2.24, 0.04, s.width * 0.22, 1.08, 0.018)
  for (const wy of [-1, 1]) rounded(mats.trainGlass, 0.215, wy * s.width * 0.27, 2.16, 0.04, s.width * 0.2, 0.94, 0.018)
  // The 广州地铁 mark below the windscreen, in the nose's own plane.
  plate(g, mats.trainMark, 0.46, 0.54, nose + d * 0.2, 0, 1.46, d > 0 ? Math.PI / 2 : -Math.PI / 2)
  // Marker bars high at the corners, sunk in a dark housing.
  for (const wy of [-1, 1]) {
    rounded(mats.trainDark, 0.19, wy * s.width * 0.27, 2.78, 0.08, 0.4, 0.14, 0.035)
    out(lamp, 0.24, wy * s.width * 0.27, 2.78, 0.025, 0.3, 0.065)
  }
  // Twin-lens lamp clusters low at the corners.
  for (const wy of [-1, 1]) {
    const cy = wy * s.width * 0.31
    rounded(mats.trainDark, 0.04, cy, 1.38, 0.24, 0.62, 0.36, 0.11)
    for (const wx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 10), lamp)
      // A cylinder's axis is +y; the cab's outward axis is ±x, so tip it over.
      lens.rotation.z = Math.PI / 2
      lens.position.set(nose + d * 0.18, cy + wx * 0.14, 1.38)
      g.add(lens)
    }
    // Number plate on the skirt corner.
    out(mats.white, 0.05, wy * s.width * 0.33, 0.72, 0.05, 0.32, 0.13)
  }
  // Automatic coupler: drawgear, projecting shaft and a metal head with the
  // separate guide cone / receiving socket visible in the reference (§1.12).
  out(mats.darkSteel, -0.05, 0, 0.32, 0.34, 0.32, 0.2)
  out(mats.steel, 0.26, 0, 0.32, 0.5, 0.16, 0.14)
  rounded(mats.darkSteel, 0.57, 0, 0.34, 0.24, 0.56, 0.32, 0.06)
  out(mats.steel, 0.7, 0, 0.34, 0.035, 0.5, 0.27)
  const axial = (geometry: THREE.BufferGeometry, material: THREE.Material, dist: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.z = -d * Math.PI / 2
    mesh.position.set(nose + d * dist, y, z)
    g.add(mesh)
    return mesh
  }
  axial(new THREE.ConeGeometry(0.105, 0.16, 16), mats.steel, 0.79, -0.13, 0.35)
  axial(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 20), mats.black, 0.726, 0.13, 0.35)
  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), mats.steel)
  socket.rotation.y = Math.PI / 2
  socket.position.set(nose + d * 0.74, 0.13, 0.35)
  g.add(socket)
  out(mats.black, 0.56, 0, 0.13, 0.22, 0.36, 0.09)
  for (const side of [-1, 1]) {
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(nose - d * 0.1, side * 0.36, 0.48),
      new THREE.Vector3(nose + d * 0.22, side * 0.42, 0.19),
      new THREE.Vector3(nose + d * 0.48, side * 0.31, 0.2),
      new THREE.Vector3(nose + d * 0.56, side * 0.28, 0.35),
    ])
    g.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 12, 0.023, 6, false), mats.rubber))
  }
}

export class CabModel extends PieceBuilder {
  readonly kind = 'cab'
  build(g: THREE.Group, s: Stock, nose: number, outward: number, head: boolean): void {
    buildCab(g, this.ctx.mats, s, nose, outward, head)
  }
}

