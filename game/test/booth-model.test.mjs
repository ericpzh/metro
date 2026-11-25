// Reference service counters: envelope, accessible notch, smart monitor seating,
// glazing, service apertures, and 3 m ceiling-hung information canopy.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { BOOTH_HEADER_MAX_HANG, BOOTH_HEADER_TOP, boothHeaderHang } from '../src/sim/booths.ts'
import { equipmentReason, moduleEnvelope } from '../src/sim/placement.ts'
import { buildModule } from '../src/render/models.ts'
import { cellEditInvalidatedModules, moduleEditDelta, retainedModuleIds } from '../src/render/moduleDependencies.ts'
const EPS = 1e-6
const near = (a, b) => Math.abs(a - b) < EPS
const booth = (kind, w = 4, h = 3, x = 0, y = 0, z = 0, front = 0) => ({id:'booth',type:'booth',x,y,z,w,h,cfg:{kind,front}})
function ceilingSlab(mod, ceilingZ) {
  const cells = []
  for (let x = mod.x; x < mod.x + mod.w; x++) {
    for (let y = mod.y; y < mod.y + mod.h; y++) {
      cells.push({ x, y, z: ceilingZ, fill: 'solid' })
    }
  }
  return cells
}
function build(mod, extra = {}) {
  const mats = new Proxy({}, {get:(t,k)=>(t[k]??=new THREE.MeshStandardMaterial({name:String(k)}))})
  const owned = []
  const data = { name: 't', cells: extra.cells ?? [], modules: extra.modules ?? [], lines: [] }
  const group = buildModule(mod, { mats, data, trackCells: new Set(), finish: () => mats.steel, owned })
  group.updateMatrixWorld(true)
  const boxes = []
  group.traverse(o => { if (o.isMesh) boxes.push({ mesh: o, mat: o.material, box: new THREE.Box3().setFromObject(o) }) })
  return { mats, group, boxes, owned }
}
const covers = (boxes, x, y, z) => boxes.some(({ box: b }) => x >= b.min.x - EPS && x <= b.max.x + EPS && y >= b.min.y - EPS && y <= b.max.y + EPS && z >= b.min.z - EPS && z <= b.max.z + EPS)

test('both counters and their overhead frames stay within the reserved cells and height', () => {
  for (const kind of ['ticket', 'info']) for (const [w, h] of [[3, 3], [4, 4], [5, 3], [3, 6], [6, 4]]) {
    const mod = booth(kind, w, h, -5, 7, -4)
    const { boxes } = build(mod)
    const e = moduleEnvelope(mod)
    const union = new THREE.Box3()
    for (const { mesh, box: b, mat } of boxes) {
      assert.ok(b.min.x >= e.x0 - EPS && b.max.x <= e.x1 + EPS, `${kind} ${mat.name} x`)
      assert.ok(b.min.y >= e.y0 - EPS && b.max.y <= e.y1 + EPS, `${kind} ${mat.name} y`)
      assert.ok(b.min.z >= e.z0 - EPS, `${kind} ${mat.name} min z`)
      const isSuspension = mesh.name === 'booth-suspension-rod' || mesh.name === 'booth-suspension-plate'
      assert.ok(b.max.z <= (isSuspension ? e.z1 + BOOTH_HEADER_MAX_HANG : e.z1) + EPS, `${kind} ${mat.name} max z`)
      union.union(b)
    }
    assert.ok(near(union.min.x, e.x0) && near(union.max.x, e.x1))
    assert.ok(near(union.min.y, e.y0) && near(union.max.y, e.y1))
  }
})

test('information counter has a lowered central surface with open space above it', () => {
  const mod = booth('info')
  const { group, mats, boxes } = build(mod, { cells: ceilingSlab(mod, 5) })
  assert.equal(boxes.filter(b => b.mat === mats.glass).length, 0)
  const ray = new THREE.Raycaster(new THREE.Vector3(2, 0.25, 3), new THREE.Vector3(0, 0, -1))
  const hit = ray.intersectObjects(group.children, true)[0]
  assert.ok(hit)
  assert.ok(near(hit.point.z, 1.8), 'accessible counter is 0.80 m above the floor')
  const shoulder = new THREE.Raycaster(new THREE.Vector3(0.8, 0.25, 3), new THREE.Vector3(0, 0, -1)).intersectObjects(group.children, true)[0]
  assert.ok(near(shoulder.point.z, 2.1), 'shoulder remains 1.10 m above floor')
})

test('ticket glass encloses the sides and leaves a real transfer aperture at each service bay', () => {
  const { boxes, mats } = build(booth('ticket'))
  const screens = boxes.filter(b => b.mat === mats.glass)
  assert.ok(covers(screens, 0.04, 1.5, 2.5), 'west pane')
  assert.ok(covers(screens, 3.96, 1.5, 2.5), 'east pane')
  assert.ok(covers(screens, 2, 2.96, 2.5), 'back pane')
  for (const x of [1.04, 2.96]) {
    assert.ok(covers(screens, x, 0.04, 2.5), 'front service glazing')
    assert.ok(!covers(boxes, x, 0.04, 2.12), 'clear gap above the countertop')
  }
})

test('both overhead frames leave the staff bay open with no built-in banner', () => {
  for (const kind of ['info', 'ticket']) {
    const mod = booth(kind)
    const { boxes, owned } = build(mod, { cells: ceilingSlab(mod, 5) })
    assert.ok(!covers(boxes, 2, 1.5, 3.25), 'no solid roof across staff bay')
    const signs = boxes.filter(b => b.mat.name === 'booth-service-sign')
    assert.equal(signs.length, 0, 'the player supplies an editable sign')
    assert.equal(owned.length, 0, 'no hard-coded banner texture is allocated')
  }
})

test('an editable customer-service sign can hang inside either booth type', () => {
  for (const kind of ['info', 'ticket']) {
    const mod = booth(kind)
    const sign = {
      id: 'service-sign', type: 'sign', x: 1, y: 1, z: 0, rot: 0,
      cfg: { mount: 'ceiling', front: [{ id: 'service', kind: 'icon', icon: 'customer-service', x: 0.3, y: 0.2, scale: 1, side: 'both' }], back: [] },
    }
    assert.equal(equipmentReason([{ x: 1, y: 1, z: 4, fill: 'solid' }], [mod], sign), '', kind)
  }
})

test('counter geometry follows translated room coordinates', () => {
  for (const kind of ['info', 'ticket']) {
    const aMod = booth(kind)
    const bMod = booth(kind, 4, 3, 11, -8, -5)
    const a = build(aMod, { cells: ceilingSlab(aMod, 5) }).boxes
    const b = build(bMod, { cells: ceilingSlab(bMod, 0) }).boxes
    assert.equal(a.length, b.length)
    for (let i = 0; i < a.length; i++) for (const axis of ['min', 'max']) {
      const expected = a[i].box[axis].clone().add(new THREE.Vector3(11, -8, -5))
      assert.ok(expected.distanceTo(b[i].box[axis]) < EPS)
    }
  }
})

test('counter desktops face the selected front and stay inside a rectangular footprint', () => {
  const w = 5, h = 4, x = -3, y = 7, z = -2
  for (const kind of ['ticket', 'info']) for (const front of [0, 1, 2, 3]) {
    const mod = booth(kind, w, h, x, y, z, front)
    const { boxes, mats } = build(mod)
    const desktop = boxes.filter(({ mat }) => mat === mats.black)
    assert.ok(desktop.length > 0, `${kind} keeps its desktop screens`)
    const point = desktop.reduce((sum, { box }) => sum.add(box.getCenter(new THREE.Vector3())), new THREE.Vector3()).multiplyScalar(1 / desktop.length)
    const edgeDistance = front === 0 ? Math.abs(point.y - y) : front === 1 ? Math.abs(point.x - (x + w)) : front === 2 ? Math.abs(point.y - (y + h)) : Math.abs(point.x - x)
    assert.ok(edgeDistance < 0.6, `${kind} desktop faces front ${front} (distance ${edgeDistance})`)
    const bounds = new THREE.Box3()
    for (const { box } of boxes) bounds.union(box)
    assert.ok(bounds.min.x >= x - EPS && bounds.max.x <= x + w + EPS, `${kind} front ${front} fits x`)
    assert.ok(bounds.min.y >= y - EPS && bounds.max.y <= y + h + EPS, `${kind} front ${front} fits y`)
  }
})

test('every monitor base sits flush on solid flat counter surface across all booth sizes', () => {
  for (const kind of ['info', 'ticket']) {
    for (const [w, h] of [[1, 1], [2, 2], [2, 3], [3, 2], [3, 3], [4, 3], [5, 4], [6, 3]]) {
      const mod = booth(kind, w, h, 0, 0, 0, 0)
      const { group, mats, boxes } = build(mod)
      const counterZ = 1 + (kind === 'info' ? 1.02 : 0.96) + 0.08
      const bases = boxes.filter(({ mat, box }) => mat === mats.black && near(box.max.z - box.min.z, 0.035))
      assert.ok(bases.length > 0, `${kind} ${w}x${h} places a monitor`)
      const counterMeshes = boxes
        .filter(({ mat }) => mat === (kind === 'info' ? mats.white : mats.steel))
        .map(({ mesh }) => mesh)
      for (const { box } of bases) {
        assert.ok(near(box.min.z, counterZ), `${kind} ${w}x${h} monitor base rests flush on countertop (min.z=${box.min.z}, counterZ=${counterZ})`)
        for (const cx of [box.min.x + 0.005, box.max.x - 0.005]) {
          for (const cy of [box.min.y + 0.005, box.max.y - 0.005]) {
            const ray = new THREE.Raycaster(new THREE.Vector3(cx, cy, counterZ + 0.5), new THREE.Vector3(0, 0, -1))
            const hit = ray.intersectObjects(counterMeshes, false)[0]
            assert.ok(hit, `${kind} ${w}x${h} base corner (${cx.toFixed(3)}, ${cy.toFixed(3)}) must sit over solid counter`)
            assert.ok(near(hit.point.z, counterZ),
              `${kind} ${w}x${h} base corner (${cx.toFixed(3)}, ${cy.toFixed(3)}) must sit on flat top ${counterZ}, got ${hit.point.z}`)
          }
        }
      }
      // Ticket monitors never overlap each other even on narrow widths.
      for (let i = 0; i < bases.length; i++) {
        for (let j = i + 1; j < bases.length; j++) {
          assert.ok(bases[j].box.min.x > bases[i].box.max.x + 0.05 || bases[i].box.min.x > bases[j].box.max.x + 0.05,
            `${kind} ${w}x${h} monitors must not overlap`)
        }
      }
    }
  }
})

test('information overhead top bar hangs from ceiling within 3 m and is omitted otherwise', () => {
  const mod = booth('info', 3, 3, 0, 0, 0, 0)
  // 1. Outdoors (no ceiling) -> no top bar, no rods.
  const open = build(mod)
  assert.equal(open.boxes.filter(({ box }) => box.min.z > 2.5).length, 0, 'open sky info booth omits overhead top bar')

  // 2. Ceiling too high (> 3 m above top bar: bar top = 3.4, ceiling at z = 7 -> 3.6 m drop) -> omitted.
  const tooHigh = build(mod, { cells: ceilingSlab(mod, 7) })
  assert.equal(tooHigh.boxes.filter(({ box }) => box.min.z > 2.5).length, 0, 'ceiling > 3 m above top bar omits top bar')

  // 3. Ceiling within 3 m (z = 5 -> 1.6 m drop) -> top bar + 4 suspension rods + 4 ceiling plates up to z = 5.
  const indoor = build(mod, { cells: ceilingSlab(mod, 5) })
  const rods = indoor.boxes.filter(({ mesh }) => mesh.name === 'booth-suspension-rod')
  const plates = indoor.boxes.filter(({ mesh }) => mesh.name === 'booth-suspension-plate')
  assert.equal(rods.length, 4, 'four corner suspension rods')
  assert.equal(plates.length, 4, 'four corner ceiling plates')
  for (const { box } of rods) assert.ok(near(box.min.z, 1 + BOOTH_HEADER_TOP), 'rod starts at header top')
  for (const { box } of plates) assert.ok(near(box.max.z, 5), 'ceiling plate meets slab underside at z = 5')

  // 4. Partial ceiling (one corner missing) -> omitted so no rod hangs in air.
  const partialCells = ceilingSlab(mod, 5).filter(c => !(c.x === 0 && c.y === 0))
  const partial = build(mod, { cells: partialCells })
  assert.equal(partial.boxes.filter(({ box }) => box.min.z > 2.5).length, 0, 'partial ceiling omits top bar')

  // 5. Underground concourse (z = -5) hangs from virtual street plane at z = 0 (1.6 m drop).
  const underground = build(booth('info', 3, 3, 0, 0, -5, 0))
  assert.equal(underground.boxes.filter(({ mesh }) => mesh.name === 'booth-suspension-rod').length, 4)
  for (const { box } of underground.boxes.filter(({ mesh }) => mesh.name === 'booth-suspension-plate')) {
    assert.ok(near(box.max.z, 0), 'underground info canopy hangs from street plane z = 0')
  }

  // 6. Ground-level canopy roof (z = 0, variant = canopy) hangs within 3 m.
  const canopy = { id: 'canopy-1', type: 'roof', x: 0, y: 0, z: 0, w: 4, d: 4, rot: 0, cfg: { variant: 'canopy' } }
  const sheltered = build(mod, { modules: [canopy] })
  assert.equal(sheltered.boxes.filter(({ mesh }) => mesh.name === 'booth-suspension-rod').length, 4, 'canopy roof supports info top bar')
  assert.ok(boothHeaderHang([], [canopy], mod) !== null)
})

test('information header trim and fascia never overlap in volume', () => {
  const mod = booth('info')
  const { boxes, mats } = build(mod, { cells: ceilingSlab(mod, 5) })
  const header = boxes.filter(({ mesh, box, mat }) =>
    box.min.z > 3
    && mesh.name !== 'booth-suspension-rod'
    && mesh.name !== 'booth-suspension-plate'
    && [mats.white, mats.darkSteel, mats.gateRed, mats.headlight].includes(mat))
  assert.ok(header.length > 0, 'indoor info booth generates overhead header parts')
  for (let i = 0; i < header.length; i++) {
    for (let j = i + 1; j < header.length; j++) {
      const a = header[i].box, b = header[j].box
      const overlap = ['x', 'y', 'z'].map(axis =>
        Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]))
      assert.ok(overlap.some(span => span <= EPS),
        `${header[i].mat.name} and ${header[j].mat.name} share header volume`)
    }
  }
})

test('adding or removing a ceiling slab or roof invalidates only affected info booths', () => {
  const infoMod = { ...booth('info', 3, 3, 0, 0, 0, 0), id: 'booth-info' }
  const ticketMod = { ...booth('ticket', 3, 3, 10, 0, 0, 0), id: 'booth-ticket' }
  const before = { name: 't', cells: [], modules: [infoMod, ticketMod], lines: [] }
  const afterSlab = { ...before, cells: ceilingSlab(infoMod, 5) }
  const retainedAfterSlab = retainedModuleIds(before, afterSlab)
  assert.ok(!retainedAfterSlab.has('booth-info'), 'adding ceiling slab invalidates info booth')
  assert.ok(retainedAfterSlab.has('booth-ticket'), 'adding ceiling slab retains ticket booth')

  const byType = new Map([['booth', before.modules]])
  const invalidated = cellEditInvalidatedModules(before, afterSlab, byType, () => undefined)
  assert.ok(invalidated && invalidated.some(m => m.id === 'booth-info'), 'cellEditInvalidatedModules catches info booth')
  assert.ok(invalidated && !invalidated.some(m => m.id === 'booth-ticket'), 'cellEditInvalidatedModules skips ticket booth')

  const canopy = { id: 'canopy-1', type: 'roof', x: 0, y: 0, z: 0, w: 4, d: 4, rot: 0, cfg: { variant: 'canopy' } }
  const afterRoof = { ...before, modules: [...before.modules, canopy] }
  const byTypeRoof = new Map([['booth', before.modules], ['roof', [canopy]]])
  const delta = moduleEditDelta(before, afterRoof, byTypeRoof, afterRoof.modules)
  assert.ok(delta && delta.rebuild.some(m => m.id === 'booth-info'), 'adding canopy roof rebuilds covered info booth')
  assert.ok(delta && !delta.rebuild.some(m => m.id === 'booth-ticket'), 'adding canopy roof retains ticket booth')
})
