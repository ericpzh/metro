// Elevator (电梯) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { LIFT_STEP, liftStopZs } from '../../../sim/lifts.ts'
import { solidAt } from '../../../sim/ground.ts'
import type { Module, StationData } from '../../../sim/types.ts'

/**
 * Headroom above the top landing, so the cabin and its call panel fit: the shaft
 * runs on to just under the slab above that floor. It must stay below that slab,
 * so a platform piece tops out at the concourse ceiling (0 m), never through the
 * street floor.
 */
const LIFT_HEADROOM = 2.6

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
  const H = runH + LIFT_HEADROOM
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
  slab(g, mats.darkSteel, 0, 0, H + 0.06, 2.04, 2.04, 0.14)

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

export class LiftModel extends PieceBuilder {
  readonly kind = 'lift'
  build(mod: Extract<Module, { type: 'lift' }>): THREE.Group {
    return buildLift(this.ctx, mod)
  }
}

