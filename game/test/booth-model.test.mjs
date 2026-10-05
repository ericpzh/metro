// The 售票亭 booth's own model (`render/models.ts` `buildBooth`). Unlike the room
// brushes, the booth is no solid voxel — it is a counter ring with a glass screen
// standing over it, and the whole piece is one closed box: four counters against the
// four outer faces of the cells the module reserves and four screens closing around
// them. It was rebuilt after a pass that measured each side from a different line —
// the east counter hung 0.55 m out in the next cell, the north counter stood a whole
// cell inside the room, the capping boards stood proud of every face, and each screen
// stopped a counter-depth short of the corner and left a hole in the glass beside it.
//
// So what this pins is the box: nothing outside the reserved cells, every counter
// flush on its own outer face, and a screen band that runs the entire way round with
// no gap at a corner. The numbers here are the model's own (`DEPTH`, `GLASS_INSET`,
// …); if the piece is re-proportioned they move with it, but the shape they describe
// may not change.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { moduleEnvelope } from '../src/sim/placement.ts'
import { buildModule } from '../src/render/models.ts'

const DESK = 0.9
const DEPTH = 0.55
const GLASS_T = 0.04
const GLASS_INSET = 0.02
const GLASS_END = GLASS_INSET + GLASS_T
const GLASS_TOP = 2.0
const POST = 0.09

const booth = (w, h, x = 0, y = 0) => ({ id: 'booth-1', type: 'booth', x, y, z: 0, w, h, cfg: { kind: 'ticket' } })

/** Micron slop: a box corner comes back off `Box3.setFromObject` a few ulps out. */
const EPS = 1e-6
const near = (a, b) => Math.abs(a - b) < EPS

/**
 * Build one booth with the lightest context its builder needs — a lazily minted
 * material per name, so a mesh can be recognised by the material it was handed — and
 * return its meshes as world-space boxes. The booth builds in world space (`buildBooth`
 * is not routed through `placeLocal`), so these are the room's own coordinates.
 */
function build(mod) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const data = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
  const group = buildModule(mod, { mats, data, trackCells: new Set(), finish: () => mats.steel, preview: false })
  group.updateMatrixWorld(true)
  const boxes = []
  group.traverse((o) => {
    if (o.isMesh) boxes.push({ mat: o.material, box: new THREE.Box3().setFromObject(o) })
  })
  const withMat = (mat) => boxes.filter((b) => b.mat === mat).map((b) => b.box)
  return { mats, boxes, desks: withMat(mats.steel), screens: withMat(mats.glass), trim: withMat(mats.darkSteel) }
}

/** Is the world point inside one of these boxes? */
const covers = (boxes, x, y, z) => boxes.some((b) => x >= b.min.x - EPS && x <= b.max.x + EPS && y >= b.min.y - EPS && y <= b.max.y + EPS && z >= b.min.z - EPS && z <= b.max.z + EPS)

/** The plan rectangle a box is flush with: the room's own outer faces. */
const flat = (b) => ({ x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y })

test('the booth never leaves the cells or the height its module reserves', () => {
  for (const [w, h] of [[3, 3], [4, 4], [5, 3], [3, 6], [6, 4]]) {
    const mod = booth(w, h)
    const { boxes } = build(mod)
    const e = moduleEnvelope(mod)
    assert.ok(boxes.length > 0, `the ${w}x${h} booth drew nothing`)
    for (const { mat, box } of boxes) {
      const label = `${w}x${h} ${mat.name}`
      assert.ok(box.min.x >= e.x0 - EPS && box.max.x <= e.x1 + EPS, `${label} leaves the cells across x: ${box.min.x}..${box.max.x}`)
      assert.ok(box.min.y >= e.y0 - EPS && box.max.y <= e.y1 + EPS, `${label} leaves the cells across y: ${box.min.y}..${box.max.y}`)
      assert.ok(box.min.z >= e.z0 - EPS && box.max.z <= e.z1 + EPS, `${label} leaves the reserved height: ${box.min.z}..${box.max.z}`)
    }
    // And it fills its cells: the ring touches all four outer faces, which is what
    // "the full box" means from the outside.
    const box = new THREE.Box3()
    for (const { box: b } of boxes) box.union(b)
    assert.ok(near(box.min.x, e.x0) && near(box.max.x, e.x1), `${w}x${h} does not reach both x faces`)
    assert.ok(near(box.min.y, e.y0) && near(box.max.y, e.y1), `${w}x${h} does not reach both y faces`)
  }
})

test('every counter stands on its own outer face, all the way into both corners', () => {
  const { desks } = build(booth(4, 4))
  assert.equal(desks.length, 4, 'the ring is four counter runs')
  const west = desks.map(flat).find((r) => near(r.x0, 0))
  const east = desks.map(flat).find((r) => near(r.x1, 4))
  const south = desks.map(flat).find((r) => near(r.y0, 0) && near(r.y1, DEPTH))
  const north = desks.map(flat).find((r) => near(r.y1, 4) && near(r.y0, 4 - DEPTH))
  assert.ok(west && near(west.x1, DEPTH) && near(west.y0, 0) && near(west.y1, 4), `west counter is not a full run on the west face: ${JSON.stringify(west)}`)
  assert.ok(east && near(east.x0, 4 - DEPTH) && near(east.y0, 0) && near(east.y1, 4), `east counter is not a full run on the east face: ${JSON.stringify(east)}`)
  assert.ok(south && near(south.y1, DEPTH) && near(south.x0, DEPTH) && near(south.x1, 4 - DEPTH), `south counter is not butted between the corners: ${JSON.stringify(south)}`)
  assert.ok(north && near(north.y0, 4 - DEPTH) && near(north.x0, DEPTH) && near(north.x1, 4 - DEPTH), `north counter is not butted between the corners: ${JSON.stringify(north)}`)
})

test('the screen band closes the box: no gap at a corner, and the sheets butt', () => {
  const { screens } = build(booth(4, 4))
  assert.equal(screens.length, 4, 'the screen is four sheets')
  const west = screens.map(flat).find((r) => near(r.x0, GLASS_INSET))
  const east = screens.map(flat).find((r) => near(r.x1, 4 - GLASS_INSET))
  const south = screens.map(flat).find((r) => near(r.y0, GLASS_INSET))
  const north = screens.map(flat).find((r) => near(r.y1, 4 - GLASS_INSET))
  assert.ok(west && near(west.x1, GLASS_END) && near(west.y0, 0) && near(west.y1, 4), `west sheet: ${JSON.stringify(west)}`)
  assert.ok(east && near(east.x0, 4 - GLASS_END) && near(east.y0, 0) && near(east.y1, 4), `east sheet: ${JSON.stringify(east)}`)
  // The runs that meet the west and east sheets stop on their *inner* faces, so the two
  // sheets touch instead of leaving the counter-deep hole the old ring had there.
  assert.ok(south && near(south.y1, GLASS_END) && near(south.x0, GLASS_END) && near(south.x1, 4 - GLASS_END), `south sheet: ${JSON.stringify(south)}`)
  assert.ok(north && near(north.y0, 4 - GLASS_END) && near(north.x0, GLASS_END) && near(north.x1, 4 - GLASS_END), `north sheet: ${JSON.stringify(north)}`)
  for (const b of screens) assert.ok(near(b.max.z, 1 + GLASS_TOP), 'the screens share one head height')
})

test('the counter band and the screen band each run the whole way round', () => {
  const { desks, screens, trim } = build(booth(4, 4))
  // The mullions are the trim boxes whose plan is one post square; the boards and the
  // screens' top rails are long on one axis.
  const posts = trim.filter((b) => near(b.max.x - b.min.x, POST) && near(b.max.y - b.min.y, POST))
  assert.equal(posts.length, 4, 'one corner mullion per corner')
  const screenBand = [...screens, ...posts]
  // Walk each side's own centre line — the counter band at half its depth, the screen
  // band at the glass line — and require every sample to be inside a piece. A hole of
  // the size this rebuild removed shows up as an uncovered sample.
  const lines = (v, span) => [
    Array.from({ length: Math.round(span / 0.02) + 1 }, (_, i) => [v, i * 0.02]),
    Array.from({ length: Math.round(span / 0.02) + 1 }, (_, i) => [4 - v, i * 0.02]),
    Array.from({ length: Math.round(span / 0.02) + 1 }, (_, i) => [i * 0.02, v]),
    Array.from({ length: Math.round(span / 0.02) + 1 }, (_, i) => [i * 0.02, 4 - v]),
  ].flat()
  for (const [x, y] of lines(DEPTH / 2, 4)) {
    assert.ok(covers(desks, x, y, 1 + DESK / 2), `the counter band has a gap at ${x},${y}`)
  }
  for (const [x, y] of lines(GLASS_INSET + GLASS_T / 2, 4)) {
    assert.ok(covers(screenBand, x, y, 1 + (DESK + GLASS_TOP) / 2), `the screen band has a gap at ${x},${y}`)
  }
})

test('the piece is the same on all four sides', () => {
  const { boxes } = build(booth(4, 4))
  const c = 2 // the room's centre, for a 4 x 4 booth on (0, 0)
  const turn = (x, y) => [c + (y - c), c - (x - c)]
  // What covers a point, by material. The ring's slabs are not themselves four-fold
  // symmetric — the west and east runs own the corners and the north and south runs
  // butt between them — but the box they build is, and that is the contract.
  const key = (x, y, z) =>
    boxes
      .filter(({ box }) => covers([box], x, y, z))
      .map(({ mat }) => mat.name)
      .sort()
      .join('+')
  const samples = []
  for (let a = 0.01; a < 4; a += 0.07) samples.push(a)
  for (const z of [1 + DESK / 2, 1 + DESK, 1 + (DESK + GLASS_TOP) / 2]) {
    for (const x of samples) {
      for (const y of samples) {
        const [tx, ty] = turn(x, y)
        assert.equal(key(x, y, z), key(tx, ty, z), `the piece differs at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} from its own quarter turn`)
      }
    }
  }
})
