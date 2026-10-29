import test from 'node:test'
import assert from 'node:assert/strict'
import { MultiPlaceDrag, multiPlaceFor } from '../src/app/tools/geometry/multiPlaceDrag.ts'
import { StablePreviewDelay } from '../src/app/tools/geometry/stablePreviewDelay.ts'
import { msg } from '../src/sim/i18n.ts'
import { useStore } from '../src/app/store.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { toState } from '../src/build/model.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { TileEquipmentTool } from '../src/app/tools/TileEquipmentTool.ts'
import { TactileTool } from '../src/app/tools/TactileTool.ts'
import { BlockTool } from '../src/app/tools/BlockTool.ts'
import { WallTool } from '../src/app/tools/WallTool.ts'
import { RoadTool } from '../src/app/tools/RoadTool.ts'

function fakeDelay() {
  const timers = new Map()
  const scheduledDelays = []
  let next = 0
  const delay = new StablePreviewDelay(undefined,
    (callback, ms) => { scheduledDelays.push(ms); const id = ++next; timers.set(id, () => { timers.delete(id); callback() }); return id },
    id => timers.delete(id))
  return { delay, timers, scheduledDelays }
}

test('all placement controllers on a context share one multi-place guard', () => {
  const context = {}
  assert.equal(multiPlaceFor(context), multiPlaceFor(context))
  assert.notEqual(multiPlaceFor(context), multiPlaceFor({}))
})

test('the shared drag limit accepts exactly 10,000 cells and refuses the next cell', () => {
  const { delay } = fakeDelay()
  const guard = new MultiPlaceDrag(10_000, delay)
  useStore.getState().setNotice(null)
  assert.equal(guard.check(10_000), false)
  assert.equal(useStore.getState().notice, null)
  assert.equal(guard.check(10_001), true)
  assert.equal(useStore.getState().notice, msg('drag_area_too_large', 10_000))
  assert.equal(guard.check(1), false)
  assert.equal(useStore.getState().notice, null)
})

test('shared previews replace targets, wait at most 50 ms, and cancellation drops stale work', () => {
  const { delay, timers, scheduledDelays } = fakeDelay()
  const guard = new MultiPlaceDrag(10_000, delay)
  const clears = []
  const scene = {
    setGhost: (...args) => clears.push(['ghost', ...args]),
    setModulePreview: (...args) => clears.push(['module', ...args]),
    setFencePreview: (...args) => clears.push(['fence', ...args]),
    setCollisionHighlight: (...args) => clears.push(['collision', ...args]),
  }
  const draws = []
  assert.equal(guard.deferPreview(scene, 'a', () => draws.push('stale')), true)
  assert.equal(timers.size, 1)
  assert.equal(scheduledDelays[0], 50)
  assert.deepEqual(draws, [])
  assert.equal(guard.deferPreview(scene, 'b', () => draws.push('latest')), true)
  assert.equal(timers.size, 1, 'changing targets does not restart the pending timer')
  for (const run of timers.values()) run()
  assert.deepEqual(draws, ['latest'])
  assert.deepEqual(clears, [], 'accepted previews remain visible until replaced')
  assert.deepEqual(scheduledDelays, [50], 'continuous target changes do not postpone the first update')
  guard.deferRefusal(scene, 'c', () => draws.push('cancelled'))
  assert.deepEqual(clears.map(([kind]) => kind), ['ghost', 'module', 'fence', 'collision'], 'oversized footprints clear all accepted layers immediately')
  guard.cancelPreview()
  assert.equal(timers.size, 0)
  assert.deepEqual(draws, ['latest'])
})

test('an unchanged rendered target is reused until cancellation', () => {
  const { delay, timers } = fakeDelay()
  const calls = []
  delay.scheduleLatest('same', () => calls.push(1))
  for (const run of timers.values()) run()
  assert.equal(delay.scheduleLatest('same', () => calls.push('duplicate')), false)
  assert.equal(timers.size, 0)
  delay.clear()
  assert.equal(delay.scheduleLatest('same', () => calls.push(2)), true)
  assert.equal(timers.size, 1)
  for (const run of timers.values()) run()
  assert.deepEqual(calls, [1, 2])
})

function placementHarness(moduleType, toolName) {
  const station = toState(emptyStation())
  useStore.setState({ station, past: [], future: [], tool: toolName, moduleType, moduleRot: 0,
    roadWidth: 6, roadDirection: 'two-way', activeZ: 0, autoWalls: false, suspendedCeiling: false })
  const drag = { current: null }, hover = { current: null }
  const scene = {
    setGhost() {}, setModulePreview() {}, setFencePreview() {}, setCollisionHighlight() {},
    setCursor() {}, setRoadNodePreview() {},
  }
  const context = { scene: () => scene, pick: () => null, pickModule: () => null, facing: () => undefined,
    solids: () => new Set(), floors: () => new Set(), thins: () => new Map(), hover, drag,
    paint: { current: null }, zoneDrag: { current: null }, showMeasure() {}, clearMeasure() {} }
  const event = (x, y = 0, button = 0, solid = true) => ({ clientX: x * 20, clientY: y * 20,
    button, buttons: button === 2 ? 2 : 1, shiftKey: false, preventDefault() {},
    hit: { cell: [x, y, 0], place: [x, y, 1], solid, point: [x, y] } })
  return { context, drag, event, scene, station }
}

test('equipment and decor multi-place releases refuse oversized footprints whole', () => {
  const cases = [
    ['fence panels', 'fence', 'module', EquipmentTool, [0, 0], [10_000, 0]],
    ['tactile paving', 'tactile-guide', 'module', TactileTool, [0, 0], [10_000, 0]],
    ['outdoor surface tiles', 'sidewalk', 'module', TileEquipmentTool, [0, 0], [100, 100]],
    ['wall courses', 'wall', 'wall', WallTool, [0, 0], [2_500, 0]],
    ['road footprint', 'road', 'module', RoadTool, [0, 0], [1_666, 0]],
  ]
  for (const [label, type, toolName, Tool, anchor, target] of cases) {
    const h = placementHarness(type, toolName)
    const refused = []
    h.scene.setGhost = (...args) => { if (args[4]?.length) refused.push(args[4]) }
    const tool = new Tool(h.context)
    tool.onDown(h.event(...anchor))
    h.drag.current.downTime = -1000
    tool.onMove(h.event(...target))
    tool.multiPlace.flushPreview()
    assert.ok(refused.at(-1)?.length > 10_000, label + ' draws the entire refused footprint before release')
    tool.onUp(h.event(...target))
    const after = useStore.getState()
    assert.equal(after.station, h.station, `${label} over the shared limit must not commit any partial placement`)
    assert.equal(after.past.length, 0, `${label} refusal must not add an undo entry`)
    assert.equal(after.notice, msg('drag_area_too_large', 10_000), `${label} shares the same limit notice`)
  }
})


test('all deferred placement drags keep one 50 ms update during continuous movement and cancel on release', () => {
  for (const [type, toolName, Tool] of [
    ['block', 'block', BlockTool], ['wall', 'wall', WallTool], ['fence', 'module', EquipmentTool],
    ['tactile-guide', 'module', TactileTool], ['stair-block', 'module', TileEquipmentTool],
    ['sidewalk', 'module', TileEquipmentTool], ['lawn', 'module', TileEquipmentTool], ['road', 'module', RoadTool],
  ]) {
    const h = placementHarness(type, toolName)
    const fake = fakeDelay()
    const guard = multiPlaceFor(h.context)
    guard.delay = fake.delay
    const draws = []
    for (const method of ['setGhost', 'setModulePreview', 'setFencePreview']) h.scene[method] = (...args) => draws.push([method, ...args])
    const tool = new Tool(h.context)
    tool.onDown(h.event(0))
    h.drag.current.downTime = -1000
    const before = draws.length
    for (let x = 10; x <= 20; x++) tool.onMove(h.event(x, x))
    assert.equal(fake.timers.size, 1, type + ' keeps one pending preview')
    assert.deepEqual(fake.scheduledDelays, [50], type + ' never postpones its timer as the target changes')
    assert.equal(draws.length, before, type + ' retains its last preview while waiting')
    for (const run of fake.timers.values()) run()
    assert.ok(draws.length > before, type + ' renders before movement needs to stop')
    assert.equal(useStore.getState().station, h.station, type + ' preview does not commit')
    const rendered = draws.length
    tool.onMove(h.event(20, 20))
    assert.equal(fake.timers.size, 0, type + ' reuses the rendered snapped target')
    assert.equal(draws.length, rendered)
    tool.onMove(h.event(21, 21))
    assert.equal(fake.timers.size, 1)
    tool.onUp(h.event(21, 21))
    assert.equal(fake.timers.size, 0, type + ' release cancels pending preview work')
  }
})


test('geometry edits invalidate a rendered target even when stationEpoch and the pointer key stay unchanged', () => {
  const {delay,timers} = fakeDelay(), guard = new MultiPlaceDrag(10000,delay), draws = []
  const original = useStore.getState().station, epoch = useStore.getState().stationEpoch
  for(const policy of ['schedule','scheduleFrame']) {
    guard.cancelPreview()
    guard[policy]('same-cell',()=>draws.push('first'))
    guard.flushPreview()
    assert.equal(guard[policy]('same-cell',()=>draws.push('duplicate')),false)
    for(const field of ['cells','modules']) {
      const station = useStore.getState().station
      useStore.setState({station:{...station,[field]:[...station[field]]}})
      assert.equal(useStore.getState().stationEpoch,epoch)
      assert.equal(guard[policy]('same-cell',()=>draws.push(field)),true,policy+' resets on '+field+' identity')
      guard.flushPreview()
      assert.equal(draws.at(-1),field)
    }
  }
  assert.ok(!draws.includes('duplicate'))
  assert.equal(timers.size,0)
  guard.cancelPreview()
  useStore.setState({station:original})
})
