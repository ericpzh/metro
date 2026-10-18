// Train cab end (车头) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PieceBuilder, slab, plate } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { boxModelDetail, setModelDetail } from '../../modelDetail.ts'
import type { Stock } from '../../../sim/stock.ts'
import { cabShellGeometry } from './TrainShell.ts'
import { cabSkinGeometry, seatCabFront } from './CabSkin.ts'
import { buildTrainWiper } from './TrainWiper.ts'
import { rakeCabFittings } from './CabRake.ts'

/**
 * One cab end (车头), the assembly the reference photographs show: the silver
 * shell carried on to the nose, the dark face mask with the tall centre
 * windscreen and the two crew-door windows, the red 广州 mark, the twin lamp
 * clusters low at the corners, the marker bars high at the corners, the
 * line-coloured bumper band, the number plates and the coupler hanging under
 * the nose.
 *
 * `nose` is the consist-local x of the end face and `outward` the sign that end
 * faces (+1 for the leading end of a `dirSign >= 0` train). `head` selects the
 * lamps: white head lamps on the end that leads, red tail lamps on the end that
 * trails. Both ends wear the same body.
 */
export function buildCab(g: THREE.Group, mats: ModelMaterials, s: Stock, nose: number, outward: number, head: boolean, livery: THREE.Material = mats.trainTrim): void {
  const firstPart = g.children.length
  const d = outward
  const lamp = head ? mats.headlight : mats.taillight
  const frontParts: Array<{mesh: THREE.Mesh; reference: number; lift: number; scale?: number}> = []
  /** A box `dist` metres out along the nose's own axis, thickness `sx`. */
  const out = (mat: THREE.Material, dist: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh =>
    slab(g, mat, nose + d * dist, y, z, sx, sy, sz)
  const rounded = (mat: THREE.Material, dist: number, y: number, z: number, sx: number, sy: number, sz: number, radius: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 5, radius), mat)
    mesh.position.set(nose + d * dist, y, z)
    // Five-segment rounded boxes are 1,450 triangles each, and a cab carries ten
    // of them. Low keeps the fitting's own envelope (mask, bumper, glazing,
    // housing) as one box: the rounded corners are under a pixel at any distance
    // the camera needs the approximation.
    boxModelDetail(mesh)
    g.add(mesh)
    if (dist > -0.8) frontParts.push({mesh, reference: dist, lift: mat === mats.trainGlass ? .004 : mat === lamp ? .005 : mat === mats.trainDark ? .002 : .001})
    return mesh
  }

  // Shell, roof cap and underframe continue the car's silhouette to the nose.
  const skins = cabSkinGeometry(s.width), lowSkins = cabSkinGeometry(s.width, 1)
  const skinMaterials = [mats.trainBody, mats.trainDark, livery]
  const names = ['cab-shell', 'cab-face-paint', 'cab-livery-paint']
  for (let i = 0; i < skins.length; i++) {
    const mesh = new THREE.Mesh(skins[i], skinMaterials[i])
    mesh.name = names[i]; mesh.rotation.z = d > 0 ? 0 : Math.PI
    mesh.position.set(nose - d * 1.4, 0, 1.82)
    setModelDetail(mesh, lowSkins[i]); g.add(mesh)
  }
  // Unpainted surface used only while seating the flush fittings.
  const referenceShell = new THREE.Mesh(cabShellGeometry(s.width), mats.trainBody)
  referenceShell.rotation.z = d > 0 ? 0 : Math.PI
  referenceShell.position.set(nose - d * 1.4, 0, 1.82)
  out(mats.trainDark, -1, 0, 0.39, 2, 1.25, 0.22)
  // Windows: the tall centre windscreen and the two crew-door windows beside it.
  if (s.cls === 'B') {
    // Guangzhou B: one uninterrupted shield, within the same rounded cab shell.
    const shield = rounded(mats.trainGlass, 0.215, 0, 2.22, 0.04, s.width * 0.74, 1.13, 0.018)
    shield.name = 'b-cab-windscreen'
  } else if (s.cls === 'C') {
    // Two separate panes; the right-hand pane sits in a front evacuation door.
    // Mirror the fittings with the cab's outward axis at the opposite end.
    const doorY = d * s.width * 0.27
    const doorWidth = s.width * 0.24
    rounded(mats.rubber, 0.187, doorY, 2.02, 0.014, doorWidth + 0.07, 1.65, 0.06).name = 'c-cab-front-door-frame'
    rounded(mats.trainDark, 0.19, doorY, 2.02, 0.012, doorWidth, 1.58, 0.045).name = 'c-cab-front-door'
    // Sink the back of each pane into its backing so no daylight shows in profile.
    rounded(mats.trainGlass, 0.195, -d * s.width * 0.205, 2.19, 0.025, s.width * 0.34, 1.08, 0.045).name = 'c-cab-windscreen'
    rounded(mats.trainGlass, 0.201, doorY, 2.17, 0.025, s.width * 0.20, 0.98, 0.045).name = 'c-cab-door-window'
    out(mats.steel, 0.27, doorY + d * doorWidth * 0.35, 1.5, 0.035, 0.035, 0.17).name = 'c-cab-door-handle'
    for (const side of [-1, 1]) {
      rounded(mats.trainGlass, -1.48, side * (s.width / 2 + 0.012), 2.1, 0.66, 0.035, 0.82, 0.06).name = 'c-cab-side-window'
    }
  } else if (s.cls === 'L') {
    const shield = rounded(mats.trainGlass, 0.215, 0, 2.19, 0.04, s.width * 0.75, 1.08, 0.06)
    shield.name = 'l-cab-windscreen'
  } else {
    rounded(mats.trainGlass, 0.2, 0, 2.24, 0.04, s.width * 0.22, 1.08, 0.018)
    for (const wy of [-1, 1]) rounded(mats.trainGlass, 0.215, wy * s.width * 0.27, 2.16, 0.04, s.width * 0.2, 0.94, 0.018)
  }
  // Glazed cab crew doors on both sides, before the first passenger doorway.
  if (s.cls !== 'C') for (const side of [-1, 1]) {
    const prefix = s.cls.toLowerCase()
    const y = side * (s.width / 2 + 0.012)
    rounded(mats.rubber, -1.015, y, 1.66, 0.56, 0.028, 1.80, 0.045).name = `${prefix}-crew-door-frame`
    rounded(mats.trainBody, -1.015, y + side * 0.016, 1.66, 0.505, 0.025, 1.74, 0.035).name = `${prefix}-crew-door`
    rounded(mats.rubber, -1.015, y + side * 0.032, 2.08, 0.49, 0.018, 0.79, 0.05).name = `${prefix}-crew-window-seal`
    rounded(mats.trainGlass, -1.015, y + side * 0.041, 2.08, 0.44, 0.019, 0.74, 0.04).name = `${prefix}-cab-side-window`
    out(mats.steel, -0.82, y + side * 0.058, 1.51, 0.028, 0.04, 0.15).name = `${prefix}-crew-door-handle`
    out(mats.darkSteel, -1.015, y + side * 0.035, 0.77, 0.54, 0.10, 0.035).name = `${prefix}-crew-door-sill`
  }
  // Shared small emblem, centred below the glass and beside C's narrower door.
  const mark = plate(g, mats.trainMark, 0.24, 0.28,
    nose + d * 0.2, 0, 1.43, d > 0 ? Math.PI / 2 : -Math.PI / 2)
  mark.name = `${s.cls.toLowerCase()}-cab-mark`
  frontParts.push({mesh: mark, reference: .2, lift: .004, scale: 1})
  const wiperY = s.cls === 'C' ? -d * s.width * 0.205 : 0
  buildTrainWiper(g, mats, (y, z, lift) => new THREE.Vector3(nose + d * (0.24 + lift), y, z),
    wiperY - d * 0.18, 1.59, wiperY + d * 0.12, 2.12, wiperY + d * 0.18, 2.51)
  // Marker bars high at the corners, sunk in a dark housing.
  for (const wy of [-1, 1]) {
    rounded(mats.trainDark, 0.19, wy * s.width * 0.27, 2.78, 0.08, 0.4, 0.14, 0.035)
    const marker = rounded(lamp, 0.24, wy * s.width * 0.27, 2.78, 0.025, 0.3, 0.065, .012)
    marker.name = 'cab-marker-light'
  }
  // Twin-lens lamp clusters low at the corners.
  for (const wy of [-1, 1]) {
    const cy = wy * s.width * 0.31
    const lightZ = s.cls === 'C' ? .99 : 1.38
    rounded(mats.trainDark, 0.04, cy, lightZ, 0.24, 0.62, s.cls === 'C' ? .22 : .36, 0.10)
    for (const wx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 64), lamp)
      // A cylinder's axis is +y; the cab's outward axis is ±x, so tip it over.
      lens.rotation.z = Math.PI / 2
      lens.position.set(nose + d * 0.18, cy + wx * 0.14, lightZ)
      setModelDetail(lens, new THREE.CylinderGeometry(0.085, 0.085, 0.012, 24))
      lens.name = 'cab-round-light'
      frontParts.push({mesh: lens, reference: .18, lift: .006, scale: 1})
      g.add(lens)
    }
  }
  for (const part of g.children.slice(firstPart) as THREE.Mesh[]) {
    if (part.name.startsWith('cab-wiper-')) frontParts.push({mesh: part, reference: .24, lift: .022, scale: 1})
    if (part.name === 'c-cab-door-handle') frontParts.push({mesh: part, reference: .27, lift: .025, scale: 1})
  }
  for (const {mesh, reference, lift, scale} of frontParts) seatCabFront(mesh, referenceShell, nose, d, reference, lift, scale)
  referenceShell.geometry.dispose()
  const crewPart = (part: THREE.Object3D) => s.cls !== 'C' &&
    (part.name.includes('-crew-') || part.name === `${s.cls.toLowerCase()}-cab-side-window`)
  rakeCabFittings(g.children.slice(firstPart).filter(part=>!crewPart(part)) as THREE.Mesh[], nose, d)
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
  const socketPlate = axial(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 20), mats.black, 0.726, 0.13, 0.35)
  setModelDetail(socketPlate, new THREE.CylinderGeometry(0.09, 0.09, 0.012, 8))
  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), mats.steel)
  socket.rotation.y = Math.PI / 2
  socket.position.set(nose + d * 0.74, 0.13, 0.35)
  setModelDetail(socket, new THREE.TorusGeometry(0.09, 0.018, 4, 8))
  g.add(socket)
  out(mats.black, 0.56, 0, 0.13, 0.22, 0.36, 0.09)
  for (const side of [-1, 1]) {
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(nose - d * 0.1, side * 0.36, 0.48),
      new THREE.Vector3(nose + d * 0.22, side * 0.42, 0.19),
      new THREE.Vector3(nose + d * 0.48, side * 0.31, 0.2),
      new THREE.Vector3(nose + d * 0.56, side * 0.28, 0.35),
    ])
    const hoseMesh = new THREE.Mesh(new THREE.TubeGeometry(hose, 12, 0.023, 6, false), mats.rubber)
    setModelDetail(hoseMesh, new THREE.TubeGeometry(hose, 4, 0.023, 4, false))
    g.add(hoseMesh)
  }
}

export class CabModel extends PieceBuilder {
  readonly kind = 'cab'
  build(g: THREE.Group, s: Stock, nose: number, outward: number, head: boolean): void {
    buildCab(g, this.ctx.mats, s, nose, outward, head)
  }
}

