import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { useStore } from '../src/app/store.ts'
import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
import { MoveController } from '../src/app/tools/MoveController.ts'
import { PickTool } from '../src/app/tools/PickTool.ts'
import { SelectTool } from '../src/app/tools/SelectTool.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'

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

test('select hover marks the cell that a click selects, not the adjacent placement cell', () => {
  const before = useStore.getState()
  try {
    const f = fixture()
    f.ctx.pickModule = () => null
    const cursors = []
    f.ctx.scene().setCursor = (...args) => cursors.push(args)
    const tool = new SelectTool(f.ctx)
    for (const target of [
      { cell: [2, 3, -1], place: [2, 3, 0], solid: true },
      { cell: [2, 3, -1], place: [3, 3, -1], solid: true },
      { cell: [2, 3, 0], place: [2, 3, 0], solid: false },
    ]) {
      tool.onMove({ ...f.pointer, hit: target })
      assert.deepEqual(cursors.at(-1), [target.cell, true])
    }
  } finally {
    useStore.setState(before)
  }
})

test('pick hover highlights the hit wall/block itself instead of a flat tile on the adjacent cell', () => {
  const before = useStore.getState()
  try {
    const f = fixture()
    f.ctx.pickModule = () => null
    const cursors = []
    const ghosts = []
    f.ctx.scene().setCursor = (...args) => cursors.push(args)
    f.ctx.scene().setGhost = (...args) => ghosts.push(args)
    const tool = new PickTool(f.ctx)

    // Vertical wall hit: highlights wall block [2, 3, 1] itself in blue and suppresses flat cursor ring.
    tool.onMove({ ...f.pointer, hit: { cell: [2, 3, 1], place: [2, 2, 1], solid: true } })
    assert.deepEqual(ghosts.at(-1), [[[2, 3, 1]], 'remove', 0x168cff])
    assert.deepEqual(cursors.at(-1), [null])

    // Horizontal work-plane hit: clears block ghost and shows flat grid cursor on the work plane.
    tool.onMove({ ...f.pointer, hit: { cell: [4, 5, 0], place: [4, 5, 0], solid: false } })
    assert.deepEqual(ghosts.at(-1), [[], 'remove'])
    assert.deepEqual(cursors.at(-1), [[4, 5, 0], true])
  } finally {
    useStore.setState(before)
  }
})

test('equipment settings refresh cannot restore a stair-block preview after switching to 方块', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ station: toState(emptyStation()), tool: 'block', moduleType: 'stair-block' })
    const previews = []
    const scene = { setModulePreview: (...args) => previews.push(args), setGhost() {}, setCollisionHighlight() {}, setCursor() {} }
    const ctx = {
      scene: () => scene,
      hover: { current: { cell: [0, 0, 0], place: [0, 0, 1], solid: true } },
      drag: { current: null },
    }
    new EquipmentTool(ctx).refreshHover()
    assert.deepEqual(previews, [], 'shared placement-setting changes must not redraw an inactive equipment ghost')
  } finally {
    useStore.setState(before)
  }
})
