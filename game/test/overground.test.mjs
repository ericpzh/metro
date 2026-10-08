import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState, paintRoofSurface, paintStairSurface, addEquipment } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { extendedPillar } from '../src/sim/structures.ts'
import { equipmentReason, moduleEnvelope, moduleFootprint, blockReason } from '../src/sim/placement.ts'
import { checkModulePlacements } from '../src/build/validation.ts'
import { exitDoorCell, exitFloorAt, exitWallPlanes, exitRunSnap, exitDoorwayOffset } from '../src/sim/exits.ts'
import { buildGraph } from '../src/sim/station.ts'
import { commitTrack, makeTrack, makeBridge, derivePlatformEdges } from '../src/build/rail.ts'
import { rotateLocal } from '../src/sim/track.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { finishesInUse } from '../src/render/materials.ts'
import { PaintTool } from '../src/app/tools/PaintTool.ts'
import { useStore, folderTiles } from '../src/app/store.ts'
import { PillarModel } from '../src/render/models/pieces/PillarModel.ts'
import { RoofModel } from '../src/render/models/pieces/RoofModel.ts'
import { StairModel } from '../src/render/models/pieces/StairModel.ts'
import { moduleLevels } from '../src/render/scene/systems/SceneSystem.ts'

const pillar = (size = 'slim') => createModule(`pillar-${size}`, 0, 0, 0, 'pillar')
const mat = new THREE.MeshStandardMaterial()
const ctx = { finish: () => mat, mats: { white: mat, darkSteel: mat, steel: mat }, data: { name: '动物园', cells: [], modules: [], lines: [] } }
const sizeOf = (obj) => new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3())

test('short stair blocks have two paintable steps and half-metre collision bounds', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('stair-block', 0, 0, 0, 'short', rot, 0.5)
    const painted = { ...m, cfg: { ...m.cfg, finish: 'floor.tile#2266cc' } }
    const model = new StairModel(ctx).build(painted)
    const size = sizeOf(model)
    for (const [axis, expected] of [['x', 1], ['y', 1], ['z', 0.5]]) assert.ok(Math.abs(size[axis] - expected) < 1e-6)
    assert.equal(model.children.length, 2)
    const box = moduleEnvelope(m)
    assert.equal(box.z1 - box.z0, 0.5)
    assert.ok(Number.isInteger(m.to.z), 'landing references retain the document grid')
    const loaded = parse(serialize({ ...toState(emptyStation()), modules: [painted] }))
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.state.modules, [painted])
  }
})

test('small stair blocks fit one cube, paint all four steps and connect neighbouring heights', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('stair-block', 0, 0, 0, 'steps', rot, 99)
    assert.equal(m.cfg.width, 1, 'this variant ignores the normal stair width setting')
    const size = sizeOf(new StairModel(ctx).build(m))
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(size[axis] - 1) < 1e-6)
    assert.equal(equipmentReason([], [], m, true), '')
    assert.equal(equipmentReason([{ x: 0, y: 0, z: 1, fill: 'solid' }], [], m, true), 'occupied')
    assert.equal(blockReason([], [m], 0, 0, 1).reason, 'equipment', 'blocks cannot bury the steps')
    const upper = { ...m.to, fill: 'solid' }
    const state = { ...toState(emptyStation()), cells: [upper] }
    const added = addEquipment(state, m)
    assert.equal(added.cells, state.cells, 'a stair block never carves surrounding floors')
    const painted = paintStairSurface(added, m.id, 'floor.tile#2266cc')
    const materials = []
    const model = new StairModel({ ...ctx, data: painted, finish: (id) => { materials.push(id); return mat } }).build(painted.modules[0])
    assert.equal(model.children.length, 4)
    assert.deepEqual(materials, ['floor.tile#2266cc'])
    assert.ok(finishesInUse(painted).has('floor.tile#2266cc'))
    assert.deepEqual(parse(serialize(painted)).state.modules, painted.modules)
    const graph = buildGraph(painted)
    assert.equal(graph.nodeIndex.has('0,0,0'), false, 'walkers never walk through the solid stair body')
    assert.equal(graph.servers.filter((s) => s.kind === 'stair').length, 2, 'the metre-high flight is usable in both directions')
  }
})

test('pillars draw four-metre segments, extend by four and stop walkers on their column', () => {
  for (const size of ['slim', 'thick']) {
    const m = pillar(size)
    const model = new PillarModel(ctx).build(m)
    const dimensions = sizeOf(model)
    assert.ok(Math.abs(dimensions.z - 4) < 1e-6)
    assert.ok(Math.abs(dimensions.x - (size === 'thick' ? 1 : 0.3)) < 1e-6)
    const grown = extendedPillar(m)
    assert.equal(grown.cfg.height, 8)
    assert.equal(equipmentReason([], [], m, true), '')
    assert.equal(equipmentReason([{ x: 0, y: 0, z: 6, fill: 'solid' }], [], grown, true), 'occupied')
    const graph = buildGraph({ ...ctx.data, modules: [m] })
    assert.equal(graph.nodeIndex.has('0,0,0'), false)
  }
})

test('the roof places as a fixed 1x1 quarter-metre tile and uses the material finish', () => {
  const m = createModule('roof', 0, 0, 0, 'roof')
  assert.deepEqual(m.cfg, {})
  const finished = { ...m, cfg: { finish: 'wall.enamel#2266cc' } }
  const seen = []
  const model = new RoofModel({ ...ctx, finish: (id) => { seen.push(id); return mat } }).build(finished)
  const dimensions = sizeOf(model)
  assert.ok(Math.abs(dimensions.z - 0.25) < 1e-6)
  assert.equal(dimensions.x, 1)
  assert.equal(dimensions.y, 1)
  assert.deepEqual(seen, ['wall.enamel#2266cc'])
  assert.equal(equipmentReason([], [pillar()], m, true), '', 'roof touches the support top')
  assert.equal(equipmentReason([{ x: 0, y: 0, z: 5, fill: 'solid' }], [], m, true), 'occupied')
  const beside = { ...m, id: 'roof-2', x: 1 }
  assert.equal(equipmentReason([], [m], beside, true), '')
  assert.equal(equipmentReason([], [m], { ...beside, x: 0 }, true), 'occupied')
})

test('both truss styles paint only their roof sheets and retain metal supports at every width', () => {
  const metal = new THREE.MeshStandardMaterial({ color: 0xb7bdc4, metalness: 0.4 })
  for (const [style, prefix] of [['truss', 'roof-truss'], ['tapered-truss', 'roof-tapered']]) {
    for (const width of [4, 8, 12]) {
      const id = prefix
      const roof = createModule(id, 0, 0, 0, `${id}-${width}`, 0, width)
      assert.deepEqual([roof.w, roof.d, roof.cfg.variant], [4, width, style])
      const painted = { ...roof, cfg: { ...roof.cfg, finish: 'wall.enamel#2266cc' } }
      const model = new RoofModel({ ...ctx, mats: { ...ctx.mats, steel: metal }, finish: () => mat }).build(painted)
      const dimensions = sizeOf(model)
      assert.ok(Math.abs(dimensions.x - 4) < 0.01)
      assert.ok(Math.abs(dimensions.y - width) < 0.05)
      assert.ok(dimensions.z > (style === 'truss' ? 1.5 : 2), `${id} has a deep visible structure`)
      assert.equal(model.children.filter((child) => child.material === mat).length, 2, `${id} paints only the two roof sheets`)
      assert.ok(model.children.slice(2).every((child) => child.material === metal), `${id} keeps every beam and brace metallic`)
      for (const child of model.children) {
        const colors = child.geometry.getAttribute('color')
        assert.ok(colors, `${id}: finish materials require vertex colours on sheets and beams`)
        assert.equal(colors.count, child.geometry.getAttribute('position').count)
        assert.ok([...colors.array].every((value) => value === 1), 'neutral vertex colours preserve the painted finish instead of rendering black')
        const uv = child.geometry.getAttribute('uv')
        const dimensions = child.geometry.parameters
        const us = [16, 17, 18, 19].map((i) => uv.getX(i))
        assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - dimensions.width) < 1e-5, 'top-face textures repeat once per metre')
      }
      const box = moduleEnvelope(roof)
      assert.ok(box.z1 - box.z0 > 2)
      if (width === 12) assert.deepEqual(moduleLevels(roof), [4, 8], 'the broad ridge remains visible on the upper storey')
      assert.equal(equipmentReason([{ x: 2, y: Math.floor(width / 2), z: Math.floor(box.z1 - 0.1), fill: 'solid' }], [], roof, true), 'occupied', 'the ridge is part of placement')
      assert.equal(equipmentReason([], [roof], { ...roof, id: 'next', x: 4 }, true), '', 'adjacent bays join without overlap')
      assert.equal(equipmentReason([], [roof], { ...roof, id: 'overlap', x: 3 }, true), 'occupied')
      const bottom = model.children.filter((child) => new THREE.Box3().setFromObject(child).max.z < (style === 'truss' ? 6 : 5.3))
      assert.ok(bottom.length > 0)
      assert.ok(bottom.every((child) => sizeOf(child).x > 2.9 && sizeOf(child).y < 0.3), `${id} lower beams run parallel to the crest`)
      if (style === 'tapered-truss') assert.equal(bottom.length, 1, 'the tapered roof has one central bottom beam')
    }
  }
})

test('roof paint handles single tiles and connected surfaces without changing floor or other levels', () => {
  const modules = [createModule('roof', 0, 0, 0, 'a'), createModule('roof', 1, 0, 0, 'b'), createModule('roof', 1, 1, 0, 'c'), createModule('roof', 4, 0, 0, 'gap'), createModule('roof', 0, 0, 4, 'upper')]
  const state = { ...toState(emptyStation()), modules }
  const single = paintRoofSurface(state, 'a', 'wall.enamel#2266cc')
  assert.equal(single.modules[0].cfg.finish, 'wall.enamel#2266cc')
  assert.equal(single.modules[1].cfg.finish, undefined)
  assert.ok(finishesInUse(single).has('wall.enamel#2266cc'), 'the roof keeps its painted material alive across scene rebuilds')
  const all = paintRoofSurface(single, 'a', 'floor.tile', true)
  assert.deepEqual(all.modules.map((m) => m.cfg.finish), ['floor.tile', 'floor.tile', 'floor.tile', undefined, undefined])
  assert.equal(all.cells, state.cells)
  assert.equal(state.modules[0].cfg.finish, undefined, 'undo retains the original unpainted document')
  assert.equal(paintRoofSurface(all, 'a', 'floor.tile', true), all, 'same finish makes no undo entry')
  const loaded = parse(serialize(all))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.modules, all.modules)
  const cleared = paintRoofSurface(all, 'a', null, true)
  assert.ok(cleared.modules.every((m) => m.cfg.finish === undefined))
})

test('surface paint crosses the shared edge of two truss bays', () => {
  const modules = [createModule('roof-truss', 0, 0, 0, 'a'), createModule('roof-tapered', 4, 0, 0, 'b'), createModule('roof', 8, 0, 0, 'c'), createModule('roof-truss', 10, 0, 0, 'gap')]
  const state = { ...toState(emptyStation()), modules }
  const painted = paintRoofSurface(state, 'a', 'ceil.metal', true)
  assert.deepEqual(painted.modules.map((m) => m.cfg.finish), ['ceil.metal', 'ceil.metal', 'ceil.metal', undefined])
})

test('doorway frames sit against the near block edge in every rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const [dx, dy] = exitDoorwayOffset(rot)
    const [expectedX, expectedY] = rotateLocal(rot, 0, -0.3)
    assert.ok(Math.abs(dx - expectedX) < 1e-9)
    assert.ok(Math.abs(dy - expectedY) < 1e-9)
    assert.ok(Math.abs(Math.hypot(dx, dy) + 0.2 - 0.5) < 1e-9, 'the foot touches the edge while staying inside the tile')
  }
})

test('doorway exits register in the graph in every width and rotation without carving a pit', () => {
  for (let bays = 1; bays <= 3; bays++) for (let rot = 0; rot < 4; rot++) {
    const m = createModule(`exit-doorway-${bays}`, 0, 0, 0, 'exit', rot)
    const bounds = moduleEnvelope(m)
    assert.equal(Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0), bays + 2)
    assert.deepEqual(exitWallPlanes(m), [])
    assert.equal(exitFloorAt([m], 0, 0, 0), false)
    assert.equal(exitRunSnap([m], 0, 0, 0), null)
    const graph = buildGraph({ ...ctx.data, modules: [m] })
    assert.equal(graph.exits.length, 1)
    assert.equal(graph.exits[0].node, graph.nodeIndex.get(exitDoorCell(m).join(',')))
  }
})

test('doorway exits accept supported floors at any nonnegative height and remain graph exits', () => {
  for (let bays = 1; bays <= 3; bays++) for (let rot = 0; rot < 4; rot++) {
    for (const z of [0, 1, 4, 7, 12]) {
      const m = createModule(`exit-doorway-${bays}`, 0, 0, z, 'exit', rot)
      const cells = Array.from({ length: 81 }, (_, i) => ({ x: i % 9 - 4, y: Math.floor(i / 9) - 4, z, fill: 'solid' }))
      assert.equal(equipmentReason(cells, [], m, true), '')
      const preview = checkModulePlacements({ cells, modules: [] }, [{ id: m.id, module: m, layer: true }])
      assert.deepEqual(preview.accepted, [m.id])
      const graph = buildGraph({ ...ctx.data, cells, modules: [m] })
      assert.equal(graph.exits.length, 1)
      assert.equal(graph.exits[0].node, graph.nodeIndex.get(exitDoorCell(m).join(',')))
      if (z > 0) assert.equal(equipmentReason([], [], m, true), 'floor', 'elevated exits still need floor support')
    }
    const below = createModule(`exit-doorway-${bays}`, 0, 0, -1, 'exit', rot)
    const cells = moduleFootprint(below).map(([x, y]) => ({ x, y, z: -1, fill: 'solid' }))
    assert.equal(equipmentReason(cells, [], below, true), 'exit-below-ground')
    const preview = checkModulePlacements({ cells, modules: [] }, [{ id: below.id, module: below, layer: true }])
    assert.equal(preview.refused.get(below.id), 'exit-below-ground')
  }
  for (const style of ['covered', 'uncovered']) {
    const m = createModule(`exit-${style}-1`, 0, 0, 4, 'exit')
    assert.equal(equipmentReason([], [], m, true), 'exit-on-slab')
  }
})

test('bridges extend either end of rotated rails over void without a tunnel shell or platform doors', () => {
  for (let rot = 0; rot < 4; rot++) for (const end of [-1, 1]) {
    const src = makeTrack({ id: 'source', lineId: '1', dir: 'down', power: 'catenary', x: 0, y: 0, z: 4, w: 8, d: 3, rot })
    const m = makeBridge(src, end, 12, 'bridge')
    assert.equal(m.cfg.bridge, true)
    assert.equal(m.cfg.tunnel, undefined)
    assert.equal(m.cfg.dir, 'down')
    assert.equal(m.cfg.power, 'catenary')
    const [dx, dy] = rotateLocal(src.rot, end > 0 ? src.w : -12, 0)
    const expected = [src.x + dx, src.y + dy, src.z]
    assert.deepEqual([m.x, m.y, m.z], expected)
    const state = { ...toState(emptyStation()), modules: [src] }
    const built = commitTrack(state, m)
    assert.notEqual(built, state)
    assert.equal(built.cells.length, 0)
    assert.deepEqual(derivePlatformEdges(built, m), [])
    assert.equal(commitTrack(built, { ...m, id: 'duplicate' }), built)
  }
})

test('the new equipment survives a save/load round trip', () => {
  const modules = [extendedPillar(pillar('thick')), createModule('roof', 3, 0, 0, 'roof'), createModule('roof-truss', 4, 0, 0, 'truss'), createModule('roof-tapered', 5, 0, 0, 'tapered', 0, 12), createModule('exit-doorway-3', 9, 0, 0, 'exit'), createModule('bridge', 15, 0, 4, 'bridge')]
  const state = { ...toState(emptyStation()), modules }
  const loaded = parse(serialize(state))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.modules, modules)
})

 test('a thick support can hold a bridge at the next storey in either build order', () => {
  const src = makeTrack({ id: 'src', lineId: '1', dir: 'up', power: 'third-rail', x: -8, y: 0, z: 4, w: 8, d: 3, rot: 0 })
  const bridge = makeBridge(src, 1, 12, 'bridge')
  const pier = pillar('thick')
  const state = { ...toState(emptyStation()), modules: [src, pier] }
  assert.notEqual(commitTrack(state, bridge), state)
  assert.equal(equipmentReason([], [bridge], pier, true), '')
  const size = sizeOf(new PillarModel({ ...ctx, data: { ...ctx.data, modules: [bridge] } }).build(pier))
  assert.ok(Math.abs(size.z - 2.4) < 1e-6, 'pier head terminates at the underside of the recessed bridge deck')
 })

test('the paint pointer targets the roof model before the floor beneath it', () => {
  const roof = createModule('roof', 0, 0, 0, 'roof')
  const state = { ...toState(emptyStation()), modules: [roof] }
  useStore.setState({ station: state, paintMode: 'single', paintFinish: 'ceil.metal' })
  const tool = new PaintTool({ scene: () => ({}), pickModule: () => 'roof' })
  tool.onDown({ clientX: 0, clientY: 0, button: 0, hit: null, preventDefault() {} })
  assert.equal(useStore.getState().station.modules[0].cfg.finish, 'ceil.metal')
  assert.deepEqual(useStore.getState().station.cells, state.cells)
  tool.onDown({ clientX: 0, clientY: 0, button: 2, hit: null, preventDefault() {} })
  assert.equal(useStore.getState().station.modules[0].cfg.finish, undefined)
})

test('the structure folder owns roof and pillar tiles while equipment leaves bridges to it', () => {
  const ids = folderTiles('equipment').map((t) => t.anchor)
  assert.ok(!ids.includes('roof'))
  assert.deepEqual(folderTiles('rail').map((t) => t.anchor), ['__roof', '__pillar'])
  assert.ok(!ids.includes('bridge'))
})
