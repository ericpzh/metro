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

test('a 玻璃幕墙 and a 玻璃板 aimed at one wall land in one cell, in front of it', () => {
  // The reported shape of the bug: the same wall gave one cell for a poster and a
  // course-lower one for a 玻璃, because a **floor-standing** piece took the block it
  // was pointed at as its floor — standing *inside* the wall at whatever course the
  // pointer crossed — while a wall-mounted panel stood in front of the face. One
  // hover, one answer now: the wall the ghost is aimed at has one cell in front of it.
  const cells = [
    { x: 0, y: 0, z: 5, fill: 'solid' }, // the storey floor
    { x: 0, y: 1, z: 6, fill: 'solid' }, // the wall mass, first course
    { x: 0, y: 1, z: 7, fill: 'solid' }, // covered above: a wall course, not a floor
  ]
  const station = toState({ name: 'aim', seed: 1, levelBase: 1, cells, modules: [], lines: [] })
  const before = useStore.getState()
  try {
    let ghost = null
    const scene = {
      setModulePreview: (mods) => { ghost = Array.isArray(mods) ? mods[0] : mods },
      setCursor: () => {},
      setCollisionHighlight: () => {},
    }
    const ctx = {
      scene: () => scene,
      facing: () => [0, -1], // the eye south of the piece: the view looks north, at the wall
      hover: { current: { cell: [0, 1, 6], place: [0, 0, 6], solid: true, point: [0.5, 1] } },
      drag: { current: null },
    }
    const tool = new EquipmentTool(ctx)
    useStore.setState({ station, tool: 'module', moduleType: 'curtain-wall', curtainWidth: 1, curtainHeight: 4, moduleRot: 0 })
    tool.refreshHover()
    assert.deepEqual([ghost.x, ghost.y, ghost.z], [0, 0, 5], 'the 幕墙 stands in front of the wall, on the storey floor')
    assert.equal(ghost.type, 'glass', 'and it is still the floor-standing piece the tile names')
    // The wall panel on that same hover takes the same cell.
    useStore.setState({ moduleType: 'glass-1x1' })
    tool.refreshHover()
    assert.deepEqual([ghost.x, ghost.y, ghost.z], [0, 0, 5], 'and the wall-mounted 玻璃板 joins it there')
  } finally {
    useStore.setState(before)
  }
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
