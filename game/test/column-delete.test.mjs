import test from 'node:test'
import assert from 'node:assert/strict'
import { addWalls, removeCells, storeyColumnsAt, storeyWallRun, toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { WallTool } from '../src/app/tools/WallTool.ts'
import { ownsContextMenu } from '../src/app/tools/geometry/pointer.ts'
import { readFileSync } from 'node:fs'

const block = (x, y, z, tags) => ({ x, y, z, fill: 'solid', ...(tags ? { tags } : {}) })
const station = (cells, levelBase = 0) => toState({ name: 'columns', seed: 1, cells, modules: [], lines: [], levelBase })
const heights = (cells) => cells.map(([, , z]) => z).sort((a, b) => a - b)

test('G clears only the -15..-11 story when hit at -13', () => {
  const st = station([
    ...[-16, -15, -14, -13, -12, -11, -10].map((z) => block(2, 3, z, z === -14 ? ['wall'] : undefined)),
    block(3, 3, -13),
  ])
  const remove = storeyColumnsAt(st, [[2, 3, -13]])
  assert.deepEqual(heights(remove), [-15, -14, -13, -12, -11])
  assert.deepEqual(removeCells(st, remove).cells.map(({ x, y, z }) => [x, y, z]), [[2, 3, -16], [2, 3, -10], [3, 3, -13]])
})

test('G includes separated blocks across gaps and excludes void records', () => {
  const st = station([block(2, 3, -14), { x: 2, y: 3, z: -13, fill: 'void' }, block(2, 3, -10, ['auto-wall'])])
  assert.deepEqual(heights(storeyColumnsAt(st, [[2, 3, -12]])), [-14])
})

test('G follows every height basis at negative storey boundaries', () => {
  for (const base of [0, 1, 2, 3, 4]) {
    const bottom = -15 + base
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

test('G at +1 removes blocks in the 0..4 story and leaves the next story', () => {
  const st = station([block(2, 3, 0), ...[1, 2, 3, 4, 5, 6].map((z) => block(2, 3, z))])
  const remove = storeyColumnsAt(st, [[2, 3, 1]])
  assert.deepEqual(heights(remove), [0, 1, 2, 3, 4])
  const next = removeCells(st, remove)
  assert.deepEqual(next.cells.filter((c) => c.fill === 'solid').map((c) => c.z), [5, 6])
  assert.deepEqual(heights(storeyColumnsAt(st, [[2, 3, 4]])), [0, 1, 2, 3, 4], 'the boundary block belongs to the next story')
  assert.deepEqual(storeyColumnsAt(next, [[2, 3, 1]]), [])
  const virtual = station([block(2, 3, 1), block(2, 3, 4)])
  assert.deepEqual(heights(storeyColumnsAt(virtual, [[2, 3, 1]])), [0, 1, 4], 'the implicit street block is in the selected story')
})

test('G right-click and drag preview the blocks that release removes in one commit', () => {
  const before = useStore.getState()
  try {
    for (const [base, dragRun] of [[0, false], [0, true], [2, false], [2, true]]) {
      const st = station([block(2, 3, -15 + base), block(2, 3, -13 + base), block(3, 3, -12 + base), block(2, 3, -10 + base)], base)
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
        hit: { cell: [x, 3, -13 + base], place: [x + 1, 3, -13 + base], solid: true, point: [x, 3, -13 + base] },
      })
      tool.onDown(press(2))
      // Chrome/Windows dispatches contextmenu while the right button is down.
      assert.equal(ownsContextMenu(ctx.drag.current, 2), true)
      assert.equal(cursorValid, true, 'erasure is available on a plain F block')
      if (dragRun) {
        ctx.drag.current.downTime -= 1000
        tool.onMove(press(3, 100))
      }
      const expected = dragRun ? [[2, 3, -15 + base], [2, 3, -13 + base], [3, 3, -12 + base]] : [[2, 3, -15 + base], [2, 3, -13 + base]]
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

test('G placement and erasure stay within the bottom block story at each basis', () => {
  for (const base of [0, 1, 2, 3, 4]) {
    for (const start of [-4 + base, -3 + base]) {
      const st = station([block(2, 3, -6 + base), block(2, 3, base)], base)
      const expected = Array.from({ length: base - start }, (_, i) => start + i)
      const preview = storeyWallRun([[2, 3, start]], base, st.storeyHeight)
      assert.deepEqual(heights(preview), expected)
      const placed = addWalls(st, [[2, 3, start]]).state
      const erased = base > 0 && !expected.includes(0) ? [...expected, 0].sort((a, b) => a - b) : expected
      assert.deepEqual(heights(storeyColumnsAt(placed, [[2, 3, start]])), erased)
      const remaining = removeCells(placed, storeyColumnsAt(placed, [[2, 3, start]])).cells.filter(c => c.fill === 'solid')
      assert.deepEqual(remaining, st.cells)
    }
  }
})


test('G hover, press and drag previews agree with the committed story-bounded wall', () => {
  const before = useStore.getState()
  try {
    for (const [base, start, dragRun] of [[0, -4, false], [0, -3, true], [2, -2, true]]) {
      const st = station([block(2, 3, base - 6), block(2, 3, base), block(3, 3, base),
        ...(base > 0 ? [2, 3].map(x => ({ x, y: 3, z: 0, fill: 'void' })) : [])], base)
      let ghost = []
      let commits = 0
      useStore.setState({ station: st, tool: 'wall', wallSnapCycle: 0, commit: next => {
        commits++
        useStore.setState({ station: next })
      } })
      const scene = {
        setGhost: (cells, mode) => { if (mode === 'add') ghost = cells },
        setCursor() {}, setCollisionHighlight() {}, setModulePreview() {}, setFencePreview() {},
      }
      const ctx = { drag: { current: null }, scene: () => scene }
      const tool = new WallTool(ctx)
      const event = (x, clientX = 0) => ({
        button: 0, clientX, clientY: 0, shiftKey: false, preventDefault() {},
        hit: { cell: [x, 3, start], place: [x, 3, start], solid: false, point: [x, 3, start] },
      })
      const first = Array.from({ length: base - start }, (_, i) => [2, 3, start + i])
      tool.onMove(event(2))
      assert.deepEqual(ghost, first, 'hover stops at the story boundary')
      tool.onDown(event(2))
      assert.deepEqual(ghost, first, 'press retains the same candidates')
      if (dragRun) {
        ctx.drag.current.downTime -= 1000
        tool.onMove(event(3, 100))
        tool.multiPlace.flushPreview()
      }
      const expected = dragRun ? [...first, ...first.map(([, y, z]) => [3, y, z])] : first
      assert.deepEqual(ghost, expected, 'drag previews exactly the selected story')
      tool.onUp(dragRun ? event(3, 100) : event(2))
      assert.equal(commits, 1)
      const placed = useStore.getState().station.cells.filter(c => c.tags?.includes('wall')).map(c => [c.x, c.y, c.z])
      const byCoordinate = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
      assert.deepEqual(placed.sort(byCoordinate), expected.sort(byCoordinate), 'release commits the preview and leaves the adjacent story intact')
      for (const outside of st.cells.filter(c => c.fill === 'solid')) assert.ok(useStore.getState().station.cells.includes(outside))
    }
  } finally {
    useStore.setState(before)
  }
})

test('G story boundaries assign every course to exactly one story on either side of grade', () => {
  for (const base of [0, 1, 2, 3, 4]) for (const band of [-10 + base, 5 + base]) {
    const cells = Array.from({ length: 7 }, (_, i) => block(8, 8, band - 1 + i))
    const st = station([...cells, { x: 8, y: 8, z: 0, fill: 'void' }], base)
    for (let start = band; start < band + 5; start++) {
      const expected = Array.from({ length: band + 5 - start }, (_, i) => start + i)
      assert.deepEqual(heights(storeyWallRun([[8, 8, start]], base)), expected)
      assert.deepEqual(heights(storeyColumnsAt(st, [[8, 8, start]])), [band, band + 1, band + 2, band + 3, band + 4])
    }
    assert.deepEqual(heights(storeyColumnsAt(st, [[8, 8, band - 1]])), [band - 1])
    assert.deepEqual(heights(storeyColumnsAt(st, [[8, 8, band + 5]])), [band + 5])
  }
})
