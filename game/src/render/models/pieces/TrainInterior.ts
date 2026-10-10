import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { CABIN_FLOOR_Z, CABIN_HALF_W, DOOR_HEAD_Z } from '../../../sim/stock.ts'

/** Benches, seat-end guards, handrails and lighting from the metro cabin references (§1.13). */
export function buildTrainInterior(g: THREE.Group, mats: ModelMaterials, start: number, end: number, bays: Array<[number, number]>, doors: number[], floor: THREE.Material): void {
  const tube = (points: THREE.Vector3[], radius: number, mat: THREE.Material, name: string, closed = false): void => {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal')
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 6, closed), mat)
    mesh.name = name
    g.add(mesh)
  }
  const mid = (start + end) / 2
  slab(g, floor, mid, 0, CABIN_FLOOR_Z - 0.06, end - start, CABIN_HALF_W * 2, 0.12).name = 'cabin-floor'
  for (const side of [-1, 1]) {
    const y = side * (CABIN_HALF_W - 0.25)
    for (const [a, b] of bays) {
      if (b - a < 1.2) continue
      const len = b - a - 0.14
      // Thin formed seat pan curves up into a backrest, rather than a solid box.
      const section = new THREE.Shape()
      section.moveTo(-0.27, 0.42)
      section.lineTo(0.19, 0.42)
      section.quadraticCurveTo(0.25, 0.42, 0.27, 0.53)
      section.lineTo(0.3, 0.94)
      section.lineTo(0.26, 0.94)
      section.lineTo(0.23, 0.54)
      section.quadraticCurveTo(0.21, 0.47, 0.17, 0.47)
      section.lineTo(-0.27, 0.47)
      section.closePath()
      const geometry = new THREE.ExtrudeGeometry(section, { depth: len, bevelEnabled: false, curveSegments: 8 })
      geometry.rotateY(Math.PI / 2)
      geometry.rotateX(Math.PI / 2)
      const seat = new THREE.Mesh(geometry, mats.steel)
      seat.name = 'cabin-bench'
      // Mirror across the aisle without flipping the seat's height.
      seat.scale.y = side
      seat.position.set(a + 0.07, y, CABIN_FLOOR_Z)
      g.add(seat)
      slab(g, mats.trainInterior, (a + b) / 2, y, CABIN_FLOOR_Z + 0.23, len - 0.18, 0.3, 0.35)
      for (const x of [a + 0.07, b - 0.07]) {
        const guardProfile = new THREE.Shape()
        guardProfile.moveTo(-0.29, 0.08)
        guardProfile.lineTo(-0.29, 0.43)
        guardProfile.quadraticCurveTo(-0.25, 0.68, -0.1, 0.79)
        guardProfile.lineTo(0.28, 1.03)
        guardProfile.lineTo(0.28, 0.08)
        guardProfile.closePath()
        const guardGeometry = new THREE.ExtrudeGeometry(guardProfile, { depth: 0.06, bevelEnabled: false, curveSegments: 12 })
        guardGeometry.rotateY(Math.PI / 2)
        guardGeometry.rotateX(Math.PI / 2)
        const guard = new THREE.Mesh(guardGeometry, mats.trainBody)
        guard.name = 'seat-end-panel'
        guard.scale.y = side
        guard.position.set(x - 0.03, y, CABIN_FLOOR_Z)
        g.add(guard)
        tube([
          new THREE.Vector3(x, y - side * 0.29, CABIN_FLOOR_Z + 0.12),
          new THREE.Vector3(x, y - side * 0.31, CABIN_FLOOR_Z + 0.58),
          new THREE.Vector3(x, y - side * 0.21, CABIN_FLOOR_Z + 1.1),
          new THREE.Vector3(x, y + side * 0.12, DOOR_HEAD_Z - 0.18),
        ], 0.025, mats.gateRed, 'seat-end-handrail')
      }
    }
    slab(g, mats.glow, mid, side * 0.76, DOOR_HEAD_Z - 0.015, end - start - 0.3, 0.09, 0.025).name = 'cabin-light-strip'
    tube([new THREE.Vector3(start + 0.15, side * 0.62, 2.36), new THREE.Vector3(end - 0.15, side * 0.62, 2.36)], 0.025, mats.steel, 'overhead-handrail')
    for (let x = start + 0.7; x < end - 0.3; x += 1.15) {
      slab(g, mats.rubber, x, side * 0.62, 2.24, 0.035, 0.035, 0.2)
      tube([
        new THREE.Vector3(x, side * 0.62, 2.17),
        new THREE.Vector3(x - 0.1, side * 0.62, 2.02),
        new THREE.Vector3(x + 0.1, side * 0.62, 2.02),
      ], 0.018, mats.gateRed, 'hanging-strap', true)
    }
  }
  for (const x of doors) {
    for (const side of [-1, 1]) {
      const y = side * (CABIN_HALF_W - 0.025)
      slab(g, mats.white, x, y, DOOR_HEAD_Z - 0.17, 0.95, 0.035, 0.24).name = 'cabin-route-panel'
      slab(g, mats.blue, x, y - side * 0.024, DOOR_HEAD_Z - 0.17, 0.82, 0.008, 0.015)
      for (let stop = -3; stop <= 3; stop++) {
        slab(g, mats.white, x + stop * 0.11, y - side * 0.03, DOOR_HEAD_Z - 0.17, 0.022, 0.008, 0.03)
      }
    }
    tube([new THREE.Vector3(x, 0, CABIN_FLOOR_Z), new THREE.Vector3(x, 0, DOOR_HEAD_Z - 0.04)], 0.027, mats.steel, 'cabin-centre-pole')
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 6, 32), mats.glow)
    ring.name = 'cabin-ring-light'
    ring.position.set(x, 0, DOOR_HEAD_Z - 0.025)
    g.add(ring)
  }
}
