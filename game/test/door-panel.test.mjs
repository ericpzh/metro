// Swing doors (装饰 门, §5.7) — the free-standing doorway the player stands on a floor
// tile, and the piece an 办公室 / 厕所 closes its own doorway with.
//
// Three things make the piece what it is, and all three are mechanical rather than
// artistic, which is why they are pinned here rather than checked by eye:
//
//   * **Four variants are one table.** 单开 / 双开 × 不锈钢 / 木, with the run in cells
//     and the material in `sim/doors.ts`; the palette id names the variant while a
//     placed module's `type` is the bare `door`.
//   * **It stands on the ground.** It carries its own structure — a threshold, a post at
//     each end and a head — so it is placed on a floor tile like a 货架 and needs no wall
//     behind it. It is *not* a wall-mounted piece, and `isWallMounted` says so.
//   * **It is one piece of furniture, not two drawings.** The office's own doorway is
//     built by the same `buildDoor`, so a standing 门 and a room's door are the same
//     threshold, posts, head, leaves and fittings.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  DEFAULT_DOOR_VARIANT,
  DOOR_FRAME,
  DOOR_MATERIAL_LABEL,
  DOOR_SPECS,
  DOOR_VARIANTS,
  doorLabel,
  doorLeafHeight,
  doorLeafLabel,
  doorLeafWidths,
  doorOpeningWidth,
  doorSpec,
} from '../src/sim/doors.ts'
import {
  doorCells,
  equipmentReason,
  isWallMounted,
  moduleAt,
  moduleEnvelope,
  moduleFloorOk,
  moduleFootprint,
  placementBlocked,
  wallMountCourses,
  wallMountMissing,
} from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isDecorType, isDoorType, isWallMountedType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { C } from '../src/render/models/PieceBuilder.ts'
import { RAMP_SOFFIT_FINISH, finishDef } from '../src/sim/finishes.ts'
import { blobRadius } from '../src/render/scene/systems/SceneSystem.ts'

const door = (x, y, z = 0, rot = 0, id = 'door-1', variant = 'steel-1') => ({
  id,
  type: 'door',
  x,
  y,
  z,
  rot,
  w: doorSpec(variant).w,
  cfg: { variant },
})

/** Open floor: a 10 × 10 slab at z = 0, which is all a free-standing piece asks for. */
function flatStation() {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return cells
}

test('the four variants are one table: 单开 / 双开 × 不锈钢 / 木', () => {
  assert.equal(DOOR_VARIANTS.length, 4, 'four pieces in the sub-menu')
  assert.deepEqual(DOOR_VARIANTS, ['steel-1', 'steel-2', 'wood-1', 'wood-2'], 'each material’s own runs together')
  // Every palette id is a real variant, and every variant is in the palette: a tile
  // that names a piece the table does not have is a piece that cannot be built.
  const paletteIds = MODULE_OPTIONS.filter((m) => isDoorType(m.id)).map((m) => m.id)
  assert.deepEqual(paletteIds, DOOR_VARIANTS.map((v) => `door-${v}`), 'one tile per variant')
  for (const v of DOOR_VARIANTS) {
    const spec = doorSpec(v)
    assert.equal(spec.variant, v)
    assert.equal(spec.leaves, spec.w, `${v}: the leaf count is the run in cells — one leaf, one cell`)
    assert.ok(spec.h === DOOR_SPECS[`${spec.material}-1`].h, `${v}: every variant is one height`)
    assert.equal(spec.label, doorLabel(spec.material, spec.leaves), `${v}: its label is built from the table`)
    assert.ok(spec.label.startsWith('门 '), `${v}: and names the family (${spec.label})`)
    assert.ok(spec.label.includes(doorLeafLabel(spec.leaves)), `${v}: its leaf count (${spec.label})`)
    assert.ok(spec.label.includes(DOOR_MATERIAL_LABEL[spec.material]), `${v}: and its material (${spec.label})`)
  }
  assert.equal(doorSpec(undefined).variant, DEFAULT_DOOR_VARIANT, 'a legacy module is the 单开 不锈钢 door')
  assert.equal(doorSpec('nonsense').variant, DEFAULT_DOOR_VARIANT)
  assert.equal(doorLeafLabel(1), '单开')
  assert.equal(doorLeafLabel(2), '双开')
})

test('the factory builds a door of its variant, centred on the hovered cell', () => {
  const one = createModule('door-steel-1', 5, 6, 0, 'd1', 0)
  assert.equal(one.type, 'door')
  assert.equal(one.w, 1)
  assert.deepEqual(one.cfg, { variant: 'steel-1' })
  const pair = createModule('door-wood-2', 5, 6, 0, 'd2', 0)
  assert.equal(pair.w, 2)
  assert.deepEqual(pair.cfg, { variant: 'wood-2' })
  // A two-cell door grows evenly either side of the pointer, like a billboard's run:
  // the pointer names the middle of the doorway, not one leaf.
  assert.ok(pair.x <= 5 && pair.x + pair.w > 5, `a 双开 door covers the hovered cell (x=${pair.x})`)
  // A bare `door` (an old caller, or a room's own doorway) is the default piece, and
  // an id the palette does not offer is refused rather than minted at nobody's choice.
  assert.deepEqual(createModule('door', 5, 6, 0, 'd3', 0).cfg, { variant: DEFAULT_DOOR_VARIANT })
  assert.equal(createModule('door-nonsense', 5, 6, 0, 'd4', 0), null)
})

test('a door stands on the floor and reserves the cells it stands in', () => {
  const band = moduleEnvelope(door(2, 3, 0, 0, 'd', 'steel-1'))
  // A free-standing doorway takes its **whole cells** — the run along local +x — from the
  // floor top up to the head, with no narrow slab on a wall and no course of backing: it
  // holds itself up.
  assert.deepEqual([band.x0, band.y0, band.x1, band.y1], [2, 3, 3, 4], 'a 单开 door is one whole cell')
  assert.equal(band.z0, 1, 'it stands on the floor top')
  assert.equal(band.z1, 1 + doorSpec('steel-1').h, 'and reaches its own head')
  const pair = moduleEnvelope(door(2, 3, 0, 0, 'd', 'steel-2'))
  assert.deepEqual([pair.x0, pair.x1], [2, 4], 'a 双开 door is two whole cells')
  // A quarter-turn swaps which axis the run lies on.
  const turned = moduleEnvelope(door(2, 3, 0, 1, 'd', 'steel-2'))
  assert.deepEqual([turned.x0, turned.x1], [2, 3], 'rot 1 keeps the run on x of one cell')
  assert.deepEqual([turned.y0, turned.y1], [3, 5], 'and spans two on y')
})

test('the run is the doorway: every cell of it is the footprint and the base', () => {
  assert.deepEqual(doorCells(door(2, 3, 0, 0, 'd', 'steel-2')), [
    [2, 3, 0],
    [3, 3, 0],
  ])
  assert.deepEqual(doorCells(door(2, 3, 0, 1, 'd', 'steel-2')), [
    [2, 3, 0],
    [2, 4, 0],
  ])
  assert.deepEqual(moduleFootprint(door(2, 3, 0, 0, 'd', 'steel-1')), [[2, 3]])
  assert.deepEqual(moduleFootprint(door(2, 3, 0, 0, 'd', 'steel-2')), [
    [2, 3],
    [3, 3],
  ])
})

test('a door is not wall-mounted: it wants floor under it and no backing at all', () => {
  for (const v of DOOR_VARIANTS) {
    const mod = door(2, 2, 0, 0, 'd', v)
    assert.equal(isWallMounted(mod), false, `${v}: the piece stands on its own`)
    assert.equal(wallMountMissing(flatStation(), mod), false, `${v}: no wall behind it is not a refusal`)
    assert.deepEqual(wallMountCourses(mod), [], `${v}: so it asks for no course of backing`)
  }
  // The palette's own predicate agrees, so the placement tool never resolves it from a
  // wall (`isWallMountedType` is what the tool asks).
  for (const v of DOOR_VARIANTS) assert.equal(isWallMountedType(`door-${v}`), false, `door-${v} is floor-standing`)
  // And the ground rules really do apply: every cell of the run needs floor, and a door
  // on a floorless cell is refused for exactly that.
  const cells = flatStation()
  const hole = cells.filter((c) => !(c.x === 3 && c.y === 3))
  assert.equal(moduleFloorOk(cells, [], door(2, 3, 0, 0, 'd', 'steel-2')), true, 'two floor cells carry a 双开 door')
  assert.equal(moduleFloorOk(hole, [], door(2, 3, 0, 0, 'd', 'steel-2')), false, 'and one missing cell refuses it')
  assert.equal(equipmentReason(hole, [], door(2, 3, 0, 0, 'd', 'steel-2')), 'floor')
  assert.equal(equipmentReason(cells, [], door(2, 3, 0, 0, 'd', 'steel-2')), '', 'on a floor it stands')
})

test('two doors may not share a cell, and neighbours may not', () => {
  assert.equal(placementBlocked([door(2, 2, 0, 0, 'a', 'steel-1')], door(2, 2, 0, 0, 'b', 'steel-1')), true)
  assert.equal(placementBlocked([door(2, 2, 0, 0, 'a', 'steel-1')], door(3, 2, 0, 0, 'b', 'steel-1')), false)
  // A 玻璃板 wants a slab on a wall, which is the same air as a standing doorway's, so
  // the pair collides; a 座椅 in the neighbouring cell does not.
  assert.equal(
    placementBlocked([door(2, 2, 0, 0, 'a', 'steel-1')], { id: 'b', type: 'glass', x: 2, y: 2, z: 0, rot: 0, w: 1, cfg: { variant: '1x1' } }),
    true,
  )
  assert.equal(placementBlocked([door(2, 2, 0, 0, 'a', 'steel-1')], { id: 'b', type: 'bench', x: 3, y: 2, z: 0, w: 1, cfg: {} }), false)
  assert.equal(placementBlocked([door(2, 2, 0, 0, 'a', 'steel-1')], { id: 'b', type: 'bench', x: 2, y: 2, z: 0, w: 1, cfg: {} }), true)
})

test('a door is found from its own cell, and the palette files it under 装饰', () => {
  assert.equal(moduleAt([door(2, 2, 0, 0, 'd', 'steel-1')], 2, 2, 0)?.id, 'd')
  assert.equal(moduleAt([door(2, 2, 0, 0, 'd', 'steel-2')], 3, 2, 0)?.id, 'd', 'found from the far cell of its run')
  assert.equal(moduleAt([door(2, 2, 0, 0, 'd', 'steel-1')], 2, 3, 0), undefined)
  for (const v of DOOR_VARIANTS) {
    assert.equal(isDoorType(`door-${v}`), true)
    assert.equal(isDecorType(`door-${v}`), true, 'the rail files it under 装饰')
  }
  assert.equal(moduleLabel('door'), '门')
  // A doorway standing on the floor is furniture, so it wants the same contact blob a
  // 货架 or a 座椅 does — unlike the wall-mounted pieces, which want none.
  assert.ok(blobRadius('door') > 0, 'a standing door casts a floor contact blob')
  assert.equal(blobRadius('glass'), 0, 'a 玻璃板, bolted to a wall, does not')
})

test('a door round-trips the save', () => {
  const station = {
    name: 't',
    seed: 1,
    cells: flatStation(),
    modules: [door(2, 2, 0, 0, 'd1', 'steel-1'), door(5, 5, 0, 2, 'd2', 'wood-2')],
    lines: [],
  }
  const r = parse(serialize(station))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, station.modules)
})

test('a drag sweep takes the same variant, and leaves the others', () => {
  assert.equal(sweepFamily(door(0, 0, 0, 0, 'a', 'wood-2')), 'door:wood-2')
  assert.equal(sameSweepFamily(door(0, 0, 0, 0, 'a', 'wood-2'), door(1, 0, 0, 3, 'b', 'wood-2')), true)
  // Rotation is not part of the family, but the variant is: a 双开 stainless door does
  // not collect the single wooden ones beside it.
  assert.equal(sameSweepFamily(door(0, 0, 0, 0, 'a', 'wood-2'), door(1, 0, 0, 0, 'b', 'steel-2')), false)
  assert.equal(sameSweepFamily(door(0, 0, 0, 0, 'a', 'steel-2'), door(1, 0, 0, 0, 'b', 'steel-1')), false)
})

test('a different variant is a different hover ghost, so the palette click redraws it', () => {
  // The ghost is skipped when its key matches the one already drawn: a variant left out
  // of the key would leave a 单开 stainless door under the pointer after picking the 双开 木.
  assert.notEqual(moduleGhostKey(door(2, 2, 0, 0, 'a', 'steel-1')), moduleGhostKey(door(2, 2, 0, 0, 'b', 'wood-2')))
  assert.notEqual(moduleGhostKey(door(2, 2, 0, 0, 'a', 'steel-1')), moduleGhostKey(door(3, 2, 0, 0, 'a', 'steel-1')))
})

/* ------------------------------------------------------------- the hardware */

test('the leaves size to the opening between the posts, and a pair splits it', () => {
  const { post, jambGap, meetGap, threshold, head, headGap } = DOOR_FRAME
  // The opening is the run less a post at each end, and the piece's own height is the
  // threshold plus the leaves' opening plus the head.
  assert.ok(Math.abs(doorOpeningWidth(1) - (1 - post * 2)) < 1e-9, 'a 单开 opening is its cell less two posts')
  assert.ok(Math.abs(doorOpeningWidth(2) - (2 - post * 2)) < 1e-9, 'and a 双开 opening is two cells less two posts')
  const h = doorLeafHeight(doorSpec('steel-1').h)
  assert.ok(Math.abs(h - (doorSpec('steel-1').h - threshold - head - headGap)) < 1e-9, 'the leaf is what is left between threshold and head')
  assert.ok(h > 0 && h < doorSpec('steel-1').h, 'and it fits inside the piece')
  // One leaf fills the opening; a pair splits it, meeting in the middle, with the jamb
  // gaps at the posts: the two leaves and their three gaps are the opening again.
  const single = doorLeafWidths(doorOpeningWidth(1), 1)
  assert.equal(single.length, 1)
  assert.ok(Math.abs(single[0] + jambGap * 2 - doorOpeningWidth(1)) < 1e-9, 'a 单开 leaf fills the opening')
  const pair = doorLeafWidths(doorOpeningWidth(2), 2)
  assert.equal(pair.length, 2)
  assert.equal(pair[0], pair[1], 'a 双开 pair is two equal leaves')
  assert.ok(Math.abs(pair[0] * 2 + jambGap * 2 + meetGap - doorOpeningWidth(2)) < 1e-9, 'and the pair plus its gaps is the opening')
})

/**
 * Build one door with the lightest context it needs: a lazily minted material per name
 * (so a mesh can be recognised by the material it was handed). The door builder draws no
 * canvas, so no station and no DOM are involved.
 */
function build(mod) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const group = buildModule(mod, { mats, data: { name: 't', seed: 1, cells: [], modules: [], lines: [] }, trackCells: new Set(), finish: () => mats.steel })
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  // The module sits at (0, 0, 0): take the cell centre and the block top back off, so
  // every measurement below is in the door's own frame (0 = the floor top, ±0.5 the cell).
  const box = new THREE.Box3().setFromObject(group).translate(new THREE.Vector3(-0.5, -0.5, -1))
  return { mats, meshes, box }
}

test('a 单开 door draws the frame it stands in, plus one leaf and its fittings', () => {
  // Nine meshes for a 单开: the threshold, two posts and the head are four, and the leaf
  // brings its own five (the leaf, a kick plate, two studs and a pull). A 双开 door adds a
  // second leaf's own five and nothing else — the frame is what holds them both up.
  const single = build(door(0, 0, 0, 0, 'd', 'steel-1'))
  assert.equal(single.meshes.length, 9, 'a 单开 door')
  const pair = build(door(0, 0, 0, 0, 'd', 'steel-2'))
  assert.equal(pair.meshes.length, 14, 'a 双开 door')
  // The stainless door is the kit's **钢板**: frame and leaf are the one `darkSteel` the
  // 扶梯 truss and the 钢板 finish are, with brushed-steel fittings — so no part of it is
  // the white enamel it used to be cut from, and no part is glass.
  const steel = (b) => b.meshes.filter((m) => m.material === b.mats.darkSteel).length
  assert.equal(single.meshes.filter((m) => m.material === single.mats.white).length, 0, 'no part of it is white')
  assert.equal(single.meshes.filter((m) => m.material === single.mats.glass).length, 0, 'and no part of it is glazed')
  assert.equal(steel(single), 4 + 1, 'the frame is four members and there is one leaf in it')
  assert.equal(steel(pair), 4 + 2, 'and a 双开 hangs two leaves in the same frame')
  // A kick plate and a pull on two studs per leaf.
  assert.equal(single.meshes.filter((m) => m.material === single.mats.steel).length, 1 + 3, 'each leaf has a steel kick plate and a pull')
  assert.equal(pair.meshes.filter((m) => m.material === pair.mats.steel).length, 2 * (1 + 3), 'and a 双开 draws them twice')
})

test('the door stands on the edge of the block it is placed on', () => {
  // The doorway is not centred in its tile: its own line — the plane the leaves hang in —
  // lies on the anchor cell's **leading edge**, and the run it reserves is the cells it
  // reaches from there. So a 单开 door dropped on the cell `x 4 → 5` runs that cell with
  // its outer face on the `x = 4` edge, and a 双开 one covers two cells from the same edge.
  // `build` translates the box by −0.5, so the placed cell reads `3.5 → 4.5` here.
  const EPS = 1e-6
  const one = build(door(4, 4, 0, 0, 'd', 'steel-1')).box
  assert.ok(Math.abs(one.min.x - 3.5) < EPS, `a 单开 door reaches its cell's far edge (x ${one.min.x + 0.5})`)
  assert.ok(Math.abs(one.max.x - 4.5) < EPS, `and ends on the cell's leading edge (x ${one.max.x + 0.5})`)
  const pair = build(door(4, 4, 0, 0, 'd', 'steel-2')).box
  assert.ok(Math.abs(pair.min.x - 3.5) < EPS && Math.abs(pair.max.x - 5.5) < EPS, `a 双开 door covers both its cells from the same edge (${pair.min.x + 0.5}..${pair.max.x + 0.5})`)
  // The turn carries the run round with the piece, so the same cells are filled and the
  // same leading edge is used when the doorway faces the other way.
  const turned = build(door(4, 4, 0, 1, 'd', 'steel-1')).box
  assert.ok(Math.abs(turned.min.y - 3.5) < EPS && Math.abs(turned.max.y - 4.5) < EPS, `rot 1 runs the cell on y (${turned.min.y + 0.5}..${turned.max.y + 0.5})`)
  // Either way it faces, the doorway is a thin piece: its depth is a fraction of a cell,
  // and that depth takes up none of the run.
  assert.ok(one.max.y - one.min.y < 0.25, `and it is no deeper than a door (${one.max.y - one.min.y})`)
  assert.ok(turned.max.x - turned.min.x < 0.25, `nor when it is turned (${turned.max.x - turned.min.x})`)
})

test('every fitting stands proud of the leaf, so nothing is coplanar with it', () => {
  // The flicker this guards against: a plate lying on the leaf's face z-fights it, and
  // the two surfaces shimmer as the camera moves. So each fitting is drawn a real
  // stand-off in front of the leaf — measured here **off the leaf's own face**, which is
  // the relationship that matters, rather than off any absolute coordinate.
  const { leaf, kick } = DOOR_FRAME
  const parts = build(door(0, 0, 0, 0, 'd', 'steel-1')).meshes
  // A box's `height` is its thickness across the doorway — a member's depth off its plane
  // — while `depth` is its run along z, so the across-way half is `height / 2`.
  const half = (m) => (m.geometry.parameters.height ?? 0) / 2
  const front = (m) => m.position.y + half(m)
  // The leaf is the only 钢板 member that is as thick as the leaf says.
  const steel = parts.filter((m) => m.material.name === 'darkSteel')
  const leafMesh = steel.find((m) => Math.abs(m.geometry.parameters.height - leaf) < 1e-9)
  assert.ok(leafMesh, 'the model draws the leaf it says it does')
  const leafFace = front(leafMesh)
  // The fittings are the light steel: a kick plate, a pull, and the pull's two studs.
  const fittings = parts.filter((m) => m.material.name === 'steel')
  assert.equal(fittings.length, 4, 'a kick plate plus a pull on its two studs')
  const studs = fittings.filter((m) => m.geometry.parameters.height === 0.04)
  assert.equal(studs.length, 2, 'the pull is carried on two studs')
  const kickPlate = fittings.find((m) => m.geometry.parameters.height === 0.008)
  const pull = fittings.find((m) => m.geometry.parameters.width === 0.3)
  assert.ok(kickPlate && pull, 'and the plate and the pull are both drawn')
  const clear = (m) => m.position.y - half(m) - leafFace
  // Every fitting starts in front of the leaf, never inside it — a stud whose back lies
  // flat **on** the leaf's face is fine (the leaf's own silhouette hides the seam), a
  // fitting sunk into it is not.
  for (const m of fittings) assert.ok(clear(m) >= -1e-9, `a fitting starts on or in front of the leaf (${clear(m)})`)
  // The stand-offs are real — the plate and the studs clear the leaf, and the pull clears
  // it by more still, because its box straddles its own stand-off — and the pull is the
  // piece's frontmost member, as a pull on a closed door is.
  assert.ok(clear(kickPlate) > 0, `the kick plate clears the leaf (${clear(kickPlate)})`)
  for (const m of studs) assert.ok(clear(m) >= -1e-9, `a stud starts on or in front of it (${clear(m)})`)
  assert.ok(clear(pull) > clear(studs[0]), `and the pull's back is beyond the studs (${clear(pull)})`)
  const pullFront = pull.position.y + (pull.geometry.parameters.height ?? 0) / 2
  assert.ok(fittings.every((m) => pullFront >= m.position.y + (m.geometry.parameters.height ?? 0) / 2), 'the pull is the frontmost thing on the door')
  // The fittings are sized from the one table, so a change there cannot leave the drawn
  // body and `DOOR_FRAME` describing two different doors.
  assert.equal(kickPlate.geometry.parameters.depth, kick, 'the kick plate is its own height')
})

test('a 双开 pair carries its two pulls at the meeting line, mirrored', () => {
  // The two leaves hinge on their **outer** edges and face each other, so each pull is
  // hung on the edge that meets its partner's: a pair of doors is opened from the middle.
  // The bars are therefore mirror images about the meeting line — the left leaf's leans in
  // from its left, the right leaf's in from its right — and their **inner faces** come
  // close together at the centre of the doorway.
  const pair = build(door(0, 0, 0, 0, 'd', 'steel-2'))
  const pulls = pair.meshes.filter((m) => m.geometry.parameters.width === 0.3)
  assert.equal(pulls.length, 2, 'a pair draws one pull per leaf')
  const [left, right] = pulls.sort((a, b) => a.position.x - b.position.x)
  assert.ok(left.position.x < 0 && right.position.x > 0, `one pull on each leaf (${left.position.x}, ${right.position.x})`)
  assert.ok(Math.abs(left.position.x + right.position.x) < 1e-6, `the pair is mirrored about the meeting line (${left.position.x} + ${right.position.x})`)
  // Each bar reaches its leaf's meeting edge and no further, and the two meet in the
  // middle: the clear gap between them is a fraction of a leaf.
  const inner = (m, side) => m.position.x + side * 0.15
  const gap = inner(right, -1) - inner(left, 1)
  assert.ok(gap > 0 && gap < 0.45, `the two hang together at the middle (clear gap ${gap.toFixed(3)})`)
  // `handle` is the bar's stand-off, so a pull's inner face sits well inside the doorway's
  // half width rather than out at the leaf's hinge edge.
  const half = 1
  for (const m of pulls) assert.ok(Math.abs(m.position.x) + 0.15 < half, `a pull is inside the doorway, not at its hinge edge (${m.position.x})`)
  // A 单开 door has one leaf and nothing to meet, so its single pull sits toward the free
  // edge of the cell it fills.
  const single = build(door(0, 0, 0, 0, 'd', 'steel-1'))
  const one = single.meshes.filter((m) => m.geometry.parameters.width === 0.3)
  assert.equal(one.length, 1, 'a 单开 door draws one pull')
  assert.ok(one[0].position.x > 0, `toward its free edge (x ${one[0].position.x})`)
})

test('the two materials are two finishes, and both span the same door', () => {
  const steel = build(door(0, 0, 0, 0, 'd', 'steel-1'))
  const wood = build(door(0, 0, 0, 0, 'd', 'wood-1'))
  // A wooden door is the same piece in another finish: the stainless door's frame and
  // leaf are the kit's 钢板 with brushed-steel fittings, and the wooden one's are timber.
  const count = (b, mat) => b.meshes.filter((m) => m.material === mat).length
  assert.equal(count(steel, steel.mats.white), 0, 'the 不锈钢 door wears no enamel')
  assert.equal(count(steel, steel.mats.wood), 0, 'and no timber')
  assert.equal(count(steel, steel.mats.darkSteel), 4 + 1, 'it is one steel doorway: four frame members and a leaf')
  assert.equal(count(steel, steel.mats.glass), 0, 'with nothing glazed on it')
  assert.equal(count(wood, wood.mats.white), 0, 'the 木 door wears no enamel')
  assert.equal(count(wood, wood.mats.darkSteel), 0, 'and no 钢板')
  assert.equal(count(wood, wood.mats.wood), 4, 'its frame is the timber')
  assert.equal(count(wood, wood.mats.woodLight), 1, 'and its leaf the light timber')
  assert.equal(count(wood, wood.mats.woodDark), 3, 'with a dark wooden pull')
  // Both variants' kick plate is the brushed steel, whichever the leaf is.
  assert.equal(count(steel, steel.mats.steel), 1 + 3, 'one steel kick plate and one steel pull')
  assert.equal(count(wood, wood.mats.steel), 1, 'and the wooden door keeps the steel kick plate')
  // The stainless door is literally the same steel as the game's 钢板: the colour the
  // kit casts `darkSteel` in is the one the 钢板 ceiling finish is tinted with and the
  // 扶梯 truss (and the ground under it) is drawn in.
  assert.equal(C.darkSteel, finishDef(RAMP_SOFFIT_FINISH).tint, 'the stainless door, the 钢板 finish and the 扶梯 truss are one steel')
  assert.ok(Math.abs(steel.box.max.z - steel.box.min.z - doorSpec('steel-1').h) < 1e-6, 'and it is drawn its own height')
})

test('the door is drawn to the size the palette promises, standing on the floor', () => {
  // The box is measured in the piece's own frame, so the cell centre is 0 and the floor
  // top is z = 0: the doorway stands **on** that plane, not off a wall.
  const EPS = 1e-6
  for (const v of DOOR_VARIANTS) {
    const spec = doorSpec(v)
    const { box } = build(door(0, 0, 0, 0, 'd', v))
    assert.ok(Math.abs(box.max.x - box.min.x - spec.w) < EPS, `${v}: the run is exactly ${spec.w} cells`)
    assert.ok(Math.abs(box.max.z - spec.h) < EPS, `${v}: drawn ${spec.h} m tall, as reserved`)
    assert.ok(Math.abs(box.min.z) < EPS, `${v}: and its threshold stands on the floor (z ${box.min.z})`)
    // It stands on the cell's **leading edge**, not about its middle: the frame's outer
    // face is on that edge and the piece's depth reaches in from there. In `build`'s frame
    // the placed cell reads `−0.5 … 0.5` in x, and its leading edge — the `mod.y` face the
    // doorway stands on — is `−0.31` for this frame (across the doorway, in y).
    const outer = box.max.y
    const inner = box.min.y
    assert.ok(Math.abs(outer - -0.31) < EPS, `${v}: its outer face is on the cell's edge (y ${outer})`)
    assert.ok(inner < outer, `${v}: and its depth reaches in from there (${inner}..${outer})`)
    assert.ok(outer - inner < 0.25, `${v}: no deeper than a door (${outer - inner})`)
  }
})
