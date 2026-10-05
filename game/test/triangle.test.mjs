// 三角 — the 45° wedge the 地基 tool lays (§4.1, §4.3).
//
// A 半墙 keeps **half a cell in thickness**; a 三角 keeps half a cell **in
// elevation** — the cell cut on a 45° plane, so the piece is a wedge standing on (or
// hanging from) one flat 1 m square in the X-Y plane. The two pieces are the same
// kind of thing: an ordinary solid wall cell wearing the shape it keeps as a tag
// (`tri-upper:w`), so the column lift, the storey slice, `isWallBlock`, the ramp
// carve and the crowd all read it as a wall, while the mesher draws the wedge the tag
// names.
//
// There are two of them, because a cell admits the wedge two ways and turning one
// shape cannot make the other: 三角上 puts the flat square on the **floor** with the
// tip line at `+z`, 三角下 hangs it from the **ceiling** with the tip line at `-z`.
// **R** steps which of the four sides of the cell the full-height face stands on, so
// the pair spans the eight wedges a cell admits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { carveRampOpenings, rampThinCells, thinWallCells } from '../src/sim/openings.ts'
import {
  halfWallTag,
  isTriangleShape,
  isWallBlock,
  packKey,
  shapeOf,
  triangleOf,
  triangleTag,
  TRI_SIDES,
} from '../src/sim/types.ts'
import { addEquipment, addWalls, createModule, thinWallSideMap, toState, WALL } from '../src/build/model.ts'
import { placementPreviewKey, useStore } from '../src/app/store.ts'
import { BlockTool } from '../src/app/tools/BlockTool.ts'

function empty() {
  return toState({ name: 't', seed: 1, cells: [], modules: [], lines: [] })
}

const floor = (x, y, z = 0) => ({ x, y, z, fill: 'solid' })

/* ------------------------------------------------------- the piece itself */

test('a 三角 is a wall that remembers which side of its cell it hugs', () => {
  for (const kind of ['upper', 'lower']) {
    for (const side of TRI_SIDES) {
      const c = { x: 2, y: 2, z: 0, fill: 'solid', tags: [WALL, triangleTag(kind, side)] }
      assert.deepEqual(triangleOf(c), { kind, side }, `${kind}:${side} round-trips`)
      assert.deepEqual(shapeOf(c), { kind: 'triangle', triangle: kind, side })
      assert.ok(isTriangleShape(shapeOf(c)))
      assert.ok(isWallBlock(c), 'a 三角 is a wall to every rule that asks about walls')
    }
  }
  // A plain block, a full wall and a 半墙 are not wedges.
  assert.equal(triangleOf({}), null)
  assert.equal(triangleOf(floor(0, 0)), null)
  assert.equal(triangleOf({ tags: [WALL] }), null)
  assert.equal(triangleOf({ tags: [WALL, halfWallTag('w')] }), null)
  assert.deepEqual(shapeOf({ tags: [WALL, halfWallTag('w')] }), { kind: 'half', side: 'w' })
  // A tag naming a side no tool writes is still a wall — a load never drops one —
  // it simply has no shape to draw, so the mesher falls back to the whole block.
  assert.equal(triangleOf({ tags: ['tri-upper:xx'] }), null)
  assert.equal(shapeOf({ tags: ['tri-upper:xx'] }), null)
  assert.ok(isWallBlock({ tags: ['tri-upper:xx'] }))
})

test('a 三角 is laid like a 半墙: one tagged course, stacked by hand', () => {
  const st = addWalls(empty(), [[2, 2, 0]], null, 1, { kind: 'upper', side: 'n' }).state
  const courses = st.cells.filter((c) => triangleOf(c) !== null)
  assert.equal(courses.length, 1, 'one click lays one course')
  for (const c of courses) {
    assert.ok(c.tags.includes(WALL), 'it is still a 墙-tool wall')
    assert.deepEqual(triangleOf(c), { kind: 'upper', side: 'n' })
  }
  // A full-height 墙-tool run keeps its 4 m: the wedge is a shape, not a height.
  const run = addWalls(empty(), [[3, 3, 0]], null, undefined, { kind: 'lower', side: 'w' }).state
  assert.equal(run.cells.length, 4, 'the 墙 tool still lays the whole column')
  assert.equal(run.cells.filter((c) => triangleOf(c) !== null).length, 4, 'every course carries the shape')
})

/* --------------------------------------------------------- how it draws */

/** The outward normal of each cell side, and the two sides the triangular ends face. */
const SIDE_NORMAL = { n: [0, 1, 0], e: [1, 0, 0], s: [0, -1, 0], w: [-1, 0, 0] }
/** A wedge hugging a north or south face is cut across `y`, so its ends look w/e. */
const RIDGE_END = { n: ['w', 'e'], s: ['w', 'e'], e: ['s', 'n'], w: ['s', 'n'] }

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/**
 * One 三角 meshed **alone in its cell**, so all five of its faces are drawn, read back
 * as the faces themselves: every triangle's corners, its normal and its area, grouped
 * by the normal that names the face.
 */
function meshWedge(kind, side) {
  const cells = [floor(0, 0)]
  const thin = new Map([[packKey(0, 0, 0), { kind: 'triangle', triangle: kind, side }]])
  const chunk = meshChunk(buildSolidSet(cells), new Map(), 0, 0, 0, 15, undefined, undefined, cells, thin)
  const tris = []
  for (const part of chunk.parts) {
    for (let i = 0; i < part.indices.length; i += 3) {
      const idx = [part.indices[i], part.indices[i + 1], part.indices[i + 2]]
      const v = idx.map((n) => [part.positions[n * 3], part.positions[n * 3 + 1], part.positions[n * 3 + 2]])
      const n = [part.normals[idx[0] * 3], part.normals[idx[0] * 3 + 1], part.normals[idx[0] * 3 + 2]]
      const geo = cross(sub(v[1], v[0]), sub(v[2], v[0]))
      tris.push({ v, n, geo, area: Math.hypot(...geo) / 2 })
    }
  }
  const byNormal = new Map()
  for (const t of tris) {
    const key = t.n.map((v) => v.toFixed(3)).join(',')
    const g = byNormal.get(key) ?? { n: t.n, area: 0, tris: [] }
    g.area += t.area
    g.tris.push(t)
    byNormal.set(key, g)
  }
  // The enclosed volume, which is 0.5 m³ for every one of the eight — and only adds
  // up if every face is wound outward (`pushFace` measures the winding, this proves
  // it measured right).
  let volume = 0
  for (const t of tris) volume += dot(t.v[0], cross(t.v[1], t.v[2])) / 6
  const zs = tris.flatMap((t) => t.v.map((p) => p[2]))
  const span = (i) => [Math.min(...tris.flatMap((t) => t.v.map((p) => p[i]))), Math.max(...tris.flatMap((t) => t.v.map((p) => p[i])))]
  return { chunk, tris, byNormal, volume, x: span(0), y: span(1), z: span(2), zs }
}

test('every 三角 meshes as the 45° wedge its tag names, and only that wedge', () => {
  // The tightest reading of the whole feature: five faces, each of them the shape and
  // the direction the tag says. 三角上 stands its base on the floor and slopes up to
  // the hugged side, 三角下 hangs the same square from the ceiling; either way the
  // full-height face is on `side` and the slope falls away from it.
  const signatures = new Set()
  for (const kind of ['upper', 'lower']) {
    const upper = kind === 'upper'
    for (const side of TRI_SIDES) {
      const m = meshWedge(kind, side)
      const tag = `${kind}:${side}`
      // A wedge is half the cell: 0.5 m³, whatever the orientation.
      assert.ok(Math.abs(m.volume - 0.5) < 1e-9, `${tag}: volume ${m.volume}, expected 0.5`)
      assert.equal(m.byNormal.size, 5, `${tag}: a wedge has five faces`)
      // Every triangle is wound so its own corner order agrees with its normal: the
      // one invariant `pushFace` leans on for all eight orientations.
      for (const t of m.tris) {
        assert.ok(dot(t.geo, t.n) > 1e-9, `${tag}: a face is wound against its own normal`)
      }
      // The flat square: the whole cell in the X-Y plane, at the floor for 上 and at
      // the ceiling for 下 — "the X-Y plane is the base", and it is 1 m² of it.
      const base = m.byNormal.get([0, 0, upper ? -1 : 1].map((v) => v.toFixed(3)).join(','))
      assert.ok(base, `${tag}: no flat base in the X-Y plane`)
      assert.ok(Math.abs(base.area - 1) < 1e-9, `${tag}: base area ${base.area}, expected 1`)
      const baseH = upper ? 0 : 1
      for (const t of base.tris) for (const p of t.v) assert.equal(p[2], baseH, `${tag}: the base is not flat at z=${baseH}`)
      assert.deepEqual(m.x, [0, 1], `${tag}: the base does not span the cell in x`)
      assert.deepEqual(m.y, [0, 1], `${tag}: the base does not span the cell in y`)
      // The full-height face, on the side the tag names: a whole square, edge to edge.
      const hugged = m.byNormal.get(SIDE_NORMAL[side].map((v) => v.toFixed(3)).join(','))
      assert.ok(hugged, `${tag}: no face on the side it hugs`)
      assert.ok(Math.abs(hugged.area - 1) < 1e-9, `${tag}: the hugged face is ${hugged.area} m², expected 1`)
      assert.deepEqual(m.z, [0, 1], `${tag}: the piece does not fill the cell's own height`)
      // The slope: 1 m along the ridge by √2 across it, at exactly 45°, leaning away
      // from the hugged side — up for 上, down for 下.
      const slope = [...m.byNormal.values()].filter((f) => Math.abs(f.n[2]) > 1e-6 && Math.abs(f.n[2]) < 1 - 1e-6)
      assert.equal(slope.length, 1, `${tag}: a wedge has exactly one slope`)
      assert.ok(Math.abs(slope[0].area - Math.SQRT2) < 1e-9, `${tag}: slope area ${slope[0].area}, expected √2`)
      // The normals arrive as float32, so an irrational one is only good to ~1e-7.
      assert.ok(Math.abs(Math.abs(slope[0].n[2]) - Math.SQRT1_2) < 1e-6, `${tag}: the slope is not at 45°`)
      assert.equal(Math.sign(slope[0].n[2]), upper ? 1 : -1, `${tag}: the slope faces the wrong way up`)
      const away = SIDE_NORMAL[side].map((v) => -v)
      const horizontal = slope[0].n.slice(0, 2)
      assert.ok(horizontal[0] * away[0] + horizontal[1] * away[1] > 0, `${tag}: the slope does not fall away from the side it hugs`)
      // The two triangular ends, on the two cell faces across the ridge.
      for (const end of RIDGE_END[side]) {
        const f = m.byNormal.get(SIDE_NORMAL[end].map((v) => v.toFixed(3)).join(','))
        assert.ok(f, `${tag}: missing the ${end} triangular end`)
        assert.ok(Math.abs(f.area - 0.5) < 1e-9, `${tag}: the ${end} end is ${f.area} m², expected 0.5`)
        assert.equal(f.tris.length, 1, `${tag}: the ${end} end is not a triangle`)
      }
      // No sixth face, and nothing off the cell's own footprint.
      assert.deepEqual(m.z, [0, 1], `${tag}: the wedge leaves its cell`)
      signatures.add(
        [...m.byNormal.keys()].sort().join(' ') + `|${baseH}`,
      )
    }
  }
  // The eight together are distinct: no two tags draw the same wedge.
  assert.equal(signatures.size, 8, `all eight wedges are distinct (saw ${signatures.size})`)
  // A whole block is more geometry than any one of them.
  const full = meshChunk(buildSolidSet([floor(0, 0)]), new Map(), 0, 0, 0, 15)
  assert.ok(full.triangles > meshWedge('lower', 'e').chunk.triangles, 'a full block is more geometry')
})

test('the 三角 kind and side are part of what a ghost and a chunk key off', () => {
  // R turns the piece without the pending cell moving, so the shape has to be in
  // the preview key or the ghost keeps showing the side the player turned away
  // from (`placementPreviewKey` → `Viewport` → `refreshHover`).
  const st = { ...useStore.getState(), tool: 'block', halfWall: false, triangles: true, triKind: 'upper', wallSnapCycle: 0 }
  const k = (over) => placementPreviewKey({ ...st, ...over })
  assert.notEqual(k({ wallSnapCycle: 0 }), k({ wallSnapCycle: 1 }), 'R rebuilds the ghost')
  assert.notEqual(k({ triKind: 'upper' }), k({ triKind: 'lower' }), 'the two kinds are different pieces')
  assert.notEqual(k({ triangles: true, halfWall: false }), k({ triangles: false, halfWall: true }), 'and a 半墙 is a third')
})

/* ------------------------------------------------------- the tool's click */

/** A ToolContext with the scene stubbed out to a recorder. */
function ctxFor() {
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

/** A floor patch, and the store left holding it in a 三角 mode. */
function station(kind, cycle) {
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push(floor(x, y))
  useStore.setState({
    tool: 'block',
    halfWall: false,
    triangles: true,
    triKind: kind,
    autoWalls: false,
    wallSnapCycle: cycle,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }),
  })
}

/** One pointer event; the pick is the cell the pointer is over. */
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

test('a 三角 click lays the tagged wedge its ghost previewed', () => {
  // The same contract the 半墙 click had to earn: the piece that lands is the piece
  // the ghost drew, and it lands as its own shape rather than as a whole block.
  const seen = new Set()
  for (const kind of ['upper', 'lower']) {
    for (let cycle = 0; cycle < 4; cycle++) {
      station(kind, cycle)
      const { tool, ghosts } = ctxFor()
      tool.onDown(press([1, 1, 0], true))
      tool.onUp(press([1, 1, 0], true))

      const st = useStore.getState().station
      assert.equal(st.cells.length, 17, `${kind} ${cycle}: exactly one course was added`)
      const course = st.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 1)
      assert.ok(course, `${kind} ${cycle}: nothing was laid`)
      assert.deepEqual(triangleOf(course), { kind, side: triangleOf(course).side }, `${kind} ${cycle}: it is a 三角`)
      assert.ok(TRI_SIDES.includes(triangleOf(course).side), `${kind} ${cycle}: the side is one of the four`)
      assert.ok(course.tags.includes(WALL))
      // The floor under it is untouched — a cut block stands on its floor like any
      // other course.
      assert.deepEqual(st.cells.find((c) => c.x === 1 && c.y === 1 && c.z === 0), { x: 1, y: 1, z: 0, fill: 'solid' })
      // The ghost promised the same shape, and the shape map the mesher reads
      // agrees with both.
      const preview = ghosts[0]
      assert.deepEqual(preview.thin.get(packKey(1, 1, 1)), shapeOf(course), `${kind} ${cycle}: the ghost showed another shape`)
      assert.deepEqual(thinWallSideMap(st.cells, st.modules).get('1,1,1'), shapeOf(course))
      seen.add(triangleTag(kind, triangleOf(course).side))
    }
  }
  // R really does walk the cell: four steps reach all four sides of each kind.
  assert.equal(seen.size, 8, `the tool lays all eight wedges, saw ${seen.size}`)
})

test('the 地基 tool carries the 三角 mode, and **Tab** cycles the three pieces', () => {
  // The rail's one cut tile steps 半墙 → 三角上 → 三角下 → off, and back, and **Tab** is
  // that same step: the key used to toggle the generated wall ring, which is now off
  // when the game opens and asked for on its own tile. The three cut modes are
  // exclusive, they all hold the ring off, and the ring is never switched on behind
  // the player's back by leaving the cycle.
  useStore.setState({ tool: 'block', halfWall: false, triangles: false, triKind: 'upper', autoWalls: false, wallSnapCycle: 0 })
  const st = () => useStore.getState()
  st().cycleCutMode()
  assert.equal(st().halfWall, true, '半墙 first — Tab’s first step is a cut piece, not the ring')
  assert.equal(st().triangles, false)
  assert.equal(st().autoWalls, false, 'a cut mode holds the generated ring off')
  assert.equal(st().wallSnapCycle, 0, 'the side cycle starts fresh with the mode')
  st().cycleCutMode()
  assert.equal(st().triangles, true, 'then 三角上')
  assert.equal(st().halfWall, false, 'the two cut modes are exclusive')
  assert.equal(st().triKind, 'upper')
  assert.equal(st().autoWalls, false)
  st().cycleCutMode()
  assert.equal(st().triangles, true, 'then 三角下')
  assert.equal(st().triKind, 'lower')
  st().cycleCutMode()
  assert.equal(st().triangles, false, 'and off')
  assert.equal(st().halfWall, false)
  assert.equal(st().autoWalls, false, 'leaving the cycle does not raise the ring')
  st().cycleCutMode()
  assert.equal(st().halfWall, true, 'and the cycle wraps')
  // The ring is refused while either cut mode owns the tool, and its own tile is the
  // only way to it.
  st().setTriangles(true)
  st().setAutoWalls(true)
  assert.equal(st().autoWalls, false, 'the ring is refused while 三角 owns the tool')
  st().setHalfWall(true)
  assert.equal(st().triangles, false, 'turning 半墙 on turns 三角 off')
  st().setHalfWall(false)
  assert.equal(st().autoWalls, false)
  st().setAutoWalls(true)
  assert.equal(st().autoWalls, true, 'with no cut mode on, the tile still opens the ring')
  // Both the mode and the side **R** stepped to change what the hover ghost is, so
  // both have to be in the one key the viewport subscribes to.
  useStore.setState({ tool: 'select', halfWall: false, triangles: false, autoWalls: false, wallSnapCycle: 0 })
})

test('R walks the sides through the geometry first, then the rest', () => {
  // A wedge dropped against an open edge stands its full-height face there with no
  // key pressed, the way a 半墙 hugs a patch edge — the tool reads the geometry, the
  // player does not have to turn the piece first. Four steps reach all four sides, in
  // the cycle's own order rather than by jumping between two.
  const sides = []
  for (let cycle = 0; cycle < 4; cycle++) {
    station('lower', cycle)
    const { tool } = ctxFor()
    tool.onDown(press([1, 1, 0], true))
    tool.onUp(press([1, 1, 0], true))
    const c = useStore.getState().station.cells.find((x) => x.x === 1 && x.y === 1 && x.z === 1)
    sides.push(triangleOf(c).side)
  }
  assert.equal(new Set(sides).size, 4, `four steps, four sides (saw ${sides.join(', ')})`)
})

/* ----------------------------------------------------------- the sim sees it */

test('a ramp keeps a 三角 instead of carving it or re-cutting it', () => {
  // A 三角 is a block the player laid, so it is a wall to the ramp: the carve skips
  // it, and `rampThinCells` leaves its shape alone rather than re-deriving a 半墙
  // over a wedge the player chose.
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      cells.push(x === 2 ? { x, y, z: 0, fill: 'solid', tags: [WALL, triangleTag('lower', 'n')] } : floor(x, y))
    }
  }
  const stair = createModule('stair-straight', 1, 4, -2, 's', 2, 1.6)
  assert.ok(stair)
  carveRampOpenings(cells, [stair])
  const kept = cells.find((c) => c.x === 2 && c.y === 2 && c.z === 0)
  assert.ok(kept, 'the 三角 beside the run survives the carve')
  assert.deepEqual(triangleOf(kept), { kind: 'lower', side: 'n' }, 'and is still the side it hugged')
  assert.ok(!rampThinCells(cells, [stair]).some((t) => t.x === 2), 'a 三角 is not thinned a second time')
  // The tag is the whole difference: the same cell without it is thinned.
  const plain = cells.map((c) => (c.x === 2 ? { ...c, tags: [WALL] } : c))
  assert.ok(rampThinCells(plain, [stair]).some((t) => t.x === 2), 'an ordinary wall there is thinned')
})

test('a 三角 survives a stair placed beside it, shape and all', () => {
  // The app-level half of the same promise: the piece the player laid is one of the
  // wall courses a 1.6 m stair runs against, and the run must not rewrite it.
  const cells = []
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) cells.push(floor(x, y))
  cells.push({ x: 2, y: 4, z: 1, fill: 'solid', tags: [WALL, triangleTag('upper', 's')] })
  const before = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  const stair = createModule('stair-straight', 1, 4, 0, 's', 2, 1.6)
  assert.ok(stair)
  const after = addEquipment(before, stair)
  const kept = after.cells.find((c) => c.x === 2 && c.y === 4 && c.z === 1)
  assert.ok(kept, 'the 三角 is still there')
  assert.deepEqual(triangleOf(kept), { kind: 'upper', side: 's' })
  assert.deepEqual(
    thinWallCells(after.cells, after.modules).find((t) => t.x === 2 && t.y === 4 && t.z === 1),
    { x: 2, y: 4, z: 1, shape: { kind: 'triangle', triangle: 'upper', side: 's' } },
    'and the mesher still draws it as that wedge',
  )
})
