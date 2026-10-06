// 半墙 — the half-block wall a player lays (§4.1, §4.3).
//
// A walled facility room's own walls and the panel a wide stair leaves beside its
// run have always been drawn half a block thick. This is that same wall as a piece
// the 方块 tool can lay anywhere: with **半墙** on (**Tab**) a click drops one such
// block — one at a time, and instead of the 4 m wall ring a patch would otherwise
// grow — keeping half of the tile at the side **R** picks.
//
// It is an ordinary solid wall cell wearing the half it keeps as a tag
// (`half-wall:w`) rather than a module, which is what makes everything else agree
// without a second code path: the column lift, the storey slice, `isWallBlock`, the
// ramp carve and the crowd all read it as a wall, while the mesher draws it half a
// block thick and the 材质 brush paints it face by face — both of its sides.
//
// A ramp's kept blocks are the same kind of cell, derived rather than tagged
// (`thinWallCells`), so a stair's own half wall is painted by the same brush: that
// is what `thinWallSideMap` hands the paint targets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { finishMapOf } from '../src/sim/finishes.ts'
import { HALF_WALL_T } from '../src/sim/constants.ts'
import { carveRampOpenings, rampThinCells, thinWallCells } from '../src/sim/openings.ts'
import { wallMountMissing } from '../src/sim/placement.ts'
import { halfWallInnerFace, halfWallSide, halfWallTag, isWallBlock, packKey } from '../src/sim/types.ts'
import {
  addWalls,
  createModule,
  facePresent,
  fillSurface,
  halfWallRunSide,
  halfWallSideDirs,
  paintFaces,
  thinWallSideMap,
  toState,
  WALL,
  wallColumnAt,
} from '../src/build/model.ts'
import { placementPreviewKey, useStore } from '../src/app/store.ts'
import { createToolSlice } from '../src/app/store/slices/ToolSlice.ts'

function empty() {
  return toState({ name: 't', seed: 1, cells: [], modules: [], lines: [] })
}

const floor = (x, y, z = 0) => ({ x, y, z, fill: 'solid' })

/** The cell at a coordinate, or undefined. */
const at = (state, x, y, z) => state.cells.find((c) => c.x === x && c.y === y && c.z === z)

/* ------------------------------------------------------- the piece itself */

test('a 半墙 is a wall that remembers which half of its cell it keeps', () => {
  const st = addWalls(empty(), [[2, 2, 0]], 'w', 1).state
  // One course per click, wall-tagged and carrying the side.
  const courses = st.cells.filter((c) => c.tags?.includes(halfWallTag('w')))
  assert.equal(courses.length, 1, 'a 半墙 click lays one block, stacked by hand')
  for (const c of courses) {
    assert.ok(c.tags.includes(WALL), 'it is still a 墙-tool wall')
    assert.equal(halfWallSide(c), 'w')
    assert.ok(isWallBlock(c), 'a 半墙 is a wall to the sim')
  }
  // The face looking into its own cell's clear half is the opposite side.
  assert.equal(halfWallInnerFace('w'), 'e')
  assert.equal(halfWallInnerFace('n'), 's')

  // A plain block, and a wall of the full thickness, are neither.
  assert.equal(halfWallSide({}), null)
  assert.equal(halfWallSide(floor(0, 0)), null)
  assert.equal(halfWallSide({ tags: [WALL] }), null)
  assert.equal(isWallBlock(floor(0, 0)), false)
  // A tag with a side no tool writes is still a wall (a load never drops one), it
  // simply has no side to draw: the mesher falls back to the full block.
  assert.equal(halfWallSide({ tags: ['half-wall:q'] }), null)
  assert.equal(isWallBlock({ tags: ['half-wall:q'] }), true)
})

test('the 墙 tool lifts a 半墙 column in bulk, like any other wall', () => {
  // Singles stacked by hand read as one column to the lift: whichever course the
  // pointer lands on, the whole tagged column comes back.
  let st = empty()
  for (let z = 0; z < 4; z++) st = addWalls(st, [[2, 2, z]], 's', 1).state
  st = addWalls(st, [[3, 2, 0]], 's', 1).state
  assert.deepEqual(wallColumnAt(st, 2, 2, 2).map((c) => c[2]).sort(), [0, 1, 2, 3])
  assert.deepEqual(wallColumnAt(st, 2, 2, 0).map((c) => c[2]).sort(), [0, 1, 2, 3])
  // One side for the whole stack: the panels line up instead of alternating.
  assert.equal(st.cells.filter((c) => halfWallSide(c) === 's').length, 5)
})

/* --------------------------------------------------- which half R picks */

test('a run offers only the two sides perpendicular to it', () => {
  // A side *along* the run would leave a slot between column and column, so a
  // dragged 半墙 can only keep the north or south half (an east–west run) — and the
  // face its own geometry opens onto comes first, which is why a 半墙 laid along a
  // patch edge hugs the edge with no key pressed.
  const alongX = [[2, 2, 0], [6, 2, 0]]
  assert.deepEqual(halfWallSideDirs(alongX, []), ['n', 's'])
  assert.deepEqual(halfWallSideDirs(alongX, ['s']), ['s', 'n'])
  assert.deepEqual(halfWallSideDirs(alongX, ['e']), ['n', 's'], 'an edge along the run is not a side')
  assert.equal(halfWallRunSide(alongX, ['s'], 0), 's')
  assert.equal(halfWallRunSide(alongX, ['s'], 1), 'n', 'R flips the thickness')
  assert.equal(halfWallRunSide(alongX, ['s'], 2), 's', 'the cycle wraps')
  assert.equal(halfWallRunSide(alongX, ['s'], 7), 'n')

  const alongY = [[2, 2, 0], [2, 6, 0]]
  assert.deepEqual(halfWallSideDirs(alongY, ['e']), ['e', 'w'])
  assert.deepEqual(halfWallSideDirs(alongY, []), ['e', 'w'])
})

test('a single column offers all four sides, the geometry’s own face first', () => {
  // A partition standing in open floor has no edge to read and no run to be
  // perpendicular to, so the half it keeps is the player's: R steps all four, and
  // the geometry's own candidates lead so the first click is never a surprise.
  const one = [[2, 2, 0]]
  assert.deepEqual(halfWallSideDirs(one, ['w']), ['w', 'n', 'e', 's'])
  assert.deepEqual(halfWallSideDirs(one, ['n', 'w']), ['n', 'w', 'e', 's'])
  assert.deepEqual(halfWallSideDirs(one, []), ['n', 'e', 's', 'w'])
  assert.equal(halfWallRunSide(one, ['w'], 0), 'w')
  assert.equal(halfWallRunSide(one, ['w'], 3), 's')
  assert.equal(halfWallRunSide(one, ['w'], 4), 'w')
})

test('the 方块 tool carries the mode, and it excludes the auto-wall ring', () => {
  // The rail's cut tile and **Tab** both come through here, so this is the click. The
  // cut modes and the generated ring answer the same question — what the patch grows
  // — so 半墙 holds 自动生成墙壁 off, that toggle is refused while it is on, and
  // leaving the mode leaves the ring where the default put it (**off**, since the
  // ring is the one thing the tool does that the player did not draw). The wall-face
  // cycle is reset with the mode, since the cycle means something different in each.
  useStore.setState({ tool: 'block', halfWall: false, autoWalls: false, wallSnapCycle: 0 })
  const st = () => useStore.getState()
  st().toggleHalfWall()
  assert.equal(st().halfWall, true)
  assert.equal(st().autoWalls, false, '半墙 must hold the generated ring off')
  st().setAutoWalls(true)
  assert.equal(st().autoWalls, false, 'the ring is refused while 半墙 owns the tool')
  st().rotateWallSnap()
  st().rotateWallSnap()
  assert.equal(st().wallSnapCycle, 2)
  st().setHalfWall(false)
  assert.equal(st().halfWall, false)
  assert.equal(st().autoWalls, false, 'and the ring is not switched on behind the player’s back')
  assert.equal(st().wallSnapCycle, 0, 'flipping the mode keeps the cycle it belongs to')

  // The ring's own tile still turns it on, now that it has no key and no default.
  st().setAutoWalls(true)
  assert.equal(st().autoWalls, true, 'the 自动生成墙壁 tile is how the ring is asked for')

  // Both the mode and the side R stepped to change what the hover ghost is, so
  // both have to be in the one key the viewport subscribes to — otherwise the tile
  // and R leave a ghost under the pointer showing the wall the player turned away
  // from (`SceneRenderer.setGhost`'s own key carries the sides for the same reason).
  const key = placementPreviewKey({ ...st(), halfWall: true, wallSnapCycle: 3 })
  assert.match(key, /true/)
  assert.match(key, /3$/)
  assert.notEqual(key, placementPreviewKey({ ...st(), halfWall: true, wallSnapCycle: 4 }))
  assert.notEqual(key, placementPreviewKey({ ...st(), halfWall: false, wallSnapCycle: 3 }))
  useStore.setState({ tool: 'select', halfWall: false, autoWalls: false, wallSnapCycle: 0 })
})

test('自动生成墙壁 is off when the game opens', () => {
  // The 方块 tool's default is bare floor: a dragged patch grows the surface the
  // player drew and nothing else, and the 4 m ring is asked for on its own tile.
  // Read from the slice's own factory — the store's initial `autoWalls` — rather than
  // from a `setState`, so a change to the default cannot pass unnoticed.
  const slice = createToolSlice(
    () => {},
    () => ({}),
    {},
  )
  assert.equal(slice.autoWalls, false, 'a fresh slice opens with the ring off')
  assert.equal(slice.halfWall, false)
  assert.equal(slice.triangles, false)
  // And the ring's own tile is the only way to it now: no key sets it.
  useStore.setState({ tool: 'block', autoWalls: false, halfWall: false, triangles: false })
  useStore.getState().setAutoWalls(true)
  assert.equal(useStore.getState().autoWalls, true)
  useStore.setState({ tool: 'select', autoWalls: false, halfWall: false, triangles: false })
})

/* --------------------------------------------------------- how it draws */

/** Mesh one cell as a 半墙, and measure the panel it drew. */
function panel(side, cells = [{ x: 1, y: 1, z: 0, fill: 'solid' }], finishes = new Map(), thins = [[1, 1, 0]]) {
  const solid = buildSolidSet(cells)
  const thin = new Map(thins.map(([x, y, z]) => [packKey(x, y, z), side === null ? null : { kind: 'half', side }]).filter(([, v]) => v !== null))
  const chunk = meshChunk(solid, finishes, 0, 0, 0, 0, undefined, undefined, undefined, thin)
  const pos = chunk.parts.flatMap((p) => Array.from(p.positions))
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i++) {
    const axis = i % 3
    lo[axis] = Math.min(lo[axis], pos[i])
    hi[axis] = Math.max(hi[axis], pos[i])
  }
  return { chunk, lo, hi }
}

const near = (a, b) => Math.abs(a - b) < 1e-6

test('the mesher draws a 半墙 half a block thick, in the half its side names', () => {
  // Every side keeps its own half of the tile: the panel is always HALF_WALL_T
  // through, and always the full cell along the wall and the full storey up.
  const boxes = {
    n: [1, 1 + HALF_WALL_T, 2, 2],
    s: [1, 1, 2, 1 + HALF_WALL_T],
    e: [1 + HALF_WALL_T, 1, 2, 2],
    w: [1, 1, 1 + HALF_WALL_T, 2],
  }
  for (const [side, [x0, y0, x1, y1]] of Object.entries(boxes)) {
    const m = panel(side)
    assert.ok(m.chunk.triangles > 0, `${side}: nothing was drawn`)
    assert.ok(
      near(m.lo[0], x0) && near(m.lo[1], y0) && near(m.hi[0], x1) && near(m.hi[1], y1),
      `${side}: panel spans ${m.lo.slice(0, 2)}..${m.hi.slice(0, 2)}, expected ${[x0, y0]}..${[x1, y1]}`,
    )
    assert.ok(near(m.lo[2], 0) && near(m.hi[2], 1), `${side}: the panel should be a full storey tall`)
  }
  // The same cell without the side is a whole block: the thickness is the piece.
  const full = panel(null, undefined, undefined, [])
  assert.ok(near(full.lo[0], 1) && near(full.hi[0], 2), 'a full wall still fills its cell')
})

test('two columns of one run join, and the panel keeps its own faces', () => {
  // The columns of a run are flush, so their ends meet with nothing between them:
  // the run is one wall, not a row of separate panels.
  const cells = [floor(1, 1), floor(1, 2)]
  const run = panel('w', cells, new Map(), [[1, 1, 0], [1, 2, 0]])
  assert.ok(near(run.lo[0], 1) && near(run.hi[0], 1 + HALF_WALL_T), 'the panel is one thickness')
  assert.ok(near(run.lo[1], 1) && near(run.hi[1], 3), `two columns should run the whole way, got ${run.lo[1]}..${run.hi[1]}`)
})

test('a painted face of a 半墙 colours the surface it names, not the whole panel', () => {
  // A 半墙 is painted face by face like any other wall — that is what makes it a
  // wall rather than a decal. The inner face (`e` for a panel keeping the west
  // half) is where the 材质 brush lands it.
  const cells = [{ x: 1, y: 1, z: 0, fill: 'solid', tags: [WALL, halfWallTag('w')] }]
  const painted = paintFaces(toState({ name: 't', seed: 1, cells, modules: [], lines: [] }), [[1, 1, 0]], 'e', 'wall.enamel')
  const m = panel('w', painted.cells, finishMapOf(painted.cells))
  const enamel = m.chunk.parts.find((p) => p.finish === 'wall.enamel')
  assert.ok(enamel, 'the painted face should be its own part')
  assert.ok(m.chunk.parts.some((p) => p.finish === 'wall.plaster'), 'the other faces keep the stock wall finish')
  let sum = 0
  for (let i = 0; i < enamel.positions.length; i += 3) sum += enamel.positions[i]
  const mean = sum / (enamel.positions.length / 3)
  assert.ok(Math.abs(mean - (1 + HALF_WALL_T)) < 0.05, `the enamel should sit on the inner face at ${1 + HALF_WALL_T}, mean x was ${mean}`)
})

/* ------------------------------------------------------- the paint brush */

test('the brush may paint a 半墙’s inner face, even with a solid block behind it', () => {
  // The panel is half a block thick, so that surface looks across the wall's own
  // clear half: a solid block in the next cell does not cover it, and the boundary
  // test alone would refuse to paint a face the player can see.
  const cells = []
  for (const y of [1, 2]) {
    cells.push({ x: 1, y, z: 0, fill: 'solid', tags: [WALL, halfWallTag('w')] })
    cells.push({ x: 2, y, z: 0, fill: 'solid' })
  }
  const base = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  const solid = new Set(base.cells.map((c) => `${c.x},${c.y},${c.z}`))
  const thin = thinWallSideMap(base.cells)
  assert.deepEqual(thin.get('1,1,0'), { kind: 'half', side: 'w' })
  assert.ok(facePresent(solid, thin, 1, 1, 0, 'e'), 'the inner face is a surface to paint')
  // The same geometry without the panel really does block that face: this is the
  // exception, not a hole in the rule.
  assert.equal(facePresent(solid, new Map(), 1, 1, 0, 'e'), false)

  // 整面 (M) from one column of the run paints the whole run — the surface a player
  // sees — and stops where the wall does.
  const filled = fillSurface(base, 1, 1, 0, 'e', 'wall.enamel')
  assert.deepEqual(
    filled.cells.filter((c) => c.finish?.e === 'wall.enamel').map((c) => [c.x, c.y]).sort(),
    [[1, 1], [1, 2]],
  )
  // The block behind the panel is not part of the wall and is not painted.
  assert.equal(filled.cells.find((c) => c.x === 2 && c.y === 1).finish, undefined)
})

/* ----------------------------------------------------------- the sim sees it */

test('a ramp keeps a 半墙 instead of carving it, and never thins it twice', () => {
  // A 1.6 m stair is wider than a cell, so its body and handrail genuinely cross
  // into the column beside it. An ordinary wall there is kept and drawn half a block
  // thick; a 半墙 is already one, standing on the side the player chose, so the ramp
  // leaves it alone rather than re-deriving its side.
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      cells.push(x === 2 ? { x, y, z: 0, fill: 'solid', tags: [WALL, halfWallTag('w')] } : floor(x, y))
    }
  }
  const stair = createModule('stair-straight', 1, 4, -2, 's', 2, 1.6)
  assert.ok(stair)
  carveRampOpenings(cells, [stair])
  assert.ok(at({ cells }, 2, 2, 0), 'the 半墙 beside the run survives the carve')
  assert.ok(!rampThinCells(cells, [stair]).some((t) => t.x === 2), 'a 半墙 is not thinned a second time')
  // The tag is the whole difference: the same wall without it is thinned, as the
  // openings suite pins — and its half is the one away from the run.
  const plain = cells.map((c) => (c.x === 2 ? { ...c, tags: [WALL] } : c))
  const marked = rampThinCells(plain, [stair]).find((t) => t.x === 2)
  assert.ok(marked, 'an ordinary wall in that column is thinned')
  assert.equal(marked.side, 'e')
})

test('a half wall a stair left behind is a surface the 材质 brush can colour', () => {
  // The report this fixes: the panel a ramp keeps beside its run is derived, not
  // tagged, so the brush did not know the cell was half a block thick — and its
  // inner face (the surface a player sees from the run) read as blocked by the solid
  // block behind it. `thinWallCells` is the one list that carries both, and
  // `thinWallSideMap` is what the paint targets are built from.
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) cells.push({ x, y, z: 0, fill: 'solid', tags: [WALL] })
  }
  const stair = createModule('stair-straight', 1, 4, -2, 's', 2, 1.6)
  assert.ok(stair)
  carveRampOpenings(cells, [stair])
  const state = toState({ name: 't', seed: 1, cells, modules: [stair], lines: [] })

  const thin = thinWallSideMap(state.cells, state.modules)
  const side = rampThinCells(state.cells, state.modules).find((t) => t.x === 2 && t.y === 2 && t.z === 0)
  assert.ok(side, 'the stair thinned the wall beside its run')
  assert.deepEqual(thin.get('2,2,0'), { kind: 'half', side: side.side }, 'the derived half wall is in the thin map')

  // Its inner face — the one facing the run — is offered to the brush even though
  // the block on the far side of it is solid.
  const solid = new Set(state.cells.map((c) => `${c.x},${c.y},${c.z}`))
  const inner = halfWallInnerFace(side.side)
  assert.ok(facePresent(solid, thin, 2, 2, 0, inner), 'the run-facing face is paint')
  assert.equal(facePresent(solid, new Map(), 2, 2, 0, inner), false, 'the exception is the thickness, not the rule')

  // So 单块 paints it, and the mesher draws the painted panel on that face.
  const painted = paintFaces(state, [[2, 2, 0]], inner, 'wall.enamel')
  const chunk = meshChunk(
    buildSolidSet(painted.cells),
    finishMapOf(painted.cells),
    0,
    0,
    0,
    0,
    undefined,
    undefined,
    undefined,
    new Map([[packKey(2, 2, 0), { kind: 'half', side: side.side }]]),
  )
  assert.ok(
    chunk.parts.some((p) => p.finish === 'wall.enamel'),
    'the enamel panel should be drawn on the stair’s own half wall',
  )

  // And the whole list a renderer works from carries both sources in one place.
  const listed = thinWallCells(state.cells, state.modules)
  assert.ok(listed.some((t) => t.x === 2 && t.y === 2 && t.z === 0 && t.shape.kind === 'half' && t.shape.side === side.side))
  const tagged = thinWallCells(
    toState({ name: 't', seed: 1, cells: [floor(5, 5), { x: 5, y: 5, z: 1, fill: 'solid', tags: [WALL, halfWallTag('n')] }], modules: [], lines: [] }).cells,
    [],
  )
  assert.deepEqual(tagged, [{ x: 5, y: 5, z: 1, shape: { kind: 'half', side: 'n' } }])
})

test('a 广告牌 bolts only to the half of a 半墙 that faces it', () => {
  // A panel's back plane meets its wall at the shared cell boundary, so a backing
  // 半墙 has to keep the half that reaches that plane. A full wall fills its cell
  // and backs either side; a 半墙 that turned its face away leaves the panel
  // hanging half a block off it — a refusal, not a float. The wall is the ad's
  // facing neighbour's first course (`z + 1`), exactly as `placement.test.mjs`
  // pins for a full wall.
  const ground = floor(0, 0, 0)
  const ad = { id: 'bb', type: 'billboard', x: 0, y: 0, z: 0, rot: 1, w: 1, cfg: { variant: 'wide' } }
  const wall = (side) => ({ x: 1, y: 0, z: 1, fill: 'solid', tags: [WALL, halfWallTag(side)] })
  assert.equal(wallMountMissing([ground, wall('w')], ad), false, 'the half that faces the panel backs it')
  assert.equal(wallMountMissing([ground, wall('e')], ad), true, 'the far half is not a backing')
  assert.equal(wallMountMissing([ground, wall('n')], ad), true, 'nor is a half beside the panel')
  assert.equal(wallMountMissing([ground, { ...wall('e'), tags: [WALL] }], ad), false, 'a full wall backs it either way')
  // Every cell of a run needs its own backing, on the right half of each.
  const run = { id: 'bb', type: 'billboard', x: 0, y: 0, z: 0, rot: 1, w: 2, cfg: { variant: 'large' } }
  const pair = (a, b) => [ground, { ...wall(a), y: 0 }, { ...wall(b), y: 1 }]
  assert.equal(wallMountMissing(pair('w', 'w'), run), false)
  assert.equal(wallMountMissing(pair('w', 'e'), run), true, 'the far end of the run would hang off the wall')
})
