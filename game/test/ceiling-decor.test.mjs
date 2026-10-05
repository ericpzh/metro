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
  isMovableModule,
  moduleAt,
  moduleEnvelope,
  placementBlocked,
  placementOnTrack,
} from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isDecorType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { buildModule } from '../src/render/models.ts'

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

test('the factory builds both pieces with the hover rotation and no cfg', () => {
  const c = createModule('clock', 3, 4, -4, 'c', 2)
  assert.equal(c?.type, 'clock')
  assert.equal(c?.rot, 2)
  assert.deepEqual(c?.cfg, {})
  const v = createModule('cctv', 3, 4, -4, 'v', 1)
  assert.equal(v?.type, 'cctv')
  assert.equal(v?.rot, 1)
  assert.deepEqual(v?.cfg, {})
})

test('the palette files both under 装饰, with their Chinese labels', () => {
  for (const [id, label] of [
    ['clock', '时钟'],
    ['cctv', '监控'],
  ]) {
    const option = MODULE_OPTIONS.find((m) => m.id === id)
    assert.ok(option, `${id} is in the palette`)
    assert.equal(option.label, label)
    assert.equal(option.w, 1)
    assert.equal(option.h, 1)
    assert.equal(isDecorType(id), true, `${id} belongs to the 装饰 folder`)
    assert.equal(moduleLabel(id), label)
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

test('neither piece may share a cell, with anything', () => {
  assert.equal(placementBlocked([clock(2, 2)], cctv(2, 2, 0, 'v2')), true)
  assert.equal(placementBlocked([cctv(2, 2)], clock(2, 2, 0, 'c2')), true)
  assert.equal(placementBlocked([clock(2, 2)], gate(2, 2, 0)), true)
  assert.equal(placementBlocked([gate(2, 2, 0)], cctv(2, 2, 0, 'v2')), true)
  // A piece a cell along, or on the storey above, is free.
  assert.equal(placementBlocked([clock(2, 2)], cctv(3, 2, 0, 'v2')), false)
  assert.equal(placementBlocked([cctv(2, 2)], clock(2, 2, 4, 'c2')), false)
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
  assert.equal(sweepFamily(cctv(0, 0)), 'cctv')
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
    // hour hand near 10 o'clock (300°) and the minute hand past 2 (60°), because the pose is
    // 10:09. A hand laid across its hour — the bug this test exists for — lands 90° out.
    const poses = [[304, 0.19], [54, 0.27]]
    for (const [deg, len] of poses) {
      const arm = hands.find((m) => Math.abs(m.geometry.parameters.width - len) < 0.02)
      assert.ok(arm, `face ${i}: the ${len === 0.19 ? 'hour' : 'minute'} hand`)
      // A hand carries its length along local **x**, like a mark, so its axis is the matrix's first
      // column. The radial direction at its hour `deg` is `(sin, cos)`; the hand must point that way.
      // A hand lying *across* its hour — the bug this guards — comes out 90° from this.
      const axis = new THREE.Vector3(1, 0, 0).transformDirection(arm.matrixWorld)
      const got = (Math.atan2(axis.x, axis.z) * 180) / Math.PI
      const a = (deg * Math.PI) / 180
      const want = (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI
      let off = Math.abs(got - want) % 360
      if (off > 180) off = 360 - off
      assert.ok(off < 6 || Math.abs(off - 180) < 6, `face ${i}: the ${len === 0.19 ? 'hour' : 'minute'} hand points at ${want.toFixed(0)}° (it points ${got.toFixed(0)}°)`)
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
  // The head is dark and the lens is out front, on the −y side of its own body.
  const lens = meshes.filter((m) => m.material === mats.black && m.geometry.type === 'CylinderGeometry')
  assert.ok(lens.length >= 1, 'a lens barrel')
  const lensY = Math.min(...lens.map((m) => m.position.y))
  assert.ok(lensY < -0.1, 'the lens sits on the −y front')
  assert.ok(lens[0].geometry.parameters.radiusTop <= 0.06, 'a small lens, not a porthole')
  // The two illuminator LEDs ride beside the lens, in the same front plane.
  const leds = meshes.filter((m) => m.material === mats.ledRed)
  assert.equal(leds.length, 2, 'a two-LED illuminator')
  assert.ok(leds.every((m) => m.position.y < -0.02), 'both LEDs are on the front face')
  assert.ok(Math.sign(leds[0].position.x) !== Math.sign(leds[1].position.x), 'one each side of the lens')
  // A sun hood over the head, and the ceiling plate the stem drops from.
  assert.ok(meshes.filter((m) => m.material === mats.steel).length >= 3, 'hood, stem and arm are steel')
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
