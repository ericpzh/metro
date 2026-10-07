// The 方块 tool's controllers, driven through their own press/release path.
//
// `halfwall.test.mjs` pins the 半墙 as a *piece* — the cell, its tag, the panel
// the mesher draws from it. This file pins the *click*: that the block the 方块
// tool's **半墙** mode commits on release is the same tagged course its ghost
// previewed. The two had drifted apart — the ghost drew a half-block panel
// (`thinGhost`), while the release went through the plain-block path
// (`addCells`), so the block that landed was a full one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { HALF_WALL_T } from '../src/sim/constants.ts'
import { rampThinCells, thinWallCells } from '../src/sim/openings.ts'
import { halfWallInnerFace, halfWallSide, halfWallTag, packKey } from '../src/sim/types.ts'
import { addEquipment, addWalls, AUTO_FLOOR, createModule, syncAutoWalls, toState } from '../src/build/model.ts'
import { withGround } from '../src/sim/ground.ts'
import { placementPreviewKey, useStore } from '../src/app/store.ts'
import { BlockTool } from '../src/app/tools/BlockTool.ts'

/**
 * A ToolContext with the scene stubbed out to a recorder. The controllers read
 * only `scene()` and `solids()`, and commit through the store.
 */
function ctxFor({ street = false } = {}) {
  const ghosts = []
  const scene = {
    setGhost: (cells, mode, module, thin) => ghosts.push({ cells, mode, thin }),
    setCursor: () => {},
    setModulePreview: () => {},
    setFencePreview: () => {},
    setCollisionHighlight: () => {},
  }
  const ref = (v = null) => ({ current: v })
  return {
    ghosts,
    tool: new BlockTool({
      scene: () => scene,
      pick: () => null,
      pickModule: () => null,
      facing: () => undefined,
      // The live solid set the app hands the tools: `withGround` is what
      // `app/Viewport.tsx` builds it from, because the plane at z = 0 is stored
      // inverted (`sim/ground.ts`) and a raw scan of `station.cells` hides it.
      solids: () => {
        const st = useStore.getState().station
        const cells = street ? withGround(st.cells, st.modules) : st.cells
        return new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
      },
      thins: () => new Map(),
      hover: ref(),
      drag: ref(),
      paint: ref(),
      zoneDrag: ref(),
      facilityDrag: ref(),
      showMeasure: () => {},
      clearMeasure: () => {},
    }),
  }
}

/** One pointer event; the pick is the cell the pointer is over. */
function press(cell, solid, button = 0) {
  return {
    clientX: 0,
    clientY: 0,
    button,
    buttons: button === 2 ? 2 : 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid, point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

/** A floor patch, and the store left holding it with 半墙 on. */
function station() {
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  useStore.setState({
    tool: 'block',
    halfWall: true,
    autoWalls: false,
    wallSnapCycle: 0,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }),
  })
}

/**
 * The extent of one lone cell **through** a side: 1 m for a full block, the
 * panel's own `HALF_WALL_T` for a 半墙 — measured on the axis the side squashes.
 * Meshed at the chunk origin with the cell list handed in: `meshChunk` walks the
 * whole 16³ box unless it is told which cells this chunk holds.
 */
function thickness(side) {
  const cell = { x: 0, y: 0, z: 0, fill: 'solid' }
  const thin = side === null ? new Map() : new Map([[packKey(0, 0, 0), { kind: 'half', side }]])
  const chunk = meshChunk(buildSolidSet([cell]), new Map(), 0, 0, 0, undefined, undefined, undefined, [cell], thin)
  const pos = chunk.parts.flatMap((p) => Array.from(p.positions))
  const axis = side === 'e' || side === 'w' ? 0 : 1
  let lo = Infinity
  let hi = -Infinity
  for (let i = axis; i < pos.length; i += 3) {
    lo = Math.min(lo, pos[i])
    hi = Math.max(hi, pos[i])
  }
  return hi - lo
}

test('a 半墙 click lays the tagged course its ghost previewed, not a full block', () => {
  station()
  const { tool, ghosts } = ctxFor()
  // A solid floor under the pointer: the block lands on the cell above it, the
  // same cell the ghost drew.
  tool.onDown(press([1, 1, 0], true))
  tool.onUp(press([1, 1, 0], true))

  const placed = useStore.getState().station.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 1)
  assert.ok(placed, 'the click should lay a course above the floor')
  assert.ok(placed.tags?.includes('wall'), 'the course is a 墙-tool wall')
  // A lone column offers all four sides in the tool's own order (`wallSnap.dirs`),
  // and that order does not move with the pointer — only **R** steps it.
  assert.equal(halfWallSide(placed), 'n')

  // And that tag is what draws it half a block: the same cell meshes a full
  // block without its side.
  const thin = thickness(halfWallSide(placed))
  const full = thickness(null)
  assert.ok(Math.abs(thin - HALF_WALL_T) < 1e-6, `the placed block should mesh ${HALF_WALL_T} thick, was ${thin}`)
  assert.ok(Math.abs(full - 1) < 1e-6, `the same cell without its side is a whole block, was ${full}`)

  // The ghost promised the same piece, so the two cannot disagree. The press
  // draws the panel; the release's own ghost is the empty one.
  const preview = ghosts[0]
  assert.deepEqual(preview.thin?.get(packKey(1, 1, 1)), { kind: 'half', side: halfWallSide(placed) })
})

test('the 半墙 ghost and the block it lays are one piece, whichever half R picks', () => {
  for (let cycle = 0; cycle < 4; cycle++) {
    station()
    useStore.setState({ wallSnapCycle: cycle })
    const { tool, ghosts } = ctxFor()
    tool.onDown(press([1, 1, 0], true))
    tool.onUp(press([1, 1, 0], true))
    const placed = useStore.getState().station.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 1)
    assert.ok(placed, `cycle ${cycle}: nothing was laid`)
    const side = halfWallSide(placed)
    assert.ok(side, `cycle ${cycle}: the course carries no side`)
    assert.deepEqual(ghosts[0].thin?.get(packKey(1, 1, 1)), { kind: 'half', side }, `cycle ${cycle}: the ghost showed another side`)
    // Its inner face is the surface a player sees across the clear half.
    assert.notEqual(halfWallInnerFace(side), side)
  }
})

test('the preview key carries the mode and the side, so a rebuild happens', () => {
  station()
  const st = useStore.getState()
  assert.notEqual(
    placementPreviewKey({ ...st, halfWall: true, wallSnapCycle: 0 }),
    placementPreviewKey({ ...st, halfWall: true, wallSnapCycle: 1 }),
  )
  assert.notEqual(
    placementPreviewKey({ ...st, halfWall: true }),
    placementPreviewKey({ ...st, halfWall: false }),
  )
})

/* ------------------------------------------- a stair beside the panel */

/**
 * A floor patch with one 半墙 course laid by the tool, at `(2, 4, 1)` — the second
 * course of that column, which is the height a stair climbing east out of
 * `(1, 4, 0)` sweeps through. The panel keeps the **west** half, so the run's own
 * side reaches into the half it left clear.
 */
function wallLayedStation() {
  const cells = []
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  useStore.setState({
    tool: 'block',
    halfWall: true,
    autoWalls: false,
    wallSnapCycle: 0,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }),
  })
  // R steps the lone column's own candidates: the fourth face is `w`.
  useStore.setState({ wallSnapCycle: 3 })
  const { tool } = ctxFor()
  tool.onDown(press([2, 4, 0], true))
  tool.onUp(press([2, 4, 0], true))
  return useStore.getState().station
}

const WALL_CELL = [2, 4, 1]

test('a stair beside a 半墙 leaves the player’s half alone instead of re-deriving it', () => {
  // A 1.6 m stair is wider than a cell, so its treads genuinely reach into the
  // column beside the run (0.3 m of it). The cell there is kept rather than
  // carved — and because it is a **半墙** it is not thinned a second time either:
  // the half it keeps and the side it keeps it on are the player's, and the run's
  // own geometry never gets to move it.
  const before = wallLayedStation()
  const course = before.cells.find((c) => c.x === WALL_CELL[0] && c.y === WALL_CELL[1] && c.z === WALL_CELL[2])
  assert.equal(halfWallSide(course), 'w', 'the click laid the west half')
  assert.ok(course.tags.includes(halfWallTag('w')), 'and tagged it')
  const [wx, wy, wz] = WALL_CELL
  const atWall = (cells) => cells.find((c) => c.x === wx && c.y === wy && c.z === wz)

  // The stair runs east out of the cell the panel's west half leaves free.
  const stair = createModule('stair-straight', 1, 4, 0, 's', 2, 1.6)
  assert.ok(stair, 'a 1.6 m stair')
  const after = addEquipment(before, stair)

  const kept = atWall(after.cells)
  assert.ok(kept, 'the 半墙 survives the run being laid beside it')
  assert.equal(halfWallSide(kept), 'w', 'still the half the player chose, not the run’s own derivation')
  assert.deepEqual(kept, course, 'the stair did not rewrite the course at all')

  // The run really does reach the cell: an ordinary wall there is the one the
  // ramp thins, so this is the exception the tag buys and not a case that never
  // came up (the side the ramp would have picked is the far one).
  const plain = after.cells.map((c) => (c.x === wx && c.y === wy && c.z === wz ? { ...c, tags: ['wall'] } : c))
  const derived = rampThinCells(plain, after.modules).find((t) => t.x === wx && t.y === wy && t.z === wz)
  assert.ok(derived, 'the stair reaches that column')
  assert.equal(derived.side, 'e', 'and would have kept the other half — the run’s, not the player’s')
  assert.ok(!rampThinCells(after.cells, after.modules).some((t) => t.x === wx && t.y === wy), 'a 半墙 is never thinned twice')

  // And the mesher draws it half a block thick, on the west half: the panel the
  // player laid, with the run standing beside it.
  const drawn = thinWallCells(after.cells, after.modules).find((t) => t.x === wx && t.y === wy && t.z === wz)
  assert.deepEqual(drawn, { x: wx, y: wy, z: wz, shape: { kind: 'half', side: 'w' } })
  assert.ok(Math.abs(thickness('w') - HALF_WALL_T) < 1e-6)
})

test('an escalator beside a 半墙 does not force its own edge through it', () => {
  // The escalator's step band is 0.34 m, well inside its own cell, so it never
  // reaches the column beside it: the panel stays the panel and the block behind
  // it stays solid, with no carve and no thinning of any kind.
  const before = wallLayedStation()
  const escalator = createModule('escalator', 3, 4, 0, 'e', 0, undefined, 'up')
  assert.ok(escalator)
  const after = addEquipment(before, escalator)

  const kept = after.cells.find((c) => c.x === WALL_CELL[0] && c.y === WALL_CELL[1] && c.z === WALL_CELL[2])
  assert.ok(kept, 'the 半墙 is still there')
  assert.equal(halfWallSide(kept), 'w')
  assert.equal(after.cells.length, before.cells.length, 'the escalator carved nothing')
  assert.deepEqual(rampThinCells(after.cells, after.modules), [], 'and thinned nothing')
})

/* --------------------------------------- laying a wall never digs the floor */

test('a 半墙 click only ever adds: the block it stands on is left alone', () => {
  // A wall stands **on** the floor, so the piece's own success depends on the
  // block below surviving it — that block is the crowd's walking surface and the
  // ground the column is founded on. `addWalls` appends and never filters, so a
  // click is additive: the course above its floor, and the floor untouched.
  station()
  const floorBefore = useStore.getState().station.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 0)
  assert.ok(floorBefore)
  const countBefore = useStore.getState().station.cells.length

  const { tool } = ctxFor()
  // Clicking the floor's top face: the press lands on the block, the course on
  // the cell above it.
  tool.onDown(press([1, 1, 0], true))
  tool.onUp(press([1, 1, 0], true))

  const after = useStore.getState().station
  assert.equal(after.cells.length, countBefore + 1, 'exactly one cell was added')
  assert.deepEqual(after.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 0), floorBefore, 'the floor block is byte-identical')
  assert.equal(after.cells.filter((c) => c.z === 1).length, 1, 'and the course is the only thing above it')
  // A second click stacks a second course: still additive, floor still there.
  tool.onDown(press([1, 1, 1], true))
  tool.onUp(press([1, 1, 1], true))
  const stacked = useStore.getState().station
  assert.equal(stacked.cells.length, countBefore + 2, 'stacking adds one course per click')
  assert.deepEqual(stacked.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 0), floorBefore)
  assert.equal(halfWallSide(stacked.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 1)), 'n')
  assert.equal(halfWallSide(stacked.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 2)), 'n')
})

test('a 半墙 on top of an auto-wall ring keeps that ring course', () => {
  // The generated ring already fills the cell the click aims at, so the honest
  // answer is "nothing to add" — not a course that replaces it. A wall column is
  // one piece whatever raised it, and re-laying it as a 半墙 would silently delete
  // a block the patch's own wall ring put there.
  const cells = []
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) cells.push({ x, y, z: 0, fill: 'solid', tags: [AUTO_FLOOR] })
  const st = syncAutoWalls(toState({ name: 't', seed: 1, cells, modules: [], lines: [] }))
  assert.ok(st.cells.length > cells.length, 'the patch raised its ring')
  const ring = st.cells.find((c) => c.x === 0 && c.y === 0 && c.z === 1)
  assert.ok(ring, 'a ring course stands above the patch corner')

  const before = st.cells.length
  const r = addWalls(st, [[0, 0, 1]], 'e', 1)
  assert.equal(r.changed, 0, 'a course is already there')
  assert.equal(r.blocked, 0)
  assert.equal(r.state.cells.length, before, 'and nothing was added or taken away')
  assert.equal(r.state.cells.find((c) => c.x === 0 && c.y === 0 && c.z === 1), ring, 'the ring course is the same cell object')
  assert.equal(halfWallSide(r.state.cells.find((c) => c.x === 0 && c.y === 0 && c.z === 1)), null, 'and it is still a full wall')
  // The ring rebuild a later floor drag runs leaves both alone as well.
  const synced = syncAutoWalls(r.state)
  assert.equal(synced.cells.length, before)
  assert.ok(synced.cells.some((c) => c.x === 0 && c.y === 0 && c.z === 1))
  assert.ok(synced.cells.some((c) => c.x === 0 && c.y === 0 && c.z === 0), 'the floor under it stays')
})

/* ------------------------------------------- the street the pointer cannot see */

test('a right-press on the pavement digs it, and the hole is recorded', () => {
  // A brand-new station: no cells of its own, so every block under the pointer
  // belongs to the implicit street (`sim/ground.ts`). The 方块 tool's right-press is
  // the dig, and it is the **only** thing that writes a hole: without the record the
  // plane paves the dig straight back over and the gesture does nothing at all.
  useStore.setState({
    tool: 'block',
    halfWall: false,
    autoWalls: false,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells: [], modules: [], lines: [] }),
  })
  const { tool } = ctxFor({ street: true })
  tool.onDown(press([2, 2, 0], true, 2))
  tool.onUp(press([2, 2, 0], true, 2))

  const dug = useStore.getState().station
  assert.deepEqual(dug.cells, [{ x: 2, y: 2, z: 0, fill: 'void' }], 'the dig is one recorded hole')
  // And the plane really is open there now: `withGround` keeps the `void` record as
  // it stands and generates no ground over it, so the cell the crowd used to walk is
  // gone from the effective list.
  assert.equal(
    withGround(dug.cells, dug.modules).some((c) => c.x === 2 && c.y === 2 && c.fill === 'solid'),
    false,
    'the hole survived the read',
  )

  // The same press must not dig a storey that is not the street: absence is already
  // void up there, so a record would be a block-file entry for nothing.
  const { tool: upper } = ctxFor({ street: true })
  upper.onDown(press([3, 3, 4], true, 2))
  upper.onUp(press([3, 3, 4], true, 2))
  assert.deepEqual(useStore.getState().station.cells, dug.cells, 'a dig off grade wrote a record')
})
