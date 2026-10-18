import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'

/** Upper bogie load path: deep cheek plates, bolster and broad air cushions. */
export function buildTrainSuspension(g: THREE.Group, mats: ModelMaterials, centre: number, axleZ: number, axleHalfSpan: number): void {
  const bar = (name: string, material: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number) => {
    const part = slab(g, material, centre + x, y, z, w, d, h)
    part.name = `bogie-${name}`
    return part
  }
  const lower = axleZ + .18, top = .40, half = axleHalfSpan + .42
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape()
    shape.moveTo(-half, lower); shape.lineTo(-half, top - .15)
    shape.lineTo(-half + .25, top); shape.lineTo(half - .25, top)
    shape.lineTo(half, top - .15); shape.lineTo(half, lower)
    shape.lineTo(.35, lower + .10); shape.lineTo(-.35, lower + .10); shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, {depth:.16,bevelEnabled:false})
    geometry.rotateX(Math.PI / 2)
    geometry.translate(centre, side * 1.0 + .08, 0)
    const cheek = new THREE.Mesh(geometry, mats.darkSteel)
    cheek.name = 'bogie-upper-cheek-frame'
    setModelDetail(cheek, new THREE.BoxGeometry(half * 2, .16, top - lower).translate(centre, side * 1.0, (top + lower) / 2))
    g.add(cheek)
    bar('upper-frame-flange', mats.trainDark, 0, side * 1.0, top, half * 2 - .35, .24, .06)
    const profile = [[0,.10],[.16,.10],[.23,.13],[.24,.17],[.22,.20],[.24,.23],[.22,.26],[.24,.29],[.22,.32],[.22,.36],[.15,.40],[0,.40]]
    const air = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r,z])=>new THREE.Vector2(r,.24+(z-.10)*(.16/.30))),24), mats.rubber)
    air.rotation.x = Math.PI / 2
    air.position.set(centre, side * .78, 0)
    air.name = 'bogie-secondary-air-cushion'
    setModelDetail(air, new THREE.LatheGeometry(profile.map(([r,z])=>new THREE.Vector2(r,.24+(z-.10)*(.16/.30))),6))
    g.add(air)
    bar('air-cushion-seat', mats.darkSteel, 0, side * .78, .22, .55, .55, .04)
    bar('body-load-pad', mats.darkSteel, 0, side * .78, .445, .62, .62, .11)
    for (const end of [-1, 1]) {
      const mount = bar('upper-frame-axle-bracket', mats.steel, end * axleHalfSpan, side * 1.0, lower + .10, .24, .22, .20)
      omitModelDetail(mount)
      const cap = bar('upper-frame-inspection-cover', mats.trainDark, end * .40, side * 1.09, (lower + top) / 2, .30, .025, .22)
      omitModelDetail(cap)
    }
  }
  bar('upper-bolster', mats.darkSteel, 0, 0, .08, .48, 2.10, .20)
  for (const end of [-1,1]) bar('upper-transom', mats.darkSteel, end * axleHalfSpan, 0, top - .10, .16, 2.10, .18)
}
