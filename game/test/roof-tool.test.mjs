import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
  useStore.setState({ station: state, past: [], future: [], moduleType, moduleRot: 0, roofWidth: 4, roofPlateSnap: 'upper', stairBlockHeight: 1, activeZ: 0, tool: 'module' })
  let ghost = [], blocked = false, colliders = null, picks = 0, pickedId = null
  const drag = { current: null }
  const scene = { setModulePreview: (mods, refused) => { ghost = mods ?? []; blocked = refused }, setGhost() {}, setCollisionHighlight(ids) { colliders = ids }, setCursor() {} }
  const ctx = { scene: () => scene, pickModule: () => { picks++; return pickedId }, drag, hover: { current: null }, showMeasure() {}, clearMeasure() {} }
  const tool = new RoofTool(ctx)
  const event = (x, y, button = 0) => ({ clientX: x * 20, clientY: y * 20, button, buttons: button === 2 ? 2 : 1, shiftKey: false, hit: { cell: [x, y, 0], place: [x, y, 1], solid: true }, preventDefault() {} })
  return { tool, event, drag, state, ghost: () => ghost, blocked: () => blocked, colliders: () => colliders, picks: () => picks, pick: id => { pickedId = id } }
}

test('stair-block mouse-down raycasts once with many modules, including misses and late hits', () => {
  const modules = Array.from({ length: 1333 }, (_, index) => createModule('bench', index, 0, 0, `bench-${index}`))
  modules.push(createModule('stair-block', 8, 9, 0, 'last-stair'))
  for (const pickedId of [null, 'last-stair']) {
    const h = harness([], 'stair-block')
    useStore.setState({ station: { ...h.state, modules } })
    h.pick(pickedId)
    h.tool.onDown(h.event(0, 0))
    assert.equal(h.picks(), 1, 'one pointer press must not repeat a scene raycast for every document module')
    assert.deepEqual(h.drag.current.anchor, pickedId ? [8, 9, 0] : [0, 0, 0])
  }
})

test('stair-block dragging defers placement checks until release and commits only valid tiles', () => {
  const cells = [{ x: 0, y: 1, z: 1, fill: 'solid' }]
  const h = harness(cells, 'stair-block')
  const unreadable = new Proxy(cells, { get() { throw new Error('preview must not inspect station cells for placement validation') } })
  useStore.setState({ station: { ...h.state, cells: unreadable } })
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(0, 2))
  h.tool.refreshHover()
  assert.equal(h.ghost().length, 3, 'the drag draws every proposed stair block')
  assert.equal(h.blocked(), false, 'the visual-only preview makes no placement verdict')
  assert.equal(h.colliders(), null)
  assert.equal(useStore.getState().past.length, 0, 'preview never commits a document or rebuilds routing')
  useStore.setState({ station: h.state })
  h.tool.onUp(h.event(0, 2))
  const placed = useStore.getState()
  assert.deepEqual(placed.station.modules.map(module => [module.x, module.y]), [[0, 0], [0, 2]], 'release refuses the tile covered by a solid block')
  assert.equal(placed.past.length, 1, 'release commits the accepted run once')
})

test('Tab switches stair block height and refreshes a held run before release', () => {
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
  assert.equal(h.ghost().length, 2)
  assert.ok(h.ghost().every((m) => m.cfg.blockHeight === 0.5))
  h.tool.onUp(h.event(1, 1))
  assert.ok(useStore.getState().station.modules.every((m) => m.cfg.blockHeight === 0.5))
  useStore.getState().cycleStairWidth()
  assert.equal(useStore.getState().stairBlockHeight, 1)
})

test('small stair blocks drag along their rotated width axis, undo and remove without disturbing floors', () => {
  const h = harness([], 'stair-block')
  useStore.setState({ moduleRot: 1 })
  h.tool.onDown(h.event(0, 0))
  assert.equal(h.ghost().length, 1)
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(2, 1))
  assert.equal(h.ghost().length, 3, 'the lateral y movement is ignored for an east-west stair width')
  assert.deepEqual(h.ghost().map(({ x, y }) => [x, y]), [[0, 0], [1, 0], [2, 0]])
  h.tool.onUp(h.event(2, 1))
  const st = useStore.getState()
  assert.equal(st.station.modules.length, 3)
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

test('small stair block drag axis follows the rotated stair width while roofs remain rectangular', () => {
  for (const [rot, target, expected] of [
    [0, [2, 1], [[0, 0], [0, 1]]],
    [1, [2, 1], [[0, 0], [1, 0], [2, 0]]],
    [2, [-2, 1], [[0, 0], [0, 1]]],
    [3, [2, -1], [[0, 0], [1, 0], [2, 0]]],
  ]) {
    const h = harness([], 'stair-block')
    useStore.setState({ moduleRot: rot })
    h.tool.onDown(h.event(0, 0))
    h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
    h.tool.onMove(h.event(...target))
    assert.deepEqual(h.ghost().map(({ x, y }) => [x, y]), expected, `rotation ${rot} preview follows only its run axis`)
    h.tool.onUp(h.event(...target))
    assert.deepEqual(useStore.getState().station.modules.map(({ x, y }) => [x, y]), expected,
      `rotation ${rot} release matches its straight preview`)
  }
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

test('thin roof snaps use the block side, existing roof height, and selected half consistently', () => {
  const h = harness()
  useStore.getState().cycleRoofPlateSnap()
  assert.equal(useStore.getState().roofPlateSnap, 'lower')

  const blockHit = { ...h.event(2, 3), hit: { cell: [2, 3, 4], place: [2, 3, 5], solid: true } }
  h.tool.onMove(blockHit)
  assert.deepEqual([h.ghost()[0].x, h.ghost()[0].y, h.ghost()[0].z], [2, 3, 5], 'a block hit places on its outside face')
  assert.equal(h.ghost()[0].cfg.plateSnap, 'lower')
  h.tool.onDown(blockHit)
  h.tool.onUp(blockHit)
  assert.deepEqual([useStore.getState().station.modules[0].z, useStore.getState().station.modules[0].cfg.plateSnap], [5, 'lower'], 'release matches the preview')

  useStore.getState().cycleRoofPlateSnap()
  const roofHit = { ...h.event(7, 8), hit: { cell: [7, 8, 2], place: [7, 8, 9], solid: true, roofSnap: 'lower' } }
  h.tool.onMove(roofHit)
  assert.deepEqual([h.ghost()[0].z, h.ghost()[0].cfg.plateSnap], [2, 'lower'], 'an existing roof supplies the snapped height and half with priority')
  h.tool.onDown(roofHit)
  h.tool.onUp(roofHit)
  const placed = useStore.getState().station.modules.at(-1)
  assert.deepEqual([placed.z, placed.cfg.plateSnap], [2, 'lower'], 'release preserves the existing roof snap')
})

test('Tab and the action tile expose the upper/lower thin-roof snap with the requested icons', () => {
  const shell = fs.readFileSync(new URL('../src/app/windows/AppShell.tsx', import.meta.url), 'utf8')
  const actions = fs.readFileSync(new URL('../src/app/rail/actions/ActionRow.tsx', import.meta.url), 'utf8')
  const attributes = fs.readFileSync(new URL('../src/app/store/builderAttributes.ts', import.meta.url), 'utf8')
  const viewport = fs.readFileSync(new URL('../src/app/Viewport.tsx', import.meta.url), 'utf8')
  assert.match(shell, /activateModuleBuilderShortcut\(st\.moduleType, st, e\.shiftKey \? 'Shift\+Tab' : 'Tab'\)/)
  assert.match(actions, /import \{ LuArrowUpToLine \} from 'react-icons\/lu'/)
  assert.match(actions, /import \{ LuArrowDownToLine \} from 'react-icons\/lu'/)
  assert.match(actions, /attribute\.visual === 'roof-snap' \? \(state\.roofPlateSnap === 'lower' \? <LuArrowDownToLine \/> : <LuArrowUpToLine \/>\)/)
  assert.match(attributes, /s\.cycleRoofPlateSnap/)
  assert.match(attributes, /s\.roofPlateSnap === 'lower' \? 'roof_snap_lower' : 'roof_snap_upper'/)
  assert.match(viewport, /const slab = directRoof \?\? scene\.pickRoofModuleNear\(clientX, clientY, roofIds\)/)
  assert.match(viewport, /return scene\.pick\(clientX, clientY, st\.activeZ\)/, 'open-area placement falls back to the active view height')
  assert.equal(useStore.getState().roofPlateSnap, 'upper', 'the action cycles back to upper')
  useStore.getState().cycleRoofPlateSnap()
  assert.equal(useStore.getState().roofPlateSnap, 'lower')
  useStore.getState().cycleRoofPlateSnap()
  assert.equal(useStore.getState().roofPlateSnap, 'upper')
})

test('roof drag refuses obstructed tiles and right-drag removes only roofs', () => {
  const cells = [{ x: 1, y: 0, z: 1, fill: 'solid' }]
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

for (const type of ['sidewalk', 'lawn']) test(`${type} drags rectangles immediately, commits once, undoes and erases its own tiles`, () => {
  const h = harness([], type)
  h.tool.onDown(h.event(0, 0))
  h.tool.onMove(h.event(2, 1))
  assert.equal(h.ghost().length, 6)
  assert.equal(useStore.getState().past.length, 0)
  h.tool.onUp(h.event(2, 1))
  assert.equal(useStore.getState().station.modules.length, 6)
  assert.equal(useStore.getState().past.length, 1)
  assert.ok(useStore.getState().station.modules.every(m => m.type === type && m.z === 0))
  useStore.getState().undo()
  assert.equal(useStore.getState().station.modules.length, 0)
  useStore.getState().redo()
  h.tool.onDown(h.event(0, 0, 2))
  h.tool.onUp(h.event(2, 1, 2))
  assert.equal(useStore.getState().station.modules.length, 0)
})

test('outdoor finishes follow the picked supporting floor above the active work plane', () => {
  const h = harness([{ x: 0, y: 0, z: 4, fill: 'solid' }], 'sidewalk')
  const event = { ...h.event(0, 0), hit: { cell: [0, 0, 4], place: [0, 0, 5], solid: true } }
  h.tool.onMove(event)
  assert.equal(h.ghost()[0].z, 4)
  h.tool.onDown(event)
  assert.equal(h.ghost()[0].z, 4)
  h.tool.onUp(event)
  assert.equal(useStore.getState().station.modules[0].z, 4)
})
