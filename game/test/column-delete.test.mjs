import test from 'node:test'
import assert from 'node:assert/strict'
import { removeCells, storeyColumnsAt, toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { WallTool } from '../src/app/tools/WallTool.ts'
import { ownsContextMenu } from '../src/app/tools/geometry/pointer.ts'
import { readFileSync } from 'node:fs'

const block = (x, y, z, tags) => ({ x, y, z, fill: 'solid', ...(tags ? { tags } : {}) })
const station = (cells, levelBase = 0) => toState({ name: 'columns', seed: 1, cells, modules: [], lines: [], levelBase })
const heights = (cells) => cells.map(([, , z]) => z).sort((a, b) => a - b)

test('G clears the -14..-10 wall and ceiling above the -15 floor when hit at -13', () => {
  const st = station([
    ...[-16, -15, -14, -13, -12, -11, -10].map((z) => block(2, 3, z, z === -14 ? ['wall'] : undefined)),
    block(3, 3, -13),
  ])
  const remove = storeyColumnsAt(st, [[2, 3, -13]])
  assert.deepEqual(heights(remove), [-14, -13, -12, -11, -10])
  assert.deepEqual(removeCells(st, remove).cells.map(({ x, y, z }) => [x, y, z]), [[2, 3, -16], [2, 3, -15], [3, 3, -13]])
})

test('G includes separated blocks across gaps and excludes void records', () => {
  const st = station([block(2, 3, -14), { x: 2, y: 3, z: -13, fill: 'void' }, block(2, 3, -10, ['auto-wall'])])
  assert.deepEqual(heights(storeyColumnsAt(st, [[2, 3, -12]])), [-14, -10])
})

test('G follows every height basis at negative storey boundaries', () => {
  for (const base of [0, 1, 2, 3]) {
    const bottom = -14 + base
    const st = station(Array.from({ length: 7 }, (_, i) => block(2, 3, bottom - 1 + i)), base)
    for (let hit = bottom; hit < bottom + 5; hit++) {
      assert.deepEqual(heights(storeyColumnsAt(st, [[2, 3, hit]])), [bottom, bottom + 1, bottom + 2, bottom + 3, bottom + 4])
    }
    assert.deepEqual(heights(storeyColumnsAt(st, [[2, 3, bottom + 5]])), [bottom + 5])
  }
})

test('G drag clears every selected column once, including sparse columns without a block at the drag height', () => {
  const st = station([block(2, 3, -13), block(3, 3, -14), block(3, 3, -12), block(4, 3, -13)])
  assert.deepEqual(storeyColumnsAt(st, [[2, 3, -13], [3, 3, -13], [2, 3, -12]]), [[2, 3, -13], [3, 3, -14], [3, 3, -12]])
  assert.deepEqual(storeyColumnsAt(st, [[9, 9, -13]]), [])
})

test('G at +1 removes the wall and ceiling while preserving the floor', () => {
  const st = station([block(2, 3, 0), ...[1, 2, 3, 4, 5, 6].map((z) => block(2, 3, z))])
  const remove = storeyColumnsAt(st, [[2, 3, 1]])
  assert.deepEqual(heights(remove), [1, 2, 3, 4, 5])
  const next = removeCells(st, remove)
  assert.deepEqual(next.cells.map((c) => c.z), [0, 6])
  assert.deepEqual(heights(storeyColumnsAt(st, [[2, 3, 4]])), [1, 2, 3, 4, 5], 'the ceiling belongs to the wall below')
  assert.deepEqual(storeyColumnsAt(next, [[2, 3, 1]]), [])
  const virtual = station([block(2, 3, 1), block(2, 3, 4)])
  assert.deepEqual(heights(storeyColumnsAt(virtual, [[2, 3, 1]])), [1, 4], 'the implicit street floor is preserved too')
})

test('G right-click and drag preview the blocks that release removes in one commit', () => {
  const before = useStore.getState()
  try {
    for (const dragRun of [false, true]) {
      const st = station([block(2, 3, -15), block(2, 3, -13), block(3, 3, -12), block(2, 3, -10)])
      let preview = []
      let cursorValid = false
      let commits = 0
      useStore.setState({ station: st, tool: 'wall', commit: (next) => {
        commits++
        useStore.setState({ station: next })
      } })
      const ctx = {
        drag: { current: null },
        scene: () => ({
          setGhost: (cells, mode) => { if (mode === 'remove') preview = cells },
          setCursor: (_cell, valid) => { cursorValid = valid },
          setModulePreview() {}, setFencePreview() {}, setCollisionHighlight() {},
        }),
      }
      const tool = new WallTool(ctx)
      const press = (x, clientX = 0) => ({
        button: 2, clientX, clientY: 0, shiftKey: false, preventDefault() {},
        hit: { cell: [x, 3, -13], place: [x + 1, 3, -13], solid: true, point: [x, 3, -13] },
      })
      tool.onDown(press(2))
      // Chrome/Windows dispatches contextmenu while the right button is down.
      assert.equal(ownsContextMenu(ctx.drag.current, 2), true)
      assert.equal(cursorValid, true, 'erasure is available on a plain F block')
      if (dragRun) {
        ctx.drag.current.downTime -= 1000
        tool.onMove(press(3, 100))
      }
      const expected = dragRun ? [[2, 3, -13], [3, 3, -12], [2, 3, -10]] : [[2, 3, -13], [2, 3, -10]]
      assert.deepEqual(preview, expected)
      assert.equal(cursorValid, true)
      tool.onUp(dragRun ? press(3, 100) : press(2))
      assert.equal(commits, 1, 'the whole column/run is a single undoable edit')
      assert.deepEqual(useStore.getState().station.cells, removeCells(st, expected).cells)
    }
  } finally {
    useStore.setState(before)
  }
})

test('native contextmenu preserves a right erase but still cancels a competing left drag', () => {
  assert.equal(ownsContextMenu({ active: true, button: 2 }, 2), true)
  assert.equal(ownsContextMenu({ active: true, button: 2 }, 0), true, 'menu can also arrive at right-up')
  assert.equal(ownsContextMenu({ active: true, button: 2 }, 3), false)
  assert.equal(ownsContextMenu({ active: true, button: 0 }, 2), false)
  assert.equal(ownsContextMenu({ active: false, button: 2 }, 2), false)
  assert.equal(ownsContextMenu(null, 2), false)
  const viewport = readFileSync(new URL('../src/app/Viewport.tsx', import.meta.url), 'utf8')
  assert.match(viewport, /zoneDragRef\.current\?\.active === true[\s\S]*?ownsContextMenu\(activeDrag, e\.buttons\)/, 'the viewport gives an active right-button zone erase the same native-menu protection')
})
