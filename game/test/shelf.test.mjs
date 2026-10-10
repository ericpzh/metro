// Goods shelves (货架, GAME-SPEC §5.7): placeable, rotatable equipment that may
// stand inside a facility footprint. Facility rooms are footprint-only — placing
// a store builds no walls and stocks no shelves; the player fits the room out by
// hand, and legacy rooms are only marked stocked on load.
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleAt, placementBlocked } from '../src/sim/placement.ts'
import {
  addEquipment,
  createModule,
  facilityRect,
  facilityRectOf,
  facilityWallCells,
  placeFacility,
  removeFacility,
  removeModule,
  carveFacilityOpenings,
  toData,
  toState,
} from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'

/** Open floor: 10x10 slab at z = 0. */
function flatStation() {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
}

const shop = (id = 'shop-1', cfg = { kind: 'store', door: [] }) => ({ id, type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg })
const booth = (id = 'booth-1') => ({ id, type: 'booth', x: 0, y: 0, z: 0, w: 3, h: 3, cfg: { kind: 'ticket' } })
const shelf = (x, y, z, id = 'shelf-1', rot = 0) => ({ id, type: 'shelf', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })
const bench = (x, y, z, id = 'bench-1') => ({ id, type: 'bench', x, y, z, cfg: {} })
const shelvesOf = (state) => state.modules.filter((m) => m.type === 'shelf')

test('a shelf is created with the hover rotation, like any equipment', () => {
  assert.equal(createModule('shelf', 1, 2, 3, 's')?.rot, 0)
  assert.equal(createModule('shelf', 1, 2, 3, 's', 2)?.rot, 2)
  assert.equal(createModule('shelf', 1, 2, 3, 's')?.type, 'shelf')
})

test('a shelf may stand inside a walled room or booth', () => {
  assert.equal(placementBlocked([shop()], shelf(2, 2, 0)), false)
  assert.equal(placementBlocked([booth()], shelf(1, 1, 0)), false)
  // Either side of the pair may be the candidate.
  assert.equal(placementBlocked([shelf(2, 2, 0)], shop()), false)
  // But shelves still collide with each other and with other equipment.
  assert.equal(placementBlocked([shelf(2, 2, 0, 'a')], shelf(2, 2, 0, 'b')), true)
  assert.equal(placementBlocked([gate(2, 2, 0)], shelf(2, 2, 0, 'b')), true)
  // The booth's own staff bench is furniture too, so it may stand inside a booth.
  assert.equal(placementBlocked([booth()], bench(1, 1, 0)), false)
})

test('moduleAt prefers furniture over the room around it', () => {
  const s = shop()
  const f = shelf(2, 2, 0)
  assert.equal(moduleAt([s, f], 2, 2, 0)?.id, f.id)
  assert.equal(moduleAt([f, s], 2, 2, 0)?.id, f.id)
  // Away from the furniture, the room itself still answers.
  assert.equal(moduleAt([s, f], 4, 4, 0)?.id, s.id)
})

test('placing a store lays a footprint only — no walls, no auto shelves', () => {
  const before = flatStation()
  const next = placeFacility(before, 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const room = next.modules.find((m) => m.id === 'shop-1')
  assert.ok(room && room.type === 'shop', 'the room module comes first')
  assert.equal(room.cfg.kind, 'store', 'the brush fit-out was not recorded')
  assert.deepEqual(room.cfg.door, [], 'a fresh footprint should carry no door')
  assert.equal(room.cfg.stocked, true)
  assert.equal(shelvesOf(next).length, 0, 'placing a store stocked shelves')
  assert.equal(next.cells.length, before.cells.length, 'placing a store built wall cells')
  assert.ok(!next.cells.some((c) => c.z > 0), 'placing a store built walls')
  // The floor underneath is kept.
  assert.ok(next.cells.some((c) => c.x === 4 && c.y === 3 && c.z === 0), 'the floor under the footprint was removed')
})

test('each shelf deletes on its own, leaving room and neighbours', () => {
  let st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  st = addEquipment(st, createModule('shelf', 2, 2, 0, 'shelf-a', 0))
  st = addEquipment(st, createModule('shelf', 3, 2, 0, 'shelf-b', 0))
  const cut = removeModule(st, 'shelf-a')
  assert.equal(shelvesOf(cut).length, 1)
  assert.ok(cut.modules.some((m) => m.id === 'shelf-b'), 'the neighbouring shelf went too')
  assert.ok(cut.modules.some((m) => m.id === 'shop-1'), 'the room went with its shelf')
  assert.equal(cut.cells.length, st.cells.length, 'a shelf bulldoze touched the voxels')
})

test('bulldozing a room keeps hand-placed shelves and drops auto ones', () => {
  let st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const hand = createModule('shelf', 4, 3, 0, 'hand-1', 1)
  st = addEquipment(st, hand)
  // An auto-flagged unit (what the old stocking used to lay) still goes with the room.
  st = { ...st, modules: [...st.modules, { id: 'auto-1', type: 'shelf', x: 3, y: 3, z: 0, rot: 0, cfg: { auto: true } }] }
  assert.equal(shelvesOf(st).length, 2)
  const gone = removeFacility(st, 'shop-1')
  assert.deepEqual(
    shelvesOf(gone).map((m) => m.id),
    ['hand-1'],
    'auto shelves stayed or the hand shelf went',
  )
  assert.equal(gone.cells.length, 100, 'the floor was changed')
})

/** Player-built wall ring around a rect: what the block tool lays, in test form. */
function wallRingCells(r) {
  const out = []
  for (let x = r.x0; x <= r.x1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      if (!(x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1)) continue
      for (let dz = 1; dz <= 3; dz++) out.push({ x, y, z: r.z + dz, fill: 'solid' })
    }
  }
  return out
}

test('opening every player-built wall drops the room; carving nothing is a no-op', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 5, 0], 0), 'shop-1')
  // A fresh footprint has no walls, so there is nothing to open.
  assert.equal(facilityWallCells(st.cells, st.modules[0]).length, 0, 'a fresh footprint has walls')
  assert.equal(carveFacilityOpenings(st, 'shop-1', []), st, 'carving nothing changed the room')
  const walled = { ...st, cells: [...st.cells, ...wallRingCells(facilityRect([2, 2, 0], [5, 5, 0], 0))] }
  const ring = facilityWallCells(walled.cells, walled.modules[0])
  assert.ok(ring.length > 0, 'the player-built ring was not found')
  const cut = carveFacilityOpenings(walled, 'shop-1', ring)
  assert.ok(!cut.modules.some((m) => m.type === 'shop'), 'the wall-less room survived')
  assert.ok(!cut.cells.some((c) => c.z > 0), 'walls were left behind')
})

test('extending a room stocks nothing and builds no walls', () => {
  const st = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [5, 4, 0], 0), 'shop-1')
  const grown = placeFacility(st, 'store', facilityRect([4, 4, 0], [7, 6, 0], 0))
  const rooms = grown.modules.filter((m) => m.type === 'shop')
  assert.equal(rooms.length, 1, 'a second shop module was created')
  assert.equal(rooms[0].cfg.stocked, true)
  assert.equal(shelvesOf(grown).length, 0, 'extending a room stocked shelves')
  assert.equal(grown.cells.length, 100, 'extending a room built walls')
})

test('legacy rooms are marked stocked on load, with nothing materialised', () => {
  // A store drawn before shelves became modules: no units, no flags.
  const legacy = { name: 't', seed: 1, cells: flatStation().cells, modules: [shop()], lines: [] }
  const once = toState(legacy)
  const room = once.modules.find((m) => m.id === 'shop-1')
  assert.equal(room.cfg.stocked, true)
  assert.equal(shelvesOf(once).length, 0, 'shelves were materialised')
  // Reloading stays empty: everything is already stocked.
  const twice = toState(toData(once))
  assert.equal(shelvesOf(twice).length, 0, 'a reload stocked the room')
  assert.deepEqual(
    twice.modules.map((m) => m.id),
    once.modules.map((m) => m.id),
    'module ids moved across a reload',
  )
  // The dead `bare` flag buys nothing: a cleared room just comes back stocked
  // and empty, like any other legacy room.
  const cleared = toState({ ...legacy, modules: [shop('shop-1', { kind: 'store', door: [], bare: true })] })
  assert.equal(shelvesOf(cleared).length, 0, 'a cleared room was re-stocked')
  assert.equal(cleared.modules[0].cfg.stocked, true)
  // Toilets never stock shelves.
  const wc = toState({ ...legacy, modules: [{ id: 'wc', type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'toilet', door: [] } }] })
  assert.equal(shelvesOf(wc).length, 0, 'a toilet was stocked')
})

test('a stocked room and its shelves survive the save round trip', () => {
  const placed = placeFacility(flatStation(), 'store', facilityRect([2, 2, 0], [6, 5, 0], 0), 'shop-1')
  const r = parse(serialize(placed))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, placed.modules)
  assert.deepEqual(r.state.cells, placed.cells)
})


test('shelf variants keep their look through creation, save, preview and sweeping', async () => {
  const { SHELF_VARIANTS, shelfVariant } = await import('../src/sim/shelves.ts')
  const { moduleGhostKey } = await import('../src/render/moduleGhostKey.ts')
  const { sweepFamily } = await import('../src/app/sweep.ts')
  const { familyOptions, isDecorType, familyFor } = await import('../src/app/store/catalog.ts')
  assert.deepEqual(familyOptions(familyFor('shelf')).map(o => o.id), SHELF_VARIANTS.map(v => `shelf-${v}`))
  const pieces = SHELF_VARIANTS.map(v => createModule(`shelf-${v}`, 2, 2, 0, v, 3))
  for (const [i, m] of pieces.entries()) {
    assert.equal(m.cfg.variant, SHELF_VARIANTS[i])
    assert.equal(m.rot, 3)
    assert.equal(isDecorType(`shelf-${m.cfg.variant}`), true)
  }
  assert.equal(new Set(pieces.map(moduleGhostKey)).size, SHELF_VARIANTS.length, 'changing variants refreshes a stationary ghost')
  assert.equal(new Set(pieces.map(sweepFamily)).size, SHELF_VARIANTS.length, 'a sweep leaves other shelf styles behind')
  assert.equal(shelfVariant(undefined), 'dark-tall')
  assert.equal(shelfVariant('unknown'), 'dark-tall')
  const state = { ...flatStation(), modules: pieces }
  assert.deepEqual(parse(serialize(state)).state.modules, pieces)
})

test('every shelf draws inside its tile and agrees with its clearance height', async () => {
  const THREE = await import('three')
  const { ShelfModel } = await import('../src/render/models/pieces/ShelfModel.ts')
  const { SHELF_VARIANTS, shelfSpec } = await import('../src/sim/shelves.ts')
  const { moduleEnvelope, equipmentReason } = await import('../src/sim/placement.ts')
  const mat = new THREE.MeshStandardMaterial()
  const mats = new Proxy({}, { get: () => mat })
  const model = new ShelfModel({ mats })
  for (const v of SHELF_VARIANTS) for (let rot = 0; rot < 4; rot++) {
    const m = createModule(`shelf-${v}`, 2, 2, 0, v, rot)
    const group = model.build(m)
    const box = new THREE.Box3().setFromObject(group)
    assert.ok(box.min.x >= 2 - 1e-6 && box.max.x <= 3 + 1e-6, `${v}: x outside its reserved tile`)
    assert.ok(box.min.y >= 2 - 1e-6 && box.max.y <= 3 + 1e-6, `${v}: y outside its reserved tile`)
    assert.ok(Math.abs(box.max.z - 1 - shelfSpec(v).height) < 1e-6, `${v}: drawn height matches clearance`)
    assert.equal(moduleEnvelope(m).z1, 1 + shelfSpec(v).height)
    const stock = group.children.filter(c => c.name.startsWith('stock-'))
    assert.ok(stock.length >= 3)
    const goods = group.getObjectByName('stock-bottles').count + (group.getObjectByName('stock-packages')?.count ?? 0)
    assert.equal(goods, shelfSpec(v).levels.length * 16, 'each deck stocks two rows of eight products')
    for (const child of group.children) {
      child.geometry?.dispose()
      if (child.isInstancedMesh) child.dispose()
    }
  }
  const cooler = createModule('shelf-cooler', 2, 2, 0, 'short')
  const tall = createModule('shelf-dark-tall', 2, 2, 0, 'tall')
  const ceiling = { x: 2, y: 2, z: 3, fill: 'solid' }
  // A 2 m ceiling clears the gondola but blocks the taller cooler.
  assert.equal(equipmentReason([ceiling], [], tall), '')
  assert.ok(equipmentReason([ceiling], [], cooler))
  mat.dispose()
})


test('cooler shell joints and trim never duplicate the lid or plinth surfaces', async () => {
  const THREE = await import('three')
  const { ShelfModel } = await import('../src/render/models/pieces/ShelfModel.ts')
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c434c })
  const mats = new Proxy({ white, darkSteel: dark }, { get: (m, key) => m[key] ?? white })
  const model = new ShelfModel({ mats })
  for (const variant of ['cooler', 'cooler-dark']) {
    const group = model.build(createModule(`shelf-${variant}`, 0, 0, 0, variant))
    const mesh = name => group.getObjectByName(name)
    const bounds = name => new THREE.Box3().setFromObject(mesh(name))
    const lid = bounds('cooler-top'), base = bounds('shelf-base')
    assert.equal(mesh('cooler-top').material, variant === 'cooler' ? white : dark)
    for (const name of ['cooler-side-left', 'cooler-side-right', 'shelf-back', 'shelf-header']) {
      const box = bounds(name)
      assert.ok(box.max.z <= lid.min.z + 1e-6, `${variant}: ${name} stays below the lid's exposed top`)
      assert.ok(box.min.z >= base.max.z - 1e-6, `${variant}: ${name} stays above the plinth`)
    }
    assert.ok(bounds('shelf-base-trim').min.y < base.min.y - 0.005, 'black trim stands proud of the plinth face')
    assert.ok(bounds('shelf-deck-0').min.z > base.max.z, 'lowest deck clears the plinth top')
    for (const child of group.children) {
      child.geometry?.dispose()
      if (child.isInstancedMesh) child.dispose()
    }
  }
  white.dispose()
  dark.dispose()
})


test('tall and short gondolas keep their toe strip in front of the plinth', async () => {
  const THREE = await import('three')
  const { ShelfModel } = await import('../src/render/models/pieces/ShelfModel.ts')
  const mat = new THREE.MeshStandardMaterial()
  const model = new ShelfModel({ mats: new Proxy({}, { get: () => mat }) })
  for (const variant of ['dark-tall', 'white-tall', 'white-short']) {
    const group = model.build(createModule(`shelf-${variant}`, 0, 0, 0, variant))
    const bounds = name => new THREE.Box3().setFromObject(group.getObjectByName(name))
    const base = bounds('shelf-base'), trim = bounds('shelf-base-trim')
    assert.ok(base.min.y - trim.min.y >= 0.011, `${variant}: toe strip must stand at least 11 mm proud, never flush`)
    for (const name of ['shelf-back', 'shelf-post-left', 'shelf-post-right']) {
      assert.ok(bounds(name).min.z >= base.max.z - 1e-6, `${variant}: frame must start above the plinth`)
    }
    for (const child of group.children) {
      child.geometry?.dispose()
      if (child.isInstancedMesh) child.dispose()
    }
  }
  mat.dispose()
})
