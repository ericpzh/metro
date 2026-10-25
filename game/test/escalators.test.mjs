// Placed escalators (扶梯). An escalator is fixed-length equipment like a stair:
// its base is the floor cell it is dropped on and it rises exactly one storey
// along the placement rotation. `dir` only orders `from`/`to` — the one-way
// travel the sim and the label read — so up and down share one footprint.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, ESCALATOR_RISE, ESCALATOR_RUN, nextEscalatorDir, toState, addEquipment } from '../src/build/model.ts'
import { escalatorModule, escalatorSpanOf } from '../src/sim/escalators.ts'
import { DOUBLE_RAMP_LENGTHS } from '../src/sim/rampLengths.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { moduleEnvelope, placementBlocked } from '../src/sim/placement.ts'
import { stairFacing } from '../src/sim/stairs.ts'
import { escalatorLandings } from '../src/sim/escalators.ts'
import { escalatorBasesSolid, rampOpeningAt, rampSlopeCuts } from '../src/sim/openings.ts'
import { packKey } from '../src/sim/types.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore } from '../src/app/store.ts'

const floor = (x0, x1, y0, y1, z) => {
  const cells = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push({ x, y, z, fill: 'solid' })
  return cells
}

test('a wide escalator is one two-block piece in every rotation and direction', () => {
  for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const wide = createModule('escalator', 0, 0, -5, 'wide', rot, 2, dir)
    const narrow = createModule('escalator', 0, 0, -5, 'narrow', rot, 1, dir)
    const [dx, dy] = stairFacing(rot)
    const e = moduleEnvelope(wide)
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, 2, 'reserves exactly two blocks across')
    assert.equal(dx === 0 ? e.y1 - e.y0 : e.x1 - e.x0, ESCALATOR_RUN + 1, 'keeps the same run length')
    assert.notEqual(moduleGhostKey(wide), moduleGhostKey(narrow), 'width change redraws the ghost')
    const lower = { x: 0, y: 0, z: -5 }
    const upper = { x: dx * ESCALATOR_RUN, y: dy * ESCALATOR_RUN, z: 0 }
    const second = { x: dy, y: -dx, z: -5 }
    assert.equal(placementBlocked([wide], createModule('escalator', second.x, second.y, -5, 'overlap', rot)), true)
    assert.equal(placementBlocked([wide], createModule('escalator', 2 * dy, -2 * dx, -5, 'beside', rot)), false)
    const cells = escalatorLandings(wide).map((p) => ({ ...p, fill: 'solid' }))
    const cuts = rampSlopeCuts([wide])
    for (const p of escalatorLandings(wide)) {
      assert.equal(cuts.has(packKey(p.x, p.y, p.z)), p.z === 0, 'only upper landing floors are recessed beneath the terminal track')
    }
    assert.equal(escalatorBasesSolid(cells, [], wide), true)
    assert.equal(escalatorBasesSolid(cells.filter((c) => c.x !== second.x || c.y !== second.y || c.z !== second.z), [], wide), false, 'both blocks need lower support')
    for (const offset of [0, 1]) {
      assert.equal(rampOpeningAt([wide], 6 * dx + offset * dy, 6 * dy - offset * dx, 0), true, 'opens both columns')
    }
    const state = toState({ name: 'wide', seed: 1, cells: [...floor(-10, 10, -10, 10, 0), ...floor(-10, 10, -10, 10, -5)], modules: [], lines: [] })
    const placed = addEquipment(state, wide)
    assert.equal(placed.modules.length, 1, 'placement creates one module')
    for (const p of escalatorLandings(wide)) assert.ok(placed.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z), 'retains every landing floor')
    assert.deepEqual(wide.from, dir === 'up' ? lower : upper)
  }
})

test('the wide escalator tool previews one piece at each plan width, including downward travel', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'wide tool', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
      for (const width of [2, 3]) {
        useStore.setState({ station, moduleRot: rot, escalatorWidth: width, escalatorDir: dir })
        const pieces = tool.buildPlacementModules('escalator', [3, 5, -4], 'wide')
        assert.equal(pieces.length, 1, 'a wide piece never creates a second escalator')
        assert.equal(pieces[0].cfg.width, width)
        assert.equal(pieces[0].cfg.dir, dir)
        assert.deepEqual([pieces[0].x, pieces[0].y, pieces[0].z], [3, 5, -4], 'direction never changes the placement anchor')
      }
      useStore.setState({ escalatorWidth: 1 })
      assert.equal(tool.buildPlacementModules('escalator', [3, 5, -4], 'narrow')[0].cfg.width ?? 1, 1)
    }
  } finally {
    useStore.setState(before)
  }
})

test('an extra-wide escalator spans three blocks in every rotation and direction', () => {
  for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const wide = createModule('escalator', 0, 0, -5, 'extra-wide', rot, 3, dir)
    assert.ok(wide && wide.type === 'escalator')
    assert.equal(wide.cfg.width, 3)
    const [dx, dy] = stairFacing(rot)
    const e = moduleEnvelope(wide)
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, 3, 'reserves exactly three blocks across')
    assert.equal(escalatorLandings(wide).length, 6, 'three landing columns, one pair each')
    for (const offset of [0, 1, 2]) {
      assert.equal(rampOpeningAt([wide], 6 * dx + offset * dy, 6 * dy - offset * dx, 0), true, 'opens every lane')
    }
  }
})

test('every escalator span keeps all three plan widths', () => {
  for (const span of ['single', 'double', 'triple']) for (const width of [1, 2, 3]) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const m = createModule('escalator', 0, 0, -5, `${span}-${width}`, rot, width, dir, 'lane', [], undefined, {
      escalatorSpan: span, doubleRampLength: 'long', tripleRampLength: 'long',
    })
    assert.ok(m && m.type === 'escalator')
    assert.equal(m.cfg.width ?? 1, width, `${span} width ${width}`)
    const [dx, dy] = stairFacing(rot)
    const e = moduleEnvelope(m)
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, width, `${span} width ${width} reserves its plan blocks`)
    const landings = escalatorLandings(m)
    assert.equal(landings.length, width * 2, `${span} width ${width} lands on every plan lane`)
    assert.equal(landings.filter((p) => p.z === Math.min(m.from.z, m.to.z)).length, width)
  }
})

test('an up escalator rises from the dropped cell to the storey above', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('escalator', 3, 5, -5, 'e', rot, undefined, 'up')
    assert.ok(m && m.type === 'escalator')
    const [dx, dy] = stairFacing(rot)
    assert.deepEqual(m.from, { x: 3, y: 5, z: -5 }, 'up travels from the base (lower) landing')
    assert.deepEqual(m.to, { x: 3 + dx * ESCALATOR_RUN, y: 5 + dy * ESCALATOR_RUN, z: -5 + ESCALATOR_RISE })
    assert.equal(m.cfg.dir, 'up')
    assert.equal(m.rot, rot)
  }
})

test('a down escalator keeps the same footprint, entered from the top', () => {
  for (let rot = 0; rot < 4; rot++) {
    const up = createModule('escalator', 3, 5, -5, 'u', rot, undefined, 'up')
    const down = createModule('escalator', 3, 5, -5, 'd', rot, undefined, 'down')
    assert.ok(up && down && up.type === 'escalator' && down.type === 'escalator')
    // A down run is entered at the storey above and lands on the dropped cell.
    assert.deepEqual(down.from, up.to)
    assert.deepEqual(down.to, up.from)
    assert.equal(down.cfg.dir, 'down')
    assert.deepEqual(moduleEnvelope(up), moduleEnvelope(down), 'direction must not move the run')
  }
})

test('two escalators may not share the same run', () => {
  const a = createModule('escalator', 0, 0, 0, 'a', 0, undefined, 'up')
  const b = createModule('escalator', 0, 0, 0, 'b', 0, undefined, 'down')
  // Side by side, as the reference station's two-bay ramp pairs: the balustrade
  // half-width means the next bay is two cells over, not the immediate one.
  const beside = createModule('escalator', 2, 0, 0, 'c', 0, undefined, 'up')
  assert.ok(a && b && beside)
  assert.equal(placementBlocked([a], b), true, 'the same footprint collides')
  assert.equal(placementBlocked([a], beside), false, 'the next bay over is free')
})

test('placing an escalator appends it and carves the slab it climbs through', () => {
  const state = toState({
    name: 't',
    seed: 1,
    cells: floor(0, 2, 0, 8, 0),
    modules: [],
    lines: [],
  })
  const mod = createModule('escalator', 1, 0, -5, 'esc-1', 0, undefined, 'up')
  assert.ok(mod)
  const next = addEquipment(state, mod)
  assert.equal(next.modules.length, 1)
  assert.ok(next.cells.length < state.cells.length, 'the slab over the run is opened')
})

test('the direction cycle flips up ↔ down', () => {
  assert.equal(nextEscalatorDir('up'), 'down')
  assert.equal(nextEscalatorDir('down'), 'up')
})

test('switching a selected escalator reverses travel and undo restores it', () => {
  const before = useStore.getState()
  try {
    const escalator = createModule('escalator', 2, 3, 0, 'selected-escalator', 1, undefined, 'up')
    assert.ok(escalator && escalator.type === 'escalator')
    const station = toState({ name: 'direction switch', seed: 1, cells: [], modules: [escalator], lines: [] })
    useStore.setState({ station, past: [], future: [], selected: { kind: 'module', key: escalator.id, label: '扶梯' } })

    useStore.getState().switchRunDirection(escalator.id)
    const reversed = useStore.getState().station.modules[0]
    assert.ok(reversed.type === 'escalator')
    assert.equal(reversed.cfg.dir, 'down', 'the sim-facing direction changes')
    assert.deepEqual(reversed.from, escalator.to, 'the new direction boards at the former exit')
    assert.deepEqual(reversed.to, escalator.from, 'the new direction exits at the former entrance')
    assert.equal(useStore.getState().past.length, 1, 'the direction change is one undoable edit')

    useStore.getState().undo()
    const restored = useStore.getState().station.modules[0]
    assert.ok(restored.type === 'escalator')
    assert.equal(restored.cfg.dir, 'up')
    assert.deepEqual(restored.from, escalator.from)
    assert.deepEqual(restored.to, escalator.to)
  } finally {
    useStore.setState(before)
  }
})

test('a 双层 escalator climbs two floors and the tool builds the family its span selected', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'double', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    useStore.setState({ station, escalatorSpan: 'double', doubleRampLength: 'long', escalatorDir: 'up', moduleRot: 0, escalatorWidth: 1 })
    const two = tool.buildPlacementModules('escalator', [3, 5, 0], 'double')[0]
    assert.equal(two.to.z - two.from.z, 10, '长 spans two five-metre floors')
    assert.equal(Math.hypot(two.to.x - two.from.x, two.to.y - two.from.y), 18)
    assert.equal(two.cfg.dir, 'up')
    // The single-floor family is untouched while the span is 双层.
    useStore.setState({ escalatorSpan: 'single', rampLength: 'short' })
    const one = tool.buildPlacementModules('escalator', [3, 5, 0], 'single')[0]
    assert.equal(one.to.z - one.from.z, 3)
    assert.equal(escalatorSpanOf(one), 'single')
    // Toggling the span is one Tab tile and redraws the ghost.
    useStore.setState({ escalatorSpan: 'single' })
    const key = moduleGhostKey(tool.buildPlacementModules('escalator', [3, 5, 0], 'k')[0])
    useStore.setState({ escalatorSpan: 'double' })
    assert.notEqual(moduleGhostKey(tool.buildPlacementModules('escalator', [3, 5, 0], 'k')[0]), key)
  } finally {
    useStore.setState(before)
  }
})

test('the tool builds every span at all three plan widths', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'span widths', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    for (const span of ['single', 'double', 'triple']) for (const width of [1, 2, 3]) {
      useStore.setState({ station, escalatorSpan: span, escalatorWidth: width, escalatorDir: 'up', moduleRot: 0, rampLength: 'long', doubleRampLength: 'long', tripleRampLength: 'long' })
      const m = tool.buildPlacementModules('escalator', [3, 5, 0], `${span}-${width}`)[0]
      assert.equal(m.cfg.width ?? 1, width, `${span} width ${width} reaches the piece`)
      assert.equal(escalatorSpanOf(m), span, `${span} width ${width} keeps its span`)
      assert.equal(moduleEnvelope(m).x1 - moduleEnvelope(m).x0, width, `${span} width ${width} reserves its plan`)
    }
  } finally {
    useStore.setState(before)
  }
})

test('the width tile cycles all three plan widths on a multi-storey piece', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ escalatorSpan: 'double', escalatorWidth: 1 })
    for (const expected of [2, 3, 1]) {
      useStore.getState().cycleEscalatorWidth()
      assert.equal(useStore.getState().escalatorWidth, expected)
      assert.equal(useStore.getState().escalatorSpan, 'double', 'the width cycle never changes the span')
    }
  } finally {
    useStore.setState(before)
  }
})

test('the demo pre-places the equipment escalator, exact same dimensions', () => {
  const ramps = scenarioStation().modules.filter((m) => m.type === 'escalator')
  assert.ok(ramps.length > 0, 'the demo has no escalators')
  for (const m of ramps) {
    // The pre-placed run is byte-for-byte the piece the 扶梯 button builds.
    const rebuilt = escalatorModule({ x: m.x, y: m.y, z: m.z }, m.rot ?? 0, m.cfg.dir, m.id)
    assert.deepEqual(m, rebuilt, `${m.id} is not the equipment piece`)
    const run = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y)
    assert.equal(run, ESCALATOR_RUN, `${m.id} run is not the equipment's ${ESCALATOR_RUN}`)
    assert.equal(Math.abs(m.to.z - m.from.z), ESCALATOR_RISE, `${m.id} does not climb one storey`)
  }
})
