import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, addEquipment, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { equipmentReason, moduleEnvelope, moduleFootprint, placementBlocked } from '../src/sim/placement.ts'
import { buildGraph } from '../src/sim/station.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { drawFloorMark } from '../src/render/floorMarkArt.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'
import { useStore, placementPreviewKey } from '../src/app/store.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { floorDecorBounds, floorMarkLine, snapBoardingMark, tactileArms } from '../src/sim/floorDecor.ts'
import { doorRunOffsets } from '../src/sim/stock.ts'
import { rotateLocal } from '../src/sim/track.ts'
import * as THREE from 'three'
import { buildModule } from '../src/render/models.ts'
import { AcUnitModel } from '../src/render/models/pieces/AcUnitModel.ts'
import { ElectricalCabinetModel } from '../src/render/models/pieces/ElectricalCabinetModel.ts'
import { TactileModel } from '../src/render/models/pieces/TactileModel.ts'
import { FloorMarkModel } from '../src/render/models/pieces/FloorMarkModel.ts'

const ids = ['ac-unit', 'electrical-cabinet', 'tactile-guide', 'tactile-warning', 'floor-mark-boarding', 'floor-mark-waiting', 'floor-mark-direction']

test('floor decorations preserve variants and rotation through save/load', () => {
  let state = toState(emptyStation())
  for (const [i, id] of ids.entries()) state = addEquipment(state, createModule(id, i * 6, 0, 0, id, 1))
  const loaded = parse(serialize(state))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.modules, state.modules)
  assert.equal(moduleGhostKey(createModule('tactile-guide', 0, 0, 0, 'a')), moduleGhostKey(createModule('tactile-guide', 0, 0, 0, 'b')))
  assert.notEqual(moduleGhostKey(createModule('tactile-guide', 0, 0, 0, 'a')), moduleGhostKey(createModule('tactile-warning', 0, 0, 0, 'a')))
  assert.notEqual(moduleGhostKey(createModule('floor-mark-boarding', 0, 0, 0, 'a')), moduleGhostKey(createModule('floor-mark-waiting', 0, 0, 0, 'a')))
})

test('industrial equipment reserves its whole rotated footprint and requires floor everywhere', () => {
  for (const rot of [0, 1, 2, 3]) {
    const unit = createModule('ac-unit', 4, 4, -4, 'ac', rot)
    const footprint = moduleFootprint(unit)
    assert.equal(footprint.length, 6, 'industrial chiller occupies 3 × 2 m')
    const cells = footprint.map(([x, y]) => ({ x, y, z: -4, fill: 'solid' }))
    assert.equal(equipmentReason(cells, [], unit), '')
    assert.equal(equipmentReason(cells.slice(1), [], unit), 'floor')
    const [x, y] = footprint[1]
    assert.equal(equipmentReason([...cells, { x, y, z: -3, fill: 'solid' }], [], unit), 'occupied', 'cannot bury the chiller in a wall')
    assert.ok(Math.abs(moduleEnvelope(unit).z1 + 0.3) < 1e-9)
  }
  assert.equal(moduleFootprint(createModule('electrical-cabinet', 0, 0, 0, 'cabinet')).length, 3)
})

test('tactile paving and floor vinyl keep pedestrians walking; machinery removes its footprint', () => {
  const data = emptyStation()
  const plain = buildGraph(data)
  for (const id of ids) {
    const mod = createModule(id, 0, 0, 0, id)
    const graph = buildGraph({ ...data, modules: [mod] })
    const at = (g, x, y) => g.nodeIndex.has(`${x},${y},0`)
    for (const [x, y] of moduleFootprint(mod)) {
      assert.equal(at(plain, x, y), true)
      assert.equal(at(graph, x, y), !['ac-unit', 'electrical-cabinet'].includes(id), `${id} at ${x},${y}`)
    }
  }
})

test('floor stickers accept a screen-door strip and reject holes and duplicate stickers', () => {
  const mark = createModule('floor-mark-boarding', 0, 0, 0, 'mark')
  const psd = { id: 'psd', type: 'platform-edge', x: 0, y: 0, z: 0, rot: 0, w: 3, cfg: { line: '5' } }
  assert.equal(equipmentReason([], [psd], mark), '')
  assert.equal(equipmentReason([{ x: 1, y: 0, z: 0, fill: 'void' }], [], mark), 'floor')
  assert.equal(equipmentReason([], [mark], { ...mark, id: 'other' }), 'occupied')
})

function harness(type = 'tactile-guide') {
  useStore.setState({ station: toState(emptyStation()), past: [], future: [], tool: 'module', moduleType: type, moduleRot: 0, selected: null })
  let ghost = []
  const drag = { current: null }
  const ctx = { scene: () => ({ setModulePreview: (mods) => { ghost = mods ?? [] }, setGhost() {}, setCollisionHighlight() {}, setCursor() {} }),
    drag, hover: { current: null }, pickModule: (x, y) => useStore.getState().station.modules.find((m) => m.x === x / 20 && m.y === y / 20)?.id ?? null }
  const event = (x, y, button = 0) => ({ clientX: x * 20, clientY: y * 20, button, buttons: button === 2 ? 2 : 1, hit: { cell: [x, y, 0], place: [x, y, 1], solid: true }, preventDefault() {} })
  return { tool: new EquipmentTool(ctx), deleteTool: new DeleteTool(ctx), drag, event, ghost: () => ghost }
}

test('tactile placement and right deletion drag straight runs in one undo step, keeping floors', () => {
  const h = harness()
  h.tool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(1, 4))
  assert.equal(h.ghost().length, 5)
  assert.ok(h.ghost().every((m) => m.rot === 1 && m.x === 0))
  h.tool.onUp(h.event(1, 4))
  assert.equal(useStore.getState().past.length, 1)
  assert.equal(useStore.getState().station.modules.length, 5)
  h.tool.onDown(h.event(0, 0, 2))
  // Erasure is draggable immediately, without the placement long-press delay.
  h.tool.onMove(h.event(0, 4, 2))
  assert.equal(h.ghost().length, 5)
  h.tool.onUp(h.event(0, 4, 2))
  assert.equal(useStore.getState().station.modules.length, 0)
  assert.equal(useStore.getState().past.length, 2)
  useStore.getState().undo()
  assert.equal(useStore.getState().station.modules.length, 5)
  assert.deepEqual(useStore.getState().station.cells, [])
})

test('delete tool drags only the pressed tactile variant and leaves the other tiles', () => {
  const h = harness('tactile-warning')
  const guide = createModule('tactile-guide', 1, 0, 0, 'guide')
  const warnings = [0, 2].map((x) => createModule('tactile-warning', x, 0, 0, `warning-${x}`))
  useStore.setState({ tool: 'delete', station: { ...useStore.getState().station, modules: [warnings[0], guide, warnings[1]] } })
  h.deleteTool.onMove(h.event(0, 0))
  assert.equal(h.drag.current, null, 'hover previews a tile without starting deletion')
  h.deleteTool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.deleteTool.onMove(h.event(2, 0))
  assert.equal(h.ghost().length, 2)
  h.deleteTool.onUp(h.event(2, 0))
  assert.deepEqual(useStore.getState().station.modules, [guide])
  assert.deepEqual(useStore.getState().station.cells, [])
})

test('a floor marking right-click removes only the ink beside a screen door', () => {
  const h = harness('floor-mark-boarding')
  const mark = createModule('floor-mark-boarding', 0, 0, 0, 'mark')
  const psd = { id: 'psd', type: 'platform-edge', x: 0, y: 0, z: 0, rot: 0, w: 3, cfg: { line: '5' } }
  useStore.setState({ station: { ...useStore.getState().station, modules: [mark, psd] } })
  h.tool.onDown(h.event(0, 0, 2))
  assert.deepEqual(useStore.getState().station.modules, [psd])
  assert.deepEqual(useStore.getState().station.cells, [])
})

test('floor marking ink distinguishes boarding arrows, queue footprints and direction labels', () => {
  for (const variant of ['boarding', 'waiting', 'direction']) {
    const { g, ops } = stubCanvas(768, 512)
    drawFloorMark(g, variant)
    assert.ok(ops.fills >= 2, `${variant} prints visible ink`)
    if (variant === 'waiting') { assert.equal(ops.ellipses.length, 8); assert.ok(ops.texts.includes('下车区')) }
    if (variant === 'direction') assert.ok(ops.texts.includes('5号线'))
  }
})

test('warning tiles connect perpendicular ribs, T joins and crosses without corner gaps', () => {
  const dot = createModule('tactile-warning', 0, 0, 0, 'dot')
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]].map(([x, y, rot], i) => createModule('tactile-guide', x, y, 0, `guide-${i}`, rot))
  assert.deepEqual(tactileArms(dot, []), [])
  assert.equal(tactileArms(dot, [neighbors[0], neighbors[2]]).length, 2)
  assert.equal(tactileArms(dot, neighbors.slice(1)).length, 3)
  assert.equal(tactileArms(dot, neighbors).length, 4)
  assert.equal(tactileArms(dot, [{ ...neighbors[0], rot: 1 }]).length, 0, 'sideways ribs do not connect')
  const mats = { tactile: new THREE.MeshStandardMaterial() }
  for (const mod of [dot, neighbors[0], neighbors[2]]) {
    const model = new TactileModel({ mats, data: { modules: [dot, ...neighbors] } }).build(mod)
    const bounds = new THREE.Box3().setFromObject(model)
    if (mod === dot) {
      assert.ok(Math.abs(bounds.min.x) < 1e-6 && Math.abs(bounds.max.x - 1) < 1e-6)
      assert.ok(Math.abs(bounds.min.y) < 1e-6 && Math.abs(bounds.max.y - 1) < 1e-6, 'cross reaches the adjoining strips at all four cell edges')
    }
    model.traverse((o) => { o.geometry?.dispose(); if (o.isInstancedMesh) o.dispose() })
  }
  mats.tactile.dispose()
})

test('boarding strip snaps to the real train-aligned opening in every rotation and side', () => {
  const line = { id: '5', name: '5号线', colour: '#c8102e', stock: 'B', cars: 1 }
  for (const rot of [0, 1, 2, 3]) for (const side of ['left', 'right']) {
    const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 20, cfg: { line: '5', side } }
    const opening = doorRunOffsets(line, 20)[1] - 0.5
    const [dx, dy] = rotateLocal(rot, opening, side === 'right' ? 0.09 : -0.09)
    const pointer = createModule('floor-mark-boarding', Math.floor(0.5 + dx), Math.floor(0.5 + dy), 0, 'mark')
    const snapped = snapBoardingMark(pointer, [edge], [line])
    assert.equal(snapped.cfg.edgeId, 'edge')
    const box = floorDecorBounds(snapped)
    assert.ok(Math.abs((box.x0 + box.x1) / 2 - (0.5 + dx)) < 1e-8)
    assert.ok(Math.abs((box.y0 + box.y1) / 2 - (0.5 + dy)) < 1e-8)
    assert.ok(Math.abs(Math.min(box.x1 - box.x0, box.y1 - box.y0) - 0.25) < 1e-8)
    assert.deepEqual(snapBoardingMark({ ...pointer, z: -4 }, [edge], [line]).cfg, pointer.cfg, 'does not snap across storeys')
  }
})

test('direction stickers resolve the saved line live, including renamed and recolored lines', () => {
  const mod = { ...createModule('floor-mark-direction', 0, 0, 0, 'direction'), cfg: { variant: 'direction', line: '8' } }
  const line = { id: '8', name: '8号线', colour: '#008c95' }
  assert.equal(floorMarkLine(createModule('floor-mark-direction', 0, 0, 0, 'sample'), [line]).name, '5号线', 'unbound palette preview uses the requested default')
  const ink = stubCanvas()
  drawFloorMark(ink.g, 'direction', floorMarkLine(mod, [line]))
  assert.ok(ink.ops.texts.includes('8号线'))
  assert.ok(ink.ops.filled.includes('#008c95'))
  assert.equal(floorMarkLine(mod, [{ ...line, name: '环线' }]).name, '环线')
  const loaded = parse(serialize({ ...toState(emptyStation()), modules: [mod] }))
  assert.equal(loaded.state.modules[0].cfg.line, '8')
})

test('waiting lines prefer boarding ink and align behind it without overlapping in all rotations', () => {
  for (const rot of [0, 1, 2, 3]) {
    const boarding = createModule('floor-mark-boarding', 0, 0, 0, 'boarding', rot)
    const waiting = createModule('floor-mark-waiting', 0, 0, 0, 'waiting')
    const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 20, cfg: { line: '5', side: 'right' } }
    const snapped = snapBoardingMark(waiting, [edge, boarding], [])
    assert.equal(snapped.rot, rot)
    assert.equal(snapped.cfg.edgeId, undefined, 'existing strip wins over screen door')
    const a = floorDecorBounds(boarding), b = floorDecorBounds(snapped)
    const displacement = rotateLocal(-rot, (b.x0 + b.x1 - a.x0 - a.x1) / 2, (b.y0 + b.y1 - a.y0 - a.y1) / 2)
    assert.ok(Math.abs(displacement[0]) < 1e-8)
    assert.ok(Math.abs(displacement[1] + 1.15) < 1e-8)
    assert.equal(equipmentReason([], [boarding], snapped), '', 'both stickers can be placed together')
    assert.equal(snapBoardingMark({ ...waiting, z: -4 }, [boarding, edge], []).cfg.offset, undefined)
  }
})

test('waiting lines fall back to the screen door opening without boarding ink', () => {
  const line = { id: '5', stock: 'B', cars: 1 }
  for (const rot of [0, 1, 2, 3]) for (const side of ['left', 'right']) {
    const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 20, cfg: { line: '5', side } }
    const [dx, dy] = rotateLocal(rot, doorRunOffsets(line, 20)[1] - 0.5, side === 'right' ? 0.09 : -0.09)
    const waiting = createModule('floor-mark-waiting', Math.floor(dx + 0.5), Math.floor(dy + 0.5), 0, 'waiting')
    const snapped = snapBoardingMark(waiting, [edge], [line])
    assert.equal(snapped.cfg.edgeId, edge.id)
    const b = floorDecorBounds(snapped)
    const displacement = rotateLocal(-snapped.rot, (b.x0 + b.x1) / 2 - dx - 0.5, (b.y0 + b.y1) / 2 - dy - 0.5)
    assert.ok(Math.abs(displacement[0]) < 1e-8)
    assert.ok(Math.abs(displacement[1] + 1.15) < 1e-8)
  }
})

test('direction ink fills the full one by two metre decal', () => {
  const { g } = stubCanvas(768, 512)
  const points = []
  g.moveTo = g.lineTo = (x, y) => points.push([x, y])
  drawFloorMark(g, 'direction')
  assert.deepEqual([Math.min(...points.map(([x]) => x)), Math.max(...points.map(([x]) => x))], [0, 768])
  assert.deepEqual([Math.min(...points.map(([, y]) => y)), Math.max(...points.map(([, y]) => y))], [0, 512])
  const b = floorDecorBounds(createModule('floor-mark-direction', 0, 0, 0, 'direction'))
  assert.equal(b.x1 - b.x0, 1)
  assert.equal(b.y1 - b.y0, 2)
})

test('machinery and floor stickers may stand inside a walled room or booth', () => {
  const shop = { id: 'shop', type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'store', door: [] } }
  const booth = { id: 'booth', type: 'booth', x: 0, y: 0, z: 0, w: 3, h: 3, cfg: { kind: 'ticket' } }
  const furniture = [
    createModule('ac-unit', 0, 0, 0, 'ac'),
    createModule('electrical-cabinet', 0, 2, 0, 'cabinet'),
    createModule('tactile-guide', 1, 1, 0, 'tactile'),
    createModule('floor-mark-boarding', 1, 1, 0, 'mark'),
  ]
  for (const room of [shop, booth]) for (const piece of furniture) {
    assert.equal(placementBlocked([room], piece), false, `${room.type} takes a ${piece.type}`)
    // Either side of the pair may be the candidate.
    assert.equal(placementBlocked([piece], room), false, 'either side of the pair')
  }
  // But machinery still collides with other equipment.
  const gate = { id: 'gate', type: 'gate', x: 0, y: 0, z: 0, cfg: { dir: 'both' } }
  assert.equal(placementBlocked([gate], createModule('ac-unit', 0, 0, 0, 'ac-2')), true)
})

test('the dispatcher routes the four floor-decor types to their own models', () => {
  const previous = globalThis.document
  globalThis.document = { createElement: () => ({ getContext: () => stubCanvas(768, 512).g }) }
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial()) })
  const cases = [
    [AcUnitModel, createModule('ac-unit', 4, 5, -4, 'ac')],
    [ElectricalCabinetModel, createModule('electrical-cabinet', 4, 5, -4, 'cabinet')],
    [TactileModel, createModule('tactile-guide', 4, 5, -4, 'tactile')],
    [FloorMarkModel, createModule('floor-mark-boarding', 4, 5, -4, 'mark')],
  ]
  const names = (group) => { const out = []; group.traverse((o) => { if (o.isMesh) out.push(o.name) }); return out.sort() }
  try {
    for (const [Model, mod] of cases) {
      const ctx = { mats, data: { ...emptyStation(), modules: [mod] }, trackCells: new Set(), finish: () => mats.steel, owned: [] }
      const dispatched = buildModule(mod, ctx)
      assert.ok(dispatched, `${mod.type} dispatches to a model`)
      assert.deepEqual(names(dispatched), names(new Model(ctx).build(mod)), `${mod.type} builds its own model through the dispatcher`)
      dispatched.traverse((o) => o.geometry?.dispose())
    }
  } finally {
    globalThis.document = previous
    for (const m of Object.values(mats)) m.dispose()
  }
})

test('bench width cycles preserve the seat style and refresh the placement ghost', () => {
  for (const style of ['steel', 'seat']) {
    harness(`bench-${style}-1`)
    const narrow = moduleGhostKey(createModule(useStore.getState().moduleType, 0, 0, 0, 'bench'))
    useStore.getState().cycleBenchWidth()
    assert.equal(useStore.getState().moduleType, `bench-${style}-2`)
    assert.notEqual(moduleGhostKey(createModule(useStore.getState().moduleType, 0, 0, 0, 'bench')), narrow)
    useStore.getState().cycleBenchWidth()
    assert.equal(useStore.getState().moduleType, `bench-${style}-1`)
  }
})

test('switching the direction sticker line refreshes the placement ghost', () => {
  harness('floor-mark-direction')
  const before = placementPreviewKey(useStore.getState())
  const line = useStore.getState().railLineId
  useStore.getState().setRailLine(`${line}-other`)
  assert.notEqual(placementPreviewKey(useStore.getState()), before, 'the ghost key ignores the sticker line')
  useStore.getState().setRailLine(line)
  assert.equal(placementPreviewKey(useStore.getState()), before)
})

test('rendered machinery and floor decor stay inside their rotated reserved volume', () => {
  const previous = globalThis.document
  globalThis.document = { createElement: () => ({ getContext: () => stubCanvas(768, 512).g }) }
  const mats = Object.fromEntries(['white', 'steel', 'darkSteel', 'black', 'green', 'orange', 'gateRed', 'psu', 'tactile'].map((key) => [key, new THREE.MeshStandardMaterial()]))
  const builders = { 'ac-unit': AcUnitModel, 'electrical-cabinet': ElectricalCabinetModel, tactile: TactileModel, 'floor-mark': FloorMarkModel }
  try {
    for (const id of ids) for (const rot of [0, 1, 2, 3]) {
      const mod = createModule(id, 4, 5, -4, id, rot)
      const owned = []
      const group = new builders[mod.type]({ mats, owned }).build(mod)
      const bounds = new THREE.Box3().setFromObject(group)
      const box = moduleEnvelope(mod)
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(bounds.min[axis] >= box[`${axis}0`] - 1e-6, `${id} minimum ${axis} remains in its volume`)
        assert.ok(bounds.max[axis] <= box[`${axis}1`] + 1e-6, `${id} maximum ${axis} remains in its volume`)
      }
      assert.ok(bounds.max.z > bounds.min.z || mod.type === 'floor-mark', `${id} builds a visible body`)
      group.traverse((o) => o.geometry?.dispose())
      for (const m of owned) { m.map?.dispose(); m.dispose() }
    }
  } finally {
    globalThis.document = previous
    for (const m of Object.values(mats)) m.dispose()
  }
})
