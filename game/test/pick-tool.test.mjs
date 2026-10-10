// The 吸取 picker (工具栏, `P`): clicking a placed piece arms the placement
// with that exact variant — and its rotation / escalator direction / 闸机 door —
// selects the instance, and hands the left rail to the folder that owns it (by
// switching to that tool). Clicking a bare face lifts its finish into the 材质
// brush instead. The rail's tiles only call these store commands through the
// tool, so driving `PickTool.onDown` with a stubbed context covers the click.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toState, addWalls, createModule, paintFace, thinWallSideMap } from '../src/build/model.ts'
import { pickCells } from '../src/render/pickCell.ts'
import { settleSignBoards, signBoardsOf } from '../src/sim/sign.ts'
import { useStore } from '../src/app/store.ts'
import { PickTool } from '../src/app/tools/PickTool.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { STAIR_WIDTH_NARROW } from '../src/sim/stairs.ts'
import { escalatorModule } from '../src/sim/escalators.ts'

test('picking short or long escalators copies length and Esc restores it', () => {
  const before = useStore.getState()
  try {
    for (const long of [false, true]) {
      const m = escalatorModule({ x: 0, y: 0, z: -8 }, 2, 'down', 'picked-escalator', 2, long)
      useStore.setState({ station: { ...toState(emptyStation()), modules: [m] }, escalatorLong: !long })
      ctxFor(m.id).onDown(press([0, 0, -8]))
      assert.equal(useStore.getState().escalatorLong, long)
      assert.equal(useStore.getState().escalatorWide, true)
      assert.equal(useStore.getState().escalatorDir, 'down')
      useStore.getState().cancelPick()
      assert.equal(useStore.getState().escalatorLong, !long)
    }
  } finally {
    useStore.setState(before)
  }
})

test('picking a pillar copies its section length and Esc restores the chosen length', () => {
  const before = useStore.getState()
  try {
    for (const height of [2, 4, 8]) {
      const m = createModule('pillar-slim', 0, 0, 0, `picked-pillar-${height}`)
      m.cfg.height = height
      useStore.setState({ station: { ...toState(emptyStation()), modules: [m] }, pillarLength: height === 2 ? 4 : 2 })
      ctxFor(m.id).onDown(press([0, 0, 0]))
      assert.equal(useStore.getState().pillarLength, height === 2 ? 2 : 4, `${height} m pillar selects its next section length`)
      useStore.getState().cancelPick()
      assert.equal(useStore.getState().pillarLength, height === 2 ? 4 : 2, 'Esc restores the pre-pick choice')
    }
  } finally {
    useStore.setState(before)
  }
})

const floor = (x, y, z = 0) => ({ x, y, z, fill: 'solid' })

/** The two faces of the 指示牌 below: a label and the 出口 plate, plus an empty back. */
const SIGN_BOARDS = {
  front: [
    { id: 'c1', kind: 'text', text: '出口 A', x: 0.5, y: 0.4, scale: 1, side: 'both' },
    { id: 'c2', kind: 'icon', icon: 'exit', x: 0.3, y: 0.6, scale: 1, side: 'both' },
  ],
  back: [],
}

const MODULES = [
  { id: 'g1', type: 'gate', x: 0, y: 0, z: 0, rot: 2, cfg: { dir: 'both', door: 'fence' } },
  { id: 'b1', type: 'bench', x: 1, y: 0, z: 0, rot: 1, w: 2, cfg: { variant: 'seat-2' } },
  { id: 'b2', type: 'bench', x: 3, y: 3, z: 0, rot: 0, cfg: {} },
  { id: 'bb1', type: 'billboard', x: 2, y: 0, z: 0, rot: 0, w: 3, cfg: { variant: 'panorama' } },
  { id: 'gl1', type: 'glass', x: 3, y: 0, z: 0, rot: 0, w: 2, cfg: { variant: '2x2' } },
  { id: 'c1', type: 'calligraphy', x: 0, y: 1, z: 0, rot: 0, w: 1, panelH: 2, cfg: { style: 'song', axis: 'v' } },
  { id: 'lm1', type: 'linemap', x: 1, y: 1, z: 0, rot: 0, w: 1, cfg: { mount: 'stand' } },
  { id: 'dr1', type: 'door', x: 1, y: 3, z: 0, rot: 3, w: 2, cfg: { variant: 'wood-2' } },
  { id: 'dr2', type: 'door', x: 2, y: 3, z: 0, rot: 0, w: 1, cfg: {} },
  {
    id: 's1',
    type: 'stair',
    x: 2,
    y: 1,
    z: 0,
    rot: 3,
    from: { x: 2, y: 1, z: 0 },
    to: { x: 2, y: 4, z: 4 },
    cfg: { width: STAIR_WIDTH_NARROW, style: 'right180' },
  },
  { id: 'e1', type: 'exit', x: 3, y: 1, z: 0, rot: 0, cfg: { name: 'A口', inRate: 600, open: true, covered: false, bays: 3 } },
  {
    id: 'es1',
    type: 'escalator',
    x: 0,
    y: 2,
    z: 0,
    rot: 1,
    from: { x: 0, y: 2, z: 0 },
    to: { x: 0, y: 5, z: 4 },
    cfg: { dir: 'down' },
  },
  { id: 't1', type: 'track', x: 1, y: 2, z: 0, rot: 0, cfg: { line: 'L1', dir: 'up' } },
  { id: 'r1', type: 'shop', x: 2, y: 2, z: 0, rot: 0, w: 2, h: 2, cfg: { kind: 'toilet' } },
  { id: 'sg1', type: 'sign', x: 2, y: 3, z: 0, rot: 0, cfg: { front: SIGN_BOARDS.front.map((c) => ({ ...c })), back: [] } },
  { id: 'pe1', type: 'platform-edge', x: 3, y: 2, z: 0, rot: 0, w: 2, cfg: { name: '', line: '', dir: 'up', side: 'left' } },
]

/** The picker with the scene stubbed and the drawn-model pick scripted. */
test('picking either lift style copies it, and Esc restores the previous style', () => {
  for (const style of ['glass', 'steel']) {
    const m = createModule('lift', 0, 0, 0, 'picked-lift', 2)
    m.cfg.style = style
    useStore.setState({ station: { ...toState(emptyStation()), modules: [m] }, liftStyle: style === 'glass' ? 'steel' : 'glass' })
    const before = useStore.getState().liftStyle
    ctxFor(m.id).onDown(press([0, 0, 0]))
    assert.equal(useStore.getState().moduleType, 'lift')
    assert.equal(useStore.getState().liftStyle, style)
    assert.equal(useStore.getState().moduleRot, 2)
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().liftStyle, before)
  }
})

test('picking a short stair block restores its height and rotation', () => {
  const m = createModule('stair-block', 0, 0, 0, 'short', 2, 0.5)
  useStore.setState({ station: { ...toState(emptyStation()), modules: [m] }, stairBlockHeight: 1 })
  ctxFor(m.id).onDown(press([0, 0, 0]))
  assert.equal(useStore.getState().moduleType, 'stair-block')
  assert.equal(useStore.getState().stairBlockHeight, 0.5)
  assert.equal(useStore.getState().moduleRot, 2)
})

function ctxFor(pickedId) {
  const ref = (v = null) => ({ current: v })
  return new PickTool({
    scene: () => ({ setGhost: () => {}, setCursor: () => {}, setModulePreview: () => {}, setCollisionHighlight: () => {} }),
    pick: () => null,
    pickModule: () => pickedId,
    facing: () => undefined,
    solids: () => new Set(useStore.getState().station.cells.filter((c) => c.fill === 'solid').map((c) => `${c.x},${c.y},${c.z}`)),
    thins: () => thinWallSideMap(useStore.getState().station.cells, useStore.getState().station.modules),
    hover: ref(),
    drag: ref(),
    paint: ref(),
    zoneDrag: ref(),
    facilityDrag: ref(),
    showMeasure: () => {},
    clearMeasure: () => {},
  })
}

/** One left press on a cell; `solid` says the ray hit a block face. */
function press(cell, solid = true, button = 0) {
  return {
    clientX: 0,
    clientY: 0,
    button,
    buttons: button === 2 ? 2 : 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid, normal: [0, 0, 1], point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

test('picking a camera copies its variant and rotation, including legacy 枪机', () => {
  const before = useStore.getState()
  try {
    for (const [variant, id] of [[undefined, 'cctv'], ['bullet', 'cctv'], ['ptz', 'cctv-ptz'], ['dome', 'cctv-dome']]) {
      const m = { id: 'camera-picked', type: 'cctv', x: 1, y: 1, z: 0, rot: 3, cfg: variant ? { variant } : {} }
      useStore.setState({ station: { ...toState(emptyStation()), modules: [m] }, tool: 'pick', moduleType: 'gate', pickDraft: null })
      ctxFor(m.id).onDown(press([1, 1, 0]))
      assert.equal(useStore.getState().moduleType, id)
      assert.equal(useStore.getState().moduleRot, 3)
      useStore.getState().cancelPick()
      assert.equal(useStore.getState().moduleType, 'gate')
    }
  } finally {
    useStore.setState(before)
  }
})

test.beforeEach(() => {
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push(floor(x, y))
  useStore.setState({
    tool: 'pick',
    moduleType: 'gate',
    moduleRot: 0,
    stairWidth: STAIR_WIDTH_NARROW,
    roofWidth: 4,
    escalatorDir: 'up',
    gateDoor: 'lane',
    zoneBrush: 'paid',
    paintMode: 'single',
    paintBaseMode: 'single',
    paintFinish: 'floor.granite',
    selected: null,
    notice: null,
    pickDraft: null,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells, modules: structuredClone(MODULES), lines: [] }),
  })
})

const st = () => useStore.getState()

test('picking equipment arms its exact variant, copies its turn, and selects it', () => {
  ctxFor('g1').onDown(press([0, 0, 0]))
  assert.equal(st().tool, 'module')
  assert.equal(st().moduleType, 'gate')
  assert.equal(st().moduleRot, 2)
  assert.equal(st().gateDoor, 'fence')
  assert.deepEqual(st().selected, { kind: 'module', key: 'g1', label: '闸机' })

  ctxFor('b1').onDown(press([1, 0, 0]))
  assert.equal(st().moduleType, 'bench-seat-2', 'a 2 m backed bench arms its own tile')
  assert.equal(st().moduleRot, 1)
  assert.equal(st().selected.key, 'b1')

  ctxFor('bb1').onDown(press([2, 0, 0]))
  assert.equal(st().moduleType, 'billboard-panorama')

  ctxFor('gl1').onDown(press([3, 0, 0]))
  assert.equal(st().moduleType, 'glass-2x2')

  ctxFor('c1').onDown(press([0, 1, 0]))
  assert.equal(st().moduleType, 'calligraphy-song-v')

  ctxFor('lm1').onDown(press([1, 1, 0]))
  assert.equal(st().moduleType, 'linemap-stand')

  ctxFor('dr1').onDown(press([1, 3, 0]))
  assert.equal(st().moduleType, 'door-wood-2', 'a 门 arms its own leaf count and material')
  assert.equal(st().moduleRot, 3)

  ctxFor('s1').onDown(press([2, 1, 0]))
  assert.equal(st().moduleType, 'stair-right180', 'a stair is picked as equipment, not as a finish')
  assert.equal(st().moduleRot, 3)

  ctxFor('e1').onDown(press([3, 1, 0]))
  assert.equal(st().moduleType, 'exit-uncovered-3')

  ctxFor('es1').onDown(press([0, 2, 0]))
  assert.equal(st().moduleType, 'escalator')
  assert.equal(st().escalatorDir, 'down')
})

test('picking a 灯具, 导向柱, wide 扶梯 or shell roof arms its tile and settings', () => {
  // A rectangular batten off-centre, a pillar bound to an exit, a wide run and
  // a shell bay: the pick arms each tile and adopts the setting behind it.
  const light = { id: 'l1', type: 'light', x: 0, y: 0, z: -4, rot: 1, cfg: { variant: 'rectangular', position: 5 } }
  const guide = { id: 'gp1', type: 'guidepost', x: 1, y: 0, z: 0, rot: 0, cfg: { exitId: 'e1' } }
  const wide = {
    id: 'es2', type: 'escalator', x: 0, y: 2, z: -4, rot: 0,
    from: { x: 0, y: 2, z: -4 }, to: { x: 0, y: 8, z: 0 }, cfg: { dir: 'up', width: 2 },
  }
  const shell = createModule('roof-shell', 2, 2, 4, 'r1', 0, 8)
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push(floor(x, y))
  useStore.setState({
    station: toState({ name: 't', seed: 1, cells, modules: [light, guide, wide, shell], lines: [] }),
    tool: 'pick', escalatorWide: false, lightPosition: 0, guideExitId: null, roofWidth: 4,
  })

  ctxFor('l1').onDown(press([0, 0, 0]))
  assert.equal(st().moduleType, 'light-rectangular', 'a batten arms its own shape')
  assert.equal(st().lightPosition, 5, 'and the in-cell spot it hangs from')

  ctxFor('gp1').onDown(press([1, 0, 0]))
  assert.equal(st().moduleType, 'guidepost', 'a pillar is a placement, not just a selection')
  assert.equal(st().guideExitId, 'e1', 'and it stays bound to its exit')

  ctxFor('es2').onDown(press([0, 2, 0]))
  assert.equal(st().moduleType, 'escalator')
  assert.equal(st().escalatorWide, true, 'a wide run arms the wide band')

  ctxFor('r1').onDown(press([2, 2, 4]))
  assert.equal(st().moduleType, 'roof-shell', 'a shell bay arms the shell tile')
  assert.equal(st().roofWidth, 8)
  assert.equal(st().cancelPick(), true)
  assert.equal(st().roofWidth, 4, 'Esc restores the width armed before picking')
})

test('a legacy piece with no variant reads as the palette default it is drawn as', () => {
  ctxFor('b2').onDown(press([3, 3, 0]))
  assert.equal(st().moduleType, 'bench-steel-1')
  assert.equal(st().tool, 'module')

  // A 门 with no variant is the 单开 不锈钢 door, the one `doorSpec` falls back to.
  ctxFor('dr2').onDown(press([2, 3, 0]))
  assert.equal(st().moduleType, 'door-steel-1')
})

test('picking any roof restores its truss style and width', () => {
  for (const [id, width] of [['roof', 4], ['roof-truss', 4], ['roof-truss', 8], ['roof-truss', 12], ['roof-tapered', 4], ['roof-tapered', 8], ['roof-tapered', 12]]) {
    const roof = createModule(id, 0, 0, 0, 'picked', 1, width)
    useStore.setState({ station: { ...st().station, modules: [roof] }, tool: 'pick', roofWidth: 4 })
    ctxFor('picked').onDown(press([0, 0, 0]))
    assert.equal(st().moduleType, id)
    assert.equal(st().moduleRot, 1)
    if (id !== 'roof') assert.equal(st().roofWidth, width)
    assert.equal(st().cancelPick(), true)
    assert.equal(st().roofWidth, 4, 'Esc restores the width armed before picking')
  }
})

test('picking a bridge copies its barrier and length, and Esc restores both settings', () => {
  const bridge = createModule('bridge', 0, 0, 4, 'picked')
  bridge.w = 16
  bridge.cfg.bridgeRailing = 'sound-barrier'
  useStore.setState({ station: { ...st().station, modules: [bridge] }, bridgeLength: 32, bridgeRailing: 'railing' })
  ctxFor('picked').onDown(press([0, 0, 4]))
  assert.equal(st().bridgeRailing, 'sound-barrier')
  assert.equal(st().bridgeLength, 16)
  assert.equal(st().cancelPick(), true)
  assert.equal(st().bridgeRailing, 'railing')
  assert.equal(st().bridgeLength, 32)
})

test('a rail run hands to the 轨道 tool, a room to 分区, a screen door only selects', () => {
  ctxFor('t1').onDown(press([1, 2, 0]))
  assert.equal(st().tool, 'rail')
  assert.equal(st().selected.key, 't1')

  ctxFor('r1').onDown(press([2, 2, 0]))
  assert.equal(st().tool, 'zone')
  assert.equal(st().zoneBrush, 'toilet', 'the 厕所 room arms its own brush, revealing 房间')
  assert.equal(st().selected.key, 'r1')

  ctxFor('pe1').onDown(press([3, 2, 0]))
  assert.equal(st().selected.key, 'pe1', 'a derived edge has no placement to arm')
})

test('a 半墙 and a 三角 are picked on the surface the pointer is on, never the block', () => {
  // A half-block panel (inner face east) and an upper 三角 (45° slope) on bare
  // ground. The pick's own cell math snaps the slope's off-axis normal to the
  // wedge's face slot, so the two surfaces resolve exactly as the 材质 brush does.
  let station = toState({ name: 't', seed: 1, cells: [], modules: [], lines: [] })
  station = addWalls(station, [[1, 1, 0]], 'w', 1).state
  station = addWalls(station, [[2, 2, 0]], null, 1, { kind: 'upper', side: 'n' }).state
  station = paintFace(station, 1, 1, 0, 'e', 'wall.tile')
  station = paintFace(station, 2, 2, 0, 'top', 'floor.concrete')
  useStore.setState({ station })

  // The panel's inner face points east into the cell's clear half; a ray hits it
  // at the cell centre.
  const half = pickCells([1.5, 1.5, 0.5], [1, 0, 0])
  ctxFor(null).onDown({ ...press(half.cell), hit: { ...press(half.cell).hit, normal: half.normal } })
  assert.equal(st().paintFinish, 'wall.tile', 'the 半墙 picked its own inner surface')
  assert.equal(st().tool, 'paint')

  // The wedge's slope is drawn off-axis; the pick snaps it to the piece's face slot.
  const slope = pickCells([2.5, 2.5, 0.5], [0, -Math.SQRT1_2, Math.SQRT1_2])
  assert.deepEqual(slope.cell, [2, 2, 0], 'the slope reads its own cell, not the block below')
  assert.deepEqual(slope.normal, [0, 0, 1], 'the 45° normal snaps to the 三角’s top slot')
  ctxFor(null).onDown({ ...press(slope.cell), hit: { ...press(slope.cell).hit, normal: slope.normal } })
  assert.equal(st().paintFinish, 'floor.concrete', 'the 三角 picked its slope surface')
})

test('a bare face lends its finish to the 材质 brush, and a right press picks nothing', () => {
  // An empty floor, so no envelope (a rail run is train-long) stands under it.
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push(floor(x, y))
  useStore.setState({ station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }) })
  ctxFor(null).onDown(press([0, 3, 0]))
  assert.equal(st().tool, 'paint')
  assert.equal(st().paintFinish, 'floor.granite')
  assert.equal(st().paintMode, 'single', 'the finish lands in the folder’s own mode')

  useStore.setState({ tool: 'pick', selected: null })
  ctxFor('g1').onDown(press([0, 0, 0], true, 2))
  assert.equal(st().tool, 'pick', 'a right press is not a pick')
  assert.equal(st().selected, null)
  assert.equal(st().moduleType, 'gate', 'and it arms nothing either')
})

/* ------------------------------------------------------- the sign's own boards */

test('picking a 指示牌 copies the piece’s own printed boards, not the last ones composed', () => {
  // Something else is current, exactly as if the player had composed a different
  // board since this sign was hung.
  const elsewhere = settleSignBoards(
    { front: [{ id: 'c9', kind: 'text', text: '站台', x: 0.5, y: 0.5, scale: 1, side: 'both' }], back: [] },
    st().station,
  )
  useStore.setState({ currentBoards: elsewhere })

  ctxFor('sg1').onDown(press([2, 3, 0]))
  assert.equal(st().tool, 'module', 'the picker hands the placement the sign')
  assert.equal(st().moduleType, 'sign-ceiling', 'and arms the mount it was hung by')

  const sign = st().station.modules.find((m) => m.id === 'sg1')
  const expected = settleSignBoards(signBoardsOf(sign.cfg, st().station), st().station)
  assert.deepEqual(st().currentBoards.front, expected.front, 'the picked sign’s front is what is current now')
  assert.deepEqual(st().currentBoards.back, expected.back)
  assert.notDeepEqual(st().currentBoards.front, elsewhere.front, 'and not the board that was current before')
  assert.deepEqual(
    sign.cfg.front.map((c) => c.kind),
    ['text', 'icon'],
    'the piece itself is untouched: a pick copies out of a sign, it never edits one',
  )

  // The next sign hung is the one that was picked, which is the whole point.
  const placed = createModule('sign', 0, 3, 0, 'new-sign', 0, undefined, 'up', 'lane', st().station, st().currentBoards)
  assert.deepEqual(placed.cfg.front, st().currentBoards.front)
})

test('a picked 指示牌 arms the mount it hangs by, so the tile and the piece agree', () => {
  // A 指示牌 is two tiles in one cell — hung from the ceiling or bolted to a wall — and
  // the tile is what the next click lays, so a pick has to read the piece's own mount
  // rather than the bare type (`sim/sign.ts`'s `SignMount`).
  const wall = {
    id: 'sgw',
    type: 'sign',
    x: 1,
    y: 1,
    z: 0,
    rot: 0,
    cfg: { mount: 'wall', front: SIGN_BOARDS.front.map((c) => ({ ...c })), back: [] },
  }
  useStore.setState({ station: toState({ name: 't', seed: 1, cells: [floor(1, 1)], modules: [wall], lines: [] }) })
  ctxFor('sgw').onDown(press([1, 1, 0]))
  assert.equal(st().tool, 'module')
  assert.equal(st().moduleType, 'sign-wall', 'the wall board arms the wall tile')
  // ...and a piece placed from that tile is the same mount, wall and all.
  const again = createModule(st().moduleType, 1, 1, 0, 'sgw2', 0, undefined, 'up', 'lane', st().station, st().currentBoards)
  assert.equal(again.cfg.mount, 'wall')
})

test('Esc puts a picked piece back — the tool, its settings and the boards', () => {
  assert.equal(st().pickDraft, null, 'nothing picked yet')

  // The player is in 选择 with a gate armed, picks a bench, and lands in 设备 with
  // the bench's own variant and turn.
  useStore.setState({ tool: 'select', moduleType: 'gate', moduleRot: 0 })
  ctxFor('b1').onDown(press([1, 0, 0]))
  assert.equal(st().tool, 'module')
  assert.equal(st().moduleType, 'bench-seat-2')
  assert.equal(st().moduleRot, 1)
  assert.deepEqual(
    { tool: st().pickDraft.tool, moduleType: st().pickDraft.moduleType, moduleRot: st().pickDraft.moduleRot },
    { tool: 'select', moduleType: 'gate', moduleRot: 0 },
    'the draft is the pre-pick rail',
  )

  assert.equal(st().cancelPick(), true, 'Esc finds something to put back')
  assert.equal(st().tool, 'select', 'the tool the pick borrowed is handed back')
  assert.equal(st().moduleType, 'gate')
  assert.equal(st().moduleRot, 0)
  assert.equal(st().pickDraft, null, 'and the pick is forgotten')
  assert.equal(st().cancelPick(), false, 'a second Esc has nothing left to do')
  assert.equal(st().notice, '已取消吸取')
})

test('Esc hands back the wall-face cycle the pick borrowed from the 方块 tool', () => {
  // The pick reaches the rail through `setTool`, which zeroes the 方块 tool's
  // wall-face cycle with every tool change. A player who had stepped a **半墙** onto
  // its side and then picked a bench must not come back to the geometry's default half.
  useStore.setState({ tool: 'block', halfWall: true, triangles: false, autoWalls: false, wallSnapCycle: 2 })
  ctxFor('b1').onDown(press([1, 0, 0]))
  assert.equal(st().wallSnapCycle, 0, 'the pick’s own tool change resets the cycle')

  assert.equal(st().cancelPick(), true, 'Esc finds the pick to put back')
  assert.equal(st().tool, 'block', 'the 方块 tool comes back …')
  assert.equal(st().halfWall, true, '… with its cut piece still armed …')
  assert.equal(st().wallSnapCycle, 2, '… and the half R had stepped it to')
})

test('Esc hands a picked sign’s boards back too', () => {  const elsewhere = settleSignBoards(
    { front: [{ id: 'c9', kind: 'text', text: '站台', x: 0.5, y: 0.5, scale: 1, side: 'both' }], back: [] },
    st().station,
  )
  useStore.setState({ currentBoards: elsewhere })

  ctxFor('sg1').onDown(press([2, 3, 0]))
  assert.notDeepEqual(st().currentBoards.front, elsewhere.front, 'the pick copied the sign’s board in')
  st().cancelPick()
  assert.deepEqual(st().currentBoards.front, elsewhere.front, 'and Esc puts the old pair back')
  assert.equal(st().notice, '已取消吸取')
})

test('a pick notes nothing when it changes nothing', () => {
  // A derived 站台门 has no placement to arm: it is selected, and there is no
  // gesture for Esc to end.
  ctxFor('pe1').onDown(press([3, 2, 0]))
  assert.equal(st().selected.key, 'pe1')
  assert.equal(st().pickDraft, null)
  assert.equal(st().tool, 'pick', 'and the tool is left where it was')
})


test('picking each shelf variant and a legacy shelf copies its style and rotation', () => {
  for (const variant of ['dark-tall', 'white-tall', 'white-short', 'wire', 'cooler', 'cooler-dark', undefined]) {
    const m = { id: 'shelf-picked', type: 'shelf', x: 1, y: 1, z: 0, rot: 3, cfg: { variant } }
    useStore.setState({ station: { ...toState(emptyStation()), modules: [m] }, tool: 'pick', moduleType: 'gate', pickDraft: null })
    ctxFor(m.id).onDown(press([1, 1, 0]))
    assert.equal(st().moduleType, `shelf-${variant ?? 'dark-tall'}`)
    assert.equal(st().moduleRot, 3)
    assert.equal(st().selected.key, m.id)
    st().cancelPick()
    assert.equal(st().moduleType, 'gate')
  }
})
