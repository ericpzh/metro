// Shop and control-room furniture, GAME-SPEC §5.7: the visible displays and
// chair must fit the cells that placement reserves, in all four orientations.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { equipmentReason, moduleAt, moduleEnvelope, isMovableModule, placementBlocked } from '../src/sim/placement.ts'
import { buildModule } from '../src/render/models.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { sameSweepFamily } from '../src/app/sweep.ts'
import { MODULE_OPTIONS, isDecorType, moduleLabel } from '../src/app/store/catalog.ts'

const build = (mod) => {
  const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) }) })
  const group = buildModule(mod, { mats, data: { modules: [] }, finish: () => mats.white })
  group.updateMatrixWorld(true)
  return group
}

test('收银台 can be placed inside a shop, moved, swept and saved with its rotation', () => {
  const counter = createModule('checkout', 2, 2, 0, 'counter', 3)
  assert.equal(counter.type, 'checkout')
  assert.equal(counter.rot, 3)
  assert.equal(MODULE_OPTIONS.find((m) => m.id === 'checkout').label, '收银台')
  assert.equal(isDecorType('checkout'), true)
  assert.equal(moduleLabel(counter), '收银台')
  assert.equal(isMovableModule(counter), true)
  const shop = { id: 'shop', type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'store', stocked: true } }
  assert.equal(placementBlocked([shop], counter), false)
  assert.equal(moduleAt([shop, counter], 2, 2, 0).id, 'counter')
  assert.equal(placementBlocked([counter], createModule('shelf', 2, 2, 0, 'shelf')), true)
  assert.equal(placementBlocked([counter], createModule('shelf', 3, 2, 0, 'shelf')), false)
  assert.equal(sameSweepFamily(counter, createModule('checkout', 3, 2, 0, 'next', 0)), true)
  assert.equal(sameSweepFamily(counter, createModule('desk', 3, 2, 0, 'desk')), false)
  const state = toState({ name: 'test', seed: 1, cells: [], modules: [shop, counter], lines: [] })
  const restored = parse(serialize(state))
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.state.modules, state.modules)
})

test('both models fit their rotated reservations and refuse a low solid ceiling', () => {
  for (const id of ['desk', 'checkout']) for (let rot = 0; rot < 4; rot++) {
    const mod = createModule(id, 2, 3, 0, id, rot)
    const box = new THREE.Box3().setFromObject(build(mod)), env = moduleEnvelope(mod)
    assert.ok(box.min.x >= env.x0 - 1e-6 && box.max.x <= env.x1 + 1e-6, `${id} stays in its x cell`)
    assert.ok(box.min.y >= env.y0 - 1e-6 && box.max.y <= env.y1 + 1e-6, `${id} stays in its y cell`)
    assert.ok(box.min.z >= env.z0 - 1e-6 && box.max.z <= env.z1 + 1e-6, `${id} reserves its screens`)
    assert.equal(equipmentReason([], [], mod), '', 'can stand on street ground')
    assert.equal(equipmentReason([{ x: 2, y: 3, z: 2, fill: 'solid' }], [], mod), 'occupied', 'screen cannot pass through a ceiling')
  }
})

test('the checkout stock and payment equipment are visible outside their cabinet', () => {
  const g = build(createModule('checkout', 0, 0, 0, 'c'))
  const stock = g.getObjectByName('checkout-stock')
  assert.equal(stock.count, 16, 'four packages on each of four decks')
  const stockBox = new THREE.Box3().setFromObject(stock)
  const cabinetBox = new THREE.Box3().setFromObject(g.getObjectByName('checkout-cabinet'))
  assert.ok(stockBox.max.y < cabinetBox.min.y, 'the cabinet does not bury the goods')
  for (const name of ['pos-screen', 'receipt-printer', 'barcode-scanner', 'payment-reader']) assert.ok(g.getObjectByName(name), name)
  const screen = new THREE.Box3().setFromObject(g.getObjectByName('pos-screen'))
  assert.ok(screen.min.z > cabinetBox.max.z, 'POS is above the cabinet')
  assert.equal(g.getObjectByName('pos-screen').material.name, 'desktopScreen')
  assert.equal(g.getObjectByName('customer-display').material.name, 'desktopScreen')
})

test('the workstation has two exposed monitor faces and an open mesh chair', () => {
  const g = build(createModule('desk', 0, 0, 0, 'd'))
  const screens = [], casters = [], ribs = []
  g.traverse((o) => {
    if (o.name === 'monitor-screen') screens.push(o)
    if (o.name === 'chair-caster') casters.push(o)
    if (o.name === 'chair-mesh') ribs.push(o)
  })
  assert.equal(screens.length, 2)
  assert.equal(casters.length, 5)
  assert.equal(ribs.length, 10)
  for (const screen of screens) {
    assert.equal(screen.material.name, 'desktopScreen', 'computer has a desktop instead of ticketing UI')
    const ray = new THREE.Raycaster()
    const target = screen.getWorldPosition(new THREE.Vector3())
    ray.set(target.clone().add(new THREE.Vector3(0, -0.3, 0)), new THREE.Vector3(0, 1, 0))
    assert.equal(ray.intersectObject(g, true)[0].object, screen, 'bezel does not hide the illuminated face')
  }
  for (const name of ['desktop', 'keyboard', 'mouse', 'paperwork', 'chair-seat']) assert.ok(g.getObjectByName(name), name)
})
