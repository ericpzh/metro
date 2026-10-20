import * as THREE from 'three'
import { PANTOGRAPH_CONTACT_Z } from '../../../sim/stock.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'

/** Above the cabin ceiling; a roof well leaves room for the raised linkage. */
export const PANTOGRAPH_MOUNT_Z = 2.85
export const PANTOGRAPH_WELL_HALF_LENGTH = 1.12

type Point = [number, number, number]

/** Single-arm collector with an insulated base and sprung bow (§1.12). */
export function buildTrainPantograph(parent: THREE.Group, mats: ModelMaterials, x: number, inward: number, roof: number): void {
  const g = new THREE.Group()
  g.name = 'train-pantograph'
  g.position.x = x
  g.rotation.z = inward < 0 ? Math.PI : 0
  parent.add(g)
  const contact = PANTOGRAPH_CONTACT_Z
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const part = new THREE.Mesh(geometry, material)
    part.name = name
    g.add(part)
    return part
  }
  const tube = (a: Point, b: Point, radius: number, material: THREE.Material, name: string, endRadius = radius) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b)
    const length = from.distanceTo(to)
    const part = mesh(new THREE.CylinderGeometry(endRadius, radius, length, 12), material, name)
    setModelDetail(part, new THREE.CylinderGeometry(endRadius, radius, length, 4))
    part.position.copy(from).add(to).multiplyScalar(0.5)
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
    return part
  }
  const smallHardware = (part: THREE.Mesh) => {
    const empty = new THREE.BufferGeometry()
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    empty.setIndex([])
    setModelDetail(part, empty)
  }
  const bar = (cx: number, cy: number, cz: number, w: number, d: number, h: number, material: THREE.Material, name: string) => {
    const part = slab(g, material, cx, cy, cz, w, d, h)
    part.name = name
    return part
  }
  const cable = (points: Point[], radius: number, material: THREE.Material, name: string) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
    const part = mesh(new THREE.TubeGeometry(curve, 20, radius, 5, false), material, name)
    omitModelDetail(part)
    return part
  }

  // Four ceramic stacks carry a rectangular steel cradle. The flared sheds
  // are surfaces of revolution, with a narrow neck and separate metal shoes.
  for (const dx of [-0.66, 0.66]) for (const y of [-0.32, 0.32]) {
    bar(dx, y, roof + 0.025, 0.27, 0.25, 0.05, mats.darkSteel, 'pantograph-mount-shoe')
    const profile = [new THREE.Vector2(0.065, 0.016)]
    for (let i = 0; i < 5; i++) {
      const z = (0.055 + i * 0.072) * .4
      profile.push(new THREE.Vector2(0.065, z), new THREE.Vector2(0.14, z + .006),
        new THREE.Vector2(0.135, z + .014), new THREE.Vector2(0.065, z + .0208))
    }
    profile.push(new THREE.Vector2(0.065, .17))
    const insulator = mesh(new THREE.LatheGeometry(profile, 12), mats.white, 'pantograph-ribbed-insulator')
    // Lathe and cylinder axes are Y; stand them on the roof's Z axis.
    insulator.rotation.x = Math.PI / 2
    insulator.position.set(dx, y, roof)
    setModelDetail(insulator, new THREE.CylinderGeometry(0.09, 0.11, 0.154, 4).translate(0, .093, 0))
    bar(dx, y, roof + .174, .17, .17, .016, mats.darkSteel, 'pantograph-insulator-cap')
  }
  for (const y of [-0.32, 0.32]) bar(0, y, roof + .22, 1.65, .09, .07, mats.trainDark, 'pantograph-base')
  for (const dx of [-0.66, 0.66]) bar(dx, 0, roof + .22, .09, .73, .07, mats.trainDark, 'pantograph-base-crossmember')

  const foot: Point = [0.59, 0, roof + .31]
  const elbow: Point = [-0.82, 0, roof + .40]
  const headZ = contact - .13
  tube([foot[0], -0.43, foot[2]], [foot[0], 0.43, foot[2]], 0.085, mats.darkSteel, 'pantograph-base-axle')
  // One substantial tapered lower arm, then a light fork under the head.
  tube(foot, elbow, 0.105, mats.darkSteel, 'pantograph-lower-arm', 0.07)
  tube([elbow[0], -0.22, elbow[2]], [elbow[0], 0.22, elbow[2]], 0.095, mats.trainDark, 'pantograph-elbow-pivot')
  for (const side of [-1, 1]) {
    tube([elbow[0], side * 0.13, elbow[2]], [0.5, side * 0.35, headZ], 0.042, mats.darkSteel, 'pantograph-upper-arm', 0.032)
    smallHardware(tube([0.76, side * 0.23, roof + .31], [-0.76, side * 0.23, elbow[2] - 0.07], 0.016, mats.steel, 'pantograph-tie-rod'))
    tube([0.5, side * 0.35, headZ], [0.5, side * 0.35, contact - 0.055], 0.028, mats.steel, 'pantograph-head-suspension')
    tube([0.39, side * 0.35, headZ], [0.61, side * 0.35, headZ], 0.055, mats.darkSteel, 'pantograph-head-pivot')
    for (const px of [foot[0], elbow[0]]) {
      const pz = px === foot[0] ? foot[2] : elbow[2]
      smallHardware(tube([px, side * 0.22, pz], [px, side * 0.245, pz], 0.052, mats.steel, 'pantograph-pivot-bolt'))
    }
    // Horizontal tension springs and their clevises sit inside the cradle.
    const turns: Point[] = []
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, angle = t * Math.PI * 24
      turns.push([-0.36 + t * 0.73, side * 0.22 + Math.cos(angle) * 0.047, roof + .31 + Math.sin(angle) * 0.047])
    }
    const spring = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(turns.map(p => new THREE.Vector3(...p))), 120, 0.012, 4, false), mats.darkSteel, 'pantograph-tension-spring')
    omitModelDetail(spring)
    tube([-0.49, side * 0.22, roof + .31], [-0.36, side * 0.22, roof + .31], 0.023, mats.steel, 'pantograph-spring-anchor')
    tube([0.37, side * 0.22, roof + .31], [foot[0], side * 0.22, foot[2]], 0.023, mats.steel, 'pantograph-spring-clevis')
  }
  cable([[0.59, -0.25, roof + .31], [0.42, -0.27, roof + .26], [-0.74, -0.24, elbow[2] - 0.06],
    [-0.96, -0.24, elbow[2]], [-0.79, -0.24, elbow[2] + .08], [0.5, -0.35, headZ]], 0.009, mats.steel, 'pantograph-bonding-lead')

  // Ribbed cable termination beside the cradle, with a flexible power lead.
  const plugA: Point = [-1.02, 0, roof + .08], plugB: Point = [-0.82, 0, roof + .18]
  tube(plugA, plugB, 0.045, mats.trainDark, 'pantograph-power-bushing')
  const axis = new THREE.Vector3(...plugB).sub(new THREE.Vector3(...plugA)).normalize()
  for (let i = 0; i < 5; i++) {
    const centre = new THREE.Vector3(...plugA).lerp(new THREE.Vector3(...plugB), (i + 0.5) / 5)
    const a = centre.clone().addScaledVector(axis, -0.012), b = centre.clone().addScaledVector(axis, 0.012)
    smallHardware(tube(a.toArray() as Point, b.toArray() as Point, 0.09, mats.trainDark, 'pantograph-power-bushing-shed', 0.075))
  }
  cable([[-0.82, 0, roof + .18], [-0.82, -0.12, roof + .25],
    [-0.3, -0.25, roof + .27], [0.59, -0.25, roof + .31]], 0.018, mats.trainDark, 'pantograph-power-lead')

  // Twin bowed head rails: flat carbon contact in the middle, gently curved
  // shoulders and downturned horns at both ends, like the reference collector.
  const bow = [[-1.12, -0.23], [-1.04, -0.15], [-0.90, -0.065], [-0.72, -0.035],
    [0, -0.035], [0.72, -0.035], [0.90, -0.065], [1.04, -0.15], [1.12, -0.23]]
  for (const dx of [0.39, 0.61]) {
    for (let i = 1; i < bow.length; i++) {
      const a = bow[i - 1]!, b = bow[i]!
      tube([dx, a[0]!, contact + a[1]!], [dx, b[0]!, contact + b[1]!], 0.018, mats.steel, Math.abs(b[0]!) > 0.72 ? 'pantograph-horn' : 'pantograph-head-support')
    }
    bar(dx, 0, contact - 0.011, 0.075, 1.40, 0.022, mats.trainDark, 'pantograph-contact-strip')
  }
  for (const y of [-0.72, 0.72]) bar(0.5, y, contact - 0.05, 0.29, 0.055, 0.05, mats.darkSteel, 'pantograph-head-crossmember')
}
