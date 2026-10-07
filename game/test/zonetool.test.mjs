// The 分区 tool's own press/release path (§4.5): a fare zone is painted on **floor**.
//
// `zones.test.mjs` pins the floor rule in the model — the brush's rectangles and
// the bucket. This pins the *click*: the pointer's own path through `ZoneTool`,
// which asks the viewport's floor key set (`ToolContext.floors`, built by
// `zoneFloorKeys`) and has to say why when the tile under it is not floor. The set
// is built here the way `app/Viewport.tsx` builds it — `withGround` plus
// `zoneFloorKeys` — so the two cannot drift apart unnoticed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toState, zoneAt, zoneFloorKeys } from '../src/build/model.ts'
import { withGround } from '../src/sim/ground.ts'
import { useStore } from '../src/app/store.ts'
import { ZoneTool } from '../src/app/tools/ZoneTool.ts'

/** A ToolContext with the scene stubbed to a recorder, as the 方块 tool's test does. */
function ctxFor() {
  const faceGhosts = []
  let cleared = 0
  const scene = {
    setGhost: () => {},
    setFaceGhost: (cells, face, colour) => faceGhosts.push({ cells, face, colour }),
    clearFaceGhost: () => {
      cleared++
    },
    setCursor: () => {},
  }
  const ref = (v = null) => ({ current: v })
  const zoneDrag = ref()
  return {
    faceGhosts,
    cleared: () => cleared,
    zoneDrag,
    tool: new ZoneTool({
      scene: () => scene,
      pick: () => null,
      pickModule: () => null,
      facing: () => undefined,
      solids: () => {
        const st = useStore.getState().station
        return new Set(st.cells.map((c) => `${c.x},${c.y},${c.z}`))
      },
      floors: () => {
        const st = useStore.getState().station
        return zoneFloorKeys(withGround(st.cells, st.modules))
      },
      thins: () => new Map(),
      hover: ref(),
      drag: ref(),
      paint: ref(),
      zoneDrag,
      facilityDrag: ref(),
      showMeasure: () => {},
      clearMeasure: () => {},
    }),
  }
}

/** One pointer event; the pick is the cell the pointer is over. */
function press(cell, clientX = 0, clientY = 0) {
  return {
    clientX,
    clientY,
    button: 0,
    buttons: 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid: true, point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

/**
 * A 2 × 2 floor at grade with a wall course standing in its north-west cell: four
 * solid tiles, and exactly three of them are floor — (1, 1, 0) has its top buried.
 * The floor tiles wear a finish, which is what a laid pavement does and what keeps
 * a record in the document when its zone label comes off (a bare solid at grade is
 * the plane itself, and would go with the label — `eraseZoneCells`).
 */
function station() {
  const cells = []
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) cells.push({ x, y, z: 0, fill: 'solid', finish: { top: 'floor.granite' } })
  cells.push({ x: 1, y: 1, z: 1, fill: 'solid' })
  useStore.setState({
    tool: 'zone',
    zoneBrush: 'paid',
    activeZ: 0,
    notice: null,
    past: [],
    future: [],
    station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }),
  })
}

test('a tap on a floor tile paints it', () => {
  station()
  const { tool } = ctxFor()
  tool.onDown(press([0, 0, 0]))
  tool.onUp(press([0, 0, 0]))
  assert.equal(zoneAt(useStore.getState().station.cells, 0, 0, 0), 'paid')
})

test('a press on a tile that is not floor paints nothing, and says why', () => {
  station()
  const { tool, zoneDrag } = ctxFor()
  // (1, 1, 0) carries the wall course above it, so it presents no floor.
  tool.onDown(press([1, 1, 0]))
  assert.equal(zoneDrag.current, null, 'a refused press must not open a drag')
  assert.equal(useStore.getState().notice, '分区只能画在地板上')
  tool.onUp(press([1, 1, 0]))
  // No label was written, so the cell keeps its reading — 无分区, because nobody
  // has said what an unpainted tile is (`zoneOf`).
  assert.equal(zoneAt(useStore.getState().station.cells, 1, 1, 0), 'none', 'a zone was written under the wall')
})

test('hovering a tile that is not floor draws no zone ghost', () => {
  station()
  const { tool, faceGhosts, cleared } = ctxFor()
  tool.onMove(press([1, 1, 0]))
  assert.equal(faceGhosts.length, 0, 'the brush promised a zone on a tile it cannot paint')
  assert.ok(cleared() > 0, 'and left the previous ghost up')
  tool.onMove(press([0, 0, 0]))
  assert.equal(faceGhosts.length, 1, 'floor still previews its tint')
  assert.deepEqual(faceGhosts[0].cells, [[0, 0, 0]])
})

test('a drag across the patch tints the floor it crosses and drops the rest', () => {
  station()
  const { tool, zoneDrag } = ctxFor()
  tool.onDown(press([0, 0, 0], 0, 0))
  // A deliberate drag: held long enough, and the pointer travelled.
  if (zoneDrag.current) zoneDrag.current.downTime = performance.now() - 1000
  const target = press([1, 1, 0], 40, 40)
  tool.onMove(target)
  tool.onUp(target)
  const cells = useStore.getState().station.cells
  assert.equal(zoneAt(cells, 0, 0, 0), 'paid')
  assert.equal(zoneAt(cells, 0, 1, 0), 'paid')
  assert.equal(zoneAt(cells, 1, 0, 0), 'paid')
  // The two tiles the drag could not paint keep their own reading — 无分区 —
  // rather than a zone nothing could draw.
  assert.equal(zoneAt(cells, 1, 1, 0), 'none', 'the drag painted the cell under the wall')
  assert.equal(zoneAt(cells, 1, 1, 1), 'none', 'and the wall course above it')
})

test('the 无分区 brush takes a label off, and says when there is none', () => {
  station()
  const { tool, zoneDrag } = ctxFor()
  // One zoned tile to take the label back off (the brush itself is how it got one).
  tool.onDown(press([0, 0, 0]))
  tool.onUp(press([0, 0, 0]))
  assert.equal(zoneAt(useStore.getState().station.cells, 0, 0, 0), 'paid')

  // 无分区 is the zone id the folder's last tile arms (`isEraseBrush`), and the
  // tool reads it as "take the label off" rather than "write that label".
  useStore.setState({ zoneBrush: 'none' })
  tool.onDown(press([0, 0, 0]))
  assert.ok(zoneDrag.current, '无分区 drags like the brush it erases')
  tool.onUp(press([0, 0, 0]))
  const cells = useStore.getState().station.cells
  assert.equal(zoneAt(cells, 0, 0, 0), 'none', 'the label came off: the tile reads 无分区 again')
  assert.equal(
    cells.some((c) => c.x === 0 && c.y === 0 && c.z === 0 && c.zone !== undefined),
    false,
    'and no label was left behind — 无分区 is a reading, not a record',
  )
  // A tile with nothing on it: 无分区 is a no-op, and it says so rather than
  // committing an edit that changes nothing.
  const before = useStore.getState().station
  useStore.setState({ notice: null })
  tool.onDown(press([0, 1, 0]))
  tool.onUp(press([0, 1, 0]))
  assert.equal(useStore.getState().notice, '这些格子上没有分区')
  assert.equal(useStore.getState().station, before, 'a no-op must not commit')
})
