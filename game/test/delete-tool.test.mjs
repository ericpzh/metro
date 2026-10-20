import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'
import { liftExtendedDown, liftExtendedUp, liftModule, liftWithDoorSide } from '../src/sim/lifts.ts'

function setup() {
  const z = -4
  const cells = Array.from({ length: 6 }, (_, x) => Array.from({ length: 6 }, (_, y) => ({ x, y, z, fill: 'solid' }))).flat()
  useStore.setState({
    tool: 'delete',
    station: toState({ name: 'dig', seed: 1, cells, modules: [], lines: [] }),
    past: [], future: [], selected: null,
  })
  const previews = []
  const scene = {
    setGhost: (ghost) => previews.push(ghost),
    setModulePreview() {}, setFencePreview() {}, setCollisionHighlight() {}, setCursor() {},
    // The level slice: a piece on a hidden storey is invisible, so it is neither
    // picked nor resolved from the cell (the state below is flipped per test).
    isModuleVisible: () => false,
  }
  const ctx = {
    scene: () => scene,
    drag: { current: null },
    pickModule: () => null,
    solids: () => new Set(useStore.getState().station.cells.filter((c) => c.fill === 'solid').map((c) => `${c.x},${c.y},${c.z}`)),
    showMeasure() {}, clearMeasure() {},
  }
  const event = (x, y, shiftKey = false) => ({
    clientX: x * 20, clientY: y * 20, button: 0, buttons: 1, shiftKey,
    hit: { cell: [x, y, -4], place: [x, y, -3], solid: true, point: [x + 0.5, y + 0.5] },
    preventDefault() {},
  })
  return { tool: new DeleteTool(ctx), drag: ctx.drag, previews, event, scene }
}

test('block deletion previews and commits a rectangle, while Shift keeps the drag diagonal', () => {
  const before = useStore.getState()
  try {
    const rectangle = setup()
    rectangle.tool.onDown(rectangle.event(1, 1))
    rectangle.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
    rectangle.tool.onMove(rectangle.event(3, 3))
    assert.equal(rectangle.previews.at(-1).length, 9, 'the preview shows all cells in the rectangle')
    rectangle.tool.onUp(rectangle.event(3, 3))
    assert.equal(useStore.getState().station.cells.filter((c) => c.fill === 'solid').length, 27)

    const diagonal = setup()
    diagonal.tool.onDown(diagonal.event(1, 1, true))
    diagonal.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
    diagonal.tool.onMove(diagonal.event(3, 3, true))
    assert.equal(diagonal.previews.at(-1).length, 3, 'Shift previews only the diagonal line')
    diagonal.tool.onUp(diagonal.event(3, 3, true))
    const remaining = useStore.getState().station.cells.filter((c) => c.fill === 'solid')
    assert.equal(remaining.length, 33)
    assert.deepEqual(remaining.some((c) => c.x === 2 && c.y === 1), true, 'off-line rectangle cells stay solid')
    assert.equal(useStore.getState().past.length, 1, 'the complete drag is one undo step')
  } finally {
    useStore.setState(before)
  }
})

test('delete starts a block deletion when the module on the cell is hidden by the level slice', () => {
  const before = useStore.getState()
  try {
    const fixture = setup()
    const hidden = createModule('tvm', 1, 1, -4, 'hidden-tvm')
    useStore.setState({ station: { ...useStore.getState().station, modules: [hidden] } })
    fixture.tool.onDown(fixture.event(1, 1))
    assert.equal(fixture.drag.current.modules, undefined, 'the pointer starts a floor deletion, not a module deletion')
    // The same press with the piece visible resolves it from the cell the pointer
    // is on: the fallback exists, and the slice is what gates it.
    fixture.drag.current = null
    fixture.scene.isModuleVisible = () => true
    fixture.tool.onDown(fixture.event(1, 1))
    assert.deepEqual(fixture.drag.current.modules, ['hidden-tvm'])
  } finally { useStore.setState(before) }
})

test('deleting a pointed top or bottom lift extension trims only that interval', () => {
  const before = useStore.getState()
  try {
    for (const [end, point, expectedFrom, expectedTo, expectedRises] of [
      ['top', [1.5, 1.5, 7], -3, 5, [3, 5]],
      ['bottom', [1.5, 1.5, -1], 0, 9, [5, 4]],
    ]) {
      const fixture = setup()
      let lift = liftModule({ x: 1, y: 1, z: 0 }, 0, `lift-${end}`, 5)
      lift = liftExtendedDown(lift, 3)
      lift = liftExtendedUp(lift, 4)
      lift = liftWithDoorSide(lift, -3, 'back')
      lift = liftWithDoorSide(lift, 5, 'both')
      useStore.setState({ station: { ...useStore.getState().station, modules: [lift] } })
      fixture.scene.pickModuleHit = () => ({ moduleId: lift.id, point })
      fixture.scene.isModuleVisible = () => true
      fixture.tool.onDown(fixture.event(1, 1))
      fixture.tool.onUp(fixture.event(1, 1))

      const kept = useStore.getState().station.modules.find((m) => m.id === lift.id)
      assert.ok(kept, `${end} extension leaves the shaft module in place`)
      assert.equal(kept.from.z, expectedFrom)
      assert.equal(kept.to.z, expectedTo)
      assert.deepEqual(kept.cfg.rises, expectedRises)
      assert.equal(useStore.getState().past.length, 1, 'trimming is one undoable edit')
      if (end === 'bottom') assert.equal(kept.cfg.doors?.['-3'], undefined, 'the removed bottom landing door is discarded')
      if (end === 'top') assert.equal(kept.cfg.doors?.['5'], undefined, 'the removed top landing door is discarded')
      useStore.setState(before)
    }
  } finally { useStore.setState(before) }
})

test('deleting the base or an interior lift interval still removes the whole shaft', () => {
  const before = useStore.getState()
  try {
    for (const point of [[1.5, 1.5, 2], [1.5, 1.5, 7]]) {
      const fixture = setup()
      let lift = liftModule({ x: 1, y: 1, z: 0 }, 0, 'lift-whole', 5)
      lift = liftExtendedDown(lift, 3)
      lift = liftExtendedUp(lift, 4)
      lift = liftExtendedUp(lift, 6)
      useStore.setState({ station: { ...useStore.getState().station, modules: [lift] } })
      fixture.scene.pickModuleHit = () => ({ moduleId: lift.id, point })
      fixture.scene.isModuleVisible = () => true
      fixture.tool.onDown(fixture.event(1, 1))
      fixture.tool.onUp(fixture.event(1, 1))
      assert.equal(useStore.getState().station.modules.some((m) => m.id === lift.id), false)
      assert.equal(useStore.getState().past.length, 1)
      useStore.setState(before)
    }
  } finally { useStore.setState(before) }
})

/** A paved street: six 人行道 tiles in a row, a 树木 two cells off the row. */
function paving() {
  const z = 0
  const cells = Array.from({ length: 9 }, (_, x) => Array.from({ length: 9 }, (_, y) => ({ x, y, z, fill: 'solid' }))).flat()
  const modules = []
  for (let x = 1; x <= 6; x++) modules.push(createModule('sidewalk', x, 2, z, `sidewalk-${x}`))
  modules.push(createModule('tree', 5, 5, z, 'tree-1'))
  useStore.setState({
    tool: 'delete',
    moduleType: 'sidewalk',
    station: toState({ name: 'paved', seed: 1, cells, modules, lines: [] }),
    past: [], future: [], selected: null, notice: '',
  })
  const previews = []
  const scene = {
    setGhost() {}, setFencePreview() {}, setCollisionHighlight() {}, setCursor() {},
    setModulePreview: (mods, blocked) => previews.push({
      ids: (Array.isArray(mods) ? mods : mods ? [mods] : []).map((m) => m.id),
      blocked,
    }),
  }
  const ref = (current = null) => ({ current })
  const drag = ref()
  // The scene pick is what the pointer's ray resolved; the cell under it is the
  // event's own `hit.cell`, exactly as the viewport computes them.
  const pick = { current: null }
  const ctx = {
    scene: () => scene,
    drag,
    hover: ref(),
    pickModule: () => pick.current,
    facing: () => undefined,
    solids: () => new Set(useStore.getState().station.cells.map((c) => `${c.x},${c.y},${c.z}`)),
    showMeasure() {}, clearMeasure() {},
  }
  const event = (x, y, button = 0) => ({
    clientX: x * 20, clientY: y * 20, button, buttons: button === 2 ? 2 : 1, shiftKey: false,
    hit: { cell: [x, y, z], place: [x, y, z + 1], solid: true, point: [x + 0.5, y + 0.5] },
    preventDefault() {},
  })
  const tileIds = () => useStore.getState().station.modules.filter((m) => m.type === 'sidewalk').map((m) => m.id)
  const voids = () => useStore.getState().station.cells.filter((c) => c.fill === 'void').length
  return { ctx, drag, previews, event, pick, tileIds, voids, deleteTool: new DeleteTool(ctx), tileTool: new EquipmentTool(ctx) }
}

test('删除 (B) deletes the 人行道 tile under the pointer when the ray lands on a tree beyond it', () => {
  const before = useStore.getState()
  try {
    // The pointer is on the paving at (2,2); the ray crosses the 树木's canopy,
    // which stands two cells away — the canopy must not steal the delete.
    const fixture = paving()
    fixture.pick.current = 'tree-1'
    fixture.deleteTool.onDown(fixture.event(2, 2))
    fixture.deleteTool.onUp(fixture.event(2, 2))
    const ids = useStore.getState().station.modules.map((m) => m.id)
    assert.ok(!ids.includes('sidewalk-2'), 'the pointed tile is the piece B removes')
    assert.ok(ids.includes('tree-1'), 'the tree the ray crossed is left standing')
    assert.equal(fixture.voids(), 0, 'a piece under the pointer is never dug away')
    assert.equal(useStore.getState().past.length, 1)
  } finally { useStore.setState(before) }
})

test('删除 (B) removes a paved tile the ray missed instead of digging the ground under it', () => {
  const before = useStore.getState()
  try {
    const fixture = paving()
    fixture.pick.current = null
    fixture.deleteTool.onMove(fixture.event(2, 2))
    const ghost = fixture.previews.at(-1)
    assert.equal(ghost.ids.join(), 'sidewalk-2', 'the ghost is the tile, not the floor block')
    assert.equal(ghost.blocked, true, 'and it wears the delete tool’s red treatment')
    fixture.deleteTool.onDown(fixture.event(2, 2))
    fixture.deleteTool.onUp(fixture.event(2, 2))
    assert.ok(!fixture.tileIds().includes('sidewalk-2'))
    assert.equal(fixture.voids(), 0, 'no hole is cut where the paving stood')
    assert.equal(useStore.getState().station.cells.length, 81, 'the street keeps every block')
  } finally { useStore.setState(before) }
})

test('删除 (B) and the tile tool right-click tear paving down identically, drag and tap alike', () => {
  const before = useStore.getState()
  try {
    for (const [label, dragIt] of [['tap', false], ['run', true]]) {
      const shape = () => useStore.getState().station.modules.map((m) => `${m.id}@${m.x},${m.y},${m.z}`).join('|')

      const viaB = paving()
      viaB.pick.current = 'tree-1'
      viaB.deleteTool.onDown(viaB.event(1, 2))
      if (dragIt) viaB.deleteTool.onMove(viaB.event(6, 2))
      viaB.deleteTool.onUp(viaB.event(6, 2))
      const underB = shape()
      const undoB = useStore.getState().past.length

      // The same press as the armed 人行道 tool's right-click: the reference the
      // delete tool has to match, cell for cell and commit for commit.
      const viaClick = paving()
      viaClick.pick.current = 'tree-1'
      viaClick.tileTool.onDown(viaClick.event(1, 2, 2))
      if (dragIt) viaClick.tileTool.onMove(viaClick.event(6, 2))
      viaClick.tileTool.onUp(viaClick.event(6, 2))
      const underClick = shape()
      const undoClick = useStore.getState().past.length

      assert.equal(underB, underClick, `${label}: B removes exactly what right-click removes`)
      assert.equal(undoB, undoClick, `${label}: one commit either way`)
      assert.equal(useStore.getState().station.cells.length, 81, `${label}: no street block is touched`)
    }
    assert.equal(useStore.getState().past.length, 1, 'a paved run is one undo step, not one per tile')
  } finally { useStore.setState(before) }
})
