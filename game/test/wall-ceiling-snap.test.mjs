// Wall/ceiling snap: decor is aimed at its surface, never at a floating course.
//
// A wall panel hovered on an upper wall course still anchors to the storey floor
// below (`wallMountStandCell`), and a hung fitting hovered on the ceiling slab,
// the floor, or a wall course resolves to the floor it hangs over
// (`ceilingMountStandCell`) — so the ghost and the committed piece sit on the
// surface, while the save keeps the floor anchor the envelopes read. Both snaps
// ask the station's own **基准高度** for the 4 m grid: a station whose grid is
// shifted by a metre must not anchor its decor to the fixed 0 / 4 / 8 lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ceilingMountHeight,
  ceilingMountMissing,
  ceilingMountStandCell,
  equipmentReason,
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
