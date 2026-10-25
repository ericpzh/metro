// Elevator (电梯) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, registerDoorLeaf, ownedMaterial } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { LIFT_STEP, liftLandingRows, liftLevels, liftServesSide, liftSizeOf, liftStops } from '../../../sim/lifts.ts'
import { solidAt } from '../../../sim/ground.ts'
import type { Module, StationData } from '../../../sim/types.ts'
import { omitModelDetail, tubeModelDetail } from '../../modelDetail.ts'

/** Wall centre-line of the 2 × 2 小 assembly; the 大 one scales this in plan. */
const LIFT_OUTER = 0.94

/**
 * A reachable floor selector inside the moving cabin, beside its front door.
 * `k` is the plan scale (`size / 2`): x/y widths grow with the 大 shaft, the
 * panel heights do not.
 */
function cabinPanel(cabin: THREE.Group, mats: ModuleContext['mats'], levels: number, k = 1): void {
  slab(cabin,mats.darkSteel,.697*k,-.38*k,1.12,.026*k,.19*k,.42).name='lift-floor-panel'
  slab(cabin,mats.screen,.680*k,-.38*k,1.27,.009*k,.14*k,.07)
  for (let i=0;i<Math.min(6,levels);i++) {
    slab(cabin,mats.steel,.678*k,-.38*k,1.18-i*.045,.012*k,.055*k,.025)
  }
}
/** The end caps' thickness, metres: a closed plate at each end of the shaft. */
const LIFT_CAP = 0.14
/** Keep the roof cap inside the two-metre module boundary to clear adjacent blocks. */
const LIFT_CAP_PLAN = 1.98
/** 1.44 m clear carriage. */
const LIFT_INNER = 0.72
/** How far up the doorway is cut before the header closes it (metres). */
const LIFT_DOORWAY_H = 2.58

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

/** Two telescoping panels per half, running on separate depth tracks.
 * The inner panel catches the slower outer panel at the jamb; neither leaves
 * the shaft envelope. The small lap keeps the closed seam covered.
 */
const LIFT_PANEL_W = 0.378
function telescopingDoors(
  parent: THREE.Group, panel: THREE.Material, steel: THREE.Material,
  y: number, z: number, height: number, trackStep: number,
  glazed: boolean, doors: THREE.Mesh[], side?: number, landing = false,
  stripe?: THREE.Material, k = 1,
): void {
  for (const sign of [-1, 1]) for (let i = 0; i < 2; i++) {
    const leaf = slab(parent, panel, sign * (0.18 + i * 0.36) * k, y + i * trackStep, z, LIFT_PANEL_W * k, 0.035 * k, height)
    leaf.name = landing ? 'landing-door-leaf' : 'cabin-door-leaf'
    if (glazed) {
      for (const x of [-1, 1]) slab(leaf, steel, x * (LIFT_PANEL_W / 2 - 0.025) * k, 0, 0, 0.05 * k, 0.06 * k, height)
      for (const edge of [-1, 1]) slab(leaf, steel, 0, 0, edge * (height / 2 - 0.04), LIFT_PANEL_W * k, 0.06 * k, 0.08)
      slab(leaf, steel, 0, 0, -height / 2 + 0.265, LIFT_PANEL_W * k, 0.06 * k, 0.45)
      if (stripe) slab(leaf, stripe, 0, (y > 0 ? 0.024 : -0.024) * k, -0.16, (LIFT_PANEL_W - 0.08) * k, 0.012 * k, 0.025)
    }
    registerDoorLeaf(leaf, sign, i === 0 ? 0.50 : 0.14, doors, side)
  }
}

/**
 * Landing doors stay on the shaft; car doors travel with the cabin (§5.1).
 *
 * A storey's doors are built on **one face** at a time: the group carries the
 * face's own y and a `bank` (1 front / local −y, 2 back / local +y), which
 * `LiftSystem` reads so a through-floor only opens the side the car was called
 * to. The leaves themselves are built at the group's origin so the same
 * geometry serves either face.
 */
function landingDoors(g: THREE.Group, height: number, back: boolean, panel: THREE.Material, steel: THREE.Material, glazed: boolean, k = 1): void {
  const side = back ? 1 : -1
  const landing = new THREE.Group()
  landing.name = back ? 'landing-doors-back' : 'landing-doors-front'
  landing.userData.bank = back ? 2 : 1
  landing.position.set(0, side * 0.82 * k, height)
  g.add(landing)
  const doors: THREE.Mesh[] = []
  telescopingDoors(landing, panel, steel, 0, 1.19, 2.24, side * 0.075 * k, glazed, doors, undefined, true, undefined, k)
  landing.userData.doors = doors
  const landings = (g.userData.liftLandings ??= []) as THREE.Group[]
  landings.push(landing)
}

/** The steel lift's threshold, jambs, header and call panel on one face. */
function steelLandingPortal(g: THREE.Group, height: number, back: boolean, mats: ModuleContext['mats'], k = 1): void {
  const side = back ? 1 : -1
  const y = side * LIFT_OUTER * k
  landingDoors(g, height, back, mats.steel, mats.steel, false, k)
  for (const x of [-0.79, 0.79]) slab(g, mats.darkSteel, x * k, y, height + 1.16, 0.18 * k, 0.16 * k, 2.32)
  slab(g, mats.darkSteel, 0, y, height + 2.43, 1.74 * k, 0.16 * k, 0.22)
  slab(g, mats.darkSteel, 0, y - side * 0.02 * k, height + 0.03, 1.9 * k, 0.22 * k, 0.06)
  slab(g, mats.black, 0.6 * k, y + side * 0.03 * k, height + 1.35, 0.3 * k, 0.04 * k, 0.18)
  slab(g, mats.ledGreen, 0.6 * k, y + side * 0.05 * k, height + 1.35, 0.12 * k, 0.02 * k, 0.07)
}

/** The glazed lift's stainless portal and transom on one face. */
function glassLandingPortal(
  g: THREE.Group,
  height: number,
  back: boolean,
  shaftH: number,
  mats: ModuleContext['mats'],
  steel: THREE.Material,
  glass: THREE.Material,
  step = LIFT_STEP,
  k = 1,
): void {
  const side = back ? 1 : -1
  const y = side * LIFT_OUTER * k
  landingDoors(g, height, back, glass, steel, true, k)
  slab(g, steel, 0, y - side * 0.04 * k, height + 0.035, 1.88 * k, 0.22 * k, 0.07)
  // Stainless landing portal and its glazed transom leave the doorway clear.
  for (const x of [-0.79, 0.79]) slab(g, steel, x * k, y, height + 1.16, 0.18 * k, 0.16 * k, 2.32)
  slab(g, steel, 0, y, height + 2.43, 1.74 * k, 0.16 * k, 0.22)
  const top = Math.min(height + step, shaftH)
  if (top > height + LIFT_DOORWAY_H) slab(g, glass, 0, y, (height + LIFT_DOORWAY_H + top) / 2, 1.72 * k, 0.025 * k, top - height - LIFT_DOORWAY_H)
  slab(g, mats.black, 0, y + side * 0.065 * k, height + 2.43, 0.34 * k, 0.02 * k, 0.13)
  slab(g, mats.ledGreen, 0, y + side * 0.073 * k, height + 2.43, 0.09 * k, 0.012 * k, 0.06)
  slab(g, steel, 0.79 * k, y + side * 0.06 * k, height + 1.12, 0.11 * k, 0.025 * k, 0.28)
  for (const h of [1.08, 1.17]) slab(g, mats.black, 0.79 * k, y + side * 0.073 * k, height + h, 0.045 * k, 0.012 * k, 0.04)
}

/** A shaft storey that opens onto `back` really has a landing to open onto. */
/**
 * A level has a landing door when the floor a passenger stands on in front of
 * that face is real. The shaft cells themselves are usually cut out of the slab
 * above (the cabin travels through), so asking them would refuse every upper
 * level its door even though the landing row is solid.
 */
function landingFloorAt(data: StationData, mod: Extract<Module, { type: 'lift' }>, z: number, side: 'front' | 'back'): boolean {
  const rows = liftLandingRows(mod, z)
  const both = liftServesSide(mod.cfg, z, 'front') && liftServesSide(mod.cfg, z, 'back')
  const row = side === 'front' ? rows[0] : both ? rows[1] : rows[0]
  return !!row?.some(([x, y]) => floorAt(data, x, y, z))
}

function backLandingAt(data: StationData, mod: Extract<Module, { type: 'lift' }>, z: number): boolean {
  return liftServesSide(mod.cfg, z, 'back') && landingFloorAt(data, mod, z, 'back')
}

/** True when any served storey opens a back door, so the cabin needs one too. */
function hasBackLandings(data: StationData, mod: Extract<Module, { type: 'lift' }>): boolean {
  return liftLevels(mod).some((z) => backLandingAt(data, mod, z))
}

/** The moving steel cabin leaves of one face (front −1 or back +1 bank). */
function steelCabinDoors(cabin: THREE.Group, back: boolean, mats: ModuleContext['mats'], doors: THREE.Mesh[], k = 1): void {
  const y = back ? (LIFT_INNER - 0.02) * k : (-LIFT_INNER + 0.02) * k
  telescopingDoors(cabin, mats.black, mats.steel, y, 1.24, 2.15, (back ? -0.075 : 0.075) * k, false, doors, back ? 1 : -1, false, undefined, k)
}

/** The moving glass cabin leaves of one face, frames printed onto each leaf. */
function glassCabinDoors(cabin: THREE.Group, back: boolean, mats: ModuleContext['mats'], steel: THREE.Material, glass: THREE.Material, doors: THREE.Mesh[], k = 1): void {
  const y = back ? 0.73 * k : -0.73 * k
  telescopingDoors(cabin, glass, steel, y, 1.24, 2.15, (back ? -0.075 : 0.075) * k, true, doors, back ? 1 : -1, false, mats.psu, k)
}

/**
 * An elevator (电梯). A 2 × 2 小 or 3 × 3 大 vertical shaft with a moving
 * 1.5 × 1.5 m 小 (2.25 × 2.25 m 大) cabin:
 * a steel frame and back/side walls, landing doors, a threshold and a
 * call panel at every **level** (a story's base), and a cabin whose doors
 * slide apart. The shaft is exactly the stacked stories, closed by a cap
 * at each end; the top of the last story is the cap, not a landing. Each level's
 * doorway and the cabin's headroom live in the story above it, so a fresh piece
 * is one level. Only real levels get a sill/panel — a shaft that runs past a
 * floorless level shows nothing there. The glass housing also glazes the door
 * side from above each doorway to the story's top, so an extension never leaves
 * a bare frame. The cabin group is left in
 * `userData.liftCabin` and its leaves are registered as doors, so
 * `SceneRenderer.setLifts` can travel the cabin and ease the doors from the sim
 * car state. Built in world space so one model spans every storey of the shaft;
 * the group origin is the centre of the 2 × 2 or 3 × 3 plan.
 *
 * A storey may be configured to open its cabin doors on the front, the back or
 * both faces (§5.1): each face gets its own landing portal, and the back wall
 * (and the cabin's own back wall) is cut wherever a back door stands so the
 * doorway is real and not glassed over.
 */
function buildLift(ctx: ModuleContext, mod: Extract<Module, { type: 'lift' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const size = liftSizeOf(mod)
  const k = size / 2
  g.position.set(mod.x + k, mod.y + k, mod.from.z + 1)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2

  // The shaft is **exactly the stacked floor intervals**, closed by a cap at each
  // end. A story serves the level at its **base**: that level's landing door (and
  // the cabin's headroom) live in the story above it, so the top of the last story
  // is a cap, not a landing. Stacking a story therefore adds a level at its base
  // and moves the top cap up.
  const stops = liftStops(mod)
  const levels = liftLevels(mod)
  const stories = Math.max(0, stops.length - 1)
  const ceiling = Math.abs(mod.to.z - mod.from.z)
  const H = ceiling
  const midH = H / 2
  const anyBack = hasBackLandings(ctx.data, mod)
  const storyTop = (i: number): number => stops[i + 1] - mod.from.z
  const portalFits = (L: number, hi: number): boolean => L + LIFT_DOORWAY_H <= hi + 1e-6
  const portalAt = (z: number, side: 'front' | 'back'): boolean => liftServesSide(mod.cfg, z, side) && landingFloorAt(ctx.data, mod, z, side)
  const outer = LIFT_OUTER * k
  // The cap and the foot ring stay inside the plan they close: the 2 × 2 小
  // footprint keeps its old 1.98 m plate, the 3 × 3 大 one gets 2.97 m.
  const capPlan = LIFT_CAP_PLAN * k
  const ringDepth = 0.27 * k
  const ringOffset = size / 2 - ringDepth / 2 - 0.005
  const ringWidth = 2 * ringOffset + ringDepth
  const ringLength = 2 * ringOffset - ringDepth

  // Four corner posts and the side walls; the front (local −y) is the door side
  // and is glazed story by story in the glass housing. The back wall is drawn a
  // story at a time so a back-door story leaves a real doorway.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) slab(g, mats.darkSteel, sx * outer, sy * outer, midH, 0.14 * k, 0.14 * k, H)
  }
  if (anyBack) {
    // Cut a real doorway wherever a story opens its back doors; the wall resumes
    // above the header. A shaft with no back doors keeps its one solid slab.
    for (let i = 0; i < stories; i++) {
      const z = stops[i]
      const L = z - mod.from.z
      const hi = storyTop(i)
      const lo = portalAt(z, 'back') ? Math.max(L, L + LIFT_DOORWAY_H) : L
      if (hi - lo > 0.1) slab(g, mats.steel, 0, outer, (lo + hi) / 2, 1.74 * k, 0.12 * k, hi - lo)
    }
  } else {
    slab(g, mats.steel, 0, outer, midH, 1.74 * k, 0.12 * k, H)
  }
  // The front (door side) is walled above each doorway as well; only the
  // doorway itself is open, so a story never reads as a bare frame.
  for (let i = 0; i < stories; i++) {
    const z = stops[i]
    const L = z - mod.from.z
    const hi = storyTop(i)
    const lo = portalAt(z, 'front') ? Math.max(L, L + LIFT_DOORWAY_H) : L
    if (hi - lo > 0.1) slab(g, mats.steel, 0, -outer, (lo + hi) / 2, 1.74 * k, 0.12 * k, hi - lo)
  }
  slab(g, mats.steel, -outer, 0, midH, 0.12 * k, 1.74 * k, H)
  slab(g, mats.steel, outer, 0, midH, 0.12 * k, 1.74 * k, H)

  // A threshold sill and a call panel at every level with a doorway below its
  // story's top, on each face the level opens onto.
  for (const z of levels) {
    const L = z - mod.from.z
    const i = stops.indexOf(z)
    const hi = i >= 0 && i < stories ? storyTop(i) : ceiling
    if (!portalFits(L, hi)) continue
    if (portalAt(z, 'front')) steelLandingPortal(g, L, false, mats, k)
    if (portalAt(z, 'back')) steelLandingPortal(g, L, true, mats, k)
  }

  // A closed plate at the top; the bottom cap is a ring around the cabin so the
  // car sits on the station floor while the shaft still closes at its own foot.
  // Both sit **inside** the intervals, so the piece is still exactly its rise.
  slab(g, mats.darkSteel, 0, 0, H - LIFT_CAP / 2, capPlan, capPlan, LIFT_CAP).name = 'lift-cap-top'
  for (const y of [-ringOffset, ringOffset]) slab(g, mats.darkSteel, 0, y, LIFT_CAP / 2, ringWidth, ringDepth, LIFT_CAP).name = 'lift-cap-bottom'
  for (const x of [-ringOffset, ringOffset]) slab(g, mats.darkSteel, x, 0, LIFT_CAP / 2, ringDepth, ringLength, LIFT_CAP).name = 'lift-cap-bottom'

  // The cabin: floor, roof, sides, with telescoping door panels on each face it
  // serves. Its local origin is the cabin floor, so the renderer only sets z.
  const cabin = new THREE.Group()
  g.add(cabin)
  g.userData.liftCabin = cabin
  cabinPanel(cabin,mats,levels.length,k)
  slab(cabin, mats.steel, 0, 0, 0.05, 1.5 * k, 1.5 * k, 0.1)
  slab(cabin, mats.darkSteel, 0, 0, 2.42, 1.54 * k, 1.54 * k, 0.12)
  slab(cabin, mats.steel, -LIFT_INNER * k, 0, 1.24, 0.06 * k, 1.44 * k, 2.32)
  slab(cabin, mats.steel, LIFT_INNER * k, 0, 1.24, 0.06 * k, 1.44 * k, 2.32)
  // Interior light, and a mirror on the back wall when it is not a doorway.
  slab(cabin, mats.glow, 0, 0, 2.3, 0.9 * k, 0.9 * k, 0.04)
  const doors: THREE.Mesh[] = []
  if (anyBack) {
    steelCabinDoors(cabin, true, mats, doors, k)
  } else {
    slab(cabin, mats.steel, 0, LIFT_INNER * k, 1.24, 1.5 * k, 0.06 * k, 2.32)
    plate(cabin, mats.screen, 0.9 * k, 1.2 * k, 0, (LIFT_INNER - 0.04) * k, 1.3, Math.PI)
  }
  steelCabinDoors(cabin, false, mats, doors, k)
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
  const size = liftSizeOf(mod)
  const k = size / 2
  g.position.set(mod.x + k, mod.y + k, mod.from.z + 1)
  g.rotation.z = ((mod.rot ?? 0) * Math.PI) / 2
  // Exactly the stacked floor intervals, closed by a cap at each end. Each story
  // serves the level at its base, so the door side is glazed from above that
  // level's doorway to the story's top.
  const stops = liftStops(mod)
  const levels = liftLevels(mod)
  const stories = Math.max(0, stops.length - 1)
  const ceiling = Math.abs(mod.to.z - mod.from.z)
  const H = ceiling
  const outer = LIFT_OUTER * k
  const capPlan = LIFT_CAP_PLAN * k
  const ringDepth = 0.27 * k
  const ringOffset = size / 2 - ringDepth / 2 - 0.005
  const ringWidth = 2 * ringOffset + ringDepth
  const ringLength = 2 * ringOffset - ringDepth
  const anyBack = hasBackLandings(ctx.data, mod)
  const storyTop = (i: number): number => stops[i + 1] - mod.from.z
  const portalFits = (L: number, hi: number): boolean => L + LIFT_DOORWAY_H <= hi + 1e-6
  const portalAt = (z: number, side: 'front' | 'back'): boolean => liftServesSide(mod.cfg, z, side) && landingFloorAt(ctx.data, mod, z, side)
  for (const x of [-outer, outer]) {
    for (const y of [-outer, outer]) {
      slab(g, steel, x, y, H / 2, 0.14 * k, 0.14 * k, H).name = 'shaft-post'
      slab(g, steel, x, y, 0.04, 0.16 * k, 0.16 * k, 0.08)
    }
  }
  // Panel bays have actual seams, framing and clamps rather than one tall pane.
  for (let bottom = 0; bottom < H; bottom += 2) {
    const top = Math.min(bottom + 2, H)
    const mid = (bottom + top) / 2
    for (const x of [-outer, outer]) {
      slab(g, glass, x, 0, mid, 0.025 * k, 1.72 * k, top - bottom - 0.08).name = 'shaft-glass'
      slab(g, steel, x, 0, bottom + 0.04, 0.12 * k, 1.74 * k, 0.08).name = 'shaft-crossbeam'
      for (const y of [-0.82 * k, 0.82 * k]) {
        for (const z of [bottom + 0.18, top - 0.18]) slab(g, steel, x, y, z, 0.05 * k, 0.08 * k, 0.07)
      }
    }
  }
  // The door side (front, local −y) and the back wall are glazed story by story:
  // a story whose landing opens on a face is cut open at the doorway (the leaves
  // and header fill it) and glassed from above it to the story's top, so an
  // extension never leaves a bare frame in the door side.
  const storyGlass = (side: 'front' | 'back', y: number): void => {
    for (let i = 0; i < stories; i++) {
      const z = stops[i]
      const L = z - mod.from.z
      const hi = storyTop(i)
      const lo = portalAt(z, side) ? Math.max(L, L + LIFT_DOORWAY_H) : L
      for (let bottom = lo; bottom < hi; bottom += 2) {
        const top = Math.min(bottom + 2, hi)
        if (top - bottom <= 0.1) break
        slab(g, glass, 0, y, (bottom + top) / 2, 1.72 * k, 0.025 * k, top - bottom - 0.08).name = 'shaft-glass'
        slab(g, steel, 0, y, bottom + 0.04, 1.74 * k, 0.12 * k, 0.08).name = 'shaft-crossbeam'
      }
    }
  }
  storyGlass('front', -outer)
  storyGlass('back', outer)
  // The car's black guide rails run up the two side walls, clear of both door faces.
  // Stop them at the top cap's underside; carrying them through the plate leaves
  // dark marks visible on the lift roof.
  const guideHeight = H - LIFT_CAP
  for (const side of [-1, 1]) {
    slab(g, mats.darkSteel, side * 0.84 * k, 0, guideHeight / 2, 0.055 * k, 0.065 * k, guideHeight).name = 'guide-rail'
    for (let z = 0.4; z < H; z += 2) {
      slab(g, steel, side * 0.88 * k, 0, z, 0.13 * k, 0.16 * k, 0.06).name = 'guide-rail-bracket'
    }
  }
  for (const z of levels) {
    const L = z - mod.from.z
    const i = stops.indexOf(z)
    const hi = i >= 0 && i < stories ? storyTop(i) : ceiling
    if (!portalFits(L, hi)) continue
    // The story glass covers above the doorway; the portal itself is frame + leaves.
    if (portalAt(z, 'front')) glassLandingPortal(g, L, false, H, mats, steel, glass, LIFT_DOORWAY_H, k)
    if (portalAt(z, 'back')) glassLandingPortal(g, L, true, H, mats, steel, glass, LIFT_DOORWAY_H, k)
  }
  // Closed caps at the shaft's two ends, both inside the interval: a plate over
  // the top and a ring around the cabin at the foot.
  slab(g, steel, 0, 0, H - LIFT_CAP / 2, capPlan, capPlan, LIFT_CAP).name = 'lift-cap-top'
  for (const y of [-ringOffset, ringOffset]) slab(g, steel, 0, y, LIFT_CAP / 2, ringWidth, ringDepth, LIFT_CAP).name = 'lift-cap-bottom'
  for (const x of [-ringOffset, ringOffset]) slab(g, steel, x, 0, LIFT_CAP / 2, ringDepth, ringLength, LIFT_CAP).name = 'lift-cap-bottom'
  const cabin = new THREE.Group()
  g.add(cabin)
  g.userData.liftCabin = cabin
  cabinPanel(cabin,mats,levels.length,k)
  const cabinDoors: THREE.Mesh[] = []
  g.userData.doors = cabinDoors
  slab(cabin, steel, 0, 0, 0.05, 1.5 * k, 1.5 * k, 0.1)
  slab(cabin, mats.rubber, 0, 0, 0.108, 1.36 * k, 1.36 * k, 0.015)
  slab(cabin, steel, 0, 0, 2.42, 1.54 * k, 1.54 * k, 0.12)
  slab(cabin, mats.glow, 0, 0, 2.34, 0.92 * k, 0.92 * k, 0.025)
  for (const x of [-0.72 * k, 0.72 * k]) {
    for (const y of [-0.72 * k, 0.72 * k]) slab(cabin, steel, x, y, 1.24, 0.055 * k, 0.055 * k, 2.32)
    slab(cabin, glass, x, 0, 1.3, 0.025 * k, 1.38 * k, 2.12).name = 'cabin-glass'
    slab(cabin, steel, x, 0, 0.2, 0.055 * k, 1.44 * k, 0.2)
    slab(cabin, steel, x * 0.9, 0, 1.02, 0.035 * k, 1.16 * k, 0.035)
  }
  if (anyBack) {
    glassCabinDoors(cabin, true, mats, steel, glass, cabinDoors, k)
  } else {
    slab(cabin, glass, 0, 0.72 * k, 1.3, 1.38 * k, 0.025 * k, 2.12).name = 'cabin-glass'
    slab(cabin, steel, 0, 0.72 * k, 0.2, 1.44 * k, 0.055 * k, 0.2)
    slab(cabin, steel, 0, 0.65 * k, 1.02, 1.16 * k, 0.035 * k, 0.035)
  }
  glassCabinDoors(cabin, false, mats, steel, glass, cabinDoors, k)
  return g
}

export class LiftModel extends PieceBuilder {
  readonly kind = 'lift'
  build(mod: Extract<Module, { type: 'lift' }>): THREE.Group {
    const model = mod.cfg.style === 'steel' ? buildLift(this.ctx, mod) : buildGlassLift(this.ctx, mod)
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      if (object.name === 'landing-door-leaf' || object.name === 'cabin-door-leaf') {
        for (const trim of object.children) omitModelDetail(trim, true)
      }
      if (object.name === 'lift-cap-bottom') { omitModelDetail(object); return }
      if (object.name === 'shaft-post') { tubeModelDetail(object); return }
      const geometry = object.geometry as THREE.BufferGeometry
      geometry.computeBoundingBox()
      const size = geometry.boundingBox!.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a)
      // Preserve shaft walls, portals and moving door leaves; remove clamps,
      // narrow frame trims, guide brackets and cabin instruments at a distance.
      if (size[0] < 0.4 || size[1] <= 0.12 || object.material === this.ctx.mats.glow || object.material === this.ctx.mats.screen) omitModelDetail(object)
    })
    return model
  }
}
