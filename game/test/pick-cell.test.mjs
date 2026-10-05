// Where a pointer hit lands, in whole cells — GAME-SPEC §4.1 (the 1 m editing grid)
// and §5.1 (the volume a run takes out of the block under it).
//
// `CameraSystem.pick` answers a tool with three things: the block it hit, the block
// a placement would take, and the face's normal. The first two are coordinates in the
// station document, and the document only addresses whole cells: `repairGrid` drops a
// fraction on the way in *and* on the way out, `removeCells` matches an exact
// coordinate, and the mesher draws a fractional block offset from its neighbours.
// `test/grid.test.mjs` guards every command downstream of the pick.
//
// The pick itself reads the **drawn** mesh, and `THREE.Intersection.face.normal` is
// the *triangle's* geometric normal, not the cell face's axis. Two faces this game
// draws are deliberately off-axis, so `cell + face.normal` asked for a fraction:
//
//   * the block under a 楼梯 / 扶梯 is a wedge — its top is the run's sloping
//     underside (`rampSlopeCuts`) — so hovering it and laying a 地基 block beside it
//     committed a block at (4.44, −0.15, 1.89): off the grid, invisible to every tool
//     from then on, and dropped by the grid repair on the next load;
//   * the 12.5 cm top-rim chamfer of every block open to the air faces diagonally, so
//     the same thing happened on any block at all, escalator or not.
//
// So the test rays the *real* chunk geometry — the same mesh the player sees — rather
// than feeding `pickCells` a normal someone typed: a fix that only passes on made-up
// numbers is exactly what let this through.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { faceAxis, faceStep, pickCells } from '../src/render/pickCell.ts'
import { rampSlopeCuts } from '../src/sim/openings.ts'
import { packKey } from '../src/sim/types.ts'
import { addCells } from '../src/build/model/Cells.ts'
import { FACE_NORMAL, dominantFace } from '../src/app/tools/geometry/faces.ts'

/** A run climbing one storey along −x: 6 cells across, 4 m up. */
const escalator = {
  id: 'e1', type: 'escalator', x: 6, y: 0, z: 0, rot: 0,
  from: { x: 6, y: 0, z: 0 }, to: { x: 0, y: 0, z: 4 }, cfg: { dir: 'up' },
}

const whole = (p) => p.every(Number.isInteger)
const show = (p) => `(${p.map((v) => v.toFixed(3)).join(', ')})`

/**
 * The drawn mesh of a station, as pickable meshes. Every cell the caller lists is
 * solid, and `slope` (the cut map) shapes the blocks under a run exactly as the
 * scene meshes them.
 */
function draw(cells, slope) {
  const solid = buildSolidSet(cells)
  const emit = new Set(cells.map((c) => packKey(c.x, c.y, c.z)))
  const zs = cells.map((c) => c.z)
  const lo = Math.min(...zs)
  const hi = Math.max(...zs)
  const chunk = meshChunk(solid, new Map(), 0, 0, lo, hi, emit, undefined, undefined, undefined, slope)
  const group = new THREE.Group()
  for (const part of chunk.parts) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
    g.setIndex(new THREE.BufferAttribute(part.indices, 1))
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()))
  }
  group.updateMatrixWorld(true)
  return { group, solid }
}

/** The first thing a straight-down ray from high above `(x, y)` meets. */
function dropAt(group, x, y) {
  const ray = new THREE.Raycaster()
  ray.set(new THREE.Vector3(x, y, 64), new THREE.Vector3(0, 0, -1))
  const hits = ray.intersectObjects(group.children, false)
  assert.ok(hits.length > 0, `nothing under (${x}, ${y})`)
  const hit = hits[0]
  const n = hit.face.normal
  return { point: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] }
}

/* ------------------------------------------------------- the pure cell math */

test('a pick names whole cells, whatever the drawn face is angled like', () => {
  const cases = [
    // An ordinary axis-aligned face: up, down and a side.
    { n: [0, 0, 1], place: [4, 0, 1], what: 'the top of a block' },
    { n: [0, 0, -1], place: [4, 0, -1], what: 'the underside of a block' },
    { n: [1, 0, 0], place: [5, 0, 0], what: 'an east face' },
    { n: [0, -1, 0], place: [4, -1, 0], what: 'a south face' },
    // The wedge under a run: the slope's own normal, read off the mesh below.
    { n: [0.44, -0.15, 0.88], place: [4, 0, 1], what: "a run's sloping underside" },
    { n: [-0.6, 0, 0.8], place: [4, 0, 1], what: 'a steeper slope, on the other axis' },
    // A rounded corner, and the top-rim chamfer over one: diagonals in x and y.
    { n: [0.71, 0.71, 0], place: [5, 0, 0], what: 'a rounded corner' },
    { n: [-0.69, 0.18, 0.7], place: [4, 0, 1], what: 'the chamfer over a corner' },
    { n: [0.99, -0.14, 0], place: [5, 0, 0], what: 'a corner that leans east' },
  ]
  for (const { n, place, what } of cases) {
    const picked = pickCells([4.5, 0.5, 0.5], n)
    assert.ok(whole(picked.cell) && whole(picked.place), `${what}: ${show(picked.place)} left the grid`)
    assert.deepEqual(picked.cell, [4, 0, 0], `${what}: the block under the pointer`)
    assert.deepEqual(picked.place, place, `${what}: the block a placement takes`)
    // The placement is the neighbour the face opens onto — never the block itself,
    // never a diagonal.
    const step = picked.place.map((v, i) => v - picked.cell[i])
    assert.equal(Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]), 1, `${what}: ${show(step)} is not one step`)
  }
})

test('the face snap is the one the 材质 brush paints, so the two can never disagree', () => {
  const normals = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
    [0.44, -0.15, 0.88], [-0.6, 0, 0.8], [0.71, 0.71, 0], [-0.69, 0.18, 0.7],
  ]
  for (const n of normals) {
    const { axis, positive } = faceAxis(n)
    const chosen = dominantFace(n)
    assert.deepEqual(FACE_NORMAL[chosen], faceStep(n), `the face ${chosen} and the step disagree on ${show(n)} at ${axis}${positive ? '+' : '-'}`)
    // The snapped axis is the one the normal most points along, and it keeps the
    // normal's sign: a face is never flipped by the snap.
    const along = { x: n[0], y: n[1], z: n[2] }[axis]
    const magnitude = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]))
    assert.ok(Math.abs(along) >= magnitude - 1e-9, `${axis} is not the dominant axis of ${show(n)}`)
    assert.equal(positive, along >= 0, `${axis} lost its sign on ${show(n)}`)
  }
})

/* ------------------------------------------- the geometry that caused it */

test('the block under an escalator hands back a whole cell, wedge and all', () => {
  const cells = []
  for (let x = 0; x <= 8; x++) for (let y = -1; y <= 1; y++) for (let z = 0; z <= 1; z++) cells.push({ x, y, z, fill: 'solid' })
  const cuts = rampSlopeCuts([escalator])
  const { group, solid } = draw(cells, cuts)
  // A block really is cut here: the run hangs over the ground it climbs.
  assert.ok(cuts.size > 0, 'the escalator cuts nothing, so this probe proves nothing')

  let angled = 0
  for (const [x, y] of [[4.5, 0.5], [4.9, 0.5], [3.5, 0.5], [2.4, 0.5], [5.1, 0.5]]) {
    const { point, normal } = dropAt(group, x, y)
    // The drawn face is what broke the old arithmetic: its normal is off-axis…
    const tilted = normal.some((v) => Math.abs(v) > 1e-6 && Math.abs(Math.abs(v) - 1) > 1e-6)
    if (tilted) angled++
    // …and the block itself was read whole either way, so `cell + normal` — the old
    // placement cell — was a fraction. That is the bug this pins.
    const picked = pickCells(point, normal)
    const naive = picked.cell.map((v, i) => v + normal[i])
    if (tilted) assert.ok(!whole(naive), `${show(naive)} was whole anyway, so the probe is not on a slope`)

    assert.ok(whole(picked.cell) && whole(picked.place), `over (${x}, ${y}) a block went to ${show(picked.place)}`)
    assert.ok(solid.has(packKey(...picked.cell)), `over (${x}, ${y}) the pick named a void block ${show(picked.cell)}`)
    assert.deepEqual(picked.normal, faceStep(normal))
    // And the 地基 tool's own add path keeps it: the anchor a block click takes is
    // this placement cell, and whatever the brush lays down is a whole cell — or a
    // reserved opening it correctly refuses (the run's own corridor over the wedge).
    const { cells: added, blocked } = addCells([], [picked.place], [escalator])
    assert.equal(added.length + blocked, 1, `over (${x}, ${y}) the brush neither laid nor refused anything`)
    for (const c of added) assert.ok(whole([c.x, c.y, c.z]), `the brush minted (${c.x}, ${c.y}, ${c.z})`)
  }
  assert.ok(angled > 0, 'no probe landed on the wedge, so the report is not reproduced')
})

test('a plain block’s top-rim chamfer is on the grid too', () => {
  const { group, solid } = draw([{ x: 0, y: 0, z: 0, fill: 'solid' }], undefined)
  // A lone block wears its 12.5 cm chamfer on all four sides, and it leans at 45°, so a
  // ray dropped just inside an edge lands on a face whose normal is diagonal in x and z
  // — not on an axis. The block's outline above the bevel is a plain square, so a corner
  // is not a diagonal any more: the chamfer meeting there is.
  for (const [px, py] of [[0.05, 0.5], [0.5, 0.05], [0.05, 0.05]]) {
    const { normal } = dropAt(group, px, py)
    assert.ok(
      Math.abs(normal[0]) > 1e-6 || Math.abs(normal[1]) > 1e-6,
      `the probe at (${px}, ${py}) hit an axis face: ${show(normal)}`,
    )
    assert.ok(Math.abs(normal[2]) > 1e-6, 'and the chamfer still faces up')
  }
  // Level ground a little way in from the rim: the flat top, which does face straight up.
  const { point, normal } = dropAt(group, 0.5, 0.5)
  assert.deepEqual(normal.map((v) => Math.round(v)), [0, 0, 1], 'the middle of the block is its flat top')
  // The old arithmetic is what this pins: on the chamfer, `cell + normal` is a fraction.
  assert.ok(!whole(pickCells(point, [0.141, 0, 0.99]).cell.map((v, i) => v + [0.141, 0, 0.99][i])), 'the chamfer normal is off-axis')
  const picked = pickCells(point, normal)
  assert.ok(whole(picked.cell) && whole(picked.place), `a block picked on its top went to ${show(picked.place)}`)
  assert.ok(solid.has(packKey(...picked.cell)), `the pick named a void block ${show(picked.cell)}`)
})
