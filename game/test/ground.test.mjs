// The virtual street — GAME-SPEC §4.1, the inverted half (`sim/ground.ts`).
//
// The plane at z = 0 is solid **implicitly**: the document stores its holes
// (`{ fill: 'void' }`) and whatever ordinary blocks an authored save happens to
// carry, and every coordinate with no record is ground, for as far as anything
// can walk. Nothing about that is visible in a cell list, which is why the plane
// gets a file of its own: a reader that scans `state.cells` and stops there agrees
// with itself and disagrees with the game, and the failures are the silent ones —
// a crowd walking on a floor the block brush says is not there, a ghost promising
// a block the release drops, a drag that fills the horizon into the save.
//
// So this file pins both halves. The first is `sim/ground.ts` itself: what the
// window is, which three answers a coordinate has, and that a hole the game
// derived (a ramp's corridor, an exit's floor) needs no record to be a hole. The
// second is the plane as the *document* sees it — the one gesture that writes a
// hole and the edits that fill it back, the brushes that materialise it, and the
// two placement predicates that deliberately read it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GROUND_MARGIN, GROUND_Z, groundHoleAt, groundWindow, solidAt, virtualSolidAt, withGround } from '../src/sim/ground.ts'
import { buildGraph } from '../src/sim/station.ts'
import { ceilingMountMissing, equipmentReason, moduleFloorOk } from '../src/sim/placement.ts'
import { addCells, addFloor, createModule, paintFace, paintFaces, paintZone, paintZoneCells, removeCells, toState, zoneMapFloors } from '../src/build/model.ts'
import { checkBlockCells } from '../src/build/validation.ts'
import { emptyStation } from '../src/data/reference-station.ts'

/** The one module shape this file needs: a run whose `from`/`to` reach past its anchor. */
const ramp = (id = 'e1') => ({
  id,
  type: 'escalator',
  x: 0,
  y: 0,
  z: 0,
  from: { x: 0, y: 0, z: 0 },
  to: { x: 0, y: 6, z: -4 },
  cfg: { dir: 'down' },
})

/** A surface head-house, the other thing that derives a hole in the plane. */
const exit = (id = 'x1') => ({ id, type: 'exit', x: 0, y: 0, z: 0, cfg: { name: 'A口', inRate: 900, open: true } })

const state = (cells = [], modules = []) => toState({ name: 't', seed: 1, cells, modules, lines: [] })

/** The walk edges out of a node, as the graph's own keys. */
function edgesFrom(graph, id) {
  const out = []
  for (let e = graph.adjStart[id]; e < graph.adjStart[id + 1]; e++) out.push(graph.nodeKey[graph.adjTo[e]])
  return out
}

/* ------------------------------------------------------------------ the window */

test('the window is the content plus a margin, and never a second record', () => {
  const doc = [{ x: 0, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.granite' } }]
  const out = withGround(doc, [], 2)

  // x, y ∈ [−2, 2] → 25 coordinates, the document's own one among them.
  assert.equal(out.length, 25, 'the window is the content rectangle plus the margin')
  const mine = out.filter((c) => c.x === 0 && c.y === 0 && c.z === 0)
  assert.equal(mine.length, 1, 'the document held that coordinate: the street does not shadow it')
  assert.deepEqual(mine[0], doc[0], 'and the record comes through untouched, finish and all')
  for (const c of out) {
    if (c === mine[0]) continue
    assert.equal(c.z, GROUND_Z, 'the street is one plane, at grade')
    assert.equal(c.fill, 'solid')
    assert.equal(c.zone, 'outside', '站外: the plane is the world outside the station, not 非付费区')
    assert.equal(c.finish, undefined, 'and it is bare ground — no finish for a brush to read')
  }
})

test('the window reaches a run’s own ends, not only its anchor', () => {
  // A closed station's content is the origin alone; the ramp's own `from`/`to`
  // (0,0 → 0,6) pull the window out to the far landing, which is where the crowd
  // walks off it.
  const w = groundWindow([], [ramp()], 1)
  assert.deepEqual(w, { x0: -1, x1: 1, y0: -1, y1: 7 })
  // A station with nothing in it still gets one: the origin a new build starts from.
  assert.deepEqual(groundWindow([], [], 3), { x0: -3, x1: 3, y0: -3, y1: 3 })
  assert.equal(withGround([], [], 3).length, 49)
  assert.deepEqual(groundWindow([], [], GROUND_MARGIN), { x0: -GROUND_MARGIN, x1: GROUND_MARGIN, y0: -GROUND_MARGIN, y1: GROUND_MARGIN })
})

/* ------------------------------------------------- the three answers at a point */

test('a recorded block, a recorded hole, and the plane: three answers, one rule', () => {
  const hole = [{ x: 5, y: 5, z: GROUND_Z, fill: 'void' }]
  const block = [{ x: 5, y: 5, z: GROUND_Z, fill: 'solid' }]

  assert.equal(groundHoleAt(hole, [], 5, 5), true, 'a stored `void` is a hole')
  assert.equal(groundHoleAt(block, [], 5, 5), false, 'a stored block is not — the record wins')
  assert.equal(groundHoleAt([], [], 5, 5), false, 'and no record at all is ground')

  assert.equal(virtualSolidAt([], [], 5, 5, GROUND_Z), true, 'absent at grade means solid')
  assert.equal(virtualSolidAt(hole, [], 5, 5, GROUND_Z), false, 'a dug hole is the one exception')
  assert.equal(virtualSolidAt([], [], 5, 5, 4), false, 'and the plane is only at grade')
  assert.equal(virtualSolidAt([], [], 5, 5, -4), false, 'in both directions')

  assert.equal(solidAt([], [], 5, 5, GROUND_Z), true, 'the street is solid')
  assert.equal(solidAt(hole, [], 5, 5, GROUND_Z), false, 'its holes are not')
  assert.equal(solidAt([{ x: 5, y: 5, z: 4, fill: 'solid' }], [], 5, 5, 4), true, 'an explicit block is solid on any storey')
  assert.equal(solidAt([], [], 5, 5, 4), false, 'and nothing else is')
})

test('an opening the game derived is a hole with no record of its own', () => {
  // The corridor a ramp carves and the floor an exit lays are cut out of the plane
  // by the pieces themselves (`rampOpeningAt` / `exitFloorAt`), which is what keeps
  // the demo's 130-odd surface openings out of its JSON.
  assert.equal(groundHoleAt([], [ramp()], 0, 3), true, 'a cell in the carved corridor')
  assert.equal(virtualSolidAt([], [ramp()], 0, 3, GROUND_Z), false)
  assert.equal(solidAt([], [ramp()], 0, 3, GROUND_Z), false)
  assert.equal(groundHoleAt([], [ramp()], 0, 0), false, 'the landing sits on the walking line')
  assert.equal(groundHoleAt([], [ramp()], 5, 3), false, 'and the ground beyond the handrail is untouched')
  assert.equal(groundHoleAt([], [exit()], 0, 0), true, 'an exit floor is a hole')
  assert.equal(groundHoleAt([], [exit()], 5, 5), false, 'well outside its footprint is not')

  // Which is the same answer `withGround` gives: a derived hole is not paved over
  // either, so the drawn plane and the walked plane agree about the opening.
  const out = withGround([], [ramp()], 2)
  assert.equal(out.some((c) => c.x === 0 && c.y === 3), false, 'the corridor was paved back over')
  assert.equal(out.some((c) => c.x === 0 && c.y === 0), true, 'the landing is still ground under the run')
})

/* -------------------------------------------------------- the plane in the game */

test('a new station is an empty document standing on walkable ground', () => {
  const fresh = emptyStation()
  assert.deepEqual(fresh.cells, [], 'the street is implicit, so there is no seed of blocks')
  // The point of the empty document: the crowd has a floor from the first tick,
  // because the graph walks `withGround` and not `data.cells`.
  const g = buildGraph(fresh)
  assert.ok(g.nodeIndex.has('0,0,0'), 'the origin is a walkable node with no cell behind it')
  assert.ok(g.nodeCount > 1, 'and it is a plane, not one cell')
})

test('the plane is 站外, so it never invents an ungated fare line', () => {
  // `outside`↔`unpaid` is not a crossing (`crossingDir`), which is exactly why the
  // street is `outside` rather than `unpaid`: the demo's sparse zone paint would
  // otherwise draw an invisible fare line wherever a patch met unpainted ground.
  const paid = { name: 't', seed: 1, cells: [{ x: 1, y: 0, z: 0, fill: 'solid', zone: 'paid' }], modules: [], lines: [] }
  const gated = buildGraph(paid, true)
  assert.deepEqual(edgesFrom(gated, gated.nodeIndex.get('1,0,0')), [], 'a paid island in the street has no way out without a gate')

  const unpaid = { ...paid, cells: [{ x: 1, y: 0, z: 0, fill: 'solid', zone: 'unpaid' }] }
  const open = buildGraph(unpaid, true)
  assert.equal(edgesFrom(open, open.nodeIndex.get('1,0,0')).length, 4, 'while 非付费区 beside 站外 is one continuous floor')
})

/* ------------------------------------------------- digging a hole and filling it */

test('digging the street leaves one hole record, and nowhere else leaves any', () => {
  const st = state()
  const dug = removeCells(st, [[3, 4, 0]])
  assert.deepEqual(dug.cells, [{ x: 3, y: 4, z: 0, fill: 'void' }], 'the dig is recorded, or the plane paves it back')
  assert.equal(removeCells(dug, [[3, 4, 0]]).cells.length, 1, 'digging the same cell twice stacks no second record')
  assert.equal(removeCells(st, [[3, 4, 4]]).cells.length, 0, 'a storey that is not the street needs no record — absence is already void there')

  // A coordinate that is a hole either way needs none either: the ramp and the exit
  // derive their own, so removing the cell they open does not write a second one.
  assert.equal(removeCells(state([], [ramp()]), [[0, 3, 0]]).cells.length, 0, 'a carved corridor is already a hole')
  assert.equal(removeCells(state([], [exit()]), [[0, 0, 0]]).cells.length, 0, 'and an exit floor is too')
})

test('a block fills a dug hole back, replacing the record instead of shadowing it', () => {
  const st = state()
  const dug = removeCells(st, [[3, 4, 0]])

  // The ghost's own answer: `checkBlockCells` offers a hole as a candidate, so the
  // release has to lay it — the two disagreed while `addCells` counted *records*
  // rather than *blocks* and skipped the very cell the drag was highlighting.
  const virgin = addCells([], [[3, 4, 0], [9, 9, 0]], [])
  assert.equal(virgin.changed, 0, 'laying into the plane itself is a no-op')
  assert.equal(virgin.blocked, 0, 'and not a refusal: there is nothing there to complain about')
  assert.deepEqual(virgin.cells, [], 'so the save never carries the horizon')

  const filled = addCells(dug.cells, [[3, 4, 0]], [])
  assert.equal(filled.changed, 1, 'the hole the drag covered is filled')
  assert.deepEqual(filled.cells, [{ x: 3, y: 4, z: 0, fill: 'solid' }], 'and the `void` is gone, not merely outvoted')
  assert.equal(groundHoleAt(filled.cells, [], 3, 4), false, 'so the plane is closed again')
})

test('a floor patch lays the preview’s cells: it fills a hole and never the plane', () => {
  const st = state()
  // The 生成墙壁 path is handed `checkBlockCells`'s own answer (`acceptedCells`) —
  // the same list the ghost drew. On virgin ground that list is empty, which is the
  // whole point: the plane is floor already, so a drag across it lays nothing and the
  // save never grows the horizon.
  const overPlane = checkBlockCells(st, [[1, 1, 0], [2, 1, 0]])
  assert.deepEqual(overPlane.acceptedCells, [], 'a drag on virgin ground is not a candidate')
  assert.equal(addFloor(st, overPlane.acceptedCells), st, 'so the release lays nothing')
  // A dug hole *is* a candidate — the one cell at grade a drag really changes — and
  // laying it replaces the record instead of shadowing it.
  const dug = removeCells(st, [[3, 4, 0]])
  const overHole = checkBlockCells(dug, [[3, 4, 0]])
  assert.deepEqual(overHole.acceptedCells, [[3, 4, 0]], 'the hole is offered to the patch')
  const patched = addFloor(dug, overHole.acceptedCells)
  assert.deepEqual(patched.cells.find((c) => c.x === 3 && c.y === 4 && c.z === 0), {
    x: 3,
    y: 4,
    z: 0,
    fill: 'solid',
    tags: ['auto-floor'],
  })
  assert.equal(patched.cells.some((c) => c.fill === 'void'), false, 'the hole record is gone, not outvoted')
})

/* ------------------------------------------------------- the edits that paint it */

test('the 材质 brush materialises the pavement it paints, unless a piece holds it', () => {
  const st = state()
  const painted = paintFace(st, 2, 2, 0, 'top', 'floor.granite')
  assert.deepEqual(painted.cells, [{ x: 2, y: 2, z: 0, fill: 'solid', finish: { top: 'floor.granite' } }], 'the plane stands in for the block the brush just painted')

  const drag = paintFaces(st, [[4, 4, 0], [5, 4, 0]], 'top', 'floor.tile')
  assert.equal(drag.cells.length, 2, 'a drag materialises each cell it covers')
  assert.ok(drag.cells.every((c) => c.finish?.top === 'floor.tile'))

  // A dug hole is not floor, so it takes no paint — the brush does not secretly
  // pave it.
  const dug = removeCells(st, [[2, 2, 0]])
  assert.equal(paintFace(dug, 2, 2, 0, 'top', 'floor.granite'), dug, 'a hole takes no finish')
  assert.equal(paintFaces(dug, [[2, 2, 0]], 'top', 'floor.granite'), dug, 'and neither does a drag across one')

  // And the one placement rule set decides: the brush may not pour a block into a
  // 闸机's own cell, which is the cell the 方块 brush is kept out of.
  const gate = createModule('gate', 2, 2, 0, 'g1', 0)
  const held = state([], [gate])
  assert.equal(paintFace(held, 2, 2, 0, 'top', 'floor.granite'), held, 'the 材质 brush laid a block inside a 闸机')
  assert.equal(paintFaces(held, [[2, 2, 0]], 'top', 'floor.granite'), held)
})

test('a zone rectangle materialises the ground it covers; the bucket leaves the plane alone', () => {
  const st = state()
  // The bucket floods **floor**, and the plane is not in the document: it returns
  // the same state, rather than materialising a ring of cells around the click.
  assert.equal(paintZone(st, 2, 2, 0, 'paid'), st, 'a bucket flood wrote the street into the save')
  assert.equal(paintZone(st, 2, 2, 0, 'paid', false), st, 'and neither did a single-cell set')

  const rect = paintZoneCells(st, [[2, 2, 0], [3, 2, 0]], 'paid')
  assert.equal(rect.cells.length, 2, 'the bounded rectangle is the way to zone ground')
  assert.ok(rect.cells.every((c) => c.fill === 'solid' && c.zone === 'paid'))
  // The map draws the cells the player zoned, never the plane: an overlay that
  // added the window would carry thousands of quads for one uniform 站外.
  assert.deepEqual(
    zoneMapFloors(rect.cells, []).map((c) => `${c.x},${c.y},${c.z}`),
    ['2,2,0', '3,2,0'],
  )
  const dug = removeCells(st, [[2, 2, 0]])
  assert.equal(paintZoneCells(dug, [[2, 2, 0]], 'paid'), dug, 'and a hole takes no zone — it is not floor')
})

/* --------------------------------------------- the predicates that read the plane */

test('a piece stands on the street, and a fitting under it hangs from it', () => {
  // `moduleFloorOk` is one of the predicates the plane feeds: a machine dropped at
  // grade has real floor under it, so a new station can be furnished before a
  // single block is laid.
  const tvm = createModule('tvm', 2, 2, 0, 't1', 0)
  assert.equal(moduleFloorOk([], [], tvm), true, 'the street is not "no floor"')
  assert.equal(equipmentReason([], [], tvm), '', 'so the equipment verdict accepts it')
  const high = createModule('tvm', 2, 2, 4, 't2', 0)
  assert.equal(moduleFloorOk([], [], high), false, 'and one storey up there is nothing to stand on')
  assert.equal(equipmentReason([], [], high), 'floor')

  // `ceilingMountMissing` is the other: the plane is a slab one storey ABOVE a
  // basement, which is the ceiling a hung 时钟 bolts to down there. That branch is
  // the reason the predicate takes the modules at all.
  const clock = createModule('clock', 3, 3, -4, 'c1', 0)
  assert.equal(ceilingMountMissing([], clock), false, 'the street slab is the ceiling of the storey below it')
  assert.equal(
    ceilingMountMissing([{ x: 3, y: 3, z: 0, fill: 'void' }], clock),
    true,
    'but a hole dug through the pavement is nothing to hang from',
  )
})
