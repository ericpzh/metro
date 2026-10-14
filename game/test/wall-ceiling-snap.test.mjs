// Wall/ceiling snap: decor is aimed at its surface, never at a floating course.
//
// A wall panel hovered on an upper wall course anchors to the storey floor below
// (`wallMountStandCell`) — except a **玻璃板**, which is cladding from its base and
// therefore hangs over the very course the pointer is on (`wallMountFollowsCourse`) —
// and a hung fitting hovered on the ceiling slab, the floor, or a wall course resolves
// to the floor it hangs over (`ceilingMountStandCell`) — so the ghost and the committed
// piece sit on the surface, while the save keeps the floor anchor the envelopes read.
// Every one of those snaps asks the station's own **基准高度** for the 4 m grid: a
// station whose grid is shifted by a metre must not anchor its decor to the fixed
// 0 / 4 / 8 lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ceilingMountHeight,
  ceilingMountMissing,
  ceilingMountStandCell,
  equipmentReason,
  hungCeilingAim,
  hangLineOf,
  hungDrop,
  moduleEnvelope,
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
  const cells = [floor(0, 0, 5), wall(0, -1, 6), wall(0, -1, 7), wall(0, -1, 8)]
  assert.deepEqual(
    wallMountStandCell(cells, [0, -1, 7], [0, 0, 7], false, 1),
    [0, 0, 5],
    'the panel belongs to the storey floor, and the storey is the shifted one',
  )
  assert.deepEqual(
    wallMountStandCell(cells, [0, -1, 7], [0, 0, 7]),
    [0, 0, 4],
    'a caller that names no base still reads the unshifted grid',
  )
  // The panel really hangs there: the wall's own two courses back a 2 m panel.
  const panel = createModule('glass-1x2', 0, 0, 5, 'g', 0)
  assert.ok(panel)
  assert.equal(wallMountMissing(cells, panel), false)
  // The storey above keeps its own floor, not the one below it.
  const upper = [...cells, floor(0, 0, 9), wall(0, -1, 9), wall(0, -1, 10)]
  assert.deepEqual(wallMountStandCell(upper, [0, -1, 10], [0, 0, 10], false, 1), [0, 0, 9])
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
  assert.deepEqual(at(8, false), [0, 0, 5], 'a poster aimed at the third course stays at the floor')
  // A **floor** block (nothing over it) is not a band of wall to cover: the pane still
  // stands on that floor level, so aiming at a slab's edge never sinks it into the slab.
  assert.deepEqual(wallMountStandCell([floor(0, 0, 5)], [0, 0, 5], [0, -1, 5], false, 1, true), [0, -1, 5], 'a floor edge keeps the storey reading')
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

test('a hung ceiling piece can be hung at the height the pointer is on', () => {
  // `hungCeilingAim`: a floor means "hang in this room" — the piece takes the storey and no line
  // of its own, so it hangs from the real slab overhead (`ceilingMountHeight` — never the fixed
  // 4 m grid line, which floated a 基准高度-1 station's lights a metre low and a tall room's in
  // mid-air). Any **other** surface names a height: the line is that block's own bottom edge and
  // the piece is anchored under it — in front of the wall for a side face, in the same column
  // under a slab — so it can be hung wherever the pointer is, mid-air included.
  assert.deepEqual(hungCeilingAim([2, 2, 5], [2, 2, 6]), { at: [2, 2, 5] }, 'a floor top: the storey, hung from its ceiling')
  assert.deepEqual(hungCeilingAim([2, 2, 7], [2, 2, 6]), { at: [2, 2, 6], line: 7 }, 'a slab underside: just below the slab')
  assert.deepEqual(hungCeilingAim([2, 3, 7], [2, 2, 7]), { at: [2, 2, 6], line: 7 }, 'a wall course: one below it, in front of the wall')
  // The station's own grid answers the work-plane hover (void), the same storey a floor gives.
  assert.deepEqual(hungCeilingAim([2, 2, 6], [2, 2, 6], 1), { at: [2, 2, 5] }, 'a void hover reads the 基准高度 storey')
  // `drop` is the metre a stem piece's **body** hangs below that line, so its cell is the one
  // whose floor top is the body's own height and the whole piece stays inside that column.
  assert.deepEqual(hungCeilingAim([2, 2, 7], [2, 2, 6], 0, 1), { at: [2, 2, 5], line: 7 }, 'a stem piece: a metre lower still')
  assert.deepEqual(hungCeilingAim([2, 2, 5], [2, 2, 6], 0, 1), { at: [2, 2, 5] }, 'a floor aim is the storey either way')
  // Which pieces are on a stem and which ride flush on the surface, palette ids included.
  assert.equal(hungDrop({ type: 'tv' }), 1)
  assert.equal(hungDrop({ type: 'sign-ceiling' }), 1)
  assert.equal(hungDrop({ type: 'clock' }), 1)
  assert.equal(hungDrop({ type: 'cctv' }), 1, '枪机 on its stem')
  assert.equal(hungDrop({ type: 'cctv', cfg: { variant: 'dome' } }), 0, 'and a placed 半球机 flush, whatever its id')
  assert.equal(hungDrop({ type: 'cctv-ptz' }), 1)
  assert.equal(hungDrop({ type: 'cctv-dome' }), 0, '半球机 bolts to the surface')
  assert.equal(hungDrop({ type: 'monitor-ceiling' }), 1)
  assert.equal(hungDrop({ type: 'light-circular' }), 0)
  assert.equal(hungDrop({ type: 'vent' }), 0)

  // A **line-hung** piece needs no slab overhead: it hangs where it was put, mid-air
  // included. An ordinary one still wants the ceiling, which is the rule that kept a
  // fixture out of an empty doorway.
  const hung = createModule('light-circular', 2, 2, 6, 'l')
  assert.ok(hung)
  hung.cfg.line = 7
  assert.equal(hangLineOf(hung), 7)
  assert.equal(ceilingMountMissing([], hung), false, 'hung at a height, it hangs on nothing')
  const ceilingBound = createModule('light-circular', 2, 2, 5, 'l2')
  assert.ok(ceilingBound)
  assert.equal(hangLineOf(ceilingBound), undefined)
  assert.equal(ceilingMountMissing([], ceilingBound), true, 'and one meant for the ceiling still needs a slab')
  // A line the player aimed at is reserved as its own thin plate, not as the storey's ceiling.
  assert.equal(moduleEnvelope(hung).z1, 7)
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

test('a shifted floor snaps to its actual ceiling instead of a fixed 4 m grid line', () => {
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
