// Escalator (扶梯) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { exitLandingHeight } from './ExitLanding.ts'
import { addRampJoins } from './RampJoinModel.ts'
import { addEscalatorIndicators } from './EscalatorIndicatorModel.ts'
import { ESCALATOR_SPEED, ESCALATOR_STEP_PITCH, ESCALATOR_FLAT_LENGTH, ESCALATOR_SURFACE_CLEARANCE, ESCALATOR_BASE_BURY } from '../../../sim/constants.ts'
import { escalatorBalustradeWidth, escalatorBodyWidth, escalatorBandWidth, escalatorRun, escalatorStepHeight } from '../../../sim/escalators.ts'
import { RAMP_FOOT } from '../../../sim/openings.ts'
import type { Module } from '../../../sim/types.ts'

/* --------------------------------------------------- ramp-adjacent blocks */

// A block a ramp kept is drawn by the chunk mesher, half a block thick, on the
// side away from the run (`thinWallCells` in `sim/openings.ts` → the `thin` map
// `scene.ts` hands `meshChunk`). It used to be drawn here as a single-material
// slab over a hidden voxel; routing it through the mesher is what made a stair's
// own half wall a real surface — its faces keep their own finishes, so the 材质
// brush paints it, and the drawn panel itself is what the pointer picks.

/* ----------------------------------------------------------------- the body */

/**
 * The truss box: `TRUSS_DROP` below the walking line to the middle of the ribbon, and
 * `TRUSS_DEPTH` thick. It is the piece's own shell — the solid under it is cut to the ground's
 * surface instead (`undercroftSolid`), which lands inside this box.
 */
const TRUSS_DROP = 0.3
const TRUSS_DEPTH = 0.34
/**
 * The **course** the ground under a run always stops short of, in metres. The 方块 brush may not
 * lay that last course — its top face would sit above the walking line, where the crowd's own
 * floor is measured — which is the whole reason a filling exists (`rampFillKeys`,
 * `sim/openings.ts`). It is what the solid under a truss is measured against: the body covers the
 * cells the ground's own filling covered along that course, and no further.
 */
const UNDERCROFT_COURSE = 1

/**
 * The solid under the truss — the escalator's **own** body, over the course the ground leaves.
 *
 * The piece is otherwise a shell, and the wedge under a run used to be drawn as a derived
 * surface that belongs to the **ground**: a cell the renderer filled only where a run hangs
 * directly over a block, which is one course deep and truss-width. The escalator carries that
 * body itself instead, drawn for every escalator rather than depending on the ground beneath it.
 *
 * Its lid follows the plane the ground under a run is **shaved to** (`RAMP_FOOT` below the walking
 * line, `rampSlopeCuts` in `sim/openings.ts`), inset by `ESCALATOR_SURFACE_CLEARANCE`. Its flanks
 * have the same inset from the truss and its base sits `ESCALATOR_BASE_BURY` below the floor.
 * These hidden joins avoid coplanar floor, terrain-cap and casing faces without exposing a gap:
 * the truss's underside hangs lower still, so the lid remains buried inside its box.
 * The lid follows that plane **to the body's very
 * end** rather than flattening off at the course line, so the end face meets the truss's own
 * underside instead of stopping a hand's width short of it and leaving a slit to see through.
 * The body reaches as far as the ground's filling did and no further: the cells the shaved plane
 * crosses inside one course, past which the run keeps the open underside it has always had.
 *
 * It is built in **world axes** — X up the run, Y up, Z across it — because its floor is
 * world-horizontal while its lid follows the incline; the caller places it at the lower landing
 * through the inverse of the run's own rotation, the idiom the step band already uses. `climb`
 * is the unit run from the lower landing to the upper one. Returns null for a run with no room
 * under it (a level one, or one whose lid is already on the floor).
 */
function undercroftSolid(climb: THREE.Vector3, len: number, width: number, mat: THREE.Material): THREE.Mesh | null {
  const cosT = Math.hypot(climb.x, climb.y)
  const sinT = climb.z
  if (sinT < 0.05 || cosT < 0.05) return null
  const slope = sinT / cosT
  const flat = len * cosT // the run's horizontal length
  const rise = len * sinT - RAMP_FOOT // the lid's height at the upper landing, inside the truss box
  const foot = RAMP_FOOT / slope // where the lid meets the floor: nothing below it to fill
  // How far along the run the body reaches: the far edge of the last cell the ground's own
  // filling covered, which is the last one the shaved plane crosses inside the course. Past it
  // the run is the open shell it has always been.
  const courseEnd = (RAMP_FOOT + UNDERCROFT_COURSE) / slope
  const end = Math.min(flat, rise <= UNDERCROFT_COURSE ? flat : 0.5 + Math.ceil(courseEnd - 0.5))
  // Its lid is the shaved plane **to its very end**, never flattened at the course line: the truss
  // box's underside hangs 6.5 cm lower the whole way, so a flat cap would leave the body's last
  // stretch — and the end face itself — standing in a slit under the truss instead of meeting it.
  const top = end * slope - RAMP_FOOT
  if (top < 0.05 || end < foot + 0.05) return null

  const section = new THREE.Shape()
  // Keep a closed body, but bury its base and inset its lid/flanks: sharing
  // the floor cap or the truss side plane causes depth-buffer flicker (§5.1).
  section.moveTo(foot, -ESCALATOR_BASE_BURY)
  section.lineTo(end, -ESCALATOR_BASE_BURY)
  section.lineTo(end, top - ESCALATOR_SURFACE_CLEARANCE)
  section.lineTo(foot, -ESCALATOR_SURFACE_CLEARANCE)
  section.closePath()
  const insetWidth = width - 2 * ESCALATOR_SURFACE_CLEARANCE
  const geo = new THREE.ExtrudeGeometry(section, { depth: insetWidth, bevelEnabled: false })
  geo.translate(0, 0, -insetWidth / 2) // centred on the run's own line

  const solid = new THREE.Mesh(geo, mat)
  solid.name = 'undercroft'
  return solid
}

/* -------------------------------------------------------------- escalator */

/**
 * One escalator's rolling step band. The treads are world-horizontal (a real
 * escalator keeps its steps level as the chain climbs), so a run reads as a
 * staircase instead of a smooth ramp; `rollEscalator` then slides them up the
 * incline and wraps them at the comb plates, so the band really turns over.
 */
export interface EscalatorRoll {
  /** Instanced meshes sharing one matrix per step (tread + yellow nosing). */
  parts: THREE.InstancedMesh[]
  /** The step count (one instance each). */
  count: number
  /** Unit vector up the incline, from the lower landing to the upper one. */
  climb: THREE.Vector3
  /** Complete exposed chain path including flat landing sections, metres. */
  runLen: number
  /** Step pitch along the incline, metres. */
  pitch: number
  /** +1 when the band carries a→b (which ascends), −1 when it descends. */
  dir: number
  /** Distance the band has rolled, wrapped into [0, runLen). */
  phase: number
  /** Tread yaw within the world-aligned band. */
  yaw: number
  /** Separate risers shrink to zero as adjacent treads reach the flat landings. */
  risers: THREE.InstancedMesh
  /** Length of the incline before the flat terminal tracks are added. */
  inclineLen: number
  /** Flat terminal length expressed in the chain's incline-distance parameter. */
  flat: number
  /** Horizontal tread depth and maximum riser height. */
  stepRun: number
  stepRise: number
}

/** Wrap `v` into [0, m). */
function wrapMod(v: number, m: number): number {
  return ((v % m) + m) % m
}

// Scratch, reused across escalators and frames (rollEscalator runs every frame).
const _rot = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _scale = new THREE.Vector3()

/** Advance a step band by `simDt` simulated seconds and repose every step. */
export function rollEscalator(roll: EscalatorRoll, simDt: number): void {
  roll.phase = wrapMod(roll.phase + roll.dir * ESCALATOR_SPEED * simDt, roll.runLen)
  _rot.makeRotationZ(roll.yaw)
  const horizontalPerM = Math.hypot(roll.climb.x, roll.climb.y)
  for (let i = 0; i < roll.count; i++) {
    const u = wrapMod(i * roll.pitch + roll.phase, roll.runLen)
    const along = u - roll.flat
    const height = escalatorStepHeight(along, roll.inclineLen, roll.climb.z, horizontalPerM)
    _p.set(roll.climb.x * along, roll.climb.y * along, height + 0.015)
    _m.makeTranslation(_p.x, _p.y, _p.z).multiply(_rot)
    // The chain returns beneath the fixed combs. Wrap only while covered, so
    // no full-height step pops from the upper landing back onto the lower one.
    const covered = along < -roll.flat + roll.pitch / 2 || along > roll.inclineLen + roll.flat - roll.pitch / 2
    if (covered) _m.scale(_scale.set(0, 0, 0))
    for (const part of roll.parts) part.setMatrixAt(i, _m)
    const nextHeight = escalatorStepHeight(along + roll.pitch, roll.inclineLen, roll.climb.z, horizontalPerM)
    const riserHeight = nextHeight - height
    _m.makeTranslation(_p.x, _p.y, _p.z).multiply(_rot)
    if (covered || riserHeight < 1e-6) _m.scale(_scale.set(0, 0, 0))
    else _m.scale(_scale.set(1, 1, riserHeight / roll.stepRise))
    roll.risers.setMatrixAt(i, _m)
  }
  for (const part of roll.parts) part.instanceMatrix.needsUpdate = true
  roll.risers.instanceMatrix.needsUpdate = true
}

function buildEscalator(ctx: ModuleContext, mod: Extract<Module, { type: 'escalator' }>): THREE.Group {
  const mats = ctx.mats
  const run = escalatorRun(mod)
  const a = new THREE.Vector3(run.from.x + 0.5, run.from.y + 0.5, run.from.z + 1 + exitLandingHeight(ctx.data.modules, run.from))
  const b = new THREE.Vector3(run.to.x + 0.5, run.to.y + 0.5, run.to.z + 1 + exitLandingHeight(ctx.data.modules, run.to))
  const len = a.distanceTo(b)
  const t = b.clone().sub(a).normalize()
  const up = new THREE.Vector3(0, 0, 1)
  const side = new THREE.Vector3().crossVectors(up, t).normalize()
  const n = new THREE.Vector3().crossVectors(t, side).normalize()
  const g = new THREE.Group()
  g.position.copy(a)
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, side, n))

  const W = escalatorBodyWidth(mod)
  const railW = escalatorBalustradeWidth(mod)
  const rise = 1.0 // handrail height
  // One continuous band with rails on its outer edges (§5.1). Narrow occupies
  // one block; wide adds a block to the band, truss and plates together, so no
  // centre balustrade divides it into two escalators. Both fit their own cells.
  const truss = slab(g, mats.darkSteel, len / 2, 0, -TRUSS_DROP, len, W, TRUSS_DEPTH)
  truss.name = 'truss'
  const stepW = escalatorBandWidth(mod)
  const skirtW = (W - stepW) / 2 + 0.03
  for (const s of [-1, 1]) {
    const skirt = slab(g, mats.steel, len / 2, s * (stepW / 2 + skirtW / 2), 0, len, skirtW, 0.62)
    skirt.name = 'side-skirt'
  }

  // The step band lives in a child that cancels the truss's rotation, so a box
  // left unrotated about z keeps its top face level and the run reads as steps.
  const ascends = b.z >= a.z
  const lower = ascends ? a : b
  const climb = t.clone().multiplyScalar(ascends ? 1 : -1) // unit, lower → upper
  const runPerM = Math.hypot(climb.x, climb.y) // horizontal advance per metre climbed
  const band = new THREE.Group()
  band.quaternion.copy(g.quaternion).invert()
  band.position.copy(lower).sub(a).applyQuaternion(band.quaternion)
  g.add(band)

  const yaw = Math.atan2(climb.y, climb.x)
  const flat = ESCALATOR_FLAT_LENGTH / runPerM
  const chainLen = len + 2 * flat
  const nSteps = Math.max(4, Math.round(chainLen / ESCALATOR_STEP_PITCH))
  const pitch = chainLen / nSteps // same horizontal pitch through incline and flats
  const stepRise = Math.max(0.05, climb.z * pitch) // vertical rise per step
  const stepRun = Math.max(0.05, runPerM * pitch) // horizontal advance per step
  // Separate treads and risers: the latter collapse as the chain levels out at
  // each landing, while the horizontal treads continue beneath the comb teeth.
  const tread = new THREE.BoxGeometry(stepRun * 1.02, stepW, 0.06).translate(0, 0, -0.03)
  const riser = new THREE.BoxGeometry(0.05, stepW, stepRise).translate(stepRun / 2, 0, stepRise / 2)
  const nosing = new THREE.BoxGeometry(0.06, stepW, 0.08).translate(stepRun / 2 - 0.03, 0, -0.01)
  const steps = new THREE.InstancedMesh(tread, mats.steel, nSteps)
  steps.frustumCulled = false // the band is reposed every frame
  band.add(steps)
  const noseMesh = new THREE.InstancedMesh(nosing, mats.orange, nSteps)
  noseMesh.frustumCulled = false
  band.add(noseMesh)
  const risers = new THREE.InstancedMesh(riser, mats.steel, nSteps)
  risers.frustumCulled = false
  band.add(risers)

  // Glass balustrades and black handrails. The handrail wraps the end of the
  // glass at both landings — a half-turn in the balustrade plane from the top
  // edge, round the end, and down onto the floor — instead of stopping dead in
  // mid-air, and a flat newel plate closes the foot of each balustrade.
  for (const s of [1, -1]) {
    slab(g, mats.glass, len / 2, (s * railW) / 2, rise / 2, len, 0.03, rise)
    slab(g, mats.handrail, len / 2, (s * railW) / 2 + s * 0.03, rise, len, 0.1, 0.08)
  }
  const railReturn = new THREE.TorusGeometry(rise / 2, 0.045, 8, 18, Math.PI)
  railReturn.rotateX(Math.PI / 2) // into the balustrade plane (local x-z)
  railReturn.rotateY(Math.PI / 2) // sweep top → +x → bottom
  for (const endX of [0, len]) {
    for (const s of [1, -1]) {
      const rail = new THREE.Mesh(railReturn, mats.handrail)
      rail.position.set(endX, s * (railW / 2 + 0.03), rise / 2)
      if (endX === 0) rail.rotation.z = Math.PI // bulge the other way at the start
      g.add(rail)
    }
  }
  // Newel ends at both landings. The comb plates are separate: they are level
  // plates on the floor of each storey where the steps emerge. Each is pushed
  // out past the run's last tread (which overhangs the landing node) so the
  // rotating steps pass clear of it instead of clipping through.
  slab(g, mats.steel, 0.05, 0, -0.02, 0.5, W, 0.06)
  slab(g, mats.steel, len - 0.05, 0, -0.02, 0.5, W, 0.06)
  const hdir = new THREE.Vector3(climb.x, climb.y, 0).normalize()
  // The solid under the truss. `g` carries the run's own incline, so the wedge — built in
  // world axes, its floor level and its lid on the incline — goes in through the inverse of
  // that rotation, exactly as the step band does.
  const solid = undercroftSolid(climb, len, W, mats.darkSteel)
  if (solid) {
    const inv = g.quaternion.clone().invert()
    const across = new THREE.Vector3().crossVectors(hdir, up).normalize() // (hdir, up, across) is right-handed
    solid.quaternion
      .copy(inv)
      .multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(hdir, up, across)))
    solid.position.copy(lower).sub(a).applyQuaternion(inv)
    g.add(solid)
    g.userData.undercroft = solid
  }
  const plateLen = 0.3
  for (const dir of [-1, 1]) {
    const end = dir < 0 ? new THREE.Vector3() : climb.clone().multiplyScalar(len)
    const out = hdir.clone().multiplyScalar(dir * (ESCALATOR_FLAT_LENGTH - plateLen / 2))
    const comb = slab(band, mats.orange, end.x + out.x, end.y + out.y, end.z + 0.045, plateLen, stepW, 0.05)
    comb.rotation.z = yaw
    comb.name = 'comb-plate'
    // Cover the outer half of the landing block cut beneath the flat track.
    const halfW = mod.cfg.width === 2 ? 1 : 0.5
    const inner = ESCALATOR_FLAT_LENGTH - plateLen
    // A U-shaped deck leaves the moving flat treads exposed right up to the
    // comb teeth. Its shoulders replace the cut block beside the step band.
    const deckShape = new THREE.Shape()
    deckShape.moveTo(0, -halfW)
    deckShape.lineTo(ESCALATOR_FLAT_LENGTH, -halfW)
    deckShape.lineTo(ESCALATOR_FLAT_LENGTH, halfW)
    deckShape.lineTo(0, halfW)
    deckShape.lineTo(0, stepW / 2)
    deckShape.lineTo(inner, stepW / 2)
    deckShape.lineTo(inner, -stepW / 2)
    deckShape.lineTo(0, -stepW / 2)
    deckShape.closePath()
    const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: 0.09, bevelEnabled: false })
    deckGeo.translate(0, 0, -0.09)
    const deck = new THREE.Mesh(deckGeo, mats.steel)
    deck.position.copy(end)
    deck.position.z += ESCALATOR_SURFACE_CLEARANCE // lower apron overlays real floor
    deck.rotation.z = yaw + (dir < 0 ? Math.PI : 0)
    band.add(deck)
    deck.name = 'landing-deck'
  }
  const roll: EscalatorRoll = {
    parts: [steps, noseMesh],
    count: nSteps,
    climb,
    runLen: chainLen,
    pitch,
    dir: ascends ? 1 : -1,
    phase: 0,
    yaw,
    risers,
    inclineLen: len,
    flat,
    stepRun,
    stepRise,
  }
  rollEscalator(roll, 0) // seat the band before its first animated frame
  g.userData.escalator = roll

  // Placement ghost only: a bright arrow over the run showing travel direction.
  // Local +x already runs `from → to` (the travel direction), so the arrow always
  // points that way — up an up escalator, down a down one.
  if (ctx.preview) {
    const arrowZ = rise + 0.5
    slab(g, mats.ledGreen, len * 0.33, 0, arrowZ, len * 0.5, 0.18, 0.1)
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), mats.ledGreen)
    head.rotation.z = -Math.PI / 2 // cone points +y by default; aim it +x
    head.position.set(len * 0.62, 0, arrowZ)
    g.add(head)
  }
  addRampJoins(ctx, mod, g)
  addEscalatorIndicators(ctx, g, len, railW)
  return g
}

export class EscalatorModel extends PieceBuilder {
  readonly kind = 'escalator'
  build(mod: Extract<Module, { type: 'escalator' }>): THREE.Group {
    return buildEscalator(this.ctx, mod)
  }
}
