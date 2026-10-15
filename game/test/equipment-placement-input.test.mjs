// Wall and ceiling mounts can be aimed from open air; floor equipment cannot.
//
// The same aim is what picks **which** wall a panel hangs on
// (`autofaceWallMount`), and the camera is what answers it — except for the two
// mounts bolted to a named piece of the document (a board on a booth header, and a
// 地面出入口 on the block face the pointer clicked), which keep the turn the pointer
// gave them. It also picks **which course** a 玻璃板 covers: that piece is cladding from
// its base, so it hangs over the course aimed at (`wallMountFollowsCourse`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { canPlaceWithoutFloorHit } from '../src/app/tools/placementInput.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { TactileTool } from '../src/app/tools/TactileTool.ts'
import { createModule, toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { exitBayCell } from '../src/sim/exits.ts'
import { STAIR_WIDTH_DOUBLE } from '../src/sim/stairs.ts'

test('tactile placement and floor-mark deletion pick once for large-document misses and late hits', () => {
  const before = useStore.getState()
  try {
    const modules = Array.from({ length: 1334 }, (_, index) => createModule('bench', index + 5000, 0, 0, `bench-${index}`))
    const station = toState({ name: 'pick count', seed: 1, cells: [], modules, lines: [] })
    for (const pickedId of [null, modules.at(-1).id]) {
      for (const moduleType of ['tactile-guide', 'floor-mark-arrow']) {
        useStore.setState({ station, past: [], future: [], tool: 'module', moduleType, moduleRot: 0 })
        let picks = 0
        const scene = { setGhost() {}, setModulePreview() {}, setCollisionHighlight() {}, setCursor() {} }
        const drag = { current: null }
        const ctx = { scene: () => scene, pickModule: () => { picks++; return pickedId }, drag, hover: { current: null } }
        const tool = moduleType === 'tactile-guide' ? new TactileTool(ctx) : new EquipmentTool(ctx)
        tool.onDown({ clientX: 10, clientY: 10, button: moduleType === 'tactile-guide' ? 0 : 2,
          hit: { cell: [0, 0, 0], place: [0, 0, 1], solid: true, point: [0.5, 0.5, 1] }, preventDefault() {} })
        assert.equal(picks, 1, `${moduleType} reuses one scene pick regardless of document search length`)
        assert.equal(useStore.getState().past.length, 0)
        if (moduleType === 'tactile-guide') assert.deepEqual(drag.current.anchor, [0, 0, 0])
      }
    }
  } finally { useStore.setState(before) }
})

test('exit snapping picks once when the selected stair is the last of 1334 modules', () => {
  const before = useStore.getState()
  try {
    const stair = createModule('stair-straight', -1, 40, -4, 'last-stair', 0, STAIR_WIDTH_DOUBLE)
    const modules = Array.from({ length: 1333 }, (_, index) => createModule('bench', index + 5000, 0, 0, `bench-${index}`))
    const station = toState({ name: 'exit pick count', seed: 1, cells: [], modules: [...modules, stair], lines: [] })
    useStore.setState({ station, tool: 'module', moduleType: 'exit-uncovered-2', moduleRot: 0 })
    let picks = 0, preview = null
    const tool = new EquipmentTool({
      scene: () => ({ setModulePreview(modules) { preview = modules?.[0] }, setCursor() {}, setCollisionHighlight() {} }),
      pickModule: () => { picks++; return stair.id }, hover: { current: null }, drag: { current: null },
    })
    tool.onMove({ clientX: 10, clientY: 10, button: 0, buttons: 1, hit: null, preventDefault() {} })
    assert.equal(picks, 1)
    assert.ok(preview)
    const upper = stair.from.z > stair.to.z ? stair.from : stair.to
    assert.deepEqual(exitBayCell(preview, 0), [upper.x, upper.y, upper.z])
  } finally { useStore.setState(before) }
})

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

test('an exit preview and click snap to the picked stair without a ground hit', () => {
  const before = useStore.getState()
  try {
    const stair = createModule('stair-straight', -1, 40, -4, 'stair-b', 0, STAIR_WIDTH_DOUBLE)
    assert.ok(stair)
    const state = toState({ name: 'exit snap', seed: 1, cells: [], modules: [stair], lines: [] })
    useStore.setState({ station: state, past: [], future: [], tool: 'module', moduleType: 'exit-uncovered-2', moduleRot: 3, selected: null })

    let preview = null
    let blocked = true
    const scene = {
      setModulePreview: (modules, refused) => { preview = modules?.[0] ?? null; blocked = refused },
      setCursor: () => {},
      setCollisionHighlight: () => {},
    }
    const tool = new EquipmentTool({
      scene: () => scene,
      pickModule: () => stair.id,
      hover: { current: null },
      drag: { current: null },
    })
    const pointer = { clientX: 10, clientY: 10, button: 0, buttons: 1, hit: null, preventDefault() {} }

    tool.onMove(pointer)
    assert.ok(preview)
    assert.equal(blocked, false, 'the exit can share the selected stair')
    const upper = stair.from.z > stair.to.z ? stair.from : stair.to
    assert.deepEqual(exitBayCell(preview, 0), [upper.x, upper.y, upper.z], 'the ghost bay follows the stair upper landing')
    assert.equal(preview.rot, 0, 'the exit faces down the stair')

    tool.onDown(pointer)
    const placed = useStore.getState().station.modules.find((module) => module.type === 'exit')
    assert.ok(placed)
    assert.deepEqual(exitBayCell(placed, 0), [upper.x, upper.y, upper.z], 'click places the previewed alignment')
    assert.equal(placed.rot, preview.rot)
  } finally {
    useStore.setState(before)
  }
})

test('an exit finds a stair through tread gaps when the pointer also hits the floor', () => {
  const before = useStore.getState()
  try {
    const stair = createModule('stair-straight', -1, 40, -4, 'stair-gap', 0, STAIR_WIDTH_DOUBLE)
    assert.ok(stair)
    const state = toState({ name: 'exit snap over tread gaps', seed: 1, cells: [], modules: [stair], lines: [] })
    useStore.setState({ station: state, past: [], future: [], tool: 'module', moduleType: 'exit-uncovered-2', moduleRot: 3, selected: null })

    let preview = null
    let blocked = true
    const scene = {
      pickModuleInBounds: (_x, _y, ids) => ids.has(stair.id) ? stair.id : null,
      setModulePreview: (modules, refused) => { preview = modules?.[0] ?? null; blocked = refused },
      setFencePreview: () => {},
      setCursor: () => {},
      setCollisionHighlight: () => {},
    }
    const tool = new EquipmentTool({
      scene: () => scene,
      pickModule: () => null, // the exact ray falls between the stair's separated treads
      hover: { current: null },
      drag: { current: null },
    })
    const pointer = {
      clientX: 10, clientY: 10, button: 0, buttons: 1,
      hit: { cell: [-1, 46, 0], place: [-1, 46, 0], solid: true, point: [-0.5, 46.5, 1] },
      preventDefault() {},
    }

    tool.onMove(pointer)
    assert.ok(preview, 'the hover resolves the stair despite the floor hit')
    assert.equal(blocked, false)
    const upper = stair.from.z > stair.to.z ? stair.from : stair.to
    assert.deepEqual(exitBayCell(preview, 0), [upper.x, upper.y, upper.z])

    tool.onDown(pointer)
    const placed = useStore.getState().station.modules.find((module) => module.type === 'exit')
    assert.ok(placed)
    assert.deepEqual(exitBayCell(placed, 0), [upper.x, upper.y, upper.z], 'placement follows the bounded ramp pick, not the floor tile')
  } finally {
    useStore.setState(before)
  }
})

test('a 玻璃板 aimed at a wall hangs on that course, where a poster keeps its band', () => {
  // The reported case: aiming at one block of a wall gave a 1×1 广告牌 its band at the
  // storey floor (its lightbox 1.6 m up) while the 玻璃板 was drawn as floor cladding —
  // "one course lower". A 玻璃板 is **cladding from its base**, so it hangs over the
  // course the pointer is on: aim at the wall's second course and the pane covers the
  // second course. A piece drawn at its own `panelZ` keeps the storey floor.
  const cells = [
    { x: 0, y: 0, z: 5, fill: 'solid' }, // the room floor: the storey is the one at 5
    { x: 0, y: 1, z: 6, fill: 'solid' }, // the wall's first course
    { x: 0, y: 1, z: 7, fill: 'solid' }, // the course aimed at, covered by…
    { x: 0, y: 1, z: 8, fill: 'solid' }, // …the next one up
  ]
  const before = useStore.getState()
  try {
    let ghost = null
    let refused = null
    const scene = {
      setModulePreview: (mods, blocked) => { ghost = Array.isArray(mods) ? mods[0] : mods; refused = blocked },
      setCursor: () => {},
      setCollisionHighlight: () => {},
    }
    const tool = new EquipmentTool({
      scene: () => scene,
      facing: () => [0, -1], // the eye south of the piece: the view looks north, at the wall
      hover: { current: { cell: [0, 1, 7], place: [0, 0, 7], solid: true, point: [0.5, 1] } },
      drag: { current: null },
    })
    useStore.setState({
      station: toState({ name: 'aim', seed: 1, levelBase: 1, cells, modules: [], lines: [] }),
      tool: 'module',
      moduleType: 'glass-1x1',
      moduleRot: 0,
    })
    tool.refreshHover()
    assert.equal(refused, false, 'the pane hangs on the block that was aimed at')
    assert.deepEqual([ghost.x, ghost.y, ghost.z], [0, 0, 6], 'over the course that was clicked, one cell below it')
    assert.equal(ghost.rot, 2, 'and on the wall the camera is looking at')
    // The same hover with a 广告牌: its lightbox is drawn at its own height, so it keeps
    // the storey floor as its anchor — the band a poster always hangs at.
    useStore.setState({ moduleType: 'billboard-wide' })
    tool.refreshHover()
    assert.deepEqual([ghost.x, ghost.y, ghost.z], [0, 0, 5], 'the poster keeps its own band at the storey floor')
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
