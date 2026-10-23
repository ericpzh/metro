import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { PanelAtlas } from '../src/render/panelAtlas.ts'
import { BATCH_SOURCE_LAYER, equalGeometry } from '../src/render/batchGeometry.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { createModule } from '../src/build/model.ts'
import { createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { batchTrainDoors, batchTrainTransparent } from '../src/render/trainBatches.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { cameraRig } from './support/camera-rig.mjs'

function canvas(w = 32, h = 16) {
  const node = { width: w, height: h }, { g } = stubCanvas(w, h)
  g.canvas = node; node.getContext = () => g
  return node
}
function root(meshes, id = 'a', type = 'bench') {
  const group = new THREE.Group(); group.userData = { moduleId: id, moduleType: type, levelZs: [0] }
  group.add(...meshes); return group
}
function cleanup(group) { disposeObject(group) }

test('drawing skips only fully batched source trees and restores picks, masks and visibility after errors', () => {
  const material = new THREE.MeshBasicMaterial(), group = new THREE.Group(), batches = new EquipmentBatches()
  const make = id => root([new THREE.Mesh(new THREE.BoxGeometry(), material)], id)
  const a = make('a'), b = make('b'), rig = make('rig')
  const wing = new THREE.Mesh(new THREE.BoxGeometry(), material)
  rig.userData.wing = wing; rig.add(wing)
  group.add(a, b, rig)
  const camera = new THREE.PerspectiveCamera()
  try {
    batches.sync(group, 'first', 'generation')
    assert.throws(() => batches.withHiddenSources(camera, () => {
      assert.equal(a.visible, false); assert.equal(b.visible, false)
      assert.equal(rig.visible, true, 'a moving rig must keep its ordinary render traversal')
      throw new Error('draw failed')
    }), /draw failed/)
    assert.ok(a.visible && b.visible && rig.visible, 'picking and scene visibility must be restored on every exit')
    batches.setHiddenModule(a)
    batches.withHiddenSources(camera, () => {
      assert.equal(b.visible, true, 'neighbour sources restored by a masked bucket must draw')
    })
    batches.setHiddenModule(null)
    camera.layers.enable(BATCH_SOURCE_LAYER)
    batches.withHiddenSources(camera, () => assert.ok(a.visible && b.visible, 'source debug cameras retain source traversal'))
  } finally { batches.clear(); cleanup(group); material.dispose() }
})

test('batched static picking leaves skip local matrix composition and restore transform ownership', () => {
  const material = new THREE.MeshBasicMaterial(), group = new THREE.Group(), batches = new EquipmentBatches()
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material), b = a.clone()
  b.geometry = a.geometry.clone(); b.position.x = 2
  const source = root([a, b]); group.add(source)
  try {
    batches.sync(group, 'first', 'generation')
    assert.equal(a.matrixAutoUpdate, false)
    let compositions = 0
    const update = a.updateMatrix
    a.updateMatrix = function () { compositions++; return update.call(this) }
    group.updateMatrixWorld(true); group.updateMatrixWorld(true)
    assert.equal(compositions, 0, 'rendering must not recompose an immutable picking leaf')
    source.position.x = 5; group.updateMatrixWorld(true)
    assert.equal(a.matrixWorld.elements[12], 5, 'parent world transforms continue propagating')
    a.position.x = 3
    batches.sync(group, 'changed', 'generation')
    assert.equal(a.matrixWorld.elements[12], 8, 'resync observes edited local transforms')
    batches.clear()
    assert.equal(a.matrixAutoUpdate, true, 'teardown restores the source transform policy')
  } finally { batches.clear(); cleanup(group); material.dispose() }
})

test('local batch edits reuse retained source discovery and invalidate it on transform/view changes', () => {
  const material=new THREE.MeshBasicMaterial(), group=new THREE.Group(), batches=new EquipmentBatches()
  const old=root([new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.Mesh(new THREE.BoxGeometry(),material)])
  old.children[1].position.x=2;group.add(old)
  try {
    batches.sync(group,'a','a','slice')
    const buffer=batches.root.children[0].geometry
    const originalGeometry=old.children[0].geometry
    let geometryReads=0
    Object.defineProperty(old.children[0],'geometry',{configurable:true,get(){geometryReads++;return originalGeometry}})
    let walks=0;const traverse=old.traverseVisible
    old.traverseVisible=function(...args){walks++;return traverse.apply(this,args)}
    const extra=root([new THREE.Mesh(new THREE.BoxGeometry(),material)],'extra');extra.position.x=100;group.add(extra)
    batches.invalidateViews(true);batches.sync(group,'b','b','slice')
    assert.equal(walks,0,'an unrelated addition must not rediscover retained source geometry')
    assert.equal(geometryReads,0,'an untouched bucket must not inspect geometry or rebuild its signature')
    assert.ok(batches.root.children.some(mesh=>mesh.geometry===buffer),'untouched spatial bucket keeps its GPU buffer')
    old.position.x=4;batches.invalidateViews(true);batches.sync(group,'c','c','slice')
    assert.equal(walks,1,'moving a retained root refreshes its world-space sources')
    batches.invalidateViews(true);batches.sync(group,'d','d','another-slice')
    assert.equal(walks,2,'view/material policies refresh retained sources')
    batches.invalidateViews();batches.sync(group,'e','e','another-slice')
    assert.equal(walks,3,'conservative invalidation refreshes mutable source inputs')
  } finally {batches.clear();cleanup(group);material.dispose()}
})

test('append-only bucket aggregation matches fresh rendering after local additions, deletion and view changes',()=>{
  const material=new THREE.MeshBasicMaterial(),group=new THREE.Group(),batches=new EquipmentBatches()
  const make=(id,x)=>{const r=root([new THREE.Mesh(new THREE.BoxGeometry(),material)],id);r.position.x=x;return r}
  group.add(make('a',0),make('b',2))
  const snapshot=b=>b.root.children.map(mesh=>JSON.stringify({type:mesh.type,count:mesh.count,
    position:Array.from(mesh.geometry.attributes.position.array),index:mesh.geometry.index?Array.from(mesh.geometry.index.array):null,
    instances:mesh.instanceMatrix?Array.from(mesh.instanceMatrix.array):null})).sort()
  const freshMatches=()=>{
    const fresh=new EquipmentBatches(),clone=group.clone(true);clone.traverse(o=>o.layers.set(0))
    try{fresh.sync(clone);assert.deepEqual(snapshot(batches),snapshot(fresh))}finally{fresh.clear()}
  }
  try{
    batches.sync(group,'a','a','slice');freshMatches()
    group.add(make('c',4));batches.invalidateViews(true);batches.sync(group,'b','b','slice');freshMatches()
    const removed=group.children[1];group.remove(removed)
    batches.invalidateViews(true);batches.sync(group,'c','c','slice');freshMatches();removed.children[0].geometry.dispose()
    batches.invalidateViews(true);batches.sync(group,'d','d','another-slice');freshMatches()
  }finally{batches.clear();cleanup(group);material.dispose()}
})

test('retired view buffers leave the click path and teardown cancels and drains their idle job once',()=>{
  const idle=globalThis.requestIdleCallback,cancel=globalThis.cancelIdleCallback
  const jobs=new Map();let next=0
  globalThis.requestIdleCallback=fn=>{jobs.set(++next,fn);return next}
  globalThis.cancelIdleCallback=id=>jobs.delete(id)
  const material=new THREE.MeshBasicMaterial(),group=new THREE.Group(),batches=new EquipmentBatches()
  const source=root([new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.Mesh(new THREE.BoxGeometry(),material)])
  source.children[1].position.x=2;group.add(source)
  try {
    batches.sync(group,'a','g');const first=batches.root.children[0].geometry
    let disposed=0;first.addEventListener('dispose',()=>disposed++)
    source.position.x=3;batches.sync(group,'b','g')
    batches.invalidateViews()
    assert.equal(disposed,0,'dormant view disposal is deferred from the edit')
    assert.equal(jobs.size,1)
    const [job,run]=jobs.entries().next().value;jobs.delete(job);run()
    assert.equal(disposed,1,'idle work releases the retired allocation')
    const second=batches.root.children[0].geometry
    let secondDisposed=0;second.addEventListener('dispose',()=>secondDisposed++)
    source.position.x=6;batches.sync(group,'c','g');batches.invalidateViews()
    assert.equal(jobs.size,1)
    batches.clear();assert.equal(disposed,1);assert.equal(jobs.size,0)
    assert.equal(secondDisposed,1,'teardown drains the next retired allocation')
    batches.clear();assert.equal(disposed,1)
  }finally{batches.clear();cleanup(group);material.dispose();globalThis.requestIdleCallback=idle;globalThis.cancelIdleCallback=cancel}
})

test('lifting and cancelling a batched module retains geometry and restores neighbouring draws', () => {
  const ctx = { scene: new THREE.Scene(), activeZ: 0 }
  const modules = new ModuleSystem(ctx), material = new THREE.MeshBasicMaterial()
  const first = root([new THREE.Mesh(new THREE.BoxGeometry(), material)], 'first')
  const second = root([new THREE.Mesh(new THREE.BoxGeometry(), material)], 'second')
  second.position.x = 2
  modules.moduleMeshes.add(first, second)
  try {
    modules.syncBatches()
    const batch = modules.batches.root.children[0], geometry = batch.geometry
    let disposed = 0
    geometry.addEventListener('dispose', () => disposed++)
    modules.setMovingModule('first')
    assert.equal(first.visible, false)
    assert.equal(batch.visible, false, 'the combined draw cannot retain the lifted piece')
    assert.equal(second.children[0].layers.isEnabled(0), true, 'the neighbour renders from its retained source mesh')
    modules.syncBatches()
    assert.equal(first.visible, false, 'a batch refresh keeps the lifted piece hidden')
    modules.setMovingModule(null)
    assert.equal(first.visible, true)
    assert.equal(batch.visible, true)
    assert.equal(second.children[0].layers.isEnabled(BATCH_SOURCE_LAYER), true)
    assert.equal(modules.batches.root.children[0].geometry, geometry)
    assert.equal(disposed, 0, 'lifting and cancelling allocate and dispose no batch geometry')
  } finally { modules.batches.clear(); cleanup(modules.moduleMeshes); material.dispose() }
})

test('mapped equipment shares page materials and bakes distinct panel UVs without mutating picking geometry', () => {
  const previous = globalThis.document; globalThis.document = { createElement: () => canvas() }
  const modules = new THREE.Group(), batches = new EquipmentBatches()
  const textures = [new THREE.CanvasTexture(canvas()), new THREE.CanvasTexture(canvas())]
  const materials = textures.map(map => new THREE.MeshBasicMaterial({ map }))
  const surfaces = materials.map((m, i) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), m); mesh.position.x = i * 2; return mesh })
  const original = surfaces.map(s => s.geometry.getAttribute('uv').array.slice())
  modules.add(root([surfaces[0]], 'a', 'sign'), root([surfaces[1]], 'b', 'sign'))
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1, 'two independent screen maps become one material draw')
    const mesh = batches.root.children[0], uv = mesh.geometry.getAttribute('uv')
    assert.notEqual(uv.getX(0), uv.getX(6), 'both panels address their own pixels rather than showing the first label twice')
    surfaces.forEach((s, i) => { assert.deepEqual(s.geometry.getAttribute('uv').array, original[i]); assert.equal(s.layers.isEnabled(BATCH_SOURCE_LAYER), true); assert.equal(s.layers.isEnabled(0), false) })
    const page = mesh.material.map, version = page.version
    textures[1].needsUpdate = true; batches.atlas.update()
    assert.equal(page.version, version + 1, 'a live information-screen repaint reaches the actual batched material')
  } finally { batches.clear(); cleanup(modules); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); globalThis.document = previous }
})

test('equipment cache skips unchanged revisions and releases only batch-owned buffers on disable/teardown', () => {
  const material = new THREE.MeshBasicMaterial(), modules = new THREE.Group(), batches = new EquipmentBatches()
  const sources = [new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material)]
  sources[1].position.x = 2; modules.add(root(sources))
  let sourceDisposals = 0, batchDisposals = 0, bufferDisposals = 0
  sources.forEach(s => s.geometry.addEventListener('dispose', () => sourceDisposals++))
  try {
    batches.sync(modules, 'station/view-1')
    const mesh = batches.root.children[0]
    mesh.geometry.addEventListener('dispose', () => batchDisposals++)
    mesh.addEventListener('dispose', () => bufferDisposals++)
    batches.sync(modules, 'station/view-1')
    assert.equal(batches.root.children[0], mesh, 'the same immutable roots and view preserve the complete GPU allocation')
    batches.enabled = false; batches.sync(modules, 'station/view-1')
    assert.equal(batches.root.children.length, 0); assert.deepEqual(sources.map(s => s.layers.mask), [1, 1])
    assert.equal(batchDisposals, 1); assert.equal(bufferDisposals, 1); assert.equal(sourceDisposals, 0, 'picking geometries are still owned by their modules')
    batches.enabled = true; batches.sync(modules, 'station/view-1')
    assert.equal(batches.root.children.length, 1, 're-enabling rebuilds even with the same revision key')
    batches.clear(); batches.clear(); assert.equal(sourceDisposals, 0)
  } finally { batches.clear(); cleanup(modules); material.dispose() }
})

test('real module picking reaches batch source IDs, restores ray layers and respects nearer walls', () => {
  const { cam } = cameraRig(), modules = new THREE.Group(), material = new THREE.MeshBasicMaterial(), batches = new EquipmentBatches()
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material), b = new THREE.Mesh(new THREE.BoxGeometry(), material)
  b.position.x = 3; modules.add(root([a], 'a'), root([b], 'b'))
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 2), material); wall.position.y = -1; wall.updateMatrixWorld(true)
  try {
    batches.sync(modules); cam.modules = { moduleMeshes: modules }
    cam.camera.position.set(0, -5, 0); cam.camera.lookAt(0, 0, 0); cam.camera.updateMatrixWorld(true)
    const hit = cam.pickModuleHit(640, 410)
    assert.equal(hit?.moduleId, 'a'); assert.ok(Math.abs(hit.point[1] + 0.5) < 1e-6)
    assert.equal(cam.raycaster.layers.mask, 1, 'temporary layer 31 must not leak into block picking')
    a.visible = false
    assert.equal(cam.pickModuleHit(640, 410), null, 'an invisible nested surface cannot be selected through its visible module root')
    a.visible = true
    cam.setPickables([wall]); assert.equal(cam.pickModuleHit(640, 410), null, 'batching cannot select through a nearer station wall')
    cam.setPickables([]); modules.children[0].visible = false; batches.sync(modules)
    assert.equal(cam.pickModuleHit(640, 410), null, 'hidden source roots are not selectable')
    modules.children[0].visible = true; batches.enabled = false; batches.sync(modules)
    assert.equal(cam.pickModuleHit(640, 410)?.moduleId, 'a', 'profiling fallback retains the same picking result')
  } finally { cam.dispose(); batches.clear(); cleanup(modules); wall.geometry.dispose(); material.dispose() }
})

test('cover support picking catches an end-door seam ahead of equipment behind it and respects walls', () => {
  const { cam } = cameraRig(), modules = new THREE.Group(), material = new THREE.MeshBasicMaterial()
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 2), material)
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 2), material)
  left.position.x = -0.4; right.position.x = 0.4
  const end = root([left, right], 'end', 'psd-end')
  const behind = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), material)
  behind.position.y = 1
  modules.add(end, root([behind], 'behind', 'platform-edge'))
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 2), material)
  wall.position.y = -1; wall.updateMatrixWorld(true)
  try {
    cam.modules = { moduleMeshes: modules }
    modules.updateMatrixWorld(true)
    cam.camera.position.set(0, -5, 0); cam.camera.lookAt(0, 0, 0); cam.camera.updateMatrixWorld(true)
    assert.equal(cam.pickModule(640, 410), 'behind')
    assert.equal(cam.pickModule(640, 410, true), 'end', 'the cover attaches to the nearer end panel')
    end.visible = false
    assert.equal(cam.pickModule(640, 410, true), 'behind', 'hidden-storey panels cannot receive covers')
    end.visible = true
    cam.setPickables([wall])
    assert.equal(cam.pickModule(640, 410, true), null, 'a nearer station wall still occludes the end panel')
  } finally { cam.dispose(); cleanup(modules); wall.geometry.dispose(); material.dispose() }
})

test('ramp bound picking reaches between stair treads but still respects walls', () => {
  const { cam } = cameraRig(), modules = new THREE.Group(), material = new THREE.MeshBasicMaterial()
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), material)
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), material)
  left.position.x = -0.7; right.position.x = 0.7
  modules.add(root([left, right], 'stair', 'stair'))
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 2), material)
  wall.position.set(0, -1, 0); wall.updateMatrixWorld(true)
  try {
    cam.modules = { moduleMeshes: modules }
    modules.updateMatrixWorld(true)
    cam.camera.position.set(0, -5, 0); cam.camera.lookAt(0, 0, 0); cam.camera.updateMatrixWorld(true)
    assert.equal(cam.pickModuleHit(640, 410), null, 'the exact ray passes between the separated stair surfaces')
    assert.equal(cam.pickModuleInBounds(640, 410, new Set(['stair'])), 'stair', 'the stair footprint catches a ray through its tread gap')
    cam.setPickables([wall])
    assert.equal(cam.pickModuleInBounds(640, 410, new Set(['stair'])), null, 'a nearer wall still blocks the forgiving pick')
  } finally { cam.dispose(); cleanup(modules); wall.geometry.dispose(); material.dispose() }
})

test('unsupported/mutable equipment meshes keep their render paths and batch state boundaries stay separate', () => {
  const material = new THREE.MeshBasicMaterial(), modules = new THREE.Group(), batches = new EquipmentBatches()
  const plain = () => new THREE.Mesh(new THREE.BoxGeometry(), material)
  const sources = [plain(), plain()], partial = plain(), morph = plain(), array = new THREE.Mesh(new THREE.BoxGeometry(), [material]), hidden = plain()
  partial.geometry.setDrawRange(0, 6); morph.geometry.morphAttributes.position = [morph.geometry.getAttribute('position').clone()]; hidden.visible = false
  const skin = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material), instance = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1)
  const screen = plain(), group = root([...sources, partial, morph, array, hidden, skin, instance, screen]); group.userData.adScreen = screen
  const unknown = root([plain(), plain()], 'future', 'future-model')
  const noCull = [plain(), plain()]; noCull.forEach(s => s.frustumCulled = false)
  const later = [plain(), plain()]; later.forEach(s => s.renderOrder = 3)
  group.add(...noCull, ...later); modules.add(group, unknown)
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 3, 'render order and culling policies are independent batches')
    assert.equal(batches.root.children.filter(s => !s.frustumCulled).length, 1, 'explicit non-culling survives')
    for (const s of [partial, morph, array, skin, instance, screen, ...unknown.children]) assert.equal(s.layers.mask, 1, 'unsupported or live surfaces remain directly renderable')
    assert.equal(hidden.layers.mask, 1)
  } finally { batches.clear(); cleanup(modules); material.dispose() }
})

test('nested landing doors and moving cabins never bake into static equipment', () => {
  const material = new THREE.MeshBasicMaterial(), modules = new THREE.Group(), batches = new EquipmentBatches()
  const fixed = () => new THREE.Mesh(new THREE.BoxGeometry(), material)
  const group = root([fixed(), fixed()], 'lift', 'lift'), landing = new THREE.Group(), leaf = fixed(), cabin = new THREE.Group(), cabinWall = fixed()
  landing.add(leaf); landing.userData.doors = [leaf]; cabin.add(cabinWall)
  group.add(landing, cabin); group.userData.liftCabin = cabin; modules.add(group)
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1); assert.equal(leaf.layers.mask, 1); assert.equal(cabinWall.layers.mask, 1)
    leaf.position.x = 0.5; cabin.position.z = 4; modules.updateMatrixWorld(true)
    assert.equal(cabinWall.matrixWorld.elements[14], 4, 'the visible cabin wall continues to ride its moving group')
  } finally { batches.clear(); cleanup(modules); material.dispose() }
})

test('sorted equipment teardown releases geometry and matrix/indirection textures once', () => {
  const material = new THREE.MeshBasicMaterial({ transparent: true }), modules = new THREE.Group(), batches = new EquipmentBatches()
  const sources = [new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), material)]
  sources.forEach(s => s.frustumCulled = false); modules.add(root(sources))
  try {
    batches.sync(modules); const batch = batches.root.children[0]
    assert.equal(batch.isBatchedMesh, true); assert.equal(batch.perObjectFrustumCulled, false)
    const counts = { geometry: 0, matrix: 0, indirect: 0 }
    batch.geometry.addEventListener('dispose', () => counts.geometry++)
    batch._matricesTexture.addEventListener('dispose', () => counts.matrix++)
    batch._indirectTexture.addEventListener('dispose', () => counts.indirect++)
    batches.clear(); batches.clear(); assert.deepEqual(counts, { geometry: 1, matrix: 1, indirect: 1 })
  } finally { batches.clear(); cleanup(modules); material.dispose() }
})

test('train batching preserves hidden detail, partial/morph geometry and independent draw policies', () => {
  const group = new THREE.Group(), material = new THREE.MeshBasicMaterial(), glass = new THREE.MeshBasicMaterial({ transparent: true })
  const mesh = (mat = material) => new THREE.Mesh(new THREE.BoxGeometry(), mat)
  const first = mesh(), second = mesh(), later = mesh(), hidden = mesh(), partial = mesh(), morph = mesh()
  first.castShadow = second.castShadow = true; first.frustumCulled = second.frustumCulled = false
  later.renderOrder = 4; hidden.visible = false; partial.geometry.setDrawRange(3, 6)
  morph.geometry.morphAttributes.position = [morph.geometry.getAttribute('position').clone()]
  group.add(first, second, later, hidden, partial, morph); group.userData.doors = [first, second, later, hidden, partial, morph]
  const hiddenGroup = new THREE.Group(), hiddenPane = mesh(glass); hiddenGroup.visible = false; hiddenGroup.add(hiddenPane); group.add(hiddenGroup)
  const panes = [mesh(glass), mesh(glass)]; panes.forEach(p => p.frustumCulled = false); group.add(...panes)
  try {
    batchTrainDoors(group); batchTrainTransparent(group)
    assert.equal(group.userData.trainDoorBatches.length, 1)
    const door = group.userData.trainDoorBatches[0].mesh
    assert.equal(door.castShadow, true); assert.equal(door.frustumCulled, false)
    for (const source of [later, partial, morph, hidden, hiddenPane]) assert.equal(source.layers.mask, 1, 'excluded parts keep their original rendering model')
    assert.equal(group.userData.trainGlassBatches[0].mesh.perObjectFrustumCulled, false)
    let geometryDisposals = 0
    const sorted = group.userData.trainGlassBatches[0].mesh
    sorted.geometry.addEventListener('dispose', () => geometryDisposals++)
    disposeObject(group); assert.equal(geometryDisposals, 1, 'scene teardown delegates complete batched ownership once')
  } finally { material.dispose(); glass.dispose() }
})

test('atlas rejects transformed/custom/oversized panels and separates rendering/color-space states', () => {
  const previous = globalThis.document; globalThis.document = { createElement: () => canvas() }
  const atlas = new PanelAtlas(64), textures = [], materials = []
  const panel = (w = 16, h = 16) => { const map = new THREE.CanvasTexture(canvas(w, h)), material = new THREE.MeshBasicMaterial({ map }); textures.push(map); materials.push(material); return material }
  try {
    assert.equal(atlas.resolve(new THREE.MeshStandardMaterial()), null)
    const accepted = panel(), first = atlas.resolve(accepted)
    for (const mutate of [m => m.map.repeat.x = 2, m => m.map.offset.x = 0.1, m => m.map.rotation = 1,
      m => m.map.flipY = false, m => m.map.channel = 1, m => m.map.magFilter = THREE.NearestFilter,
      m => m.map.matrixAutoUpdate = false, m => m.vertexColors = true, m => m.alphaHash = true,
      m => m.onBeforeCompile = () => {}, m => m.wireframe = true]) {
      const m = panel(); mutate(m); assert.equal(atlas.resolve(m), null, 'unsupported sampling/shading must retain its original material')
    }
    assert.equal(atlas.resolve(panel(61, 16)), null, 'oversized panels keep full resolution rather than being shrunk')
    const translucent = panel(); translucent.transparent = true; translucent.opacity = 0.35
    assert.notEqual(atlas.resolve(translucent).material, first.material, 'ghost opacity cannot change another panel')
    const linear = panel(); linear.map.colorSpace = THREE.LinearSRGBColorSpace
    assert.notEqual(atlas.resolve(linear).material.map, first.material.map, 'different transfer functions never share a page')
    const clipped = panel(), plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1); clipped.clippingPlanes = [plane]
    const region = atlas.resolve(clipped); assert.equal(region.material.clippingPlanes[0], plane)
    const otherClip = panel(), otherPlane = plane.clone(); otherClip.clippingPlanes = [otherPlane]
    assert.notEqual(atlas.resolve(otherClip).material, region.material, 'equal-valued independent planes must not share a material that follows only one plane')
    plane.constant = 2; assert.equal(region.material.clippingPlanes[0].constant, 2, 'moving the section plane reaches the batched material')
    assert.equal(atlas.resolve(clipped).material, region.material, 'moving the same live plane does not grow the material cache')
    for (let i = 0; i < 6; i++) { const r = atlas.resolve(panel(25, 25)); assert.ok(r.u >= 0 && r.v >= 0 && r.u + r.w <= 1 && r.v + r.h <= 1, 'shelf wrapping/page rollover keeps all pixels in bounds') }
    let source = 0, page = 0, mat = 0
    textures.forEach(t => t.addEventListener('dispose', () => source++))
    first.material.map.addEventListener('dispose', () => page++); first.material.addEventListener('dispose', () => mat++)
    atlas.dispose(); atlas.dispose(); assert.equal(page, 1); assert.equal(mat, 1); assert.equal(source, 0)
  } finally { atlas.dispose(); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); globalThis.document = previous }
})

test('geometry identity compares complete vertex/index content rather than allocation', () => {
  const a = new THREE.BoxGeometry(), b = a.clone(), c = new THREE.BoxGeometry(2, 1, 1)
  try { assert.equal(equalGeometry(a, a), true); assert.equal(equalGeometry(a, b), true); assert.equal(equalGeometry(a, c), false) }
  finally { a.dispose(); b.dispose(); c.dispose() }
})

test('real module/level systems retain cell-local batches and apply hide/ghost/cut transitions', () => {
  const previous = globalThis.document; globalThis.document = { createElement: () => canvas() }
  let materials, modules
  const blob = new THREE.MeshBasicMaterial()
  try {
    materials = createModelMaterials()
    const ctx = new SceneContextData(new THREE.Scene(), { blob }, materials, {}), level = new LevelSystem(ctx)
    ctx.activeZ = 0; ctx.ghost = false
    modules = new ModuleSystem(ctx)
    modules.ghost = { clearFencePreview() {} }
    modules.plates = { retainTvPlates() {}, retainSignPlates() {}, retainDecorPlates() {}, clearTvPlates() {}, clearSignPlates() {}, clearDecorPlates() {}, ownsTexture: () => false, adScreens: [], tvScreens: [] }
    modules.trains = { psdGroups: [] }; modules.lifts = { escalatorRolls: [], liftRigs: [], liftPickMeshes: [] }; modules.clocks = { clockRigs: [] }; modules.crowd = { gateWings: [] }
    level.modules = modules; level.chunks = { levelGroups: new Map(), outlineSet: new Set() }; level.trains = { trainGroup: new THREE.Group() }
    const station = { name: 'test', seed: 1, lines: [], modules: [createModule('bench', 0, 0, 0, 'a'), createModule('bench', 3, 0, 0, 'b')], cells: [] }
    const apply = data => { modules.buildModules(data, new Set(), true); ctx.levelKey = ''; level.applyLevel() }
    apply(station); assert.ok(modules.batches.root.children.length > 0)
    const held = modules.batches.root.children.slice()
    apply({ ...station, cells: [{ x: 100, y: 100, z: 1, fill: 'solid' }] })
    assert.deepEqual(modules.batches.root.children, held, 'an unrelated structural cell edit preserves actual batch objects through both systems')
    modules.setMovingModule('a')
    level.setLevel(4, false); assert.equal(modules.batches.root.children.length, 0, 'hidden storeys submit no equipment')
    modules.setMovingModule(null)
    assert.equal(modules.isModuleVisible('a'), false, 'cancelling after a storey change cannot reveal a hidden module')
    assert.equal(modules.isModuleVisible('a'), false, 'hidden storey module roots are excluded from cell-based tool fallbacks')
    level.setLevel(4, true); assert.ok(modules.batches.root.children.length > 0)
    assert.equal(modules.isModuleVisible('a'), true, 'ghosted storeys remain visible and pickable when 显示其他层 is on')
    assert.ok(modules.batches.root.children.every(m => m.material.transparent && m.material.opacity === 0.35), 'another storey uses sorted ghost materials')
    ctx.cutaway = true; const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1); level.setClip(plane)
    assert.ok(modules.batches.root.children.every(m => m.material.clippingPlanes[0] === plane && m.material.opacity === 1), 'cut mode restores original ink and clips the batched render surfaces')
    plane.constant = 2; assert.ok(modules.batches.root.children.every(m => m.material.clippingPlanes[0].constant === 2))
  } finally { modules?.clearModules(); if (materials) disposeModelMaterials(materials); blob.dispose(); globalThis.document = previous }
})
