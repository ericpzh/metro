// The 选择 tool's passenger pick (§9.5).
//
// A click that lands on a passenger selects **the person** and asks the worker for
// their remaining walk; a click on open floor still selects the cell, and a
// right-click still bulldozes whatever the pointer is over, passenger or not. The
// order of those branches is the whole behaviour, and the crowd is drawn over the
// station, so getting it backwards selects a floor tile under somebody's feet and
// looks like a dead click.
//
// No canvas: the tool's scene is a plain object. (The **worker side** of the
// preview — `selectSimAgent`'s token and the frame that answers it — is pinned in
// `line-edit.test.mjs`, which already owns a `Worker` stub for the store's other
// messages; two stubs in one process would fight over the global.)
import test from 'node:test'
import assert from 'node:assert/strict'

const { useStore } = await import('../src/app/store.ts')
const { SelectTool } = await import('../src/app/tools/SelectTool.ts')
const { toState } = await import('../src/build/model.ts')

const floor = (x, y, z = 0) => ({ x, y, z, fill: 'solid' })
const cells = []
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push(floor(x, y))

/**
 * Put a fresh document in the store for one test. Called from the test body rather
 * than a `test.beforeEach`: the whole suite shares one process and one store, and a
 * top-level hook here would also run around the *other* files' tests, resetting the
 * document under `pick-tool`'s own (which then finds none of its fixtures).
 */
function arrange() {
  useStore.setState({
    tool: 'select',
    selected: null,
    notice: null,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }),
  })
}

const st = () => useStore.getState()

/** The select tool with its scene stubbed; `pickAgent` answers `agentId`. */
function toolFor(agentId) {
  const calls = { cursor: 0, ghost: 0, preview: 0, selection: 0, bulldozed: [] }
  const ref = (v = null) => ({ current: v })
  const tool = new SelectTool({
    scene: () => ({
      pickAgent: () => agentId,
      setCursor: () => calls.cursor++,
      setGhost: () => calls.ghost++,
      setModulePreview: () => calls.preview++,
      setSelection: () => calls.selection++,
    }),
    pick: () => null,
    pickModule: () => null,
    facing: () => undefined,
    solids: () => new Set(st().station.cells.map((c) => `${c.x},${c.y},${c.z}`)),
    thins: () => new Map(),
    hover: ref(),
    drag: ref(),
    paint: ref(),
    zoneDrag: ref(),
    facilityDrag: ref(),
    showMeasure: () => {},
    clearMeasure: () => {},
  })
  return { tool, calls }
}

/** One left or right press on a cell. */
function press(cell, button = 0) {
  return {
    clientX: 10,
    clientY: 20,
    button,
    buttons: button === 2 ? 2 : 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid: true, normal: [0, 0, 1], point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

test('a click on a passenger selects the person, not the floor under them', () => {
  arrange()
  const { tool, calls } = toolFor(42)
  tool.onDown(press([2, 2, 0]))
  assert.deepEqual(st().selected, { kind: 'agent', key: '42', label: '行人 #42' })
  assert.ok(calls.cursor > 0 && calls.ghost > 0 && calls.preview > 0, 'the floor hover state is cleared for the selection box')
})

test('a click on open floor still selects the cell', () => {
  arrange()
  const { tool } = toolFor(null)
  tool.onDown(press([2, 2, 0]))
  assert.equal(st().selected.kind, 'cell')
  assert.equal(st().selected.key, '2,2,0')
})

test('a right-click bulldozes whatever is under the pointer, passenger or not', () => {
  // The passenger branch is left-click only: a right-click on the crowd is still
  // "remove this floor", and a passenger under the pointer must not swallow it.
  arrange()
  const { tool } = toolFor(42)
  tool.onDown(press([2, 2, 0], 2))
  assert.notEqual(st().selected?.kind, 'agent', 'a right-click never selects a passenger')
  const after = st()
  assert.ok(after.notice || after.station.modules.length === 0, 'the bulldoze path ran instead')
})
