import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildModule, createModelMaterials, disposeModelMaterials, disposeObject, rollEscalator, setDoors } from '../src/render/models.ts'
import { createModule } from '../src/build/model.ts'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { beamModelDetail, compactEquipmentSheets, modelDetailGeometry, omitModelDetail, panelModelDetail, preparePrimitiveModelDetail, setModelDetail } from '../src/render/modelDetail.ts'
import { planarArtworkDetail } from '../src/render/planarArtworkDetail.ts'
import { batchStaticModule, batchStaticParts } from '../src/render/batchStaticModule.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { reposeClockHands } from '../src/render/models/pieces/ClockModel.ts'
import { setGateWing } from '../src/render/models/pieces/GateModel.ts'
import { buildBridgeNoiseBarrier } from '../src/render/models/pieces/BridgeNoiseBarrier.ts'
import { buildBridgeRailing } from '../src/render/models/pieces/BridgeRailing.ts'
import { MODULE_OPTIONS } from '../src/app/store/catalog.ts'
import { equipmentLowBudget } from '../../tools/equipment-low-budgets.mjs'
import { tvPairSlot } from '../src/sim/tvs.ts'
import { exitBayCell, exitRunSnap } from '../src/sim/exits.ts'

await geometryDetailReady

test('local static batches preserve coherent detail and isolate it from distance detail', () => {
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial()
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
    mesh.position.x = i * 2
    if (i < 2) mesh.userData.coherentModelDetail = true
    panelModelDetail(mesh)
    root.add(mesh)
  }
  batchStaticParts(root)
  assert.equal(root.children.length, 2)
  assert.equal(root.children.filter(mesh => mesh.userData.coherentModelDetail === true).length, 1)
  for (const mesh of root.children) {
    assert.equal(mesh.geometry.index.count / 3, 24)
    const low = modelDetailGeometry(mesh)
    assert.ok((low.index?.count ?? low.attributes.position.count) < mesh.geometry.index.count)
  }
  disposeObject(root); material.dispose()
})
test('strict equipment budget retains explicit visible-shape floors, without rounding 10% upward', () => {
  assert.equal(equipmentLowBudget('tvm', 372).limit, 37)
  assert.equal(equipmentLowBudget('roof-truss', 260).limit, 25)
  assert.equal(equipmentLowBudget('roof', 12).limit, 4)
  assert.ok(equipmentLowBudget('roof', 12).reason)
  assert.equal(equipmentLowBudget('sign-wall', 2).limit, 2)
})

test('double-sided equipment sheet compaction retains UVs, bounds, exact front/back picks and buffer reuse', () => {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, .02, 3), material); root.add(mesh)
  panelModelDetail(mesh); root.updateMatrixWorld(true)
  const bounds = modelDetailGeometry(mesh).boundingBox.clone(), uv = mesh.geometry.attributes.uv.array.slice()
  const rays = [-1, 1].map(side => new THREE.Raycaster(new THREE.Vector3(0, side * 2, 0), new THREE.Vector3(0, -side, 0)))
  const hits = rays.map(ray => ray.intersectObject(mesh).map(h => h.distance))
  compactEquipmentSheets(root)
  const low = modelDetailGeometry(mesh), detail = new SourceGeometryDetail()
  assert.equal(low.index.count / 3, 2)
  assert.deepEqual(low.attributes.uv.array, uv)
  assert.deepEqual(low.boundingBox, bounds)
  compactEquipmentSheets(root); assert.equal(modelDetailGeometry(mesh), low)
  try {
    detail.apply(root, true)
    rays.forEach((ray, i) => assert.deepEqual(ray.intersectObject(mesh).map(h => h.distance), hits[i]))
  } finally { detail.restore(); disposeObject(root); material.dispose() }
})

test('planar monitor artwork prints original vectors once, retains exact picks and owns one texture', () => {
  const previous = globalThis.document, fills = [], paths = []
  const context = { beginPath: () => paths.push([]), moveTo: (x, y) => paths.at(-1).push([x, y]), lineTo: (x, y) => paths.at(-1).push([x, y]), closePath() {}, fill: () => fills.push(context.fillStyle) }
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
  const root = new THREE.Group(), artwork = new THREE.Group(), sourceMaterial = new THREE.MeshBasicMaterial({ color: 0x336699 })
  const source = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sourceMaterial)
  source.rotation.x = Math.PI / 2; source.position.z = 1; artwork.add(source); root.add(artwork)
  const owned = [], detail = new SourceGeometryDetail()
  try {
    root.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, -2, 1), new THREE.Vector3(0, 1, 0))
    const hits = ray.intersectObject(root, true).map(h => h.distance)
    planarArtworkDetail(root, [artwork], 1, 1, -.01, 1, false, mat => { owned.push(mat); return mat })
    assert.equal(totals(root), 2, 'High keeps the original vectors; printed High geometry has zero indices')
    assert.equal(totals(root, true), 2, 'Low uses a single printed quad')
    assert.equal(owned.length, 1); assert.equal(fills.length, 2)
    assert.ok(fills.every(fill => fill === sourceMaterial.color.getStyle()))
    assert.ok(paths.flat().every(point => point.every(value => Number.isFinite(value) && value >= 0 && value <= 512)))
    detail.apply(root, true)
    assert.deepEqual(ray.intersectObject(root, true).map(h => h.distance), hits)
    detail.restore()
    let releases = 0; owned[0].map.addEventListener('dispose', () => releases++)
    owned[0].map.dispose(); assert.equal(releases, 1)
    delete globalThis.document
    const probe = new THREE.Group(); probe.add(new THREE.Mesh(new THREE.PlaneGeometry(), sourceMaterial))
    planarArtworkDetail(probe, [], 1, 1, 0, 0, false, mat => mat)
    assert.equal(probe.children.length, 1, 'CPU-only bounds probes retain their original vector graph')
    disposeObject(probe)
  } finally {
    detail.restore(); disposeObject(root); sourceMaterial.dispose(); for (const mat of owned) mat.dispose()
    globalThis.document = previous
  }
})
test('primitive Low retains painted faces, exact picks, cached swaps and single disposal', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(2, .02, 3)
  geometry.attributes.uv.array.fill(.37)
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(geometry, material)
  root.add(mesh); root.updateMatrixWorld(true)
  preparePrimitiveModelDetail(root)
  const low = modelDetailGeometry(mesh), detail = new SourceGeometryDetail()
  assert.equal((low.index.count / 3), 4)
  assert.deepEqual(low.attributes.uv.array, geometry.attributes.uv.array)
  let disposed = 0; low.addEventListener('dispose', () => disposed++)
  const ray = new THREE.Raycaster(new THREE.Vector3(-3, 0, 0), new THREE.Vector3(1, 0, 0))
  const hits = ray.intersectObject(mesh).map(hit => hit.distance)
  try {
    detail.apply(root, true)
    assert.deepEqual(ray.intersectObject(mesh).map(hit => hit.distance), hits, 'narrow removed edges remain pickable')
    detail.restore(); preparePrimitiveModelDetail(root)
    assert.equal(modelDetailGeometry(mesh), low)
  } finally { detail.restore(); disposeObject(root); material.dispose() }
  assert.equal(disposed, 1)
})
const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3
function totals(root, low = false) {
  let count = 0
  root.traverseVisible(mesh => {
    if (mesh.isMesh) count += triangles(low ? mesh.userData.staticFarGeometry ?? mesh.userData.staticDetailGeometry ?? modelDetailGeometry(mesh) ?? mesh.geometry : mesh.geometry) * (mesh.isInstancedMesh ? mesh.count : 1)
  })
  return count
}
function fixture(id, run, configure) {
  const previous = globalThis.document
  const canvas = () => ({ width: 0, height: 0, getContext: () => new Proxy({}, {
    get: (o, k) => o[k] ?? (k === 'measureText' ? text => ({ width: String(text ?? '').length * 8 }) : () => undefined),
    set: (o, k, v) => (o[k] = v, true),
  }) })
  globalThis.document = { createElement: canvas }
  const mats = createModelMaterials(), mod = createModule(id==='tv-double'?'tv':id, 4, 4, 0, id)
  const pair=id==='tv-double'?[mod,{...mod,id:id+'-opposite',rot:2}]:[mod]
  const data = { name: 'Test', seed: 1, cells: [], modules: pair, lines: [] }
  configure?.(mod, data)
  const ads = { adFace: (slug, w, h) => ({ material: mats.white, geometry: new THREE.PlaneGeometry(w, h), slug }), adWindow: (w, h) => ({ material: mats.white, geometry: new THREE.PlaneGeometry(w, h) }) }
  const ctx = { mats, ads, data, trackCells: new Set(), finish: () => mats.steel, tvPlate: () => new THREE.CanvasTexture(canvas()), ownedMats: [], preview: false, tvPairSlot: id => tvPairSlot(id, data.modules) }
  let root
  try {
    root = id==='tv-double'?new THREE.Group().add(...pair.map(m=>buildModule(m,ctx))):buildModule(mod, ctx)
    root.userData.moduleType = mod.type; root.userData.moduleId = mod.id; root.userData.levelZs = [0]
    return run(root, mod)
  } finally {
    if (root) disposeObject(root)
    for (const mat of ctx.ownedMats) mat.dispose()
    disposeModelMaterials(mats)
    globalThis.document = previous
  }
}

const budgets = [
  ...['dark-tall', 'white-tall', 'white-short', 'wire', 'cooler', 'cooler-dark'].map(v => [`shelf-${v}`, .1]),
  ['cubicle', .05], ['sink', .1], ['cctv', .1], ['cctv-post', .1], ['cctv-ptz', .1], ['cctv-dome', .1],
  ['roof-canopy', .5], ['clock', .12],
  ['extinguisher', .35], ['extinguisher-compact', .35], ['extinguisher-glass', .15],
  ['checkout', .15], ['vending', .3], ['desk', .35], ['gate', .25], ['gate-new', .2],
  ['fence', .2], ['fence-gate', .25], ['fence-iron', .35],
  ...['exit-covered-1', 'exit', 'exit-covered-3'].map(id => [id, .4]),
  ...['exit-uncovered-1', 'exit-uncovered-2', 'exit-uncovered-3'].map(id => [id, .3]),
  ...['exit-doorway-1', 'exit-doorway-2', 'exit-doorway-3', 'exit-doorway-4'].map(id => [id, .4]),
  ['exit-virtual', .8],
  ['rail-signal', .21], ['noise-barrier', .49], ['noise-barrier-half', .49], ['noise-barrier-railing', .67],
  ['electrical-cabinet', .05], ['ac-unit', .1], ['tactile-warning', .05], ['bridge', .15],
  ['escalator', .2], ['walkway', .2], ['lift', .4], ['stair-block', .75],
  ...['straight', 'leftForward', 'centerForward', 'rightForward', 'left90', 'right90', 'left180', 'right180'].map(v => [`stair-${v}`, .5]),
]
for (const option of MODULE_OPTIONS) test(`${option.id}: every palette model over ten triangles has reduced Low geometry`, () => fixture(option.id, (root, mod) => {
  if (!root) return
  const full = totals(root), low = totals(root, true)
  const budget = equipmentLowBudget(option.id, full)
  assert.ok(low <= budget.limit, `${option.id}: ${low}/${full} exceeds budget ${budget.limit}; ${budget.reason ?? 'strict <10%'}`)
  if (full <= 10) return
  assert.ok(low > 0 && low < full, `${option.id}: ${low}/${full}`)
  const detail = new SourceGeometryDetail(), original = new Map()
  root.traverse(mesh => { if (mesh.isMesh) original.set(mesh, mesh.geometry) })
  try {
    detail.apply(root, true)
    if (![...original.keys()].some(mesh => mesh.userData.staticInstances)) assert.equal(totals(root), low)
    detail.restore()
    for (const [mesh, geometry] of original) assert.equal(mesh.geometry, geometry)
    batchStaticModule(root, mod.type)
    assert.equal(totals(root), full)
    assert.equal(totals(root, true), low, 'batching preserves the reduced variant')
  } finally { detail.restore() }
}))
for (const [id, ratio] of budgets) test(`${id} meets its authored Low triangle budget before and after local batching`, () => fixture(id, (root, mod) => {
  const full = totals(root), low = totals(root, true)
  assert.ok(full > 0 && low > 0)
  assert.ok(low <= full * ratio, `${id}: ${low}/${full} triangles`)
  batchStaticModule(root, mod.type)
  assert.equal(totals(root), full, 'full model is geometrically unchanged')
  assert.ok(totals(root, true) <= full * ratio, 'local batching preserves the authored approximation')
}))

for (const id of ['stair-straight', 'stair-leftForward', 'stair-left90', 'stair-left180']) test(`${id}: Low retains every real tread, complete walking surface extent and both end heights`, () => fixture(id, root => {
  root.updateMatrixWorld(true)
  const high = [], low = [], flights = new Map()
  root.traverse(mesh => {
    if (!mesh.isMesh || !['stair-tread', 'stair-riser'].includes(mesh.name)) return
    const far = modelDetailGeometry(mesh), count = far.index?.count ?? far.attributes.position.count
    if (mesh.name === 'stair-tread') {
      const flight = flights.get(mesh.parent) ?? { high: 0, low: 0 }
      flight.high++; if (count) flight.low++; flights.set(mesh.parent, flight)
    }
    for (const [geometry, output] of [[mesh.geometry, high], [far, low]]) {
      const position = geometry.attributes.position
      for (let i = 0; i < position.count; i++) output.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }
  })
  assert.ok(flights.size > 0)
  for (const flight of flights.values()) assert.equal(flight.low, flight.high, 'keep every real step so walking feet cannot clip through enlarged coarse treads')
  const source = new THREE.Box3().setFromPoints(high), reduced = new THREE.Box3().setFromPoints(low)
  assert.ok(source.min.distanceTo(reduced.min) < 1e-5)
  assert.ok(source.max.distanceTo(reduced.max) < 1e-5)
}))

for (const rot of [0, 1, 2, 3]) test(`Low covered-exit glazing meets its folded canopy without gaps at rotation ${rot}`, () => fixture('exit', root => {
  root.updateMatrixWorld(true)
  const knots = new Map(), glass = []
  root.traverse(mesh => {
    if (!mesh.isMesh || !['exit-canopy-segment', 'exit-side-glass'].includes(mesh.name)) return
    const low = modelDetailGeometry(mesh), position = low.attributes.position
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrix)
      if (mesh.name === 'exit-canopy-segment') knots.set(point.y.toFixed(5), [point.y, point.z])
      else if (point.z > .31) glass.push(point)
    }
  })
  const roof = [...knots.values()].sort((a, b) => a[0] - b[0])
  assert.equal(roof.length, 3, 'the Low canopy has two coherent folded spans')
  assert.ok(glass.length > 0)
  for (const point of glass) {
    const j = point.y <= roof[1][0] ? 0 : 1, [y0, z0] = roof[j], [y1, z1] = roof[j + 1]
    const height = z0 + (z1 - z0) * (point.y - y0) / (y1 - y0)
    assert.ok(Math.abs(point.z - height) < 1e-5, `${point.z} vs canopy ${height}`)
  }
}, mod => { mod.rot = rot }))

test('printed monitor artwork switches coherently through cross-module batches at any High distance', () => fixture('monitor-wall', root => {
  const container = new THREE.Group(), batches = new EquipmentBatches(), camera = new THREE.PerspectiveCamera(60, 1, .1, 1000)
  container.add(root); camera.position.set(5, 40, 5); camera.lookAt(5, 4, 2); camera.updateMatrixWorld(true)
  try {
    batches.sync(container, 'monitor', 'artwork')
    const entries = [...batches.entries.values()].filter(entry => entry.sources[0].mesh.userData.coherentModelDetail)
    assert.ok(entries.length > 1)
    const original = entries.map(entry => entry.mesh.geometry)
    const count = () => entries.reduce((sum, entry) => sum + triangles(entry.mesh.geometry) * (entry.mesh.isInstancedMesh ? entry.mesh.count : 1), 0)
    const high = count(); assert.ok(high > 150, 'all twelve feeds are real vector artwork')
    batches.updateDetail(camera, 1)
    assert.equal(count(), high, 'a tiny projected view cannot erase individual ink layers at High')
    entries.forEach((entry, i) => assert.equal(entry.mesh.geometry, original[i]))
    batches.graphicsQuality = 'low'; batches.updateDetail(camera, 1)
    assert.equal(count(), 2, 'the complete composition becomes one printed quad')
    batches.hideUI = true; batches.updateDetail(camera, 1); assert.equal(count(), 2)
    batches.graphicsQuality = 'high'; batches.updateDetail(camera, 1)
    entries.forEach((entry, i) => assert.equal(entry.mesh.geometry, original[i], 'restores the same cached full buffers'))
    batches.hideUI = false; batches.activeZ = 5; batches.updateDetail(camera, 1)
    assert.equal(count(), 2, 'High still reduces the whole composition on a ghost storey')
    batches.hideUI = true; batches.updateDetail(camera, 1)
    assert.equal(count(), high, 'High presentation restores all storeys coherently')
    batches.graphicsQuality = 'low'; batches.updateDetail(camera, 1)
    assert.equal(count(), 2, 'Low presentation keeps the complete reduced print')
  } finally { batches.clear() }
}))

for (const rot of [0, 1, 2, 3]) test(`merged Low exit pads preserve every drawn floor/wellway sample at rotation ${rot}`, () => fixture('exit-uncovered-3', (root, mod) => {
  root.updateMatrixWorld(true)
  const pads = []; root.traverse(mesh => { if (mesh.name === 'exit-concrete-base') pads.push(mesh) })
  const bounds = new THREE.Box3()
  for (const pad of pads) bounds.union(pad.geometry.boundingBox.clone().applyMatrix4(pad.matrixWorld))
  const drawHit = (ray, low) => pads.some(pad => {
    const drawing = new THREE.Mesh(low ? modelDetailGeometry(pad) : pad.geometry, pad.material)
    drawing.matrixWorld.copy(pad.matrixWorld)
    return ray.intersectObject(drawing).length > 0
  })
  let floor = 0, holes = 0
  for (let x = bounds.min.x + .125; x < bounds.max.x; x += .25) for (let y = bounds.min.y + .125; y < bounds.max.y; y += .25) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, mod.z + 4), new THREE.Vector3(0, 0, -1))
    const high = drawHit(ray, false)
    if (high) floor++; else holes++
    assert.equal(drawHit(ray, true), high, `drawn pad sample ${x},${y}`)
  }
  assert.ok(floor > 0 && holes > 0, 'fixture includes solid pad and two actual descending wellways')
}, (mod, data) => {
  mod.rot = rot
  for (const bay of [0, 2]) {
    const [x, y, z] = exitBayCell(mod, bay), snap = exitRunSnap([mod], x, y, z)
    data.modules.push(createModule('stair-straight', snap.base.x, snap.base.y, snap.base.z, `wellway-${bay}`, snap.rot))
  }
}))

for (const kind of ['instanced', 'merged', 'transparent']) test(`${kind} equipment batches retain combined Near/Low bounds outside the original source view`, () => {
  const root = new THREE.Group(), module = new THREE.Group(), batches = new EquipmentBatches()
  const material = new THREE.MeshStandardMaterial({ transparent: kind === 'transparent', opacity: .5 })
  module.userData = { moduleType: 'bench', moduleId: kind, levelZs: [0] }; root.add(module)
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(kind === 'merged' && i ? 1.1 : 1, 1, 1), material)
    mesh.position.x = i; module.add(mesh)
    setModelDetail(mesh, new THREE.BoxGeometry(1, 1, 1).translate(12, 0, 0))
  }
  const camera = new THREE.OrthographicCamera(-.7, .7, .7, -.7, .1, 20)
  camera.up.set(0, 0, 1); camera.position.set(12, -3, 0); camera.lookAt(12, 0, 0); camera.updateMatrixWorld(true)
  try {
    batches.sync(root, kind, 'combined-bounds')
    const mesh = batches.root.children[0]
    assert.equal(!!mesh.isInstancedMesh, kind === 'instanced')
    assert.equal(!!mesh.isBatchedMesh, kind === 'transparent')
    batches.graphicsQuality = 'low'; batches.updateDetail(camera, 256); batches.root.updateMatrixWorld(true)
    const sphere = mesh.boundingSphere ?? mesh.geometry.boundingSphere
    assert.ok(sphere.containsPoint(new THREE.Vector3(13.5, .5, .5)), 'Low content can extend across the spatial bucket without disappearing')
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    assert.ok(frustum.intersectsObject(mesh), 'camera sees only the Low extension, outside both Near fittings')
    batches.detailEnabled = false; batches.updateDetail(camera, 256)
    assert.ok(frustum.intersectsObject(mesh), 'cached union survives restoration and another detail transition')
  } finally { batches.clear(); disposeObject(root); material.dispose() }
})

test('Low rail signal retains three unobstructed aspects, their materials, exact picks and full restoration', () => fixture('rail-signal', root => {
  assert.equal(totals(root), 708)
  const lamps = [0, 1, 2].map(i => root.getObjectByName(`signal-lamp-${i}`))
  const original = new Map(), detail = new SourceGeometryDetail()
  root.traverse(mesh => { if (mesh.isMesh) original.set(mesh, { geometry: mesh.geometry, material: mesh.material, position: mesh.position.clone() }) })
  root.updateMatrixWorld(true)
  const casts = lamps.map(lamp => {
    const centre = lamp.getWorldPosition(new THREE.Vector3())
    const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, -1, 0)), new THREE.Vector3(0, 1, 0))
    assert.equal(ray.intersectObject(root, true)[0].object, lamp)
    return [ray, ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance])]
  })
  assert.notEqual(lamps[0].material, lamps[1].material)
  try {
    detail.apply(root, true)
    assert.equal(totals(root), 64)
    for (const [ray, hits] of casts) assert.deepEqual(ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance]), hits)
    for (const lamp of lamps) assert.equal(triangles(lamp.geometry), 6)
    for (const [mesh, saved] of original) { assert.equal(mesh.material, saved.material); assert.deepEqual(mesh.position, saved.position) }
    detail.restore()
    for (const [mesh, saved] of original) assert.equal(mesh.geometry, saved.geometry)
  } finally { detail.restore() }
}))

for (const id of ['noise-barrier', 'noise-barrier-half', 'noise-barrier-railing']) for (const rot of [0, 1, 2, 3]) test(`${id} Low keeps exact picks and restored geometry at rotation ${rot}`, () => fixture(id, root => {
  const originals = new Map(), detail = new SourceGeometryDetail()
  root.traverse(mesh => { if (mesh.isMesh) originals.set(mesh, mesh.geometry) })
  root.updateMatrixWorld(true)
  const rays = []
  for (const [mesh, geometry] of originals) {
    geometry.computeBoundingBox()
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
    const direction = new THREE.Vector3(0, 1, 0).transformDirection(mesh.matrixWorld)
    const ray = new THREE.Raycaster(centre.clone().addScaledVector(direction, -3), direction)
    const hits = ray.intersectObject(mesh).map(h => h.distance)
    assert.ok(hits.length); rays.push([mesh, ray, hits])
  }
  const low = totals(root, true)
  try {
    detail.apply(root, true); assert.equal(totals(root), low)
    for (const [mesh, ray, hits] of rays) assert.deepEqual(ray.intersectObject(mesh).map(h => h.distance), hits)
    detail.restore()
    for (const [mesh, geometry] of originals) assert.equal(mesh.geometry, geometry)
  } finally { detail.restore() }
}, mod => { mod.rot = rot }))

test('Low shared bridge barriers preserve post/gantry cutouts and frame clearances on long runs', () => {
  const mats = { white: new THREE.MeshStandardMaterial(), steel: new THREE.MeshStandardMaterial(), glass: new THREE.MeshStandardMaterial({ transparent: true, opacity: .26, side: THREE.DoubleSide }) }
  try {
    for (const width of [1, 9]) for (const catenary of [false, true]) for (const top of [2, 3.5]) {
      const root = new THREE.Group()
      try {
        buildBridgeNoiseBarrier(root, mats, width, 0, top, catenary, [{ x: -.5, y: 0 }, { x: 4, y: 0 }])
        assert.ok(root.children.length > 0)
        for (const mesh of root.children) {
          mesh.geometry.computeBoundingBox()
          const low = modelDetailGeometry(mesh)
          if (mesh.name === 'bridge-barrier-post') assert.equal(low, null)
          else {
            assert.equal(triangles(low), mesh.name === 'bridge-barrier-top-rail' ? 8 : 4)
            assert.deepEqual(low.boundingBox, mesh.geometry.boundingBox)
            assert.ok(low.attributes.position.array.every(Number.isFinite))
          }
        }
        assert.ok(totals(root, true) < totals(root) * .55)
      } finally { disposeObject(root) }
    }
    for (const catenary of [false, true]) {
      const root = new THREE.Group()
      try { buildBridgeRailing(root, mats, 9, 0, catenary); assert.ok(totals(root, true) < totals(root)) }
      finally { disposeObject(root) }
    }
  } finally { Object.values(mats).forEach(material => material.dispose()) }
})

test('Low clock keeps both readable animated faces, exact picking and full restoration', () => fixture('clock', root => {
  assert.equal(totals(root), 1940)
  const rig = root.userData.clockRig, detail = new SourceGeometryDetail()
  const pivots = [...rig.hour, ...rig.minute], arms = pivots.map(p => p.children[0])
  const full = arms.map(arm => arm.geometry)
  const body = root.children[0]
  root.updateMatrixWorld(true)
  const origin = new THREE.Vector3(0, -1, 0).applyMatrix4(body.matrixWorld)
  const direction = new THREE.Vector3(0, 1, 0).transformDirection(body.matrixWorld)
  const ray = new THREE.Raycaster(origin, direction)
  const hits = ray.intersectObject(body).map(h => h.distance)
  assert.ok(hits.length)
  try {
    detail.apply(root, true)
    assert.equal(totals(root), 188)
    assert.deepEqual(ray.intersectObject(body).map(h => h.distance), hits)
    assert.ok(arms.every(arm => triangles(arm.geometry) === 2))
    const pose = pivots.map(p => p.rotation.y)
    reposeClockHands(rig, 3 * 3600 + 30 * 60)
    assert.ok(pivots.every((p, i) => p.rotation.y !== pose[i]))
    assert.equal(rig.hour[0].rotation.y, rig.hour[1].rotation.y)
    assert.equal(rig.minute[0].rotation.y, rig.minute[1].rotation.y)
    const low = arms.map(arm => arm.geometry)
    detail.restore()
    assert.ok(arms.every((arm, i) => arm.geometry === full[i]))
    detail.apply(root, true)
    assert.ok(arms.every((arm, i) => arm.geometry === low[i]), 'reuses prepared buffers')
  } finally { detail.restore() }
}))

for (const [id, name] of [['shelf-cooler', 'stock-bottles'], ['checkout', 'checkout-stock']]) test(`${id} Low removes every product instance but keeps exact stock picks and GPU matrices`, () => fixture(id, root => {
  const stock = root.children.find(m => m.name === name)
  root.updateMatrixWorld(true)
  const matrix = new THREE.Matrix4(); stock.getMatrixAt(0, matrix)
  const centre = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(stock.matrixWorld)
  const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, -2, 0)), new THREE.Vector3(0, 1, 0))
  const before = ray.intersectObject(stock).map(hit => [hit.instanceId, hit.distance])
  assert.ok(before.length)
  const geometry = stock.geometry, matrices = stock.instanceMatrix, detail = new SourceGeometryDetail()
  try {
    detail.apply(root, true)
    assert.equal(triangles(stock.geometry), 0)
    assert.equal(stock.instanceMatrix, matrices)
    assert.deepEqual(ray.intersectObject(stock).map(hit => [hit.instanceId, hit.distance]), before)
    detail.restore(); assert.equal(stock.geometry, geometry)
  } finally { detail.restore() }
}))

for (const axis of ['x', 'y', 'z']) test(`thin ${axis} panel keeps two visible faces, bounds, exact picks and retained restoration`, () => {
  const original = new THREE.BoxGeometry(2, 3, 4), mesh = new THREE.Mesh(original, new THREE.MeshStandardMaterial())
  panelModelDetail(mesh, axis)
  const low = modelDetailGeometry(mesh)
  assert.equal(triangles(low), 4)
  assert.deepEqual(low.boundingBox, original.boundingBox)
  const ray = new THREE.Raycaster(), detail = new SourceGeometryDetail()
  try {
    mesh.updateMatrixWorld()
    for (const sign of [-1, 1]) {
      const position = new THREE.Vector3(); position[axis] = sign * 10
      ray.set(position, position.clone().normalize().negate())
      const fullHits = ray.intersectObject(mesh).map(hit => hit.distance)
      assert.ok(fullHits.length)
      mesh.geometry = low
      assert.deepEqual(ray.intersectObject(mesh).map(hit => hit.distance), fullHits, 'both broad faces keep their winding')
      mesh.geometry = original
    }
    detail.apply(mesh, true); assert.equal(mesh.geometry, low)
    detail.restore(); assert.equal(mesh.geometry, original)
  } finally { detail.restore(); original.dispose(); mesh.material.dispose() }
})

for (const axis of ['x', 'y', 'z']) test(`Low ${axis} beam keeps its four side faces and full end-cap picking`, () => {
  const source = new THREE.BoxGeometry(2, 3, 4), mesh = new THREE.Mesh(source), detail = new SourceGeometryDetail()
  beamModelDetail(mesh, axis)
  const low = modelDetailGeometry(mesh)
  assert.equal(triangles(low), 8)
  assert.deepEqual(low.boundingBox, source.boundingBox)
  const component = { x: 0, y: 1, z: 2 }[axis]
  assert.ok(Array.from(low.index.array).every(i => low.attributes.normal.array[i * 3 + component] === 0), 'only the joint end caps are omitted')
  const origin = new THREE.Vector3(); origin[axis] = 10
  const ray = new THREE.Raycaster(origin, origin.clone().normalize().negate())
  mesh.updateMatrixWorld()
  const hits = ray.intersectObject(mesh).map(h => h.distance)
  assert.ok(hits.length)
  try {
    mesh.geometry = low; assert.equal(ray.intersectObject(mesh).length, 0)
    mesh.geometry = source
    detail.apply(mesh, true)
    assert.deepEqual(ray.intersectObject(mesh).map(h => h.distance), hits)
    detail.restore(); assert.equal(mesh.geometry, source)
  } finally { detail.restore(); source.dispose(); mesh.material.dispose() }
})

test('combined Low fittings have conservative bounds for their complete approximation', () => {
  const source = new THREE.BoxGeometry(.1, .1, .1), mesh = new THREE.Mesh(source)
  const low = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 1)
  setModelDetail(mesh, low)
  assert.ok(low.boundingBox.containsBox(new THREE.Box3(new THREE.Vector3(-.5, -.5, .5), new THREE.Vector3(.5, .5, 1.5))))
  assert.ok(low.boundingBox.containsBox(source.boundingBox))
  assert.ok(low.boundingSphere.containsPoint(new THREE.Vector3(.5, .5, 1.5)))
  source.dispose(); mesh.material.dispose()
})

for (const id of ['gate', 'gate-new']) test(`${id} Low keeps live retracting leaves, direction artwork and full restoration`, () => fixture(id, root => {
  const wing = root.userData.wing, leaves = wing.children.slice(), full = leaves.map(m => m.geometry)
  const detail = new SourceGeometryDetail(), artwork = []
  root.traverse(mesh => { if (mesh.name === 'entry-arrow' || mesh.name === 'no-entry-cross') artwork.push(mesh) })
  assert.equal(artwork.length, 2)
  try {
    detail.apply(root, true)
    const low = leaves.map(m => m.geometry), closed = leaves.map(m => m.position.x)
    for (const mesh of artwork) assert.ok(triangles(mesh.geometry) > 0)
    for (const open of [.5, 1, 0]) {
      setGateWing(root, open)
      assert.equal(root.userData.wing, wing)
      for (let i = 0; i < leaves.length; i++) {
        assert.equal(leaves[i].geometry, low[i]); assert.equal(wing.children[i], leaves[i])
        assert.ok(leaves[i].scale.x > 0)
        if (open) assert.notEqual(leaves[i].position.x, closed[i])
        else assert.equal(leaves[i].position.x, closed[i])
      }
    }
    detail.restore(); assert.ok(leaves.every((m, i) => m.geometry === full[i]))
  } finally { detail.restore() }
}))

for (const id of ['gate', 'gate-new']) for (const rot of [0, 1, 2, 3]) test(`${id} doorless Low keeps its carried fence and full picks at rotation ${rot}`, () => fixture(id, root => {
  assert.equal(root.userData.wing, undefined)
  const full = totals(root), source = new Map(), detail = new SourceGeometryDetail()
  root.updateMatrixWorld(true)
  root.traverse(mesh => { if (mesh.isMesh) source.set(mesh, mesh.geometry) })
  const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3())
  const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(2, -3, .2)), new THREE.Vector3(-2, 3, -.2).normalize())
  const before = ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance])
  assert.ok(before.length)
  try {
    detail.apply(root, true)
    assert.ok(totals(root) < full * .4)
    assert.deepEqual(ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance]), before)
    detail.restore()
    for (const [mesh, geometry] of source) assert.equal(mesh.geometry, geometry)
  } finally { detail.restore() }
}, mod => { mod.rot = rot; mod.cfg.door = 'fence' }))

for (const id of ['fence', 'fence-gate', 'fence-iron']) test(`${id} Low keeps joined panels on both axes`, () => fixture(id, (root, mod) => {
  const full = totals(root), low = totals(root, true)
  assert.ok(low > 0 && low < full * .4)
  const glass = []
  root.traverse(mesh => { if (mesh.isMesh && mesh.material.transparent) glass.push(mesh) })
  if (id !== 'fence-iron') {
    assert.equal(glass.length, 2)
    assert.ok(glass.every(mesh => triangles(modelDetailGeometry(mesh)) === 2), 'DoubleSide glass keeps one surface visible from both approaches')
  }
  batchStaticModule(root, mod.type)
  assert.equal(totals(root), full)
  assert.equal(totals(root, true), low)
}, (mod, data) => {
  data.modules.push(createModule(id, mod.x + 1, mod.y, mod.z, 'east'), createModule(id, mod.x, mod.y + 1, mod.z, 'north'))
}))

test('authored omissions survive merged batches, low detail in Hide UI and repeated disposal', () => {
  const material = new THREE.MeshStandardMaterial(), root = new THREE.Group(), model = new THREE.Group()
  model.userData = { moduleType: 'bench', moduleId: 'one', levelZs: [0] }; root.add(model)
  const first = new THREE.Mesh(new THREE.BoxGeometry(), material), second = new THREE.Mesh(new THREE.BoxGeometry(), material)
  second.position.x = 2; model.add(first, second); omitModelDetail(second)
  const low = second.userData.lowDetailGeometry; let releases = 0
  low.addEventListener('dispose', () => releases++)
  const batches = new EquipmentBatches(), camera = new THREE.PerspectiveCamera(60, 1, .1, 100)
  camera.position.z = 5; camera.updateMatrixWorld()
  try {
    batches.sync(root, 'one', 'document')
    const mesh = batches.root.children[0], full = mesh.geometry
    assert.equal(triangles(full), 24)
    batches.graphicsQuality = 'low'; batches.updateDetail(camera, 800)
    assert.equal(triangles(mesh.geometry), 12, 'identical full meshes with different Low variants cannot share one instanced geometry')
    const reduced = mesh.geometry
    batches.hideUI = true; batches.updateDetail(camera, 800); assert.equal(mesh.geometry, reduced)
    batches.hideUI = false; batches.updateDetail(camera, 800); assert.equal(mesh.geometry, reduced)
    assert.equal(batches.root.children[0], mesh)
  } finally {
    batches.clear(); disposeObject(root); disposeObject(root); material.dispose()
  }
  assert.equal(releases, 1)
})

test('authored geometry keeps finish colours and releases replaced approximations once', () => {
  const source = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ vertexColors: true })
  source.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count * 3).fill(1), 3))
  const mesh = new THREE.Mesh(source, material), low = new THREE.PlaneGeometry()
  setModelDetail(mesh, low)
  assert.ok([...low.attributes.color.array].every(value => value === 1), 'painted stairs must not turn black')
  assert.deepEqual(low.boundingBox, source.boundingBox)
  let count = 0; low.addEventListener('dispose', () => count++)
  setModelDetail(mesh, new THREE.BoxGeometry()); source.dispose(); source.dispose()
  assert.equal(count, 1); material.dispose()
})

for (const id of ['escalator', 'walkway', 'lift']) test(`${id} Low preserves the actual moving rig and restores all geometry`, () => fixture(id, root => {
  const originals = new Map(); root.traverse(mesh => { if (mesh.isMesh) originals.set(mesh, mesh.geometry) })
  const detail = new SourceGeometryDetail(), roll = root.userData.escalator, cabin = root.userData.liftCabin
  try {
    detail.apply(root, true)
    if (roll) {
      const matrix = roll.parts[0].instanceMatrix.array.slice()
      rollEscalator(roll, 1)
      assert.notDeepEqual(roll.parts[0].instanceMatrix.array, matrix)
      assert.equal(root.userData.escalator, roll)
    } else {
      const door = root.userData.doors[0], before = door.position.clone()
      setDoors(root, 1)
      assert.notDeepEqual(door.position, before)
      assert.equal(root.userData.liftCabin, cabin)
    }
    detail.restore()
    for (const [mesh, geometry] of originals) assert.equal(mesh.geometry, geometry)
  } finally { detail.restore() }
}))

for(const id of ['exit-covered-1','exit','exit-covered-3','exit-virtual','guidepost','linemap-wall','linemap-stand'])test(`Shenzhen ${id}: authored Low stays within the model budget`,()=>fixture(id,(root,mod)=>{
  const full=totals(root),low=totals(root,true),budget=equipmentLowBudget(id,full)
  assert.ok(low<=budget.limit,`${id}: ${low}/${full} exceeds ${budget.limit}`)
  const detail=new SourceGeometryDetail(),original=new Map()
  root.traverse(mesh=>{if(mesh.isMesh)original.set(mesh,mesh.geometry)})
  try {detail.apply(root,true);assert.equal(totals(root),low);detail.restore()
    for(const [mesh,geometry] of original)assert.equal(mesh.geometry,geometry)
    batchStaticModule(root,mod.type);assert.equal(totals(root,true),low)
  } finally {detail.restore()}
},(mod,data)=>{data.cityStyle='shenzhen'}))
