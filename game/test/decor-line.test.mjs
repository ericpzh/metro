// Decor / equipment line placement (§5.4): press, drag along one axis and
// release to lay a row at the rail's 间隔 (0 … 6 empty blocks between pieces).
// The same gesture with the right button lifts the row back out, whatever
// spacing it was laid at, in one undo step.
//
// The pitch is the piece's own footprint plus the 间隔, so a piece wider than
// one tile turns its long axis with the drag and abuts its neighbour at 超短
// without overlapping. Wall panels keep the wall face they were aimed at;
// ceiling fittings keep finding their own slab.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { supportsLinePlacement, useStore } from '../src/app/store.ts'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'
import {
  lineAnchorCount,
  lineAnchors,
  lineRunRotation,
  lineSpan,
  lineStep,
} from '../src/app/tools/geometry/linePlacement.ts'
import { LINE_SPACING_DEFAULT, LINE_SPACING_OPTIONS, SPACING_BOX_COUNT, nextLineSpacing, spacingActiveBoxes } from '../src/sim/lineSpacing.ts'
import { moduleFootprint } from '../src/sim/placement.ts'
import { TV_MODEL_WIDTH } from '../src/sim/tvs.ts'
import { isLineDeletable } from '../src/sim/lineDeletion.ts'

function solid(x, y, z) { return { x, y, z, fill: 'solid' } }

/**
 * A production-shaped tool context: every scene layer the placement tools draw
 * through, the shared drag ref, and a pointer event builder whose hit is a
 * normal solid floor top.
 */
function harness({ modules = [], cells = [], type = 'bench-steel-1', rot = 0, spacing = 0 } = {}) {
  useStore.setState({
    station: toState({ ...emptyStation(), cells, modules }),
    past: [],
    future: [],
    tool: 'module',
    moduleType: type,
    moduleRot: rot,
    lineSpacing: spacing,
    selected: null,
    moveDraft: null,
    notice: null,
  })
  const drag = { current: null }
  const previews = []
  const ghosts = []
  const scene = {
    setModulePreview(mods, blocked) { previews.push({ mods, blocked }) },
    setFencePreview() {},
    setCollisionHighlight() {},
    setCursor() {},
    setGhost(cellList, kind, _colour, _thin, blocked) { ghosts.push({ cellList, kind, blocked }) },
    pickModuleHit: () => null,
  }
  const tool = new EquipmentTool({
    scene: () => scene,
    drag,
    hover: { current: null },
    pickModule: () => null,
    facing: () => [0, -1],
  })
  const event = (x, y = 0, button = 0, extra = {}) => ({
    clientX: x * 20,
    clientY: y * 20,
    button,
    buttons: button === 2 ? 2 : 1,
    shiftKey: false,
    preventDefault() {},
    hit: { cell: [x, y, 0], place: [x, y, 1], solid: true, normal: [0, 0, 1], point: [x + 0.5, y + 0.5, 1], ...extra },
  })
  const dragTo = (from, to, button = 0) => {
    tool.onDown(event(from[0], from[1] ?? 0, button))
    drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
    tool.onMove(event(to[0], to[1] ?? 0, button))
    tool.multiPlace.flushPreview()
    const preview = previews.at(-1)
    tool.onUp(event(to[0], to[1] ?? 0, button))
    return preview
  }
  return { tool, drag, event, previews, ghosts, dragTo, lastPreview: () => previews.at(-1) }
}

test('the 间隔 ladder defaults to 超短 (0 blocks) and names all seven marks', () => {
  assert.equal(LINE_SPACING_DEFAULT, 0)
  assert.deepEqual(LINE_SPACING_OPTIONS.map((o) => o.value), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(LINE_SPACING_OPTIONS.map((o) => o.label), ['超短', '短', '中短', '中', '中长', '长', '超长'])
  assert.equal(nextLineSpacing(0), 1)
  assert.equal(nextLineSpacing(6), 0, '超长 wraps back to 超短')
  const s = useStore.getState()
  assert.equal(s.lineSpacing, 0, 'the game opens continuous')
  s.setLineSpacing(9)
  assert.equal(useStore.getState().lineSpacing, 6, 'a stored value is clamped onto the ladder')
  s.setLineSpacing(0)
})

test('the 间隔 resets to 超短 when another decor piece is armed', () => {
  const before = useStore.getState()
  try {
    useStore.getState().setModuleType('bench-steel-1')
    useStore.getState().setLineSpacing(4)
    assert.equal(useStore.getState().lineSpacing, 4)
    useStore.getState().setModuleType('tvm')
    assert.equal(useStore.getState().moduleType, 'tvm')
    assert.equal(useStore.getState().lineSpacing, 0, 'the next piece starts continuous')
    useStore.getState().setLineSpacing(2)
    useStore.getState().setModuleType('tvm')
    assert.equal(useStore.getState().lineSpacing, 2, 're-arming the same piece is not a switch')
  } finally { useStore.setState(before) }
})

test('every loose decor or equipment tile is line-capable; runs and surfaces are not', () => {
  for (const id of [
    'bench-steel-1', 'bench-wood-2', 'tvm', 'vending', 'gate', 'bin', 'desk', 'checkout',
    'tree', 'traffic-light', 'guidepost', 'busstop-short', 'hanger-roof',
    'billboard-wide', 'sign-wall', 'sign-ceiling', 'tv', 'tv-double', 'clock', 'cctv',
    'glass-1x2', 'glass-2x1', 'calligraphy-kai-h', 'linemap-wall', 'linemap-stand',
    'floor-mark-boarding', 'urinal', 'curtain-wall', 'fence', 'noise-barrier', 'court-divider',
    'pillar-slim', 'pillar-thick', 'psd-end', 'court-pickleball', 'court-badminton',
  ]) {
    assert.equal(supportsLinePlacement(id), true, id)
  }
  for (const id of [
    'exit', 'exit-doorway-1', 'stair-straight', 'stair-block', 'escalator', 'walkway',
    'lift', 'roof', 'roof-shell', 'psd-end-cover',
    'sidewalk', 'lawn', 'road', 'tactile-guide', 'bridge',
  ]) {
    assert.equal(supportsLinePlacement(id), false, id)
  }
  for (const mod of [
    createModule('bench', 0, 0, 0, 'b'),
    createModule('tvm', 0, 0, 0, 't'),
    createModule('tree', 0, 0, 0, 'tree'),
    createModule('fence', 0, 0, 0, 'f'),
    createModule('psd-end', 0, 0, 0, 'p'),
    createModule('pillar-slim', 0, 0, 0, 'p2'),
    createModule('court-pickleball', 0, 0, 0, 'court'),
  ]) assert.equal(isLineDeletable(mod), true, mod.type)
  for (const mod of [
    createModule('stair-straight', 0, 0, 0, 's'),
    createModule('lift', 0, 0, 0, 'l'),
    createModule('road', 0, 0, 0, 'r'),
    createModule('roof', 0, 0, 0, 'roof'),
  ]) assert.equal(isLineDeletable(mod), false, mod.type)
})

test('the spacing tile shows all eight boxes and highlights the active pair', () => {
  assert.equal(SPACING_BOX_COUNT, 8, 'two pieces plus six blocks between is the longest row')
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((gap) => spacingActiveBoxes(gap)),
    [[3, 4], [2, 4], [2, 5], [1, 5], [1, 6], [0, 6], [0, 7]],
    'the active pair opens outward from the middle of the same eight-box row',
  )
  for (let gap = 0; gap <= 6; gap++) {
    const [from, to] = spacingActiveBoxes(gap)
    assert.ok(from >= 0 && to < SPACING_BOX_COUNT)
    assert.equal(to - from - 1, gap, `exactly ${gap} outlined boxes between the active two`)
  }
})

test('a long tile follows the drag axis and its pitch is footprint plus 间隔', () => {
  const bench = createModule('bench-steel-2', 0, 0, 0, 'bench')
  assert.equal(lineSpan([bench], 0), 2, '2 m along its own width axis')
  assert.equal(lineSpan([bench], 1), 1)
  assert.equal(lineStep([bench], 0, 0), 2, '超短: the next 2 m bench starts where this one ends')
  assert.equal(lineStep([bench], 0, 2), 4, 'two empty blocks between two 2 m benches')
  assert.equal(lineRunRotation(0, 1, 2, 1), 1, 'dragged along y, the bench turns its length onto y')
  assert.equal(lineRunRotation(0, 0, 2, 1), 0, 'already along x')
  assert.equal(lineRunRotation(2, 1, 2, 1), 3, 'the player’s half-turn survives the axis swap')
  assert.equal(lineRunRotation(0, 0, 1, 1), 0, 'a square tile keeps R')
  assert.deepEqual(
    lineAnchors([0, 0, 0], [7, 0, 0], 3),
    [[0, 0, 0], [3, 0, 0], [6, 0, 0]],
    'anchors run outward from the press, one pitch apart',
  )
  assert.deepEqual(
    lineAnchors([6, 0, 0], [0, 0, 0], 3),
    [[6, 0, 0], [3, 0, 0], [0, 0, 0]],
    'a reverse drag keeps the pressed tile first',
  )
  assert.equal(lineAnchorCount([0, 0, 0], [7, 0, 0], 3), 3)
  assert.equal(lineAnchorCount([0, 0, 0], [2, 0, 0], 3), 1, 'a drag shorter than one pitch is one piece')
})

test('超短 lays a continuous 1 m row and 间隔 2 leaves exactly two empty blocks', () => {
  const continuous = harness({ type: 'bench-steel-1' })
  continuous.dragTo([0, 0], [3, 0])
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [0, 1, 2, 3])
  assert.equal(useStore.getState().past.length, 1, 'the whole row is one undo step')

  const spaced = harness({ type: 'bench-steel-1', spacing: 2 })
  spaced.dragTo([0, 0], [6, 0])
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [0, 3, 6])
  const xs = useStore.getState().station.modules.map((m) => m.x)
  for (let i = 1; i < xs.length; i++) assert.equal(xs[i] - xs[i - 1] - 1, 2, 'two empty blocks between pieces')
  assert.equal(useStore.getState().past.length, 1)
})

test('a 2 m bench dragged along y turns with the drag and abuts at 超短 without overlap', () => {
  const h = harness({ type: 'bench-steel-2' })
  const preview = h.dragTo([0, 0], [0, 5])
  assert.equal(preview.mods.length, 3)
  const placed = useStore.getState().station.modules
  assert.deepEqual(placed.map((m) => [m.x, m.y, m.rot]), [[0, 0, 1], [0, 2, 1], [0, 4, 1]])
  const cells = placed.flatMap((m) => moduleFootprint(m).map(([x, y]) => `${x},${y}`))
  assert.equal(new Set(cells).size, 6, 'three 2 m benches cover six distinct cells, no overlap')
  assert.deepEqual(cells.sort(), ['0,0', '0,1', '0,2', '0,3', '0,4', '0,5'])
  assert.equal(useStore.getState().past.length, 1)
})

test('wall decor lays a row against the aimed wall as one commit', () => {
  // The wall course behind a panel at floor level is the block at z = 1: the
  // floor at z = 0 is the surface the stand cell's top provides.
  const cells = [
    ...Array.from({ length: 11 }, (_, i) => solid(i - 2, 0, 0)),
    ...Array.from({ length: 11 }, (_, i) => solid(i - 2, 1, 1)),
  ]
  const h = harness({ cells, type: 'billboard-standard' })
  const preview = h.dragTo([0, 0], [5, 0])
  assert.equal(preview.mods.length, 3, '2 m posters at 超短: three of them across six cells')
  const placed = useStore.getState().station.modules
  assert.deepEqual(placed.map((m) => [m.x, m.y, m.z, m.rot]), [[0, 0, 0, 2], [2, 0, 0, 2], [4, 0, 0, 2]])
  assert.ok(placed.every((m) => m.cfg.poster), 'each poster keeps its own campaign')
  assert.equal(useStore.getState().past.length, 1)
})

test('ceiling fittings space along the slab at the 间隔', () => {
  const cells = [
    ...Array.from({ length: 7 }, (_, x) => solid(x, 0, 0)),
    ...Array.from({ length: 7 }, (_, x) => solid(x, 0, 3)),
  ]
  const h = harness({ cells, type: 'light-circular', spacing: 2 })
  h.dragTo([0, 0], [6, 0])
  const placed = useStore.getState().station.modules
  assert.deepEqual(placed.map((m) => m.x), [0, 3, 6])
  assert.ok(placed.every((m) => m.type === 'light' && m.ceilingAnchored), 'each light finds the slab over its own cell')
  assert.equal(useStore.getState().past.length, 1)
})

test('a 1.56 m TV row uses a two-cell pitch at 超短 so screens do not overlap', () => {
  const cells = [
    ...Array.from({ length: 7 }, (_, x) => solid(x, 0, 0)),
    ...Array.from({ length: 7 }, (_, x) => solid(x, 0, 3)),
  ]
  const h = harness({ cells, type: 'tv' })
  const preview = h.dragTo([0, 0], [4, 0])
  assert.equal(preview.mods.length, 3, '超短: a TV spans its own two-cell width, not one cell')
  const placed = useStore.getState().station.modules
  assert.deepEqual(placed.map((m) => m.x), [0, 2, 4])
  assert.ok(placed.every((m) => m.type === 'tv' && m.ceilingAnchored))
  assert.equal(lineStep([createModule('tv', 0, 0, 0, 'probe')], 0, 0), 2)
  assert.ok(TV_MODEL_WIDTH < 2, 'the drawn screen fits inside the two-cell pitch')
  assert.equal(useStore.getState().past.length, 1)
})

test('a right-drag line delete lifts a gapped row whole and restores it in one undo', () => {
  const modules = [0, 3, 6].map((x) => createModule('bench-steel-1', x, 0, 0, `bench-${x}`))
  const h = harness({ modules, type: 'tvm' })
  h.tool.onDown(h.event(0, 0, 2))
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(h.event(6, 0, 2))
  h.tool.multiPlace.flushPreview()
  assert.equal(h.lastPreview().mods.length, 3, 'the preview highlights every piece the line crosses')
  h.tool.onUp(h.event(6, 0, 2))
  assert.equal(useStore.getState().station.modules.length, 0)
  assert.equal(useStore.getState().past.length, 1)
  useStore.getState().undo()
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.id).sort(), ['bench-0', 'bench-3', 'bench-6'])
})

test('a wall-face press keeps its course and face along the row', () => {
  const cells = [
    ...Array.from({ length: 11 }, (_, i) => solid(i - 2, 0, 0)),
    ...Array.from({ length: 11 }, (_, x) => [1, 2, 3, 4, 5].map((z) => solid(x - 2, 1, z))).flat(),
  ]
  const h = harness({ cells, type: 'billboard-standard' })
  const wallHit = (x) => ({
    clientX: x * 20,
    clientY: 20,
    button: 0,
    buttons: 1,
    shiftKey: false,
    preventDefault() {},
    hit: {
      cell: [x, 1, 4],
      place: [x, 0, 4],
      solid: true,
      normal: [0, -1, 0],
      point: [x + 0.5, 1, 4.5],
    },
  })
  h.tool.onDown(wallHit(0))
  assert.equal(h.drag.current.lineWall.course, 4, 'the pointed wall course is captured')
  const courseZ = h.drag.current.anchor[2]
  assert.ok(courseZ > 1, 'the aimed course lifts the panel above the floor row')
  h.drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
  h.tool.onMove(wallHit(5))
  h.tool.multiPlace.flushPreview()
  h.tool.onUp(wallHit(5))
  const placed = useStore.getState().station.modules
  assert.deepEqual(placed.map((m) => [m.x, m.y, m.rot]), [[0, 0, 2], [2, 0, 2], [4, 0, 2]])
  assert.ok(placed.every((m) => Math.abs(m.z - courseZ) < 1e-9), 'the row keeps one course')
  assert.equal(useStore.getState().past.length, 1)
})

test('a fence run takes the same 间隔 as a decor row', () => {
  const h = harness({ type: 'fence', spacing: 2 })
  h.dragTo([0, 0], [6, 0])
  assert.deepEqual(useStore.getState().station.modules.map((m) => m.x), [0, 3, 6])
  assert.equal(useStore.getState().past.length, 1)
})

test('pillars, 屏蔽端门 and courts now lay in a line too', () => {
  const pillars = harness({ type: 'pillar-slim' })
  pillars.dragTo([0, 0], [2, 0])
  assert.deepEqual(useStore.getState().station.modules.map((m) => [m.type, m.x, m.cfg.height]), [
    ['pillar', 0, 5], ['pillar', 1, 5], ['pillar', 2, 5],
  ])
  assert.equal(useStore.getState().past.length, 1)

  const screens = harness({ type: 'psd-end' })
  screens.dragTo([0, 0], [2, 0])
  const screenRun = useStore.getState().station.modules
  assert.deepEqual(screenRun.map((m) => [m.type, m.x, m.cfg.psd]), [
    ['psd-end', 0, 'half'], ['psd-end', 1, 'half'], ['psd-end', 2, 'half'],
  ])
  assert.equal(useStore.getState().past.length, 1)

  // The street at z = 0 is the floor, so a row of 14 × 7 m courts needs no
  // hand-laid cells; the pitch is the court's own long side.
  const courts = harness({ type: 'court-pickleball' })
  courts.dragTo([0, 0], [14, 0])
  const courtRun = useStore.getState().station.modules
  assert.equal(courtRun.length, 2)
  assert.deepEqual(courtRun.map((m) => [m.type, m.x, m.rot]), [['court', 0, 0], ['court', 14, 0]])
  assert.equal(useStore.getState().past.length, 1)
})

test('the spacing tile cycles the same seven options as the tool', () => {
  const action = readFileSync(new URL('../src/app/rail/actions/ActionRow.tsx', import.meta.url), 'utf8')
  const tile = readFileSync(new URL('../src/app/rail/shared/SpacingTile.tsx', import.meta.url), 'utf8')
  assert.match(action, /supportsLinePlacement/)
  assert.match(action, /SpacingTile/)
  assert.match(action, /state\.cycleLineSpacing/)
  assert.match(tile, /LINE_SPACING_OPTIONS/)
  assert.match(tile, /SPACING_BOX_COUNT/)
  assert.match(tile, /spacingActiveBoxes/)
  assert.match(tile, /<Block/, 'the control is one square action tile like the other builders')
  assert.match(tile, /onCycle/)
  assert.doesNotMatch(tile, /useStore\(/, 'the retained row control takes its action from the snapshot')
})
