import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model/Equipment.ts'
import { equipmentReason, ceilingMountMissing, placementBlocked, moduleFootprint, moduleAt, blockReason } from '../src/sim/placement.ts'
import { hangerCells, hangerPostCells, hangerRoofZ, hangerRoofMissing } from '../src/sim/hangers.ts'
import { buildGraph, cellKey } from '../src/sim/station.ts'
import { familyFor, familyOptions, isDecorType } from '../src/app/store/catalog.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'

const data = { name: '挂架', seed: 1, cells: [], modules: [], lines: [] }
const variants = ['hanger-roof', 'hanger-post']

test('the two hanger choices rotate, preview distinctly and survive saving', () => {
  assert.deepEqual(familyOptions(familyFor('hanger')).map((o) => o.id), variants)
  const mods = variants.flatMap((id) => [0, 1, 2, 3].map((rot) => createModule(id, 10, 10, 0, `${id}-${rot}`, rot)))
  assert.equal(new Set(mods.map(moduleGhostKey)).size, 8, 'mount and rotation distinguish the two 4 m previews')
  for (const m of mods) {
    assert.ok(isDecorType(`hanger-${m.cfg.mount}`))
    assert.equal(hangerCells(m).length, m.w)
    assert.deepEqual(moduleFootprint(m), hangerCells(m), 'the whole beam run is its placement footprint')
    assert.ok(placementBlocked([m], { ...m, id: 'duplicate' }))
  }
  const loaded = parse(serialize({ ...data, modules: mods }))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.modules, mods)
})

test('roof hanger needs both end attachments, and accepts each roof model', () => {
  for (const rot of [0, 1, 2, 3]) {
    const m = createModule('hanger-roof', 0, 0, 0, 'h', rot, 4)
    assert.equal(equipmentReason([], [], m), 'ceiling')
    const run = hangerCells(m)
    const slabs = [run[0], run.at(-1)].map(([x, y]) => ({ x, y, z: 4, fill: 'solid' }))
    assert.equal(hangerRoofMissing(slabs, [], m), false)
    assert.equal(hangerRoofMissing(slabs.slice(1), [], m), true)
    for (const id of ['roof', 'roof-shell', 'roof-truss', 'roof-tapered']) {
      const roofs = run.map(([x, y], i) => ({ ...createModule(id, x, y, 0, `r${i}`), x, y, w: 1, d: 1 }))
      assert.equal(hangerRoofMissing([], roofs, m), false, id)
      assert.ok(hangerRoofZ([], roofs, m, ...run.at(-1)) !== undefined, id)
      assert.ok(hangerRoofZ([], roofs, m, ...run[0]) >= 5)
    }
  }
})

test('sign, clock and TV hang from the bar with no ceiling, in either build order', () => {
  for (const mount of ['roof', 'post']) for (const rot of [0, 1, 2, 3]) {
    const h = createModule(`hanger-${mount === 'post' ? 'post' : 'roof'}`, 0, 0, 0, 'h', rot, 6)
    const [x, y] = hangerCells(h)[2]
    for (const type of ['sign-ceiling', 'clock', 'tv']) {
      const item = createModule(type, x, y, 0, type, rot)
      assert.equal(ceilingMountMissing([], item, []), true)
      assert.equal(ceilingMountMissing([], item, [h]), false)
      assert.equal(equipmentReason([], [h], item), '')
      assert.equal(placementBlocked([item], h), false)
      assert.equal(moduleAt([h, item], x, y, 0)?.id, item.id)
      assert.equal(ceilingMountMissing([], { ...item, z: 4 }, [h]), true)
      if (type !== 'clock') assert.equal(ceilingMountMissing([], { ...item, rot: rot + 1 }, [h]), true)
    }
    const [endX, endY] = hangerCells(h)[0]
    assert.equal(ceilingMountMissing([], createModule('sign-ceiling', endX, endY, 0, 'wide', rot), [h]), true, 'both sign rods must reach the bar')
      assert.equal(ceilingMountMissing([], createModule('cctv', x, y, 0, 'camera', rot), [h]), false)
  }
})

test('post needs floor only under its central footing; beam leaves walking and furniture clear', () => {
  for (const rot of [0, 1, 2, 3]) {
    const h = createModule('hanger-post', 0, 0, 4, 'h', rot, 8)
    const floor = hangerPostCells(h).map(([x, y]) => ({ x, y, z: 4, fill: 'solid' }))
    assert.equal(equipmentReason(floor, [], h), '')
    assert.equal(equipmentReason(floor.slice(1), [], h), 'floor')
    const ground = { ...h, z: 0 }
    const [x, y] = hangerCells(ground)[0]
    const bench = createModule('bench-steel-1', x, y, 0, 'bench')
    assert.equal(placementBlocked([ground], bench), false)
    const [px, py] = hangerPostCells(ground)[0]
    assert.equal(placementBlocked([ground], createModule('tvm', px, py, 0, 'tvm')), true)
    assert.equal(blockReason([], [ground], x, y, 1).ok, true)
    assert.equal(blockReason([], [ground], x, y, 3).ok, false)
    const graph = buildGraph({ ...data, modules: [ground] })
    assert.ok(graph.nodeIndex.has(cellKey(x, y, 0)))
    for (const [a, b] of hangerPostCells(ground)) assert.equal(graph.nodeIndex.has(cellKey(a, b, 0)), false)
  }
})

test('steel beams measure 4/6/8m and suspension meets the actual roof surface', () => {
  const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
  for (const id of variants) for (const rot of [0, 1, 2, 3]) {
    const m = createModule(id, 0, 0, 0, id, rot)
    const roofs = hangerCells(m).map(([x, y], i) => ({ ...createModule('roof-shell', x, y, 0, `r${i}`), x, y, w: 1, d: 1 }))
    const g = buildModule(m, { mats, data: { ...data, modules: roofs }, trackCells: new Set() })
    const bar = g.getObjectByName('hanger-bar')
    assert.equal(bar.geometry.parameters.width, m.w)
    assert.equal(bar.geometry.parameters.depth, 0.2)
    assert.equal(!!g.getObjectByName('hanger-post'), m.cfg.mount === 'post')
    if (m.cfg.mount === 'roof') {
      const rod = g.getObjectByName('hanger-suspension')
      assert.ok(Math.abs(rod.position.z + rod.geometry.parameters.depth / 2 + 1 - hangerRoofZ([], roofs, m, ...hangerCells(m)[0])) < 1e-6)
    }
  }
})

test('equipment preview and click commit the same hanger and supported fitting, with undo', () => {
  const before = useStore.getState()
  try {
    for (const id of variants) {
      const roof = { ...createModule('roof-truss', 0, 0, 0, 'roof'), x: -4, y: -1, w: 12, d: 4 }
      useStore.setState({ station: toState({ ...data, modules: [roof] }), past: [], future: [], moduleType: id, moduleRot: 0 })
      const tool = new EquipmentTool({})
      const preview = tool.buildPlacementModules(id, [0, 0, 0], 'preview')[0]
      assert.equal(equipmentReason([], [roof], preview), '')
      tool.placeModule([0, 0, 0], [0, 0, 1], true, id)
      const hanger = useStore.getState().station.modules.find((m) => m.type === 'hanger')
      assert.ok(hanger, `${id}: click commits the green preview`)
      assert.equal(moduleGhostKey(hanger), moduleGhostKey(preview))
      const [x, y] = hangerCells(hanger)[1]
      useStore.setState({ moduleType: 'clock' })
      const fitting = tool.ceilingPlacement([x, y, 0], [x, y, 1], 'preview')
      assert.equal(fitting.noCeiling, false)
      tool.placeModule([x, y, 0], [x, y, 1], true, 'clock')
      assert.ok(useStore.getState().station.modules.some((m) => m.type === 'clock'))
      useStore.getState().undo()
      assert.equal(useStore.getState().station.modules.some((m) => m.type === 'clock'), false)
      assert.ok(useStore.getState().station.modules.some((m) => m.type === 'hanger'))
    }
  } finally { useStore.setState(before) }
})
