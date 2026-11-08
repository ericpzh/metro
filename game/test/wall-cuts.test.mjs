// Cut pieces sharing one cell — a 半墙 with a 薄墙角, several corners, two halves.
//
// The 方块 tool's cut modes used to be one piece per cell: a 半墙 or a 薄墙角 was a
// solid cell wearing a shape tag, and a second click over it was a no-op. A thin
// wall that turns a corner needs both at once, so a cell now holds every cut
// whose **quarters** do not overlap (`wallCutMask`): up to four corners, two half
// walls on opposite sides, or one half wall and the two corners of its clear
// half. The preview and the release share `cutCourseReason`; an overlapping
// piece is refused, a full wall or 三角 is simply already there.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { finishMapOf } from '../src/sim/finishes.ts'
import { clearContactFinishes } from '../src/sim/contactFinishes.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { wallMountMissing } from '../src/sim/placement.ts'
import {
  cutInnerFaces,
  halfCornerMask,
  halfCornerTag,
  halfWallMask,
  halfWallSide,
  halfWallTag,
  packKey,
  shapeOf,
  wallCutMask,
  wallCutPieces,
} from '../src/sim/types.ts'
import {
  addWalls,
  facePresent,
  paintFaces,
  thinWallSideMap,
  toState,
  WALL,
  zoneFloorKeys,
} from '../src/build/model.ts'
import { checkCutCells } from '../src/build/validation.ts'
import { localCellEdit } from '../src/render/localCellEdit.ts'
import { StationGeometry } from '../src/app/stationGeometry.ts'
import { BlockTool } from '../src/app/tools/BlockTool.ts'
import { useStore } from '../src/app/store.ts'

function empty() {
  return toState({ name: 't', seed: 1, cells: [], modules: [], lines: [] })
}

const floor = (x, y, z = 0) => ({ x, y, z, fill: 'solid' })
const at = (state, x, y, z) => state.cells.find((c) => c.x === x && c.y === y && c.z === z)

/* ----------------------------------------------------- the quarters and tags */

test('cut quarters are four bits clockwise from the north-west', () => {
  // A 薄墙角 keeps one quarter, a 半墙 the two of its side. The order is the same
  // clockwise walk the corner sides and the 三角 ridge use.
  assert.equal(halfCornerMask('n'), 1) // NW
  assert.equal(halfCornerMask('e'), 2) // NE
  assert.equal(halfCornerMask('s'), 4) // SE
  assert.equal(halfCornerMask('w'), 8) // SW
  assert.equal(halfWallMask('n'), 3) // NW + NE
  assert.equal(halfWallMask('e'), 6) // NE + SE
  assert.equal(halfWallMask('s'), 12) // SE + SW
  assert.equal(halfWallMask('w'), 9) // SW + NW
})

test('a cell reports every cut tag it carries, and their union', () => {
  const half = { tags: [WALL, halfWallTag('n')] }
  assert.deepEqual(wallCutPieces(half), [{ kind: 'half', side: 'n' }])
  assert.equal(wallCutMask(half), 3)
  assert.deepEqual(shapeOf(half), { kind: 'half', side: 'n' })

  // The piece the user asked for: the north half wall plus the free south-west
  // corner, an L of three quarters.
  const l = { tags: [WALL, halfWallTag('n'), halfCornerTag('w')] }
  assert.deepEqual(wallCutPieces(l), [{ kind: 'half', side: 'n' }, { kind: 'corner', side: 'w' }])
  assert.equal(wallCutMask(l), 11)
  assert.deepEqual(shapeOf(l), { kind: 'cuts', mask: 11 })
  const inner = cutInnerFaces(11)
  assert.deepEqual(inner.sort(), ['e', 's'], 'the L looks into its missing quarter on e and s')

  // Two adjacent corners make the half they fill, and a full cell is no shape at
  // all: the mesher draws it as the whole block it is.
  assert.deepEqual(shapeOf({ tags: [WALL, halfCornerTag('n'), halfCornerTag('e')] }), { kind: 'half', side: 'n' })
  assert.equal(shapeOf({ tags: [WALL, halfCornerTag('n'), halfCornerTag('e'), halfCornerTag('s'), halfCornerTag('w')] }), null)
  assert.equal(shapeOf({ tags: [WALL, halfWallTag('n'), halfWallTag('s')] }), null)
  // Two opposite corners are two separate columns.
  assert.deepEqual(shapeOf({ tags: [WALL, halfCornerTag('n'), halfCornerTag('s')] }), { kind: 'cuts', mask: 5 })
  // A duplicated piece is still one piece, and an unknown side draws nothing.
  assert.equal(wallCutMask({ tags: [halfCornerTag('n'), halfCornerTag('n')] }), 1)
  assert.deepEqual(wallCutPieces({ tags: [halfCornerTag('n'), halfCornerTag('n')] }), [{ kind: 'corner', side: 'n' }])
  assert.equal(wallCutMask({ tags: ['half-corner:q'] }), 0)
  assert.equal(shapeOf({ tags: ['half-corner:q'] }), null)
})

/* ------------------------------------------------------------- the release */

test('a free corner joins the half wall already in its cell', () => {
  let st = addWalls(empty(), [[2, 2, 0]], 'n', 1).state
  const before = st.cells[0]
  // The north half keeps NW + NE; the south-west corner is free.
  const r = addWalls(st, [[2, 2, 0]], null, 1, null, 'w')
  assert.equal(r.changed, 1, 'the corner was laid')
  assert.equal(r.blocked, 0, 'and did not collide')
  assert.equal(r.state.cells.length, 1, 'it shares the cell instead of shadowing it')
  const cell = r.state.cells[0]
  assert.deepEqual(cell.tags, [WALL, halfWallTag('n'), halfCornerTag('w')])
  assert.equal(cell.finish, before.finish, 'the merge keeps the cell’s finishes')
  assert.equal(cell.zone, before.zone)
  assert.equal(cell.room, before.room)
  assert.deepEqual(shapeOf(cell), { kind: 'cuts', mask: 11 })
  // `halfWallSide` still answers the 半墙 the cell keeps, for wall-mounted decor.
  assert.equal(halfWallSide(cell), 'n')

  // Adding the second free corner makes the cell whole.
  const full = addWalls(r.state, [[2, 2, 0]], null, 1, null, 's')
  assert.equal(full.changed, 1)
  assert.equal(full.blocked, 0)
  assert.equal(full.state.cells.length, 1)
  assert.equal(shapeOf(full.state.cells[0]), null, 'four quarters are a whole block')
  assert.equal(wallCutMask(full.state.cells[0]), 15)
  // ... and nothing else fits.
  const extra = addWalls(full.state, [[2, 2, 0]], null, 1, null, 'n')
  assert.equal(extra.changed, 0)
  assert.equal(extra.blocked, 1, 'a fifth piece overlaps the four already there')
})

test('an overlapping piece is refused, and a full wall is simply already there', () => {
  const half = addWalls(empty(), [[1, 1, 0]], 'n', 1).state
  // The north-east corner is inside the north half wall.
  const overlap = addWalls(half, [[1, 1, 0]], null, 1, null, 'e')
  assert.equal(overlap.changed, 0)
  assert.equal(overlap.blocked, 1)
  assert.equal(overlap.state, half, 'a refusal returns the same state, untouched')

  // A plain wall course (an auto-wall ring, a 墙-tool course) is not a cut to
  // merge into: the click adds nothing and has nothing to complain about.
  const wall = toState({ name: 't', seed: 1, cells: [{ x: 1, y: 1, z: 0, fill: 'solid', tags: [WALL] }], modules: [], lines: [] })
  const intoWall = addWalls(wall, [[1, 1, 0]], null, 1, null, 'n')
  assert.equal(intoWall.changed, 0)
  assert.equal(intoWall.blocked, 0)
  assert.equal(intoWall.state, wall)

  // A 三角 is one piece filling half the cell in elevation, so it collides with
  // every cut: no merge, no tag change.
  const wedge = toState({ name: 't', seed: 1, cells: [{ x: 1, y: 1, z: 0, fill: 'solid', tags: [WALL, 'tri-upper:n'] }], modules: [], lines: [] })
  const intoWedge = addWalls(wedge, [[1, 1, 0]], null, 1, null, 's')
  assert.equal(intoWedge.changed, 0)
  assert.equal(intoWedge.blocked, 0)
  assert.equal(intoWedge.state, wedge)
})

test('two half walls may share a cell only on opposite sides', () => {
  const north = addWalls(empty(), [[0, 0, 0]], 'n', 1).state
  const south = addWalls(north, [[0, 0, 0]], 's', 1)
  assert.equal(south.changed, 1, 'the opposite half joins')
  assert.equal(south.blocked, 0)
  assert.equal(wallCutMask(south.state.cells[0]), 15)
  // The same click on an adjacent side shares the north-east quarter: no.
  const east = addWalls(north, [[0, 0, 0]], 'e', 1)
  assert.equal(east.changed, 0)
  assert.equal(east.blocked, 1)
})

test('four corners build up one cell and survive a save round trip', () => {
  let st = empty()
  for (const side of ['n', 'e', 's', 'w']) st = addWalls(st, [[3, 3, 0]], null, 1, null, side).state
  assert.equal(st.cells.length, 1)
  assert.equal(wallCutMask(st.cells[0]), 15)
  const parsed = parse(serialize(st))
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error)
  if (!parsed.ok) return
  const cell = parsed.state.cells.find((c) => c.x === 3 && c.y === 3 && c.z === 0)
  assert.deepEqual(cell.tags, [WALL, halfCornerTag('n'), halfCornerTag('e'), halfCornerTag('s'), halfCornerTag('w')])
  assert.equal(wallCutMask(cell), 15)
})

/* -------------------------------------------------------------- the preview */

/** A ToolContext with the scene stubbed out to a recorder. */
function ctxFor() {
  const ghosts = []
  const scene = {
    setGhost: (cells, mode, module, thin, refused = []) => ghosts.push({ cells, mode, thin, refused }),
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
      solids: () => new Set(useStore.getState().station.cells.map((c) => `${c.x},${c.y},${c.z}`)),
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

/** A floor with a north-facing 半墙 in the air cell above it, in corner mode. */
function halfWallStation(cycle) {
  useStore.setState({
    tool: 'block',
    halfWall: true,
    halfCorner: true,
    triangles: false,
    triKind: 'upper',
    autoWalls: false,
    wallSnapCycle: cycle,
    past: [],
    future: [],
    station: toState({
      name: 't',
      seed: 1,
      cells: [floor(0, 0, 0), { x: 0, y: 0, z: 1, fill: 'solid', tags: [WALL, halfWallTag('n')] }],
      modules: [],
      lines: [],
    }),
  })
}

function press(cell, solid) {
  return {
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid, point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

test('the hover ghost promises the free corner and reds the overlapping one', () => {
  // cycle 3 is w (SW), the free corner beside the north half wall.
  halfWallStation(3)
  {
    const { tool, ghosts } = ctxFor()
    tool.onMove({ ...press([0, 0, 0], true), buttons: 0 })
    const p = ghosts.at(-1)
    assert.deepEqual(p.cells, [[0, 0, 1]], 'the cell that already holds the half wall is a candidate')
    assert.deepEqual(p.thin.get(packKey(0, 0, 1)), { kind: 'corner', side: 'w' },
      'the ghost shows only the new piece; the old half wall is already standing there')
    assert.deepEqual(p.refused, [])
  }
  // cycle 0 is n: the north-west quarter is inside the north half wall.
  halfWallStation(0)
  {
    const { tool, ghosts } = ctxFor()
    tool.onMove({ ...press([0, 0, 0], true), buttons: 0 })
    const p = ghosts.at(-1)
    assert.deepEqual(p.cells, [], 'an overlapping corner is not accepted')
    assert.deepEqual(p.refused, [[0, 0, 1]], 'it is refused, and the cell is boxed red')
  }
})

test('a corner click merges into the half-wall cell in one undo step', () => {
  halfWallStation(3)
  const { tool } = ctxFor()
  const event = press([0, 0, 0], true)
  const before = useStore.getState().station
  tool.onDown(event)
  assert.equal(useStore.getState().past.length, 0, 'the preview changes no document')
  tool.onUp(event)
  const after = useStore.getState().station
  assert.equal(after.cells.length, before.cells.length, 'no second record was added')
  const cell = after.cells.find((c) => c.x === 0 && c.y === 0 && c.z === 1)
  assert.deepEqual(cell.tags, [WALL, halfWallTag('n'), halfCornerTag('w')])
  assert.equal(useStore.getState().past.length, 1, 'one merge is one undo step')
})

test('the preview refuses an overlapping corner and leaves a full cell alone', () => {
  const st = toState({
    name: 't',
    seed: 1,
    cells: [floor(0, 0, 0), { x: 0, y: 0, z: 1, fill: 'solid', tags: [WALL, halfWallTag('n')] }],
    modules: [],
    lines: [],
  })
  const accepted = checkCutCells(st, [[0, 0, 1]], { kind: 'corner', side: 'w' })
  assert.deepEqual(accepted.acceptedCells, [[0, 0, 1]])
  assert.equal(accepted.blockedCells.length, 0)
  const overlap = checkCutCells(st, [[0, 0, 1]], { kind: 'corner', side: 'n' })
  assert.deepEqual(overlap.acceptedCells, [])
  assert.deepEqual(overlap.blockedCells, [[0, 0, 1]])
  assert.equal(overlap.refused.get('0,0,1'), 'occupied')

  const full = toState({ name: 't', seed: 1, cells: [floor(0, 0, 0), { x: 0, y: 0, z: 1, fill: 'solid', tags: [WALL] }], modules: [], lines: [] })
  const held = checkCutCells(full, [[0, 0, 1]], { kind: 'corner', side: 'w' })
  assert.deepEqual(held.acceptedCells, [])
  assert.deepEqual(held.blockedCells, [], 'a full wall is neither a candidate nor a red box')
})

/* ---------------------------------------------------------------- the mesh */

/** Every drawn triangle with its outward normal and area. */
function mesh(cells, thin) {
  const chunk = meshChunk(buildSolidSet(cells), new Map(), 0, 0, 0, 15, undefined, undefined, cells, thin)
  const tris = []
  for (const part of chunk.parts) for (let i = 0; i < part.indices.length; i += 3) {
    const idx = [part.indices[i], part.indices[i + 1], part.indices[i + 2]]
    const v = idx.map((n) => [part.positions[n * 3], part.positions[n * 3 + 1], part.positions[n * 3 + 2]])
    const n = [part.normals[idx[0] * 3], part.normals[idx[0] * 3 + 1], part.normals[idx[0] * 3 + 2]]
    const a = v[1].map((c, j) => c - v[0][j])
    const b = v[2].map((c, j) => c - v[0][j])
    tris.push({ v, n, area: Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / 2 })
  }
  let volume = 0
  for (const t of tris) {
    volume += (t.v[0][0] * (t.v[1][1] * t.v[2][2] - t.v[1][2] * t.v[2][1]) -
      t.v[0][1] * (t.v[1][0] * t.v[2][2] - t.v[1][2] * t.v[2][0]) +
      t.v[0][2] * (t.v[1][0] * t.v[2][1] - t.v[1][1] * t.v[2][0])) / 6
  }
  const area = (n, axis, coord) => {
    const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    let sum = 0
    for (const t of tris) {
      if (t.n[0] !== n[0] || t.n[1] !== n[1] || t.n[2] !== n[2]) continue
      if (!t.v.every((p) => Math.abs(p[ai] - coord) < 1e-6)) continue
      sum += t.area
    }
    return sum
  }
  return { chunk, tris, volume, area }
}

test('the mesher draws a 半墙 plus a corner as the L it is', () => {
  const cell = { x: 0, y: 0, z: 0, fill: 'solid', tags: [WALL, halfWallTag('n'), halfCornerTag('w')] }
  const shape = shapeOf(cell)
  const m = mesh([cell], new Map([[packKey(0, 0, 0), shape]]))
  assert.ok(Math.abs(m.volume - 0.75) < 1e-9, `three quarters are 0.75 m³, got ${m.volume}`)
  // The top and bottom are the three-quarter footprint, not a whole cell.
  assert.ok(Math.abs(m.area([0, 0, 1], 'z', 1) - 0.75) < 1e-9)
  assert.ok(Math.abs(m.area([0, 0, -1], 'z', 0) - 0.75) < 1e-9)
  // The outer faces: north 1 m, west 1 m, east 0.5 m and south 0.5 m. The L's two
  // inner faces sit at x = 0.5 and y = 0.5 and are drawn too; they are surfaces of
  // the piece, which is why the paint brush sees them.
  assert.ok(Math.abs(m.area([0, 1, 0], 'y', 1) - 1) < 1e-9)
  assert.ok(Math.abs(m.area([-1, 0, 0], 'x', 0) - 1) < 1e-9)
  assert.ok(Math.abs(m.area([1, 0, 0], 'x', 1) - 0.5) < 1e-9)
  assert.ok(Math.abs(m.area([0, -1, 0], 'y', 0) - 0.5) < 1e-9)
  // A whole block is 1 m³ / a whole cap: the L is not being drawn as one.
  assert.ok(Math.abs(m.volume - 1) > 0.1)

  // Two adjacent corners are the half they make, so the normalized shape draws
  // the same panel a 半墙 does.
  const pair = { x: 0, y: 0, z: 0, fill: 'solid', tags: [WALL, halfCornerTag('n'), halfCornerTag('e')] }
  assert.deepEqual(shapeOf(pair), { kind: 'half', side: 'n' })
  const p = mesh([pair], new Map([[packKey(0, 0, 0), shapeOf(pair)]]))
  assert.ok(Math.abs(p.volume - 0.5) < 1e-9)
  assert.ok(Math.abs(p.area([0, 0, 1], 'z', 1) - 0.5) < 1e-9)
})

test('a merge is a local cell edit the renderer can remesh', () => {
  const before = addWalls(empty(), [[2, 2, 2]], 'n', 1).state
  const after = addWalls(before, [[2, 2, 2]], null, 1, null, 'w').state
  const edit = localCellEdit(before, after)
  assert.ok(edit, 'the merge is a bounded local edit')
  assert.equal(edit.removed.length, 1, 'the old half-wall record is replaced')
  assert.equal(edit.added.length, 1, 'by the record carrying both pieces')
  assert.equal(shapeOf(edit.added[0]).kind, 'cuts')
  // The live index the renderer reads carries the compound cut for the chunk
  // mesher and the paint brush.
  const geometry = new StationGeometry().resolve(after)
  assert.deepEqual(geometry.thins.get('2,2,2'), { kind: 'cuts', mask: 11 })
})

test('two opposite corners are two separate quarter columns', () => {
  const cell = { x: 0, y: 0, z: 0, fill: 'solid', tags: [WALL, halfCornerTag('n'), halfCornerTag('s')] }
  const m = mesh([cell], new Map([[packKey(0, 0, 0), shapeOf(cell)]]))
  assert.ok(Math.abs(m.volume - 0.5) < 1e-9)
  assert.ok(Math.abs(m.area([0, 0, 1], 'z', 1) - 0.5) < 1e-9)
  // Each quarter stands in its own corner: north-west and south-east, both at the
  // cell's outer boundary, so all four sides show one quarter's 0.5 m face.
  assert.ok(Math.abs(m.area([0, 1, 0], 'y', 1) - 0.5) < 1e-9)
  assert.ok(Math.abs(m.area([0, -1, 0], 'y', 0) - 0.5) < 1e-9)
  assert.ok(Math.abs(m.area([1, 0, 0], 'x', 1) - 0.5) < 1e-9)
  assert.ok(Math.abs(m.area([-1, 0, 0], 'x', 0) - 0.5) < 1e-9)
})

test('four corners, or two opposite halves, mesh as the whole cell', () => {
  for (const tags of [
    [WALL, halfCornerTag('n'), halfCornerTag('e'), halfCornerTag('s'), halfCornerTag('w')],
    [WALL, halfWallTag('n'), halfWallTag('s')],
  ]) {
    const cell = { x: 0, y: 0, z: 0, fill: 'solid', tags }
    assert.equal(shapeOf(cell), null, 'a full union has no cut shape')
    const m = mesh([cell], new Map())
    assert.ok(Math.abs(m.volume - 1) < 1e-9)
    assert.ok(Math.abs(m.area([0, 0, 1], 'z', 1) - 1) < 1e-9)
  }
})

test('the paint ghost draws every surface a compound slot names', () => {
  const thin = new Map([[packKey(0, 0, 0), { kind: 'cuts', mask: 11 }]])
  const sys = new GhostSystem({ scene: new THREE.Scene(), thinSides: thin })
  sys.setFaceGhost([[0, 0, 0]], 'e', 0xffffff)
  assert.equal(sys.faceGhost.count, 2, 'the east slot has an outer NE face and an inner SW face')
  const positions = [0, 1].map((i) => {
    const m = new THREE.Matrix4()
    sys.faceGhost.getMatrixAt(i, m)
    return new THREE.Vector3().setFromMatrixPosition(m)
  }).sort((a, b) => a.x - b.x)
  assert.ok(Math.abs(positions[0].x - 0.505) < 1e-6, 'the inner face sits on the half-cell line')
  assert.ok(Math.abs(positions[0].y - 0.25) < 1e-6)
  assert.ok(Math.abs(positions[1].x - 1.005) < 1e-6, 'the outer face sits on the cell boundary')
  assert.ok(Math.abs(positions[1].y - 0.75) < 1e-6)
})

/* --------------------------------------------------------------- the paint */

test('the L’s inner faces are paintable surfaces inside its own cell', () => {
  const cell = { x: 1, y: 1, z: 0, fill: 'solid', tags: [WALL, halfWallTag('n'), halfCornerTag('w')] }
  const state = toState({ name: 't', seed: 1, cells: [cell], modules: [], lines: [] })
  const solid = new Set(['1,1,0'])
  const thin = thinWallSideMap(state.cells)
  assert.equal(facePresent(solid, thin, 1, 1, 0, 'e'), true, 'the L looks east into its missing quarter')
  assert.equal(facePresent(solid, thin, 1, 1, 0, 's'), true, 'and south into it')
  assert.equal(facePresent(solid, thin, 1, 1, 0, 'w'), true, 'the outer west face is paintable')
  const painted = paintFaces(state, [[1, 1, 0]], 'e', 'wall.enamel')
  assert.equal(at(painted, 1, 1, 0).finish.e, 'wall.enamel')
  const chunk = meshChunk(buildSolidSet(painted.cells), finishMapOf(painted.cells), 0, 0, 0, 15, undefined, undefined, painted.cells, thinWallSideMap(painted.cells))
  assert.ok(chunk.parts.some((p) => p.finish === 'wall.enamel'), 'the painted inner face is drawn')
})

test('an inner face keeps its finish when the outer part of the slot is covered', () => {
  // The missing south-west quarter makes slot `w` hold two surfaces: the outer
  // west face of the north arm and the inner face looking into the empty quarter.
  // A solid block west of the cell covers only the outer one; the paint must stay.
  const l = { x: 0, y: 0, z: 0, fill: 'solid', tags: [WALL, halfCornerTag('n'), halfCornerTag('e'), halfCornerTag('s')] }
  const west = { x: -1, y: 0, z: 0, fill: 'solid' }
  const north = { x: 0, y: 1, z: 0, fill: 'solid' }
  const state = toState({ name: 't', seed: 1, cells: [l, west, north], modules: [], lines: [] })
  const painted = paintFaces(state, [[0, 0, 0]], 'w', 'wall.enamel')
  const kept = clearContactFinishes(painted.cells)
  const cell = kept.find((c) => c.x === 0 && c.y === 0 && c.z === 0)
  assert.equal(cell.finish.w, 'wall.enamel', 'the inner west face is still exposed')
  // The north slot has no inner surface, so the wall above really does cover it.
  const paintedNorth = paintFaces(state, [[0, 0, 0]], 'n', 'wall.enamel')
  const cleared = clearContactFinishes(paintedNorth.cells)
  assert.equal(cleared.find((c) => c.x === 0 && c.y === 0 && c.z === 0).finish?.n, undefined,
    'a fully covered boundary face is cleared as before')
})

test('a compound cut backs a wall panel only on a half it fills', () => {
  const ground = floor(0, 0, 0)
  const ad = { id: 'bb', type: 'billboard', x: 0, y: 0, z: 0, rot: 1, w: 1, cfg: { variant: 'wide' } }
  const wall = (tags) => ({ x: 1, y: 0, z: 1, fill: 'solid', tags })
  // The panel's back plane touches the backing cell's west side. The L keeps the
  // whole west half, so it backs the panel; an L whose west half is only a corner
  // leaves the other side of the panel hanging.
  assert.equal(wallMountMissing([ground, wall([WALL, halfWallTag('n'), halfCornerTag('w')])], ad), false)
  assert.equal(wallMountMissing([ground, wall([WALL, halfWallTag('e'), halfCornerTag('w')])], ad), true)
})

/* ----------------------------------------------------------------- zones */

test('a compound cut is still a wall, not a floor', () => {
  const cells = [
    floor(0, 0, 0),
    { x: 0, y: 0, z: 1, fill: 'solid', tags: [WALL, halfWallTag('n'), halfCornerTag('w')] },
  ]
  const st = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  // The floor below the L is still a floor (the exposed part is zoneable), while
  // the L's own course is not — the same rule half walls already follow.
  const floors = zoneFloorKeys(st.cells)
  assert.ok(floors.has('0,0,0'))
  assert.ok(!floors.has('0,0,1'))
})
