import { COUNTER_VARIANTS, COUNTER_LENGTHS, counterCells, counterPaletteId, counterSpec } from '../src/sim/counters.ts'
import { sweepFamily } from '../src/app/sweep.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { moveEquipment } from '../src/build/model.ts'
// Shop and control-room furniture, GAME-SPEC §5.7: the visible displays and
// chair must fit the cells that placement reserves, in all four orientations.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { equipmentReason, moduleAt, moduleFootprint, moduleEnvelope, isMovableModule, placementBlocked } from '../src/sim/placement.ts'
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


test('store and café counters preserve distinct styles through ghosts, move, save and sweeping', () => {
  const pieces = COUNTER_VARIANTS.flatMap(v => COUNTER_LENGTHS.map(w => createModule(counterPaletteId(v), 2, 2, 0, `${v}-${w}`, 3, w)))
  assert.equal(new Set(pieces.map(moduleGhostKey)).size, 16)
  assert.equal(new Set(pieces.map(sweepFamily)).size, 16)
  for (const mod of pieces) {
    assert.equal(isDecorType(counterPaletteId(mod.cfg.variant)), true)
    assert.equal(moduleLabel(mod), counterSpec(mod.cfg.variant).label)
    const state = toState({ name: 'test', seed: 1, cells: [], modules: [mod], lines: [] })
    const moved = moveEquipment(state, { ...mod, x: 4, y: 5, rot: 1 })
    assert.equal(moved.modules[0].x, 4)
    assert.equal(moved.modules[0].rot, 1)
    assert.deepEqual(moved.modules[0].cfg, mod.cfg)
    assert.equal(moved.modules[0].w, mod.w)
    const restored = parse(serialize(moved))
    assert.equal(restored.ok, true)
    assert.deepEqual(restored.state.modules, moved.modules)
  }
})

test('every counter reserves its complete screens or display case at every rotation', () => {
  for (const variant of COUNTER_VARIANTS) for (const length of COUNTER_LENGTHS) for (let rot = 0; rot < 4; rot++) {
    const mod = createModule(counterPaletteId(variant), 2, 3, -5, variant, rot, length)
    const root = build(mod), box = new THREE.Box3().setFromObject(root), env = moduleEnvelope(mod)
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(box.min[axis] >= env[axis + '0'] - 1e-6, `${variant}/${rot}: minimum ${axis}`)
      assert.ok(box.max[axis] <= env[axis + '1'] + 1e-6, `${variant}/${rot}: maximum ${axis}`)
    }
    assert.equal(env.z1, -4 + counterSpec(variant).height)
    assert.equal(Math.max(box.max.x - box.min.x, box.max.y - box.min.y).toFixed(2), (length - (variant === 'checkout' ? .02 : .01)).toFixed(2), 'continuous worktop follows the full length')
    assert.equal(equipmentReason([{ x: 2, y: 3, z: -3, fill: 'solid' }], [], mod), 'occupied')
    const floor = counterCells(mod).map(([x, y, z]) => ({ x, y, z, fill: 'solid' }))
    assert.equal(moduleFootprint(mod).length, length)
    assert.equal(equipmentReason([...floor, { x: 2, y: 3, z: -2, fill: 'solid' }], [], mod), '')
    if (length > 1) assert.equal(equipmentReason(floor.slice(0, -1), [], mod), 'floor', 'the last bay needs floor too')
    const [lastX, lastY] = counterCells(mod).at(-1)
    assert.equal(moduleAt([mod], lastX, lastY, -5)?.id, mod.id)
    assert.equal(placementBlocked([mod], createModule('shelf', lastX, lastY, -5, 'blocker')), true)
  }
})

test('café bays expose their espresso machine and stock inside a hollow pastry case', () => {
  const coffee = build(createModule('checkout-cafe', 0, 0, 0, 'coffee'))
  const top = new THREE.Box3().setFromObject(coffee.getObjectByName('counter-worktop'))
  for (const name of ['espresso-machine', 'espresso-brew-group', 'counter-cups']) {
    assert.ok(new THREE.Box3().setFromObject(coffee.getObjectByName(name)).min.z >= top.max.z)
  }
  const pastry = build(createModule('checkout-cafe-pastry', 0, 0, 0, 'pastry'))
  const stock = pastry.getObjectByName('counter-pastries')
  assert.equal(stock.count, 12)
  const stockBounds = new THREE.Box3().setFromObject(stock)
  const glass = new THREE.Box3().setFromObject(pastry.getObjectByName('pastry-case-glass-front'))
  const lid = new THREE.Box3().setFromObject(pastry.getObjectByName('pastry-case-glass-top'))
  assert.equal(pastry.getObjectByName('pastry-case-glass-front').material.name, 'glass')
  assert.ok(stockBounds.min.y > glass.max.y, 'pastries are behind the glass')
  assert.ok(stockBounds.max.z < lid.min.z, 'lid clears the merchandise')
})


test('espresso rear panel ends between the drip tray and upper housing without duplicate side faces', () => {
  for (const length of COUNTER_LENGTHS) for (const rot of [0, 1, 2, 3]) {
    const root = build(createModule('checkout-cafe', 0, 0, 0, 'coffee', rot, length))
    const box = name => new THREE.Box3().setFromObject(root.getObjectByName(name))
    const back = box('espresso-back'), head = box('espresso-machine'), tray = box('espresso-drip-tray')
    assert.ok(Math.abs(back.max.z - head.min.z) < 1e-6, 'back stops at the silver housing')
    assert.ok(Math.abs(back.min.z - tray.max.z) < 1e-6, 'back starts at the drip tray')
  }
})
