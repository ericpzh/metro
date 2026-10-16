import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { equipmentReason, moduleEnvelope, outdoorSurfaceLift, isCeilingHung, isWallMounted, moduleFloorOk, placementOnTrack, placementColliders } from '../src/sim/placement.ts'
import { MODULE_OPTIONS, decorCategoryHasId } from '../src/app/store/catalog.ts'
import { paletteIdForModule } from '../src/app/tools/PickTool.ts'
import { OutdoorSurfaceModel } from '../src/render/models/pieces/OutdoorSurfaceModel.ts'
import { buildModule } from '../src/render/models.ts'
import { TreeModel } from '../src/render/models/pieces/TreeModel.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { editOutdoorSurfaces } from '../src/build/model/OutdoorSurfaces.ts'
import { checkModulePlacements } from '../src/build/validation.ts'
import { blockIndex } from '../src/sim/blockIndex.ts'
import { readFileSync } from 'node:fs'
import { exitFootprintCells } from '../src/sim/exits.ts'
import { outdoorSurfaceIndex } from '../src/sim/outdoorSurfaces.ts'
import { isSimInertDecorEdit } from '../src/sim/decorInert.ts'
import { buildGraph, PathFinder } from '../src/sim/station.ts'
import { disposeObject } from '../src/render/models.ts'
import { retainedModuleIds } from '../src/render/moduleDependencies.ts'

for (const type of ['sidewalk', 'lawn']) {
  test(`${type}: raised finish supports every ground decor palette option`, () => {
    const surface = createModule(type, 0, 0, 0, 'surface')
    assert.equal(moduleEnvelope(surface).z1, 1.1)
    assert.equal(equipmentReason([], [], surface, true), '')
    assert.equal(equipmentReason([{ x: 0, y: 0, z: 0, fill: 'void' }], [], surface, true), 'floor')
    assert.equal(equipmentReason([], [surface], createModule(type, 0, 0, 0, 'same-again'), true), 'occupied')
    assert.equal(equipmentReason([], [surface], createModule(type === 'lawn' ? 'sidewalk' : 'lawn', 0, 0, 0, 'other'), true), '', 'the other finish on this tile is replaced, not refused')
    assert.equal(equipmentReason([], [], { ...surface, z: -4 }, true), 'outdoor-below-ground')
    for (const option of MODULE_OPTIONS.filter(o => decorCategoryHasId('floor', o.id) || decorCategoryHasId('outside', o.id))) {
      const mod = createModule(option.id, 0, 0, 0, option.id)
      if (!mod || ['road', 'sidewalk', 'lawn'].includes(mod.type)) continue
      assert.equal(equipmentReason([], [surface], mod, true), equipmentReason([], [], mod, true), option.id + ' keeps its original placement verdict')
      if (!isWallMounted(mod) && !isCeilingHung(mod)) assert.equal(outdoorSurfaceLift([surface], mod), .1, option.id + ' stands on the raised finish')
    }
    const ctx = { data: { ...emptyStation(), modules: [surface] }, mats: {}, owned: [] }
    const model = new OutdoorSurfaceModel(ctx).build(surface)
    const box = new THREE.Box3().setFromObject(model)
    assert.ok(Math.abs(box.min.z - 1) < 1e-6)
    assert.ok(Math.abs(box.max.z - 1.1) < 1e-6, 'pavers and turf do not exceed ten centimetres')
    assert.equal(model.children.length, 1, 'a surface tile uses one mesh')
    assert.equal(model.children[0].geometry, new OutdoorSurfaceModel(ctx).build(surface).children[0].geometry, 'immutable geometry is reused')
    assert.equal(paletteIdForModule(surface), type)
  })
}

test('trees place on lawns or bare ground, collide with equipment, and survive save/load', () => {
  const lawn = createModule('lawn', 0, 0, 0, 'lawn')
  const tree = createModule('tree', 0, 0, 0, 'tree')
  assert.equal(equipmentReason([], [lawn], tree, true), '')
  assert.equal(equipmentReason([], [], tree, true), '')
  assert.equal(equipmentReason([], [lawn, tree], createModule('bin', 0, 0, 0, 'bin'), true), 'occupied')
  assert.equal(outdoorSurfaceLift([lawn], tree), .1)
  assert.equal(paletteIdForModule(tree), 'tree')
  const state = toState({ ...emptyStation(), modules: [lawn, tree] })
  const loaded = parse(serialize(state))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.modules, state.modules)
  const ctx = { data: state, mats: {}, owned: [] }
  const model = new TreeModel(ctx).build(tree)
  assert.equal(buildModule(tree, ctx).position.z, 1.1, 'the actual dispatcher stands the trunk on the turf')
  assert.ok(model.getObjectByName('tree-trunk'))
  assert.equal(model.children.filter(m => m.name === 'tree-crown').length, 1)
  assert.equal(model.children.length, 2, 'baked branches and cutout leaves use two shared meshes')
  const bounds = new THREE.Box3().setFromObject(model)
  assert.ok(Math.abs(bounds.max.z - 5.5) < .001, 'the baked ash retains its 4.5 m height')
  assert.ok(model.getObjectByName('tree-trunk').geometry.getAttribute('position').count > 1000, 'branches replace the old cylinder')
})

test('a tree draws without walking: its tile stays a node and cuts no route', () => {
  // §9.5: the walk graph's only obstacle primitive is a missing node, so fencing
  // a tree's tile spends the whole square metre on a trunk the crowd can simply
  // walk past. Planting is decor (`sim/decorInert.ts`), and this is the rule that
  // keeps it one: the tile and every edge through it survive untouched. Guard it
  // here, next to the tree's placement and model, because re-fencing the tile
  // silently puts planting back on the full routing-rebuild path.
  const edgesFrom = (graph, id) => {
    const out = []
    for (let e = graph.adjStart[id]; e < graph.adjStart[id + 1]; e++) out.push(graph.nodeKey[graph.adjTo[e]])
    return out
  }
  const clean = buildGraph(emptyStation())
  const planted = buildGraph({ ...emptyStation(), modules: [createModule('tree', 0, 0, 0, 'tree')] })
  assert.ok(clean.nodeIndex.has('0,0,0'), 'the bare street is walkable to begin with')
  assert.equal(planted.nodeIndex.get('0,0,0'), clean.nodeIndex.get('0,0,0'), 'the planted tile is the same node')
  assert.equal(planted.nodeCount, clean.nodeCount, 'planting neither adds nor removes a node')
  assert.deepEqual(edgesFrom(planted, planted.nodeIndex.get('0,0,0')), edgesFrom(clean, clean.nodeIndex.get('0,0,0')), 'and no walk edge through it changed')
  // The whole leg across the tile, not only its edges: a tree the crowd walks
  // through must not lengthen, divert or block a route that crossed it.
  const walker = { stepFree: false, luggage: false }
  const leg = (graph) => [...(new PathFinder(graph).search(graph.nodeIndex.get('-1,0,0'), graph.nodeIndex.get('1,0,0'), walker) ?? [])]
  assert.ok(leg(clean).length > 0, 'the crossing leg exists at all')
  assert.deepEqual(leg(planted), leg(clean), 'and planting changes no route across it')
})

test('adding or removing raised finishes rebuilds existing equipment support heights', () => {
  const bench = createModule('bench', 0, 0, 0, 'bench')
  const surface = createModule('sidewalk', 0, 0, 0, 'surface')
  const before = { ...emptyStation(), modules: [bench] }
  const after = { ...before, modules: [bench, surface] }
  assert.equal(retainedModuleIds(before, after).has(bench.id), false)
  assert.equal(retainedModuleIds(after, before).has(bench.id), false)
  assert.equal(outdoorSurfaceLift(after.modules, bench), .1)
  assert.equal(outdoorSurfaceLift(before.modules, bench), 0)
})

test('surface bulk edits bound document reads, preserve refusals, deduplicate and remove once', () => {
  let reads = 0
  const original = Array.from({ length: 400 }, (_, i) => createModule('bin', -20 - i, 0, 0, 'bin-' + i))
  const modules = new Proxy(original, { get(target, key, receiver) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, receiver) } })
  const state = { ...emptyStation(), modules, cells: [{ x: 2, y: 2, z: 0, fill: 'void' }, { x: 3, y: 3, z: 1, fill: 'solid' }] }
  const cells = Array.from({ length: 400 }, (_, i) => [i % 20, Math.floor(i / 20), 0])
  const result = editOutdoorSurfaces(state, [...cells, cells[0]], 'sidewalk', 0)
  assert.equal(result.state.modules.length, 798, 'one hole and one obstructed tile are refused')
  assert.equal(result.check.refused.size, 2)
  assert.ok(reads < original.length * 50, `one snapshot must serve every tile, observed ${reads} document reads`)
  assert.equal(state.modules.length, 400, 'preview/validation leaves the original document untouched')
  assert.equal(result.state.cells, state.cells)
  assert.equal(new Set(result.state.modules.map(m => m.id)).size, 798)
  assert.equal(editOutdoorSurfaces(result.state, cells, 'sidewalk', 0).state, result.state, 'repeat is a no-op')
  const removed = editOutdoorSurfaces(result.state, cells, 'sidewalk', 0, true)
  assert.deepEqual(removed.state.modules, original)
})

test('a tile carries one finish: laying the other kind replaces it in the same edit', () => {
  const lawn = createModule('lawn', 0, 0, 0, 'lawn')
  const state = { ...emptyStation(), modules: [lawn] }
  const candidate = createModule('sidewalk', 0, 0, 0, 'candidate')
  // Preview and release ask the one verdict, so the ghost is not red where the
  // release accepts.
  assert.deepEqual([...checkModulePlacements(state, [{ id: candidate.id, module: candidate, layer: true }]).refused], [])
  const result = editOutdoorSurfaces(state, [[0, 0, 0]], 'sidewalk', 0)
  assert.deepEqual(result.state.modules.map(m => [m.type, m.x, m.y, m.z]), [['sidewalk', 0, 0, 0]])
  assert.ok(!result.state.modules.some(m => m.id === lawn.id), 'the replaced finish is gone, not stacked under the new one')
  assert.equal(result.state.cells, state.cells, 'a finish edit leaves the floor alone')
  assert.equal(isSimInertDecorEdit(state, result.state), true, 'swapping one finish for the other still rebuilds no routing')
  assert.equal(editOutdoorSurfaces(result.state, [[0, 0, 0]], 'sidewalk', 0).state, result.state, 'laying the same kind again is still the no-op')
  assert.deepEqual(editOutdoorSurfaces(result.state, [[0, 0, 0]], 'lawn', 0).state.modules.map(m => m.type), ['lawn'], 'and the replacement works both ways')
})

test('a replacement the verdict refuses keeps the finish that was there', () => {
  const lawn = createModule('lawn', 0, 0, 0, 'lawn')
  // The block overhead is the obstacle, not the finish the candidate would
  // replace: a refused cell must not delete the tile it failed to replace.
  const state = { ...emptyStation(), cells: [{ x: 0, y: 0, z: 1, fill: 'solid' }], modules: [lawn] }
  const candidate = createModule('sidewalk', 0, 0, 0, 'candidate')
  assert.deepEqual([...checkModulePlacements(state, [{ id: candidate.id, module: candidate, layer: true }]).refused.values()], ['occupied'])
  const result = editOutdoorSurfaces(state, [[0, 0, 0]], 'sidewalk', 0)
  assert.equal(result.state, state, 'nothing was placed, so nothing was replaced')
  assert.deepEqual(result.state.modules.map(m => m.id), [lawn.id])
})

test('one drag replaces only the tiles it can lay and leaves the rest standing', () => {
  const tiles = [0, 1, 2].map(x => createModule('lawn', x, 0, 0, `lawn-${x}`))
  const state = { ...emptyStation(), cells: [{ x: 2, y: 0, z: 1, fill: 'solid' }], modules: tiles }
  const result = editOutdoorSurfaces(state, [[0, 0, 0], [1, 0, 0], [2, 0, 0]], 'sidewalk', 0)
  assert.deepEqual(result.state.modules.map(m => [m.type, m.x]), [['lawn', 2], ['sidewalk', 0], ['sidewalk', 1]])
  assert.equal(result.check.refused.size, 1)
})

test('surface edits retain unaffected models and skip routing within the existing ground window', () => {
  const near = createModule('bench', 0, 0, 0, 'near'), far = createModule('bin', 10, 10, 0, 'far')
  const before = { ...emptyStation(), modules: [near, far] }
  const after = editOutdoorSurfaces(before, [[0, 0, 0], [1, 0, 0]], 'lawn', 0).state
  assert.equal(isSimInertDecorEdit(before, after), true)
  assert.deepEqual([...retainedModuleIds(before, after)], ['far'])
  assert.deepEqual([...retainedModuleIds(after, before)], ['far'])
  assert.notEqual(outdoorSurfaceIndex(before.modules), outdoorSurfaceIndex(after.modules))
})

test('indexed surface verdict preserves the general placement rules for floor, track, roads and elevation', () => {
  const variants = [
    { cells: [], modules: [] },
    { cells: [{ x: 0, y: 0, z: 0, fill: 'void' }], modules: [] },
    { cells: [{ x: 0, y: 0, z: 1, fill: 'solid' }], modules: [] },
    { cells: [{ x: 0, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.track' } }], modules: [] },
    { cells: [], modules: [createModule('bridge', 0, 0, 0, 'bridge')] },
    { cells: [], modules: [createModule('road', 0, 0, 0, 'road')] },
    { cells: [], modules: [createModule('lawn', 0, 0, 0, 'lawn')] },
    { cells: [], modules: [createModule('bin', 0, 0, 0, 'bin')] },
    { cells: [], modules: [createModule('escalator', 0, 0, -4, 'run')] },
    { cells: [{ x: 0, y: 0, z: 4, fill: 'solid' }], modules: [] },
  ]
  for (const doc of variants) for (const type of ['sidewalk', 'lawn']) for (const z of [-1, 0, 1, 4]) for (const x of [-1, 0, 1, 6]) {
    const mod = createModule(type, x, 0, z, 'candidate')
    const box = moduleEnvelope(mod)
    const blocked = doc.cells.some(c => c.fill === 'solid' && c.x < box.x1 && c.x + 1 > box.x0 && c.y < box.y1 && c.y + 1 > box.y0 && c.z < box.z1 && c.z + 1 > box.z0)
    // §4.3: the finish under a candidate of the **other** kind is the tile it
    // replaces, so it is never the obstacle — the same-kind one still is.
    const held = doc.modules.find(m => (m.type === 'sidewalk' || m.type === 'lawn') && m.x === mod.x && m.y === mod.y && m.z === mod.z)
    const replacing = held !== undefined && held.type !== mod.type
    const colliders = placementColliders(doc.modules, mod).filter(m => !replacing || m !== held)
    const expected = z < 0 ? 'outdoor-below-ground' : blockIndex(doc.cells, doc.modules).opening(mod.x, mod.y, mod.z) ? 'opening' : blocked ? 'occupied' : !moduleFloorOk(doc.cells, doc.modules, mod) ? 'floor' : placementOnTrack(doc.cells, mod, doc.modules) ? 'track' : colliders.length ? 'occupied' : ''
    assert.equal(equipmentReason(doc.cells, doc.modules, mod, true), expected, `${type} ${x},${z} ${JSON.stringify(doc)}`)
  }
})

test('disposing a surface preview retains the shared geometry for future placements', () => {
  const mod = createModule('sidewalk', 0, 0, 0, 'surface'), ctx = { data: emptyStation(), mats: {}, owned: [] }
  const first = new OutdoorSurfaceModel(ctx).build(mod), second = new OutdoorSurfaceModel(ctx).build(mod)
  let disposals = 0
  first.children[0].geometry.addEventListener('dispose', () => disposals++)
  disposeObject(first)
  assert.equal(disposals, 0)
  assert.equal(first.children[0].geometry, second.children[0].geometry)
})

for (const type of ['sidewalk', 'lawn']) test(`${type} never caps the Tanwei B exit, including pre-existing saved paving`, () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/tanwei-exit-b.json', import.meta.url), 'utf8'))
  const { exit, stair } = fixture
  for (const covered of [true, false]) for (let rot = 0; rot < 4; rot++) {
    const entrance = { ...exit, rot, cfg: { ...exit.cfg, covered } }
    const modules = [entrance, stair]
    const tiles = exitFootprintCells(entrance).map(([x, y, z], i) => createModule(type, x, y, z, 'paving-' + i))
    const border = []
    for (let dx = -8; dx <= 8; dx++) for (let dy = -8; dy <= 8; dy++) border.push(createModule(type, entrance.x + dx, entrance.y + dy, 0, `border-${dx}-${dy}`))
    assert.equal(outdoorSurfaceLift([...modules, ...border], entrance), 0, 'surrounding pavement must not lift the exit away from its fixed stair landing')
    const data = { ...emptyStation(), modules: [...modules, ...tiles] }
    for (const tile of tiles) {
      assert.equal(equipmentReason([], modules, tile, true), 'opening', 'preview/release protect the whole exit-owned floor')
      const context = { data, mats: {}, owned: [] }
      assert.equal(buildModule(tile, context).children.length, 0, 'saved finish must draw no triangle over the exit wellway')
      assert.equal(context.owned.length, 0, 'hidden tiles allocate no materials')
    }
    assert.equal(outdoorSurfaceLift(data.modules, entrance), 0, 'hidden finishes do not raise the exit above its stair landing')
    const surrounding = createModule(type, entrance.x + 20, entrance.y, 0, 'surrounding')
    assert.equal(equipmentReason([], modules, surrounding, true), '')
    assert.equal(buildModule(surrounding, { data, mats: {}, owned: [] }).children.length, 1)
    const result = editOutdoorSurfaces({ ...emptyStation(), modules }, tiles.map(m => [m.x, m.y, m.z]), type, 0)
    assert.equal(result.state.modules.length, modules.length, 'dragging over an existing exit cannot add caps')
  }
})

test('digging under saved paving hides it, and rebuilding the floor restores it', () => {
  const tile = createModule('sidewalk', 0, 0, 0, 'tile')
  const before = { ...emptyStation(), modules: [tile] }
  const after = { ...before, cells: [{ x: 0, y: 0, z: 0, fill: 'void' }] }
  assert.equal(retainedModuleIds(before, after).has(tile.id), false)
  assert.equal(buildModule(tile, { data: after, mats: {}, owned: [] }).children.length, 0)
  assert.equal(buildModule(tile, { data: before, mats: {}, owned: [] }).children.length, 1)
})

test('saved paving also leaves a standalone descending stair opening clear', () => {
  const { stair } = JSON.parse(readFileSync(new URL('./fixtures/tanwei-exit-b.json', import.meta.url), 'utf8'))
  const modules = [stair], occupied = blockIndex([], modules)
  let holes = 0
  for (let x = -4; x < 3; x++) for (let y = 37; y < 48; y++) {
    if (!occupied.opening(x, y, 0)) continue
    holes++
    const tile = createModule('lawn', x, y, 0, `lawn-${x}-${y}`)
    assert.equal(equipmentReason([], modules, tile, true), 'opening')
    const data = { ...emptyStation(), modules: [...modules, tile] }
    assert.equal(buildModule(tile, { data, mats: {}, owned: [] }).children.length, 0)
  }
  assert.ok(holes > 0, 'the fixture must exercise a real derived stair opening')
})
