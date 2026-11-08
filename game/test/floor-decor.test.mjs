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
import { floorDecorBounds, floorMarkLine, snapBoardingMark, tactileArms, realignSavedFloorMarks } from '../src/sim/floorDecor.ts'
import { doorRunOffsets } from '../src/sim/stock.ts'
import { rotateLocal } from '../src/sim/track.ts'
import * as THREE from 'three'
import { buildModule } from '../src/render/models.ts'
import { prepareArtwork, repaintArtwork } from '../src/render/artwork.ts'
import { AcUnitModel } from '../src/render/models/pieces/AcUnitModel.ts'
import { ElectricalCabinetModel } from '../src/render/models/pieces/ElectricalCabinetModel.ts'
import { TactileModel } from '../src/render/models/pieces/TactileModel.ts'
import { FloorMarkModel } from '../src/render/models/pieces/FloorMarkModel.ts'

const ids = ['ac-unit', 'electrical-cabinet', 'tactile-guide', 'tactile-warning', 'tactile-warning-strip', 'floor-mark-boarding', 'floor-mark-waiting', 'floor-mark-direction']

test('floor decorations preserve variants and rotation through save/load', () => {
  let state = toState(emptyStation())
  for (const [i, id] of ids.entries()) state = addEquipment(state, createModule(id, i * 6, 0, 0, id, 1))
  const loaded = parse(serialize(state))
  assert.equal(loaded.ok, true)
  // A five-metre state carries the station's grid on every module, and the one load
  // path adds that stamp, so the reload is compared with the state through it.
  assert.deepEqual(loaded.state.modules, toState(state).modules)
  assert.equal(moduleGhostKey(createModule('tactile-guide', 0, 0, 0, 'a')), moduleGhostKey(createModule('tactile-guide', 0, 0, 0, 'b')))
  assert.notEqual(moduleGhostKey(createModule('tactile-guide', 0, 0, 0, 'a')), moduleGhostKey(createModule('tactile-warning', 0, 0, 0, 'a')))
  assert.notEqual(moduleGhostKey(createModule('tactile-warning', 0, 0, 0, 'a')), moduleGhostKey(createModule('tactile-warning-strip', 0, 0, 0, 'a')))
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
  h.tool.multiPlace.flushPreview()
  assert.equal(h.ghost().length, 5)
  assert.ok(h.ghost().every((m) => m.rot === 1 && m.x === 0))
  h.tool.onUp(h.event(1, 4))
  assert.equal(useStore.getState().past.length, 1)
  assert.equal(useStore.getState().station.modules.length, 5)
  h.tool.onDown(h.event(0, 0, 2))
  // Erasure is draggable immediately, without the placement long-press delay.
  h.tool.onMove(h.event(0, 4, 2))
  h.tool.multiPlace.flushPreview()
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
  h.deleteTool.multiPlace.flushPreview()
  assert.equal(h.ghost().length, 2)
  h.deleteTool.onUp(h.event(2, 0))
  assert.deepEqual(useStore.getState().station.modules, [guide])
  assert.deepEqual(useStore.getState().station.cells, [])
})

test('a warning-strip drag removes only strips and leaves the square junctions', () => {
  const h = harness('tactile-warning-strip')
  const square = createModule('tactile-warning', 0, 1, 0, 'square')
  const strips = [0, 2].map((x) => createModule('tactile-warning-strip', x, 0, 0, `strip-${x}`))
  useStore.setState({ tool: 'delete', station: { ...useStore.getState().station, modules: [strips[0], square, strips[1]] } })
  h.deleteTool.onDown(h.event(0, 0))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.deleteTool.onMove(h.event(2, 0))
  h.deleteTool.multiPlace.flushPreview()
  assert.equal(h.ghost().length, 2)
  h.deleteTool.onUp(h.event(2, 0))
  assert.deepEqual(useStore.getState().station.modules, [square])
  assert.deepEqual(useStore.getState().station.cells, [])
})

test('a floor marking right-click removes only the ink beside a screen door', () => {
  const h = harness('floor-mark-boarding')
  const mark = createModule('floor-mark-boarding', 0, 0, 0, 'mark')
  const psd = { id: 'psd', type: 'platform-edge', x: 0, y: 0, z: 0, rot: 0, w: 3, cfg: { line: '5' } }
  useStore.setState({ station: { ...useStore.getState().station, modules: [mark, psd] } })
  h.tool.onDown(h.event(0, 0, 2))
  h.tool.onUp(h.event(0, 0, 2))
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

test('warning strips fill their run and bridge only a crosswise band', () => {
  const strip = createModule('tactile-warning-strip', 0, 0, 0, 'strip')
  assert.deepEqual(strip.cfg, { variant: 'warning-strip' })
  const guide = (x, y, rot = 0) => createModule('tactile-guide', x, y, 0, `guide-${x}-${y}`, rot)
  const endSquare = createModule('tactile-warning', 1, 0, 0, 'end-square')
  // The full one-metre top already meets a run neighbour at both cell ends.
  assert.deepEqual(tactileArms(strip, [guide(1, 0)]), [])
  // A crosswise band reaches the shared edge, so the strip bridges its own side.
  assert.deepEqual(tactileArms(strip, [guide(0, 1, 1)]), [[0, 1]])
  // A parallel band and a junction square beside it leave that edge open.
  assert.deepEqual(tactileArms(strip, [guide(0, 1)]), [])
  assert.deepEqual(tactileArms(strip, [createModule('tactile-warning', 0, 1, 0, 'side-square')]), [])
  // A square at the strip's end joins through its own arm, not the strip's.
  assert.deepEqual(tactileArms(strip, [endSquare]), [])
  assert.deepEqual(tactileArms(endSquare, [strip]), [[-1, 0]])
  // A turned strip's arm follows its crosswise axis.
  const turned = createModule('tactile-warning-strip', 0, 0, 0, 'turned', 1)
  assert.deepEqual(tactileArms(turned, [guide(1, 0)]), [[0, -1]])
  assert.deepEqual(tactileArms(turned, [guide(0, 1, 1)]), [], 'a run joined end to end needs no arm')
  const mats = { tactile: new THREE.MeshStandardMaterial() }
  const build = (modules) => new TactileModel({ mats, data: { modules } }).build(strip)
  for (const [name, modules, y1, dots] of [
    ['plain strip', [strip], 0.725, 60],
    ['T join', [strip, guide(0, 1, 1)], 1, 75],
    ['run join', [strip, guide(1, 0)], 0.725, 60],
  ]) {
    const model = build(modules), bounds = new THREE.Box3().setFromObject(model)
    assert.ok(Math.abs(bounds.min.x) < 1e-6 && Math.abs(bounds.max.x - 1) < 1e-6, `${name}: spans the full cell width`)
    assert.ok(Math.abs(bounds.min.y - 0.275) < 1e-6 && Math.abs(bounds.max.y - y1) < 1e-6, `${name}: depth`)
    assert.ok(Math.abs(bounds.max.z - 1.012) < 1e-6, `${name}: sits on the floor`)
    let count = 0
    model.traverse((o) => { if (o.isInstancedMesh) count += o.count })
    assert.equal(count, dots, `${name}: dots cover the top and any arm`)
    model.traverse((o) => { o.geometry?.dispose(); if (o.isInstancedMesh) o.dispose() })
  }
  mats.tactile.dispose()
})


test('boarding strip snaps to the real train-aligned opening in every rotation and side', () => {
  const line = { id: '5', name: '5号线', colour: '#c8102e', stock: 'B', cars: 1, modelScale: 0.98 }
  for (const psd of ['full', 'half', 'none']) for (const rot of [0, 1, 2, 3]) for (const side of ['left', 'right']) {
    const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 20, cfg: { line: '5', side, psd } }
    const opening = doorRunOffsets(line, 20)[1] - 0.5
    const [dx, dy] = rotateLocal(rot, opening, side === 'right' ? -0.02 : 0.02)
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

test('a long scaled consist keeps every boarding strip on its drawn screen doorway', () => {
  // Tianhe Park's line 11: eight A cars on a 173 m platform, which the five-metre
  // profile draws at 0.98. The screen cuts its openings from the scaled cadence, so
  // the strip must repeat that list; the unscaled one drifts a metre off mid-platform
  // and misses the snap radius entirely at either end.
  const line = { id: '11', name: '11号线', colour: '#f5bb17', stock: 'A', cars: 8, modelScale: 0.98 }
  const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, rot: 0, w: 173, cfg: { line: '11', side: 'left', psd: 'full' } }
  const openings = doorRunOffsets(line, 173)
  const unscaled = doorRunOffsets({ stock: 'A', cars: 8 }, 173)
  for (const index of [0, 1, 2, 19, 20, 37, 38, 39]) {
    const opening = openings[index] - 0.5
    const drift = Math.abs(opening - (unscaled[index] - 0.5))
    if (index < 3 || index > 36) assert.ok(drift > 1.5, `door ${index} is beyond the old 1.5 m snap radius`)
    else assert.ok(drift < 0.1, `door ${index} is near the consist centre`)
    const [dx, dy] = rotateLocal(0, opening, 0.02)
    const pointer = createModule('floor-mark-boarding', Math.floor(0.5 + dx), Math.floor(0.5 + dy), 0, 'mark')
    const snapped = snapBoardingMark(pointer, [edge], [line])
    assert.equal(snapped.cfg.edgeId, 'edge', `door ${index} snaps at all`)
    const box = floorDecorBounds(snapped)
    assert.ok(Math.abs((box.x0 + box.x1) / 2 - (0.5 + dx)) < 1e-8, `door ${index} centre sits on the drawn doorway`)
    assert.ok(Math.abs((box.y0 + box.y1) / 2 - (0.5 + dy)) < 1e-8)
  }
})

test('a demo bake re-aligns legacy vinyl onto the drawn doorways and leaves authored ink alone', () => {
  // The authors' demo saves were made by a build that snapped without the line's
  // `modelScale`, so their strips sit on the old cadence. The bake re-aligns only
  // that ink: a strip already on a current doorway, or one placed away from every
  // doorway, keeps exactly the offset the save stored.
  const line = { id: '5', name: '5号线', colour: '#c8102e', stock: 'L', cars: 6, modelScale: 0.98 }
  const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, w: 40, rot: 0, cfg: { line: '5', side: 'left', psd: 'full' } }
  const legacyDoors = doorRunOffsets({ stock: 'L', cars: 6 }, 40)
  const currentDoors = doorRunOffsets(line, 40)
  // The snap's own anchor maths for side 'left' at rot 0: the vinyl faces rot 2 and
  // its centre lands on the door, 2 cm off the screen line.
  const markAt = (doors, index, cfg = {}) => {
    const target = doors[index]
    const x = Math.floor(target)
    return { id: `mark-${index}`, type: 'floor-mark', x, y: 0, z: 0, rot: 2,
      cfg: { variant: 'boarding', edgeId: 'edge', offset: { x: target - x + 0.5, y: 0.02 }, ...cfg } }
  }
  const stale = markAt(legacyDoors, 7)
  const aligned = markAt(currentDoors, 9)
  const manual = { id: 'manual', type: 'floor-mark', x: 20, y: 2, z: 0, rot: 0, cfg: { variant: 'boarding', offset: { x: 0, y: 0 } } }
  const waiting = { id: 'waiting', type: 'floor-mark', x: stale.x, y: 1, z: 0, rot: 2,
    cfg: { variant: 'waiting', edgeId: 'edge', offset: { x: 0.9, y: 1.2 } } }
  const modules = [edge, stale, aligned, manual, waiting]
  const realigned = realignSavedFloorMarks(modules, [line])
  assert.equal(realigned.boarding, 1, 'only the legacy strip moves')
  assert.equal(realigned.waiting, 1, 'its queue follows the ink')
  assert.equal(realigned.modules[2], aligned, 'ink already on a current doorway is untouched')
  assert.equal(realigned.modules[3], manual, 'ink placed away from every doorway is untouched')
  const staleAfter = floorDecorBounds(realigned.modules[1])
  assert.ok(Math.abs((staleAfter.x0 + staleAfter.x1) / 2 - currentDoors[7]) < 1e-8, 'the strip lands on its own doorway')
  assert.ok(Math.abs((staleAfter.y0 + staleAfter.y1) / 2 - 0.52) < 1e-8)
  const boarding = floorDecorBounds(realigned.modules[1])
  const queue = floorDecorBounds(realigned.modules[4])
  const displacement = rotateLocal(-2, (queue.x0 + queue.x1 - boarding.x0 - boarding.x1) / 2, (queue.y0 + queue.y1 - boarding.y0 - boarding.y1) / 2)
  assert.ok(Math.abs(displacement[1] + 1.15) < 1e-8, 'the queue sits 1.15 m behind the corrected strip')
  const second = realignSavedFloorMarks(realigned.modules, [line])
  assert.equal(second.boarding + second.waiting, 0, 'the pass is idempotent')
  assert.equal(second.modules, realigned.modules)
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
  const line = { id: '5', stock: 'B', cars: 1, modelScale: 0.98 }
  for (const psd of ['full', 'half', 'none']) for (const rot of [0, 1, 2, 3]) for (const side of ['left', 'right']) {
    const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 20, cfg: { line: '5', side, psd } }
    const [dx, dy] = rotateLocal(rot, doorRunOffsets(line, 20)[1] - 0.5, side === 'right' ? -0.02 : 0.02)
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

test('floor markings share artwork by selector and repaint one retained texture', () => {
  const previous = globalThis.document
  globalThis.document = { createElement: () => ({ getContext: () => stubCanvas(768, 512).g }) }
  const mats = {}, data = emptyStation()
  const mod = createModule('floor-mark-direction', 0, 0, 0, 'first')
  const bound = { ...mod, cfg: { ...mod.cfg, line: 'future' } }
  const builder = new FloorMarkModel({ mats, data })
  const roots = [builder.build(bound), builder.build({ ...bound, id: 'second', x: 2 }), builder.build(mod)]
  try {
    const [first, second, fallback] = roots.map(root => root.children[0].material)
    assert.equal(first, second)
    assert.notEqual(first, fallback, 'a missing line selector must be able to resolve later')
    const original = first.map.version, fallbackVersion = fallback.map.version
    const updated = { ...data, lines: [{ id: 'future', name: 'New line', colour: '#0e9999' }] }
    roots.slice(0, 2).forEach(root => { prepareArtwork(root); repaintArtwork(root, updated) })
    assert.equal(first.map.version, original + 1)
    assert.equal(fallback.map.version, fallbackVersion)
    let releases = 0
    first.addEventListener('dispose', () => releases++)
    roots[0].children[0].geometry.dispose()
    assert.equal(releases, 0, 'the other model still draws from the shared material')
    roots[1].children[0].geometry.dispose()
    assert.equal(releases, 1, 'removing the final model releases the shared artwork')
  } finally {
    roots.forEach(root => root.children[0].geometry.dispose())
    globalThis.document = previous
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
