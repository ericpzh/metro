import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { referenceStation } from '../src/data/reference-station.ts'
import { blockIndex } from '../src/sim/blockIndex.ts'
import { blockReason } from '../src/sim/placement.ts'
import { virtualSolidAt } from '../src/sim/ground.ts'
import { isCosmeticStationEdit } from '../src/sim/cosmeticEdit.ts'
import { retainedModuleIds, signBoardsOnlyChange } from '../src/render/moduleDependencies.ts'
import { PlateSystem } from '../src/render/scene/systems/PlateSystem.ts'
import { signBoardsPanel } from '../src/sim/sign.ts'
import { checkBlockCells } from '../src/build/validation.ts'
import { FrameTask } from '../src/app/frameTask.ts'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'
import { batchStaticParts } from '../src/render/batchStaticModule.ts'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject, setDoorsSides } from '../src/render/models.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { createModule, paintFaces, toState } from '../src/build/model.ts'
import { exitFootprintCells } from '../src/sim/exits.ts'
import { passengerAppearance } from '../src/render/passengerModel.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

function canvasNode() {
  const node = { width: 0, height: 0 }
  const { g } = stubCanvas()
  g.canvas = node
  node.getContext = () => g
  return node
}

test('placement indexes distinguish document identity, virgin street, explicit holes and exit openings', () => {
  const cells = [{ x: 0, y: 0, z: 0, fill: 'void' }, { x: 1, y: 0, z: 0, fill: 'solid' }]
  const exit = createModule('exit-covered-2', 10, 0, 0, 'exit'), modules = [exit]
  const index = blockIndex(cells, modules)
  assert.equal(blockIndex(cells, modules), index, 'an immutable document reuses its prepared occupancy')
  assert.notEqual(blockIndex([...cells], modules), index, 'cell-array identity invalidates preparation')
  assert.notEqual(blockIndex(cells, [...modules]), index, 'module-array identity invalidates preparation')
  assert.equal(index.ground(0, 0, 0), false); assert.equal(index.ground(1, 0, 0), true)
  assert.equal(index.ground(2, 0, 0), true); assert.equal(index.ground(2, 0, 4), false)
  for (const [x, y, z] of exitFootprintCells(exit)) {
    assert.equal(index.opening(x, y, z), true, 'head-house floor holes cannot be filled by indexed bulk placement')
    assert.equal(index.ground(x, y, z), virtualSolidAt(cells, modules, x, y, z))
  }
})

test('bulk painting deduplicates targets, preserves holes and leaves the source document unchanged', () => {
  const before = toState({ name: 'paint', seed: 1, lines: [], modules: [], cells: [
    { x: 0, y: 0, z: 0, fill: 'solid', finish: { n: 'wall.plaster' } },
    { x: 1, y: 0, z: 0, fill: 'void' },
  ] })
  const targets = [[0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 0], [5, 0, 4]]
  const next = paintFaces(before, targets, 'n', 'wall.enamel')
  assert.equal(next.cells.length, 3, 'only one virgin-street record is added despite repeated targets')
  assert.equal(next.cells[1].fill, 'void'); assert.equal(next.cells[1].finish, undefined, 'a dug hole never receives paint')
  assert.equal(before.cells[0].finish.n, 'wall.plaster'); assert.equal(before.cells.length, 2)
  assert.equal(paintFaces(next, targets, 'n', 'wall.enamel'), next, 'repainting the same finish is a no-op')
})

test('cosmetic classification fails closed for future metadata, record ordering and shape changes', () => {
  const data = { name: 'test', seed: 1, lines: [], modules: [], cells: [
    { x: 0, y: 0, z: -4, fill: 'solid' }, { x: 1, y: 0, z: -4, fill: 'solid' },
  ] }
  assert.equal(isCosmeticStationEdit(data, structuredClone(data)), true)
  for (const next of [{ ...data, future: true }, { ...data, cells: data.cells.toReversed() },
    { ...data, cells: data.cells.slice(1) }, { ...data, cells: [{ ...data.cells[0], shape: { kind: 'half', side: 'n' } }, data.cells[1]] }]) {
    assert.equal(isCosmeticStationEdit(data, next), false, 'a renderer-only edit cannot silently change routing inputs')
  }
})

test('unknown model dependencies and malformed ramp envelopes invalidate instead of keeping stale geometry', () => {
  const models = [createModule('bench', 0, 0, 0, 'bench'), { id: 'future', type: 'future', x: 50, y: 50, z: 0, w: 1, h: 1, cfg: {} },
    { id: 'ramp', type: 'escalator', x: 10, y: 0, z: 0, w: 1, h: 1, cfg: {}, from: { x: NaN, y: 0, z: 0 }, to: { x: NaN, y: 10, z: 4 } }]
  const before = { name: 'test', seed: 1, lines: [], modules: models, cells: [] }
  assert.deepEqual([...retainedModuleIds(before, { ...before, cells: [{ x: 100, y: 100, z: 1, fill: 'solid' }] })], ['bench'])
})

test('default animation-frame coalescing flushes release and cancels stale callbacks', () => {
  const previousRequest = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame
  let callback, nextHandle = 0; const cancelled = [], events = []
  globalThis.requestAnimationFrame = cb => { callback = cb; return ++nextHandle }
  globalThis.cancelAnimationFrame = id => cancelled.push(id)
  try {
    const frame = new FrameTask()
    frame.schedule(() => events.push('old')); frame.schedule(() => events.push('last')); callback()
    assert.deepEqual(events, ['last']); assert.deepEqual(cancelled, [])
    frame.schedule(() => events.push('release')); frame.flush(); assert.deepEqual(cancelled, [2])
    frame.schedule(() => events.push('cancelled')); frame.cancel(); callback()
    assert.deepEqual(events, ['last', 'release']); assert.deepEqual(cancelled, [2, 3])
  } finally { globalThis.requestAnimationFrame = previousRequest; globalThis.cancelAnimationFrame = previousCancel }
})

test('paused camera culling repacks identities without changing frozen poses or picking identity', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() }, activeZ: 0, levelBase: 0, ghost: false, hideUI: false, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx), camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100)
  const aim = x => { camera.position.set(x, -10, 1); camera.up.set(0, 0, 1); camera.lookAt(x, 0, 1); camera.updateMatrixWorld(true) }
  try {
    crowd.setAgents(new Float32Array([0, 0, 1, 2, 0, 3, 50, 0, 1, 2, 0, 7]), 2, 1000)
    crowd.setPlaying(false); aim(0); crowd.renderAgents(ctx.lastStateTime + 1000, camera)
    assert.equal(crowd.agents.count, 1)
    const matrix = new THREE.Matrix4(); crowd.agents.getMatrixAt(0, matrix)
    const frozen = matrix.clone(), pose = crowd.agents.geometry.getAttribute('passengerPose').array.slice(0, 4)
    aim(50); crowd.renderAgents(ctx.lastStateTime + 1100, camera)
    assert.equal(crowd.agents.geometry.getAttribute('passengerOutfit').getX(0), passengerAppearance(7)[0], 'the compacted slot carries the newly visible identity')
    aim(0); crowd.renderAgents(ctx.lastStateTime + 1200, camera); crowd.agents.getMatrixAt(0, matrix)
    assert.deepEqual(matrix.elements, frozen.elements); assert.deepEqual(crowd.agents.geometry.getAttribute('passengerPose').array.slice(0, 4), pose)
    assert.equal(crowd.agents.geometry.getAttribute('passengerOutfit').getX(0), passengerAppearance(3)[0])
    assert.equal(crowd.agentCount, 2, 'culling never removes a simulation passenger')
  } finally { crowd.dispose(); ctx.mats.blob.dispose() }
})

test('indexed placement preserves opening, track, equipment and virtual-ground verdicts', () => {
  const data = referenceStation(), index = blockIndex(data.cells, data.modules)
  const probes = data.cells.filter((_, i) => i % 37 === 0).map(c => [c.x, c.y, c.z])
  for (let x = -20; x <= 20; x += 2) for (let y = -12; y <= 12; y += 2) probes.push([x, y, 0])
  for (const [x, y, z] of probes) {
    assert.deepEqual(blockReason(data.cells, data.modules, x, y, z, index), blockReason(data.cells, data.modules, x, y, z), `same refusal and colliders at ${x},${y},${z}`)
    assert.equal(index.ground(x, y, z), virtualSolidAt(data.cells, data.modules, x, y, z))
  }
  const maxX = Math.max(...data.cells.map(c => c.x)) + 10
  const patch = [[maxX, 0, -16], [maxX + 1, 0, -16]]
  assert.equal(checkBlockCells(data, patch), checkBlockCells(data, structuredClone(patch)), 'same immutable document and target reuse the last preview')
  const changed = { ...data, cells: [...data.cells, { x: maxX, y: 0, z: -16, fill: 'solid' }] }
  assert.deepEqual(checkBlockCells(changed, patch).acceptedCells, [[maxX + 1, 0, -16]], 'a new document invalidates the cached target')
})

test('cosmetic edits skip routing only when geometry, speed, cover and metadata agree', () => {
  const station = { name: 'test', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.tile' } }] }
  const paint = finish => ({ ...station, cells: [{ ...station.cells[0], finish }] })
  assert.equal(isCosmeticStationEdit(station, paint({ top: 'floor.tile', n: 'wall.enamel#ffaa00' })), true)
  assert.equal(isCosmeticStationEdit(station, paint({ top: 'floor.marble' })), true)
  for (const top of ['floor.concrete', 'floor.track', 'floor.soil', 'ceil.baffle']) assert.equal(isCosmeticStationEdit(station, paint({ top })), false, top)
  for (const edit of [{ fill: 'void' }, { zone: 'paid' }, { tags: ['wall'] }, { x: 1 }]) {
    assert.equal(isCosmeticStationEdit(station, { ...station, cells: [{ ...station.cells[0], ...edit }] }), false)
  }
  assert.equal(isCosmeticStationEdit(station, { ...station, name: 'new' }), false)
  assert.equal(isCosmeticStationEdit(station, { ...station, modules: [{ id: 'b', type: 'bench' }] }), false)
})

test('module dependencies invalidate affected walls, ramps and overhead supports only', () => {
  const modules = [
    { id: 'bench', type: 'bench', x: 0, y: 0, z: 0, w: 1, h: 1, cfg: {} },
    { id: 'room', type: 'shop', x: 0, y: 0, z: 0, w: 4, h: 4, cfg: {} },
    { id: 'sign', type: 'sign', x: 10, y: 0, z: 0, w: 1, h: 1, cfg: { mount: 'ceiling' } },
    { id: 'stair', type: 'stair', x: 20, y: 0, z: 0, w: 1, h: 1, from: { x: 20, y: 0, z: 0 }, to: { x: 26, y: 0, z: 4 }, cfg: { width: 0.79 } },
  ]
  const before = { name: 'test', seed: 1, lines: [], modules, cells: [{ x: 0, y: 0, z: 1, fill: 'solid' }] }
  const side = { ...before, cells: [{ ...before.cells[0], finish: { n: 'wall.enamel' } }] }
  assert.deepEqual([...retainedModuleIds(before, side)], ['bench', 'sign', 'stair'])
  const add = cell => ({ ...before, cells: [...before.cells, { ...cell, fill: 'solid' }] })
  assert.equal(retainedModuleIds(before, add({ x: 10, y: 0, z: 12 })).has('sign'), false, 'a farther slab can change suspension height')
  assert.equal(retainedModuleIds(before, add({ x: 22, y: 1, z: 2 })).has('stair'), false, 'a neighbouring course can change a balustrade/join')
  assert.equal(retainedModuleIds(before, add({ x: 100, y: 0, z: 0 })).size, modules.length)
  assert.equal(retainedModuleIds(before, { ...before, modules: modules.slice(1) }).size, 0, 'module and neighbour changes fail closed')
})

test('a boards-only sign change names its sign, and anything else fails closed', () => {
  const mark = id => ({ id, kind: 'icon', icon: 'exit', x: 0, y: 0.35, scale: 1, side: 'both' })
  const sign = front => ({ id: 'sign', type: 'sign', x: 10, y: 0, z: 0, w: 1, h: 1, cfg: { mount: 'ceiling', front, back: [] } })
  const before = { name: 'test', seed: 1, lines: [], modules: [{ id: 'bench', type: 'bench', x: 0, y: 0, z: 0, w: 1, h: 1, cfg: {} }, sign([mark('c1'), mark('c2')])], cells: [{ x: 0, y: 0, z: 1, fill: 'solid' }] }
  const boards = front => ({ ...before, modules: [before.modules[0], sign(front)] })
  // A reorder and a delete touch one board's marks and nothing else.
  assert.equal(signBoardsOnlyChange(before, boards([before.modules[1].cfg.front[1], before.modules[1].cfg.front[0]])), 'sign')
  assert.equal(signBoardsOnlyChange(before, boards([mark('c1')])), 'sign')
  assert.equal(signBoardsOnlyChange(before, before), null, 'identical documents are not a boards change')
  const other = front => ({ ...before, modules: [{ ...before.modules[0], x: 1 }, sign(front)] })
  assert.equal(signBoardsOnlyChange(before, other([mark('c1')])), null, 'a second changed module fails closed')
  assert.equal(signBoardsOnlyChange(before, { ...before, cells: [...before.cells, { x: 5, y: 5, z: 1, fill: 'solid' }] }), null, 'a cell change fails closed')
  assert.equal(signBoardsOnlyChange(before, { ...before, lines: [{ id: '1' }] }), null, 'a line change reprints every shield')
  assert.equal(signBoardsOnlyChange(before, { ...before, name: 'renamed' }), null, 'station fields fail closed')
  assert.equal(signBoardsOnlyChange(before, { ...before, modules: [before.modules[0]] }), null, 'a removed sign fails closed')
  const remount = { ...before, modules: [before.modules[0], { ...sign([mark('c1')]), cfg: { ...sign([mark('c1')]).cfg, mount: 'wall' } }] }
  assert.equal(signBoardsOnlyChange(before, remount), null, 'a mount change moves the steel, not just the print')
})

test('rebuilding one sign keeps every other group and its owned materials', () => {
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => canvasNode() }
  let mats, modules
  const blob = new THREE.MeshBasicMaterial()
  try {
    mats = createModelMaterials()
    const ctx = { scene: new THREE.Scene(), mats: { blob }, modelMats: mats, ads: {}, groundOf: new Map(), levelBase: 0, ownedMats: [] }
    modules = new ModuleSystem(ctx)
    modules.ghost = { clearFencePreview() {} }
    modules.plates = { retainTvPlates() {}, retainSignPlates() {}, retainDecorPlates() {}, clearTvPlates() {}, clearSignPlates() {}, clearDecorPlates() {}, ownsTexture: () => false, adScreens: [], tvScreens: [], makeSignPlate: () => new THREE.MeshBasicMaterial() }
    modules.trains = { psdGroups: [] }; modules.lifts = { escalatorRolls: [], liftRigs: [], liftPickMeshes: [] }
    modules.clocks = { clockRigs: [] }; modules.crowd = { gateWings: [] }
    const mark = id => ({ id, kind: 'icon', icon: 'exit', x: 0, y: 0.35, scale: 1, side: 'both' })
    const withFront = (mod, front) => ({ ...mod, cfg: { ...mod.cfg, front, back: [] } })
    const benchMod = createModule('bench', 0, 0, 0, 'bench')
    const signMod = withFront(createModule('sign', 10, 0, 4, 'sign'), [mark('c1'), mark('c2')])
    const station = { name: 'test', seed: 1, lines: [], modules: [benchMod, signMod], cells: [] }
    modules.buildModules(station, new Set())
    const bench = modules.moduleMeshes.children.find(g => g.userData.moduleId === 'bench')
    const oldSign = modules.moduleMeshes.children.find(g => g.userData.moduleId === 'sign')
    const edited = { ...station, modules: [benchMod, withFront(signMod, [mark('c1')])] }
    assert.equal(signBoardsOnlyChange(station, edited), 'sign', 'the delete is a boards-only change')
    assert.equal(modules.signBoardsOnlyChanged(edited), 'sign', 'the last build is what the verdict diffs against')
    const keep = new Set(edited.modules.map(m => m.id).filter(id => id !== 'sign'))
    modules.buildModules(edited, new Set(), true, keep)
    assert.ok(modules.moduleMeshes.children.includes(bench), 'the unrelated bench keeps its group')
    assert.ok(!modules.moduleMeshes.children.includes(oldSign), 'the edited sign rebuilds its group')
    assert.ok(modules.moduleMeshes.children.find(g => g.userData.moduleId === 'sign'), 'the edited sign still draws')
    modules.clearModules()
  } finally { modules?.clearModules(); if (mats) disposeModelMaterials(mats); blob.dispose(); globalThis.document = previousDocument }
})

test('a boards-only preview repaints one sign in place and skips a resized panel', () => {
  const previousDocument = globalThis.document
  const created = []
  globalThis.document = {
    createElement: () => {
      const { g, ops } = stubCanvas()
      const node = { width: 0, height: 0 }
      g.canvas = node
      node.getContext = () => g
      created.push({ node, g, ops })
      return node
    },
  }
  try {
    const plates = new PlateSystem({})
    const label = (id, text) => ({ id, kind: 'text', text, x: 0, y: 0.35, scale: 1, side: 'both' })
    const front = [label('c1', '东'), label('c2', '西')]
    const panel = signBoardsPanel({ front, back: [] })
    const left = plates.makeSignPlate('sign', front, 'left', panel)
    const entry = plates.signPlates.get(`sign|left|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`)
    assert.ok(entry, 'the minted face is retained by module, side and panel')
    assert.equal(entry.material, left, 'the model draws the retained material')
    const before = entry.texture.version
    const drawn = created.at(-1).ops.texts.length
    // A reorder keeps the panel: the same canvas is repainted, not re-minted.
    plates.repaintSignPreview('sign', { front: [front[1], front[0]], back: [] }, [])
    assert.equal(plates.signPlates.size, 1, 'no second canvas is minted for the same panel')
    assert.equal(entry.texture.version, before + 1, 'the retained texture re-uploads once')
    const tail = created.at(-1).ops.texts.slice(drawn)
    assert.deepEqual(tail, ['西', '东'], 'the repaint prints the new order, not the old one')
    // A board that outgrew its panel is not repainted here: the rebuild mints it
    // fresh, already carrying the new boards, so painting the old canvas would be
    // a second draw of a plate about to be disposed.
    const grown = [...front, label('c3', '南北双向换乘通道')]
    assert.notDeepEqual(signBoardsPanel({ front: grown, back: [] }), panel, 'the longer board really changed size')
    plates.repaintSignPreview('sign', { front: grown, back: [] }, [])
    assert.equal(created.at(-1).ops.texts.length, drawn + tail.length, 'a resized panel draws nothing in place')
    assert.equal(entry.texture.version, before + 1, 'and the old texture is untouched')
    plates.clearSignPlates()
  } finally { globalThis.document = previousDocument }
})

test('pointer frames keep the latest move, flush release and cancel stale work', () => {
  let callback, cancelled = 0
  const frame = new FrameTask(fn => { callback = fn; return 7 }, () => cancelled++)
  const calls = []
  frame.schedule(() => calls.push(1)); frame.schedule(() => calls.push(2)); callback()
  assert.deepEqual(calls, [2])
  frame.schedule(() => calls.push(3)); frame.flush()
  assert.deepEqual(calls, [2, 3], 'release gets the final queued sweep before committing')
  frame.schedule(() => calls.push(4)); frame.cancel(); callback()
  assert.deepEqual(calls, [2, 3]); assert.equal(cancelled, 2)
})

test('crowd uploads only visible prefixes and holds paused/hidden GPU buffers', () => {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() }, activeZ: 0, levelBase: 0, ghost: false, hideUI: false, stateIntervalMs: 1000 }
  const crowd = new CrowdSystem(ctx)
  try {
    crowd.setAgents(new Float32Array([0, 0, 1, 2, 0, 7, 0, 0, 9, 2, 0, 8]), 2, 1000)
    crowd.renderAgents(ctx.lastStateTime + 1000)
    assert.equal(crowd.agents.count, 1, 'hidden storeys are omitted, not zero-scaled')
    assert.deepEqual(crowd.agents.instanceMatrix.updateRanges, [{ start: 0, count: 16 }])
    const identityAttributes = [crowd.agents.instanceColor, crowd.agents.geometry.getAttribute('passengerOutfit')]
    const identityVersions = identityAttributes.map(a => a.version)
    crowd.renderAgents(ctx.lastStateTime + 1100)
    assert.deepEqual(identityAttributes.map(a => a.version), identityVersions, 'unchanged identities do not resend colors/outfits while playing')
    crowd.setPlaying(false)
    crowd.renderAgents(ctx.lastStateTime + 2000)
    const attrs = [crowd.agents.instanceMatrix, crowd.blobs.instanceMatrix, crowd.agents.instanceColor, crowd.agents.geometry.getAttribute('passengerPose')]
    const versions = attrs.map(a => a.version)
    crowd.renderAgents(ctx.lastStateTime + 3000)
    assert.deepEqual(attrs.map(a => a.version), versions, 'an unchanged paused frame uploads nothing')
    crowd.setAgentsVisible(false); crowd.setPlaying(true)
    const hiddenVersions = attrs.map(a => a.version)
    crowd.renderAgents(ctx.lastStateTime + 4000)
    assert.deepEqual(attrs.map(a => a.version), hiddenVersions)
    crowd.followAgentId = 7
    let eye
    crowd.onEyePose = (...pose) => eye = pose
    crowd.renderAgents(ctx.lastStateTime + 4500)
    assert.ok(eye, 'hidden crowd still updates a followed passenger camera')
    crowd.followAgentId = null; crowd.setAgentsVisible(true); ctx.hideUI = true
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.up.set(0, 0, 1); camera.position.set(0, -5, 2); camera.lookAt(0, 0, 2); camera.updateMatrixWorld(true)
    crowd.setAgents(new Float32Array([0, 0, 1, 2, 0, 7, 100, 0, 1, 2, 0, 8]), 2, 1000)
    crowd.renderAgents(ctx.lastStateTime + 1000, camera)
    assert.equal(crowd.agents.count, 1, 'offscreen bodies are omitted conservatively')
  } finally { crowd.dispose(); ctx.mats.blob.dispose() }
})

test('train shell batching keeps bounds, triangle count and moving door/window references', () => {
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => canvasNode() }
  let mats, train
  try {
    mats = createModelMaterials()
    train = buildTrain(mats, { x: 0, y: 0, z: 0, cars: 2, stock: 'B', doorsOpen: false, colour: '#2255aa', dirSign: 1, yaw: 0 })
    const count = () => { let meshes = 0, triangles = 0; train.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 } }); return { meshes, triangles } }
    const before = count(), bounds = new THREE.Box3().setFromObject(train)
    const doors = [...train.userData.doors]
    batchStaticParts(train, new Set(doors))
    const after = count(), nextBounds = new THREE.Box3().setFromObject(train)
    assert.ok(after.meshes < before.meshes / 2, 'stationary shells require substantially fewer draws')
    assert.equal(after.triangles, before.triangles)
    assert.ok(bounds.min.distanceTo(nextBounds.min) < 1e-5 && bounds.max.distanceTo(nextBounds.max) < 1e-5)
    for (const door of doors) assert.ok(door.parent)
    const closed = doors.map(d => d.position.x)
    setDoorsSides(train, 1, 0)
    assert.ok(doors.some((d, i) => d.position.x !== closed[i]), 'doors still move independently of the batched shell')
  } finally {
    if (train) { disposeObject(train); train.userData.ownedMats.forEach(m => m.dispose()) }
    if (mats) disposeModelMaterials(mats)
    globalThis.document = previousDocument
  }
})

test('retained equipment keeps geometry and owned materials until invalidation or teardown', () => {
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => canvasNode() }
  let mats, modules
  const blob = new THREE.MeshBasicMaterial()
  try {
    mats = createModelMaterials()
    const ctx = { scene: new THREE.Scene(), mats: { blob }, modelMats: mats, ads: {}, groundOf: new Map(), levelBase: 0, ownedMats: [] }
    modules = new ModuleSystem(ctx)
    modules.ghost = { clearFencePreview() {} }
    modules.plates = { retainTvPlates() {}, retainSignPlates() {}, retainDecorPlates() {}, clearTvPlates() {}, clearSignPlates() {}, clearDecorPlates() {}, ownsTexture: () => false, adScreens: [], tvScreens: [] }
    modules.trains = { psdGroups: [] }; modules.lifts = { escalatorRolls: [], liftRigs: [], liftPickMeshes: [] }
    modules.clocks = { clockRigs: [] }; modules.crowd = { gateWings: [] }
    const station = { name: 'test', seed: 1, lines: [], modules: [createModule('bench', 0, 0, 0, 'bench'), createModule('light-circular', 4, 0, 0, 'light')], cells: [] }
    modules.buildModules(station, new Set())
    const light = modules.moduleMeshes.children.find(g => g.userData.moduleId === station.modules[1].id)
    let disposed = 0
    const owned = light.userData.ownedMaterials[0]
    owned.addEventListener('dispose', () => disposed++)
    modules.buildModules({ ...station, cells: [{ x: 100, y: 0, z: 0, fill: 'solid' }] }, new Set(), true)
    assert.ok(modules.moduleMeshes.children.includes(light), 'a local block edit keeps the original group')
    assert.equal(disposed, 0, 'retained lighting material remains live')
    modules.clearModules()
    assert.equal(disposed, 1, 'teardown releases retained owned material once')
    assert.equal(ctx.ownedMats.length, 0)
  } finally { modules?.clearModules(); if (mats) disposeModelMaterials(mats); blob.dispose(); globalThis.document = previousDocument }
})
