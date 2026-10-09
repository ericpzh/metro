import test from 'node:test'
import assert from 'node:assert/strict'
import { RoofTool } from '../src/app/tools/RoofTool.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'
import { MODULE_OPTIONS, useStore } from '../src/app/store.ts'
import { createModule } from '../src/build/model.ts'
import { supportedRoofWidth } from '../src/sim/structures.ts'
import { toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import * as THREE from 'three'
import { cameraRig } from './support/camera-rig.mjs'
import { RoofModel } from '../src/render/models/pieces/RoofModel.ts'

function harness(cells = [], moduleType = 'roof') {
  const state = { ...toState(emptyStation()), cells }
  useStore.setState({ station: state, past: [], future: [], moduleType, moduleRot: 0, roofWidth: 4, stairBlockHeight: 1, activeZ: 0, tool: 'module' })
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
  assert.deepEqual(h.ghost().map((m) => m.x), [-2, 2])
  h.tool.onUp(h.event(5, 0))
  assert.deepEqual(useStore.getState().station.modules.map((m) => [m.x, m.w, m.cfg.variant]), [[-2, 4, 'truss'], [2, 4, 'truss']])
  h.tool.onDown(h.event(1, 1, 2))
  h.tool.onUp(h.event(1, 1, 2))
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [2])
})

test('the medium truss runs a straight line along its rotated crest axis', () => {
  const h = harness([], 'roof-truss')
  useStore.setState({ moduleRot: 1, roofWidth: 8 })
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(8, 4))
  assert.deepEqual(h.ghost().map((m) => [m.x, m.y]), [[3, -2], [3, 2]], 'the sideways wander off the crest never staggers the run')
  h.tool.onUp(h.event(8, 4))
  assert.equal(useStore.getState().station.modules.length, 2)
  assert.ok(useStore.getState().station.modules.every((m) => m.w === 4 && m.d === 8 && m.rot === 1))
  h.tool.onDown(h.event(-3, 1, 2))
  h.tool.onUp(h.event(-3, 1, 2))
  assert.equal(useStore.getState().station.modules.length, 1, 'a click anywhere in the rotated footprint removes that bay')
})

test('a truss drag ignores the lateral extent and runs backwards too', () => {
  const h = harness([], 'roof-tapered')
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(8, 3))
  assert.deepEqual(h.ghost().map((m) => m.x), [-2, 2, 6])
  h.tool.onUp(h.event(8, 3))
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [-2, 2, 6])
  h.tool.onDown(h.event(8, 0, 2))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onUp(h.event(0, 0, 2))
  assert.equal(useStore.getState().station.modules.length, 0, 'a right-drag sweeps the same crest line back out')
})

test('roof previews and click placements centre on the pointer at every width and rotation', () => {
  const material = new THREE.MeshStandardMaterial()
  for (const type of ['roof', 'roof-truss', 'roof-tapered']) {
    for (const width of type === 'roof' ? [1] : [4, 8, 12]) {
      for (let rot = 0; rot < 4; rot++) {
        const h = harness([], type)
        useStore.setState({ moduleRot: rot, roofWidth: width })
        h.tool.onMove(h.event(10, -6))
        h.tool.refreshHover()
        const preview = h.ghost()[0]
        const model = new RoofModel({ finish: () => material, mats: { steel: material } }).build(preview)
        const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3())
        const offset = type === 'roof' ? 0.5 : 0
        assert.ok(Math.abs(centre.x - (10 + offset)) < 0.03, 'the roof footprint is centred horizontally at the pointer')
        assert.ok(Math.abs(centre.y - (-6 + offset)) < 0.03, 'rotation and width preserve the pointer centre')
        h.tool.onDown(h.event(10, -6))
        h.tool.onUp(h.event(10, -6))
        const placed = useStore.getState().station.modules[0]
        assert.deepEqual([placed.x, placed.y, placed.rot, placed.d], [preview.x, preview.y, preview.rot, preview.d], 'release uses the centred preview anchor')
      }
    }
  }
})

test('roof-height picking keeps the cursor on the roof in perspective and orthographic views', () => {
  const { cam } = cameraRig()
  try {
    for (const ortho of [false, true]) {
      cam.setOrtho(ortho)
      cam.activeCamera().updateMatrixWorld(true)
      for (const height of [5.25, 9]) {
        const hit = cam.pickHorizontalPlane(640, 410, height, 0)
        assert.ok(hit)
        assert.equal(hit.point[2], height)
        const screen = new THREE.Vector3(...hit.point).project(cam.activeCamera())
        assert.ok(Math.abs(screen.x) < 1e-6 && Math.abs(screen.y) < 1e-6, 'the roof-plane target projects back to the mouse')
        assert.equal(hit.cell[2], 0, 'roof height does not change the supporting storey')
      }
    }
  } finally { cam.dispose() }
})

test('Tab width setting cycles the truss tiles through 窄, 中 and 宽 in the hover', () => {
  assert.deepEqual(MODULE_OPTIONS.filter((m) => m.type === 'roof').map((m) => m.id), ['roof', 'roof-shell', 'roof-truss', 'roof-tapered'])
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

test('the shell roof is the truss bay without the truss', () => {
  // The palette id names the variant: a shell bay spans the same 4 m bay as a
  // truss one and takes the same 4/8/12 widths, but its piece carries no
  // purlins or trusses — two finished sheets only (`RoofModel`).
  const shell = createModule('roof-shell', 0, 0, 4, 'shell', 1, 8)
  assert.equal(shell.type, 'roof')
  assert.equal(shell.cfg.variant, 'shell')
  assert.equal(shell.w, 4, 'a shell bay is one 4 m bay')
  assert.equal(shell.d, 8, 'at the armed width')
  assert.equal(createModule('roof-shell', 0, 0, 4, 'shell5', 1, 5).d, supportedRoofWidth(5), 'an off-list width reads as the bay it fits')
  assert.equal(supportedRoofWidth(5), 4)
})
