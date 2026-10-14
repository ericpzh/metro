// Wall and ceiling mounts can be aimed from open air; floor equipment cannot.
//
// The same aim is what picks **which** wall a panel hangs on
// (`autofaceWallMount`), and the camera is what answers it — except for the two
// mounts bolted to a named piece of the document (a board on a booth header, and a
// 地面出入口 on the block face the pointer clicked), which keep the turn the pointer
// gave them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { canPlaceWithoutFloorHit } from '../src/app/tools/placementInput.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'

test('wall-mounted poster and glass tiles reach the backing-wall verdict from open air', () => {
  assert.equal(canPlaceWithoutFloorHit('billboard-wide'), true)
  assert.equal(canPlaceWithoutFloorHit('glass-1x1'), true)
  assert.equal(canPlaceWithoutFloorHit('sign-wall'), true)
})

test('ceiling-mounted tiles reach the ceiling verdict from open air', () => {
  assert.equal(canPlaceWithoutFloorHit('tv'), true)
  assert.equal(canPlaceWithoutFloorHit('sign-ceiling'), true)
})

test('floor-standing equipment still requires a solid floor hit', () => {
  assert.equal(canPlaceWithoutFloorHit('bench-steel'), false)
  assert.equal(canPlaceWithoutFloorHit('door'), false)
  assert.equal(canPlaceWithoutFloorHit('linemap-stand'), false)
})

test('an aimed 地面出入口 keeps the block face the pointer clicked, whatever the camera says', () => {
  // A 地面出入口 is a shallow sign on the **block face under the pointer**, and its own
  // `cfg.mountZ` names that course: its turn is the pointer's answer. The wall search
  // is otherwise the camera's, and it would happily re-aim the panel at the block on
  // the other side of the tile — which is the wall the view happens to prefer here.
  const before = useStore.getState()
  try {
    const cells = [
      { x: 0, y: 0, z: 0, fill: 'solid' }, // the tile the two pieces stand on
      { x: 0, y: 1, z: 0, fill: 'solid' }, // the block face the pointer is on: the exit's mount, rot 2's wall
      { x: 1, y: 0, z: 1, fill: 'solid' }, // a wall course the camera prefers: rot 1's wall
      { x: 0, y: 1, z: 1, fill: 'solid' }, // and the wall above the block the pointer is on
    ]
    useStore.setState({
      station: toState({ name: 'aim', seed: 1, cells, modules: [], lines: [] }),
      moduleType: 'exit-doorway-1',
      moduleRot: 0,
    })
    // The eye is west of the piece, so the view looks east, at the rot-1 block.
    const tool = new EquipmentTool({ facing: () => [-1, 0], scene: () => null })
    const aimed = tool.wallMountPlacement([0, 1, 0], [0, 0, 0], 'e1', [0.5, 1])
    assert.equal(aimed.noWall, false)
    assert.equal(aimed.mod.rot, 2, 'the aimed block face, not the wall the camera faces')
    assert.equal(aimed.mod.cfg.mountZ, 0, 'and the course its block is on')
    // A wall panel on the same hover takes the camera's wall instead — the search is
    // the camera's whenever the pointer did not aim at a named block.
    useStore.setState({ moduleType: 'glass-1x1' })
    const panel = tool.wallMountPlacement([0, 1, 0], [0, 0, 0], 'g1', [0.5, 1])
    assert.equal(panel.mod.rot, 1, 'the east wall, which the camera is looking at')
  } finally {
    useStore.setState(before)
  }
})
