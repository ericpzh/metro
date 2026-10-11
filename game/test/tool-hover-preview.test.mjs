import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { useStore } from '../src/app/store.ts'
import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
import { MoveController } from '../src/app/tools/MoveController.ts'
import { PickTool } from '../src/app/tools/PickTool.ts'
import { SelectTool } from '../src/app/tools/SelectTool.ts'

const hit = { cell: [0, 0, 0], place: [0, 0, 1], solid: true, point: [0.5, 0.5] }

function fixture() {
  const module = createModule('tvm', 0, 0, 0, 'hover-target')
  useStore.setState({ station: { ...toState(emptyStation()), modules: [module] }, moveDraft: null, selected: null })
  const previews = []
  const scene = {
    setHoverHighlight() {},
    setModulePreview: (...args) => previews.push(args),
    setCollisionHighlight() {},
    setCursor() {},
    setGhost() {},
    setFencePreview() {},
  }
  const ref = (current = null) => ({ current })
  const ctx = {
    scene: () => scene,
    pickModule: () => module.id,
    pick: () => hit,
    facing: () => undefined,
    solids: () => new Set(),
    thins: () => new Map(),
    hover: ref(),
    drag: ref(),
    paint: ref(),
    zoneDrag: ref(),
    facilityDrag: ref(),
    showMeasure() {},
    clearMeasure() {},
  }
  const pointer = { clientX: 10, clientY: 10, button: 0, buttons: 0, shiftKey: false, hit, preventDefault() {} }
  return { module, previews, ctx, pointer }
}

test('move, picker and select hover previews tint the target blue; bulldoze previews it red', () => {
  const before = useStore.getState()
  try {
    for (const Tool of [MoveController, PickTool, SelectTool]) {
      const f = fixture()
      new Tool(f.ctx).onMove(f.pointer)
      assert.deepEqual(f.previews.at(-1), [f.module, false, 0x168cff], `${Tool.name} uses the blue equipment preview`)
    }

    const f = fixture()
    useStore.setState({ tool: 'delete' })
    new DeleteTool(f.ctx).onMove(f.pointer)
    assert.deepEqual(f.previews.at(-1), [f.module, true], 'bulldoze keeps the red blocked-preview treatment')
  } finally {
    useStore.setState(before)
  }
})
