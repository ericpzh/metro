import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { beamModelDetail, omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { CATENARY_HEIGHT_INCREASE, CONTACT_WIRE_Z } from '../../../sim/constants.ts'
import { trackHeadroom, type TrackModule } from '../../../sim/track.ts'
import { trackGantryLayout } from './TrackGantry.ts'

type Point = [number, number, number]
export const CATENARY_GANTRY_Z = CONTACT_WIRE_Z + 0.72

/** §5.4: rigid overhead rail under slabs, flexible catenary on open portals. */
export function buildTrackCatenary(g: THREE.Group, mats: ModelMaterials, mod: TrackModule): void {
  const cy = ((mod.d ?? 1) - 1) / 2, cx = (mod.w - 1) / 2
  const tube = (a: Point, b: Point, radius: number, material: THREE.Material, name: string, detail = true) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to)
    const part = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material)
    part.name = name
    part.position.copy(from).add(to).multiplyScalar(0.5)
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
    if (detail) setModelDetail(part, new THREE.CylinderGeometry(radius, radius, length, 4))
    else omitModelDetail(part)
    g.add(part)
    return part
  }
  const bar = (name: string, material: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number) => {
    const part = slab(g, material, x, y, z, w, d, h)
    part.name = name
    return part
  }
  const insulator = (a: Point, b: Point, radius: number) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to)
    const profile = [new THREE.Vector2(radius * 0.42, 0)]
    for (let i = 0; i < 5; i++) {
      const z = length * (i + 0.1) / 5
      profile.push(new THREE.Vector2(radius * 0.42, z), new THREE.Vector2(radius, z + length * 0.045),
        new THREE.Vector2(radius * 0.88, z + length * 0.09), new THREE.Vector2(radius * 0.42, z + length * 0.15))
    }
    profile.push(new THREE.Vector2(radius * 0.42, length))
    const part = new THREE.Mesh(new THREE.LatheGeometry(profile, 10), mats.trainDark)
    part.name = 'catenary-ribbed-insulator'
    part.position.copy(from)
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
    setModelDetail(part, new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, length, 3).translate(0, length / 2, 0))
    g.add(part)
  }
  const insulatedArm = (a: Point, b: Point, name: string) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b)
    const c = from.clone().lerp(to, 0.12), d = from.clone().lerp(to, 0.38)
    tube(a, c.toArray() as Point, 0.023, mats.steel, name)
    insulator(c.toArray() as Point, d.toArray() as Point, 0.065)
    tube(d.toArray() as Point, b, 0.023, mats.steel, name)
  }
  // The round copper wire's underside is the shared pantograph contact plane.
  tube([-0.5, cy, CONTACT_WIRE_Z], [mod.w - 0.5, cy, CONTACT_WIRE_Z], 0.012, mats.wood, 'catenary-contact-wire')
  const layout = trackGantryLayout(mod)
  if (!layout) {
    const ceiling = mod.cfg.tunnel ? trackHeadroom(mod) + 1 : 3.88 + CATENARY_HEIGHT_INCREASE
    if (!mod.cfg.tunnel) {
      bar('catenary-canopy', mats.white, cx, cy, ceiling + 0.05, mod.w, mod.d ?? 1, 0.1)
      for (const y of [-0.56, (mod.d ?? 1) - 0.44]) bar('catenary-canopy-fascia', mats.darkSteel, cx, y, ceiling + 0.04, mod.w, 0.12, 0.12)
    }
    // Narrow flanged aluminium conductor rail; copper sits proud beneath it.
    beamModelDetail(bar('catenary-rigid-flange', mats.steel, cx, cy, CONTACT_WIRE_Z + 0.062, mod.w, 0.095, 0.016), 'x')
    beamModelDetail(bar('catenary-rigid-web', mats.steel, cx, cy, CONTACT_WIRE_Z + 0.036, mod.w, 0.022, 0.036), 'x')
    const count = Math.max(2, Math.round(mod.w / 4))
    for (let i = 0; i < count; i++) {
      const x = (i + 0.5) * mod.w / count - 0.5
      if (mod.cfg.tunnel) {
        // Wall plate and triangulated cantilever stay within the bore's crown.
        bar('catenary-tunnel-wall-plate', mats.darkSteel, x, -0.46, ceiling - 0.09, 0.19, 0.08, 0.17)
        tube([x, -0.42, ceiling - 0.045], [x, cy - 0.32, ceiling - 0.075], 0.022, mats.steel, 'catenary-tunnel-cantilever')
        tube([x, -0.42, ceiling - 0.16], [x, cy - 0.32, ceiling - 0.075], 0.014, mats.darkSteel, 'catenary-tunnel-brace')
        insulator([x, cy - 0.32, ceiling - 0.075], [x, cy, ceiling - 0.075], 0.055)
        tube([x, cy, ceiling - 0.075], [x, cy, CONTACT_WIRE_Z + 0.077], 0.017, mats.steel, 'catenary-rigid-hanger')
      } else {
        bar('catenary-ceiling-plate', mats.darkSteel, x, cy - 0.48, ceiling - 0.012, 0.22, 0.25, 0.024)
        insulator([x, cy - 0.45, ceiling - 0.03], [x, cy - 0.1, ceiling - 0.03], 0.023)
        tube([x, cy - 0.1, ceiling - 0.03], [x, cy, CONTACT_WIRE_Z + 0.075], 0.012, mats.steel, 'catenary-rigid-hanger')
      }
      const clamp = bar('catenary-rigid-clamp', mats.darkSteel, x, cy, CONTACT_WIRE_Z + 0.075, 0.14, 0.14, 0.018)
      omitModelDetail(clamp)
    }
    return
  }

  const top = CATENARY_GANTRY_Z
  const messengerZ = CONTACT_WIRE_Z + 0.38
  // Upright positions/widths remain shared with barrier cutouts and PSDs.
  for (const x of layout.xs) {
    for (const y of layout.ys) {
      const bottom = mod.cfg.bridge ? 0 : 0.5, postTop = top + 0.1
      bar(mod.cfg.bridge ? 'bridge-gantry-post' : 'station-gantry-post', mats.darkSteel,
        x, y, (bottom + postTop) / 2, 0.12, 0.12, postTop - bottom)
    }
    // A shallow lattice crossbeam, with four chords and alternating webs.
    for (const dx of [-0.035, 0.035]) for (const z of [top - 0.22, top + 0.035]) {
      tube([x + dx, layout.ys[0]!, z], [x + dx, layout.ys[1]!, z], 0.015, mats.darkSteel, 'catenary-truss-chord')
    }
    const bays = Math.ceil((layout.ys[1]! - layout.ys[0]!) / 0.55)
    for (let i = 0; i < bays; i++) {
      const y0 = THREE.MathUtils.lerp(layout.ys[0]!, layout.ys[1]!, i / bays)
      const y1 = THREE.MathUtils.lerp(layout.ys[0]!, layout.ys[1]!, (i + 1) / bays)
      for (const dx of [-0.035, 0.035]) tube([x + dx, y0, i % 2 ? top - 0.22 : top + 0.035],
        [x + dx, y1, i % 2 ? top + 0.035 : top - 0.22], 0.009, mats.steel, 'catenary-truss-web', false)
    }
    // Seat both insulated arms in cleats that overlap the post face. Starting
    // the tubes beyond the post without these fittings leaves visible gaps.
    const postY = layout.ys[0]!
    for (const z of [top - 0.36, CONTACT_WIRE_Z + 0.21]) {
      bar('catenary-arm-mount', mats.darkSteel, x, postY + 0.06, z, 0.12, 0.08, 0.10)
    }
    const side = postY + 0.08
    // Hinged upper stay and lower registration arm, electrically isolated at
    // the support. All fittings clear the carbon head below the wire.
    insulatedArm([x, side, top - 0.36], [x, cy, messengerZ], 'catenary-upper-stay')
    insulatedArm([x, side, CONTACT_WIRE_Z + 0.21], [x, cy + 0.18, CONTACT_WIRE_Z + 0.10], 'catenary-registration-arm')
    tube([x, THREE.MathUtils.lerp(side, cy, 0.48), THREE.MathUtils.lerp(top - 0.36, messengerZ, 0.48)], [x, cy + 0.18, CONTACT_WIRE_Z + 0.10], 0.012, mats.darkSteel, 'catenary-support-brace')
    tube([x, cy + 0.18, CONTACT_WIRE_Z + 0.10], [x, cy, CONTACT_WIRE_Z + 0.035], 0.015, mats.darkSteel, 'catenary-steady-arm')
    tube([x, cy, messengerZ], [x, cy, CONTACT_WIRE_Z + 0.012], 0.006, mats.steel, 'catenary-support-dropper')
    // Return conductor is kept inside the existing post line.
    insulator([x, layout.ys[0]!, top - 0.02], [x, layout.ys[0]! + 0.18, top - 0.02], 0.035)
  }
  tube([-0.5, layout.ys[0]! + 0.18, top - 0.02], [mod.w - 0.5, layout.ys[0]! + 0.18, top - 0.02], 0.009, mats.darkSteel, 'catenary-return-wire')
  // Every module ends at a common messenger height, so abutting runs meet
  // without steps. Sag is confined to each support bay; the contact stays level.
  const anchors = [...new Set([-0.5, ...layout.xs, mod.w - 0.5])].sort((a, b) => a - b)
  for (let bay = 1; bay < anchors.length; bay++) {
    const start = anchors[bay - 1]!, end = anchors[bay]!, length = end - start
    if (length < 0.01) continue
    const height = (t: number) => messengerZ - Math.min(0.14, length * 0.025) * 4 * t * (1 - t)
    const points = Array.from({ length: 9 }, (_, i) => new THREE.Vector3(THREE.MathUtils.lerp(start, end, i / 8), cy, height(i / 8)))
    const curve = new THREE.CatmullRomCurve3(points)
    const messenger = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(length * 2)), 0.009, 8, false), mats.steel)
    messenger.name = 'catenary-messenger-wire'
    setModelDetail(messenger, new THREE.TubeGeometry(curve, 4, 0.009, 3, false))
    g.add(messenger)
    const count = Math.max(1, Math.ceil(length / 2))
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count, x = THREE.MathUtils.lerp(start, end, t)
      tube([x, cy, CONTACT_WIRE_Z + 0.012], [x, cy, height(t)], 0.006, mats.steel, 'catenary-dropper', i % 2 === 0)
      const clamp = bar('catenary-wire-clamp', mats.darkSteel, x, cy, CONTACT_WIRE_Z + 0.026, 0.055, 0.055, 0.025)
      omitModelDetail(clamp)
    }
  }
}
