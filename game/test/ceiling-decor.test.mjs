// The two ceiling-hung 装饰 pieces: the round station clock (时钟) and the ceiling
// camera (监控).
//
// Both are cosmetics with a mechanical contract, and the contract is what these
// tests defend: each reserves exactly its own cell from the floor top to the
// storey ceiling, neither may be dropped where there is no slab to hang from, a
// drag sweep collects a run of either, both round-trip the save, and the models
// really are the pieces the reference photographs show — a **round** dial with a
// white face, black marks and no numerals, and a bracket-and-swivel camera whose
// lens faces the local −y its rotation aims.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  ceilingMountMissing,
  equipmentReason,
  equipmentRefusalNotice,
  isMovableModule,
  moduleAt,
  moduleEnvelope,
  placementBlocked,
  placementOnTrack,
  reservedOpening,
} from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isDecorType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule, CLOCK_POSE_SECONDS, reposeClockHands } from '../src/render/models.ts'
import { ClockSystem } from '../src/render/scene/systems/ClockSystem.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { clockHandAngles } from '../src/sim/clock.ts'

/** The drawn height of each piece: the whole storey, floor top to ceiling. */
const HUNG_H = 3.0

const clock = (x, y, z = 0, id = 'clock-1', rot = 0) => ({ id, type: 'clock', x, y, z, rot, cfg: {} })
const cctv = (x, y, z = 0, id = 'cctv-1', rot = 0) => ({ id, type: 'cctv', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, rot: 0, cfg: { dir: 'both' } })

/** Open floor: a 10 × 10 slab at z = 0, with any extra cells appended. */
function flatStation(extra = []) {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  cells.push(...extra)
  return { name: 't', seed: 1, cells, modules: [], lines: [] }
}

/** The slab a ceiling-hung piece bolts its rods to: one storey up (z = 4). */
const ceilingAt = (x, y) => ({ x, y, z: 4, fill: 'solid' })

/* ------------------------------------------------------------- the catalogue */

test('the factory builds both pieces with the hover rotation', () => {
  const c = createModule('clock', 3, 4, -4, 'c', 2)
  assert.equal(c?.type, 'clock')
  assert.equal(c?.rot, 2)
  assert.deepEqual(c?.cfg, {})
  const v = createModule('cctv', 3, 4, -4, 'v', 1)
  assert.equal(v?.type, 'cctv')
  assert.equal(v?.rot, 1)
  assert.deepEqual(v?.cfg, { variant: 'bullet' })
})

test('the palette files both under 装饰, with their Chinese labels', () => {
  for (const [id, label] of [
    ['clock', '时钟'],
    ['cctv', '枪机'],
    ['cctv-ptz', '球机'],
    ['cctv-dome', '半球机'],
  ]) {
    const option = MODULE_OPTIONS.find((m) => m.id === id)
    assert.ok(option, `${id} is in the palette`)
    assert.equal(option.label, label)
    assert.equal(option.w, 1)
    assert.equal(option.h, 1)
    assert.equal(isDecorType(id), true, `${id} belongs to the 装饰 folder`)
    assert.equal(moduleLabel(id), id === 'cctv' ? '监控' : label)
  }
})

/* --------------------------------------------------------------- placement */

test('each piece reserves its own cell, floor top to storey ceiling', () => {
  for (const mod of [clock(2, 2), cctv(2, 2)]) {
    const e = moduleEnvelope(mod)
    assert.deepEqual([e.x0, e.y0, e.x1, e.y1], [2, 2, 3, 3])
    assert.equal(e.z0, 1, 'it starts at the block top')
    assert.equal(e.z1, 1 + HUNG_H, 'and rises the whole storey, to the ceiling slab')
  }
})

test('both may only be hung under a real ceiling', () => {
  const open = flatStation().cells
  for (const mod of [clock(3, 3), cctv(3, 3)]) {
    assert.equal(ceilingMountMissing(open, mod), true, 'open sky is nowhere to hang')
    assert.equal(ceilingMountMissing([...open, ceilingAt(3, 3)], mod), false, 'a slab one storey up is')
    // The slab is one column: the piece a cell over still has nothing overhead.
    assert.equal(ceilingMountMissing([...open, ceilingAt(3, 3)], { ...mod, x: 4 }), true)
  }
  // Floor-standing and wall-mounted pieces are never asked for a ceiling.
  assert.equal(ceilingMountMissing(open, gate(3, 3, 0)), false)
})

test('a hung piece wants the air, not the floor: it shares its cell with floor and wall pieces', () => {
  // Two hung pieces want the same air overhead, so they still exclude each other.
  assert.equal(placementBlocked([clock(2, 2)], cctv(2, 2, 0, 'v2')), true)
  assert.equal(placementBlocked([cctv(2, 2)], clock(2, 2, 0, 'c2')), true)
  // A chair on the floor, a poster on the back wall and a clock on the ceiling are
  // three pieces in three different places: they share the tile, and either side of
  // the pair may be the candidate.
  assert.equal(placementBlocked([clock(2, 2)], gate(2, 2, 0)), false, 'the clock hangs over the 闸机, not in it')
  assert.equal(placementBlocked([gate(2, 2, 0)], cctv(2, 2, 0, 'v2')), false)
  assert.equal(placementBlocked([clock(2, 2)], createModule('bench', 2, 2, 0, 'b', 0)), false, 'a 座椅 under the dial')
  assert.equal(
    placementBlocked([createModule('billboard', 2, 2, 0, 'ad', 0)], clock(2, 2, 0, 'c2')),
    false,
    'a 广告牌 on the wall behind it',
  )
  // A **run** is the exception: a flight or a shaft passes through the storey the
  // piece hangs in, and a 指示牌 hung into its headroom is a sign nobody walks under.
  // The escalator's anchors are its two landings, so this is its own column.
  assert.equal(placementBlocked([clock(2, 2)], createModule('escalator', 2, 2, 0, 'e', 0)), true)
  // A stair is the same where its treads run — and floor over its own landings,
  // which is the cell the clock hangs over there. Every swept cell of the flight is
  // asked, and both answers have to appear, so the rule cannot pass by refusing a
  // stair everywhere or nowhere.
  const stair = createModule('stair-straight', 2, 2, 0, 's', 0)
  assert.ok(stair, 'a straight stair')
  const dx = Math.sign(stair.to.x - stair.from.x)
  const dy = Math.sign(stair.to.y - stair.from.y)
  const swept = []
  for (let i = 0; i <= Math.max(Math.abs(stair.to.x - stair.from.x), Math.abs(stair.to.y - stair.from.y)); i++) {
    swept.push([stair.from.x + dx * i, stair.from.y + dy * i])
  }
  let overTread = 0
  let overLanding = 0
  for (const [x, y] of swept) {
    if (placementBlocked([stair], clock(x, y, stair.z, 'c3'))) overTread++
    else overLanding++
  }
  assert.ok(overTread > 0, 'no cell of the flight refuses the clock, so the refusal is untested')
  assert.ok(overLanding > 0, 'every cell of the flight refuses it, so the landing is untested')
  // The treads are what refuses it, and the two landings are floor a clock hangs over.
  assert.equal(placementBlocked([stair], clock(swept[2][0], swept[2][1], stair.z, 'c5')), true)
  assert.equal(placementBlocked([stair], clock(stair.to.x, stair.to.y, stair.z, 'c6')), false, 'the top landing')
  // A piece a cell along is free, whatever kind it is.
  assert.equal(placementBlocked([clock(2, 2)], cctv(3, 2, 0, 'v2')), false)
  assert.equal(placementBlocked([clock(2, 2)], gate(3, 2, 0, 'g2')), false)
})

// The ground rule is the **floor-standing** pieces' rule: a hung piece is anchored
// to the floor cell of the storey it hangs over, but it does not stand on it, so
// the slab overhead is its whole structural requirement. A sign over a well, or
// over the rails, is refused by what really refuses it and never by a floor three
// metres under its rods.
test('a hung piece answers to the slab, never to the ground under it', () => {
  const slab = [ceilingAt(2, 2)]
  assert.equal(equipmentReason(slab, [], clock(2, 2), true), '', 'the slab hangs it, floor or no floor')
  assert.equal(equipmentReason([], [], clock(2, 2), true), 'ceiling', 'open sky is what it lacks')
  assert.match(equipmentRefusalNotice('ceiling'), /天花板/)
  // A rail's dug bed is still refused — and now says so, rather than blaming a
  // floor the piece was never standing on.
  const bed = [{ x: 2, y: 2, z: 0, fill: 'solid', finish: { top: 'floor.track' } }, ...slab]
  assert.equal(equipmentReason(bed, [], clock(2, 2), true), 'track')
  // The same floorless storey still refuses a piece that really does stand: the
  // exemption is the hung piece's, not the cell's. Asked one storey up, where
  // there is no street to stand on.
  const tvm = createModule('tvm', 2, 2, 4, 't', 0)
  assert.equal(equipmentReason([{ x: 2, y: 2, z: 8, fill: 'solid' }], [], tvm, true), 'floor')
})

test('a piece is found from its cell and refused on a track bed', () => {
  assert.equal(moduleAt([clock(2, 2)], 2, 2, 0)?.id, 'clock-1')
  assert.equal(moduleAt([cctv(2, 2)], 2, 2, 0)?.id, 'cctv-1')
  assert.equal(moduleAt([clock(2, 2)], 3, 2, 0), undefined)
  const st = flatStation()
  const bed = st.cells.map((c) => (c.x === 2 && c.y === 2 ? { ...c, finish: { top: 'floor.track' } } : c))
  assert.equal(placementOnTrack(bed, clock(2, 2), []), true)
  assert.equal(placementOnTrack(bed, cctv(2, 2), []), true)
  assert.equal(placementOnTrack(bed, clock(3, 3), []), false)
})

test('both are movable decorations, and both round-trip the save', () => {
  assert.equal(isMovableModule(clock(1, 1)), true)
  assert.equal(isMovableModule(cctv(1, 1)), true)
  const st = { ...flatStation(), modules: [clock(2, 2, 0, 'c', 1), cctv(4, 4, 0, 'v', 3)] }
  const r = parse(serialize(st))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, st.modules)
})

test('a drag sweep collects a run of either piece, and nothing else', () => {
  assert.equal(sweepFamily(clock(0, 0)), 'clock')
  assert.equal(sweepFamily(cctv(0, 0)), 'cctv:bullet')
  // A run of clocks is one sweep whatever way each is turned — a round dial has no
  // meaningful hand, so rotation never splits the family.
  assert.equal(sameSweepFamily(clock(0, 0, 0, 'a', 0), clock(1, 0, 0, 'b', 3)), true)
  // A camera's rotation *is* its aim, and a row of them aimed differently is still
  // one row of the same fitting.
  assert.equal(sameSweepFamily(cctv(0, 0, 0, 'a', 2), cctv(1, 0, 0, 'b', 1)), true)
  // The two decorations are different pieces, so they never sweep together.
  assert.equal(sameSweepFamily(clock(0, 0, 0, 'a'), cctv(1, 0, 0, 'b')), false)
  assert.equal(sameSweepFamily(clock(0, 0, 0, 'a'), gate(1, 0, 0, 'g')), false)
})

/* ------------------------------------------------------------------ the models */

/**
 * Build one piece with the lightest context the two models need: a lazily minted
 * material per name, so a mesh can be recognised by the material it was handed.
 * Neither builder draws to a canvas at build time, so there is no DOM and no
 * station behind this.
 */
function build(mod) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const data = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
  const group = buildModule(mod, { mats, data, trackCells: new Set(), finish: () => mats.steel, preview: false })
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  // The module sits at (0, 0, 0): take the cell centre and the block top back off,
  // so every number below is in the piece's own frame.
  const box = new THREE.Box3().setFromObject(group).translate(new THREE.Vector3(-0.5, -0.5, -1))
  return { mats, meshes, box, root: group }
}

test('camera variants keep their shape through save, ghost refresh and same-variant sweep', () => {
  const pieces = ['cctv', 'cctv-ptz', 'cctv-dome'].map((id) => createModule(id, 2, 2, 0, id, 3))
  const legacy = cctv(2, 2, 0, 'legacy', 3)
  const state = { ...flatStation(), modules: [...pieces, legacy] }
  assert.deepEqual(parse(serialize(state)).state.modules, state.modules)
  assert.equal(moduleGhostKey(legacy), moduleGhostKey(pieces[0]), 'legacy saves render as 枪机')
  assert.equal(new Set(pieces.map(moduleGhostKey)).size, 3, 'a palette change refreshes the ghost in place')
  assert.equal(sameSweepFamily(legacy, pieces[0]), true)
  for (const a of pieces) for (const b of pieces) assert.equal(sameSweepFamily(a, b), a === b, 'a sweep keeps other camera shapes')
  for (const mod of pieces) {
    assert.equal(ceilingMountMissing(flatStation().cells, mod), true)
    assert.equal(ceilingMountMissing(flatStation([ceilingAt(2, 2)]).cells, mod), false)
  }
})

test('球机 hangs below its arm and 半球机 sits flush beneath the ceiling in every rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const ptz = build(createModule('cctv-ptz', 0, 0, 0, 'ptz', rot))
    const dome = build(createModule('cctv-dome', 0, 0, 0, 'dome', rot))
    for (const { box, meshes } of [ptz, dome]) {
      assert.ok(box.min.x > -0.5 && box.max.x < 0.5 && box.min.y > -0.5 && box.max.y < 0.5, 'hardware stays inside its tile')
      assert.ok(Math.abs(box.max.z - 3) < 1e-6, 'mount touches the slab without protruding through it')
      const shell = meshes.find((m) => m.geometry.type === 'SphereGeometry' && m.geometry.parameters.thetaStart === Math.PI / 2)
      assert.ok(shell, 'the glass cover is a lower hemisphere')
      const glassBox = new THREE.Box3().setFromObject(shell)
      assert.ok(glassBox.max.z - glassBox.min.z > 0.12, 'cover has depth rather than a flat disc')
      assert.equal(shell.material.depthWrite, false, 'cover does not hide the lens behind it')
      assert.equal(shell.material.opacity, 0.32)
      const lens = meshes.find((m) => m.geometry.type === 'CylinderGeometry' && m.geometry.parameters.height === 0.008 && m.material.name === 'tintedGlass')
      assert.ok(lens, 'an optical disc is inside the cover')
      const axis = new THREE.Vector3(0, -1, 0).transformDirection(lens.matrixWorld)
      assert.ok(axis.z < -0.2, 'the optical face points down into the concourse')
    }
    assert.ok(ptz.box.min.z < 2.4, '球机 hangs well below its bracket')
    assert.ok(dome.box.min.z > 2.7, '半球机 stays close to the slab')
  }
})

/**
 * The direction a dial part's **length** runs, in the dial's plane.
 *
 * Read off the part's own matrix: a mark's box carries its length along local **x**, so that axis
 * is the matrix's first column. Measuring the longest diagonal of the eight corners instead is
 * tempting and wrong for the short minute ticks — at four-to-one their diagonal is up to 13° off
 * the length — and deriving it from `rotation.y` by hand is one sign away from pointing the wrong
 * way, which is how a check once passed while every mark lay across the rim.
 */
function longAxis(mesh) {
  mesh.updateMatrixWorld(true)
  const axis = new THREE.Vector3(1, 0, 0).transformDirection(mesh.matrixWorld)
  return [axis.x, axis.z]
}

test('the 时钟 is a slim black-wrapped case with a dial on each face', () => {
  const { mats, meshes, box, root } = build(clock(0, 0))
  // Boxes are taken in the same cell frame as `build`'s own group box — the cell centre and
  // block top back off — so every number below is directly comparable.
  const meshBox = (mesh) =>
    new THREE.Box3().setFromObject(mesh).translate(new THREE.Vector3(-0.5, -0.5, -1))
  assert.ok(box.min.x >= -0.5 && box.max.x <= 0.5, 'fits the cell across')
  // The dials stand in the cell's **X-Z plane, facing ±y**, so the rod behind them reaches a
  // little past the cell's own metre — a slim fitting overhanging its column, which the
  // collision envelope (the hung storey column) does not measure.
  assert.ok(box.min.y >= -0.62 && box.max.y <= 0.62, 'the case straddles the cell, dials facing out')
  assert.ok(box.min.z > 0.9, 'the clock hangs well clear of the floor')
  assert.ok(Math.abs(box.max.z - HUNG_H) < 0.06, 'the rod reaches the storey ceiling')

  /* ---------------------------------------------------------------- the case */

  // One **white** cylinder is the dial, and its two ends are the two faces: slim through
  // (0.12 m), and white so that each end reads as a face rather than as a white drum.
  const cylinders = meshes.filter((m) => m.geometry.type === 'CylinderGeometry')
  const body = cylinders.find((m) => m.material === mats.white)
  assert.ok(body, 'a white body whose ends are the two dials')
  const bodyW = new THREE.Vector3()
  body.geometry.computeBoundingBox()
  body.geometry.boundingBox.getSize(bodyW)
  const thin = ['x', 'y', 'z'].filter((axis) => bodyW[axis] < 0.2)
  assert.deepEqual(thin, ['y'], `slim through y, so its plane is X-Z (its size is ${bodyW.toArray().map((n) => n.toFixed(2))})`)
  assert.ok(Math.abs(bodyW.x - bodyW.z) < 1e-6, 'and round in that plane')
  // **The two end planes of the white barrel.** Its caps are flat discs lying *in* these planes,
  // and they are what a dial has to clear: anything mounted level with or inside them is covered
  // by the cap and renders as the plain white disc this piece was once shipped as.
  const bodyWorld = new THREE.Box3().setFromObject(body)
  // No rotation: a `CylinderGeometry` is Y-up, so its caps already face ±y. A quarter-turn
  // about x lays it flat in the X-Z (horizontal) plane, and no sign of that turn fixes it —
  // which is how this piece twice read as a clock facing the floor, then the ceiling.
  assert.equal(body.rotation.x, 0, 'the body is not turned at all: its caps already face ±y')
  assert.ok(body.geometry.parameters.height <= 0.15, `the case is slim (${body.geometry.parameters.height} m through)`)
  // The black wrap round the barrel is an **open** ring: a capped cylinder would lay a black
  // disc across each white face and hide the dial, which is a bug this piece has had.
  const wrap = cylinders.find((m) => m.material === mats.darkSteel)
  assert.ok(wrap, 'a black wrap round the barrel')
  assert.equal(wrap.geometry.parameters.openEnded, true, 'the wrap has no cap over either face')
  assert.ok(wrap.geometry.parameters.radiusTop > body.geometry.parameters.radiusTop, 'it wraps the white barrel')
  assert.ok(wrap.geometry.parameters.height > body.geometry.parameters.height, 'and covers it end to end')

  /* --------------------------------------------------------------- the dials */

  // Each face carries the same dial, and the two dials are the two ends of the case. A dial is
  // **nested inside its mount**: the mount carries the dial's height and the turns that put its
  // face on the outside, and a mount holds nothing but its dial. What matters is not the exact
  // rotation but the **outward direction** — the way a mark stands off its own face — because a
  // dial whose outward direction points back into the case is a dial the white cap hides.
  const dialMounts = []
  for (const child of root.children) {
    if (!child.isGroup) continue
    let blackMeshes = 0
    let otherMeshes = 0
    child.traverse((o) => {
      if (!o.isMesh) return
      if (o.material === mats.black) blackMeshes++
      else otherMeshes++
    })
    if (blackMeshes > 0 && otherMeshes === 0) dialMounts.push(child)
  }
  assert.equal(dialMounts.length, 2, `the case carries two dials (found ${dialMounts.length})`)
  dialMounts.sort((a, b) => a.position.y - b.position.y)
  const [frontGroup, backGroup] = dialMounts
  assert.ok(frontGroup.position.y < body.position.y, 'the near dial sits at the camera-side end of the case')
  assert.ok(backGroup.position.y > body.position.y, 'the far dial at the other end')
  // The dial's centre in the world frame, for every radius and height read below.
  const dialCentre = bodyWorld.getCenter(new THREE.Vector3())
  const faceR = body.geometry.parameters.radiusTop
  // The mount is the case's **outer** end, so the dial it carries lies outside the white barrel
  // rather than inside its cap.
  for (const [i, mount] of [frontGroup, backGroup].entries()) {
    // Compared in the world frame the case box was measured in: the mount is a child of the
    // piece, so its own `position` still needs the piece's offset adding on.
    mount.updateMatrixWorld(true)
    const caseEnd = i === 0 ? bodyWorld.min.y : bodyWorld.max.y
    const mountAt = new THREE.Vector3()
    mount.getWorldPosition(mountAt)
    assert.ok(Math.abs(mountAt.y - caseEnd) < 1e-6, `mount ${i} sits on the case's own end surface (${mountAt.y.toFixed(3)} vs ${caseEnd.toFixed(3)})`)
    // **Every part of the dial stands clear of the case's white end.** The barrel is capped, so a
    // mark lying level with or inside the end plane is covered by that cap and the face renders as
    // a plain white disc — the bug this piece was once shipped with, where both dials were built
    // on the inward side of their end and the meshes were all present, correctly sized and
    // correctly coloured. The measure is the dial's own outward direction, read off its live
    // matrix, so it holds however the dial is mounted.
    const dialGroup = mount.children.find((c) => c.isGroup) ?? mount
    dialGroup.updateMatrixWorld(true)
    const dialParts = []
    dialGroup.traverse((o) => {
      if (o.isMesh && o.material === mats.black) dialParts.push(o)
    })
    // The **dial's own outward direction** is the side of the case end its furthest part is on:
    // the mount fixes where the dial sits, and this is the measurement of which way its face was
    // built. Deriving it from the mount's rotation cannot work — a half turn about y leaves the
    // dial's +y pointing the same way in the world, which is exactly why the sign has to live in
    // the dial's own offsets rather than in a turn.
    const extreme = dialParts.reduce(
      (best, m) => {
        const box = new THREE.Box3().setFromObject(m)
        const reach = i === 0 ? -box.min.y : box.max.y
        return reach > best.reach ? { reach, mesh: m } : best
      },
      { reach: -Infinity, mesh: null },
    )
    const faceSign = i === 0 ? -1 : 1
    assert.ok(
      (extreme.reach - caseEnd) * faceSign > 0,
      `dial ${i} was built facing back into its case end, where the white cap hides every part of it`,
    )
    for (const m of dialParts) {
      const box = new THREE.Box3().setFromObject(m)
      // Only a part inside the cap's own radius can be hidden by it. One reaching past the rim is
      // visible whichever side of the end plane it is on.
      const at = new THREE.Vector3()
      m.getWorldPosition(at)
      if (Math.hypot(at.x - dialCentre.x, at.z - dialCentre.z) > faceR) continue
      const outer = faceSign < 0 ? box.min.y : box.max.y
      const gap = (outer - caseEnd) * faceSign
      assert.ok(gap >= 0, `dial ${i}: a part is ${(-gap).toFixed(4)} m inside its case end, where the white cap hides it`)
    }
  }

  for (const [i, group] of [frontGroup, backGroup].entries()) {
    const parts = []
    group.traverse((o) => {
      if (o.isMesh && o.material === mats.black) parts.push(o)
    })
    const bars = parts.filter((m) => m.geometry.type === 'BoxGeometry')
    const hands = bars.filter((m) => m.geometry.parameters.width >= 0.15)
    const marks = bars.filter((m) => m.geometry.parameters.width < 0.15)
    const hours = marks.filter((m) => m.geometry.parameters.depth >= 0.012)
    const minutes = marks.filter((m) => m.geometry.parameters.depth < 0.012)
    const hubs = parts.filter((m) => m.geometry.type === 'CylinderGeometry')
    // **A clock face is sixty divisions, not twelve.** Twelve bars alone read as a plate with
    // marks on it — the minute ticks between them are what make the ring read as a clock.
    assert.equal(hours.length, 12, `face ${i}: twelve hour marks`)
    assert.equal(minutes.length, 48, `face ${i}: 48 minute ticks between them, so sixty divisions`)
    assert.equal(hours.length + minutes.length, 60, `face ${i}: sixty divisions in all`)
    for (const m of marks) {
      assert.ok(m.geometry.parameters.width >= 0.035, `face ${i}: a mark is long enough to read (${m.geometry.parameters.width} m)`)
      assert.ok(m.geometry.parameters.depth >= 0.008, 'and wide enough across')
      assert.ok(m.geometry.parameters.height <= 0.01, 'while staying flat on the face')
    }
    for (const h of hours) assert.ok(h.geometry.parameters.width >= 0.07, 'an hour mark is longer than a minute tick')
    assert.equal(hours.filter((m) => m.geometry.parameters.width >= 0.085).length, 4, `face ${i}: four quarter-hour marks`)
    assert.equal(hands.length, 2, `face ${i}: an hour hand and a minute hand`)
    assert.equal(hubs.length, 1, `face ${i}: a centre boss`)
    // **Every part stands out of its own end of the case.** The dial is built about its own
    // centre in a neutral frame, so a part's own y says nothing about which end it is fitted to;
    // what has to hold is that its parts stand clear of the white end cap *this* face sits on.
    // Reading the mesh's world box is what makes the check bite: this is the assertion that
    // catches a far dial whose marks sit inside the barrel, which renders as a blank white face.
    const cap = i === 0 ? bodyWorld.min.y : bodyWorld.max.y
    const faceSign = i === 0 ? -1 : 1
    for (const m of parts) {
      const box = new THREE.Box3().setFromObject(m)
      const outer = faceSign < 0 ? box.min.y : box.max.y
      if (Math.hypot(m.position.x, m.position.z) > body.geometry.parameters.radiusTop) continue
      assert.ok((outer - cap) * faceSign >= -0.001, `face ${i}: a mark is sunk into the case end`)
    }
    // **Every mark runs radially**: its long axis points at the centre, which is what makes the
    // 12 and 6 marks stand vertical in the dial's plane and the 3 and 9 marks lie horizontal
    // along the radius. Turned a quarter the other way they come out *tangential* — horizontal at
    // 12 and 6, vertical at 3 and 9 — which is backwards and very visible.
    //
    // **Measured, not derived.** A box's long axis is the longest diagonal between its own eight
    // corners, taken in world space; deriving it from `rotation.y` gets the axis convention wrong
    // (which is how a check once passed while every mark lay across the rim).
    //
    // A mark is **radial**, so its long axis is parallel to its own radius — dot close to 1 (a bar
    // is symmetric, so its box may point inward and the dot come out at −1; the magnitude is the
    // measure). A mark lying across the rim — tangential, the bug this guards — comes out at 0.
    for (const m of marks) {
      const [ax, az] = longAxis(m)
      // The mark's own radius must be read in the **same frame** as its long axis: the dial is
      // mounted inside groups that turn it, so a local `position` compared against a world axis
      // measures the mount's turn rather than the mark's.
      const at = new THREE.Vector3()
      m.getWorldPosition(at)
      const rx = at.x - dialCentre.x
      const rz = at.z - dialCentre.z
      const span = Math.hypot(rx, rz)
      if (span < 1e-6) continue
      const along = Math.abs((ax * rx + az * rz) / span)
      assert.ok(along > 0.99, `face ${i}: a mark runs radially, along its own radius (dot ${along.toFixed(3)})`)
    }
    // And the four cardinals are the way a clock face has them: 12 and 6 stand vertical (long
    // axis along z), 3 and 9 lie horizontal (along x).
    for (const [deg, want] of [[0, 'z'], [90, 'x'], [180, 'z'], [270, 'x']]) {
      const a = (deg * Math.PI) / 180
      const at = hours.find((m) => {
        const p = new THREE.Vector3()
        m.getWorldPosition(p)
        return Math.hypot(p.x - dialCentre.x - Math.sin(a) * 0.3, p.z - dialCentre.z - Math.cos(a) * 0.3) < 0.06
      })
      assert.ok(at, `face ${i}: an hour mark at ${deg}°`)
      const [cx, cz] = longAxis(at)
      const runs = Math.abs(cx) > 0.9 ? 'x' : Math.abs(cz) > 0.9 ? 'z' : 'diagonal'
      assert.equal(runs, want, `face ${i}: the ${deg}° mark runs along ${want} (it runs along ${runs})`)
    }
    // **Each hand points at its own hour**, reading its tip's direction off the box corners: the
    // pose a bare build draws is the sim's **own derivation** at `CLOCK_POSE_SECONDS` (10:09), so
    // the two hands are the two hands of *that* instant — the hour hand just past 10, the minute
    // hand just past 10 past. A hand laid across its hour — the bug this test exists for — lands
    // 90° out.
    //
    // The angle has to be read in the **dial's own frame**, which is the frame the marks' own
    // angles live in and the one `clockHandAngles` speaks — not in world axes. The far dial hangs
    // inside a mount turned half a turn about the vertical axis (so that its own 12 is up for the
    // viewer on that side), and a hand measured in world axes therefore points the *other* way
    // round there while reading its hour perfectly. This check used to compare the two, and the
    // `|| off - 180` escape that made it pass is the seam the piece's upside-down far face hid in.
    const productPose = clockHandAngles(CLOCK_POSE_SECONDS)
    const mountTurn = new THREE.Quaternion()
    group.getWorldQuaternion(mountTurn).invert()
    const poses = [[productPose.hour, 0.19], [productPose.minute, 0.27]]
    for (const [deg, len] of poses) {
      const arm = hands.find((m) => Math.abs(m.geometry.parameters.width - len) < 0.02)
      assert.ok(arm, `face ${i}: the ${len === 0.19 ? 'hour' : 'minute'} hand`)
      // A hand carries its length along local **x**, like a mark, so its axis is the matrix's first
      // column. The radial direction at its hour `deg` is `(sin, cos)`; the hand must point that way.
      // A hand lying *across* its hour — the bug this guards — comes out 90° from this.
      const axis = new THREE.Vector3(1, 0, 0).transformDirection(arm.matrixWorld).applyQuaternion(mountTurn)
      const got = (Math.atan2(axis.x, axis.z) * 180) / Math.PI
      let off = Math.abs(got - deg) % 360
      if (off > 180) off = 360 - off
      assert.ok(off < 0.01, `face ${i}: the ${len === 0.19 ? 'hour' : 'minute'} hand points at ${deg.toFixed(1)}° (it points ${got.toFixed(1)}°)`)
    }
  }
  /* ---------------------------------------------------------------- the rod */

  // **The face is the object and the mount is a line.** The rod is thin and runs from the top
  // of the case to the ceiling plate, behind the dials.
  const boxes = meshes.filter((m) => m.geometry.type === 'BoxGeometry')
  const rod = boxes.find((m) => {
    const p = m.geometry.parameters
    return p.width === p.height && p.width <= 0.04 && p.depth > 0.2
  })
  assert.ok(rod, 'a thin rod up to the ceiling plate')
  assert.ok(rod.geometry.parameters.width <= 0.032, `the rod is a line, not a post (${rod.geometry.parameters.width} m)`)
  // It starts at the **top of the case** and runs up to the ceiling plate — not over the dial.
  const caseTop = body.position.z + body.geometry.parameters.radiusTop
  const rodBottom = rod.position.z - rod.geometry.parameters.depth / 2
  assert.ok(Math.abs(rodBottom - caseTop) < 0.06, `the rod leaves the top of the case (${rodBottom.toFixed(2)} vs ${caseTop.toFixed(2)})`)
  assert.ok(Math.abs(rod.position.y - body.position.y) < 0.06, 'the rod runs up the middle of the case, between the two dials')
  const plate = boxes.find((m) => {
    const p = m.geometry.parameters
    return p.width === p.height && p.width > 0.1 && p.depth < 0.1
  })
  assert.ok(plate && plate.position.z > 2.9, 'a ceiling plate at the top of the rod')
  // No numerals, no name, no branding: there is no text material on the piece at all.
  assert.ok(!meshes.some((m) => m.material === mats.clockFace), 'the dial is not a printed plate')
})

test('the 监控 is a bracketed bullet camera whose lens faces local −y', () => {
  const { mats, meshes, box } = build(cctv(0, 0))
  assert.ok(box.min.x >= -0.5 && box.max.x <= 0.5, 'fits the cell across')
  assert.ok(box.min.y >= -0.5 && box.max.y <= 0.5, 'fits the cell in depth')
  assert.ok(box.min.z > 0.9, 'the head hangs clear of the floor')
  assert.ok(Math.abs(box.max.z - HUNG_H) < 0.06, 'the stem reaches the storey ceiling')
  // **A slim piece.** Its body, hood, lens and bracket are a small fraction of the cell
  // they reserve — the collision envelope is the hung column, not the drawn hardware, so a
  // camera that filled the cell would read as a box on a rod. The volume is the number that
  // matters: before this pass the piece filled a fifth of its cell.
  const drawnX = box.max.x - box.min.x
  const drawnY = box.max.y - box.min.y
  const drawnZ = box.max.z - box.min.z
  assert.ok(drawnX <= 0.32, `the drawn housing is slim across (${drawnX.toFixed(2)} m)`)
  assert.ok(drawnY <= 0.45, `and shallow into the room (${drawnY.toFixed(2)} m)`)
  assert.ok(drawnX * drawnY * drawnZ <= 0.08, `a slim fitting, not a box (${(drawnX * drawnY * drawnZ).toFixed(3)} m³ of a 1 m³ cell)`)
  // The dark optics are contained inside a rounded white front surround.
  const body = meshes.find((m) => m.name === 'cctv-body')
  const surround = meshes.find((m) => m.name === 'cctv-front-surround')
  const panel = meshes.find((m) => m.name === 'cctv-optical-panel')
  const hood = meshes.find((m) => m.name === 'cctv-sun-hood')
  assert.equal(body.material, mats.white)
  assert.equal(surround.material, mats.white)
  assert.equal(panel.material, mats.black)
  assert.equal(hood.material, mats.white)
  for (const m of [body, surround, panel]) {
    m.geometry.computeBoundingBox()
    assert.ok(m.geometry.parameters.shapes.curves.some((c) => c.type === 'QuadraticBezierCurve'), 'rounded enclosure corners')
  }
  const frontSize = surround.geometry.boundingBox.getSize(new THREE.Vector3())
  const panelSize = panel.geometry.boundingBox.getSize(new THREE.Vector3())
  assert.ok(frontSize.x - panelSize.x > 0.05 && frontSize.y - panelSize.y > 0.05, 'a visible white border on all sides of the dark insert')
  assert.ok(panel.position.y < surround.position.y, 'the insert sits visibly on the front face')
  assert.ok(hood.geometry.parameters.shapes.curves.filter((c) => c.type === 'QuadraticBezierCurve').length >= 4, 'the hood is an arched shell, not a flat plate')
  // The lens is out front, on the −y side of its own body.
  const lens = meshes.filter((m) => m.material === mats.black && m.geometry.type === 'CylinderGeometry')
  assert.ok(lens.length >= 1, 'a lens barrel')
  const lensY = Math.min(...lens.map((m) => m.position.y))
  assert.ok(lensY < -0.1, 'the lens sits on the −y front')
  assert.ok(lens[0].geometry.parameters.radiusTop <= 0.06, 'a small lens, not a porthole')
  const opticalAxis = new THREE.Vector3(0, -1, 0).transformDirection(lens[0].matrixWorld)
  assert.ok(opticalAxis.z < -0.2, 'the circular lens faces forward and down into the corridor')
  // Clear illuminators stay entirely inside the dark window.
  const leds = meshes.filter((m) => m.name === 'cctv-ir-led')
  assert.equal(leds.length, 12, 'an IR ring around the lens')
  assert.ok(leds.every((m) => m.position.y < -0.02), 'both LEDs are on the front face')
  assert.ok(leds.every((m) => Math.abs(m.position.x) + 0.005 < panelSize.x / 2 && Math.abs(m.position.z) + 0.005 < panelSize.y / 2), 'no black panel or LED spills onto the white surround')
  // A sun hood over the head, and the ceiling plate the stem drops from.
  assert.ok(meshes.filter((m) => m.material === mats.steel).length >= 3, 'stem, arm and IR reflectors are steel')
  assert.ok(meshes.some((m) => m.material === mats.darkSteel && m.position.z > 2.9), 'a ceiling plate at the top')
  // The piece looks one way: the lens is the front, not a thing on the side.
  assert.ok(Math.abs(lens[0].position.x) < 0.2, 'the lens is centred on the head, not off to a side')
})

test('a turned 监控 aims its lens the other way, and a clock looks the same turned', () => {
  // Rotation is applied by `placeLocal` on the whole group, so the lens direction is
  // the local −y turned by `rot`: pin the world position of the lens for two turns.
  const lensWorld = (rot) => {
    const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
    const data = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
    const group = buildModule(cctv(0, 0, 0, 'v', rot), { mats, data, trackCells: new Set(), finish: () => mats.steel, preview: false })
    group.updateMatrixWorld(true)
    let best = null
    group.traverse((o) => {
      if (o.isMesh && o.material === mats.black && o.geometry.type === 'CylinderGeometry' && (best === null || o.position.y < best.position.y)) best = o
    })
    const p = new THREE.Vector3()
    best.getWorldPosition(p)
    return p
  }
  const south = lensWorld(0)
  const north = lensWorld(2)
  assert.ok(south.y < 0.5, 'at rot 0 the lens is on the −y side of its cell')
  assert.ok(north.y > 0.5, 'half a turn round, it watches the other way')
  // A half-turn about the cell's centre carries the head to the other side of it —
  // and no further: the piece stays inside its own cell, because its envelope does.
  assert.ok(Math.abs(south.x - 0.5) < 0.06 && Math.abs(north.x - 0.5) < 0.06, 'the head stays on the cell centre line')
  assert.ok(Math.abs(south.x + north.x - 1) < 1e-6, 'and the half-turn mirrors it about that centre')
})

/* ------------------------------------------------------------------ the dial */

test('a turned 时钟 still reads: the dial turns with the piece', () => {
  // The clock is round and reads from **both** faces, so a rotation is cosmetic — but the two
  // dials and their marks are meshes in the piece's own group and must turn with it rather than
  // being left behind in world axes. (The faces are mirror images, so comparing *positions*
  // under a turn only proves the faces swap; what has to hold is that every mark moved and the
  // dial kept its shape and size.)
  const dialOf = (rot) => {
    const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
    const data = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
    const group = buildModule(clock(0, 0, 0, 'c', rot), { mats, data, trackCells: new Set(), finish: () => mats.steel, preview: false })
    group.updateMatrixWorld(true)
    const marks = []
    group.traverse((o) => {
      if (!o.isMesh || o.material !== mats.black || o.geometry.type !== 'BoxGeometry') return
      // The hour marks and hands only: the minute ticks are fine detail and the two faces are
      // mirror images, so including them would compare a face against its own reflection.
      if (o.geometry.parameters.depth < 0.012) return
      const p = new THREE.Vector3()
      o.getWorldPosition(p)
      marks.push(p)
    })
    return marks
  }
  const upright = dialOf(0)
  const turned = dialOf(1)
  assert.equal(upright.length, turned.length, 'the same marks either way')
  assert.equal(upright.length, 2 * (12 + 2), 'twelve hour marks and two hands on each of two faces')
  // A quarter-turn about the cell centre carries the dial round with it.
  const moved = upright.filter((p, i) => p.distanceTo(turned[i]) > 1e-6).length
  assert.ok(moved >= 20, `a quarter-turn carries the dial round with the piece (${moved} of ${upright.length} moved)`)
  // The dial keeps its size and shape: each mark stays the same distance from the dial centre.
  const radius = (p) => Math.hypot(p.x - 0.5, p.y - 0.5)
  const before = upright.map(radius).sort((a, b) => a - b)
  const after = turned.map(radius).sort((a, b) => a - b)
  for (const [i, r] of before.entries()) assert.ok(Math.abs(r - after[i]) < 1e-6, 'and the dial keeps its shape')
  // And nothing leaves the cell it reserves.
  for (const p of turned) {
    assert.ok(Math.abs(p.x - 0.5) <= 0.45 && Math.abs(p.y - 0.5) <= 0.45, 'every mark stays inside the cell')
  }
})

/* ----------------------------------------------------------------- the hands */

/**
 * The clock angle a hand's pivot points its arm at, in the **dial's own frame**: degrees
 * clockwise from 12 o'clock, which is the frame the marks were laid out in and the one
 * `clockHandAngles` speaks.
 *
 * Read off the **drawn arm** rather than off the pivot's own `rotation.y`. The pivot's rotation
 * is the implementation; what has to be true is that 0.19 m of steel ends up over the hour it is
 * meant to show — and on **both** faces, which are one dial mounted twice with the far one inside
 * a group turned half a turn, so a face that was mirrored rather than mounted would point 180°
 * out with its pivot set exactly right. Un-rotating by the mount's own world quaternion is what
 * makes the two faces comparable.
 */
function handAngle(pivot, root) {
  const arm = pivot.children[0]
  root.updateMatrixWorld(true)
  let frame = pivot
  while (frame.parent && frame.parent !== root) frame = frame.parent
  const q = new THREE.Quaternion()
  frame.getWorldQuaternion(q).invert()
  const axis = new THREE.Vector3(1, 0, 0).transformDirection(arm.matrixWorld).applyQuaternion(q)
  return ((Math.atan2(axis.x, axis.z) * 180) / Math.PI + 360) % 360
}

test('a 时钟 hands the scene a pivot per hand, seated on the product pose', () => {
  const { root } = build(clock(0, 0))
  const rig = root.userData.clockRig
  assert.ok(rig, 'the piece carries the rig the scene turns its hands by (`clockRig`)')
  assert.equal(rig.hour.length, 2, 'an hour hand on each face')
  assert.equal(rig.minute.length, 2, 'and a minute hand on each face')
  for (const pivot of [...rig.hour, ...rig.minute]) {
    assert.equal(pivot.isGroup, true, 'a hand hangs on a pivot group rather than being placed at an angle')
    assert.equal(pivot.children.length, 1, 'and the pivot holds its arm and nothing else, so one number is the time')
  }
  // **A bare build draws the sim's own pose**, not a number typed into the builder: no scene is
  // behind a palette thumbnail or a hover ghost, so the piece falls back to `CLOCK_POSE_SECONDS`
  // — and 10:09 is then whatever `clockHandAngles` says 10:09 is.
  const pose = clockHandAngles(CLOCK_POSE_SECONDS)
  for (const pivot of rig.hour) assert.ok(Math.abs(handAngle(pivot, root) - pose.hour) < 1e-6, `the hour hand draws ${pose.hour}° (10:09)`)
  for (const pivot of rig.minute) assert.ok(Math.abs(handAngle(pivot, root) - pose.minute) < 1e-6, `the minute hand draws ${pose.minute}° (10:09)`)
})

test('both dials read the sim clock: one time on the wall, whichever side it is read from', () => {
  const { root } = build(clock(0, 0))
  const rig = root.userData.clockRig
  // An hour that lands a hand on a mark, a half hour, the product pose, the last second of the
  // day, and a time well into a run (the day counter past 1). Every hand on **both** faces has to
  // read the angle the clock's own derivation gives — a face that mirrored its hands instead of
  // mounting them lands on 360° − that, and a fixed pose never moves at all.
  for (const seconds of [0, 3 * 3600, 6 * 3600 + 30 * 60, 10 * 3600 + 9 * 60, 23 * 3600 + 59 * 60 + 59, 123456]) {
    reposeClockHands(rig, seconds)
    const want = clockHandAngles(seconds)
    for (const pivot of rig.hour) {
      assert.ok(Math.abs(handAngle(pivot, root) - want.hour) < 1e-6, `at ${seconds} s the hour hand reads ${want.hour}°`)
    }
    for (const pivot of rig.minute) {
      assert.ok(Math.abs(handAngle(pivot, root) - want.minute) < 1e-6, `at ${seconds} s the minute hand reads ${want.minute}°`)
    }
  }
  // The two faces are the same clock, not two: 06:30 puts the hour hand halfway between 6 and 7
  // on each of them, so a passenger walking past reads one time whichever way they came.
  reposeClockHands(rig, 6 * 3600 + 30 * 60)
  const minutes = rig.minute.map((p) => handAngle(p, root))
  assert.ok(Math.abs(minutes[0] - 180) < 1e-6 && Math.abs(minutes[1] - 180) < 1e-6, `both minute hands stand on 6 (${minutes.join(' / ')})`)
})

test('each face tells the time to the viewer standing in front of it', () => {
  // **The property the hands exist for, and the one this piece did not have.** A face of sixty
  // evenly spaced marks is **2-fold symmetric** — it looks exactly the same upside down, because
  // nothing on a ring of ticks says where 12 is. Only the hands do. So a dial hung half a turn
  // about its own normal read as a perfectly good clock face for the life of the piece while
  // pointing at the wrong time: at 06:30 the minute hand stood on the mark the viewer reads as 12.
  //
  // What has to hold, for a piece at rot 0 **and** at rot 2 (half a turn, so the *other* dial is
  // the one the camera sees), is that the face nearest the −y camera puts both hands at the
  // clock's own angles **on that camera's screen** — screen right = +x, screen up = +z — and the
  // far face does the same for the +y viewer, whose screen right is −x. An upside-down face lands
  // 180° out on both.
  const seconds = 6 * 3600 + 30 * 60 + 30 // 06:30:30: the hour hand has walked past 6, the minute hand sits between two marks
  const want = clockHandAngles(seconds)
  const screenAngle = (arm, fromPlusY) => {
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(arm.matrixWorld)
    return ((Math.atan2(fromPlusY ? -axis.x : axis.x, axis.z) * 180) / Math.PI + 360) % 360
  }
  const off = (a, b) => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }
  for (const rot of [0, 2]) {
    const { mats, root } = build(clock(0, 0, 0, 'c', rot))
    const rig = root.userData.clockRig
    reposeClockHands(rig, seconds)
    root.updateMatrixWorld(true)
    // Which dial the −y camera is looking at is the mount nearest it; the piece's own rotation is
    // what decides that, so it is read off the built geometry rather than assumed.
    const faces = rig.hour.map((pivot, i) => {
      let mount = pivot
      while (mount.parent && mount.parent !== root) mount = mount.parent
      return { i, mount, y: mount.getWorldPosition(new THREE.Vector3()).y }
    })
    faces.sort((a, b) => a.y - b.y)
    for (const [viewer, face] of [[-1, faces[0]], [1, faces[1]]]) {
      const arm = (which) => (which === 'hour' ? rig.hour : rig.minute)[face.i].children[0]
      for (const [which, expected] of [['hour', want.hour], ['minute', want.minute]]) {
        const got = screenAngle(arm(which), viewer > 0)
        assert.ok(
          off(got, expected) < 0.01,
          `rot ${rot}, the ${viewer < 0 ? '−y' : '+y'} viewer's ${which} hand reads ${expected.toFixed(1)}° (it reads ${got.toFixed(1)}°)`,
        )
      }
      // And **12 is up** on that face: the quarter mark the viewer sees at the top of the circle is
      // the dial's own 12. That is the half-turn about the vertical axis, and the thing a face of
      // symmetric ticks cannot show by itself.
      const centre = face.mount.getWorldPosition(new THREE.Vector3())
      const turn = new THREE.Quaternion()
      face.mount.getWorldQuaternion(turn).invert()
      let top = null
      face.mount.traverse((o) => {
        if (!o.isMesh || o.material !== mats.black || o.geometry.type !== 'BoxGeometry') return
        if (Math.abs(o.geometry.parameters.width - 0.09) > 1e-6) return // the four quarter marks
        const d = o.getWorldPosition(new THREE.Vector3()).sub(centre).applyQuaternion(turn)
        if (!top || d.z > top.z) top = d
      })
      const atTop = ((Math.atan2(top.x, top.z) * 180) / Math.PI + 360) % 360
      assert.ok(off(atTop, 0) < 0.01, `rot ${rot}, the ${viewer < 0 ? '−y' : '+y'} viewer has the ${atTop.toFixed(1)}° mark at the top of the circle, not 12`)
    }
  }
})

test('the scene sweeps the hands between snapshots, sets them on a seek, and stops when paused', () => {
  const { root } = build(clock(0, 0))
  const rig = root.userData.clockRig
  // The renderer's own window: one snapshot at frame time 1000 ms, the next due 1000 ms later.
  // `now` is the frame clock, so the two are driven independently and the arithmetic is visible.
  const ctx = { lastStateTime: 1000, stateIntervalMs: 1000 }
  const clocks = new ClockSystem(ctx)
  clocks.clockRigs.push(rig)
  const minute = () => handAngle(rig.minute[0], root)

  // **No snapshot yet**: the station has not said what time it is, so the piece keeps the pose it
  // was built with rather than jumping to midnight or stopping dead.
  clocks.updateClocks(1000)
  assert.ok(Math.abs(minute() - clockHandAngles(CLOCK_POSE_SECONDS).minute) < 1e-6, 'a clock built before the sim speaks keeps its built pose')

  // The first snapshot **sets** the clock — there is nothing to sweep from, so 06:00 stands.
  clocks.setSimTime(6 * 3600)
  clocks.updateClocks(1000)
  assert.equal(minute(), 0, 'the first snapshot sets the clock: 06:00, the minute hand on 12')

  // The next snapshot is one tick later, and a tick is a sim second at any speed
  // (`sim/constants.ts`: 1× runs one tick a second, fast-forward multiplies ticks and never the
  // step). The hands **sweep** that second across the interval: a minute hand is 0.1° a second,
  // so half way through the window it stands at 0.05° — between the two snapshots, which is the
  // whole reason there is a sweep. A hand that only moved when a snapshot arrived would read 0
  // here, and a hand driven off wall time by mistake would be at a minute's worth by now.
  ctx.lastStateTime = 1000
  clocks.setSimTime(6 * 3600 + 1)
  clocks.updateClocks(1000)
  assert.equal(minute(), 0, 'the sweep starts where the last snapshot left the clock')
  clocks.updateClocks(1500)
  assert.ok(Math.abs(minute() - 0.05) < 1e-9, `half way through the interval the minute hand has crept to 0.05° (${minute()})`)
  clocks.updateClocks(2000)
  assert.ok(Math.abs(minute() - 0.1) < 1e-9, `and it reaches the new snapshot at the end of the window (${minute()})`)

  // **A seek is a set, not a sweep.** The 时刻 window's calendar pick moves the clock by hours, and
  // a clock that swept there would wind through every hour in between — so at the first frame after
  // the seek the hands already read the new time.
  const sought = 6 * 3600 + 1 + 3 * 3600
  clocks.setSimTime(sought)
  ctx.lastStateTime = 2000
  clocks.updateClocks(2000)
  assert.ok(Math.abs(minute() - clockHandAngles(sought).minute) < 1e-6, 'a seek sets the hands at once, it does not wind them forward')
  // And the same going back: a jump to an earlier time is set too, rather than the hands sweeping
  // anticlockwise the way round the face.
  const back = sought - 4 * 3600
  clocks.setSimTime(back)
  clocks.updateClocks(2000)
  assert.ok(Math.abs(minute() - clockHandAngles(back).minute) < 1e-6, 'a step back in time sets them just as flatly')

  // **Paused, the hands stop.** No snapshot arrives, so the interpolation reaches the end of its
  // window and stays there however far the frame clock runs on.
  clocks.updateClocks(999_999)
  const stopped = minute()
  assert.ok(Math.abs(stopped - clockHandAngles(back).minute) < 1e-6, 'the hands stand on the time the sim stopped on')
  clocks.updateClocks(999_999 + 5000)
  assert.equal(minute(), stopped, 'and five seconds of wall clock later they have not moved')
})

test('the scene hands a built 时钟 to the clock system, and takes it back with the piece', () => {
  // **The one link no test of the model can see.** The dial's hands only follow the sim if
  // `ModuleSystem` tells the scene that the piece it just built has hands to turn
  // (`ClockSystem.clockRigs`) — a rig nobody is handed is a dial frozen at 10:09 for the whole
  // session, which is exactly the bug this piece has just been fixed for, and it looks like a
  // working clock in every other test. Mounted headless, the way `refused-ghost` mounts the
  // ghost: a bare scene, a material stub per name, and the siblings the module pass walks as
  // empty stubs.
  const scene = new THREE.Scene()
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshBasicMaterial({ name: String(k) })) })
  const modelMats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const ctx = new SceneContextData(scene, mats, modelMats, null)
  const modules = new ModuleSystem(ctx)
  const clocks = new ClockSystem(ctx)
  modules.trains = { psdGroups: [] }
  modules.lifts = { escalatorRolls: [], liftRigs: [], liftPickMeshes: [] }
  modules.crowd = { gateWings: [] }
  modules.clocks = clocks
  modules.ghost = { clearFencePreview() {} }
  modules.plates = {
    adScreens: [],
    tvScreens: [],
    retainTvPlates() {},
    retainSignPlates() {},
    retainDecorPlates() {},
    ownsTexture: () => false,
  }
  const station = { name: 't', seed: 1, cells: [{ x: 2, y: 2, z: 0, fill: 'solid' }], modules: [clock(2, 2)], lines: [] }
  modules.buildModules(station, new Set())
  const group = modules.moduleMeshes.children.find((c) => c.userData.moduleId === 'clock-1')
  assert.ok(group, 'the pass built the placed 时钟')
  const rig = group.userData.clockRig
  assert.ok(rig, 'and the piece carries its rig')
  assert.equal(clocks.clockRigs.length, 1, 'which the module pass handed to the clock system')
  assert.equal(clocks.clockRigs[0], rig, 'the very rig the dial was built with, not a copy')

  // Now the whole path is live: a snapshot sets the time and the piece on the screen turns to it.
  clocks.setSimTime(9 * 3600)
  clocks.updateClocks(0)
  assert.ok(Math.abs(handAngle(rig.minute[0], group) - clockHandAngles(9 * 3600).minute) < 1e-6, '09:00 puts the minute hand on 12')
  assert.ok(Math.abs(handAngle(rig.hour[0], group) - clockHandAngles(9 * 3600).hour) < 1e-6, 'and the hour hand on 9')

  // A rebuild drops the rig with the dial it turns: the next pass adds its own, and the list
  // holds the piece in front of the player rather than every dial the session ever built.
  modules.buildModules(station, new Set())
  assert.equal(clocks.clockRigs.length, 1, 'a rebuild leaves one rig, not two')
  assert.notEqual(clocks.clockRigs[0], rig, 'and it is the rig of the group now on screen')
})

test('the hover ghost’s 时钟 reads the sim clock too, and gives its hands back when it goes', () => {
  // **The ghost is the piece a click would place** (`GhostSystem.setModulePreview`), so a
  // translucent clock previewing at 10:09 while every clock on the wall reads the sim's time would
  // be the one surprise the hover exists to prevent — and the same translucent dial is what the
  // 删除 tool, the 移动 drag and the 吸取 copy draw. Its rig is handed over on build like a placed
  // piece's, and **dropped with the ghost**: a rig outliving its group is a pivot the clock system
  // would go on turning in a piece that is no longer in the scene.
  const scene = new THREE.Scene()
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  // `MaterialSet.owns`' own answer, so every ghost material counts as the kit's and the preview
  // keeps nothing to dispose. This is the one member of the material set the ghost asks about.
  mats.owns = () => true
  const modelMats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const ctx = new SceneContextData(scene, mats, modelMats, null)
  ctx.stationData = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
  const ghost = new GhostSystem(ctx)
  const clocks = new ClockSystem(ctx)
  ghost.clocks = clocks
  ghost.plates = { ownsTexture: () => false }
  ghost.modules = { fenceGroups: [] }

  ghost.setModulePreview(clock(2, 2))
  const group = ghost.previewGroup.children[0]
  assert.ok(group && ghost.previewGroup.visible, 'the hover built its translucent piece')
  const rig = group.userData.clockRig
  assert.equal(clocks.previewRigs.length, 1, 'and handed its hands to the clock system')
  assert.equal(clocks.previewRigs[0], rig, 'the very rig the ghost dial was built with')

  // A snapshot sets the time, and the **ghost's** dial turns to it — 15:45, so the minute hand is
  // on 9 and the hour hand three quarters of the way from 3 to 4: a pose the frozen 10:09 is not.
  const quarterTo = 15 * 3600 + 45 * 60
  clocks.setSimTime(quarterTo)
  clocks.updateClocks(0)
  assert.ok(Math.abs(handAngle(rig.minute[0], group) - clockHandAngles(quarterTo).minute) < 1e-6, 'the ghost’s minute hand stands on 9')
  assert.ok(Math.abs(handAngle(rig.hour[0], group) - clockHandAngles(quarterTo).hour) < 1e-6, 'and its hour hand is on its way to 4')
  // And it is **swept** by the same window a placed clock is, because it is the same clock rather
  // than a second reading of the time: one sim second later, at the end of the interval.
  ctx.lastStateTime = 0
  ctx.stateIntervalMs = 1000
  clocks.setSimTime(quarterTo + 1)
  clocks.updateClocks(1000)
  assert.ok(
    Math.abs(handAngle(rig.minute[0], group) - clockHandAngles(quarterTo + 1).minute) < 1e-6,
    'the ghost is swept to the new snapshot like a placed clock',
  )

  // The pointer moves off the cell: the ghost goes, and its hands are handed back.
  ghost.clearModulePreview()
  assert.equal(clocks.previewRigs.length, 0, 'clearing the ghost gives its rigs back')
  assert.equal(ghost.previewGroup.children.length, 0, 'and its geometry with them')
  // Setting the time again with no ghost up is a no-op rather than a turn of a pivot in a group the
  // scene has dropped.
  clocks.updateClocks(1000)
  assert.equal(clocks.previewRigs.length, 0, 'and nothing comes back to be turned')
})
