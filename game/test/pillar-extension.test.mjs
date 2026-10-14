// 支柱 extension beside a turning stair (GAME-SPEC §9.5).
//
// A short pillar can stand where its grown self cannot: the fresh shaft fits
// under (or beside) the upper flight while the extension would pierce it. Two
// things have to hold then:
//
//   1. The refusal names the conflict. The extension hover and the release both
//      highlight the offending pieces (`setCollisionHighlight`), and the notice
//      names them (`equipmentRefusalNotice` + `blockerLabels`) — a red ghost
//      with no culprit is the bug this pins.
//   2. The center platform is not the culprit. A turning stair reserves its
//      flights (`rampBodyBoxes`, one slope-cut box per swept tile); its
//      half-landing tiles hold no run at all, at every size. So a pillar beside
//      the landing is judged by the flights alone, and the hitbox is not too
//      large there.
//
// The snap itself is order-independent: a turning stair's `rampEnvelope` spans
// the whole corner it turns through, so a generic `moduleAt` at the pillar's
// own cell answers the stair whenever the stair is earlier in the document and
// the extension never fires. `pillarAt` reads the pillar's anchor cell first,
// and the hover and the release both ask it, so the ghost grows what the click
// grows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { addEquipment, createModule, toState } from '../src/build/model.ts'
import {
  equipmentReason,
  equipmentRefusalNotice,
  moduleAt,
  pillarAt,
  placementColliders,
} from '../src/sim/placement.ts'
import { rampBodyBoxes } from '../src/sim/openings.ts'
import { extendedPillar } from '../src/sim/structures.ts'
import {
  STAIR_WIDTH_DOUBLE,
  STAIR_WIDTH_NARROW,
  STAIR_WIDTH_TRIPLE,
  stairTurnCells,
} from '../src/sim/stairs.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore } from '../src/app/store.ts'

/* --------------------------------------------------------------- fixtures */

/** Open floor: a 16 × 16 slab at z = 0. */
function cells() {
  const out = []
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) out.push({ x, y, z: 0, fill: 'solid' })
  return out
}

const state = (stationCells, modules) => toState({ name: '支柱测试', seed: 1, cells: stationCells, modules, lines: [] })

/**
 * A narrow quarter-turn stair at (7, 7) and a short (2 m) slim pillar under its
 * upper flight at (9, 10): the fresh shaft (z 1–3) clears the flight band above
 * it, the grown one does not.
 */
function stairAndPillar() {
  const stair = createModule('stair-right90', 7, 7, 0, 'stair-1', 0)
  assert.ok(stair, 'the rig needs its stair')
  const short = createModule('pillar-slim', 9, 10, 0, 'pillar-9', 0)
  assert.ok(short, 'the rig needs its pillar')
  const pillar = { ...short, cfg: { ...short.cfg, height: 2 } }
  const placed = addEquipment(state(cells(), []), stair)
  const modules = [...placed.modules, pillar]
  return { cells: placed.cells, modules, stair, pillar }
}

/* ------------------------------------------------------------ the snap */

test('pillarAt finds the pillar under the pointer whatever stands around it', () => {
  const { modules, pillar, stair } = stairAndPillar()
  void pillar
  void stair
  const stairFirst = [modules.find((m) => m.id === 'stair-1'), modules.find((m) => m.id === 'pillar-9')]
  // The turning stair's envelope spans the whole corner it turns through, so a
  // generic lookup at the pillar's own cell answers the stair whenever the
  // stair is earlier in the document — and the extension snap never fires.
  assert.equal(moduleAt(stairFirst, 9, 10, 0)?.id, 'stair-1', 'the setup really covers the pillar cell')
  // The anchor cell is the pillar's own, so it decides before the overlap does.
  assert.equal(pillarAt(stairFirst, 9, 10, 0)?.id, 'pillar-9', 'stair-first document order')
  assert.equal(pillarAt([...stairFirst].reverse(), 9, 10, 0)?.id, 'pillar-9', 'pillar-first document order')
  assert.equal(pillarAt([stairFirst[0]], 9, 10, 0), undefined, 'no pillar on the cell is no extension')
})

test('pillarAt finds a slim shaft at any of its nine offsets', () => {
  // R walks a slim pillar through nine in-cell spots; the anchor cell is the
  // pillar's own at every one of them.
  for (let rot = 0; rot < 9; rot++) {
    const p = createModule('pillar-slim', 3, 3, 0, `pillar-${rot}`, rot)
    assert.ok(p, `rot ${rot} builds`)
    assert.equal(pillarAt([p], 3, 3, 0)?.id, `pillar-${rot}`, `offset ${rot}`)
  }
})

test('stacked pillars resolve by storey band, in either document order', () => {
  // Two shafts sharing one anchor cell, the upper standing where the lower
  // ends (touching, never overlapping): the hovered storey decides.
  const lo = createModule('pillar-slim', 3, 3, 0, 'pillar-lo', 0)
  const hiPlaced = createModule('pillar-slim', 3, 3, 4, 'pillar-hi', 0)
  assert.ok(lo && hiPlaced, 'the rig needs both shafts')
  const hi = { ...hiPlaced, x: 3, y: 3, z: 4 }
  for (const modules of [[lo, hi], [hi, lo]]) {
    assert.equal(pillarAt(modules, 3, 3, 0)?.id, 'pillar-lo', 'the lower storey lifts the lower shaft')
    assert.equal(pillarAt(modules, 3, 3, 4)?.id, 'pillar-hi', 'the upper storey lifts the upper shaft')
  }
  // One tall shaft is the same pillar from any storey it reaches.
  const tall = { ...createModule('pillar-slim', 5, 5, 0, 'pillar-tall', 0), cfg: { size: 'slim', height: 8 } }
  assert.equal(pillarAt([tall], 5, 5, 0)?.id, 'pillar-tall')
  assert.equal(pillarAt([tall], 5, 5, 4)?.id, 'pillar-tall')
})

test('the 信息 card lifts a free pillar but not a bridge-owned pier', () => {
  const before = useStore.getState()
  try {
    const free = createModule('pillar-thick', 2, 2, 0, 'pillar-2', 0)
    const pierPlaced = createModule('pillar-thick', 5, 5, 0, 'b1:pillar:4', 0)
    assert.ok(free && pierPlaced, 'the rig needs both shafts')
    const pier = { ...pierPlaced, cfg: { ...pierPlaced.cfg, bridgeId: 'b1' } }
    // NB: the pier is appended after `toState` — the load path's own
    // `syncBridgePillars` would drop a pier whose bridge is not standing.
    const loaded = state(cells(), [free])
    useStore.setState({
      station: { ...loaded, modules: [...loaded.modules, pier] },
      moveDraft: null,
      selected: null,
      past: [],
      future: [],
      notice: null,
      version: 0,
    })
    const st = () => useStore.getState()
    st().liftModule('pillar-2')
    assert.ok(st().moveDraft, 'a free-standing pillar comes up')
    assert.equal(st().moveDraft.module.id, 'pillar-2')
    st().cancelMove(false)
    st().liftModule('b1:pillar:4')
    assert.equal(st().moveDraft, null, 'a bridge-owned pier stays put: its bay belongs to the bridge')
    assert.match(st().notice, /不能移动/)
  } finally {
    useStore.setState(before)
  }
})
/* ------------------------------------------------------------ the hitbox */

test('a turning stair reserves its flights, never its center platform', () => {
  // Every turning style at every size: no half-landing cell centre sits inside
  // any flight body box, so a pillar beside the landing is judged by the
  // flights alone — the hitbox is not too large at the center platform.
  const styles = ['stair-right90', 'stair-left90', 'stair-right180', 'stair-left180', 'stair-rightForward', 'stair-centerForward']
  const widths = [['narrow', STAIR_WIDTH_NARROW], ['double', STAIR_WIDTH_DOUBLE], ['triple', STAIR_WIDTH_TRIPLE]]
  for (const style of styles) {
    for (const [name, width] of widths) {
      const stair = createModule(style, 7, 7, 0, 'stair-1', 0, width)
      assert.ok(stair, `${style}/${name} builds`)
      const turns = stairTurnCells(stair)
      assert.ok(turns.length > 0, `${style}/${name} turns on its own cells`)
      const boxes = rampBodyBoxes(stair)
      assert.ok(boxes.length > 0, `${style}/${name} sweeps its flights`)
      for (const t of turns) {
        const cx = t.x + 0.5
        const cy = t.y + 0.5
        const covering = boxes.filter((b) => b.x0 < cx && cx < b.x1 && b.y0 < cy && cy < b.y1)
        assert.equal(covering.length, 0, `${style}/${name}: the center platform ${t.x},${t.y} is inside no flight box`)
      }
    }
  }
})

/* ------------------------------------------------------------ the verdict */

test('a short pillar under the upper flight extends into it, and the refusal names the stair', () => {
  const { cells: stationCells, modules, pillar } = stairAndPillar()
  const others = modules.filter((m) => m.id !== pillar.id)
  assert.equal(equipmentReason(stationCells, others, pillar, true), '', 'the 2 m shaft fits under the flight')
  const grown = extendedPillar(pillar, 4)
  assert.equal(grown.cfg.height, 6, 'the rig grows a 2 m section by the 4 m arm')
  const colliders = placementColliders(others, grown)
  assert.deepEqual(colliders.map((m) => m.id), ['stair-1'], 'the upper flight is the conflict')
  assert.equal(equipmentReason(stationCells, others, grown, true), 'occupied')
  assert.match(
    equipmentRefusalNotice('occupied', colliders),
    /楼梯/,
    'the notice names the stairs, not just the held cell',
  )
})

/* ------------------------------------------------------------ the tool */

function toolFixture(modules, stationCells) {
  const previews = []
  const highlights = []
  const cursors = []
  const scene = {
    setHoverHighlight() {},
    setModulePreview: (...args) => previews.push(args),
    setCollisionHighlight: (...args) => highlights.push(args),
    setCursor: (...args) => cursors.push(args),
    setGhost() {},
    setFencePreview() {},
  }
  const ref = (current = null) => ({ current })
  const ctx = {
    scene: () => scene,
    pickModule: () => null,
    pick: () => null,
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
  useStore.setState({
    tool: 'module',
    moduleType: 'pillar-slim',
    pillarLength: 4,
    station: state(stationCells, modules),
    moveDraft: null,
    selected: null,
    notice: null,
  })
  return { previews, highlights, ctx }
}

const hoverAt = (x, y, z = 0) => ({
  clientX: 10,
  clientY: 10,
  button: 0,
  buttons: 0,
  shiftKey: false,
  hit: { cell: [x, y, z], place: [x, y, z + 1], solid: true, point: [0.5, 0.5] },
  preventDefault() {},
})

test('a blocked extension highlights the stair beside the red ghost', () => {
  const before = useStore.getState()
  try {
    const { cells: stationCells, modules } = stairAndPillar()
    const f = toolFixture(modules, stationCells)
    new EquipmentTool(f.ctx).onMove(hoverAt(9, 10))
    const [grown, blocked] = f.previews.at(-1)
    assert.equal(grown.id, 'pillar-9', 'the hover grows the pillar under the pointer')
    assert.equal(grown.cfg.height, 6)
    assert.equal(blocked, true, 'the grown shaft pierces the upper flight')
    assert.deepEqual(f.highlights.at(-1), [['stair-1']], 'the conflicting stair lights up with it')
  } finally {
    useStore.setState(before)
  }
})

test('a clear extension highlights nothing', () => {
  const before = useStore.getState()
  try {
    const { cells: stationCells, modules } = stairAndPillar()
    const f = toolFixture(modules, stationCells)
    new EquipmentTool(f.ctx).onMove(hoverAt(2, 2))
    // No pillar on the cell: a fresh placement preview, not an extension.
    assert.deepEqual(f.highlights.at(-1), [null])
  } finally {
    useStore.setState(before)
  }
})

test('clicking a blocked extension names the stair and highlights it, committing nothing', () => {
  const before = useStore.getState()
  try {
    const { cells: stationCells, modules } = stairAndPillar()
    const f = toolFixture(modules, stationCells)
    const tool = new EquipmentTool(f.ctx)
    tool.onMove(hoverAt(9, 10))
    const count = useStore.getState().station.modules.length
    tool.onDown(hoverAt(9, 10))
    assert.match(useStore.getState().notice, /楼梯/, 'the release refusal names the stairs')
    assert.deepEqual(f.highlights.at(-1), [['stair-1']], 'and still highlights them on release')
    assert.equal(useStore.getState().station.modules.length, count, 'nothing lands')
    assert.equal(
      useStore.getState().station.modules.find((m) => m.id === 'pillar-9').cfg.height,
      2,
      'the standing shaft is untouched',
    )
  } finally {
    useStore.setState(before)
  }
})

test('clicking a clear extension grows the pillar the ghost grew', () => {
  const before = useStore.getState()
  try {
    const { cells: stationCells, modules } = stairAndPillar()
    // A pillar in the open: nothing above it but air.
    const short = createModule('pillar-slim', 2, 2, 0, 'pillar-2', 0)
    const pillar = { ...short, cfg: { ...short.cfg, height: 2 } }
    assert.equal(equipmentReason(stationCells, modules, pillar, true), '', 'the rig needs a placeable pillar')
    const f = toolFixture([...modules, pillar], stationCells)
    new EquipmentTool(f.ctx).onDown(hoverAt(2, 2))
    assert.equal(
      useStore.getState().station.modules.find((m) => m.id === 'pillar-2').cfg.height,
      6,
      'the release grows what the hover previewed',
    )
  } finally {
    useStore.setState(before)
  }
})
