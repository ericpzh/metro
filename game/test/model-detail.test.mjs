import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildModule, createModelMaterials, disposeModelMaterials, disposeObject, rollEscalator, setDoors } from '../src/render/models.ts'
import { createModule } from '../src/build/model.ts'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { beamModelDetail, modelDetailGeometry, omitModelDetail, panelModelDetail, setModelDetail } from '../src/render/modelDetail.ts'
import { batchStaticModule } from '../src/render/batchStaticModule.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { reposeClockHands } from '../src/render/models/pieces/ClockModel.ts'
import { setGateWing } from '../src/render/models/pieces/GateModel.ts'
import { buildBridgeNoiseBarrier } from '../src/render/models/pieces/BridgeNoiseBarrier.ts'
import { buildBridgeRailing } from '../src/render/models/pieces/BridgeRailing.ts'

await geometryDetailReady
const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3
function totals(root, low = false) {
  let count = 0
  root.traverseVisible(mesh => {
    if (mesh.isMesh) count += triangles(low ? modelDetailGeometry(mesh) ?? mesh.geometry : mesh.geometry) * (mesh.isInstancedMesh ? mesh.count : 1)
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
  const mats = createModelMaterials(), mod = createModule(id, 4, 4, 0, id)
  const data = { name: 'Test', seed: 1, cells: [], modules: [mod], lines: [] }
  configure?.(mod, data)
  const ctx = { mats, data, trackCells: new Set(), finish: () => mats.steel, ownedMats: [], preview: false }
  let root
  try {
    root = buildModule(mod, ctx)
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
  ['cubicle', .05], ['sink', .1], ['cctv', .1], ['cctv-ptz', .1], ['cctv-dome', .1],
  ['clock', .12],
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
for (const [id, ratio] of budgets) test(`${id} meets its authored Low triangle budget before and after local batching`, () => fixture(id, (root, mod) => {
  const full = totals(root), low = totals(root, true)
  assert.ok(full > 0 && low > 0)
  assert.ok(low <= full * ratio, `${id}: ${low}/${full} triangles`)
  batchStaticModule(root, mod.type)
  assert.equal(totals(root), full, 'full model is geometrically unchanged')
  assert.ok(totals(root, true) <= full * ratio, 'local batching preserves the authored approximation')
}))

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
    assert.equal(totals(root), 144)
    for (const [ray, hits] of casts) assert.deepEqual(ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance]), hits)
    for (const lamp of lamps) assert.equal(triangles(lamp.geometry), 8)
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
    assert.equal(totals(root), 212)
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
    assert.ok(glass.every(mesh => triangles(modelDetailGeometry(mesh)) === 4))
  }
  batchStaticModule(root, mod.type)
  assert.equal(totals(root), full)
  assert.equal(totals(root, true), low)
}, (mod, data) => {
  data.modules.push(createModule(id, mod.x + 1, mod.y, mod.z, 'east'), createModule(id, mod.x, mod.y + 1, mod.z, 'north'))
}))

test('authored omissions survive merged batches, Hide UI restoration and repeated disposal', () => {
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
    batches.hideUI = true; batches.updateDetail(camera, 800); assert.equal(mesh.geometry, full)
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
