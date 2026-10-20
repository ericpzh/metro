// Wall/ceiling snap: decor is aimed at its surface, never at a floating course.
//
// A wall panel hovered on an upper wall course anchors to the storey floor below
// (`wallMountStandCell`) — except a **玻璃板**, which is cladding from its base and
// therefore hangs over the very course the pointer is on (`wallMountFollowsCourse`) —
// and a hung fitting hovered on the ceiling slab, the floor, or a wall course resolves
// to the floor it hangs over (`ceilingMountStandCell`) — so the ghost and the committed
// piece sit on the surface, while the save keeps the floor anchor the envelopes read.
// Every one of those snaps asks the station's own **基准高度** for the 5 m grid: a
// station whose grid is shifted by a metre must not anchor its decor to the fixed
// 0 / 4 / 8 lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ceilingMountHeight,
  ceilingMountMissing,
  ceilingMountStandCell,
  equipmentReason,
  hangCeilingLocal,
  hungCeilingAim,
  moduleEnvelope,
  topBlockOver,
  topBlockZ,
  wallMountFollowsCourse,
  wallMountMissing,
  wallMountStandCell,
} from '../src/sim/placement.ts'
import { createModule } from '../src/build/model.ts'

const floor = (x, y, z) => ({ x, y, z, fill: 'solid' })
const wall = (x, y, z) => ({ x, y, z, fill: 'solid', tags: ['auto-wall'] })

test('a wall hover on an upper course anchors the panel to the floor below', () => {
  const cells = [floor(0, 0, 0), wall(0, -1, 0), wall(0, -1, 1), wall(0, -1, 2), wall(0, -1, 3)]
  // Base course: unchanged behaviour.
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 0], [0, 0, 0]), [0, 0, 0])
  // Second course of the same wall: the panel belongs to the floor, not to z = 1.
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 1], [0, 0, 1]), [0, 0, 0])
  // Third course likewise.
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 2], [0, 0, 2]), [0, 0, 0])
  // A panel anchored there really hangs: backing exists at the course it needs.
  const mod = createModule('billboard-wide', 0, 0, 0, 'bb', 0)
  assert.ok(mod)
  assert.equal(wallMountMissing(cells, mod), false)
})

test('a wall hover anchors to the storey of the 基准高度 grid, not the fixed 0 / 4 / 8 lines', () => {
  // The same wall one storey up a station whose grid is shifted by a metre (基准高度
  // 1): its floor is 5, its four courses are 6…9, and the next floor is 9.
  const cells = [floor(0, 0, 6), wall(0, -1, 6), wall(0, -1, 7), wall(0, -1, 8)]
  assert.deepEqual(
    wallMountStandCell(cells, [0, -1, 7], [0, 0, 7], false, 1),
    [0, 0, 6],
    'the panel belongs to the storey floor, and the storey is the shifted one',
  )
  assert.deepEqual(
    wallMountStandCell(cells, [0, -1, 7], [0, 0, 7]),
    [0, 0, 5],
    'a caller that names no base still reads the unshifted grid',
  )
  // The panel really hangs there: the wall's own two courses back a 2 m panel.
  const panel = createModule('glass-1x2', 0, 0, 6, 'g', 0)
  assert.ok(panel)
  assert.equal(wallMountMissing(cells, panel), false)
  // The storey above keeps its own floor, not the one below it.
  const upper = [...cells, floor(0, 0, 11), wall(0, -1, 11), wall(0, -1, 12)]
  assert.deepEqual(wallMountStandCell(upper, [0, -1, 12], [0, 0, 12], false, 1), [0, 0, 11])
})

test('a side face is a wall whatever tags the block carries, so a 方块 wall mounts too', () => {
  // A wall raised with the 方块 brush wears no wall tag, and `isWallBlock` says a
  // plain block is not one. Aiming at its **side face** still means "hang the panel
  // on this face" (§9.5: side face = wall-mounted), so the piece stands in the cell
  // in front of that face — not inside the block, where it could bolt to either
  // neighbour and its z was whatever course happened to be hit.
  const plain = (x, y, z) => ({ x, y, z, fill: 'solid' })
  const cells = [plain(0, 0, 0), plain(0, -1, 1), plain(0, -1, 2)]
  assert.deepEqual(wallMountStandCell(cells, [0, -1, 1], [0, 0, 1]), [0, 0, 0], 'the cell in front of the face')
  // A **top** face is the block the piece stands on, so that half is unchanged.
  assert.deepEqual(wallMountStandCell(cells, [0, 0, 0], [0, 0, 0]), [0, 0, 0])
  // The block behind the face is backing enough (`wallMountMissing` reads any solid,
  // tagged or not), so the panel really hangs on the 方块 wall.
  const panel = createModule('glass-1x1', 0, 0, 0, 'g', 0)
  assert.ok(panel)
  assert.equal(wallMountMissing(cells, panel), false)
})


test('a 玻璃板 hangs over the course the pointer is on, and a poster keeps its band', () => {
  // `wallMountFollowsCourse`: the 玻璃板 is **cladding from its base**, so the cell one
  // below the block that was hit puts the pane over exactly the course aimed at — a
  // window where the player points, instead of floor cladding wherever the pointer
  // happens to be. Aiming at the wall's first course still lands on the storey floor,
  // which is the cladding it has always been.
  const cells = [floor(0, 0, 5), wall(0, -1, 6), wall(0, -1, 7), wall(0, -1, 8), wall(0, -1, 9)]
  const at = (z, follow) => wallMountStandCell(cells, [0, -1, z], [0, 0, z], false, 1, follow)
  assert.deepEqual(at(6, true), [0, 0, 5], 'the first course above the floor is the floor')
  assert.deepEqual(at(7, true), [0, 0, 6], 'the second course hangs the pane over the second course')
  assert.deepEqual(at(8, true), [0, 0, 7], 'and the third likewise')
  // The pane really hangs there: the block aimed at is its backing, one course up.
  const pane = createModule('glass-1x1', 0, 0, 6, 'g6', 0)
  assert.ok(pane)
  assert.equal(wallMountMissing(cells, pane), false)
  assert.equal(equipmentReason(cells, [], pane, true), '', 'and a pane hanging over a course is accepted')
  // A piece drawn at its own `panelZ` keeps the storey floor: that is what puts a
  // poster at eye height wherever on the wall it is aimed.
  assert.deepEqual(at(8, false), [0, 0, 6], 'a poster aimed at the third course stays at the floor')
  // A **floor** block (nothing over it) is not a band of wall to cover: the pane still
  // stands on that floor level, so aiming at a slab's edge never sinks it into the slab.
  assert.deepEqual(wallMountStandCell([floor(0, 0, 6)], [0, 0, 6], [0, -1, 6], false, 1, true), [0, -1, 6], 'a floor edge keeps the storey reading')
})

test('only the wall-mounted 玻璃板 follows the aimed course', () => {
  // The predicate the tools ask before the module exists, so it answers a **palette id**
  // as readily as a placed one (`equipment-placement-input`).
  for (const id of ['glass-1x1', 'glass-3x2', 'glass-2x1']) {
    assert.equal(wallMountFollowsCourse({ type: id }), true, `${id} is cladding: it hangs where it is aimed`)
  }
  for (const id of ['curtain-wall', 'billboard-wide', 'sign-wall', 'linemap', 'calligraphy-landscape']) {
    assert.equal(wallMountFollowsCourse({ type: id }), false, `${id} is drawn at its own height`)
  }
  // A placed module answers the same way, `cfg` and all.
  const standing = createModule('curtain-wall', 0, 0, 0, 'c', 0, 1, undefined, undefined, [], undefined, { curtainHeight: 2 })
  const panel = createModule('glass-2x2', 0, 0, 0, 'g', 0)
  assert.ok(standing)
  assert.ok(panel)
  assert.equal(wallMountFollowsCourse(standing), false, 'a floor-standing 玻璃幕墙 is not wall-mounted at all')
  assert.equal(wallMountFollowsCourse(panel), true)
})

test('a hung ceiling piece takes the free cell under the top block of its column', () => {
  // `hungCeilingAim`: a hanging item always lives at `top block - 1` — the cell under the block it
  // hangs from — wherever on that column the pointer is: the floor, a wall course between them, or
  // the slab's own underside. `place` names the column for a side face, so a board hangs in front
  // of the wall it was aimed at. A column with nothing over the pointer leaves the storey's own
  // floor, and `ceilingMountMissing` refuses a hung piece that finds no ceiling there.
  const cells = [
    { x: 2, y: 2, z: 0, fill: 'solid' }, // the floor, with the slab over it
    { x: 2, y: 2, z: 5, fill: 'solid' },
    { x: 2, y: 3, z: 0, fill: 'solid' }, // a wall run, up to its own slab
    { x: 2, y: 3, z: 1, fill: 'solid' },
    { x: 2, y: 3, z: 2, fill: 'solid' },
    { x: 2, y: 3, z: 5, fill: 'solid' },
  ]
  assert.deepEqual(hungCeilingAim([2, 2, 0], [2, 2, 1], 0, cells), [2, 2, 4], 'a floor hover: the cell under the slab')
  assert.deepEqual(hungCeilingAim([2, 3, 2], [2, 2, 2], 0, cells), [2, 2, 4], 'a wall course: the same cell, in front of the wall')
  assert.deepEqual(hungCeilingAim([2, 3, 5], [2, 3, 4], 0, cells), [2, 3, 4], 'a slab underside: the cell under that slab')
  assert.deepEqual(hungCeilingAim([2, 2, 5], [2, 2, 4], 0, cells), [2, 2, 4], 'and a floor slab’s own underside reads its storey')
  assert.deepEqual(hungCeilingAim([2, 2, 5], [2, 2, 5], 0, cells), [2, 2, 5], 'the work plane reads the same column')
  assert.deepEqual(hungCeilingAim([6, 6, 6], [6, 6, 7], 0, []), [6, 6, 5], 'nothing overhead: the storey floor stands in')
  assert.deepEqual(hungCeilingAim([6, 6, 6], [6, 6, 6], 1, []), [6, 6, 6], 'and it reads the 基准高度 grid')
  // The lookup itself: the first **underside** overhead, a wall's own courses skipped.
  assert.equal(topBlockZ(cells, 2, 2, 1), 5, 'the slab over the floor')
  assert.equal(topBlockZ(cells, 2, 3, 2), 5, 'and the slab over a wall run')
  assert.equal(topBlockZ(cells, 2, 4, 0), null, 'a column with nothing in it')
  assert.equal(topBlockOver(cells, { x: 2, y: 3, z: 4 }), true, 'the block over the piece’s own cell')
  assert.equal(topBlockOver(cells, { x: 2, y: 2, z: 0 }), false)

  // The verdict: a piece under a top block hangs from it and needs no storey slab; a piece left on
  // a floor still wants a ceiling over it — which is what kept a fixture out of an empty doorway.
  const under = createModule('light-circular', 2, 3, 4, 'l')
  assert.ok(under)
  assert.equal(ceilingMountMissing(cells, under), false, 'the block over its cell is its ceiling')
  assert.equal(hangCeilingLocal(under, cells), 0, 'and the mount sits at the cell’s own top')
  // The reserved band of a flush fitting is still the storey's nominal line: `moduleEnvelope` reads
  // the module alone, with no cells to ask where the slab actually is.
  assert.equal(moduleEnvelope(under).z1, 5, 'the fitting reserves its band under the nominal storey line')
  const floorBound = createModule('light-circular', 2, 2, 0, 'l2')
  assert.ok(floorBound)
  assert.equal(ceilingMountMissing([{ x: 2, y: 2, z: 0, fill: 'solid' }], floorBound), true, 'no ceiling over the floor')
  assert.equal(ceilingMountMissing(cells, floorBound), false, 'and the slab over the floor answers it')
  assert.equal(hangCeilingLocal(floorBound, cells), 4, 'which is the real slab, this storey tall')
})

test('a ceiling hover resolves to the floor below, from any face', () => {
  // Top face of the floor: the cell itself.
  assert.deepEqual(ceilingMountStandCell([2, 2, 0], [2, 2, 1]), [2, 2, 0])
  // Underside of the slab overhead: one storey down.
  assert.deepEqual(ceilingMountStandCell([2, 2, 4], [2, 2, 3]), [2, 2, 0])
  // Side face of a wall course: the face-adjacent cell, on its own storey floor.
  assert.deepEqual(ceilingMountStandCell([2, 1, 1], [2, 2, 1]), [2, 2, 0])
  // Void work plane passes through untouched.
  assert.deepEqual(ceilingMountStandCell([5, 5, 0], [5, 5, 0]), [5, 5, 0])
})

test('a shifted floor snaps to its actual ceiling instead of a fixed 5 m grid line', () => {
  const cells = [floor(2, 2, 1), floor(2, 2, 5)]
  // The underside of the z=5 slab belongs to the z=1 storey when the level base is 1.
  const at = ceilingMountStandCell([2, 2, 5], [2, 2, 4], 1)
  assert.deepEqual(at, [2, 2, 1])
  const sign = createModule('sign-ceiling', at[0], at[1], at[2], 'shifted-sign', 0)
  assert.ok(sign)
  assert.equal(ceilingMountMissing(cells, sign), false, 'the shifted ceiling slab supports the sign')
  assert.equal(ceilingMountHeight(cells, sign), 3, 'the support height is measured from the actual slab')
  assert.equal(equipmentReason(cells, [], sign, true), '', 'preview/release verdict accepts the same support')

  // A taller room is valid too: support comes from its actual slab, not the next 4 m line.
  const tallCells = [floor(2, 2, 1), floor(2, 2, 6)]
  assert.deepEqual(ceilingMountStandCell([2, 2, 6], [2, 2, 5], 1, tallCells), [2, 2, 1], 'an underside aim finds the exposed floor four metres below')
  assert.equal(ceilingMountMissing(tallCells, sign), false)
  assert.equal(ceilingMountHeight(tallCells, sign), 4)
})

test('a hung piece aimed from the ceiling slab passes the shared verdict', () => {
  const cells = [floor(2, 2, 0), floor(2, 2, 4)]
  const at = ceilingMountStandCell([2, 2, 4], [2, 2, 3])
  assert.deepEqual(at, [2, 2, 0])
  const clock = createModule('clock', at[0], at[1], at[2], 'c', 0)
  assert.ok(clock)
  assert.equal(ceilingMountMissing(cells, clock), false)
  assert.equal(equipmentReason(cells, [], clock, true), '')
  // Open sky still refuses it.
  const open = createModule('clock', 2, 2, 0, 'c2', 0)
  assert.ok(open)
  assert.equal(equipmentReason([floor(2, 2, 0)], [], open, true), 'ceiling')
})
