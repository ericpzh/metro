// The 闸机 in two states (GAME-SPEC §4.5, §5.2): a working **lane** (the default)
// and the **fence** machine that closes a run. Tab toggles the two. Which hand the
// lane is on is not a setting — `R` turns the whole piece, so the mirrored gate is
// a half turn — while the fence machine keeps its body on one half of the block
// with fence on the other: nothing walks through it, no fare line is crossed at
// it, and a 围栏 run is carried on through its own cell.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildGraph } from '../src/sim/station.ts'
import { GATE_DOORS, gateDoorOf, gateHasLane, gateMachineSide, gateSolidFaces, nextGateDoor } from '../src/sim/gates.ts'
import { placementPreviewKey } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { createModule } from '../src/build/model.ts'

test('Tab toggles the 闸机 between a working lane and the fence machine', () => {
  assert.deepEqual([...GATE_DOORS], ['lane', 'fence'])
  assert.equal(nextGateDoor('lane'), 'fence')
  assert.equal(nextGateDoor('fence'), 'lane')
  // A gate with no door field is a lane, so Tab steps off the default.
  assert.equal(nextGateDoor(undefined), 'fence')
  assert.equal(gateDoorOf({ cfg: {} }), 'lane')
  assert.equal(gateHasLane({ cfg: {} }), true)
  assert.equal(gateHasLane({ cfg: { door: 'fence' } }), false)
  // A save written while the door *side* was a setting reads as a lane whichever
  // hand it named — the mirror is a rotation now — and the old `none` as fence.
  for (const legacy of ['right', 'left']) assert.equal(gateDoorOf({ cfg: { door: legacy } }), 'lane', legacy)
  assert.equal(gateDoorOf({ cfg: { door: 'none' } }), 'fence')
  // The piece carries the tool's choice, and a legacy caller gets the default.
  assert.equal(createModule('gate', 0, 0, 0, 'g', 0, undefined, 'up', 'fence')?.cfg.door, 'fence')
  assert.equal(createModule('gate', 0, 0, 0, 'g2')?.cfg.door, 'lane')
})

test('the choice is in the key the viewport rebuilds its hover ghost from', () => {
  // Tab is not just tool state: the ghost already under the pointer has to be
  // redrawn the moment the choice changes, and the viewport does that by
  // subscribing to this one key (`placementPreviewKey`).
  const base = { moduleType: 'gate', moduleRot: 0, stairWidth: 0.7, escalatorDir: 'up', gateDoor: 'lane' }
  const key = placementPreviewKey(base)
  assert.equal(placementPreviewKey({ ...base }), key, 'the key must be stable')
  assert.notEqual(placementPreviewKey({ ...base, gateDoor: 'fence' }), key, 'the fence must rebuild the ghost')
  // Every other Tab cycle and R are in the same key, so one subscription covers
  // them all — and a new cycle joins by being added here.
  assert.notEqual(placementPreviewKey({ ...base, stairWidth: 1.4 }), key)
  assert.notEqual(placementPreviewKey({ ...base, escalatorDir: 'down' }), key)
  assert.notEqual(placementPreviewKey({ ...base, moduleRot: 1 }), key)
  assert.notEqual(placementPreviewKey({ ...base, moduleType: 'tvm' }), key)
})

test('and the scene rebuilds a gate ghost when the choice changes', () => {
  // The second half of the same contract: the renderer skips a rebuild whose
  // ghost key matches the one it is drawing, so the choice has to be in there
  // too — otherwise the viewport refreshes and the stale ghost stays up.
  const g = (door) => ({ id: 'g', type: 'gate', x: 3, y: 4, z: 0, rot: 0, cfg: { dir: 'both', door } })
  assert.notEqual(moduleGhostKey(g('lane')), moduleGhostKey(g('fence')))
  // The id is not part of it (a ghost is a prototype), the piece's cell and
  // rotation are.
  assert.equal(moduleGhostKey(g('lane')), moduleGhostKey({ ...g('lane'), id: 'other' }))
  assert.notEqual(moduleGhostKey({ ...g('lane'), x: 4 }), moduleGhostKey(g('lane')))
  assert.notEqual(moduleGhostKey({ ...g('lane'), rot: 1 }), moduleGhostKey(g('lane')))
  // No door field, or the old 右 / 左 spelling, reads as a lane; `none` as fence —
  // so an old piece's ghost key matches the piece it is drawn as.
  assert.equal(moduleGhostKey({ ...g('lane'), cfg: { dir: 'both' } }), moduleGhostKey(g('lane')))
  assert.equal(moduleGhostKey({ ...g('lane'), cfg: { dir: 'both', door: 'left' } }), moduleGhostKey(g('lane')))
  assert.equal(moduleGhostKey({ ...g('fence'), cfg: { dir: 'both', door: 'none' } }), moduleGhostKey(g('fence')))
})

const gate = (door, rot = 0, x = 0, y = 0) => ({ type: 'gate', x, y, z: 0, rot, cfg: { dir: 'both', door } })

/** `gateMachineSide` with −0 normalised, so the assertions stay readable. */
const side = (g) => gateMachineSide(g)?.map((v) => v + 0) ?? null

test('the machine side is the half the body stands on, turned by R', () => {
  // A lane gate builds its body on the cell's −x half, so only that side is
  // solid — the other half is the lane, which a fence must not run into.
  assert.deepEqual(side(gate('lane')), [-1, 0])
  assert.equal(gateSolidFaces(gate('lane'), -1, 0), true)
  assert.equal(gateSolidFaces(gate('lane'), 1, 0), false, 'the lane side is not the machine')
  assert.equal(gateSolidFaces(gate('lane'), 0, 1), false, 'nor is the crossing side')
  // R turns the whole piece, machine included — which is why there is no 左 / 右
  // setting any more: a half turn *is* the mirror.
  assert.deepEqual(side(gate('lane', 2)), [1, 0])
  assert.deepEqual(side(gate('lane', 1)), [0, -1])
  assert.deepEqual(side(gate('lane', 3)), [0, 1])
  // A fence machine puts fence on the lane's half, so it is solid all round.
  assert.equal(gateMachineSide(gate('fence')), null)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    assert.equal(gateSolidFaces(gate('fence', 2), dx, dy), true, `${dx},${dy}`)
  }
})

/** A 2 m corridor x=0..12: unpaid up to x=4, paid from x=5, one 闸机 at x=5. */
function corridor(door) {
  const cells = []
  for (let x = 0; x <= 12; x++) {
    for (let y = 0; y <= 1; y++) cells.push({ x, y, z: 0, fill: 'solid', zone: x <= 4 ? 'unpaid' : 'paid' })
  }
  const modules = [{ id: 'g1', type: 'gate', x: 5, y: 0, z: 0, cfg: { dir: 'both', door } }]
  return { name: 't', seed: 3, cells, modules, lines: [] }
}

function hasEdge(g, fromKey, toKey) {
  const a = g.nodeIndex.get(fromKey)
  const b = g.nodeIndex.get(toKey)
  if (a === undefined || b === undefined) return false
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return true
  return false
}

test('a fence machine is a barrier, not a lane', () => {
  const g = buildGraph(corridor('fence'))
  assert.equal(g.nodeIndex.has('5,0,0'), false, 'the crowd could walk through the solid machine')
  assert.equal(
    g.servers.some((s) => s.kind === 'gate'),
    false,
    'a fence machine has no lane to serve',
  )
  // It is no gate, so the fare line it stands on is not crossed at it.
  assert.equal(hasEdge(g, '4,0,0', '5,0,0'), false)

  // The same cell in its lane state is the crossing again — the body is where it
  // always was, so only the choice changed.
  const lane = buildGraph(corridor('lane'))
  assert.ok(lane.nodeIndex.has('5,0,0'), 'the lane must stay walkable')
  assert.equal(hasEdge(lane, '4,0,0', '5,0,0'), true, 'the lane must cross')
  assert.equal(lane.servers.some((s) => s.kind === 'gate'), true)
})

/** A build context with stand-in materials: no canvas, so it runs in Node. */
function ctxFor(modules) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial()) })
  return {
    mats,
    data: { name: 't', seed: 1, cells: [], modules, lines: [] },
    trackCells: new Set(),
    finish: () => mats.steel,
    preview: false,
  }
}

/** A built module's own extent, leaving its animated leaf out of the box. */
function bodyBox(group) {
  // The group's own world matrix first: `expandByObject` on a child alone would
  // read it in local space, where the module's cell offset is missing.
  group.updateWorldMatrix(false, true)
  const box = new THREE.Box3()
  for (const child of group.children) if (child !== group.userData.wing) box.expandByObject(child)
  return box
}

/** Every part of a built module, as a world-space box. */
function parts(group) {
  group.updateWorldMatrix(false, true)
  const out = []
  group.traverse((o) => {
    if (!o.isMesh) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    out.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld))
  })
  return out
}

/** The trapezoid prisms a gate draws — its tapered head and the cap over it. */
function prisms(group) {
  return group.children.filter((c) => c.geometry?.type === 'BufferGeometry' && c.geometry.getAttribute('position'))
}

/** The depth (y) of a prism's vertices at its own lowest and highest z. */
function taperOf(mesh) {
  const pos = mesh.geometry.getAttribute('position')
  let z0 = Infinity
  let z1 = -Infinity
  for (let i = 0; i < pos.count; i++) {
    z0 = Math.min(z0, pos.getZ(i))
    z1 = Math.max(z1, pos.getZ(i))
  }
  const depthAt = (z) => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - z) > 1e-6) continue
      lo = Math.min(lo, pos.getY(i))
      hi = Math.max(hi, pos.getY(i))
    }
    return hi - lo
  }
  return { base: depthAt(z0), top: depthAt(z1), z0, z1 }
}

test('the head is a trapezoid — its top is shorter than its base', () => {
  const group = buildModule(gate('lane'), ctxFor([]))
  const found = prisms(group)
  assert.equal(found.length, 2, 'the gate draws its sloped head and a cap over it')
  // The head is the tall one; the other is the thin cap on top of it.
  const head = found.reduce((a, b) => (taperOf(b).z1 - taperOf(b).z0 > taperOf(a).z1 - taperOf(a).z0 ? b : a))
  const { base, top, z0, z1 } = taperOf(head)
  assert.ok(Math.abs(base - 0.9) < 1e-6, `base depth was ${base}`)
  assert.ok(top < base, `the top must be shorter than the base (${top} vs ${base})`)
  // The taper is the reference's 115° shoulder: 25° off vertical. It has to be a
  // slope, not a step — every course between is narrower than the one below.
  const offVertical = (Math.atan((base - top) / 2 / (z1 - z0)) * 180) / Math.PI
  assert.ok(Math.abs(offVertical - 25) < 0.5, `shoulder was ${offVertical.toFixed(1)}° off vertical`)
  // …and the machine is the reference's 1250 mm overall, not a 1 m cube.
  const all = bodyBox(group)
  assert.ok(Math.abs(all.max.z - all.min.z - 1.25) < 1e-6, `height was ${all.max.z - all.min.z}`)
})

test('R is the mirror: a half turn puts the machine on the other hand', () => {
  const leaving = (rot) => {
    const group = buildModule(gate('lane', rot), ctxFor([]))
    group.updateWorldMatrix(false, true)
    return { body: bodyBox(group), leaf: new THREE.Box3().setFromObject(group.userData.wing) }
  }
  const straight = leaving(0)
  const turned = leaving(2)
  // `rot` 0 stands the body on the cell's −x half (world 0..0.5 for a gate at
  // x = 0) with the lane — and the leaf — on the other, which is the hand a 右
  // gate used to be.
  assert.ok(Math.abs(straight.body.min.x - 0) < 1e-6 && straight.body.max.x < 0.5)
  assert.ok(straight.leaf.min.x > 0.4 && Math.abs(straight.leaf.max.x - 1) < 1e-6)
  // A half turn swaps both, exactly as the old 左 did — so the mirror needs no
  // setting of its own.
  assert.ok(Math.abs(turned.body.max.x - 1) < 1e-6 && turned.body.min.x > 0.5)
  assert.ok(turned.leaf.max.x < 0.6 && Math.abs(turned.leaf.min.x - 0) < 1e-6)
})

test('a fence machine keeps its half of the block and fences the other half', () => {
  const none = buildModule(gate('fence'), ctxFor([]))
  assert.equal(none.userData.wing, undefined, 'no lane, so nothing to open')
  const boxes = parts(none)
  // The machine keeps the same body as a lane gate: the full-depth parts all sit
  // in the cell's −x half (world 0..0.5 for a gate at x = 0), never across it.
  const deep = boxes.filter((b) => b.max.y - b.min.y > 0.5)
  assert.ok(deep.length > 0, 'the machine body is missing')
  for (const b of deep) assert.ok(b.max.x <= 0.5 + 1e-6, `the body crossed into the fence half (${b.min.x}..${b.max.x})`)
  // The other half is a fence panel: the glass runs from the machine's inner face
  // (0.44) out to the far cell edge (1.0), where an end post caps the run.
  const glass = boxes.filter((b) => b.max.y - b.min.y < 0.05 && b.max.z - b.min.z > 0.5)
  assert.equal(glass.length, 1, 'the fence half should draw one panel')
  assert.ok(Math.abs(glass[0].min.x - 0.44) < 1e-6, `the panel must start at the machine's face (was ${glass[0].min.x})`)
  assert.ok(Math.abs(glass[0].max.x - 1) < 1e-6, `the panel must reach the cell edge (was ${glass[0].max.x})`)
  const endPost = (boxes2) => boxes2.filter((b) => Math.abs((b.min.x + b.max.x) / 2 - 0.96) < 0.02)
  assert.ok(endPost(boxes).length > 0, 'the run must cap itself where nothing carries on')
  // A fence in the neighbour cell carries the run on instead: no end post.
  const fence = { id: 'f', type: 'fence', x: 1, y: 0, z: 0, rot: 0, cfg: {} }
  const joined = parts(buildModule(gate('fence'), ctxFor([fence])))
  assert.equal(endPost(joined).length, 0, 'a capped end must not stand where a fence carries on')
})

test('a fence butts the machine side and ends at the doorway on the lane side', () => {
  const fence = { id: 'f', type: 'fence', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
  /** The end posts a fence cell draws, as its own local x: ±0.46 per capped end. */
  const ends = (modules) => {
    const g = buildModule(fence, ctxFor(modules))
    const xs = new Set()
    for (const c of g.children) if (Math.abs(c.position.x) > 0.4) xs.add(Math.round(c.position.x * 100))
    return xs
  }
  // The gate east of the fence is a lane one at rot 0: its body stands on the
  // cell's −x edge, which is this fence's side, so the run butts in and only the
  // far end is capped.
  assert.deepEqual(ends([fence, gate('lane', 0, 1)]), new Set([-46]))
  // The same gate turned 180° has its body on the far hand, so the fence now ends
  // at the doorway and caps itself there — the opening is not welded shut.
  assert.deepEqual(ends([fence, gate('lane', 2, 1)]), new Set([-46, 46]))
  // A fence machine is solid all round, so both hands join the run.
  assert.deepEqual(ends([fence, gate('fence', 0, 1)]), new Set([-46]))
  assert.deepEqual(ends([fence, gate('fence', 0, -1)]), new Set([46]))
  // …and the two lane sides are the mirror of each other too.
  assert.deepEqual(ends([fence, gate('lane', 0, -1)]), new Set([-46, 46]))
  assert.deepEqual(ends([fence, gate('lane', 2, -1)]), new Set([46]))
})
