import test from 'node:test'
import assert from 'node:assert/strict'
import { toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'

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
  return { tool: new DeleteTool(ctx), drag: ctx.drag, previews, event }
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
