import test from 'node:test'
import assert from 'node:assert/strict'
import { RoofTool } from '../src/app/tools/RoofTool.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'
import { MODULE_OPTIONS, useStore } from '../src/app/store.ts'
import { toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'

function harness(cells = [], moduleType = 'roof') {
  const state = { ...toState(emptyStation()), cells }
  useStore.setState({ station: state, past: [], future: [], moduleType, moduleRot: 0, roofWidth: 4, stairBlockHeight: 1, tool: 'module' })
  let ghost = []
  const drag = { current: null }
  const scene = { setModulePreview: (mods) => { ghost = mods ?? [] }, setGhost() {}, setCollisionHighlight() {}, setCursor() {} }
  const ctx = { scene: () => scene, pickModule: () => null, drag, hover: { current: null }, showMeasure() {}, clearMeasure() {} }
  const tool = new RoofTool(ctx)
  const event = (x, y, button = 0) => ({ clientX: x * 20, clientY: y * 20, button, buttons: button === 2 ? 2 : 1, shiftKey: false, hit: { cell: [x, y, 0], place: [x, y, 1], solid: true }, preventDefault() {} })
  return { tool, event, drag, state, ghost: () => ghost }
}

test('Tab switches stair block height and refreshes a held rectangle before release', () => {
  const h = harness([], 'stair-block')
  const width = useStore.getState().stairWidth
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(1, 1))
  assert.ok(h.ghost().every((m) => m.cfg.blockHeight === 1))
  useStore.getState().cycleStairWidth()
  assert.equal(useStore.getState().stairBlockHeight, 0.5)
  assert.equal(useStore.getState().stairWidth, width, 'height has its own setting')
  h.tool.refreshHover()
  assert.equal(h.ghost().length, 4)
  assert.ok(h.ghost().every((m) => m.cfg.blockHeight === 0.5))
  h.tool.onUp(h.event(1, 1))
  assert.ok(useStore.getState().station.modules.every((m) => m.cfg.blockHeight === 0.5))
  useStore.getState().cycleStairWidth()
  assert.equal(useStore.getState().stairBlockHeight, 1)
})

test('small stair blocks drag as a rectangle, rotate, undo and remove without disturbing floors', () => {
  const h = harness([], 'stair-block')
  useStore.setState({ moduleRot: 1 })
  h.tool.onDown(h.event(0, 0))
  assert.equal(h.ghost().length, 1)
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(2, 1))
  assert.equal(h.ghost().length, 6)
  h.tool.onUp(h.event(2, 1))
  const st = useStore.getState()
  assert.equal(st.station.modules.length, 6)
  assert.ok(st.station.modules.every((m) => m.type === 'stair' && m.cfg.block && m.rot === 1))
  assert.equal(st.past.length, 1)
  assert.equal(st.station.cells, h.state.cells)
  st.undo()
  assert.equal(useStore.getState().station.modules.length, 0)
  useStore.getState().redo()
  h.tool.onDown(h.event(0, 0, 2))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onUp(h.event(2, 1, 2))
  assert.equal(useStore.getState().station.modules.length, 0)
  assert.deepEqual(useStore.getState().station.cells, h.state.cells)
})

test('a roof click lays one tile, and a drag lays the preview rectangle in one undo step', () => {
  const h = harness()
  h.tool.onDown(h.event(0, 0))
  assert.equal(useStore.getState().station.modules.length, 0, 'placement waits for release')
  assert.equal(h.ghost().length, 1)
  h.tool.onUp(h.event(0, 0))
  assert.equal(useStore.getState().station.modules.length, 1)
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(2, 1))
  assert.equal(h.ghost().length, 5, 'the held tile is skipped; five new tiles preview')
  h.tool.onUp(h.event(2, 1))
  const st = useStore.getState()
  assert.equal(st.station.modules.length, 6)
  assert.equal(new Set(st.station.modules.map((m) => m.id)).size, 6)
  assert.ok(st.station.modules.every((m) => m.w === 1 && m.d === 1))
  assert.equal(st.past.length, 2, 'one click plus one rectangular drag')
  st.undo()
  assert.equal(useStore.getState().station.modules.length, 1)
})

test('roof drag refuses obstructed tiles and right-drag removes only roofs', () => {
  const cells = [{ x: 1, y: 0, z: 5, fill: 'solid' }]
  const h = harness(cells)
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(2, 0))
  h.tool.onUp(h.event(2, 0))
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [0, 2])
  assert.equal(useStore.getState().station.cells, cells)
  h.tool.onDown(h.event(0, 0, 2))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onUp(h.event(2, 0, 2))
  assert.equal(useStore.getState().station.modules.length, 0)
  assert.equal(useStore.getState().station.cells, cells)
})

test('truss roof drag lays full bays and a click inside a bay removes the whole roof', () => {
  const h = harness([], 'roof-truss')
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(5, 0))
  assert.deepEqual(h.ghost().map((m) => m.x), [0, 4])
  h.tool.onUp(h.event(5, 0))
  assert.deepEqual(useStore.getState().station.modules.map((m) => [m.x, m.w, m.cfg.variant]), [[0, 4, 'truss'], [4, 4, 'truss']])
  h.tool.onDown(h.event(2, 2, 2))
  h.tool.onUp(h.event(2, 2, 2))
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [4])
})

test('the medium truss tiles by its rotated 8×4 m footprint', () => {
  const h = harness([], 'roof-truss')
  useStore.setState({ moduleRot: 1, roofWidth: 8 })
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(8, 4))
  assert.deepEqual(h.ghost().map((m) => [m.x, m.y]), [[0, 0], [0, 4], [8, 0], [8, 4]])
  h.tool.onUp(h.event(8, 4))
  assert.equal(useStore.getState().station.modules.length, 4)
  assert.ok(useStore.getState().station.modules.every((m) => m.w === 4 && m.d === 8 && m.rot === 1))
  h.tool.onDown(h.event(-3, 2, 2))
  h.tool.onUp(h.event(-3, 2, 2))
  assert.equal(useStore.getState().station.modules.length, 3, 'a click anywhere in the rotated footprint removes that bay')
})

test('Tab width setting cycles the one truss tile through 窄, 中 and 宽 in the hover', () => {
  assert.deepEqual(MODULE_OPTIONS.filter((m) => m.type === 'roof').map((m) => m.id), ['roof', 'roof-truss', 'roof-tapered'])
  const h = harness([], 'roof-tapered')
  h.tool.onMove(h.event(0, 0))
  assert.equal(h.ghost()[0].d, 4)
  for (const width of [8, 12, 4]) {
    useStore.getState().cycleRoofWidth()
    h.tool.refreshHover()
    assert.equal(useStore.getState().roofWidth, width)
    assert.equal(h.ghost()[0].d, width)
  }
})
