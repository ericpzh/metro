// Escalator (扶梯) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { ESCALATOR_BALUSTRADE, ESCALATOR_SPEED, ESCALATOR_STEP_PITCH } from '../../../sim/constants.ts'
import type { Module } from '../../../sim/types.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* --------------------------------------------------- ramp-adjacent blocks */

// A block a ramp kept is drawn by the chunk mesher, half a block thick, on the
// side away from the run (`thinWallCells` in `sim/openings.ts` → the `thin` map
// `scene.ts` hands `meshChunk`). It used to be drawn here as a single-material
// slab over a hidden voxel; routing it through the mesher is what made a stair's
// own half wall a real surface — its faces keep their own finishes, so the 材质
// brush paints it, and the drawn panel itself is what the pointer picks.

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
  /** Run length along the incline, metres. */
  runLen: number
  /** Step pitch along the incline, metres. */
  pitch: number
  /** +1 when the band carries a→b (which ascends), −1 when it descends. */
  dir: number
  /** Distance the band has rolled, wrapped into [0, runLen). */
  phase: number
  /** Tread yaw within the world-aligned band. */
  yaw: number
}

/** Wrap `v` into [0, m). */
function wrapMod(v: number, m: number): number {
  return ((v % m) + m) % m
}

// Scratch, reused across escalators and frames (rollEscalator runs every frame).
const _rot = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()

/** Advance a step band by `simDt` simulated seconds and repose every step. */
export function rollEscalator(roll: EscalatorRoll, simDt: number): void {
  roll.phase = wrapMod(roll.phase + roll.dir * ESCALATOR_SPEED * simDt, roll.runLen)
  _rot.makeRotationZ(roll.yaw)
  for (let i = 0; i < roll.count; i++) {
    const u = wrapMod(i * roll.pitch + roll.phase, roll.runLen)
    _p.copy(roll.climb).multiplyScalar(u)
    _m.makeTranslation(_p.x, _p.y, _p.z).multiply(_rot)
    for (const part of roll.parts) part.setMatrixAt(i, _m)
  }
  for (const part of roll.parts) part.instanceMatrix.needsUpdate = true
}

function buildEscalator(ctx: ModuleContext, mod: Extract<Module, { type: 'escalator' }>): THREE.Group {
  const mats = ctx.mats
  const a = new THREE.Vector3(mod.from.x + 0.5, mod.from.y + 0.5, mod.from.z + 1)
  const b = new THREE.Vector3(mod.to.x + 0.5, mod.to.y + 0.5, mod.to.z + 1)
  const len = a.distanceTo(b)
  const t = b.clone().sub(a).normalize()
  const up = new THREE.Vector3(0, 0, 1)
  const side = new THREE.Vector3().crossVectors(up, t).normalize()
  const n = new THREE.Vector3().crossVectors(t, side).normalize()
  const g = new THREE.Group()
  g.position.copy(a)
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, side, n))

  const W = ESCALATOR_BALUSTRADE // balustrade spacing
  const rise = 1.0 // handrail height
  // One run, one tile: the handrails reach only 0.49 m from the centreline, so the
  // whole assembly — truss, skirts, glass, rails — stays inside its own cell. Two
  // runs in adjacent cells therefore never touch: each keeps both of its
  // balustrades, and the pair reads as a bank of two rails side by side. Truss and
  // side skirts are trimmed to the run, so the ramp never pokes past its landings
  // into the floor it connects to.
  slab(g, mats.darkSteel, len / 2, 0, -0.3, len, W, 0.34)
  slab(g, mats.steel, len / 2, W / 2, 0.0, len, 0.06, 0.62)
  slab(g, mats.steel, len / 2, -W / 2, 0.0, len, 0.06, 0.62)

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
  const stepW = W - 0.14
  const nSteps = Math.max(4, Math.round(len / ESCALATOR_STEP_PITCH))
  const pitch = len / nSteps // along the incline
  const stepRise = Math.max(0.05, climb.z * pitch) // vertical rise per step
  const stepRun = Math.max(0.05, runPerM * pitch) // horizontal advance per step
  // A step is a tread at the incline line with a riser standing on its upper
  // edge, plus the yellow nosing along the leading edge (real escalator steps).
  const tread = new THREE.BoxGeometry(stepRun * 1.02, stepW, 0.06).translate(0, 0, -0.03)
  const riser = new THREE.BoxGeometry(0.05, stepW, stepRise).translate(stepRun / 2, 0, stepRise / 2)
  const nosing = new THREE.BoxGeometry(0.06, stepW, 0.08).translate(stepRun / 2 - 0.03, 0, -0.01)
  const stepGeo = mergeGeometries([tread, riser])
  tread.dispose()
  riser.dispose()
  const steps = new THREE.InstancedMesh(stepGeo ?? new THREE.BufferGeometry(), mats.steel, nSteps)
  steps.frustumCulled = false // the band is reposed every frame
  band.add(steps)
  const noseMesh = new THREE.InstancedMesh(nosing, mats.orange, nSteps)
  noseMesh.frustumCulled = false
  band.add(noseMesh)

  // Glass balustrades and black handrails. The handrail wraps the end of the
  // glass at both landings — a half-turn in the balustrade plane from the top
  // edge, round the end, and down onto the floor — instead of stopping dead in
  // mid-air, and a flat newel plate closes the foot of each balustrade.
  for (const s of [1, -1]) {
    slab(g, mats.glass, len / 2, (s * W) / 2, rise / 2, len, 0.03, rise)
    slab(g, mats.handrail, len / 2, (s * W) / 2 + s * 0.03, rise, len, 0.1, 0.08)
  }
  const railReturn = new THREE.TorusGeometry(rise / 2, 0.045, 8, 18, Math.PI)
  railReturn.rotateX(Math.PI / 2) // into the balustrade plane (local x-z)
  railReturn.rotateY(Math.PI / 2) // sweep top → +x → bottom
  for (const endX of [0, len]) {
    for (const s of [1, -1]) {
      const rail = new THREE.Mesh(railReturn, mats.handrail)
      rail.position.set(endX, s * (W / 2 + 0.03), rise / 2)
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
  const plateLen = 0.5
  // The band's outer tread overhangs the landing node by about `stepRun / 2`.
  // The plate starts just past that and is pulled a quarter tile (0.25 m) back
  // in from the previous stand-off, so it sits at the foot of the run.
  const inner = stepRun / 2 - 0.15
  for (const dir of [-1, 1]) {
    const end = dir < 0 ? new THREE.Vector3() : climb.clone().multiplyScalar(len)
    const out = hdir.clone().multiplyScalar(dir * (inner + plateLen / 2))
    const comb = slab(band, mats.orange, end.x + out.x, end.y + out.y, end.z + 0.04, plateLen, W - 0.2, 0.05)
    comb.rotation.z = yaw
  }
  const roll: EscalatorRoll = {
    parts: [steps, noseMesh],
    count: nSteps,
    climb,
    runLen: len,
    pitch,
    dir: ascends ? 1 : -1,
    phase: 0,
    yaw,
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
  return g
}

export class EscalatorModel extends PieceBuilder {
  readonly kind = 'escalator'
  build(mod: Extract<Module, { type: 'escalator' }>): THREE.Group {
    return buildEscalator(this.ctx, mod)
  }
}

