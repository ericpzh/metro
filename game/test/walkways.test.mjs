// 自动步道 (moving walkways §5.1). A walkway is the escalator's **level** twin:
// the same body and the same one-way ride, laid flat. Three lengths — 短 30 m,
// 中 60 m, 长 90 m — read from the endpoints like the escalator's, and the two
// differences the whole suite pins: it carves **nothing** (it lies on the floor,
// which must be there the whole way) and the crowd may only get on or off at its
// two landings (the belt's interior is not walkable).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  walkwayModule,
  walkwayLandings,
  walkwayCoveredCells,
  walkwayLengthOf,
  walkwayLengthSpec,
  walkwayLengthLabel,
  nextWalkwayLength,
  WALKWAY_LENGTHS,
  WALKWAY_LENGTH_DEFAULT,
} from '../src/sim/walkways.ts'
import { escalatorRun } from '../src/sim/escalators.ts'
import { stairFacing } from '../src/sim/stairs.ts'
import { buildGraph, PathFinder, EDGE_KIND } from '../src/sim/station.ts'
import { WALKWAY_SPEED, WALKWAY_RATE, WALK_SPEED } from '../src/sim/constants.ts'
import { addEquipment, createModule, removeModule, toState } from '../src/build/model.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import {
  moduleEnvelope,
  moduleFloorOk,
  moduleBlockedCells,
  movedModule,
  moveRebuilds,
  placementBlocked,
} from '../src/sim/placement.ts'
import { rampSlopeCuts, rampOpeningAt } from '../src/sim/openings.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore, placementPreviewKey } from '../src/app/store.ts'
import { WalkwayModel } from '../src/render/models/pieces/WalkwayModel.ts'
import { EscalatorModel } from '../src/render/models/pieces/EscalatorModel.ts'

const floor = (x0, x1, y0, y1, z) => {
  const cells = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push({ x, y, z, fill: 'solid' })
  return cells
}
const WALKER = { stepFree: false, luggage: false }
const STEP_FREE = { stepFree: true, luggage: false }

/** The edge kinds a path walks, by the graph's own adjacency. */
function kindsAlong(g, path) {
  const out = []
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]
    for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) {
      if (g.adjTo[e] === path[i + 1]) { out.push(g.adjKind[e]); break }
    }
  }
  return out
}

test('the three lengths are level runs of 30 / 60 / 90 m, named 短 / 中 / 长', () => {
  assert.deepEqual(WALKWAY_LENGTHS.map((s) => [s.id, s.run]), [['short', 30], ['medium', 60], ['long', 90]])
  assert.deepEqual(WALKWAY_LENGTHS.map((s) => walkwayLengthLabel(s.id)), ['短', '中', '长'])
  assert.equal(WALKWAY_LENGTH_DEFAULT, 'short')
  // Tab walks the tile 短 → 中 → 长 and wraps.
  let id = 'short'
  for (const next of ['medium', 'long', 'short']) {
    id = nextWalkwayLength(id)
    assert.equal(id, next)
  }
  // An id a save cannot spell falls back to 短, the tile the player last armed.
  assert.equal(walkwayLengthSpec(undefined).id, 'short')
  assert.equal(walkwayLengthSpec('mile').id, 'short')
  assert.equal(walkwayLengthLabel(undefined), '短')
})

test('every length is the level span between its endpoints, in every rotation, direction and width', () => {
  for (const spec of WALKWAY_LENGTHS) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) for (const width of [1, 2]) {
    const base = { x: 3, y: 5, z: 0 }
    const m = walkwayModule(base, rot, dir, spec.id, width, spec.id)
    const [dx, dy] = stairFacing(rot)
    const far = { x: 3 + dx * spec.run, y: 5 + dy * spec.run, z: 0 }
    assert.equal(m.type, 'walkway')
    assert.deepEqual(m.from, dir === 'up' ? base : far)
    assert.deepEqual(m.to, dir === 'up' ? far : base)
    assert.equal(m.cfg.dir, dir)
    assert.equal(m.cfg.width ?? 1, width)
    assert.equal(m.rot, rot)
    assert.equal(m.from.z, m.to.z, 'a walkway is level')
    assert.equal(walkwayLengthOf(m), spec.id, 'the endpoints are the length')
    const e = moduleEnvelope(m)
    assert.equal(dx === 0 ? e.y1 - e.y0 : e.x1 - e.x0, spec.run + 1, 'reservation includes both landing cells')
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, width, 'reserves one block per lane')
  }
})

test('the level run is centred the same whichever way it travels', () => {
  // The escalator centres a wide run by its low → high order; a level belt has no
  // z to order by, so the tie is broken on the plan — otherwise an up and a down
  // walkway would sit on opposite sides of their own landings.
  const q = (p) => `${p.x},${p.y},${p.z}`
  const shift = (m) => { const r = escalatorRun(m); return { dx: r.from.x - m.from.x, dy: r.from.y - m.from.y } }
  for (let rot = 0; rot < 4; rot++) {
    const up = walkwayModule({ x: 0, y: 0, z: 0 }, rot, 'up', 'up', 2, 'long')
    const down = walkwayModule({ x: 0, y: 0, z: 0 }, rot, 'down', 'down', 2, 'long')
    assert.deepEqual(shift(up), shift(down), 'the wide belt shifts to the same side either way')
    const ru = escalatorRun(up)
    const rd = escalatorRun(down)
    assert.deepEqual([q(ru.from), q(ru.to)].sort(), [q(rd.from), q(rd.to)].sort(), 'the belt spans the same two points')
    assert.deepEqual(moduleEnvelope(up), moduleEnvelope(down), 'direction does not move the reservation')
    assert.deepEqual(walkwayCoveredCells(up), walkwayCoveredCells(down))
  }
})

test('the belt interior is not walkable, only its two landings are', () => {
  const m = walkwayModule({ x: 0, y: 0, z: 0 }, 0, 'up', 'a', 1, 'short')
  const landings = walkwayLandings(m).map((p) => `${p.x},${p.y},${p.z}`)
  assert.deepEqual(landings.sort(), ['0,0,0', '0,30,0'])
  const covered = walkwayCoveredCells(m)
  assert.equal(covered.length, 29, 'every cell between the landings is covered')
  assert.ok(covered.every((p) => p.y > 0 && p.y < 30), 'the landings themselves are not covered')
  // A wide belt covers both lanes; the second column is one cell across, from the
  // run's own centring shift, so it lines up with `escalatorLandings`.
  const wide = walkwayModule({ x: 0, y: 0, z: 0 }, 0, 'up', 'w', 2, 'short')
  const shifted = escalatorRun(wide)
  const across = { x: wide.from.x + 2 * (shifted.from.x - wide.from.x), y: wide.from.y + 2 * (shifted.from.y - wide.from.y) }
  assert.equal(across.x, wide.from.x + 1, 'the second lane is the neighbouring column')
  const wideCovered = walkwayCoveredCells(wide).map((p) => `${p.x},${p.y}`)
  assert.equal(new Set(wideCovered).size, 2 * 29, 'both lanes are covered')
  for (let y = 1; y < 30; y++) {
    assert.ok(wideCovered.includes(`${wide.from.x},${y}`))
    assert.ok(wideCovered.includes(`${across.x},${y}`))
  }
})

test('placing a walkway carves nothing and keeps every floor cell under the belt', () => {
  const state = toState({ name: 'walkway', seed: 1, cells: floor(-2, 34, -4, 4, 0), modules: [], lines: [] })
  const m = walkwayModule({ x: 0, y: 0, z: 0 }, 1, 'up', 'wk-1', 1, 'short')
  const next = addEquipment(state, m)
  assert.equal(next.modules.length, 1)
  assert.equal(next.cells.length, state.cells.length, 'a level run opens no slab')
  for (const p of [...walkwayLandings(m), ...walkwayCoveredCells(m)]) {
    assert.ok(next.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z && c.fill === 'solid'), `${p.x},${p.y} keeps its floor`)
  }
  // Removing it takes the piece and nothing else.
  const gone = removeModule(next, m.id)
  assert.equal(gone.modules.length, 0)
  assert.equal(gone.cells.length, next.cells.length)
})

test('a walkway needs floor under its whole length, not just its landings', () => {
  // A storey down, so the missing cell is not papered over by the virtual street
  // (`virtualSolidAt` is true at z = 0 whatever the document says).
  const m = walkwayModule({ x: 0, y: 0, z: -4 }, 1, 'up', 'wk', 1, 'short')
  const full = floor(-2, 34, -2, 2, -4)
  assert.equal(moduleFloorOk(full, [], m), true)
  const overBelt = walkwayCoveredCells(m)[10]
  assert.equal(moduleFloorOk(full.filter((c) => !(c.x === overBelt.x && c.y === overBelt.y)), [], m), false, 'a missing belt cell is refused')
  assert.equal(moduleFloorOk(full.filter((c) => !(c.x === m.to.x && c.y === m.to.y)), [], m), false, 'a missing landing is refused')
})

test('the block brush refuses the belt cells but leaves the floor beside them', () => {
  const m = walkwayModule({ x: 0, y: 0, z: 0 }, 1, 'up', 'wk', 1, 'short')
  const blocked = moduleBlockedCells([m], 0)
  for (const p of [...walkwayLandings(m), ...walkwayCoveredCells(m)]) {
    assert.ok(blocked.has(`${p.x},${p.y},0`), `${p.x},${p.y} is under the belt`)
  }
  assert.ok(!blocked.has(`0,1,0`), 'the cell beside the belt is free')
  // It is **not** a carved opening: the carve list never learns about it.
  assert.equal(rampOpeningAt([m], 10, 0, 0), false, 'nothing is carved under a level belt')
  assert.equal(rampSlopeCuts([m]).size, 0, 'a level run cuts no slope')
})

test('two walkways may not share a run, and a moved one keeps its length', () => {
  const a = walkwayModule({ x: 0, y: 0, z: 0 }, 0, 'up', 'a', 1, 'short')
  const b = walkwayModule({ x: 0, y: 0, z: 0 }, 0, 'down', 'b', 1, 'short')
  assert.equal(placementBlocked([a], b), true, 'the same belt collides')
  assert.equal(moveRebuilds(a), true, 'a run is re-laid on a move')
  const moved = movedModule(a, { x: 5, y: 6, z: 7 }, 1)
  assert.equal(moved.from.z, 7)
  assert.equal(moved.to.z, 7, 'still level')
  assert.equal(walkwayLengthOf(moved), 'short', 'moving preserves length')
})

test('a saved walkway reads back whole: its endpoints, lane and direction', () => {
  const cells = floor(-2, 94, -4, 8, 0)
  const narrow = walkwayModule({ x: 0, y: 0, z: 0 }, 1, 'up', 'wk-narrow', 1, 'medium')
  const wide = walkwayModule({ x: 0, y: 6, z: 0 }, 1, 'down', 'wk-wide', 2, 'long')
  const state = addEquipment(addEquipment(toState({ name: 'saved', seed: 7, cells, modules: [], lines: [] }), narrow), wide)
  const r = parse(serialize(state))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, state.modules, 'the belts are written and read back whole')
  for (const [id, length, width, dir] of [['wk-narrow', 'medium', 1, 'up'], ['wk-wide', 'long', 2, 'down']]) {
    const m = r.state.modules.find((x) => x.id === id)
    assert.equal(m.type, 'walkway')
    assert.equal(walkwayLengthOf(m), length, 'the endpoints still name the length after a reload')
    assert.equal(m.cfg.width ?? 1, width)
    assert.equal(m.cfg.dir, dir)
  }
})

test('the crowd rides the belt one way, and a step-free passenger is carried too', () => {
  const cells = floor(-2, 34, -2, 2, 0)
  const m = walkwayModule({ x: 0, y: 0, z: 0 }, 1, 'up', 'wk', 1, 'short')
  const state = addEquipment(toState({ name: 'ride', seed: 1, cells, modules: [], lines: [] }), m)
  const g = buildGraph({ name: 'ride', seed: 1, cells: state.cells, modules: state.modules, lines: [] })
  const server = g.servers.find((s) => s.kind === 'walkway')
  assert.ok(server, 'the belt is a server on the crowd graph')
  assert.equal(server.rate, WALKWAY_RATE, 'one lane, one standing pitch')
  assert.ok(Math.abs(server.ride - 30 / WALKWAY_SPEED) < 1e-6, 'ridden at the walking speed plus the belt')
  assert.equal(g.nodeX[server.node], 0.5, 'boards at the dropped landing')
  assert.equal(g.nodeX[server.exitNode], 30.5, 'leaves at the far landing')
  // The belt interior is not a node: the only way across is to ride.
  assert.ok(g.nodeIndex.has('0,0,0') && g.nodeIndex.has('30,0,0'), 'both landings are nodes')
  for (const x of [1, 10, 20, 29]) assert.ok(!g.nodeIndex.has(`${x},0,0`), `${x},0 is not walkable`)
  // Both a walker and a step-free passenger are carried (a walkway is level).
  const finder = new PathFinder(g)
  const from = g.nodeIndex.get('0,0,0')
  const to = g.nodeIndex.get('30,0,0')
  for (const needs of [WALKER, STEP_FREE]) {
    const path = finder.search(from, to, needs)
    assert.ok(path, 'the belt is reachable')
    assert.ok(kindsAlong(g, path).includes(EDGE_KIND.walkway), 'the route rides the belt')
  }
})

test('a wide walkway doubles its lanes and its throughput', () => {
  const cells = floor(-2, 34, -4, 4, 0)
  const m = walkwayModule({ x: 0, y: 0, z: 0 }, 1, 'up', 'wide', 2, 'short')
  const state = addEquipment(toState({ name: 'wide', seed: 1, cells, modules: [], lines: [] }), m)
  const g = buildGraph({ name: 'wide', seed: 1, cells: state.cells, modules: state.modules, lines: [] })
  const server = g.servers.find((s) => s.kind === 'walkway')
  assert.ok(server)
  assert.equal(server.rate, WALKWAY_RATE * 2, 'two lanes carry twice as many')
  assert.equal(server.ramp.columns, 2)
  for (let x = 1; x < 30; x++) {
    assert.ok(!g.nodeIndex.has(`${x},0,0`) && !g.nodeIndex.has(`${x},-1,0`), 'both belt lanes are closed to walking')
  }
})

test('the tool builds the walkway at the armed length, width and direction', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'tool', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of WALKWAY_LENGTHS) for (const dir of ['up', 'down']) {
      useStore.setState({ station, moduleRot: 1, escalatorWide: false, escalatorDir: dir, walkwayLength: spec.id })
      const pieces = tool.buildPlacementModules('walkway', [3, 5, 0], 'wk')
      assert.equal(pieces.length, 1)
      const m = pieces[0]
      assert.equal(m.type, 'walkway')
      assert.equal(m.cfg.dir, dir)
      assert.equal(walkwayLengthOf(m), spec.id)
      assert.deepEqual([m.x, m.y, m.z], [3, 5, 0], 'the anchor is the near landing')
      assert.equal(m.to.y, m.from.y, 'level, never snapped into an exit bay')
      useStore.setState({ escalatorWide: true })
      assert.equal(tool.buildPlacementModules('walkway', [3, 5, 0], 'wk')[0].cfg.width, 2)
    }
  } finally {
    useStore.setState(before)
  }
})

test('length, width and direction are each their own ghost, and the length survives a cancelled pick', () => {
  const base = { x: 0, y: 0, z: 0 }
  const keys = WALKWAY_LENGTHS.map((s) => moduleGhostKey(walkwayModule(base, 0, 'up', 'w', 1, s.id)))
  assert.equal(new Set(keys).size, WALKWAY_LENGTHS.length, 'each length redraws the ghost')
  assert.notEqual(moduleGhostKey(walkwayModule(base, 0, 'up', 'w', 1, 'short')), moduleGhostKey(walkwayModule(base, 0, 'up', 'w', 2, 'short')), 'width redraws the ghost')
  assert.notEqual(moduleGhostKey(walkwayModule(base, 0, 'up', 'w', 1, 'short')), moduleGhostKey(walkwayModule(base, 0, 'down', 'w', 1, 'short')), 'direction redraws the ghost')

  const before = useStore.getState()
  try {
    useStore.setState({ walkwayLength: 'medium' })
    const key = placementPreviewKey(useStore.getState())
    useStore.getState().cycleWalkwayLength()
    assert.equal(useStore.getState().walkwayLength, 'long')
    assert.notEqual(placementPreviewKey(useStore.getState()), key, 'the length is in the preview key')
    useStore.getState().beginPick()
    useStore.getState().cycleWalkwayLength()
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().walkwayLength, 'long', 'Esc keeps the length a pick moved')
  } finally {
    useStore.setState(before)
  }
})

test('picking a walkway is covered by the picker suite', () => {
  // The click itself lives in `PickTool.onDown`; `test/pick-tool.test.mjs` drives
  // it with a stubbed context and pins the length / width / direction it arms.
  assert.ok(typeof useStore.getState().setWalkwayLength === 'function')
  assert.ok(typeof useStore.getState().cycleWalkwayLength === 'function')
  const m = walkwayModule({ x: 4, y: 4, z: 0 }, 1, 'down', 'picked', 2, 'long')
  const before = useStore.getState()
  try {
    useStore.setState({ walkwayLength: 'short' })
    useStore.getState().setWalkwayLength(walkwayLengthOf(m))
    assert.equal(useStore.getState().walkwayLength, 'long')
  } finally {
    useStore.setState(before)
  }
})

test('the drawn walkway is flat and spans its own run', () => {
  const mats = new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.MeshStandardMaterial()) })
  const finish = () => new THREE.MeshStandardMaterial()
  const spans = []
  for (const spec of WALKWAY_LENGTHS) {
    const esc = walkwayModule({ x: 0, y: 0, z: 0 }, 1, 'up', `wk-${spec.id}`, 1, spec.id)
    const data = { name: 'walkways', seed: 1, cells: [], modules: [esc], lines: [] }
    const g = new WalkwayModel({ mats, finish, data, preview: false }).build(esc)
    g.updateMatrixWorld(true)
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3())
    assert.ok(Number.isFinite(size.x + size.y + size.z), `${spec.id} walkway builds`)
    assert.ok(size.x > spec.run && size.x < spec.run + 2, `${spec.id} walkway spans its own ${spec.run} cell run`)
    assert.ok(size.z < 2.6, `${spec.id} walkway stays flat (a handrail, no climb)`)
    spans.push(size.x)
  }
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i] > spans[i - 1], 'a longer belt really is longer')

  // The shared builder still draws a climbing escalator, so the two have not drifted.
  const ramp = createModule('escalator', 0, 0, -4, 'esc', 1, undefined, 'up')
  const escGroup = new EscalatorModel({ mats, finish, data: { name: 'e', seed: 1, cells: [], modules: [ramp], lines: [] }, preview: false }).build(ramp)
  escGroup.updateMatrixWorld(true)
  const rampSize = new THREE.Box3().setFromObject(escGroup).getSize(new THREE.Vector3())
  assert.ok(rampSize.z > 3.5, 'an escalator still climbs a storey')
})

test('the walkway is level with the free walking speed it adds to', () => {
  assert.equal(WALKWAY_SPEED, WALK_SPEED + 0.5, 'the belt adds exactly 0.5 m/s')
  assert.ok(WALKWAY_SPEED > WALK_SPEED)
  assert.ok(Math.abs(WALKWAY_RATE - WALKWAY_SPEED / 0.8) < 1e-9)
})
