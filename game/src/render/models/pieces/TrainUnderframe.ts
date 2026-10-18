import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { TRACK_UNDERFLOOR_DROP } from '../../../sim/constants.ts'

/** Equipment hangs beneath the aisle, between the bogies (§1.12). */
export function buildTrainUnderframe(parent: THREE.Group, mats: ModelMaterials, bogies: readonly number[], width: number): void {
  const start = bogies[0] + 1.65, end = bogies[1] - 1.65
  if (end <= start) return
  const box = (name: string, material: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number, detail = false) => {
    const part = slab(parent, material, x, y, z, w, d, h)
    part.name = `underframe-${name}`
    if (detail) omitModelDetail(part)
    return part
  }
  const cylinder = (name: string, x: number, y: number, z: number, radius: number, length: number) => {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), mats.darkSteel)
    part.name = `underframe-${name}`
    part.rotation.z = Math.PI / 2
    part.position.set(x, y, z)
    setModelDetail(part, new THREE.CylinderGeometry(radius, radius, length, 5))
    parent.add(part)
    return part
  }
  const count = Math.max(2, Math.floor((end - start) / 1.25))
  const pitch = (end - start) / count
  for (const side of [-1, 1]) {
    const y = side * (width / 2 - .42)
    box('equipment-rail', mats.darkSteel, (start + end) / 2, y, .48, end - start, .08, .10)
    for (let i = 0; i < count; i++) {
      const x = start + pitch * (i + .5), w = pitch - .10
      if (i === count - 1 && side === -1) {
        cylinder('air-reservoir', x, y, .18 - TRACK_UNDERFLOOR_DROP * .55, .22, w - .08)
        for (const sign of [-1, 1]) box('tank-strap', mats.steel, x + sign * w * .3, y, .18 - TRACK_UNDERFLOOR_DROP * .55, .035, .46, .46, true)
        for (const sign of [-1, 1]) box('tank-hanger', mats.darkSteel, x + sign * w * .3, y, .20, .06, .08, .55, true)
      } else {
        const height = .42 + TRACK_UNDERFLOOR_DROP * .72
        const z = .44 - height / 2
        box(i % 2 ? 'battery-cabinet' : 'inverter', mats.darkSteel, x, y, z, w, .58, height)
        const face = y + side * .296
        box('access-lid', mats.steel, x, face, z, w - .06, .012, height - .07, true)
        for (const sign of [-1, 1]) {
          box('mounting-bracket', mats.steel, x + sign * w * .38, y, .47, .06, .64, .12, true)
          box('latch', mats.trainDark, x + sign * w * .38, face + side * .01, z, .025, .02, .08, true)
        }
        if (i % 2 === 0) for (let n = 0; n < 11; n++) box('vent', mats.trainDark, x, face + side * .012, z - .19 + n * .038, w * .57, .016, .012, true)
      }
    }
    cylinder('cable-conduit', (start + end) / 2, side * .40, .39, .025, end - start)
  }
}
