import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { fenceConnectionIndex, railLandingAt } from '../src/sim/fences.ts'
import { gateSolidFaces } from '../src/sim/gates.ts'
import { FenceModel } from '../src/render/models/pieces/FenceModel.ts'
import { buildModule, disposeObject } from '../src/render/models.ts'
import { BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'
import { batchStaticModule } from '../src/render/batchStaticModule.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'

function fixture(mods, remoteCount = 0) {
  const remote = Array.from({ length: remoteCount }, (_, i) => createModule('fence', 30 + i % 32, 30 + Math.floor(i / 32), i % 2 ? -5 : 0, 'remote-' + i))
  let reads = 0
  const documentModules = new Proxy([...mods, ...remote], { get(target, key, receiver) {
    if (key === Symbol.iterator || key === 'some') reads++
    return Reflect.get(target, key, receiver)
  } })
  const data = { ...emptyStation(), modules: documentModules }
  const materials = new Proxy({}, { get: (o, key) => o[key] ??= new THREE.MeshStandardMaterial({ name: String(key) }) })
  const ctx = new SceneContextData(new THREE.Scene(), { owns: () => true }, materials, null)
  ctx.stationData = data; ctx.ghost = false
  const modules = new ModuleSystem(ctx), ghost = new GhostSystem(ctx), level = new LevelSystem(ctx)
  modules.ghost = ghost; ghost.modules = modules; ghost.level = level
  ghost.plates = { ownsTexture: () => false }; ghost.clocks = { previewRigs: [] }
  level.modules = modules; level.chunks = { levelGroups: new Map(), outlineSet: new Set() }
  level.trains = { trainGroup: new THREE.Group() }
  // Remote source geometry stands in for a large loaded station. It must never
  // be read or rebuilt by a local preview; nearby pieces use the real model.
  for (const mod of data.modules) {
    if (mod.type !== 'fence') continue
    const group = remote.includes(mod) ? new THREE.Group() : buildModule(mod, { mats: materials, data })
    if (!remote.includes(mod)) batchStaticModule(group, mod.type)
    if (remote.includes(mod)) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, .05, 1), materials.steel))
      group.position.set(mod.x, mod.y, mod.z + 1)
    }
    group.userData = { moduleId: mod.id, moduleType: 'fence', levelZs: [mod.z], groundBand: mod.z }
    modules.moduleMeshes.add(group); modules.fenceGroups.push(group); modules.fenceGroupsById.set(mod.id, group)
  }
  fenceConnectionIndex(data.modules)
  level.applyLevel()
  reads = 0
  return { ctx, data, materials, modules, ghost, level, reads: () => reads,
    root: id => modules.fenceGroupsById.get(id),
    close() {
      ghost.dispose(); modules.batches.clear(); disposeObject(modules.moduleMeshes)
      for (const mat of [...Object.values(materials), ...ctx.dimMats.values(), ...ctx.clearMats.values()]) mat.dispose()
    } }
}

function shape(group) {
  group.updateMatrixWorld(true)
  const meshes = []
  group.traverse(o => { if (o.isMesh) meshes.push({
    matrix: [...o.matrixWorld.elements], positions: [...o.geometry.attributes.position.array],
    indices: o.geometry.index ? [...o.geometry.index.array] : null,
  }) })
  return meshes
}

test('fence index preserves gate faces, ramp landings and immutable document invalidation', () => {
  const modules = [createModule('fence', -2, 0, 0, 'f'), createModule('stair-block', 20, 0, 0, 'block')]
  for (const [i, type] of ['stair-straight', 'escalator', 'walkway', 'gate', 'gate-new'].entries()) {
    for (let rot = 0; rot < 4; rot++) modules.push(createModule(type, 4 * i, 4 * rot, 0, `${type}-${rot}`, rot))
  }
  const index = fenceConnectionIndex(modules)
  assert.equal(fenceConnectionIndex(modules), index, 'one prepared index per immutable document')
  for (let z = 0; z <= 5; z += 5) for (let x = -4; x <= 22; x++) for (let y = -12; y <= 24; y++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const expected = modules.some(m => m.z === z && m.x === x && m.y === y &&
        (m.type === 'fence' || m.type === 'gate' && gateSolidFaces(m, dx, dy))) || railLandingAt(modules, x, y, z)
      assert.equal(index.connects(x, y, z, dx, dy), expected, `same joints at ${x},${y},${z} from ${dx},${dy}`)
    }
  }
  const added = createModule('fence', 40, 0, 0, 'new')
  const updated = fenceConnectionIndex([...modules, added])
  assert.notEqual(updated, index)
  assert.equal(index.connects(40, 0, 0, 1, 0), false)
  assert.equal(updated.connects(40, 0, 0, 1, 0), true)
  assert.deepEqual(updated.fencesAt(40, 0, 0), [added])
  assert.deepEqual(updated.fencesAt(40, 0, 5), [])
})

test('1024 remote fences cause no preview models, document scans or batch rebuilds', () => {
  const f = fixture([createModule('fence', 0, 0, 0, 'end')], 1024)
  try {
    const before = f.modules.batches.root.children.map(mesh => [mesh, mesh.geometry])
    const remote = f.root('remote-0'), hidden = f.root('remote-1')
    const original = shape(remote), layers = remote.children[0].layers.mask
    const groups = f.modules.fenceGroups
    let batchSyncs = 0, builds = 0, disposed = 0
    const sync = f.modules.syncBatches.bind(f.modules)
    f.modules.syncBatches = (...args) => { batchSyncs++; return sync(...args) }
    f.modules.buildModules = () => { builds++ }
    for (const [mesh, geometry] of before) {
      geometry.addEventListener('dispose', () => disposed++)
      mesh.addEventListener('dispose', () => disposed++)
    }
    for (let length = 1; length <= 4; length++) {
      const list = Array.from({ length }, (_, i) => createModule('fence', i + 1, 0, 0, 'preview'))
      f.ghost.setFencePreview(list)
      assert.equal(f.ghost.fencePreviewGroup.children.length, length + 1, 'only the run plus its adjacent end')
      assert.equal(f.root('end').visible, false)
      assert.equal(hidden.visible, false, 'hidden storeys stay hidden')
      assert.equal(remote.visible, true)
      assert.equal(remote.children[0].layers.mask, layers, 'a remote bucket remains batched')
      assert.deepEqual(shape(remote), original)
      const built = f.ghost.fencePreviewGroup.children.find(g => g.userData.moduleId === 'end')
      const expected = new FenceModel({ mats: f.materials, data: { ...f.data, modules: [...f.data.modules, ...list] } }).build(f.data.modules[0])
      batchStaticModule(expected, 'fence')
      assert.deepEqual(shape(built), shape(expected), 'the connected end matches a complete committed rebuild')
      disposeObject(expected)
      const children = [...f.ghost.fencePreviewGroup.children]
      f.ghost.setFencePreview(list)
      assert.deepEqual(f.ghost.fencePreviewGroup.children, children, 'unchanged pointer cells retain their preview allocations')
    }
    // The reference-model comparisons above explicitly iterate the document.
    assert.equal(f.reads(), 4, 'the preview itself never scans the document')
    f.ghost.clearFencePreview(); f.ghost.clearFencePreview()
    assert.equal(f.root('end').visible, true)
    assert.equal(hidden.visible, false, 'cancel restores the original visibility rather than enabling every fence')
    assert.equal(f.modules.fenceGroups, groups)
    assert.equal(batchSyncs, 0); assert.equal(builds, 0); assert.equal(disposed, 0)
    for (const [i, [mesh, geometry]] of before.entries()) {
      assert.equal(f.modules.batches.root.children[i], mesh)
      assert.equal(mesh.geometry, geometry)
      assert.equal(mesh.visible, true)
    }
  } finally { f.close() }
})

test('local replacements follow level changes, ghosting and clipping during a drag', () => {
  const f = fixture([createModule('fence', 0, 0, 0, 'end'), createModule('fence', 0, 0, -5, 'lower')])
  try {
    f.ghost.setFencePreview([createModule('fence', 1, 0, 0, 'preview')])
    const replacement = f.ghost.fencePreviewGroup.children.find(g => g.userData.moduleId === 'end')
    f.level.setLevel(-5, false)
    assert.equal(replacement.visible, false)
    assert.equal(f.root('end').visible, false, 'the replaced committed panel stays masked across a storey change')
    assert.equal(f.root('lower').visible, true)
    f.level.setLevel(5, true)
    assert.equal(replacement.visible, true)
    replacement.traverse(o => { if (o.isMesh) assert.equal(o.material.opacity, .35) })
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
    f.ctx.cutaway = true; f.level.setClip(plane)
    replacement.traverse(o => { if (o.isMesh) assert.equal(o.material.clippingPlanes[0], plane) })
    f.ctx.cutaway = false; f.level.setClip(null); f.level.setLevel(-5, false)
    f.ghost.clearFencePreview()
    assert.equal(f.root('end').visible, false, 'cancel respects the current storey after a view change')
    assert.equal(f.root('lower').visible, true)
  } finally { f.close() }
})

test('a fence hover joins the committed end without copying the station document', () => {
  const f = fixture([createModule('fence', 0, 0, 0, 'end')])
  try {
    const hover = createModule('fence', 1, 0, 0, 'hover')
    f.ghost.setModulePreview(hover)
    const built = f.ghost.previewGroup.children[0]
    const expected = new FenceModel({ mats: f.materials, data: { ...f.data, modules: [...f.data.modules, hover] } }).build(hover)
    batchStaticModule(expected, 'fence')
    try {
      assert.deepEqual(shape(built), shape(expected), 'the hover drops the committed end cap and joins its run')
    } finally { disposeObject(expected) }
  } finally { f.close() }
})

test('a local replacement masks its equipment bucket while its neighbour keeps drawing', () => {
  const f = fixture([createModule('fence', 0, 0, 0, 'west'), createModule('fence', 2, 0, 0, 'east')])
  try {
    const west = f.root('west'), east = f.root('east')
    const meshLayers = (root) => {
      const masks = []
      root.traverse(o => { if (o.isMesh) masks.push(o.layers.mask) })
      return masks
    }
    const entriesFor = (root) => [...(f.modules.batches.entriesByRoot.get(root) ?? [])]
    const shared = entriesFor(west).filter(entry => entriesFor(east).includes(entry))
    assert.ok(shared.length > 0, 'the two isolated fences share their 16 m equipment buckets')
    const original = meshLayers(west), batchBit = 1 << BATCH_SOURCE_LAYER
    assert.ok(shared.every(entry => entry.mesh.visible))
    assert.ok(original.some(mask => (mask & batchBit) !== 0), 'the committed fences draw batched parts')
    f.ghost.setFencePreview([createModule('fence', 3, 0, 0, 'preview')])
    assert.ok(shared.every(entry => !entry.mesh.visible), 'the replaced joint masks its buckets')
    assert.equal(west.visible, true, 'the unreplaced member of those buckets is not a preview root')
    assert.equal(east.visible, false, 'only the adjacent joint is replaced')
    assert.ok(meshLayers(west).every(mask => (mask & batchBit) === 0), 'the unreplaced member draws from its source')
    assert.ok(meshLayers(east).every(mask => (mask & batchBit) === 0))
    f.ghost.clearFencePreview()
    assert.ok(shared.every(entry => entry.mesh.visible), 'cancel restores the buckets without rebuilding them')
    assert.deepEqual(meshLayers(west), original, 'every source returns to the batch layer')
    assert.deepEqual(meshLayers(east), original)
  } finally { f.close() }
})

test('only orthogonal same-height ordinary fences need a live joint replacement', () => {
  const mods = [createModule('fence', 0, 0, 0, 'west'), createModule('fence-iron', 1, 1, 0, 'north'),
    createModule('fence', 2, 1, 0, 'diagonal'), createModule('fence', 1, 0, -5, 'lower'),
    createModule('noise-barrier', 2, 0, 0, 'barrier')]
  const f = fixture(mods)
  try {
    f.ghost.setFencePreview([createModule('fence', 1, 0, 0, 'preview')], true)
    assert.equal(f.ghost.fencePreviewGroup.children.length, 3, 'two adjacent joints plus the refused-colour candidate')
    assert.equal(f.root('west').visible, false); assert.equal(f.root('north').visible, false)
    assert.equal(f.root('diagonal').visible, true); assert.equal(f.root('barrier').visible, true)
    assert.equal(f.root('lower').visible, false)
    const previews = [...f.ghost.fencePreviewGroup.children]
    let releases = 0
    const geometries = new Set(), materials = new Set()
    for (const group of previews) group.traverse(o => {
      if (!o.isMesh) return
      geometries.add(o.geometry)
      if (group.userData.moduleId === undefined) materials.add(o.material)
    })
    for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => releases++)
    f.modules.setMovingModule('west')
    f.ghost.setFencePreview(null)
    assert.equal(f.root('west').visible, false, 'clearing a preview preserves a simultaneous move mask')
    f.modules.setMovingModule(null)
    assert.equal(f.root('west').visible, true, 'overlapping move/preview masks restore the original visibility')
    assert.equal(releases, geometries.size, 'cancel releases geometry and retains the shared preview shader owners')
    f.ghost.clearFencePreview()
    assert.equal(releases, geometries.size, 'repeated cancellation does not release retained materials')
    f.ghost.dispose()
    assert.equal(releases, geometries.size + materials.size)
    assert.ok(f.root('west').children.some(o => o.isMesh && o.layers.isEnabled(BATCH_SOURCE_LAYER)), 'the committed source returns to its batch')
  } finally { f.close() }
})
