import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model.ts'
import { buildModule } from '../src/render/models.ts'
import { equipmentReason, moduleEnvelope, moduleFootprint, wallSide, isCeilingHung, isWallMounted, isMovableModule } from '../src/sim/placement.ts'
import { isDecorType, isWallMountedType, familyFor, familyOptions, folderTiles } from '../src/app/store/catalog.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { sweepFamily } from '../src/app/sweep.ts'
import { parse, serialize } from '../src/persistence/save.ts'

function context(cells = []) {
  const mats = new Proxy({}, { get: (target, key) => target[key] ??= new THREE.MeshStandardMaterial({ name: String(key) }) })
  const concrete = new THREE.MeshStandardMaterial({ name: 'floor.concrete' })
  return { mats, data: { name: 'Test', seed: 1, cells, modules: [], lines: [] }, owned: [], finish: id => id === 'floor.concrete' ? concrete : mats.white }
}

test('monitor wall backing spans three cells and every crossed wall course in all rotations', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('monitor-wall', 0, 0, 0, 'wall', rot)
    const cells = moduleFootprint(m)
    assert.equal(cells.length, 3)
    const [dx, dy] = wallSide(rot)
    const backing = cells.flatMap(([x, y]) => [1, 2, 3].map(z => ({ x: x + dx, y: y + dy, z, fill: 'solid' })))
    assert.equal(equipmentReason(backing, [], m), '', 'wall mount needs no floor in front')
    for (let i = 0; i < backing.length; i++) {
      assert.equal(equipmentReason(backing.filter((_, j) => j !== i), [], m), 'wall', 'every panel course needs backing')
    }
    assert.equal(isWallMounted(m), true)
    assert.equal(isCeilingHung(m), false)
    const model = buildModule(m, context(backing))
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    assert.ok(Math.abs((rot % 2 ? size.y : size.x) - 3) < 1e-6, 'housing is exactly 3 m wide')
    assert.ok(Math.abs(size.z - 2) < 1e-6, 'housing is exactly 2 m tall')
    const screens = model.children.filter(child => child.name.startsWith('monitor-view-'))
    assert.equal(screens.length, 12, 'wall monitor has twelve screens in a 3×4 grid')
    const centres = screens.map(screen => {
      const pane = screen.children[0]
      const centre = pane.getWorldPosition(new THREE.Vector3())
      const outward = new THREE.Vector3(-dx, -dy, 0)
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(pane.matrixWorld)
      assert.ok(normal.dot(outward) > 0.99, 'screen faces away from its wall in every rotation')
      const ray = new THREE.Raycaster(centre.clone().add(outward), outward.clone().negate())
      const first = ray.intersectObject(model, true)[0]?.object
      assert.ok(screen.children.includes(first), 'visible screen ink is in front of the housing')
      assert.ok(Math.abs(pane.geometry.parameters.width - 1) < 1e-6, 'each screen is 1 m wide')
      assert.ok(Math.abs(pane.geometry.parameters.height - 0.5) < 1e-6, 'each screen is 0.5 m high')
      return centre
    })
    assert.equal(new Set(centres.map(c => c.z.toFixed(3))).size, 4, 'four rows')
    assert.equal(new Set(centres.map(c => (rot % 2 ? c.y : c.x).toFixed(3))).size, 3, 'three columns')
  }
})

test('small hanging monitor fits one tile and suspension reaches a taller slab', () => {
  const m = createModule('monitor-ceiling', 0, 0, 0, 'hung')
  assert.equal(isCeilingHung(m), true)
  assert.equal(isCeilingHung({ type: 'monitor-ceiling' }), true)
  assert.equal(isCeilingHung({ type: 'monitor-wall' }), false)
  assert.equal(equipmentReason([], [], m), 'ceiling')
  const cells = [{ x: 0, y: 0, z: 6, fill: 'solid' }]
  assert.equal(equipmentReason(cells, [], m), '')
  const box = new THREE.Box3().setFromObject(buildModule(m, context(cells)))
  assert.ok(box.min.x >= 0 && box.max.x <= 1 && box.min.y >= 0 && box.max.y <= 1)
  assert.ok(Math.abs(box.max.z - 6) < 1e-6, 'rods touch the actual ceiling underside')
})

test('rail signal has three unobstructed vertically aligned lamps with red below', () => {
  const mod = createModule('rail-signal', 0, 0, 0, 'signal')
  const ctx = context()
  const model = buildModule(mod, ctx)
  assert.equal(model.getObjectByName('signal-concrete-base').material, ctx.finish('floor.concrete'))
  assert.equal(model.getObjectByName('signal-concrete-post').material, ctx.finish('floor.concrete'))
  const box = new THREE.Box3().setFromObject(model)
  assert.ok(Math.abs(box.max.z - box.min.z - 1) < 1e-6, 'complete signal is exactly 1 m tall')
  const envelope = moduleEnvelope(mod)
  assert.equal(envelope.z1 - envelope.z0, 1, 'placement reserves the scaled height')
  assert.ok(Math.abs(box.max.x - box.min.x - (envelope.x1 - envelope.x0)) < 1e-6, 'placement uses the scaled footprint')
  const lamps = [0, 1, 2].map(i => model.getObjectByName(`signal-lamp-${i}`))
  lamps.forEach((lamp, i) => {
    assert.ok(lamp)
    assert.equal(lamp.position.x, 0)
    assert.ok(Math.abs(lamp.position.z - (1.2 + i * 0.55)) < 1e-6)
    // A ray through the lens must reach the lit surface before its backing/hood.
    model.updateMatrixWorld(true)
    const at = lamp.getWorldPosition(new THREE.Vector3())
    const ray = new THREE.Raycaster(at.clone().add(new THREE.Vector3(0, -1, 0)), new THREE.Vector3(0, 1, 0))
    assert.equal(ray.intersectObject(model, true)[0]?.object, lamp)
  })
  assert.equal(lamps[0].material, ctx.mats.ledRed)
  assert.notEqual(lamps[1].material, ctx.mats.ledRed)
  assert.equal(equipmentReason([], [], mod), '', 'signal stands beside the rails on solid ground')
  assert.equal(equipmentReason([{ x: 0, y: 0, z: 1, fill: 'solid' }], [], mod), 'occupied', 'signal cannot be placed inside a solid block')
  assert.equal(equipmentReason([{ x: 0, y: 0, z: 2, fill: 'solid' }], [], mod), '', 'blocks above the one-metre signal are clear')
})

test('new decor appears in the palette and preserves variants through save, preview and sweep', () => {
  const ids = ['monitor-ceiling', 'monitor-wall', 'rail-signal']
  const modules = ids.map(id => createModule(id, 2, 2, 0, id, 2))
  const state = { name: 'Test', seed: 1, cells: [], modules, lines: [] }
  const loaded = parse(serialize(state))
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.state.modules, modules)
  assert.equal(familyOptions(familyFor('monitor')).length, 2)
  const tiles = folderTiles('decor')
  assert.ok(tiles.some(t => t.kind === 'family' && t.family.key === 'monitor'))
  assert.ok(tiles.some(t => t.kind === 'option' && t.option.id === 'rail-signal'))
  ids.forEach(id => assert.equal(isDecorType(id), true))
  assert.equal(isWallMountedType('monitor-wall'), true)
  assert.equal(isWallMountedType('monitor-ceiling'), false)
  modules.forEach(m => assert.equal(isMovableModule(m), true))
  assert.notEqual(sweepFamily(modules[0]), sweepFamily(modules[1]))
  const swapped = { ...modules[0], w: 3, cfg: { mount: 'wall' } }
  assert.notEqual(moduleGhostKey(modules[0]), moduleGhostKey(swapped))
})
