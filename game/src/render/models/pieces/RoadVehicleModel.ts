import * as THREE from 'three'
import { ROAD_VEHICLE_OPACITY } from '../../../sim/constants.ts'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type RoadVehicleKind = 'car' | 'bus' | 'bike' | 'scooter'
/** Low-poly road vehicles, facing +Y with Z up. Each colour becomes one instance draw. */
export function roadVehicleParts(kind: RoadVehicleKind): Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }> {
  const bins = new Map<number, THREE.BufferGeometry[]>()
  const add = (color: number, geo: THREE.BufferGeometry, x: number, y: number, z: number, turn = 0) => {
    geo.rotateZ(turn); geo.translate(x, y, z)
    const list = bins.get(color) ?? []; list.push(geo); bins.set(color, list)
  }
  const box = (c: number, x: number, y: number, z: number, w: number, l: number, h: number, turn = 0) => add(c, new THREE.BoxGeometry(w, l, h), x, y, z, turn)
  const wheel = (x: number, y: number, radius: number, depth: number) => {
    const geo = new THREE.CylinderGeometry(radius, radius, depth, 12)
    geo.rotateZ(Math.PI / 2)
    add(0x20232a, geo, x, y, radius)
  }
  if (kind === 'car' || kind === 'bus') {
    const bus = kind === 'bus', length = bus ? 10 : 4.2, width = bus ? 2.35 : 1.8
    box(bus ? 0x25a68a : 0xc94c40, 0, 0, bus ? 1.2 : .65, width, length, bus ? 1.8 : .7)
    box(0x344b61, 0, bus ? .1 : -.15, bus ? 2.05 : 1.2, width * .93, bus ? 9.3 : 2.2, bus ? .9 : .65)
    box(0xe4e9ec, 0, bus ? 0 : -.2, bus ? 2.59 : 1.56, width * .97, bus ? 9.8 : 2.1, .12)
    if (bus) for (let y = -4; y < 4.5; y += 1.3) box(0x25a68a, 0, y, 2.05, width, .09, 1.05)
    for (const x of [-width / 2, width / 2]) for (const y of [-length * .32, length * .32]) wheel(x, y, bus ? .44 : .32, .2)
    for (const x of [-width * .32, width * .32]) {
      box(0xfff4c1, x, length / 2 + .01, .75, .3, .04, .19)
      box(0xe02d2d, x, -length / 2 - .01, .75, .27, .04, .16)
    }
  } else {
    const bike = kind === 'bike'
    for (const y of [-.65, .65]) wheel(0, y, bike ? .33 : .18, .09)
    box(0x3798d2, 0, 0, bike ? .47 : .22, .12, 1.35, .12)
    box(0xb9c5cd, 0, .65, .7, .08, .08, 1.05)
    box(0x20232a, 0, .65, 1.2, .65, .1, .08)
    if (bike) {
      box(0x3798d2, 0, -.2, .68, .09, .75, .09)
      box(0x20232a, 0, -.27, .91, .3, .3, .09)
    }
    // A helmeted rider gives both two-wheel models their human silhouette.
    box(0x273b56, 0, -.05, .78, .34, .34, .65)
    box(0xe7aa51, 0, -.1, 1.27, .46, .32, .58)
    add(0xf2c49a, new THREE.SphereGeometry(.16, 8, 6), 0, -.07, 1.71)
    add(0xe9eae7, new THREE.SphereGeometry(.19, 8, 6), 0, -.07, 1.82)
    for (const x of [-.22, .22]) box(0xe7aa51, x, .24, 1.24, .12, .65, .13)
  }
  return [...bins].map(([color, parts]) => {
    const geometry = mergeGeometries(parts)
    for (const part of parts) part.dispose()
    const grey = new THREE.Color(color)
    const luminance = grey.r * .2126 + grey.g * .7152 + grey.b * .0722
    grey.setRGB(luminance, luminance, luminance)
    return { geometry, material: new THREE.MeshStandardMaterial({ color: grey, roughness: .7,
      transparent: true, opacity: ROAD_VEHICLE_OPACITY, depthWrite: false }) }
  })
}
