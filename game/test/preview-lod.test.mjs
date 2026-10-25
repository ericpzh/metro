import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { useStore } from '../src/app/store.ts'
import { SINGLE_MODEL_OPTIONS } from './support/palette-models.mjs'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { buildModule, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { EquipmentPreview } from '../src/render/equipmentPreview.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { batchStaticModule } from '../src/render/batchStaticModule.ts'
import { detailHeight } from '../src/render/detailPolicy.ts'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { SceneContextData, moduleLevels } from '../src/render/scene/systems/SceneSystem.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { wallSide, moduleEnvelope } from '../src/sim/placement.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

await geometryDetailReady

function drawing(run) {
  const previous = globalThis.document
  globalThis.document = { createElement() { const node = { width: 512, height: 256 }, { g } = stubCanvas(); g.canvas = node; node.getContext = () => g; return node } }
  const mats = createModelMaterials(), owned = [], textures = []
  const ads = { adFace: () => ({ geometry: new THREE.PlaneGeometry(1, 1), material: mats.desktopScreen }), adWindow: () => ({ geometry: new THREE.PlaneGeometry(1, 1), material: mats.desktopScreen }) }
  const data = emptyStation()
  const context = { data, mats, ads, owned, preview: true, trackCells: new Set(), finish: () => mats.white,
    tvPlate() { const texture = new THREE.CanvasTexture(document.createElement('canvas')); textures.push(texture); return texture } }
  try { run({ context, mats }) }
  finally { for (const material of new Set(owned)) material.dispose(); for (const texture of textures) texture.dispose(); disposeModelMaterials(mats); globalThis.document = previous }
}

function triangles(...roots) {
  let total = 0
  for (const root of roots) root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.layers.isEnabled(0)) return
    if (mesh.isBatchedMesh) {
      for (let i = 0; i < mesh.instanceCount; i++) {
        if (!mesh.getVisibleAt(i)) continue
        const range = mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i))
        total += (mesh.geometry.index ? range.indexCount : range.vertexCount) / 3
      }
    } else total += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1)
  })
  return total
}

test('all single-model palette previews use placed equipment Low/High, distance, storey and Hide UI rules', () => drawing(({ context, mats }) => {
  const camera = new THREE.OrthographicCamera(-.0001, .0001, .0001, -.0001, .01, 10000)
  camera.position.set(0, -10, 10); camera.lookAt(0, 0, 1); camera.updateMatrixWorld()
  const tintContext = new SceneContextData(new THREE.Scene(), {}, mats, null), tinter = new GhostSystem(tintContext)
  tinter.clocks = { previewRigs: [] }; tinter.plates = { ownsTexture: () => false }
  try {
  for (const option of SINGLE_MODEL_OPTIONS) {
    const mod = createModule(option.id, 0, 0, 0, option.id)
    const placed = buildModule(mod, context), ghost = buildModule(mod, context)
    for (const root of [placed, ghost]) {
      root.userData.moduleType = mod.type; root.userData.levelZs = moduleLevels(mod)
    }
    batchStaticModule(placed, mod.type)
    batchStaticModule(ghost, mod.type)
    const tinted = []
    tinter.tintModuleGhost(ghost, mod, new THREE.Color(0x168cff), .72, tinted, [], () => true)
    const source = new THREE.Group(), target = new THREE.Group(), batches = new EquipmentBatches(), detail = new SourceGeometryDetail()
    source.add(placed); target.add(ghost)
    const preview = new EquipmentPreview(target)
    source.updateMatrixWorld(true); target.updateMatrixWorld(true)
    batches.sync(source, 'placed'); preview.sync()
    try {
      for (const policy of [
        { activeZ: 0, hideUI: false, graphicsQuality: 'high' },
        { activeZ: 0, hideUI: false, graphicsQuality: 'low' },
        { activeZ: 0, hideUI: true, graphicsQuality: 'low' },
        { activeZ: 20, hideUI: false, graphicsQuality: 'high' },
        { activeZ: 20, hideUI: true, graphicsQuality: 'high' },
        { activeZ: 0, hideUI: false, graphicsQuality: 'high', far: true },
        ...[.001, .01, .1, 1, 10].map(span => ({ activeZ: 0, hideUI: false, graphicsQuality: 'high', span })),
      ]) {
        const span = policy.far ? 1e6 : policy.span ?? .0001
        camera.left = camera.bottom = -span
        camera.right = camera.top = span
        camera.updateProjectionMatrix()
        detail.restore(); Object.assign(batches, policy)
        batches.root.updateMatrixWorld(true); batches.updateDetail(camera, 800)
        detail.apply(placed, detailHeight(placed.userData.levelZs, policy.activeZ, policy.hideUI, policy.graphicsQuality, 1) === 0)
        preview.update(policy, camera, 800)
        assert.equal(triangles(target, preview.batches.root), triangles(source, batches.root), `${option.id}: ${JSON.stringify(policy)}`)
      }
    } finally { preview.clear(); detail.restore(); batches.clear(); disposeObject(source); disposeObject(target); for (const material of tinted) material.dispose() }
  }
  } finally { tinter.dispose() }
}))

test('carried roofs retain authored Low geometry, distance detail and exact High restoration', () => drawing(({ mats }) => {
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => mats.white, owns: () => false }, mats, null)
  ctx.stationData = emptyStation(); ctx.activeZ = 0
  const ghost = new GhostSystem(ctx)
  ghost.clocks = { previewRigs: [] }; ghost.plates = { ownsTexture: () => false }
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .01, 10000)
  camera.position.set(0, -10, 10); camera.lookAt(0, 0, 1); camera.updateMatrixWorld()
  try {
    const mod = createModule('roof-truss', 0, 0, 0, 'roof')
    ctx.activeZ = moduleLevels(mod)[0]
    ghost.setModulePreview([mod, { ...mod, id: 'second', x: 12 }])
    const mesh = ghost.previewGroup.children[0].children[0], high = mesh.geometry
    ghost.updateDetail(camera, 800)
    assert.equal(mesh.geometry, high, 'near High quality keeps the full geometry')
    ctx.graphicsQuality = 'low'; ghost.updateDetail(camera, 800)
    assert.notEqual(mesh.geometry, high)
    assert.ok((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) < (high.index?.count ?? high.attributes.position.count))
    ctx.hideUI = true; ghost.updateDetail(camera, 800)
    assert.notEqual(mesh.geometry, high, 'Hide UI does not undo Low quality')
    ctx.graphicsQuality = 'high'; ghost.updateDetail(camera, 800)
    assert.equal(mesh.geometry, high)
    ctx.hideUI = false; camera.zoom = .00001; camera.updateProjectionMatrix(); ghost.updateDetail(camera, 800)
    assert.notEqual(mesh.geometry, high, 'a distant preview follows the same equipment distance threshold')
    ctx.detailEnabled = false; ghost.updateDetail(camera, 800)
    assert.equal(mesh.geometry, high)
  } finally { ghost.dispose() }
}))

test('long roof runs share placed spatial and storey LOD decisions', () => drawing(({ context, mats }) => {
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => mats.white, owns: () => false }, mats, null)
  ctx.stationData = emptyStation()
  const ghost = new GhostSystem(ctx), source = new THREE.Group(), batches = new EquipmentBatches(), detail = new SourceGeometryDetail()
  ghost.clocks = { previewRigs: [] }; ghost.plates = { ownsTexture: () => false }
  const mods = [0, 17, 33].flatMap(x => [0, 5].map(z => createModule('roof', x, 0, z, `${x}/${z}`)))
  for (const mod of mods) {
    const root = buildModule(mod, context)
    batchStaticModule(root, mod.type); root.userData.moduleType = mod.type; root.userData.levelZs = moduleLevels(mod)
    source.add(root)
  }
  source.updateMatrixWorld(true); batches.sync(source, 'placed'); ghost.setModulePreview(mods)
  const camera = new THREE.PerspectiveCamera(50, 1, .01, 10000)
  try {
    for (const distance of [2, 10, 50, 200, 1000]) for (const activeZ of [0, 5]) for (const graphicsQuality of ['high', 'low']) {
      camera.position.set(-distance, -distance, 10); camera.lookAt(0, 0, 1); camera.updateMatrixWorld()
      const policy = { activeZ, hideUI: false, graphicsQuality }
      Object.assign(ctx, policy); Object.assign(batches, policy)
      detail.restore(); batches.root.updateMatrixWorld(true); batches.updateDetail(camera, 800)
      for (const root of source.children) detail.apply(root, detailHeight(root.userData.levelZs, activeZ, false, graphicsQuality, 1) === 0)
      ghost.updateDetail(camera, 800)
      assert.equal(triangles(ghost.previewGroup, ghost.moduleDetail.batches.root), triangles(source, batches.root), JSON.stringify({ distance, ...policy }))
    }
  } finally { ghost.dispose(); detail.restore(); batches.clear(); disposeObject(source) }
}))

test('multi-material hover previews preserve every material slot', () => drawing(({ mats }) => {
  const ctx = new SceneContextData(new THREE.Scene(), { owns: () => false }, mats, null), ghost = new GhostSystem(ctx)
  ghost.clocks = { previewRigs: [] }; ghost.plates = { ownsTexture: () => false }
  const group = new THREE.Group(), source = [mats.steel, mats.white]
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), source))
  const owned = [], bases = []
  try {
    ghost.tintModuleGhost(group, { type: 'track' }, new THREE.Color(0x168cff), .72, owned, bases, () => true)
    assert.equal(group.children[0].material.length, source.length)
    for (let i = 0; i < source.length; i++) {
      assert.notEqual(group.children[0].material[i], source[i]); assert.equal(group.children[0].material[i].depthTest, false)
    }
  } finally { disposeObject(group); for (const material of owned) material.dispose(); ghost.dispose() }
}))

test('glass previews and commits use the same aimed course and rendered height at every rotation and shifted storey', () => drawing(({ context }) => {
  const previous = useStore.getState()
  try {
    for (const base of [0, 1, -9]) for (const rot of [0, 1, 2, 3]) for (const height of [1, 2]) for (const course of [1, 3, 5]) {
      const [dx, dy] = wallSide(rot), cells = []
      for (let z = base + 1; z <= base + 5; z++) cells.push({ x: dx, y: dy, z, fill: 'solid', tags: ['wall'] })
      cells.push({ x: 0, y: 0, z: base, fill: 'solid' })
      const station = toState({ ...emptyStation(), levelBase: 1, cells }), previews = []; let committed
      const scene = { setFencePreview() {}, setCursor() {}, setCollisionHighlight() {}, setModulePreview(mod) { if (mod) previews.push(mod) } }
      const tool = new EquipmentTool({ scene: () => scene, facing: () => [-dx, -dy], drag: { current: null }, hover: { current: null }, pickModule: () => null })
      useStore.setState({ station, tool: 'module', moduleType: `glass-1x${height}`, moduleRot: rot, commit: next => { committed = next }, setNotice() {} })
      const z = base + course, info = { clientX: 10, clientY: 10, button: 0, buttons: 0, shiftKey: false, preventDefault() {}, hit: {
        cell: [dx, dy, z], place: [0, 0, z], solid: true, normal: [-dx, -dy, 0], point: [dx + .5, dy + .5, z + .5],
      } }
      tool.onMove(info)
      const preview = previews.at(-1)
      assert.ok(preview)
      assert.equal(preview.z, z - 1, 'the bottom of the pane is the course the pointer aimed at')
      const group = buildModule(preview, { ...context, data: station })
      try {
        const bounds = new THREE.Box3().setFromObject(group), envelope = moduleEnvelope(preview)
        assert.ok(Math.abs(bounds.min.z - z) < 1e-6)
        assert.ok(Math.abs(bounds.max.z - (z + height)) < 1e-6)
        assert.equal(envelope.z0, z); assert.equal(envelope.z1, z + height)
      } finally { disposeObject(group) }
      tool.onDown(info)
      if (course + height - 1 <= 5) {
        assert.ok(committed, 'a supported preview commits')
        const placed = committed.modules.at(-1)
        assert.equal(placed.z, preview.z); assert.deepEqual(placed.cfg, preview.cfg)
      } else assert.equal(committed, undefined, 'a panel extending beyond the wall stays refused at its correct height')
    }
  } finally { useStore.setState(previous, true) }
}))
