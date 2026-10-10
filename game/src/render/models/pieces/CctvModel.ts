// Ceiling-mounted 监控 variants (§5.7): 枪机, 球机 and 半球机.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * Ceiling camera (监控, 装饰): a rounded white bullet housing, a recessed dark
 * optical panel and an arched sun hood, carried on a
 * steel arm from a ceiling plate. The head looks along the piece's local −y, so the
 * placement rotation aims it; the whole assembly sits inside its own cell, hung
 * rather than standing.
 *
 * It is a prop: no line of sight is simulated, so the piece never changes what an
 * agent can see or where one walks. The head is a child group tipped about x, which
 * is the one rotation that leaves its lens dead ahead and its tilt down the −y axis
 * whatever `rot` does to the piece as a whole.
 */
function buildCctv(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const ceiling = 3.0 // the storey ceiling underside
  // The mount is slim: a 0.14 m ceiling plate, a thin stem, a small clamp.
  slab(g, mats.darkSteel, 0.1, 0, ceiling - 0.02, 0.14, 0.14, 0.04)
  slab(g, mats.steel, 0.1, 0, (2.78 + ceiling) / 2, 0.028, 0.028, ceiling - 2.78)
  slab(g, mats.darkSteel, 0.1, 0, 2.755, 0.09, 0.08, 0.09)
  slab(g, mats.steel, 0.03, 0, 2.72, 0.16, 0.032, 0.032)
  slab(g, mats.darkSteel, -0.05, 0, 2.68, 0.07, 0.07, 0.07)
  // The head, tipped 12° down at the concourse, built about its own x = 0 so the body,
  // the hood and the lens all sit on one axis.
  const head = new THREE.Group()
  head.position.set(-0.05, -0.02, 2.63)
  head.rotation.x = 0.21
  g.add(head)
  // Rounded end profiles run the whole length of the enclosure. The front stays
  // white around the inset optical panel, rather than turning the whole cap black.
  roundedHousing(head, mats.white, 'cctv-body', 0.15, 0.15, 0.04, 0.14, 0.28)
  roundedHousing(head, mats.steel, 'cctv-rear-seam', 0.151, 0.151, 0.04, 0.144, 0.004)
  roundedHousing(head, mats.white, 'cctv-front-surround', 0.16, 0.16, 0.043, -0.14, 0.014)
  roundedHousing(head, mats.black, 'cctv-optical-panel', 0.108, 0.108, 0.022, -0.154, 0.003)
  // The hood wraps over the crown and drops down both sides. Its front lip
  // overhangs the face, with a clear gap above the white enclosure.
  const hoodProfile = new THREE.Shape()
  hoodProfile.moveTo(-0.09, -0.005)
  hoodProfile.lineTo(-0.087, 0.064)
  hoodProfile.quadraticCurveTo(-0.065, 0.116, 0, 0.116)
  hoodProfile.quadraticCurveTo(0.065, 0.116, 0.087, 0.064)
  hoodProfile.lineTo(0.09, -0.005)
  hoodProfile.lineTo(0.082, -0.004)
  hoodProfile.lineTo(0.079, 0.062)
  hoodProfile.quadraticCurveTo(0.059, 0.108, 0, 0.108)
  hoodProfile.quadraticCurveTo(-0.059, 0.108, -0.079, 0.062)
  hoodProfile.lineTo(-0.082, -0.004)
  hoodProfile.closePath()
  const hood = new THREE.Mesh(new THREE.ExtrudeGeometry(hoodProfile, { depth: 0.34, bevelEnabled: false, curveSegments: 16 }), mats.white)
  hood.name = 'cctv-sun-hood'
  hood.rotation.x = Math.PI / 2
  hood.position.y = 0.148
  head.add(hood)
  // Cylinder axes already run along Y: their circular ends face the corridor.
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.01, 32), mats.black)
  lens.position.set(0, -0.162, 0)
  head.add(lens)
  // One optical surface avoids overlapping transparent cylinder end caps.
  const opticalGlass = mats.tintedGlass.clone()
  opticalGlass.color.setHex(0x274b62)
  opticalGlass.transparent = false
  opticalGlass.opacity = 1
  opticalGlass.depthWrite = true
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.022, 32), opticalGlass)
  glass.rotation.x = Math.PI / 2
  glass.position.set(0, -0.17, 0)
  head.add(glass)
  // Clear IR illuminators form a ring entirely inside the central dark window.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6
    const led = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.003, 12), mats.steel)
    led.name = 'cctv-ir-led'
    led.position.set(Math.cos(angle) * 0.042, -0.159, Math.sin(angle) * 0.042)
    head.add(led)
  }
  return g
}

/** Extrude a rounded X–Z profile from the back towards the local −y front. */
function roundedHousing(g: THREE.Group, mat: THREE.Material, name: string, width: number, height: number, radius: number, back: number, depth: number): void {
  const x = width / 2, z = height / 2, r = radius
  const shape = new THREE.Shape()
  shape.moveTo(-x + r, -z)
  shape.lineTo(x - r, -z)
  shape.quadraticCurveTo(x, -z, x, -z + r)
  shape.lineTo(x, z - r)
  shape.quadraticCurveTo(x, z, x - r, z)
  shape.lineTo(-x + r, z)
  shape.quadraticCurveTo(-x, z, -x, z - r)
  shape.lineTo(-x, -z + r)
  shape.quadraticCurveTo(-x, -z, -x + r, -z)
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 }), mat)
  mesh.name = name
  mesh.rotation.x = Math.PI / 2
  mesh.position.y = back
  g.add(mesh)
}

/** Cylinders stand on world Z; camera lenses still look along local −y. */
function housing(g: THREE.Group, mat: THREE.Material, top: number, bottom: number, height: number, x: number, y: number, z: number): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 40), mat)
  mesh.rotation.x = Math.PI / 2
  mesh.position.set(x, y, z)
  g.add(mesh)
}

/** Smoked lower hemisphere, with a visible swivel head and recessed optical glass. */
function cameraDome(g: THREE.Group, mats: ModelMaterials, radius: number, x: number, y: number, z: number): void {
  const head = new THREE.Group()
  head.position.set(x, y, z - radius * 0.18)
  head.rotation.x = 0.28
  g.add(head)
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.68, 32, 24), mats.black)
  head.add(core)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.34, radius * 0.4, radius * 0.22, 32), mats.darkSteel)
  barrel.position.y = -radius * 0.65
  head.add(barrel)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, 0.008, 32), mats.tintedGlass)
  lens.position.y = -radius * 0.77
  head.add(lens)
  // A separate material keeps the shell smoky without tinting station glazing.
  const smoke = mats.tintedGlass.clone()
  smoke.color.setHex(0x505960)
  smoke.opacity = 0.32
  smoke.depthWrite = false
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), smoke)
  shell.rotation.x = Math.PI / 2
  shell.position.set(x, y, z)
  g.add(shell)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 40), mats.steel)
  rim.position.set(x, y, z)
  g.add(rim)
}

/** 球机: substantial mounting arm, tapered white housing and suspended dark globe. */
function buildPtz(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.white, 0.18, 0.07, 2.98, 0.16, 0.18, 0.04)
  slab(g, mats.white, 0.18, 0.07, 2.87, 0.1, 0.12, 0.2)
  slab(g, mats.white, 0.065, 0.07, 2.8, 0.31, 0.12, 0.09)
  housing(g, mats.white, 0.115, 0.115, 0.1, -0.04, 0, 2.765)
  housing(g, mats.darkSteel, 0.116, 0.116, 0.012, -0.04, 0, 2.714)
  housing(g, mats.white, 0.116, 0.175, 0.19, -0.04, 0, 2.615)
  housing(g, mats.black, 0.175, 0.175, 0.012, -0.04, 0, 2.518)
  cameraDome(g, mats, 0.158, -0.04, 0, 2.51)
  return g
}

/** 半球机: low circular base bolted flush to the slab, with a compact glass dome. */
function buildDome(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  housing(g, mats.white, 0.165, 0.165, 0.06, 0, 0, 2.97)
  housing(g, mats.steel, 0.166, 0.166, 0.008, 0, 0, 2.937)
  housing(g, mats.white, 0.165, 0.145, 0.085, 0, 0, 2.892)
  housing(g, mats.white, 0.145, 0.132, 0.022, 0, 0, 2.84)
  cameraDome(g, mats, 0.123, 0, 0, 2.827)
  // Recessed fasteners on opposite sides of the underside ring.
  for (const x of [-0.137, 0.137]) housing(g, mats.darkSteel, 0.009, 0.009, 0.006, x, 0, 2.846)
  return g
}

export class CctvModel extends PieceBuilder {
  readonly kind = 'cctv'
  build(mod: Extract<Module, { type: 'cctv' }>): THREE.Group {
    const mats = this.ctx.mats
    const model = mod.cfg.variant === 'ptz' ? buildPtz(mats) : mod.cfg.variant === 'dome' ? buildDome(mats) : buildCctv(mats)
    return placeLocal(model, mod)
  }
}

