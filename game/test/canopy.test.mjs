import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { canopyPostRows, canopyPostCells, canopyBodyBoxes } from '../src/sim/structures.ts'
import { equipmentReason, moduleEnvelope, placementBlocked, moduleBlockedCells, equipmentBlockingCell } from '../src/sim/placement.ts'
import { moduleLevels } from '../src/render/scene/systems/SceneSystem.ts'
import { buildGraph } from '../src/sim/station.ts'
import { RoofModel } from '../src/render/models/pieces/RoofModel.ts'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { hangerRoofZ } from '../src/sim/hangers.ts'

const floor = []
for (let x = -15; x <= 15; x++) for (let y = -15; y <= 15; y++) floor.push({ x, y, z: 0, fill: 'solid' })

for (const width of [4, 8, 12]) for (const rot of [0, 1, 2, 3]) test(`canopy ${width} m rotation ${rot}: two round column rows, grounded bounds, painted shell and both LODs`, () => {
  const mod = createModule('roof-canopy', 0, 0, 0, 'canopy', rot, width)
  const steel = new THREE.MeshStandardMaterial(), finish = new THREE.MeshStandardMaterial()
  const root = new RoofModel({ mats: { steel }, finish: () => finish }).build(mod)
  const bounds = new THREE.Box3().setFromObject(root), envelope = moduleEnvelope(mod)
  assert.ok(Math.abs(bounds.min.z - 1) < 1e-6, 'columns stand on the floor top')
  assert.ok(Math.abs(bounds.max.z - 6) < 1e-6, 'ridge is five metres above the floor')
  assert.equal(envelope.z0, 1); assert.equal(envelope.z1, 6)
  assert.deepEqual(moduleLevels(mod), [0, 5], 'columns and ridge remain visible on their intersected storeys')
  const posts = root.children.filter(p => p.name === 'canopy-post')
  assert.equal(posts.length, 8)
  assert.deepEqual([...new Set(posts.map(p => p.position.y))], [...canopyPostRows(width)])
  assert.equal(canopyPostRows(width)[0] + canopyPostRows(width)[1], width - 1, 'two rows are symmetric about the ridge')
  assert.equal(root.children.filter(p => p.material === finish).length, 2, 'only the two unchanged pitched sheets are painted')
  assert.ok(root.children.every(p => p.name !== 'roof-bottom-chord'), 'no ground rail')
  assert.ok(root.children.every(p => p.name === 'canopy-post' || p.name === 'roof-purlin' || p.material === finish), 'no diagonal braces')
  const original = posts.map(p => p.geometry), detail = new SourceGeometryDetail()
  const ray = new THREE.Raycaster(new THREE.Vector3(bounds.min.x - 1, bounds.min.y + .5, 2), new THREE.Vector3(1, 0, 0))
  const hits = ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance])
  detail.apply(root, true)
  posts.forEach((p, i) => {
    assert.equal(original[i].parameters.radialSegments, 24)
    assert.equal(p.geometry.parameters.radialSegments, 3)
    assert.equal(p.geometry.parameters.openEnded, true, 'Low posts use triangular tubes; picks retain the round source')
  })
  const lowBounds = new THREE.Box3().setFromObject(root)
  assert.ok(lowBounds.min.distanceTo(bounds.min) < 1e-6 && lowBounds.max.distanceTo(bounds.max) < 1e-6)
  assert.deepEqual(ray.intersectObject(root, true).map(h => [h.object.uuid, h.distance]), hits, 'Low retains exact source picks')
  detail.restore()
  posts.forEach((p, i) => assert.equal(p.geometry, original[i]))
  // A five-metre document stamps its grid onto every module on the way in, so the
  // reload is compared with the module as the load path holds it, not the literal.
  const data = { ...toState(emptyStation()), modules: [mod] }
  assert.deepEqual(parse(serialize(data)).state.modules, toState(data).modules)
})

test('canopy ground support, collisions and walking reserve columns while leaving the sheltered aisle open', () => {
  const mod = createModule('roof-canopy', 0, 0, 0, 'canopy', 0, 8)
  const [px, py] = canopyPostCells(mod)[0]
  assert.equal(equipmentReason(floor, [], mod, true), '')
  assert.equal(equipmentReason([], [], { ...mod, z: 4 }, true), 'floor')
  assert.equal(equipmentReason([], [], { ...mod, z: -4 }, true), 'exit-on-slab')
  const block = (x, y, z) => ({ x, y, z, fill: 'solid' })
  assert.equal(equipmentReason([...floor, block(1, 3, 1)], [], mod, true), '', 'ground under the canopy remains usable')
  assert.equal(equipmentReason([...floor, block(px, py, 1)], [], mod, true), 'occupied')
  assert.equal(equipmentReason([...floor, block(1, 3, 4)], [], mod, true), 'occupied')
  assert.equal(placementBlocked([mod], createModule('bin', 1, 3, 0, 'clear')), false)
  assert.equal(placementBlocked([mod], createModule('bin', px, py, 0, 'blocked')), true)
  assert.equal(moduleBlockedCells([mod], 1).has('1,3,1'), false)
  assert.equal(moduleBlockedCells([mod], 1).has(`${px},${py},1`), true)
  assert.deepEqual(equipmentBlockingCell([mod], 1, 3, 1), [])
  assert.equal(canopyBodyBoxes(mod).length, 9)
  const graph = buildGraph({ ...toState(emptyStation()), cells: floor, modules: [mod] })
  assert.equal(graph.nodeIndex.has('1,3,0'), true)
  assert.equal(graph.nodeIndex.has(`${px},${py},0`), false)
  const hanger = createModule('hanger-roof', 0, 3, 0, 'hanger')
  const height = hangerRoofZ(floor, [mod], hanger, 1, 3)
  assert.ok(height > 5 && height < 6, 'hangers read the lowered shell rather than the elevated roof')
})
