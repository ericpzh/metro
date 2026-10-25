import test from 'node:test'
import { SINGLE_MODEL_OPTIONS } from './support/palette-models.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { useStore } from '../src/app/store.ts'
import { createModule, cellKey, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { buildModule, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { modelNeighbours, modelCellAt } from '../src/render/modelNeighbours.ts'
import { ModulePreviewDocument } from '../src/render/modulePreviewDocument.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { PreviewMaterialCache } from '../src/render/previewMaterialCache.ts'
import { tactileAt, tactileArms } from '../src/sim/floorDecor.ts'
import { placementColliders } from '../src/sim/placement.ts'
import { tvPairSlot } from '../src/sim/tvs.ts'
import { clearToolPreview } from '../src/app/tools/clearPreview.ts'
import { PaintTool } from '../src/app/tools/PaintTool.ts'
import { ZoneTool } from '../src/app/tools/ZoneTool.ts'
import { PlatformTool } from '../src/app/tools/PlatformTool.ts'
import { TunnelTool } from '../src/app/tools/TunnelTool.ts'
import { multiPlaceFor } from '../src/app/tools/geometry/multiPlaceDrag.ts'
import { StablePreviewDelay } from '../src/app/tools/geometry/stablePreviewDelay.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

function drawing(run) {
  const old = globalThis.document
  globalThis.document = { createElement() { const node = { width: 512, height: 256 }, { g } = stubCanvas(); g.canvas = node; node.getContext = () => g; return node } }
  const mats = createModelMaterials(), owned = [], textures = []
  const ads = { adFace: () => ({ geometry: new THREE.PlaneGeometry(1, 1), material: mats.desktopScreen }), adWindow: () => ({ geometry: new THREE.PlaneGeometry(1, 1), material: mats.desktopScreen }) }
  function context(data, candidates) {
    return { mats, ads, data, preview: true, previewCandidates: candidates, owned, trackCells: new Set(), finish: () => mats.white,
      tvPairSlot: id => tvPairSlot(id, modelNeighbours({ data, previewCandidates: candidates }, 'tv')),
      tvPlate: () => { const texture = new THREE.CanvasTexture(document.createElement('canvas')); textures.push(texture); return texture } }
  }
  try { run({ mats, context, owned }) }
  finally { for (const material of new Set(owned)) material.dispose(); for (const texture of textures) texture.dispose(); disposeModelMaterials(mats); globalThis.document = old }
}

function geometry(root) {
  root.updateMatrixWorld(true)
  const hash = createHash('sha256')
  root.traverse(object => {
    if (!object.isMesh) return
    hash.update(JSON.stringify([object.matrixWorld.elements, object.count ?? 1, object.geometry.drawRange]))
    for (const [name, attribute] of Object.entries(object.geometry.attributes)) {
      hash.update(name); hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength))
    }
    if (object.geometry.index) hash.update(Buffer.from(object.geometry.index.array.buffer))
  })
  return hash.digest('hex')
}

test('every palette preview keeps the station document and matches the merged-document geometry', () => drawing(({ context }) => {
  const remote = SINGLE_MODEL_OPTIONS.map((option, i) => createModule(option.id, 100 + i * 4, 100, 0, `remote-${i}`))
  const station = { ...emptyStation(), modules: remote }, resolver = new ModulePreviewDocument()
  for (const option of SINGLE_MODEL_OPTIONS) {
    const mod = createModule(option.id, 0, 0, 0, 'candidate')
    assert.ok(mod, option.id)
    assert.equal(resolver.resolve(station, [mod], null), station, `${option.id}: no station copy`)
    const merged = buildModule(mod, context({ ...station, modules: [...remote, mod] }))
    const overlay = buildModule(mod, context(station, [mod]))
    try { assert.equal(geometry(overlay), geometry(merged), `${option.id}: exact geometry with stable support document`) }
    finally { disposeObject(merged); disposeObject(overlay) }
  }
}))

test('coupled candidate overlays preserve TV housing, tactile arms, stair lanes, curtain corners and bridge supports', () => drawing(({ context }) => {
  const stair = createModule('stair-straight', 0, 0, 0, 'stairs-a')
  stair.cfg.flight = 'wide'
  const secondStair = { ...stair, id: 'stairs-b', x: stair.x + 1, from: { ...stair.from, x: stair.from.x + 1 }, to: { ...stair.to, x: stair.to.x + 1 } }
  const pairs = [
    [createModule('tv', 0, 0, 0, 'a'), createModule('tv', 0, 0, 0, 'b', 2)],
    [createModule('tactile-warning', 0, 0, 0, 'a'), createModule('tactile-guide', 1, 0, 0, 'b')],
    [stair, secondStair],
    [createModule('curtain-wall', 0, 0, 0, 'a'), createModule('curtain-wall', 0, 0, 0, 'b', 1)],
    [createModule('bridge', 0, 0, 0, 'a'), createModule('pillar', 0, 0, 0, 'b')],
  ]
  for (const candidates of pairs) {
    const station = emptyStation()
    for (const mod of candidates) {
      const merged = buildModule(mod, context({ ...station, modules: candidates }))
      const overlay = buildModule(mod, context(station, candidates))
      try { assert.equal(geometry(overlay), geometry(merged), mod.type) }
      finally { disposeObject(merged); disposeObject(overlay) }
    }
  }
}))

test('preview neighbour and floor indexes retain ordered results and invalidate on immutable edits', () => {
  let reads = 0
  const base = createModule('tv', 0, 0, 0, 'base')
  const modules = new Proxy([base, ...Array.from({ length: 2048 }, (_, i) => createModule('bench', i, 40, 0, `b-${i}`))], {
    get(target, key, receiver) { if (key === 'filter' || key === 'map' || key === Symbol.iterator) reads++; return Reflect.get(target, key, receiver) },
  })
  const data = { modules }, candidates = [createModule('tv', 0, 0, 0, 'preview', 2)]
  const ctx = { data, previewCandidates: candidates }, first = modelNeighbours(ctx, 'tv')
  assert.deepEqual(first, [base, candidates[0]])
  const prepared = reads
  for (let i = 0; i < 20; i++) assert.equal(modelNeighbours(ctx, 'tv'), first)
  assert.equal(reads, prepared, 'all candidate builders reuse the same overlay and source projection')
  assert.deepEqual(modelNeighbours({ data: { modules: [] }, previewCandidates: candidates }, 'tv'), candidates)
  assert.equal(modelNeighbours({ data, previewCandidates: [base] }, 'tv').length, 1, 'hovering a placed source does not duplicate it')
  const cell = { x: 2, y: 3, z: 0, fill: 'solid', finish: { top: 'floor.concrete' } }, cells = [cell]
  assert.equal(modelCellAt(cells, 2, 3, 0), cell)
  assert.equal(modelCellAt(cells, 8, 3, 0), undefined)
  const changed = { ...cell, finish: { top: 'floor.tile' } }
  assert.equal(modelCellAt([changed], 2, 3, 0), changed)
})

test('a long tactile preview resolves neighbors once per snapshot instead of scanning per tile', () => {
  let reads = 0
  const list = Array.from({ length: 2048 }, (_, i) => createModule('tactile-warning', i, 0, 0, String(i)))
  const modules = new Proxy(list, { get(target, key, receiver) { if (key === Symbol.iterator || key === 'find') reads++; return Reflect.get(target, key, receiver) } })
  for (const module of list) assert.ok(tactileArms(module, modules).length > 0)
  assert.equal(reads, 1, 'first invocation builds one index for the whole run')
  assert.equal(tactileAt(modules, 1, 0, 0, 'guide'), undefined)
  assert.equal(tactileAt(modules, 1, 0, 0, 'warning'), list[1])
  assert.equal(tactileAt(list.slice(2), 1, 0, 0), undefined, 'deletion invalidates cached neighbours')
})

test('all equipment collision previews share a local broad phase with ordered blockers and broad-piece fallback', () => {
  let remoteReads = 0
  const remote = Array.from({ length: 2048 }, (_, i) => new Proxy(createModule('bench', 500 + i * 2, 500, 0, `remote-${i}`), {
    get(target, key, receiver) { if (['x', 'y', 'z', 'type'].includes(key)) remoteReads++; return Reflect.get(target, key, receiver) },
  }))
  const bin = createModule('bin', 0, 0, 0, 'first'), bench = createModule('bench', 0, 0, 0, 'second')
  const modules = [...remote, bin, bench], candidate = createModule('bench', 0, 0, 0, 'preview')
  assert.deepEqual(placementColliders(modules, candidate), [bin, bench])
  placementColliders(modules, createModule('fence', 10, 10, 0, 'fence-preview'))
  remoteReads = 0
  for (let i = 0; i < 32; i++) {
    assert.deepEqual(placementColliders(modules, candidate), [bin, bench])
    placementColliders(modules, createModule('fence', 10, 10, 0, 'fence-preview'))
  }
  assert.equal(remoteReads, 0, 'warm ordinary and fence previews never visit remote source modules')
  assert.deepEqual(placementColliders([...remote, bench], candidate), [bench], 'immutable deletion refreshes local buckets')
  const broad = { ...createModule('road', 0, 0, 0, 'broad'), x: -100000, y: -100000, w: 200000, d: 200000 }
  assert.deepEqual(placementColliders([bin, broad], candidate), [bin, broad], 'huge source pieces remain collision candidates without a huge bucket grid')
  assert.deepEqual(placementColliders([bin], broad), [bin], 'huge candidate queries fall back to the prepared entries')
})

test('preview materials cannot evict an active draw and keep live source properties', () => {
  const cache = new PreviewMaterialCache(1), a = new THREE.MeshBasicMaterial(), b = new THREE.MeshBasicMaterial(), tint = new THREE.Color(0x168cff)
  let released = 0
  cache.begin()
  const first = cache.get(a, tint, .72); first.addEventListener('dispose', () => released++)
  cache.get(b, tint, .72)
  assert.equal(released, 0, 'active materials survive even when the draw exceeds the dormant limit')
  cache.release()
  assert.equal(released, 1, 'cleared roots restore the bounded dormant cache')
  const material = cache.get(b, tint, .72)
  b.color.set(0xff0000)
  assert.equal(cache.get(b, tint, .72), material)
  assert.deepEqual(material.color, b.color.clone().lerp(tint, .72))
  cache.dispose(); a.dispose(); b.dispose()
})

test('all module ghosts share retained materials, invalidate with the document and release local materials once', () => drawing(({ mats }) => {
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => mats.white, owns: () => false }, mats, null)
  ctx.stationData = emptyStation()
  const ghost = new GhostSystem(ctx)
  ghost.clocks = { previewRigs: [] }; ghost.plates = { ownsTexture: () => false }
  try {
    const mod = createModule('curtain-wall', 0, 0, 0, 'preview')
    ghost.setModulePreview(mod)
    const first = ghost.previewGroup.children[0], material = first.children[0].material
    ghost.setModulePreview({ ...mod, x: 1 })
    assert.equal(ghost.previewGroup.children[0].children[0].material, material, 'glass uses the same cache as roof/fence previews')
    const current = ghost.previewGroup.children[0]
    ghost.setModulePreview({ ...mod, x: 1 })
    assert.equal(ghost.previewGroup.children[0], current, 'unchanged candidate skips the build')
    ctx.stationData = { ...ctx.stationData, modules: [createModule('door', 1, 0, 0, 'door')] }
    ghost.setModulePreview({ ...mod, x: 1 })
    assert.notEqual(ghost.previewGroup.children[0], current, 'station edits rebuild an unmoved preview')
    ghost.setModulePreview(createModule('road', 0, 0, 0, 'road'))
    const local = [...ghost.previewOwnedMats], counts = new Map(local.map(m => [m, 0]))
    for (const material of local) material.addEventListener('dispose', () => counts.set(material, counts.get(material) + 1))
    ghost.clearModulePreview()
    for (const count of counts.values()) assert.equal(count, 1, 'a builder base in the tint list has exactly one owner')
  } finally { ghost.dispose() }
}))

test('face previews grow past 4096, draw the final cell, retain the pool and dispose old GPU resources once', () => {
  const ctx = new SceneContextData(new THREE.Scene(), {}, {}, null), ghost = new GhostSystem(ctx)
  ghost.plates = { ownsTexture: () => false }; ghost.clocks = { previewRigs: [] }
  ghost.setRoadNodePreview([])
  assert.equal(ghost.roadNodes, null, 'clearing unrelated layers never allocates road handles')
  ghost.setFaceGhost([[0, 0, 0]], 'top', 0xffffff)
  const old = ghost.faceGhost, counts = [0, 0, 0]
  ;[old, old.geometry, old.material].forEach((resource, i) => resource.addEventListener('dispose', () => counts[i]++))
  const cells = Array.from({ length: 5000 }, (_, i) => [i % 100, Math.floor(i / 100), 0])
  ghost.setFaceGhost(cells, 'top', 0xffffff)
  assert.equal(ghost.faceGhost.count, 5000)
  assert.deepEqual(counts, [1, 1, 1])
  const matrix = new THREE.Matrix4(); ghost.faceGhost.getMatrixAt(4999, matrix)
  assert.equal(matrix.elements[12], 99.5); assert.equal(matrix.elements[13], 49.5)
  const prepared = ghost.faceGhost
  ghost.clearFaceGhost(); ghost.setFaceGhost([[1, 1, 0]], 'top', 0xffffff)
  assert.equal(ghost.faceGhost, prepared)
  ghost.dispose(); assert.deepEqual(counts, [1, 1, 1])
})

test('tool cancellation clears every preview layer and inactive rail tools cannot replace another ghost', () => {
  const calls = [], scene = Object.fromEntries(['setGhost', 'clearFaceGhost', 'setModulePreview', 'setFencePreview', 'setCollisionHighlight', 'setRoadNodePreview', 'setCursor'].map(name => [name, (...args) => calls.push([name, args])]))
  clearToolPreview(scene, true)
  assert.equal(calls.length, 7)
  const previous = useStore.getState()
  try {
    useStore.setState({ tool: 'block' })
    const context = { scene: () => scene, hover: { current: { cell: [0, 0, 0], place: [0, 0, 1], solid: true } } }
    calls.length = 0
    for (const Controller of [PlatformTool, TunnelTool]) new Controller(context).refreshHover()
    assert.deepEqual(calls, [])
    new PlatformTool(context).onMove({ hit: null })
    assert.equal(context.hover.current, null)
    assert.equal(calls.length, 7)
  } finally { useStore.setState(previous, true) }
})

test('paint and zone rectangles use the shared latest-target scheduler and cancel pending work on release', () => {
  const previous = useStore.getState()
  try {
    const cells = Array.from({ length: 10 }, (_, x) => ({ x, y: 0, z: 0, fill: 'solid' }))
    const station = toState({ ...emptyStation(), cells }), floors = new Set(cells.map(c => cellKey(c.x, c.y, c.z)))
    for (const Controller of [PaintTool, ZoneTool]) {
      const draws = [], timers = new Map(); let nextTimer = 0, commits = 0
      useStore.setState({ station, tool: Controller === PaintTool ? 'paint' : 'zone', paintMode: 'single', zoneBrush: 'paid', commit: () => commits++ })
      const scene = { setModulePreview() {}, setGhost() {}, setCursor() {}, clearFaceGhost() {}, setFaceGhost: cells => draws.push(cells) }
      const context = { scene: () => scene, pickModule: () => null, solids: () => floors, thins: () => new Map(), floors: () => floors,
        paint: { current: { active: true, face: 'top', anchor: [0, 0, 0], button: 0, downTime: -1000, sx: 0, sy: 0 } },
        zoneDrag: { current: { active: true, brush: 'paid', anchor: [0, 0, 0], target: [0, 0, 0], z: 0, downTime: -1000, sx: 0, sy: 0 } } }
      multiPlaceFor(context).delay = new StablePreviewDelay(undefined, callback => { const id = ++nextTimer; timers.set(id, () => { timers.delete(id); callback() }); return id }, id => timers.delete(id))
      const tool = new Controller(context)
      const pointer = x => ({ clientX: x * 20, clientY: 0, hit: { cell: [x, 0, 0], place: [x, 0, 1], normal: [0, 0, 1], solid: true } })
      tool.onMove(pointer(2)); tool.onMove(pointer(5))
      assert.equal(timers.size, 1); assert.equal(draws.length, 0)
      for (const run of timers.values()) run()
      assert.equal(draws.at(-1).length, 6, 'one draw for the latest target')
      assert.equal(commits, 0, 'preview never commits')
      tool.onMove(pointer(7)); tool.onUp(pointer(7))
      assert.equal(timers.size, 0, 'release cancels the stale preview callback')
      assert.equal(commits, 1, 'release retains the tool edit contract')
    }
  } finally { useStore.setState(previous, true) }
})
