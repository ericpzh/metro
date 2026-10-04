// Flush runs and the one-tile rule (GAME-SPEC §5.1). An escalator and a narrow
// stair are built to fit inside one 1 m cell — body and handrails both — so each
// keeps its own balustrade, two runs may stand in adjacent cells without
// colliding, and a wall or a fence may be built right up against a run. These
// tests pin the widths, the placement the rule allows and refuses, the barrier
// each run's own balustrade still is to the crowd, and the drawn geometry.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ESCALATOR_BALUSTRADE, ESCALATOR_BAND } from '../src/sim/constants.ts'
import { STAIR_WIDTH_DOUBLE, STAIR_WIDTH_NARROW, STAIR_WIDTH_TRIPLE, stairLaneBases } from '../src/sim/stairs.ts'
import { rampBlocked, rampBodyHalf, rampCorridorHalf } from '../src/sim/openings.ts'
import { placementBlocked } from '../src/sim/placement.ts'
import { buildGraph } from '../src/sim/station.ts'
import { buildModule } from '../src/render/models.ts'
import { createModule, wallRun } from '../src/build/model.ts'
import { scenarioStation } from './support/scenario-station.ts'

const key = (p) => `${p.x},${p.y},${p.z}`

/** The 扶梯 piece at a column, one storey up from `z`. */
function esc(id, x, dir = 'up', z = -4, y = 0) {
  const m = createModule('escalator', x, y, z, id, 0, undefined, dir)
  assert.ok(m && m.type === 'escalator')
  return m
}

/** The 单跑楼梯 piece at a column, one storey up from `z`. */
function stair(id, x, width = STAIR_WIDTH_NARROW, z = -4, y = 0) {
  const m = createModule('stair-straight', x, y, z, id, 0, width)
  assert.ok(m && m.type === 'stair')
  return m
}

test('a narrow stair is exactly the escalator band, and it is the default', () => {
  assert.equal(STAIR_WIDTH_NARROW, ESCALATOR_BAND)
  assert.equal(createModule('stair', 0, 0, -4, 's')?.cfg.width, ESCALATOR_BAND)
  assert.equal(createModule('stair-straight', 0, 0, -4, 's')?.cfg.width, ESCALATOR_BAND)
  assert.equal(STAIR_WIDTH_DOUBLE, 2 * ESCALATOR_BAND, 'a wide stair is two lanes')
})

test('a wide stair is lanes, so every lane merges with what is beside it', () => {
  // The builder lays a 2- or 3-lane stair as that many one-lane pieces
  // (`stairLaneBases`), so a bank of escalator + stair lanes is all ordinary
  // tile-sized runs — no wide piece ever needs a bay of its own.
  const e = esc('e', 0)
  const lanes = stairLaneBases({ x: 1, y: 0, z: -4 }, 0, 2).map((p, i) => stair(`s${i}`, p.x, STAIR_WIDTH_NARROW, p.z, p.y))
  assert.equal(lanes.length, 2)
  for (const lane of lanes) {
    assert.ok(rampCorridorHalf(lane) < 0.5)
    assert.equal(placementBlocked([e], lane), false, 'a lane butts against the escalator')
    assert.equal(placementBlocked([lane], e), false)
  }
  // The two lanes stand flush with each other too, and the piece as a whole
  // covers exactly two blocks.
  assert.equal(placementBlocked([lanes[0]], lanes[1]), false)
  assert.ok(!rampBlocked([lanes[0]], lanes[1]))
  // A legacy single-piece wide stair (a saved 1.6 m flight) is still wider than a
  // cell: it keeps the ordinary rule and needs a bay of its own.
  const wide = stair('w', 1, 1.6)
  assert.equal(placementBlocked([e], wide), true)
  assert.ok(rampBlocked([e], wide))
})

test('a run sweeps less than half a cell: body and handrails fit one tile', () => {
  const e = esc('e', 0)
  const s = stair('s', 0)
  // The escalator's overall width — balustrade spacing plus a handrail each side
  // — is what must fit, and it does, with a centimetre to spare.
  assert.ok(ESCALATOR_BALUSTRADE / 2 + 0.08 < 0.5, 'an escalator handrail crosses its cell edge')
  assert.ok(rampCorridorHalf(e) < 0.5, `the escalator sweeps ${rampCorridorHalf(e)}`)
  assert.ok(rampCorridorHalf(s) < 0.5, `the narrow stair sweeps ${rampCorridorHalf(s)}`)
  assert.ok(rampBodyHalf(e) < 0.5 && rampBodyHalf(s) < 0.5)
})

test('two runs in adjacent cells stand flush, in any pairing', () => {
  const e = esc('e', 0)
  // Escalator + stair, stair + escalator: neither collides.
  assert.equal(placementBlocked([e], stair('s', 1)), false)
  assert.equal(placementBlocked([stair('s', 1)], e), false)
  assert.ok(!rampBlocked([e], stair('s', 1)))
  // Two escalators, either travel direction, and a three-run bank.
  assert.equal(placementBlocked([e], esc('d', 1, 'down')), false)
  assert.equal(placementBlocked([e], esc('u', 1, 'up')), false)
  assert.equal(placementBlocked([e, stair('s', 1)], esc('c', 2, 'down')), false, 'a bank of three')
  // Along the run, offset rows and a storey up: still independent runs.
  assert.equal(placementBlocked([e], esc('off', 1, 'up', -4, 1)), false)
  assert.equal(placementBlocked([e], esc('above', 1, 'up', 0)), false)
})

test('what does not fit a tile still collides', () => {
  const e = esc('e', 0)
  const wide = stair('w', 1, 1.6)
  // A saved 1.6 m stair is one wide piece: it crosses into the next cell, so it
  // needs a bay of its own. (The builder lays a wide stair as lanes instead —
  // see the lane test above.)
  assert.ok(placementBlocked([e], wide))
  assert.ok(rampBlocked([e], wide))
  assert.ok(placementBlocked([wide], e))
  // The same column is one run per column, whichever way it travels, and a run
  // one storey below the next one still stacks.
  assert.ok(placementBlocked([e], esc('same', 0, 'down')))
  assert.ok(placementBlocked([e], esc('below', 0, 'down', -8)))
  // A turning stair spans its corner, so its envelope covers the neighbouring
  // cell too.
  const turn = createModule('stair-left90', 1, 0, -4, 't', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn)
  assert.ok(placementBlocked([e], turn))
})

test('a wall, fence or gate may be built right up against a run', () => {
  const e = esc('e', 0)
  const fence = createModule('fence', 1, 2, -4, 'f', 0)
  const gate = createModule('gate', 1, 0, -4, 'g', 0)
  assert.ok(fence && gate)
  assert.equal(placementBlocked([e], fence), false, 'a fence beside the run')
  assert.equal(placementBlocked([e], gate), false, 'a gate beside the run')
  // Inside the run's own tile, though, there is no room.
  assert.equal(placementBlocked([e], createModule('fence', 0, 2, -4, 'f', 0)), true)
  assert.equal(placementBlocked([e], createModule('gate', 0, 0, -4, 'g', 0)), true)
})

test('the reference station’s mixed entrance is a flush pair, and it is a barrier', () => {
  const data = scenarioStation()
  const s = data.modules.find((m) => m.id === 'stair-gc-exit-a')
  const e = data.modules.find((m) => m.id === 'esc-gc-up-exit-a')
  assert.ok(s && s.type === 'stair', 'exit A has no stair')
  assert.ok(e && e.type === 'escalator', 'exit A has no up escalator')
  assert.equal(s.x + 1, e.x, 'the stair stands flush against the escalator')
  assert.equal(s.y, e.y, 'and on the same bay row')
  assert.ok(!placementBlocked([e], s), 'the flush pair is a legal placement')

  // Both runs join the graph at both landings — and no walk edge crosses the
  // balustrades they stand between, so the crowd walks around the pair, never
  // through it.
  const g = buildGraph(data)
  const walk = (from, to) => {
    for (let i = g.adjStart[from]; i < g.adjStart[from + 1]; i++) if (g.adjTo[i] === to) return true
    return false
  }
  for (const p of [s.from, s.to, e.from, e.to]) assert.notEqual(g.nodeIndex.get(key(p)), undefined, `${key(p)} is not walkable`)
  const a = g.nodeIndex.get(key(s.from))
  const b = g.nodeIndex.get(key(e.from))
  assert.ok(!walk(a, b) && !walk(b, a), 'a balustrade leaks a walk edge')
})

/**
 * The drawn geometry of a run, measured in world space: every mesh of the model
 * the builder would place, as an axis-aligned box. Instanced meshes (the rolling
 * escalator band) are reposed every frame and are all inside their own cell, so
 * they are skipped. `cells` is the station's voxels, which a stair reads for the
 * walls hugging it.
 */
function meshBoxes(mod, modules, cells = []) {
  // Any material name resolves to one plain material, so the check needs no DOM.
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial()) })
  const data = { name: 't', seed: 1, cells, modules, lines: [] }
  const ctx = { mats, data, trackCells: new Set(), finish: () => mats.steel, preview: false }
  const g = buildModule(mod, ctx)
  assert.ok(g, `${mod.id} drew nothing`)
  g.updateMatrixWorld(true)
  const boxes = []
  g.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return
    o.geometry.computeBoundingBox()
    boxes.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld))
  })
  return boxes
}

/**
 * The newel returns of a stair, found by their own signature — a 0.07 m square
 * section 0.70 m tall — so a handrail that wraps round and lands on the floor can
 * be counted: two per rail that reaches its landings.
 */
function newelReturns(boxes) {
  return boxes.filter((b) => {
    const sizes = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].sort((a, c) => a - c)
    return Math.abs(sizes[0] - 0.07) < 1e-6 && Math.abs(sizes[1] - 0.07) < 1e-6 && Math.abs(sizes[2] - 0.7) < 1e-6
  })
}

/**
 * A 4 m 墙-tool column — four courses from the floor's top, `z` … `z + 3` — standing
 * on the −4 slab beside the cell of every run row in `rows`: the stairwell wall a
 * stair's handrail is tested against.
 */
function wallColumn(x, rows = [0, 1, 2, 3, 4, 5]) {
  return rows.flatMap((y) => wallRun([[x, y, -3]]).map(([wx, wy, wz]) => ({ x: wx, y: wy, z: wz, fill: 'solid', tags: ['wall'] })))
}

test('a run draws both of its own balustrades, inside its own cell', () => {
  // A narrow stair in the cell east of an escalator, both climbing +y: each run
  // keeps a railing on both sides, so neither ever crosses the shared edge at
  // x = 1.0 and nothing has to be dropped or shared.
  const e = esc('e', 0)
  const s = stair('s', 1)
  const modules = [e, s]
  const BOUNDARY = 1.0
  // The escalator stands in the cell west of the edge, the stair in the cell
  // east of it: neither may reach across.
  const east = meshBoxes(e, modules).filter((b) => b.max.x > BOUNDARY + 1e-6)
  assert.equal(east.length, 0, `the escalator crosses the shared edge with ${east.length} meshes`)
  const west = meshBoxes(s, modules).filter((b) => b.min.x < BOUNDARY - 1e-6)
  assert.equal(west.length, 0, `the stair crosses the shared edge with ${west.length} meshes`)
  // Each run's own outermost handrail stops just short of the edge, so the pair
  // reads as a double balustrade on the boundary — the two rails stand a
  // handrail's breadth apart rather than a slot the crowd could see through.
  const escalator = meshBoxes(e, modules)
  const stairBoxes = meshBoxes(s, modules)
  const outermost = (boxes, pick) => boxes.reduce((w, b) => (pick(b) > pick(w) ? b : w))
  const eRail = outermost(escalator, (b) => b.max.x)
  const sRail = outermost(stairBoxes, (b) => -b.min.x)
  assert.ok(eRail.max.x < BOUNDARY, 'the escalator handrail stops short of the edge')
  assert.ok(sRail.min.x > BOUNDARY, 'the stair handrail stops short of the edge')
  assert.ok(sRail.min.x - eRail.max.x < 0.1, `the pair leaves a ${(sRail.min.x - eRail.max.x).toFixed(3)} m slot between the runs`)
})

test('two stairs side by side: the steps meet, the rails between them stay', () => {
  // Placed separately (no shared `cfg.flight` token) they are two staircases —
  // each keeps both of its own railings — but their steps still meet: each lane
  // runs its treads out to the cell edge, so there is no gap between the flights.
  const a = stair('a', 0)
  const b = stair('b', 1)
  const separate = [a, b]
  const at = (mod, modules) => meshBoxes(mod, modules)
  const slimIn = (boxes) => boxes.filter((x) => x.max.x - x.min.x < 0.15)
  const centre = (x) => (x.min.x + x.max.x) / 2
  const middle = (boxes) => slimIn(boxes).filter((x) => centre(x) > 0.5 + 1e-6 && centre(x) < 1.5 - 1e-6)
  const span = (boxes) => [Math.min(...boxes.map((x) => x.min.x)), Math.max(...boxes.map((x) => x.max.x))]
  assert.ok(Math.abs(span(at(a, separate))[1] - 1.0) < 1e-6, 'the first flight stops short of the seam')
  assert.ok(Math.abs(span(at(b, separate))[0] - 1.0) < 1e-6, 'the second flight stops short of the seam')
  assert.ok(middle(at(a, separate)).length > 0, 'the first staircase lost its inner railing')
  assert.ok(middle(at(b, separate)).length > 0, 'the second staircase lost its inner railing')
  // The middle of a separate pair reads as a double balustrade with steps running
  // under it: ~0.91 and ~1.09 in world x.
  assert.ok(middle(at(a, separate)).some((x) => Math.abs(centre(x) - 0.91) < 0.06))
  assert.ok(middle(at(b, separate)).some((x) => Math.abs(centre(x) - 1.09) < 0.06))

  // One wide stair laid in a single action (`cfg.flight` shared) is one staircase:
  // the same joined steps, and the rail down the seam is gone.
  const joinedA = stair('a', 0)
  const joinedB = stair('b', 1)
  joinedA.cfg.flight = 'f1'
  joinedB.cfg.flight = 'f1'
  const joined = [joinedA, joinedB]
  assert.ok(Math.abs(span(at(joinedA, joined))[1] - 1.0) < 1e-6 && Math.abs(span(at(joinedB, joined))[0] - 1.0) < 1e-6)
  assert.equal(middle(at(joinedA, joined)).length, 0, 'the wide stair still has a rail down its middle')
  assert.equal(middle(at(joinedB, joined)).length, 0)
  // Three lanes of one flight: rails only at the outer edges, 0.09 and 2.91.
  const lanes = [stair('a', 0), stair('b', 1), stair('c', 2)]
  for (const l of lanes) l.cfg.flight = 'f2'
  const all = lanes.flatMap((l) => slimIn(at(l, lanes)))
  assert.equal(all.filter((x) => centre(x) > 0.5 && centre(x) < 2.5).length, 0, 'a rail stands inside the three-lane flight')
  for (const edge of [0.09, 2.91]) assert.ok(all.some((x) => Math.abs(centre(x) - edge) < 0.06), `the outer rail at ${edge} is missing`)

  // A lane beside an *escalator* is not a stair lane at all: both keep their own
  // balustrade, and the stair's steps do not reach under it.
  const e = esc('e', 0)
  const beside = stair('s', 1)
  const bank = [e, beside]
  assert.ok(slimIn(at(beside, bank)).some((x) => Math.abs(centre(x) - 1.09) < 0.06), 'the stair kept its rail beside the escalator')
  assert.ok(span(at(beside, bank))[0] > 1.0, 'the stair reached under the escalator')
})

test('the crowd may cross between the lanes of one wide flight, not between two stairs', () => {
  // Exit A's stair, with a second lane dropped west of it. As separate pieces the
  // two keep their rails and their walls; sharing a flight token they are one
  // wide staircase, so their landings are one floor.
  const walkBetween = (token) => {
    const data = scenarioStation()
    const west = createModule('stair-straight', -6, 24, -4, 'lane-west', 0, STAIR_WIDTH_NARROW)
    assert.ok(west && west.type === 'stair')
    if (token) {
      const east = data.modules.find((m) => m.id === 'stair-gc-exit-a')
      assert.ok(east && east.type === 'stair')
      west.cfg.flight = token
      east.cfg.flight = token
    }
    data.modules.push(west)
    const g = buildGraph(data)
    const at = (p) => g.nodeIndex.get(key(p))
    const lower = at(west.from)
    const stairBase = at({ x: -5, y: 24, z: -4 })
    const escalatorBase = at({ x: -4, y: 24, z: -4 })
    assert.notEqual(lower, undefined)
    assert.notEqual(stairBase, undefined)
    assert.notEqual(escalatorBase, undefined)
    const walk = (from, to) => {
      for (let i = g.adjStart[from]; i < g.adjStart[from + 1]; i++) if (g.adjTo[i] === to) return true
      return false
    }
    return { pair: walk(lower, stairBase) && walk(stairBase, lower), escalator: walk(stairBase, escalatorBase) || walk(escalatorBase, stairBase) }
  }
  // Placed separately: steps meet, but the two railings are a barrier.
  assert.equal(walkBetween(null).pair, false, 'two separate stairs became one floor')
  // One wide flight: the seam has no rail, so the landings are one floor.
  assert.equal(walkBetween('flight-1').pair, true, 'the lanes of a wide flight are not connected')
  // Either way the escalator beside the stair keeps its balustrade.
  assert.equal(walkBetween(null).escalator, false)
  assert.equal(walkBetween('flight-1').escalator, false, 'the escalator wall went with the lane merge')
})

test('both handrails of a stair wrap round and land on the floor', () => {
  const s = stair('s', 0)
  const boxes = meshBoxes(s, [s])  // The flight runs +y from (0,0) to (0,6,+4) on top of the -4 slab, so the
  // lower landing floor is z = -3 and the upper one z = +1, and the rails stand
  // at ±(half + 0.07) across the run. A return that reaches the ground puts
  // geometry at the rail's own line, at the landing, down at the floor.
  const half = STAIR_WIDTH_NARROW / 2
  for (const side of [1, -1]) {
    for (const [y, floor] of [[0, -3], [6, 1]]) {
      const reach = boxes.filter(
        (b) =>
          b.min.y < y + 0.6 &&
          b.max.y > y - 0.6 &&
          // the rail's line across the run, in world x (the run is along +y)
          Math.abs((b.min.x + b.max.x) / 2 - (0.5 + side * (half + 0.07))) < 0.08,
      )
      assert.ok(reach.length > 0, `no handrail geometry at the ${y === 0 ? 'lower' : 'upper'} landing, side ${side}`)
      const lowest = Math.min(...reach.map((b) => b.min.z))
      assert.ok(lowest <= floor + 0.05, `the ${side > 0 ? 'east' : 'west'} rail stops ${(lowest - floor).toFixed(2)} m above the floor`)
    }
  }
})

test('a newel return is drawn only where a flight meets a floor of its own', () => {
  // A straight stair has two handrails at two outer landings; a switchback's
  // half-landing carries the rail round the corner, so only its outer ends get a
  // newel rather than four posts in the middle of the platform.
  const straight = createModule('stair-straight', 0, 0, -4, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(straight)
  assert.equal(newelReturns(meshBoxes(straight, [straight])).length, 4, 'two handrails at two outer landings')
  // Both hands of the switchback, at every width: the flights are laid flush, so
  // the two runs stand closer together than ever and the landing still gets its
  // rail round the corner rather than a post in the middle.
  for (const id of ['stair-right180', 'stair-left180']) {
    for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE]) {
      const turn = createModule(id, 0, 0, -4, 't', 0, width)
      assert.ok(turn, `${id} at ${width} m did not build`)
      const boxes = meshBoxes(turn, [turn])
      assert.ok(boxes.length > 0, `${id} at ${width} m drew nothing`)
      for (const b of boxes) {
        for (const v of [b.min, b.max]) assert.ok(Number.isFinite(v.x + v.y + v.z), `${id} at ${width} m drew a bad box`)
      }
      assert.equal(newelReturns(boxes).length, 4, `${id} at ${width} m: a turn landing carries the rail round the corner`)
    }
  }
})

test('a wall hugging one side of a flight takes that side’s handrail with it', () => {
  // A straight stair climbs +y from (0,0) on the −4 slab with a 4 m wall column
  // standing on the floor beside its east side — the stairwell case. The flight
  // keeps the stringer it meets the wall with (its treads still stop at their own
  // edge) and gives up the handrail, the rail posts and the newel return: the wall
  // is the barrier there. The open west side is untouched.
  const s = stair('s', 0)
  const beside = wallColumn(1)
  // In the open, both rails reach the floor at both outer landings: four newels.
  assert.equal(newelReturns(meshBoxes(s, [s])).length, 4)
  const walled = meshBoxes(s, [s], beside)
  assert.equal(newelReturns(walled).length, 2, 'the walled side kept a newel return')
  // Nothing on the wall's side reaches rail height any more, while the west rail
  // still does. (The stringer's own top is the highest thing left over there, at
  // ~1.1; an open rail's return reaches ~1.95.)
  const high = (boxes, side) => boxes.filter((b) => Math.sign((b.min.x + b.max.x) / 2 - 0.5) === side && b.max.z > 1.3)
  assert.ok(high(meshBoxes(s, [s]), 1).length > 0, 'the open stair draws no east handrail at all')
  assert.equal(high(walled, 1).length, 0, 'the walled stair still draws an east handrail')
  assert.ok(high(walled, -1).length > 0, 'the west handrail went with the east one')
  // The stringer against the wall survives: the flight's own edge still runs the
  // whole incline out at the tread edge, on the wall's line.
  const stringer = walled.filter((b) => Math.abs((b.min.x + b.max.x) / 2 - 0.9) < 0.03 && b.max.y - b.min.y > 4)
  assert.ok(stringer.length > 0, 'the stringer against the wall was dropped')
})

test('a wall that does not hug the whole flight keeps both handrails', () => {
  const s = stair('s', 0)
  // A wall beside the bottom three cells only, and a wall that stops two courses
  // short of the flight's top: neither is a side the flight can lean on.
  assert.equal(newelReturns(meshBoxes(s, [s], wallColumn(1, [0, 1, 2]))).length, 4)
  assert.equal(newelReturns(meshBoxes(s, [s], wallColumn(1).filter((c) => c.z < -1))).length, 4)
  // A wall on each side, whole length: the flight is railed nowhere, and both
  // stringers are all that is left of its edges.
  const both = [...wallColumn(1), ...wallColumn(-1)]
  assert.equal(newelReturns(meshBoxes(s, [s], both)).length, 0)
})
