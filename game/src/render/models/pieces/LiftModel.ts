// Elevator (电梯) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, registerDoorLeaf, ownedMaterial } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { LIFT_STEP, liftStopZs } from '../../../sim/lifts.ts'
import { solidAt } from '../../../sim/ground.ts'
import type { Module, StationData } from '../../../sim/types.ts'

/**
 * The shaft's top course — its lid — in metres. The lid's **top face** lands on
 * the storey grid line over the top landing, which is the underside of the slab
 * above it (`LIFT_STEP - 1` m above that landing's own floor): the shaft closes
 * flush against the tile above instead of stopping a hand's width short of it and
 * leaving a strip of daylight around the cabin. It must not rise *past* that line
 * either, or a platform piece would poke through the street floor; the headroom
 * it leaves does the rest of the job — the cabin and its call panel fit under it.
 */
const LIFT_CAP = 0.14

/**
 * True when `(x, y, z)` is walkable floor: solid, with nothing solid above it.
 * Asked of the **effective** ground (`solidAt`): a shaft rooted on the implicit
 * street at z = 0 (`sim/ground.ts`) really does have floor under it, so its base
 * landing gets the threshold and call panel every other landing gets, instead of
 * standing unserved.
 */
function floorAt(data: StationData, x: number, y: number, z: number): boolean {
  return solidAt(data.cells, data.modules, x, y, z) && !solidAt(data.cells, data.modules, x, y, z + 1)
}

/**
 * An elevator (电梯). A 2 × 2 m vertical shaft with a moving 1.5 × 1.5 m cabin:
 * a steel frame and back/side walls around an open front, a threshold and a
 * call panel at every floor the shaft actually serves, and a cabin whose doors
 * slide apart. Only real landings get a sill/panel — a shaft that runs past a
 * floorless level shows nothing there. The cabin group is left in
 * `userData.liftCabin` and its two leaves are registered as doors, so
 * `SceneRenderer.setLifts` can travel the cabin and ease the doors from the sim
 * car state. Built in world space so one model spans every storey of the shaft;
 * the group origin is the centre of the 2 × 2 plan.
 */
function buildLift(ctx: ModuleContext, mod: Extract<Module, { type: 'lift' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  g.position.set(mod.x + 1, mod.y + 1, mod.from.z + 1)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2

  const runH = Math.max(LIFT_STEP, mod.to.z - mod.from.z)
  // The ceiling over the top landing: the grid line the block above that landing
  // starts on. The walls stop under the lid and the lid's top face is this line,
  // so the shaft is exactly the blocks it fills and meets the tile above flush.
  const ceiling = runH + LIFT_STEP - 1
  const H = ceiling - LIFT_CAP
  const capMid = ceiling - LIFT_CAP / 2
  const outer = 0.94 // wall centre-line, so the assembly reads as 2 m across
  const inner = 0.72 // 1.44 m clear carriage
  const midH = H / 2

  // Four corner posts and the back/side walls; the front (local −y) stays open.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) slab(g, mats.darkSteel, sx * outer, sy * outer, midH, 0.14, 0.14, H)
  }
  slab(g, mats.steel, 0, outer, midH, 1.74, 0.12, H)
  slab(g, mats.steel, -outer, 0, midH, 0.12, 1.74, H)
  slab(g, mats.steel, outer, 0, midH, 0.12, 1.74, H)

  // A threshold sill and a call panel at every real landing in the column.
  for (const z of liftStopZs(mod.from.z, mod.to.z)) {
    if (!floorAt(ctx.data, mod.x, mod.y, z)) continue
    const L = z - mod.from.z
    slab(g, mats.darkSteel, 0, -outer + 0.02, L + 0.03, 1.9, 0.22, 0.06)
    slab(g, mats.black, 0.6, -outer - 0.03, L + 1.35, 0.3, 0.04, 0.18)
    slab(g, mats.ledGreen, 0.6, -outer - 0.05, L + 1.35, 0.12, 0.02, 0.07)
  }
  slab(g, mats.darkSteel, 0, 0, capMid, 2.04, 2.04, LIFT_CAP)

  // The cabin: floor, roof, back and sides, with the two door leaves at the
  // front. Its local origin is the cabin floor, so the renderer only sets z.
  const cabin = new THREE.Group()
  g.add(cabin)
  g.userData.liftCabin = cabin
  slab(cabin, mats.steel, 0, 0, 0.05, 1.5, 1.5, 0.1)
  slab(cabin, mats.darkSteel, 0, 0, 2.42, 1.54, 1.54, 0.12)
  slab(cabin, mats.steel, 0, inner, 1.24, 1.5, 0.06, 2.32)
  slab(cabin, mats.steel, -inner, 0, 1.24, 0.06, 1.44, 2.32)
  slab(cabin, mats.steel, inner, 0, 1.24, 0.06, 1.44, 2.32)
  // Interior light and a mirror panel on the back wall.
  slab(cabin, mats.glow, 0, 0, 2.3, 0.9, 0.9, 0.04)
  plate(cabin, mats.screen, 0.9, 1.2, 0, inner - 0.04, 1.3, Math.PI)
  const doors: THREE.Mesh[] = []
  const leafW = 0.72
  for (const s of [-1, 1]) {
    const leaf = slab(cabin, mats.black, (s * leafW) / 2, -inner + 0.02, 1.24, leafW, 0.06, 2.15)
    registerDoorLeaf(leaf, s, 0.7, doors)
  }
  g.userData.doors = doors
  return g
}

/** Glazed station lift (§5.1), with the same shaft and animated car contract. */
function buildGlassLift(ctx: ModuleContext, mod: Extract<Module, { type: 'lift' }>): THREE.Group {
  const { mats } = ctx
  // Keep stainless readable under the station's lights without an environment map.
  const steel = ownedMaterial(ctx, mats.steel.clone())
  steel.metalness = 0.18
  steel.roughness = 0.32
  const glass = ownedMaterial(ctx, mats.glass.clone())
  glass.opacity = 0.2
  glass.depthWrite = false
  const g = new THREE.Group()
  g.position.set(mod.x + 1, mod.y + 1, mod.from.z + 1)
  g.rotation.z = ((mod.rot ?? 0) * Math.PI) / 2
  const ceiling = Math.max(LIFT_STEP, mod.to.z - mod.from.z) + LIFT_STEP - 1
  const H = ceiling - LIFT_CAP
  const outer = 0.94
  for (const x of [-outer, outer]) {
    for (const y of [-outer, outer]) {
      slab(g, steel, x, y, H / 2, 0.14, 0.14, H).name = 'shaft-post'
      slab(g, steel, x, y, 0.04, 0.16, 0.16, 0.08)
    }
  }
  // Panel bays have actual seams, framing and clamps rather than one tall pane.
  for (let bottom = 0; bottom < H; bottom += 2) {
    const top = Math.min(bottom + 2, H)
    const mid = (bottom + top) / 2
    for (const x of [-outer, outer]) {
      slab(g, glass, x, 0, mid, 0.025, 1.72, top - bottom - 0.08).name = 'shaft-glass'
      slab(g, steel, x, 0, bottom + 0.04, 0.12, 1.74, 0.08).name = 'shaft-crossbeam'
      for (const y of [-0.82, 0.82]) {
        for (const z of [bottom + 0.18, top - 0.18]) slab(g, steel, x, y, z, 0.05, 0.08, 0.07)
      }
    }
    slab(g, glass, 0, outer, mid, 1.72, 0.025, top - bottom - 0.08).name = 'shaft-glass'
    slab(g, steel, 0, outer, bottom + 0.04, 1.74, 0.12, 0.08).name = 'shaft-crossbeam'
  }
  // Rear guide rails remain visible through the enclosure as the car travels.
  for (const x of [-0.57, 0.57]) {
    slab(g, mats.darkSteel, x, 0.84, H / 2, 0.055, 0.065, H).name = 'guide-rail'
    for (let z = 0.4; z < H; z += LIFT_STEP) slab(g, steel, x, 0.88, z, 0.16, 0.13, 0.06)
  }
  for (const z of liftStopZs(mod.from.z, mod.to.z)) {
    const L = z - mod.from.z
    if (!floorAt(ctx.data, mod.x, mod.y, z)) continue
    slab(g, steel, 0, -outer + 0.04, L + 0.035, 1.88, 0.22, 0.07)
    // Stainless landing portal and its glazed transom leave the doorway clear.
    for (const x of [-0.79, 0.79]) slab(g, steel, x, -outer, L + 1.16, 0.18, 0.16, 2.32)
    slab(g, steel, 0, -outer, L + 2.43, 1.74, 0.16, 0.22)
    const top = Math.min(L + LIFT_STEP, H)
    if (top > L + 2.58) slab(g, glass, 0, -outer, (L + 2.58 + top) / 2, 1.72, 0.025, top - L - 2.58)
    slab(g, mats.black, 0, -outer - 0.065, L + 2.43, 0.34, 0.02, 0.13)
    slab(g, mats.ledGreen, 0, -outer - 0.073, L + 2.43, 0.09, 0.012, 0.06)
    slab(g, steel, 0.79, -outer - 0.06, L + 1.12, 0.11, 0.025, 0.28)
    for (const h of [1.08, 1.17]) slab(g, mats.black, 0.79, -outer - 0.073, L + h, 0.045, 0.012, 0.04)
  }
  slab(g, steel, 0, 0, ceiling - LIFT_CAP / 2, 2.04, 2.04, LIFT_CAP)
  const cabin = new THREE.Group()
  g.add(cabin)
  g.userData.liftCabin = cabin
  slab(cabin, steel, 0, 0, 0.05, 1.5, 1.5, 0.1)
  slab(cabin, mats.rubber, 0, 0, 0.108, 1.36, 1.36, 0.015)
  slab(cabin, steel, 0, 0, 2.42, 1.54, 1.54, 0.12)
  slab(cabin, mats.glow, 0, 0, 2.34, 0.92, 0.92, 0.025)
  for (const x of [-0.72, 0.72]) {
    for (const y of [-0.72, 0.72]) slab(cabin, steel, x, y, 1.24, 0.055, 0.055, 2.32)
    slab(cabin, glass, x, 0, 1.3, 0.025, 1.38, 2.12).name = 'cabin-glass'
    slab(cabin, steel, x, 0, 0.2, 0.055, 1.44, 0.2)
    slab(cabin, steel, x * 0.9, 0, 1.02, 0.035, 1.16, 0.035)
  }
  slab(cabin, glass, 0, 0.72, 1.3, 1.38, 0.025, 2.12).name = 'cabin-glass'
  slab(cabin, steel, 0, 0.72, 0.2, 1.44, 0.055, 0.2)
  slab(cabin, steel, 0, 0.65, 1.02, 1.16, 0.035, 0.035)
  const doors: THREE.Mesh[] = []
  for (const s of [-1, 1]) {
    // Each frame is parented to its glass leaf so every detail slides with it.
    const leaf = slab(cabin, glass, s * 0.36, -0.73, 1.24, 0.72, 0.035, 2.15)
    for (const x of [-0.33, 0.33]) slab(leaf, steel, x, 0, 0, 0.06, 0.06, 2.15)
    for (const z of [-1.035, 1.035]) slab(leaf, steel, 0, 0, z, 0.72, 0.06, 0.08)
    slab(leaf, steel, 0, 0, -0.79, 0.72, 0.06, 0.45)
    slab(leaf, mats.psu, 0, -0.024, -0.16, 0.6, 0.012, 0.025)
    registerDoorLeaf(leaf, s, 0.7, doors)
  }
  g.userData.doors = doors
  return g
}

export class LiftModel extends PieceBuilder {
  readonly kind = 'lift'
  build(mod: Extract<Module, { type: 'lift' }>): THREE.Group {
    return mod.cfg.style === 'steel' ? buildLift(this.ctx, mod) : buildGlassLift(this.ctx, mod)
  }
}
