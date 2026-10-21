import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { isCosmeticStationEdit } from '../src/sim/cosmeticEdit.ts'
import { retainedModuleIds, isEquipmentModelEdit } from '../src/render/moduleDependencies.ts'
import { ModulePreviewDocument } from '../src/render/modulePreviewDocument.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { buildModule, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { StationGeometry } from '../src/app/stationGeometry.ts'
import { PlateSystem } from '../src/render/scene/systems/PlateSystem.ts'
import { signBoardsPanel } from '../src/sim/sign.ts'
import { defaultLine } from '../src/build/rail.ts'

const equipment = ['bench', 'tvm', 'vending', 'gate', 'fence', 'ac-unit', 'electrical-cabinet', 'pillar', 'hanger-post', 'roof-canopy']
function station(modules) {
  return { ...emptyStation(), modules, cells: [{ x: -30, y: -30, z: 0, fill: 'solid' }, { x: 100, y: 100, z: 0, fill: 'solid' }] }
}

test('every palette placement/deletion retains remote models of its own type', async () => {
  const { MODULE_OPTIONS } = await import('../src/app/store/catalog.ts')
  const catalogue = MODULE_OPTIONS.map(option => createModule(option.id, 60, 60, 0, `remote-${option.id}`))
  for (const option of MODULE_OPTIONS) {
    const remote = createModule(option.id, 60, 60, 0, 'remote')
    const added = createModule(option.id, 0, 0, 0, 'added')
    assert.ok(remote && added, option.id)
    const before = station([remote]), after = { ...before, modules: [remote, added] }
    assert.equal(retainedModuleIds(before, after).has('remote'), true, `${option.id}: placement retains remote sibling`)
    assert.equal(retainedModuleIds(after, before).has('remote'), true, `${option.id}: deletion retains remote sibling`)
    const mixed = station(catalogue), placed = { ...mixed, modules: [...catalogue, added] }
    assert.equal(retainedModuleIds(mixed, placed).size, catalogue.length, `${option.id}: keeps the entire remote catalogue`)
    assert.equal(retainedModuleIds(placed, mixed).size, catalogue.length, `${option.id}: deletion keeps the remote catalogue`)
  }
})

test('equipment edits reuse prepared tool occupancy; structural edits and ground expansion invalidate it', () => {
  const cache = new StationGeometry(), before = station([])
  const prepared = cache.resolve(before)
  assert.equal(cache.resolve({ ...before }), prepared, 'render-only updates retain prepared sets')
  for (const type of [...equipment, 'walkway', 'psd-end', 'road']) {
    const data = { ...before, modules: [createModule(type, 0, 0, 0, 'added')] }
    assert.equal(cache.resolve(data), prepared, `${type} reuses every map-wide occupancy allocation`)
    assert.equal(cache.resolve(before), prepared, `${type} undo also retains prepared sets`)
  }
  for (const data of [{ ...before, cells: [...before.cells, { x: 2, y: 2, z: 0, fill: 'solid' }] },
    { ...before, modules: [createModule('bench', 5000, 0, 0, 'far')] },
    { ...before, modules: [createModule('stair-straight', 0, 0, 0, 'stairs')] }]) {
    assert.notEqual(cache.resolve(data), prepared, 'map geometry changes rebuild occupancy')
    cache.resolve(before)
  }
})

test('ordinary equipment edits retain 1024 unrelated models while functional edits still rebuild routes', () => {
  const before = station(Array.from({ length: 1024 }, (_, i) => createModule('bench', i % 32, Math.floor(i / 32), 0, 'old-' + i)))
  for (const type of equipment) {
    const mod = createModule(type, 60, 60, 0, 'added')
    assert.ok(mod, type)
    const after = { ...before, modules: [...before.modules, mod] }
    assert.equal(retainedModuleIds(before, after).size, 1024, `${type} addition keeps all unrelated models`)
    assert.equal(retainedModuleIds(after, before).size, 1024, `${type} deletion keeps all unrelated models`)
    assert.equal(isEquipmentModelEdit(before, after), true, `${type} changes no chunks inside the existing ground window`)
    assert.equal(isCosmeticStationEdit(before, after), false, `${type} still reaches simulation routing`)
    const moved = { ...after, modules: [...before.modules, { ...mod, x: 70 }] }
    assert.equal(retainedModuleIds(after, moved).size, 1024, `${type} movement replaces only the moved model`)
  }
  const future = { ...before, modules: [...before.modules, { id: 'unknown', type: 'future', x: 0, y: 0, z: 0, cfg: {} }] }
  assert.equal(retainedModuleIds(before, future).size, 0, 'future model dependencies must be declared first')
  assert.equal(isEquipmentModelEdit(before, future), false)
  for (const after of [{ ...before, name: 'renamed' }, { ...before, cells: [] },
    { ...before, modules: [...before.modules, createModule('bench', 5000, 0, 0, 'far')] }]) {
    assert.equal(isEquipmentModelEdit(before, after), false, 'station fields, cells and street-window expansion keep their full path')
  }
})

test('coupled equipment rebuilds only dependent neighbours in both edit directions', () => {
  const far = createModule('bench', 90, 90, 0, 'far')
  const cases = [
    [createModule('fence', 0, 0, 0, 'old'), createModule('fence', 1, 0, 0, 'new')],
    [createModule('fence', 0, 0, 0, 'old'), createModule('gate', 1, 0, 0, 'new')],
    [createModule('cubicle', 0, 0, 0, 'old'), createModule('cubicle', 1, 0, 0, 'new')],
    [createModule('tv', 0, 0, 0, 'old', 0), createModule('tv', 0, 0, 0, 'new', 2)],
    [createModule('tactile-guide', 0, 0, 0, 'old'), createModule('tactile-guide', 1, 0, 0, 'new')],
    [{ id: 'old', type: 'glass', x: 0, y: 0, z: 0, rot: 0, w: 1, cfg: { variant: '1x4', curtainHeight: 2 } }, createModule('door', 0, 0, 0, 'new')],
    [{ id: 'old', type: 'glass', x: 0, y: 0, z: 0, rot: 1, w: 1, cfg: { variant: '1x4', curtainHeight: 2 } },
      { id: 'new', type: 'glass', x: 0, y: 0, z: 0, rot: 0, w: 1, cfg: { variant: '1x4', curtainHeight: 2 } }],
    [createModule('tv', 0, 0, 0, 'old'), createModule('hanger-post', 0, 0, 0, 'new')],
  ]
  for (const [old, added] of cases) {
    const before = station([old, far]), after = { ...before, modules: [old, far, added] }
    assert.deepEqual([...retainedModuleIds(before, after)], ['far'], `${old.type}/${added.type}: refresh the dependent model`)
    assert.deepEqual([...retainedModuleIds(after, before)], ['far'], `${old.type}/${added.type}: deletion restores the neighbour geometry`)
  }
  const fence = createModule('fence', 0, -1, 0, 'end'), ramp = createModule('escalator', 0, 0, 0, 'ramp')
  const remoteFence = createModule('fence', 50, 50, 0, 'remote')
  const before = station([fence, remoteFence, far]), after = { ...before, modules: [...before.modules, ramp] }
  assert.deepEqual([...retainedModuleIds(before, after)], ['remote', 'far'], 'a new ramp landing updates only adjacent fence connections')
  const removed = { ...after, cells: [...after.cells, { x: 60, y: 60, z: 2, fill: 'solid' }] }
  assert.equal(retainedModuleIds(after, removed).has('far'), true, 'combined structural/cell edits retain independent remote equipment')
})

test('structural dependencies invalidate changed inputs without rebuilding independent furniture', () => {
  const bench = createModule('bench', 90, 90, 0, 'far')
  const track = { id: 'track', type: 'track', x: 0, y: 0, z: 0, w: 8, d: 3, rot: 0, cfg: { line: '1' } }
  const edge = { id: 'edge', type: 'platform-edge', x: 0, y: 3, z: 0, w: 8, rot: 0, cfg: { line: '1', from: 'track', psd: 'full', side: 'right' } }
  const exit = createModule('exit-covered-2', 0, 0, 0, 'exit')
  const cases = [
    [track, edge], [edge, track],
    [{ id: 'end', type: 'psd-end', x: 0, y: 3, z: 0, rot: 0, cfg: { corner: 'edge', psd: 'full' } }, edge],
    [createModule('pillar', 0, 0, 0, 'pillar'), { ...track, z: createModule('pillar', 0, 0, 0, 'pillar').cfg.height, cfg: { ...track.cfg, bridge: true } }],
    [createModule('hanger-roof', 0, 0, 0, 'hanger'), createModule('roof-canopy', 0, 0, 0, 'roof')],
    [createModule('tv', 0, 0, -10, 'light'), { ...track, z: -5 }],
    [createModule('sidewalk', 0, 0, 0, 'surface'), exit],
    [createModule('lift', 0, 0, 0, 'lift'), createModule('stair-straight', 0, 0, 0, 'stair')],
    [exit, createModule('stair-straight', 0, 0, 0, 'stair')],
    [{ ...createModule('guidepost', 0, 0, 0, 'guide'), cfg: { exitId: 'exit' } }, exit],
  ]
  for (const [dependent, added] of cases) {
    assert.ok(dependent && added)
    const before = station([dependent, bench]), after = { ...before, modules: [...before.modules, added] }
    assert.equal(retainedModuleIds(before, after).has(dependent.id), false, `${dependent.type} reads ${added.type}`)
    assert.equal(retainedModuleIds(before, after).has('far'), true, `${added.type} keeps independent remote furniture`)
  }
})

test('a combined module and cell edit rebuilds only cell-dependent models', () => {
  const near = createModule('stair-straight', 0, 0, 0, 'near')
  const far = createModule('stair-straight', 40, 40, 0, 'far')
  const bench = createModule('bench', 0, 5, 0, 'bench')
  const before = station([near, far, bench])
  const after = { ...before, modules: [...before.modules, createModule('bench', 20, 20, 0, 'added')],
    cells: [...before.cells, { x: 1, y: 0, z: 0, fill: 'solid' }] }
  const retained = retainedModuleIds(before, after)
  assert.equal(retained.has('near'), false, 'a changed cell inside a stair envelope rebuilds its model')
  assert.equal(retained.has('far'), true, 'a remote stair keeps its model')
  assert.equal(retained.has('bench'), true, 'an ordinary bench reads its own footprint, not the cell')
  assert.equal(retained.has('added'), false, 'the added model still builds')
})

function withDrawing(run) {
  const previous = globalThis.document
  globalThis.document = { createElement() { const node = { width: 512, height: 256 }, { g } = stubCanvas(); g.canvas = node; node.getContext = () => g; return node } }
  const mats = createModelMaterials(), blob = new THREE.MeshBasicMaterial()
  const ctx = new SceneContextData(new THREE.Scene(), { blob, finish: () => mats.white, owns: () => false }, mats, null)
  const modules = new ModuleSystem(ctx)
  modules.ghost = { clearFencePreview() {} }
  modules.plates = { retainTvPlates() {}, retainSignPlates() {}, retainDecorPlates() {}, clearTvPlates() {}, clearSignPlates() {}, clearDecorPlates() {}, ownsTexture: () => false, adScreens: [], tvScreens: [] }
  modules.trains = { psdGroups: [] }; modules.lifts = { escalatorRolls: [], liftRigs: [], liftPickMeshes: [] }
  modules.clocks = { clockRigs: [] }; modules.crowd = { gateWings: [] }
  try { run({ mats, ctx, modules }) }
  finally { modules.clearModules(); modules.batches.clear(); disposeModelMaterials(mats); blob.dispose(); globalThis.document = previous }
}

test('structural edits leave remote sign pixels intact; changed boards and lines repaint', () => withDrawing(({ ctx }) => {
  const front = [{ id: 'text', kind: 'text', text: 'East', x: 0, y: .35, scale: 1, side: 'both' }]
  const sign = createModule('sign-ceiling', 0, 0, 0, 'sign')
  sign.cfg = { ...sign.cfg, front, back: [] }
  const data = station([sign]), plates = new PlateSystem(ctx)
  ctx.stationData = data
  const material = plates.makeSignPlate(sign.id, front, 'left', signBoardsPanel({ front, back: [] }))
  const version = material.map.version
  const placed = { ...data, modules: [sign, createModule('stair-straight', 60, 60, 0, 'stairs')] }
  ctx.stationData = placed
  plates.redrawSignPlates(data)
  assert.equal(material.map.version, version, 'placing structure does not upload every sign texture')
  const edited = { ...placed, modules: [{ ...sign, cfg: { ...sign.cfg, front: [{ ...front[0], text: 'West' }] } }, placed.modules[1]] }
  ctx.stationData = edited
  plates.redrawSignPlates(placed)
  assert.equal(material.map.version, version + 1, 'changed board repaints its retained texture')
  ctx.stationData = { ...edited, lines: [{ id: '1', color: '#ff0000' }] }
  plates.redrawSignPlates(edited)
  assert.equal(material.map.version, version + 1, 'a text-only sign does not upload for an unrelated line edit')
  plates.clearSignPlates()
}))

test('metadata repaint retains model geometry, TV allocations and unrelated line pixels', () => withDrawing(({ctx,modules}) => {
  const plates = new PlateSystem(ctx)
  modules.plates = plates
  const edge=id=>({id:'edge'+id,type:'platform-edge',x:0,y:Number(id)*5,z:0,w:16,cfg:{line:id,side:'left',dir:'up',name:'Platform',psd:'full'}})
  const before={...station([edge('1'),edge('2'),createModule('bench',30,0,0,'bench'),createModule('exit',0,0,0,'exit')].filter(Boolean)),lines:[defaultLine('1','up'),defaultLine('2','up')]}
  ctx.stationData=before;modules.buildModules(before,new Set())
  const roots=new Map(modules.moduleMeshes.children.filter(g=>g.userData.moduleId).map(g=>[g.userData.moduleId,g]))
  const geometry=[];for(const root of roots.values())root.traverse(m=>{if(m.isMesh)geometry.push([m,m.geometry])})
  const maps=id=>{const out=new Set();roots.get(id).traverse(m=>{if(m.isMesh)for(const mat of Array.isArray(m.material)?m.material:[m.material])if(mat.map)out.add(mat.map)});return [...out]}
  const first=maps('edge1').map(map=>[map,map.version]), other=maps('edge2').map(map=>[map,map.version])
  plates.retainTvPlates(before)
  const texture=plates.makeTvPlate('tv',0,0), version=texture.version
  const after={...before,lines:before.lines.map(l=>l.id==='1'?{...l,upTerminus:'New destination'}:l)}
  ctx.stationData=after
  const keep=modules.repaintPresentation(after,modules.presentationKeepIds(after))
  assert.equal(keep.size,after.modules.length,'all artwork updates retain their source model')
  modules.updatePopulationData(after)
  for(const [id,root] of roots)assert.equal(modules.moduleMeshes.children.find(g=>g.userData.moduleId===id),root)
  for(const [mesh,buffer] of geometry)assert.equal(mesh.geometry,buffer)
  assert.ok(first.some(([map,v])=>map.version>v),'changed line headers repaint')
  assert.ok(other.every(([map,v])=>map.version===v),'other line headers retain their pixels')
  plates.retainTvPlates({...after,modules:[...after.modules,{id:'tv',type:'tv',x:0,y:0,z:0,cfg:{}}]})
  assert.equal(plates.tvPlates.get('tv'),texture,'metadata preserves texture identity')
  assert.equal(texture.version,version)
  plates.clearTvPlates()
}))

test('real ModuleSystem preserves remote geometry and owned material allocations across equipment edits', () => withDrawing(({ modules }) => {
  const before = station([createModule('tvm', 0, 0, 0, 'machine'), createModule('cubicle', 10, 0, 0, 'cubicle')])
  modules.buildModules(before, new Set())
  const roots = modules.moduleMeshes.children.filter(g => g.userData.moduleId)
  let released = 0
  for (const root of roots) {
    root.traverse(o => { if (o.isMesh) o.geometry.addEventListener('dispose', () => released++) })
    for (const mat of root.userData.ownedMaterials) mat.addEventListener('dispose', () => released++)
  }
  for (const type of equipment) {
    const added = { ...before, modules: [...before.modules, createModule(type, 60, 60, 0, 'added')] }
    // Booth/roof/gates use the same real build factory; this is not a mock of retention.
    modules.buildModules(added, new Set(), true)
    for (const root of roots) assert.ok(modules.moduleMeshes.children.includes(root), `${type} keeps the existing machine and cubicle`)
    assert.equal(released, 0)
    modules.buildModules(before, new Set(), true)
  }
}))

test('contact shadows retain buffers, upload only changed instances and dispose exactly once', () => withDrawing(({ modules }) => {
  const benches = Array.from({ length: 3 }, (_, i) => createModule('bench', i * 2, 0, 0, `bench-${i}`))
  const upper = createModule('bench', 0, 0, 5, 'upper')
  const before = station([...benches, upper])
  modules.buildModules(before, new Set())
  const blob = z => modules.moduleMeshes.children.find(g => g.userData.contactBlobKey && g.userData.levelZs[0] === z)
  const lowerBlob = blob(0), upperBlob = blob(5)
  let meshesReleased = 0, geometriesReleased = 0
  lowerBlob.addEventListener('dispose', () => meshesReleased++)
  lowerBlob.geometry.addEventListener('dispose', () => geometriesReleased++)
  const upperVersion = upperBlob.instanceMatrix.version
  lowerBlob.instanceMatrix.clearUpdateRanges() // As after the renderer's upload.
  const added = { ...before, modules: [...before.modules, createModule('bench', 8, 0, 0, 'fourth')] }
  modules.buildModules(added, new Set(), true)
  assert.equal(blob(0), lowerBlob, 'spare capacity retains the geometry and instance buffer')
  assert.equal(blob(5), upperBlob, 'another storey keeps its shadow allocation')
  assert.equal(upperBlob.instanceMatrix.version, upperVersion, 'untouched storey uploads nothing')
  assert.deepEqual(lowerBlob.instanceMatrix.updateRanges, [{ start: 48, count: 16 }], 'only the appended matrix uploads')
  const moved = { ...added, modules: added.modules.map(m => m.id === 'bench-1' ? { ...m, x: 12 } : m) }
  lowerBlob.instanceMatrix.clearUpdateRanges()
  modules.buildModules(moved, new Set(), true)
  assert.deepEqual(lowerBlob.instanceMatrix.updateRanges, [{ start: 16, count: 16 }], 'moving a piece updates one shadow')
  const matrix = new THREE.Matrix4()
  lowerBlob.getMatrixAt(1, matrix)
  assert.equal(matrix.elements[12], 12.5)
  const grown = { ...moved, modules: [...moved.modules, createModule('bench', 14, 0, 0, 'fifth')] }
  modules.buildModules(grown, new Set(), true)
  assert.notEqual(blob(0), lowerBlob, 'growth replaces a full buffer')
  assert.equal(meshesReleased, 1)
  assert.equal(geometriesReleased, 1)
  const expanded = blob(0)
  const shrunken = station([benches[0], upper])
  modules.buildModules(shrunken, new Set(), true)
  assert.notEqual(blob(0), expanded, 'large deletions release excessive spare capacity')
  assert.equal(blob(0).instanceMatrix.count, 1, 'retained capacity stays bounded after deletion')
  modules.buildModules(station([upper]), new Set(), true)
  assert.equal(blob(0), undefined, 'the last removed piece drops its shadow batch')
  assert.equal(blob(5), upperBlob)
  modules.clearModules()
  assert.equal(meshesReleased, 1, 'a previously evicted buffer is never disposed twice')
  assert.equal(geometriesReleased, 1)
}))

function geometryOf(root) {
  root.updateMatrixWorld(true)
  const rows = []
  root.traverse(o => { if (o.isMesh) rows.push({ matrix: [...o.matrixWorld.elements],
    positions: [...o.geometry.attributes.position.array], normals: [...o.geometry.attributes.normal.array],
    indices: o.geometry.index ? [...o.geometry.index.array] : null }) })
  return rows
}

test('retained rebuilds match fresh joined fence, cubicle and curtain geometry after addition and deletion', () => withDrawing(({ modules }) => {
  const gate = { ...createModule('gate', 0, 0, 0, 'gate'), cfg: { door: 'fence', dir: 'both' } }
  const vertical = { id: 'vertical', type: 'glass', x: 0, y: 0, z: 0, rot: 1, w: 1, cfg: { variant: '1x4', curtainHeight: 2 } }
  for (const [old, neighbour] of [
    [createModule('fence', 0, 0, 0, 'fence'), createModule('fence', 1, 0, 0, 'new')],
    [gate, createModule('fence', 1, 0, 0, 'new')],
    [createModule('cubicle', 1, 0, 0, 'cubicle'), createModule('cubicle', 0, 0, 0, 'new')],
    [vertical, { ...vertical, id: 'horizontal', rot: 0 }],
    [{ ...vertical, rot: 0 }, createModule('door', 0, 0, 0, 'door')],
  ]) {
    const before = station([old]), after = { ...before, modules: [old, neighbour] }
    for (const [source, destination] of [[before, after], [after, before]]) {
      modules.buildModules(destination, new Set())
      const expected = geometryOf(modules.moduleMeshes.children.find(g => g.userData.moduleId === old.id))
      modules.buildModules(source, new Set())
      modules.buildModules(destination, new Set(), true)
      const actual = modules.moduleMeshes.children.find(g => g.userData.moduleId === old.id)
      assert.deepEqual(geometryOf(actual), expected, `${old.type}/${neighbour.type}: local rebuild equals a complete build`)
    }
  }
}))

test('structural input retention matches fresh geometry for remote and connected edits', () => withDrawing(({ modules }) => {
  const track = { id: 'track', type: 'track', x: 0, y: 0, z: 5, w: 8, d: 3, rot: 0, cfg: { line: '1', bridge: true, power: 'catenary' } }
  const road = { id: 'road', type: 'road', x: 0, y: 0, z: 0, w: 6, d: 60, rot: 0, cfg: { direction: 'two-way' } }
  const pairs = [
    [track, { ...track, id: 'next', x: 8 }],
    [track, { ...track, id: 'remote', x: 60, y: 60 }],
    [road, { ...road, id: 'cross', x: -20, y: 25, w: 50, d: 6, rot: 1 }],
    [road, { ...road, id: 'remote', x: 60, y: 60 }],
    [createModule('hanger-roof', 0, 0, 0, 'hanger'), createModule('roof-canopy', 0, 0, 0, 'roof')],
    [createModule('hanger-roof', 0, 0, 0, 'hanger'), createModule('roof-canopy', 60, 60, 0, 'roof')],
    [createModule('pillar', 0, 0, 0, 'pillar'), track],
  ]
  for (const [old, added] of pairs) {
    const before = station([old]), after = { ...before, modules: [old, added] }
    for (const [source, destination] of [[before, after], [after, before]]) {
      modules.buildModules(destination, new Set())
      const expected = geometryOf(modules.moduleMeshes.children.find(g => g.userData.moduleId === old.id))
      modules.buildModules(source, new Set())
      modules.buildModules(destination, new Set(), true)
      assert.deepEqual(geometryOf(modules.moduleMeshes.children.find(g => g.userData.moduleId === old.id)), expected,
        `${old.type}/${added.id}: retained result matches complete build`)
    }
  }
}))

test('ordinary hovers keep document identity; moving removes its source once per immutable document', () => {
  let reads = 0
  const list = new Proxy(Array.from({ length: 1024 }, (_, i) => createModule('bench', i, 0, 0, String(i))), {
    get(target, key, receiver) { if (key === 'filter' || key === Symbol.iterator) reads++; return Reflect.get(target, key, receiver) },
  })
  const data = station(list), preview = new ModulePreviewDocument()
  for (const type of equipment) for (let x = 0; x < 3; x++) {
    assert.equal(preview.resolve(data, [createModule(type, x, 0, 0, 'preview')], null), data)
  }
  assert.equal(reads, 0, 'ordinary hover never copies or scans the module list')
  const first = preview.resolve(data, [createModule('bench', 2, 0, 0, 'move-preview')], '0')
  assert.equal(first.modules.length, 1023)
  for (let x = 3; x < 8; x++) assert.equal(preview.resolve(data, [createModule('bench', x, 0, 0, 'move-preview')], '0'), first)
  assert.equal(reads, 1, 'pickup filters once; movement reuses the prepared support document')
  const next = preview.resolve({ ...data, modules: [...list] }, [createModule('bench', 9, 0, 0, 'move-preview')], '0')
  assert.notEqual(next, first, 'an immutable document edit invalidates the carried-piece cache')
  const tv = createModule('tv', 0, 0, 0, 'preview')
  assert.ok(preview.resolve(data, [tv], null).modules.includes(tv), 'TV pairing still sees the candidate')
  const stairs = [createModule('stair-straight', 0, 0, 0, 'a'), createModule('stair-straight', 1, 0, 0, 'b')]
  assert.deepEqual(preview.resolve(data, stairs, null).modules.slice(-2), stairs, 'wide stair lanes still see each other')
})

test('real ordinary hover previews do not rescan the prepared document on new pointer cells', () => withDrawing(({ mats, ctx }) => {
  let scans = 0
  const list = new Proxy(Array.from({ length: 1024 }, (_, i) => createModule('fence', i * 2, 30, 0, String(i))), {
    get(target, key, receiver) { if (key === 'filter' || key === Symbol.iterator) scans++; return Reflect.get(target, key, receiver) },
  })
  ctx.stationData = station(list)
  const warm = buildModule(createModule('bench', 0, 0, 0, 'warm'), { mats, data: ctx.stationData })
  disposeObject(warm); scans = 0
  const ghost = new GhostSystem(ctx)
  ghost.clocks = { previewRigs: [] }; ghost.plates = { ownsTexture: () => false }
  try {
    for (const type of ['bench', 'vending', 'ac-unit', 'electrical-cabinet', 'gate']) for (let x = 0; x < 3; x++) {
      ghost.setModulePreview(createModule(type, x, 0, 0, 'preview'))
      assert.equal(ghost.previewGroup.children.length, 1)
      assert.equal(scans, 0, `${type} hover reuses existing support indexes`)
    }
  } finally { ghost.dispose() }
}))
