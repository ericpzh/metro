// The two free-standing 装饰 pieces added beside the rest of the room furniture:
// the stainless double litter bin (垃圾桶) and the red steel fire-extinguisher
// cabinet (灭火器). Both are cosmetic — no server, no stop — so what has to be true
// of them is mechanical: the factory makes them with the hover rotation, each
// reserves exactly its own cell up to the height it is drawn to, furniture may
// stand inside a walled room, a drag sweep collects a run of them, and the model
// really is the piece the reference shows (two mouths on the bin; four legs, a
// split front and white lettering on the cabinet).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { moduleAt, moduleEnvelope, placementBlocked, placementOnTrack } from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isDecorType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { buildModule } from '../src/render/models.ts'

/** The drawn height of each piece, which its collision envelope must reserve. */
const BIN_H = 0.95
const FIRE_H = 1.1

const bin = (x, y, z = 0, id = 'bin-1', rot = 0) => ({ id, type: 'bin', x, y, z, rot, cfg: {} })
const fire = (x, y, z = 0, id = 'fire-1', rot = 0) => ({ id, type: 'extinguisher', x, y, z, rot, cfg: {} })
const shop = (id = 'shop-1') => ({ id, type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'store', door: [] } })
const booth = (id = 'booth-1') => ({ id, type: 'booth', x: 0, y: 0, z: 0, w: 3, h: 3, cfg: { kind: 'ticket', door: [] } })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, rot: 0, cfg: { dir: 'both' } })

/** Open floor: a 10 × 10 slab at z = 0. */
function flatStation() {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return { name: 't', seed: 1, cells, modules: [], lines: [] }
}

test('the factory builds both pieces with the hover rotation', () => {
  const b = createModule('bin', 3, 4, -4, 'b', 2)
  assert.equal(b?.type, 'bin')
  assert.equal(b?.rot, 2)
  assert.deepEqual(b?.cfg, {})
  const f = createModule('extinguisher', 3, 4, -4, 'f', 1)
  assert.equal(f?.type, 'extinguisher')
  assert.equal(f?.rot, 1)
  assert.deepEqual(f?.cfg, {})
})

test('the palette files both under 装饰, with their Chinese labels', () => {
  for (const [id, label] of [
    ['bin', '垃圾桶'],
    ['extinguisher', '灭火器'],
  ]) {
    const option = MODULE_OPTIONS.find((m) => m.id === id)
    assert.ok(option, `${id} is in the palette`)
    assert.equal(option.label, label)
    assert.equal(option.w, 1)
    assert.equal(option.h, 1)
    assert.equal(isDecorType(id), true, `${id} belongs to the 装饰 folder`)
    assert.equal(moduleLabel(id), label)
  }
})

test('each piece reserves its own cell, up to the height it is drawn to', () => {
  for (const [mod, height] of [
    [bin(2, 2), BIN_H],
    [fire(2, 2), FIRE_H],
  ]) {
    const e = moduleEnvelope(mod)
    assert.deepEqual([e.x0, e.y0, e.x1, e.y1], [2, 2, 3, 3])
    // It rises from the block top (`z + 1`) by exactly the drawn height, so the
    // body cannot stand taller than the space it reserves.
    assert.equal(e.z0, 1)
    assert.equal(e.z1, 1 + height)
  }
})

test('two pieces may not share a cell, but neighbours and the storey above are free', () => {
  assert.equal(placementBlocked([bin(2, 2)], fire(2, 2, 0, 'f2')), true)
  assert.equal(placementBlocked([fire(2, 2)], bin(2, 2, 0, 'b2')), true)
  assert.equal(placementBlocked([bin(2, 2)], bin(3, 2, 0, 'b2')), false)
  assert.equal(placementBlocked([fire(2, 2)], fire(2, 3, 0, 'f2')), false)
  assert.equal(placementBlocked([bin(2, 2)], bin(2, 2, 4, 'b2')), false)
  // A gate is equipment like anything else: the pair still collides.
  assert.equal(placementBlocked([gate(2, 2, 0)], bin(2, 2, 0, 'b2')), true)
})

test('the bin and the cabinet are room furniture: they may stand inside a room', () => {
  for (const room of [shop(), booth()]) {
    assert.equal(placementBlocked([room], bin(2, 2)), false, `${room.type} takes a bin`)
    assert.equal(placementBlocked([bin(2, 2)], room), false, 'either side of the pair')
    assert.equal(placementBlocked([room], fire(2, 2)), false, `${room.type} takes a 灭火器箱`)
  }
})

test('a piece is found from its cell and refused on a track bed', () => {
  assert.equal(moduleAt([bin(2, 2)], 2, 2, 0)?.id, 'bin-1')
  assert.equal(moduleAt([fire(2, 2)], 2, 2, 0)?.id, 'fire-1')
  assert.equal(moduleAt([bin(2, 2)], 3, 2, 0), undefined)
  const st = flatStation()
  const bed = st.cells.map((c) => (c.x === 2 && c.y === 2 ? { ...c, finish: { top: 'floor.track' } } : c))
  assert.equal(placementOnTrack(bed, bin(2, 2), []), true)
  assert.equal(placementOnTrack(bed, fire(2, 2), []), true)
  assert.equal(placementOnTrack(bed, bin(3, 3), []), false)
})

test('both pieces round-trip the save', () => {
  const st = { ...flatStation(), modules: [bin(2, 2, 0, 'b', 1), fire(4, 4, 0, 'f', 3)] }
  const r = parse(serialize(st))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, st.modules)
})

test('a drag sweep collects a run of either piece, and nothing else', () => {
  assert.equal(sweepFamily(bin(0, 0)), 'bin')
  assert.equal(sweepFamily(fire(0, 0)), 'extinguisher')
  // A run of bins is one sweep whatever way each is turned.
  assert.equal(sameSweepFamily(bin(0, 0, 0, 'a', 0), bin(1, 0, 0, 'b', 3)), true)
  assert.equal(sameSweepFamily(fire(0, 0, 0, 'a', 2), fire(1, 0, 0, 'b', 1)), true)
  // The two decorations are different pieces, so they never sweep together.
  assert.equal(sameSweepFamily(bin(0, 0, 0, 'a'), fire(1, 0, 0, 'b')), false)
  assert.equal(sameSweepFamily(bin(0, 0, 0, 'a'), gate(1, 0, 0, 'g')), false)
})

/* ------------------------------------------------------------------ the models */

/**
 * Build one piece with the lightest context the two models need: a lazily minted
 * material per name (so `mats.binLabels` is stable and a mesh can be recognised by
 * the material it was handed), no station and no DOM — neither builder draws to a
 * canvas, and the printed faces are materials the kit mints, not textures the
 * module makes.
 */
function build(mod) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const data = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
  const group = buildModule(mod, { mats, data, trackCells: new Set(), finish: () => mats.steel, preview: false })
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  // The module sits at (0, 0, 0), so the world box is the block's own frame once
  // the cell centre (0.5, 0.5) and the block top (z = 1) are taken back off.
  const box = new THREE.Box3().setFromObject(group).translate(new THREE.Vector3(-0.5, -0.5, -1))
  return { mats, meshes, box }
}

/** One mesh's box in the same cell frame as `build`'s group box. */
const meshBox = (mesh) => new THREE.Box3().setFromObject(mesh).translate(new THREE.Vector3(-0.5, -0.5, -1))

test('the bin is an enclosed stainless cabinet: two hopper mouths, one sticker plate, symmetric', () => {
  const { mats, meshes, box } = build(bin(0, 0))
  // It fits the cell it reserves and stands on the floor, exactly as tall as its
  // collision envelope says.
  assert.ok(box.min.x >= -0.5 && box.max.x <= 0.5, 'fits the cell across')
  assert.ok(box.min.y >= -0.5 && box.max.y <= 0.5, 'fits the cell in depth')
  assert.ok(Math.abs(box.min.z) < 1e-6, 'stands on the floor')
  assert.ok(Math.abs(box.max.z - BIN_H) < 1e-6, `drawn height is the reserved ${BIN_H} m`)
  // Two streams: a dark well under each hopper mouth, one each side of the
  // centre, and the shell symmetric about x because they are.
  const wells = meshes.filter((m) => m.material === mats.black)
  assert.equal(wells.length, 2, 'two mouths, each with its dark well')
  assert.ok(Math.sign(wells[0].position.x) === -Math.sign(wells[1].position.x), 'one each side of centre')
  assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6, 'the shell is symmetric')
  // The enclosed shell is stainless, and the sorting stickers are one plate on
  // its front (local −y) that stands proud of the shell rather than coplanar
  // with it.
  assert.ok(meshes.filter((m) => m.material === mats.binSteel).length >= 8, 'the cabinet is stainless steel')
  const stickers = meshes.filter((m) => m.material === mats.binLabels)
  assert.equal(stickers.length, 1, 'one printed sorting-sticker plate')
  assert.equal(stickers[0].geometry.parameters.width, 0.76, 'the plate spans the cabinet front')
  assert.equal(stickers[0].geometry.parameters.height, 0.57, 'and most of its height')
  assert.ok(stickers[0].position.y < 0, 'the plate faces the local −y front')
  // The plate floats just off the front panel — close enough to read as printed
  // on it, far enough that the two surfaces never z-fight. The face is the
  // front-most stainless box at the plate's own height (the jutting sill is at
  // foot level, below the plate).
  const atPlateHeight = meshes.filter((m) =>
    m.material === mats.binSteel &&
    m.geometry.type === 'BoxGeometry' &&
    m.position.z - m.geometry.parameters.depth / 2 < 0.49 &&
    m.position.z + m.geometry.parameters.depth / 2 > 0.49)
  const face = Math.min(...atPlateHeight.map((m) => m.position.y - m.geometry.parameters.height / 2))
  const standOff = face - stickers[0].position.y
  assert.ok(standOff > 0 && standOff < 0.01, `the plate stands ${standOff} m off the front panel`)
})

test('the 灭火器箱 is a red steel box on four legs, lettered in white', () => {
  const { mats, meshes, box } = build(fire(0, 0))
  assert.ok(box.min.x >= -0.5 && box.max.x <= 0.5, 'fits the cell across')
  assert.ok(box.min.y >= -0.5 && box.max.y <= 0.5, 'fits the cell in depth')
  assert.ok(Math.abs(box.max.z - FIRE_H) < 1e-6, `drawn height is the reserved ${FIRE_H} m`)
  // Four legs are the only thing on the floor, one at each corner, and the box
  // rides them: nothing else reaches the bottom of the cell.
  const onFloor = meshes.filter((m) => meshBox(m).min.z < 1e-6)
  assert.equal(onFloor.length, 4, 'exactly four legs')
  assert.deepEqual(
    new Set(onFloor.map((m) => `${Math.sign(m.position.x)},${Math.sign(m.position.y)}`)),
    new Set(['-1,-1', '-1,1', '1,-1', '1,1']),
    'the legs are at the four corners',
  )
  assert.ok(Math.abs(meshBox(onFloor[0]).min.z) < 1e-6, 'the legs stand on the floor')
  assert.ok(box.min.z + 0.1 < meshBox(onFloor[0]).max.z, 'the legs are short: the body rides above them')
  // Red steel everywhere, and the lettering is a white decal on the front doors.
  assert.ok(meshes.filter((m) => m.material === mats.exitRed).length >= 5, 'the cabinet is red steel')
  const letters = meshes.filter((m) => m.material === mats.fireLabels)
  assert.equal(letters.length, 1, 'one printed face')
  assert.ok(letters[0].position.y < 0, 'the lettering faces the local −y front')
  assert.ok(letters[0].position.y <= box.min.y + 1e-9, 'the decal is proud of the doors')
  // One plate spans both doors and the seam between them, so 灭火器箱 and 火119警
  // are printed on one piece of glass-clear decal, not two that could drift.
  assert.ok(letters[0].geometry.parameters.height >= 0.7, 'the plate covers both doors')
  // The recessed handle is on the +x side, outside the carcass.
  assert.ok(meshes.some((m) => m.position.x > 0.35), 'the handle is on the side')
})
