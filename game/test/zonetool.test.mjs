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
  const modulePreviews = []
  let cleared = 0
  const scene = {
    setGhost: () => {},
    setModulePreview: (modules, blocked) => modulePreviews.push({ modules: modules ?? [], blocked }),
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
    modulePreviews,
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

/** A 10 × 10 slab of floor at `z`, on the implicit street when `z > 0`. */
function roomStation(z = 0, activeZ = 0) {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z, fill: 'solid', finish: { top: 'floor.granite' } })
  useStore.setState({
    tool: 'zone', zoneBrush: 'ticket', facilityRot: 0, activeZ, notice: null, past: [], future: [],
    station: toState({ name: 't', seed: 1, cells, modules: [], lines: [] }),
  })
}

/** One pointer event; the pick is the cell the pointer is over. */
function press(cell, clientX = 0, clientY = 0, button = 0) {
  return {
    clientX,
    clientY,
    button,
    buttons: button === 2 ? 2 : 1,
    shiftKey: false,
    hit: { cell, place: [cell[0], cell[1], cell[2] + 1], solid: true, point: [cell[0] + 0.5, cell[1] + 0.5] },
    preventDefault: () => {},
  }
}

/** The same event with the ray missing every block and landing on the work plane. */
function pressPlane(cell, clientX = 0, clientY = 0) {
  return {
    ...press(cell, clientX, clientY),
    hit: { cell, place: cell, solid: false, point: [cell[0] + 0.5, cell[1] + 0.5] },
  }
}

/**
 * A 2 × 2 floor at grade with a wall course standing in its north-west cell: four
 * solid tiles, and exactly three of them are floor — (1, 1, 0) has its top buried.
 * The floor tiles wear a finish, which is what a laid pavement does and what keeps
 * a record in the document when its zone label comes off (a bare solid at grade is
 * the plane itself, and would go with the label — `eraseZoneCells`).
 *
 * (2, 0, 0) stands beside them as a **吊顶** tile: solid, exposed, walkable on top —
 * and still not floor, because a ceiling belongs to the room under it, never to the
 * brush (§4.5).
 */
function station() {
  const cells = []
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) cells.push({ x, y, z: 0, fill: 'solid', finish: { top: 'floor.granite' } })
  cells.push({ x: 1, y: 1, z: 1, fill: 'solid' })
  cells.push({ x: 2, y: 0, z: 0, fill: 'solid', tags: ['suspended-ceiling'], finish: { top: 'ceil.baffle', bottom: 'ceil.baffle' } })
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
  // A 吊顶's own top is exposed and walkable, so only the tag rule refuses it: the
  // brush must say the same thing here as over a wall coping.
  tool.onDown(press([2, 0, 0]))
  assert.equal(zoneDrag.current, null, 'a press on the ceiling opened a drag')
  assert.equal(useStore.getState().notice, '分区只能画在地板上')
  tool.onUp(press([2, 0, 0]))
  assert.equal(zoneAt(useStore.getState().station.cells, 2, 0, 0), 'none', 'a zone was written onto the 吊顶')
})

test('hovering a tile that is not floor draws no zone ghost', () => {
  station()
  const { tool, faceGhosts, cleared } = ctxFor()
  tool.onMove(press([1, 1, 0]))
  assert.equal(faceGhosts.length, 0, 'the brush promised a zone on a tile it cannot paint')
  assert.ok(cleared() > 0, 'and left the previous ghost up')
  // The 吊顶 is the same answer: no ghost over a ceiling.
  tool.onMove(press([2, 0, 0]))
  assert.equal(faceGhosts.length, 0, 'the brush promised a zone on a 吊顶')
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

for (const kind of ['store', 'toilet', 'office']) {
  test(`${kind} is an ordinary room-color paint and never builds a room or walls`, () => {
    station()
    const before = useStore.getState().station
    const paintedCells = before.cells.map((c) => ({ ...c, zone: 'paid' }))
    useStore.setState({ zoneBrush: kind, station: toState({ ...before, cells: paintedCells }) })
    const { tool, modulePreviews } = ctxFor()
    tool.onDown(press([0, 0, 0]))
    tool.onUp(press([0, 0, 0]))

    const next = useStore.getState().station
    const painted = next.cells.find((c) => c.x === 0 && c.y === 0 && c.z === 0)
    assert.equal(painted.room, kind, 'the tile writes its room-purpose color label')
    assert.equal(painted.zone, 'paid', 'the fare zone remains available to gate logic')
    assert.equal(next.cells.length, before.cells.length, 'painting an existing floor adds no wall or floor cells')
    assert.deepEqual(next.modules, [], 'painting creates no room, door or furniture modules')
    assert.ok(modulePreviews.every((preview) => preview.modules.length === 0), 'room paints never preview facility modules')
    assert.equal(next.cells.some((c) => c.x === 0 && c.y === 0 && c.z === 1), false, 'painting adds no wall above the floor')
  })
}

test('a booth drag previews its desktop front and opposite benches, then places that rotation', () => {
  roomStation()
  const { tool, zoneDrag, modulePreviews } = ctxFor()
  tool.onDown(press([2, 2, 0], 0, 0))
  zoneDrag.current.downTime = performance.now() - 1000
  const target = press([5, 5, 0], 40, 40)
  tool.onMove(target)
  tool.multiPlace.flushPreview()
  let preview = modulePreviews.at(-1).modules
  assert.equal(preview.find((m) => m.type === 'booth').cfg.front, 0)
  assert.deepEqual(preview.filter((m) => m.type === 'bench').map((m) => [m.x, m.y, m.rot]), [[3, 4, 2], [4, 4, 2]])

  useStore.getState().rotateFacility()
  tool.refreshFacilityPreview()
  preview = modulePreviews.at(-1).modules
  assert.equal(preview.find((m) => m.type === 'booth').cfg.front, 1, 'R updates the visible counter front during the drag')
  assert.deepEqual(preview.filter((m) => m.type === 'bench').map((m) => [m.x, m.y, m.rot]), [[2, 3, 3], [2, 4, 3]])

  tool.onUp(target)
  const placed = useStore.getState().station.modules
  assert.equal(placed.find((m) => m.type === 'booth').cfg.front, 1, 'release places the previewed front')
  assert.deepEqual(placed.filter((m) => m.type === 'bench').map((m) => [m.x, m.y, m.rot]), [[2, 3, 3], [2, 4, 3]])
  assert.deepEqual(modulePreviews.at(-1).modules, [], 'release clears the 3D preview')
})

test('a counter stands on the block under the pointer, not on the active storey', () => {
  // A slab one block above grade: the 售票亭 belongs on it, not on the street cell
  // the storey ladder names (which is what the room tool used to place it on).
  roomStation(1)
  const { tool, zoneDrag, modulePreviews } = ctxFor()
  tool.onDown(press([2, 2, 1], 0, 0))
  zoneDrag.current.downTime = performance.now() - 1000
  const target = press([5, 5, 1], 40, 40)
  tool.onMove(target)
  tool.multiPlace.flushPreview()
  const preview = modulePreviews.at(-1).modules
  assert.equal(preview.find((m) => m.type === 'booth').z, 1, 'the ghost follows the slab under the pointer')
  tool.onUp(target)
  const placed = useStore.getState().station.modules
  const booth = placed.find((m) => m.type === 'booth')
  assert.equal(booth.z, 1, 'the booth stands on the slab it was drawn on')
  assert.deepEqual(placed.filter((m) => m.type === 'bench').map((m) => m.z), [1, 1], 'its staff benches stand on the same slab')
})

test('a drag started on a wall course stands on the floor that wall was raised from', () => {
  // Aiming at the room's own wall rather than its floor is an ordinary press: the
  // wall's foot is the block the counter stands on, so walking down the column
  // keeps the room at the slab's level instead of lifting it onto the wall.
  roomStation(1)
  const st = useStore.getState().station
  useStore.setState({
    station: toState({ ...st, cells: [...st.cells, { x: 1, y: 1, z: 2, fill: 'solid', tags: ['wall'] }] }),
  })
  const { tool, zoneDrag } = ctxFor()
  tool.onDown(press([1, 1, 2], 0, 0))
  zoneDrag.current.downTime = performance.now() - 1000
  const target = press([4, 4, 2], 40, 40)
  tool.onMove(target)
  tool.onUp(target)
  const booth = useStore.getState().station.modules.find((m) => m.type === 'booth')
  assert.equal(booth.z, 1, 'the wall course names the floor it was raised from')
  assert.deepEqual([booth.x, booth.y], [1, 1], 'the pressed wall cell is still the rectangle corner')
})

test('a counter drawn from the open work plane keeps the storey being edited', () => {
  // A ray that hits no block anchors to the work plane, which already names the
  // active storey's floor cell — the block-under-the-pointer rule must not drop it
  // to whatever happens to be below.
  roomStation(5, 5)
  const { tool, zoneDrag } = ctxFor()
  tool.onDown(pressPlane([2, 2, 5], 0, 0))
  zoneDrag.current.downTime = performance.now() - 1000
  const target = press([5, 5, 5], 40, 40)
  tool.onMove(target)
  tool.onUp(target)
  const booth = useStore.getState().station.modules.find((m) => m.type === 'booth')
  assert.equal(booth.z, 5, 'the work plane still anchors the edited storey')
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
  assert.equal(useStore.getState().notice, '这些格子没有分区')
  assert.equal(useStore.getState().station, before, 'a no-op must not commit')
})

test('right-click on 分区 erases the floor label like the 无分区 brush without removing the floor', () => {
  station()
  const initial = useStore.getState().station
  useStore.setState({ station: toState({
    ...initial,
    cells: initial.cells.map((cell) => cell.x === 0 && cell.y === 0 && cell.z === 0
      ? { ...cell, zone: 'paid' }
      : cell),
  }) })
  const before = useStore.getState().station
  const { tool, zoneDrag } = ctxFor()
  // The selected brush stays paid; right-click temporarily uses 无分区.
  tool.onDown(press([0, 0, 0], 0, 0, 2))
  assert.equal(zoneDrag.current?.brush, 'none')
  tool.onUp(press([0, 0, 0], 0, 0, 2))

  const after = useStore.getState().station
  assert.equal(zoneAt(after.cells, 0, 0, 0), 'none', 'right-click removes the fare-zone label')
  assert.equal(after.cells.length, before.cells.length, 'right-click keeps the floor cell')
  assert.deepEqual(after.cells.find((c) => c.x === 0 && c.y === 0 && c.z === 0).finish, { top: 'floor.granite' })
  assert.equal(useStore.getState().zoneBrush, 'paid', 'right-click does not change the selected brush')
})

test('right-drag on 分区 clears every painted floor in its rectangle and leaves non-floor cells alone', () => {
  station()
  const before = useStore.getState().station
  useStore.setState({ station: toState({
    ...before,
    cells: before.cells.map((cell) => ({ ...cell, zone: 'paid' })),
  }) })
  const { tool, zoneDrag } = ctxFor()
  tool.onDown(press([0, 0, 0], 0, 0, 2))
  zoneDrag.current.downTime = performance.now() - 1000
  const target = press([1, 1, 0], 40, 40, 2)
  tool.onMove(target)
  tool.onUp(target)

  const after = useStore.getState().station
  for (const [x, y] of [[0, 0], [0, 1], [1, 0]]) {
    assert.equal(zoneAt(after.cells, x, y, 0), 'none', `floor (${x}, ${y}) was erased`)
  }
  assert.equal(zoneAt(after.cells, 1, 1, 0), 'paid', 'the tile under the wall is not a floor target')
  assert.equal(after.cells.length, before.cells.length, 'the drag removes labels, not floor or wall cells')
  assert.equal(useStore.getState().zoneBrush, 'paid', 'right-drag does not switch the selected brush')
})
