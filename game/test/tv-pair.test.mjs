// Two 电视 back to back on one tile (`sim/tvs.ts`, `render/models.ts` `buildTv`).
//
// A second 电视 turned to face the other way may share a cell with the first, and
// the two are then **one object**: a single housing with a lit face each side. Two
// things about that are silent if they break, so both are pinned here rather than
// left to a visual check:
//
//   1. the pair rule itself — which arrangements may share a tile. Getting it wrong
//      either refuses a legal back-to-back (`placementColliders`) or lets two
//      perpendicular panels cross inside one block, which no single housing can be
//      drawn for;
//   2. the merged draw. A 电视's housing is symmetric about its centre, so drawing
//      two solo models in one cell leaves each panel's dark backing half-coincident
//      with the other's: the station board lands exactly coplanar with the far face
//      of the opposite backing and z-fights it, and that backing also swallows the
//      outer 0.006 m of the lit pane. `check-two-tvs` (a throwaway probe) is what
//      found it; the "no lit pane is buried" test below is what keeps it found.
//
// `models.ts` needs a DOM for its canvas textures, so the geometry half supplies a
// minimal one, exactly as `tv-screen.test.mjs` does. The pair rule is pure and runs
// without any of it.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TV_HALF,
  TV_PAIR_AXIS_NONE,
  tvBackToBack,
  tvFacing,
  tvPairAxis,
  tvPairSlot,
} from '../src/sim/tvs.ts'
import { moduleAt, placementBlocked, placementColliders, ceilingMountMissing, moduleEnvelope } from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'
import { facingFrom } from '../src/render/pickFacing.ts'

/* ------------------------------------------------------------- the pair rule */

const tv = (x, y, z, rot, id = `tv-${rot}`) => ({ id, type: 'tv', x, y, z, rot, cfg: {} })

test('a 电视 looks along −y turned by its rotation', () => {
  // The same relationship `wallSide` describes for a wall-mounted panel: `rot` is
  // the counter-clockwise quarter-turn `sim/track.ts` applies.
  assert.deepEqual(tvFacing(0), [0, -1])
  assert.deepEqual(tvFacing(1), [1, 0])
  assert.deepEqual(tvFacing(2), [0, 1])
  assert.deepEqual(tvFacing(3), [-1, 0])
})

test('two 电视 share a tile only facing exactly opposite ways', () => {
  // rot 0 and rot 2 are the north–south pair; rot 1 and rot 3 the east–west one.
  assert.equal(tvPairAxis(tv(0, 0, 0, 0), tv(0, 0, 0, 2)), 0)
  assert.equal(tvPairAxis(tv(0, 0, 0, 2), tv(0, 0, 0, 0)), 0)
  assert.equal(tvPairAxis(tv(0, 0, 0, 1), tv(0, 0, 0, 3)), 1)
  assert.equal(tvPairAxis(tv(0, 0, 0, 3), tv(0, 0, 0, 1)), 1)
  // The two look exactly away from each other, so neither can be in front of the
  // other's screen.
  for (const [a, b] of [[0, 2], [1, 3], [2, 0], [3, 1]]) {
    const [ax, ay] = tvFacing(a)
    const [bx, by] = tvFacing(b)
    assert.equal(ax + bx, 0)
    assert.equal(ay + by, 0)
  }
  // A quarter-turn apart would be two panels crossing inside the block, and the
  // same way round would be a duplicate panel: both are refused.
  for (const [a, b] of [[0, 0], [0, 1], [0, 3], [1, 0], [1, 2], [2, 1], [2, 3], [3, 0], [3, 2]]) {
    assert.equal(tvPairAxis(tv(0, 0, 0, a), tv(0, 0, 0, b)), TV_PAIR_AXIS_NONE, `rot ${a} vs ${b}`)
    assert.equal(tvBackToBack(tv(0, 0, 0, a), tv(0, 0, 0, b)), false)
  }
})

test('a back-to-back pair shares the cell, and nothing else about a 电视 changes', () => {
  const a = tv(2, 3, 0, 0, 'a')
  const b = tv(2, 3, 0, 2, 'b')
  assert.equal(placementBlocked([a], b), false)
  assert.equal(placementBlocked([b], a), false)
  assert.deepEqual(placementColliders([a], b), [])
  // The other way round, and a quarter turn: still one piece per cell.
  assert.equal(placementBlocked([a], tv(2, 3, 0, 1, 'c')), true)
  assert.equal(placementBlocked([a], tv(2, 3, 0, 0, 'd')), true)
  // A pair claims the cell against everything that is not its opposite number.
  assert.equal(placementBlocked([a, b], { id: 'g', type: 'gate', x: 2, y: 3, z: 0, cfg: { dir: 'both' } }), true)
  // Adjacent cells are untouched, and the ceiling rule still applies to the pair.
  assert.equal(placementBlocked([a], tv(3, 3, 0, 2, 'e')), false)
  assert.equal(ceilingMountMissing([{ x: 2, y: 3, z: 0, fill: 'solid' }, { x: 2, y: 3, z: 4, fill: 'solid' }], a), false)
  assert.equal(ceilingMountMissing([{ x: 2, y: 3, z: 0, fill: 'solid' }], a), true)
})

test('the picker takes the face the pointer is looking at', () => {
  const a = tv(2, 3, 0, 0, 'a')
  const b = tv(2, 3, 0, 2, 'b')
  const both = [a, b]
  // No direction: the document's own order answers, as everywhere else.
  assert.equal(moduleAt(both, 2, 3, 0)?.id, 'a')
  // Looking from −y, the piece whose screen faces −y is the one on screen.
  assert.equal(moduleAt(both, 2, 3, 0, [0, -1])?.id, 'a')
  assert.equal(moduleAt(both, 2, 3, 0, [0, 1])?.id, 'b')
  // The order in the document must not matter: swap them and the answer follows
  // the direction, not the list.
  assert.equal(moduleAt([b, a], 2, 3, 0, [0, -1])?.id, 'a')
  assert.equal(moduleAt([b, a], 2, 3, 0, [0, 1])?.id, 'b')
  // A lone 电视 is unaffected by a direction, and an empty cell is empty.
  assert.equal(moduleAt([a], 2, 3, 0, [0, 1])?.id, 'a')
  assert.equal(moduleAt(both, 9, 9, 0, [0, 1]), undefined)
})

test('the direction the viewport hands the picker is the way the player looks from', async () => {
  // `moduleAt`'s `facing` is the piece-to-eye step, but `Camera.getWorldDirection`
  // is negated by three (a camera looks down its local −z), so it returns the
  // *look* direction. Handing that straight to the picker picks the far pane of a
  // pair — the screen whose lit face is turned away — and looks right until someone
  // right-clicks a 电视. `facingFrom` is where the sign is decided, so it is pinned
  // here rather than left to a visual check.
  const THREE = await import('three')
  const a = tv(2, 3, 0, 0, 'a')
  const b = tv(2, 3, 0, 2, 'b')
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  const look = new THREE.Vector3()

  // Standing at −y and looking at the cell: the −y pane faces the viewer.
  camera.position.set(2.5, -4, 2)
  camera.lookAt(2.5, 3.5, 2)
  camera.updateMatrixWorld(true)
  camera.getWorldDirection(look)
  assert.ok(look.y > 0, 'guard: the look direction points at the cell, the opposite of what moduleAt wants')
  assert.deepEqual(facingFrom(camera).map((v) => Math.round(v)), [0, -1])
  assert.equal(moduleAt([a, b], 2, 3, 0, facingFrom(camera))?.id, 'a', 'the pane facing the camera')

  // The mirror camera, on the other side, picks the other television.
  camera.position.set(2.5, 10, 2)
  camera.lookAt(2.5, 3.5, 2)
  camera.updateMatrixWorld(true)
  camera.getWorldDirection(look)
  assert.ok(look.y < 0)
  assert.deepEqual(facingFrom(camera).map((v) => Math.round(v)), [0, 1])
  assert.equal(moduleAt([a, b], 2, 3, 0, facingFrom(camera))?.id, 'b', 'the far pane is a different piece')
})

test('the first piece in the document hangs the pair, and both keep their own look', () => {
  const a = tv(2, 3, 0, 0, 'a')
  const b = tv(2, 3, 0, 2, 'b')
  const slotA = tvPairSlot('a', [a, b])
  const slotB = tvPairSlot('b', [a, b])
  // One suspension for the object: exactly one of the two hangs it.
  assert.equal(slotA.hangs, true)
  assert.equal(slotB.hangs, false)
  assert.equal(slotA.rodId, 'a')
  assert.equal(slotB.rodId, 'a')
  assert.equal([slotA, slotB].filter((s) => s.hangs).length, 1)
  // The pair shares one housing, and it is two panels thick — not a box as deep as
  // the cell. Which way each member looks is deliberately **not** a field: both print
  // on their own local −y and `placeLocal` turns each by its own `rot`, so handing the
  // model a direction as well would turn the half-turn twice.
  assert.equal(slotA.depth, 2 * TV_HALF)
  assert.equal(slotB.depth, 2 * TV_HALF)
  assert.deepEqual(Object.keys(slotA).sort(), ['depth', 'hangs', 'rodId'])
  // Which of the two hangs it is the document's order, not the caller's.
  assert.equal(tvPairSlot('a', [b, a]).hangs, false)
  assert.equal(tvPairSlot('b', [b, a]).hangs, true)
})

test('a lone 电视 still draws itself whole, so an old station is unchanged', () => {
  const a = tv(2, 3, 0, 0, 'a')
  const slot = tvPairSlot('a', [a])
  assert.deepEqual(slot, { hangs: true, depth: 0, rodId: 'a' })
  // A piece in the same cell that is not its opposite number leaves it alone too.
  assert.equal(tvPairSlot('a', [a, tv(2, 3, 0, 1, 'c')]).depth, 0)
  // And a cell with nothing on it is not a pair.
  assert.equal(tvPairSlot('gone', [a]).hangs, true)
})

test('a 电视 is created with the hover rotation, and a pair needs no new field', () => {
  // The pair is a property of two placed pieces, not of the catalogue: nothing about
  // the module changes, so an old save loads and a lone piece is untouched.
  const mod = createModule('tv', 1, 2, 3, 'tv-1', 1)
  assert.equal(mod?.type, 'tv')
  assert.equal(mod?.rot, 1)
  assert.equal('cfg' in mod && Object.keys(mod.cfg).length, 0)
  assert.deepEqual(moduleEnvelope(tv(1, 2, 3, 1)), { x0: 1, y0: 2, z0: 4, x1: 2, y1: 3, z1: 7 })
})

/* ---------------------------------------------------------- the merged draw */

function stubContext() {
  const store = {}
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (text) => ({ width: String(text ?? '').length * 8 })
      if (key === 'canvas') return stubCanvas()
      return () => undefined
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}
const stubCanvas = () => ({ width: 0, height: 0, getContext: () => stubContext() })
globalThis.document = { createElement: () => stubCanvas() }

const THREE = await import('three')
const { buildModule, createModelMaterials } = await import('../src/render/models.ts')
const { TV_POSTER_RECT } = await import('../src/render/stationDisplay.ts')

/** The `ctx.ads` surface `buildTv` uses, cut down to a lit pane. */
const adsStub = {
  adFace: (slug, w, h) => ({
    material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    geometry: new THREE.PlaneGeometry(w, h),
    slug,
  }),
  adWindow: (w, h) => adsStub.adFace('metro-security', w, h),
  load: async () => {},
  dispose: () => {},
}

const LINE = {
  id: '5',
  name: '5号线',
  colour: '#c8102e',
  stock: 'B',
  cars: 6,
  power: 'third-rail',
  headwayProfile: { peak: 4, offpeak: 7, late: 10 },
  alightPerTrain: 40,
  terminus: 'reverse',
  direction: 'up',
  upTerminus: '黄埔新港',
  downTerminus: '滘口',
  travelSign: 1,
  stations: [],
}

/**
 * Build every module of `modules` the way the scene does — one shared context whose
 * `tvPairSlot` reads the whole document — so the pair under test is resolved by the
 * real rule rather than by hand-written slot values.
 *
 * Each mesh is measured in **cell coordinates**: its world position and orientation,
 * reported relative to the centre of the cell the module stands in. That is the one
 * frame in which the two members of a pair can be compared — each is turned 180°
 * from the other by `placeLocal`, so its own local frame points the opposite way,
 * and world coordinates are off by the module's cell on top.
 */
function buildStation(modules) {
  const data = { name: '动物园', seed: 1, cells: [], modules, lines: [LINE] }
  const ctx = {
    mats: createModelMaterials(),
    ads: adsStub,
    data,
    trackCells: new Set(),
    finish: () => new THREE.MeshBasicMaterial(),
    tvPlate: () => new THREE.CanvasTexture(stubCanvas()),
    tvPairSlot: (id) => tvPairSlot(id, data.modules),
  }
  return modules.map((mod) => {
    const group = buildModule(mod, ctx)
    group.updateMatrixWorld(true)
    const meshes = []
    group.traverse((o) => {
      if (!o.isMesh) return
      const world = new THREE.Vector3()
      o.getWorldPosition(world)
      const q = new THREE.Quaternion()
      o.getWorldQuaternion(q)
      // Cell-local: the module's own cell spans [x, x+1) × [y, y+1), so its centre
      // is (x + 0.5, y + 0.5) and the mesh's offset from it is what a viewer sees.
      const centre = new THREE.Vector3(world.x - (mod.x + 0.5), world.y - (mod.y + 0.5), world.z - (mod.z + 1))
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
      const size = new THREE.Vector3()
      new THREE.Box3().setFromObject(o).getSize(size)
      meshes.push({
        mesh: o,
        centre,
        normal,
        size,
        lit: o.userData.adPoster !== undefined || o.userData.adStationPlate !== undefined,
        board: o.userData.adStationPlate !== undefined,
      })
    })
    return { mod, group, meshes }
  })
}

const SW = 1.42
const SH = 0.8
const LIT_STAND_OFF = 0.015
/** One 电视's panel, either side of its own origin: the drawn half-body. */
const SOLO_HALF = TV_HALF
/** Back to back, the pair is exactly two of those — two thin televisions. */
const PAIR_HALF = 2 * SOLO_HALF

const pairModules = () => [
  { id: 'tv-1', type: 'tv', x: 0, y: 0, z: 0, rot: 0, cfg: { poster: 'metro-security' } },
  { id: 'tv-2', type: 'tv', x: 0, y: 0, z: 0, rot: 2, cfg: { poster: 'metro-security' } },
]

/**
 * The parts of the model, told apart by what they measure. The figures are the probe
 * these assertions were written from:
 *
 *  - the **suspension** is two 0.05 × 0.05 m rods and the two 0.16 m ceiling plates
 *    beside them — narrow across, and the rods taller than the plates;
 *  - the **bezel posts** are the two 0.07 × 0.8 m uprights, and their depth *is* the
 *    module's body: 1.00 m on a pair, 0.10 m on a lone 电视. That is the measurement
 *    that says whether the two housings merged;
 *  - a **backing** is a screen-tall, screen-wide black slab (x > 0.17): 0.98 m deep on
 *    a pair, 0.04 m on a lone 电视, because it spans the module's inner opening in
 *    its own half of the body.
 */
const isRod = (m) => !m.lit && m.size.x <= 0.06 && m.size.z >= 0.3
const isPlate = (m) => !m.lit && m.size.x > 0.15 && m.size.x <= 0.17 && m.size.z < 0.3
const isPost = (m) => !m.lit && m.size.x > 0.06 && m.size.x <= 0.17 && m.size.z >= 0.8
const isBacking = (m) => !m.lit && m.size.x > 0.17 && m.size.z >= 0.8
const bodyDepth = (built) => Math.max(...built.meshes.filter(isPost).map((m) => m.size.y))

test('the pair hangs from one set of rods, and only one of the two draws them', () => {
  const [a, b] = buildStation(pairModules())
  // Two rods and their two ceiling plates, once for the object.
  assert.equal(a.meshes.filter(isRod).length, 2, 'the hanging element carries the two rods')
  assert.equal(a.meshes.filter(isPlate).length, 2, 'and their two ceiling plates')
  assert.equal(b.meshes.filter((m) => isRod(m) || isPlate(m)).length, 0, 'the paired element draws no suspension')
  // The bezel is one frame around the one housing, not two: two bars and two posts.
  assert.equal(a.meshes.filter(isPost).length, 2, 'the housing has its two posts once')
  assert.equal(a.meshes.filter((m) => !m.lit && m.size.x > 1.5).length, 2, 'and its two bars once')
  assert.equal(b.meshes.filter((m) => isPost(m) || (!m.lit && m.size.x > 1.5)).length, 0, 'the paired element draws no casing')
  // The paired element brings only its own screens: one backing per pane, and no
  // second screen's worth of backing inside the shared body.
  for (const built of [a, b]) {
    assert.equal(built.meshes.filter(isBacking).length, 2, 'each 电视 has one backing per pane')
  }
})

test('each element of the pair lights its own face, and only its own', () => {
  const [a, b] = buildStation(pairModules())
  // With rot 0 in the first cell, the pair is the −y screen and the +y one. A normal
  // is read in **world** space — the direction the light actually leaves in — and the
  // two members' own frames are turned 180° from each other, so their local normals
  // are not comparable to each other.
  const facing = (built) => built.meshes.find((m) => m.board).normal.y
  assert.equal(facing(a), -1)
  assert.equal(facing(b), 1)
  for (const built of [a, b]) {
    const lit = built.meshes.filter((m) => m.lit)
    assert.equal(lit.length, 2, 'each 电视 prints a board and a window')
    assert.equal(lit.filter((m) => m.board).length, 1)
    // Both of this element's panes ride the same face — one 电视 is legible from one
    // side — and that face is a plain ±y, because a pair is always 180° apart.
    const ys = lit.map((m) => m.normal.y)
    assert.equal(Math.sign(ys[0]), Math.sign(ys[1]))
    assert.ok(Math.abs(ys[0]) > 0.99, `a pane is not facing along ±y: ${ys}`)
    assert.ok(Math.abs(lit[0].normal.x) < 1e-9, 'a pane is turned across the screen')
    // And its panes really are on the side it looks out of, not merely at that depth.
    for (const m of lit) assert.ok(m.centre.y * Math.sign(facing(built)) > 0, `a pane at y ${m.centre.y} looks the other way`)
  }
  // The two elements look the opposite way, so the pair is readable from both sides
  // and each panel is hidden from the other.
  assert.equal(facing(a) + facing(b), 0)
  const yOf = (built) => built.meshes.filter((m) => m.lit).map((m) => m.centre.y)
  for (const y of yOf(a)) assert.ok(y < 0, `a −y element prints at ${y}`)
  for (const y of yOf(b)) assert.ok(y > 0, `a +y element prints at ${y}`)
  // Mirrored about the middle of the cell, so the pair is symmetric: the +y element's
  // board is at +0.515 where the −y one's is at −0.515.
  const ya = yOf(a).sort((p, q) => p - q)
  const yb = yOf(b).sort((p, q) => p - q)
  for (let i = 0; i < ya.length; i++) assert.ok(Math.abs(ya[i] + yb[i]) < 1e-9, `${ya[i]} + ${yb[i]} is not 0`)
})

test('no lit pane is buried in the housing, or in the other screen', () => {
  const [a, b] = buildStation(pairModules())
  const lit = [...a.meshes, ...b.meshes].filter((m) => m.lit)
  assert.equal(lit.length, 4, 'the pair is two screens, each with a board and a window')
  // The backing each pane mounts on stops short of the seam, and the pane stands
  // `LIT_STAND_OFF` proud of it on the far side — the same relationship the 广告牌
  // uses, and the one whose absence renders a window as a plain black rectangle.
  for (const m of lit) {
    assert.ok(
      Math.abs(m.centre.y) >= PAIR_HALF + LIT_STAND_OFF - 1e-9,
      `a lit pane at y ${m.centre.y.toFixed(4)} is not proud of the shared housing (${PAIR_HALF})`,
    )
  }
  // Nothing the other element draws reaches across the seam to a lit pane's own side
  // of the cell. That is the whole point of the merge: with two solo housings each in
  // the cell, the opposite backing reaches within 0.006 m of the pane and swallows it.
  for (const own of [a, b]) {
    const other = own === a ? b : a
    for (const pane of own.meshes.filter((m) => m.lit)) {
      const ownSide = Math.sign(pane.centre.y)
      for (const part of other.meshes) {
        assert.ok(
          Math.sign(part.centre.y) !== ownSide || Math.abs(part.centre.y) < Math.abs(pane.centre.y) + 1e-9,
          `the opposite element's part at y ${part.centre.y.toFixed(4)} reaches a lit pane's side at ${pane.centre.y.toFixed(4)}`,
        )
      }
    }
  }
})

test('the pair is one housing, and two solo models are what it replaces', () => {
  const [a, b] = buildStation(pairModules())
  const merged = a.meshes.length + b.meshes.length
  // What the same two pieces draw with no pair rule: each its own slim casing, its
  // own rods and its own bezel. They have to stand in **different** cells to be two
  // lone 电视 — the same cell is exactly what makes them a pair.
  const [soloA, soloB] = buildStation([
    { id: 'solo-a', type: 'tv', x: 0, y: 0, z: 0, rot: 0, cfg: { poster: 'metro-security' } },
    { id: 'solo-b', type: 'tv', x: 4, y: 0, z: 0, rot: 2, cfg: { poster: 'metro-security' } },
  ])
  const unmerged = soloA.meshes.length + soloB.meshes.length
  assert.ok(merged < unmerged, `the pair draws ${merged} meshes, two lone 电视 draw ${unmerged}`)
  // And the housings really did merge into one slim body — **two thin panels**, not a
  // box as deep as the cell. The bezel posts span the body, so their depth is the
  // body's. The cap is the point of the number: the first cut of this feature made the
  // housing a full 1 m cell deep, which reads as a chunk of concrete hung from the
  // ceiling rather than as two televisions stood back to back.
  assert.ok(Math.abs(bodyDepth(a) - 2 * PAIR_HALF) < 1e-5, `the pair's body is ${bodyDepth(a)} m deep`)
  assert.ok(Math.abs(bodyDepth(soloA) - 2 * SOLO_HALF) < 1e-5, `a lone 电视's body is ${bodyDepth(soloA)} m deep`)
  assert.ok(
    Math.abs(bodyDepth(a) - 2 * bodyDepth(soloA)) < 1e-5,
    `the pair (${bodyDepth(a)}) is not two thin 电视 (${bodyDepth(soloA)} each)`,
  )
  assert.ok(bodyDepth(a) <= 4 * SOLO_HALF + 1e-5, `the pair is ${bodyDepth(a)} m thick — that is chunky, not two thin panels`)
  // The screens still tile the opening exactly — the merge must not have moved the
  // board or resized the window, or the artwork loses its half of the panel.
  for (const built of [a, b]) {
    const board = built.meshes.find((m) => m.board)
    const win = built.meshes.find((m) => m.lit && !m.board)
    assert.ok(Math.abs(board.size.x + win.size.x - SW) < 0.005, 'the board and window no longer cover the screen')
    assert.ok(Math.abs(win.size.x - SW * TV_POSTER_RECT.w) < 0.005, 'the window is not the region the board leaves')
    assert.ok(Math.abs(win.size.z - SH) < 0.005, 'the window does not reach the screen edges')
    assert.ok(Math.abs(board.size.z - SH) < 0.005, 'the board does not reach the screen edges')
  }
})

test('a screen has a back: no lit pane is double-sided', () => {
  // The content window's material comes from `ctx.ads.adFace`, and the poster is a
  // **plane**: a double-sided one prints the artwork out of the back of the piece as
  // well as the front. That is what makes a 电视 read as showing content from behind,
  // and it is the one cue R has for which way the piece will face — so this pins the
  // two halves of the contract, because they live in different modules and only the
  // pair of them together is correct:
  //
  //   * `render/adArt.ts` must mint its poster materials `FrontSide` (the real defect:
  //     it said `DoubleSide`, and a stub in every other test hid it);
  //   * `render/models.ts` must build every lit pane — the board's texture and the
  //     content window — on the model's own `FrontSide`, never forcing `DoubleSide`.
  //
  // The stub below is what production's `ads` hands over, minus the pixels, so a
  // model that let a two-sided pane through would pass every other test in this file.
  const [solo] = buildStation([pairModules()[0]])
  for (const built of [solo, ...buildStation(pairModules())]) {
    for (const pane of built.meshes.filter((m) => m.lit)) {
      assert.notEqual(pane.mesh.material.side, THREE.DoubleSide, 'a lit pane is double-sided, so it prints through its own back')
      assert.equal(pane.mesh.material.side, THREE.FrontSide, 'a lit pane should be front-side only')
    }
  }
})

test('a lone 电视 is drawn exactly as it was, so nothing else moved', () => {
  const [solo] = buildStation([pairModules()[0]])
  const lit = solo.meshes.filter((m) => m.lit)
  assert.equal(lit.length, 2)
  // The slim casing, the two rods and their plates, and one bezel: the model the
  // station has always drawn.
  assert.equal(solo.meshes.length, 13)
  assert.equal(solo.meshes.filter((m) => !m.lit).length, 11)
  // Its panes print on local −y, `LIT_STAND_OFF` clear of the body's outer surface.
  // A lone 电视's body is its slim casing (0.05 m either side of the module origin),
  // so the pane rides at `−(0.05 + LIT_STAND_OFF)` — the relationship that keeps a
  // window from rendering as a flat black rectangle, unchanged by the pair work.
  for (const m of lit) {
    assert.equal(Math.sign(m.centre.y), -1)
    assert.ok(
      Math.abs(m.centre.y - -(SOLO_HALF + LIT_STAND_OFF)) < 1e-6,
      `a pane sits at ${m.centre.y}, not ${-(SOLO_HALF + LIT_STAND_OFF)}`,
    )
  }
  assert.equal(solo.meshes.find((m) => m.board).normal.y, -1)
  assert.equal(solo.meshes.find((m) => m.lit && !m.board).normal.y, -1)
})
