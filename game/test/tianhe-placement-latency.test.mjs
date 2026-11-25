import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { emptyStation } from '../src/data/reference-station.ts'
import {
  addEquipment,
  addFloor,
  addWalls,
  createModule,
  hasBridgeOrBridgePillar,
  nextModuleId,
  placeFacility,
  syncAutoWalls,
  syncBridgePillars,
  toData,
  toState,
} from '../src/build/model.ts'
import { makeTrack } from '../src/build/rail.ts'
import { clearContactFinishes } from '../src/sim/contactFinishes.ts'
import { groundWindow, withGround } from '../src/sim/ground.ts'
import { applyStationEdit, stationEdit } from '../src/sim/stationEdit.ts'
import { localCellEdit } from '../src/render/localCellEdit.ts'
import { isEquipmentModelEdit, changedModules } from '../src/render/moduleDependencies.ts'
import { StationGeometry } from '../src/app/stationGeometry.ts'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { createMaterials, cellHasCustomFinish, moduleHasCustomFinish } from '../src/render/materials.ts'
import { createModelMaterials, disposeModelMaterials } from '../src/render/models.ts'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

await geometryDetailReady

const triangleSnapshot = (chunks) => chunks.chunkMeshes.map((m) => {
  const hash = createHash('sha256')
  const attributes = Object.values(m.geometry.attributes)
  const indices = m.geometry.index.array
  const triangles = []
  const vertices = []
  const vertex = (i) => {
    if (vertices[i] !== undefined) return vertices[i]
    let value = ''
    for (const a of attributes) {
      for (let j = 0; j < a.itemSize; j++) value += `${a.array[i * a.itemSize + j]},`
    }
    return (vertices[i] = value)
  }
  for (let i = 0; i < indices.length; i += 3) {
    const v = [vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2])]
    const start = v[0] <= v[1] && v[0] <= v[2] ? 0 : v[1] <= v[2] ? 1 : 2
    triangles.push(`${v[start]}|${v[(start + 1) % 3]}|${v[(start + 2) % 3]}`)
  }
  hash.update(triangles.sort().join('\n'))
  return JSON.stringify([
    m.userData.levelZ,
    !!m.userData.ground,
    !!m.userData.suspendedCeiling,
    !!m.userData.float,
    hash.digest('hex'),
  ])
}).sort()

function installCanvasDoc() {
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => {
      const { g } = stubCanvas(256, 256)
      const ctx = {
        ...g,
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {},
      }
      return { width: 256, height: 256, getContext: () => ctx }
    },
  }
  return () => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

function withModuleScene(fn) {
  const restore = installCanvasDoc()
  const modelMats = createModelMaterials()
  const mat = new THREE.MeshBasicMaterial()
  const blob = new THREE.MeshBasicMaterial()
  const mats = { finish: () => mat, outline: mat, blob, equipmentBlob: blob }
  const ctx = new SceneContextData(new THREE.Scene(), mats, modelMats, { ready: () => false, materialFor: () => mat })
  const chunks = new ChunkSystem(ctx)
  const modules = new ModuleSystem(ctx)
  const level = new LevelSystem(ctx)
  modules.trains = { psdGroups: [] }
  modules.lifts = { escalatorRolls: [], liftRigs: [], liftPickMeshes: [] }
  modules.crowd = { gateWings: [], activitySinks: [], swingDoors: [] }
  modules.plates = {
    adScreens: [],
    tvScreens: [],
    railSignals: [],
    ownsTexture: () => false,
    retainTvPlates: () => {},
    retainSignPlates: () => {},
    retainDecorPlates: () => {},
    clearTvPlates: () => {},
    clearSignPlates: () => {},
    clearDecorPlates: () => {},
    makeTvPlate: () => mat,
    makeSignPlate: () => mat,
    makeCalligraphyPlate: () => mat,
    makeLineMapPlate: () => mat,
    updateRailSignals: () => {},
  }
  modules.clocks = { clockRigs: [] }
  modules.ghost = { clearFencePreview: () => {}, refreshFencePreviewLevels: () => {} }
  level.chunks = chunks
  level.modules = modules
  level.trains = { trainGroup: new THREE.Group() }
  try {
    return fn({ ctx, chunks, modules, level })
  } finally {
    modules.clearModules()
    modules.disposeSelection()
    chunks.disposeChunks()
    disposeModelMaterials(modelMats)
    mat.dispose()
    blob.dispose()
    restore()
  }
}

test('checkout variants are equipment-only edits and recognised by ChunkSystem prepared diffs', () => {
  const base = {
    ...emptyStation(),
    cells: [{ x: -32, y: -32, z: -5, fill: 'solid' }, { x: 32, y: 32, z: -5, fill: 'solid' }],
    modules: [],
  }
  const cache = new StationGeometry()
  const prepared = cache.resolve(base)
  for (const paletteId of ['checkout', 'checkout-cafe-pastry', 'checkout-bakery']) {
    const mod = createModule(paletteId, 0, 0, -5, paletteId)
    assert.ok(mod && mod.type === 'checkout', paletteId)
    const after = { ...base, modules: [mod] }
    assert.equal(isEquipmentModelEdit(base, after), true, `${paletteId} skips chunk remeshing`)
    assert.equal(cache.resolve(after), prepared, `${paletteId} retains StationGeometry`)
  }
})

test('z === 0 contact-finish strip and groundWindow-expanding auto-walls match fresh geometry through place and undo', () => {
  const baseCells = []
  for (let x = -20; x <= 20; x++) {
    for (let y = -10; y <= 10; y++) {
      baseCells.push({ x, y, z: -5, fill: 'solid' })
    }
  }
  // A painted-ground cell at z = 0 with a bottom ceiling finish that a wall underneath strips.
  baseCells.push({
    x: 0,
    y: 0,
    z: 0,
    fill: 'solid',
    zone: 'outside',
    tags: ['painted-ground'],
    finish: { bottom: 'ceil.baffle' },
  })
  const baseState = toState({ ...emptyStation(), cells: baseCells, modules: [] })
  const baseData = toData(baseState)

  // 1) Wall placement underneath (0, 0, 0): appends wall courses z=-4..-1 and clears finish.bottom at z=0.
  const wallAdded = addWalls(baseState, [[0, 0, -4]], null, 4).state
  const wallCleaned = { ...wallAdded, cells: clearContactFinishes(wallAdded.cells, baseState.cells) }
  const wallData = toData(wallCleaned)
  assert.deepEqual(
    wallCleaned.cells,
    clearContactFinishes(wallAdded.cells),
    'incremental clearContactFinishes matches full pass',
  )
  const wallLocal = localCellEdit(baseData, wallData)
  assert.ok(wallLocal, 'z === 0 finish strip + wall append is a bounded localCellEdit')
  assert.equal(wallLocal.removed.length, 1)
  assert.equal(wallLocal.removed[0].z, 0)
  assert.equal(wallLocal.added.length, 5)

  // 2) Auto-wall floor outside current bounds: expands groundWindow and authors (30, 0, 0) over generated street.
  const floorState = addFloor(wallCleaned, [[30, 0, -5]])
  const floorData = toData(floorState)
  const floorLocal = localCellEdit(wallData, floorData)
  assert.ok(floorLocal, 'bounded groundWindow expansion with z === 0 auto-wall cap is a localCellEdit')
  assert.ok(floorLocal.added.some((c) => c.z === 0), 'auto-wall reaches z === 0')
  assert.ok(
    groundWindow(floorData.cells, floorData.modules).x1 > groundWindow(wallData.cells, wallData.modules).x1,
    'groundWindow expanded',
  )

  // 3) Digging a z = 0 void hole over an underground solid cell exposes the floor underneath.
  const dugData = {
    ...baseData,
    cells: [...baseData.cells, { x: 5, y: 0, z: -1, fill: 'solid' }, { x: 5, y: 0, z: 0, fill: 'void' }],
  }
  assert.ok(localCellEdit(baseData, dugData))

  // Verify StationGeometry AND ChunkSystem match fresh builds across place, expand, undo, and hole dig.
  const mat = new THREE.MeshBasicMaterial()
  const makeChunks = () => {
    const ctx = new SceneContextData(new THREE.Scene(), { finish: () => mat, outline: mat }, {}, {})
    return { ctx, chunks: new ChunkSystem(ctx) }
  }
  const live = makeChunks()
  const geom = new StationGeometry()
  try {
    const steps = [baseData, wallData, floorData, wallData, baseData, dugData, baseData]
    for (const [idx, data] of steps.entries()) {
      const actualGeom = geom.resolve(data)
      const freshGeom = new StationGeometry().resolve(data)
      assert.deepEqual(actualGeom, freshGeom, `StationGeometry parity at step ${idx}`)

      live.chunks.prepareStation(data, actualGeom.ground)
      live.chunks.meshStation()

      const fresh = makeChunks()
      try {
        fresh.chunks.prepareStation(data, freshGeom.ground)
        fresh.chunks.meshStation()
        assert.deepEqual(triangleSnapshot(live.chunks), triangleSnapshot(fresh.chunks), `ChunkSystem triangles at step ${idx}`)
        assert.deepEqual([...live.ctx.solid].sort((a, b) => a - b), [...fresh.ctx.solid].sort((a, b) => a - b), `solid parity at step ${idx}`)
        assert.deepEqual([...live.ctx.groundOf.entries()].sort(), [...fresh.ctx.groundOf.entries()].sort(), `groundOf parity at step ${idx}`)
      } finally {
        fresh.chunks.disposeChunks()
      }

      if (idx === 1) {
        assert.equal(live.chunks.chunkKeyCellVisits, 0, 'wall remesh took local chunk path without full station hash')
        assert.ok(live.chunks.meshedCellVisits < actualGeom.ground.length, `wall remesh stayed local (${live.chunks.meshedCellVisits})`)
      }
      if (idx === 2) {
        assert.equal(live.chunks.chunkKeyCellVisits, 0, 'auto-wall expansion took local chunk path without full station hash')
        assert.ok(live.chunks.groundTemplateHits > 0, 'expanded ground border strips hit plainGround templates')
        assert.ok(live.chunks.meshedCellVisits < actualGeom.ground.length, `auto-wall remesh stayed bounded (${live.chunks.meshedCellVisits})`)
      }
      if (idx === 3) {
        assert.equal(live.chunks.chunkKeyCellVisits, 0, 'auto-wall undo took local chunk path')
      }
    }
  } finally {
    live.chunks.disposeChunks()
    mat.dispose()
  }
})

test('sparse stationEdit encodes mid-array contact-finish mutation plus tail append/remove without null fallback', () => {
  const cells = Array.from({ length: 2000 }, (_, i) => ({
    x: i % 50,
    y: Math.floor(i / 50),
    z: 0,
    fill: 'solid',
    finish: i === 500 || i === 1200 ? { bottom: 'ceil.baffle' } : undefined,
  }))
  const before = { ...emptyStation(), cells, modules: [] }
  const nextCells = cells.slice()
  nextCells[500] = { x: cells[500].x, y: cells[500].y, z: 0, fill: 'solid' }
  nextCells[1200] = { x: cells[1200].x, y: cells[1200].y, z: 0, fill: 'solid' }
  nextCells.push({ x: 10, y: 10, z: -4, fill: 'solid', tags: ['wall'] })
  nextCells.push({ x: 10, y: 10, z: -3, fill: 'solid', tags: ['wall'] })
  const after = { ...before, cells: nextCells }

  const forward = stationEdit(before, after)
  assert.ok(forward && forward.cells, 'sparse forward edit does not fall back to null')
  assert.deepEqual(applyStationEdit(before, forward), after, 'forward sparse edit round-trips exactly')

  const undo = stationEdit(after, before)
  assert.ok(undo && undo.cells, 'sparse undo edit does not fall back to null')
  assert.deepEqual(applyStationEdit(after, undo), before, 'undo sparse edit round-trips exactly')
})

test('incremental build helpers preserve cells identity, monotonic IDs across in-place push, and bridge early-out', () => {
  // 1) nextModuleId with immutable appends and in-place .push() (as used in addAutoFurniture)
  const mods = [createModule('bench', 0, 0, 0, 'bench-1'), createModule('gate', 1, 0, 0, 'gate-10')]
  assert.equal(nextModuleId(mods, 'bench'), 'bench-11')
  const mut = [...mods]
  const idA = nextModuleId(mut, 'bench')
  mut.push(createModule('bench', 2, 0, 0, idA))
  const idB = nextModuleId(mut, 'bench')
  assert.notEqual(idA, idB, 'in-place push never causes duplicate IDs')
  assert.equal(idB, 'bench-12')

  // 2) placeFacility (booth ticket/info) preserves cells reference identity when add is empty
  const floorCells = []
  for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6; y++) floorCells.push({ x, y, z: -5, fill: 'solid' })
  const state = toState({ ...emptyStation(), cells: floorCells, modules: [] })
  const withBooth = placeFacility(state, 'ticket', { x0: 1, y0: 1, x1: 3, y1: 3, z: -5 })
  assert.equal(withBooth.cells, state.cells, 'booth placement keeps identical cells array reference')
  assert.ok(withBooth.modules.some((m) => m.type === 'booth'))
  assert.equal(changedModules(toData(state), toData(withBooth)).length, withBooth.modules.length)

  // 3) syncBridgePillars early-outs with zero work when no bridges exist, and still works when a bridge exists
  assert.equal(hasBridgeOrBridgePillar(withBooth.modules), false)
  assert.equal(syncBridgePillars(withBooth), withBooth)
  const bridge = makeTrack({ id: 'track-1', x: 0, y: 0, z: 5, w: 12, d: 3, rot: 0, lineId: '1', dir: 'up', power: 'third-rail', bridge: true })
  const withBridge = syncBridgePillars({ ...state, modules: [bridge] })
  assert.equal(hasBridgeOrBridgePillar(withBridge.modules), true)
  assert.ok(withBridge.modules.some((m) => m.type === 'pillar' && m.cfg.bridgeId === 'track-1'))

  // 4) syncAutoWalls parity across incremental addFloor + merge
  const firstPatch = addFloor(state, [[10, 0, -5], [11, 0, -5]])
  assert.deepEqual(syncAutoWalls(firstPatch), firstPatch)
  const secondPatch = addFloor(firstPatch, [[12, 0, -5]])
  assert.ok(secondPatch.cells.some((c) => c.x === 12 && c.y === 0 && c.z === 0 && c.tags?.includes('auto-wall')))
})

test('incremental ModuleSystem delta build and EquipmentBatches delta sync match fresh builds across add, move, couple, delete, and external transform', () => {
  const baseCells = []
  for (let x = -4; x <= 20; x++) for (let y = -4; y <= 10; y++) baseCells.push({ x, y, z: 0, fill: 'solid' })
  const baseModules = [
    ...Array.from({ length: 16 }, (_, i) => createModule('lawn', i, 8, 0, `lawn-${i}`)),
    createModule('bench-steel-1', 0, 0, 0, 'bench-1'),
    createModule('bench-steel-1', 2, 0, 0, 'bench-2'),
    createModule('fence', 6, 0, 0, 'fence-1', 0),
    createModule('checkout', 10, 0, 0, 'checkout-1', 0),
  ]
  const s0 = { ...emptyStation(), cells: baseCells, modules: baseModules }
  const s1 = { ...s0, modules: [...s0.modules, createModule('checkout-cafe-pastry', 12, 0, 0, 'checkout-2', 0)] }
  const s2 = { ...s1, modules: [...s1.modules, createModule('fence', 7, 0, 0, 'fence-2', 0)] }
  const s3 = {
    ...s2,
    modules: s2.modules.map((m) => (m.id === 'bench-1' ? { ...m, x: 4, y: 2 } : m)),
  }
  const s4 = { ...s3, modules: s3.modules.filter((m) => m.id !== 'bench-2') }

  const batchSummary = (modules) => ({
    batchedDrawCount: modules.batches.root.children.length,
    sourceOnlyIds: [...modules.moduleMeshes.children]
      .filter((r) => modules.batches.isFullyBatched(r))
      .map((r) => r.userData.moduleId)
      .sort(),
    moduleIds: [...modules.moduleRootsById.keys()].sort(),
    blobCount: modules.moduleMeshes.children
      .filter((r) => typeof r.userData.contactBlobKey === 'string')
      .reduce((sum, r) => sum + r.count, 0),
  })

  withModuleScene(({ ctx, modules, level }) => {
    const syncState = (s, reuse) => {
      ctx.stationData = s
      modules.buildModules(s, new Set(), reuse)
      ctx.levelKey = ''
      level.applyLevel()
    }
    syncState(s0, false)

    // 1) Append checkout-cafe-pastry -> delta path rebuilds 1 root, dirtyLevelRoots has only touched roots
    ctx.stationData = s1
    modules.buildModules(s1, new Set(), true)
    assert.ok(modules.dirtyLevelRoots && modules.dirtyLevelRoots.size <= 2, 'only added checkout (and optional new blob) marked dirty')
    ctx.levelKey = ''
    level.applyLevel()
    assert.equal(modules.batches.lastSync.rebuilt, 1, 'EquipmentBatches delta sync rebuilt only the added checkout')
    withModuleScene((fresh) => {
      fresh.ctx.stationData = s1
      fresh.modules.buildModules(s1, new Set())
      fresh.ctx.levelKey = ''
      fresh.level.applyLevel()
      assert.deepEqual(batchSummary(modules), batchSummary(fresh.modules), 'append checkout matches fresh build')
    })

    // 2) Append adjacent fence -> rebuilds fence-2 AND coupled neighbour fence-1
    syncState(s2, true)
    assert.equal(modules.batches.lastSync.rebuilt, 2, 'coupled fence neighbour and new fence both rebuilt')
    withModuleScene((fresh) => {
      fresh.ctx.stationData = s2
      fresh.modules.buildModules(s2, new Set())
      fresh.ctx.levelKey = ''
      fresh.level.applyLevel()
      assert.deepEqual(batchSummary(modules), batchSummary(fresh.modules), 'coupled fence matches fresh build')
    })

    // 3) Move bench-1 in-place -> contact blob preserves slot index and emits single-slot update range
    const blobBefore = modules.moduleMeshes.children.find((r) => typeof r.userData.contactBlobKey === 'string')
    const slotBefore = blobBefore.userData.contactBlobIds.indexOf('bench-1')
    assert.ok(slotBefore >= 0)
    blobBefore.instanceMatrix.clearUpdateRanges()
    ctx.stationData = s3
    modules.buildModules(s3, new Set(), true)
    assert.equal(blobBefore.userData.contactBlobIds.indexOf('bench-1'), slotBefore, 'move preserves contact blob slot')
    assert.deepEqual(blobBefore.instanceMatrix.updateRanges, [{ start: slotBefore * 16, count: 16 }])
    ctx.levelKey = ''
    level.applyLevel()
    withModuleScene((fresh) => {
      fresh.ctx.stationData = s3
      fresh.modules.buildModules(s3, new Set())
      fresh.ctx.levelKey = ''
      fresh.level.applyLevel()
      assert.deepEqual(batchSummary(modules), batchSummary(fresh.modules), 'in-place move matches fresh build')
    })

    // 4) Delete bench-2 -> unbatches lone surviving bench-1 cleanly
    syncState(s4, true)
    withModuleScene((fresh) => {
      fresh.ctx.stationData = s4
      fresh.modules.buildModules(s4, new Set())
      fresh.ctx.levelKey = ''
      fresh.level.applyLevel()
      assert.deepEqual(batchSummary(modules), batchSummary(fresh.modules), 'deletion unbatch matches fresh build')
    })

    // 5) Direct external transform mutation still invalidates cached views and rebakes
    const benchRoot = modules.moduleRootsById.get('bench-1')
    benchRoot.position.x += 5
    modules.syncBatches()
    assert.equal(modules.batches.lastSync.rebuilt, 1, 'external transform mutation is detected and rebaked')
  })
})

test('MaterialSet custom finish tracking avoids redundant full-station scans while pruning preview shades', () => {
  const restore = installCanvasDoc()
  const mats = createMaterials()
  try {
    assert.equal(mats.hasCustomFinishes(), false)
    assert.equal(mats.hasUnretainedCustomFinishes(), false)
    mats.finish('floor.granite')
    assert.equal(mats.hasCustomFinishes(), false, 'stock finishes never flip custom tracking')
    mats.finish('wall.enamel#112233')
    assert.equal(mats.hasCustomFinishes(), true)
    assert.equal(mats.hasUnretainedCustomFinishes(), true)
    assert.equal(cellHasCustomFinish({ x: 0, y: 0, z: 0, fill: 'solid', finish: { n: 'wall.enamel#112233' } }), true)
    assert.equal(cellHasCustomFinish({ x: 0, y: 0, z: 0, fill: 'solid', finish: { bottom: 'ceil.baffle' } }), false)
    assert.equal(moduleHasCustomFinish(createModule('bench', 0, 0, 0, 'b')), false)
    mats.retain(new Set(['floor.granite', 'wall.enamel#112233']))
    assert.equal(mats.hasCustomFinishes(), true)
    assert.equal(mats.hasUnretainedCustomFinishes(), false, 'retain clears unretained flag while keeping custom count')
    mats.retain(new Set(['floor.granite']))
    assert.equal(mats.hasCustomFinishes(), false, 'pruning last custom finish clears custom count')
  } finally {
    mats.dispose()
    restore()
  }
})
