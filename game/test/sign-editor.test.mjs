// The 指示牌 board editor's contract, as one model (`app/store.ts`).
//
// There is **one current pair of boards** (`currentBoards`), and it is the whole of the
// signage model:
//
//   - the editor edits it. A session on a placed sign also carries that sign's id, so
//     ✓ writes the boards back to the module; a session with no id is the rail's 自定义
//     tile, and ✓ simply makes the boards current;
//   - a sign placed afterwards carries **a copy** of them, which is the point: compose
//     once, hang as many as you like;
//   - a sign already hanging keeps the boards it was placed with, so composing a new
//     one never reprints the old ones.
//
// It is a **pair**, front and back, and the two faces are independent documents: 正面 is
// what an approaching passenger reads, 背面 is what someone coming the other way reads,
// and the back starts empty — a one-sided sign is a real sign. Both travel together
// through every path here, because the two plates share one panel: writing one face
// without the other would leave the pair disagreeing about the sign they hang on.
//
// The editor is also a modal, and it is open while **either** `signEditorFor` or
// `signComposing` is set. That pair is what a close has to clear, and getting it wrong
// is invisible in a type-check and fatal in the hand: a ✕ that clears only one of them
// leaves a modal that cannot be closed.
//
// Everything the player arranges before ✓ is a **preview**: drawn in place of the
// module's own boards (`signModuleWithPreview`), never written to the document and
// never pushed onto the undo stack — once per dragged bin was the alternative.
import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore, signModuleWithPreview } from '../src/app/store.ts'
import { createModule, toState } from '../src/build/model.ts'
import { settleSignBoards } from '../src/sim/sign.ts'
import { drawSignPanel } from '../src/render/signFace.ts'
import { signBoardsPanel, signPlate } from '../src/sim/sign.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

const LINE = {
  id: '5',
  name: '5号线',
  colour: '#a6224a',
  stock: 'B',
  cars: 6,
  power: 'third-rail',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 420,
  terminus: 'through',
  direction: 'up',
  upTerminus: '',
  downTerminus: '',
  travelSign: 1,
  stations: [],
}

/** One more mark, as the editor would make it, to tell two boards apart. */
const EXTRA = { id: 'zz', kind: 'icon', icon: 'lift', x: 0, y: 0.35, scale: 1, side: 'both' }
/**
 * A pair as the store would hold it. The editor and every write path settle the boards
 * they are handed (`settleSignBoards`), so a test that compares against a raw draft
 * would be comparing against a board nobody ever stores — a mark's `x` is not what it
 * says, it is its place in the row.
 */
const settled = (front, back = []) => settleSignBoards({ front, back })
const longerThan = (board) => settled([...board, EXTRA]).front
/** A back board to hang on a sign, to tell the two faces apart. */
const BACK = settled([], [{ id: 'bk', kind: 'text', text: '电梯', x: 0, y: 0.35, scale: 1, side: 'both' }]).back

/**
 * A store holding one placed 指示牌, with the editor closed and the current boards set
 * to that sign's own — the state the app is in after a fresh load.
 */
function stationWithSign() {
  const built = createModule('sign', 2, 3, 0, 'sign-1', 0, undefined, 'up', 'right', [LINE])
  assert.ok(built, 'the sign module should build')
  const state = toState({
    name: '编辑器测试',
    seed: 1,
    cells: [{ x: 2, y: 3, z: 0, fill: 'solid' }, { x: 2, y: 3, z: 4, fill: 'solid' }],
    modules: [built],
    lines: [LINE],
  })
  useStore.getState().closeSignEditor()
  const mod = state.modules[0]
  const boards = { front: mod.cfg.front, back: mod.cfg.back }
  useStore.setState({ station: state, currentBoards: boards, past: [], future: [] })
  return { boards, board: boards.front }
}

const moduleBoards = () => {
  const mod = useStore.getState().station.modules.find((m) => m.id === 'sign-1')
  return { front: mod.cfg.front, back: mod.cfg.back }
}
const undoDepth = () => useStore.getState().past.length + useStore.getState().future.length
const editorOpen = () => {
  const st = useStore.getState()
  return st.signEditorFor !== null || st.signComposing
}

test('the editor opens on a pair of boards and a close clears the session', () => {
  const { boards } = stationWithSign()
  assert.equal(editorOpen(), false, 'the editor starts closed')

  // Opening a placed sign opens **its** boards as the current ones, and draws them in place.
  useStore.getState().openSignEditor('sign-1')
  assert.equal(editorOpen(), true)
  assert.equal(useStore.getState().signEditorFor, 'sign-1')
  assert.equal(useStore.getState().signComposing, false)
  assert.deepEqual(useStore.getState().currentBoards, boards)
  assert.deepEqual(useStore.getState().signPreview.boards, boards)

  useStore.getState().closeSignEditor()
  assert.equal(editorOpen(), false, '✕ / ✓ must actually close the editor')
  assert.equal(useStore.getState().signEditorFor, null)
  assert.equal(useStore.getState().signPreview, null)
  assert.deepEqual(useStore.getState().currentBoards, boards, 'and the current boards survive it')

  // The rail's 自定义 tile: the other way in, on the current boards, with no module.
  useStore.getState().openSignComposer()
  assert.equal(editorOpen(), true)
  assert.equal(useStore.getState().signEditorFor, null)
  assert.equal(useStore.getState().signComposing, true)
  assert.equal(useStore.getState().signPreview, null, 'nothing is drawn over the station')
  assert.deepEqual(useStore.getState().currentBoards, boards, 'it opens on the current boards')
  useStore.getState().closeSignEditor()
  assert.equal(editorOpen(), false, 'closing the composer closes the editor')
  assert.deepEqual(useStore.getState().currentBoards, boards, 'and the boards are still current')

  // None of it touched the module.
  assert.deepEqual(moduleBoards(), boards)
})

test('a fresh sign starts one-sided: a default front and an empty back', () => {
  // The back is not a copy of the front — it is a board nobody has composed, so the piece
  // shows its own black lightbox from behind until the player says otherwise. This is
  // what a bare module is built with...
  const fresh = createModule('sign', 1, 1, 0, 'bare', 0, undefined, 'up', 'right', [LINE])
  assert.ok(fresh.cfg.front.length > 0, 'the front is composed for a new sign')
  assert.deepEqual(fresh.cfg.back, [], 'and the back is empty')
  // ...and the same shape the store's own current pair starts in, which is what the
  // first sign placed carries.
  const current = useStore.getState().currentBoards
  assert.ok(current.front.length > 0, 'the current front is composed')
  assert.deepEqual(current.back, [], 'and the current back is empty')
  // The editor opens on the front, so the empty back is never what the player first sees.
  useStore.getState().openSignComposer()
  assert.deepEqual(useStore.getState().currentBoards, current, 'the composer opens on the current pair')
  useStore.getState().closeSignEditor()
})

test('arranging is a preview: drawn, never committed, dropped on ✕', () => {
  const { boards, board } = stationWithSign()
  // The player composes a **back** as well: both faces are arranged and both are previews.
  const longer = { front: longerThan(board), back: BACK }

  useStore.getState().openSignEditor('sign-1')
  const before = undoDepth()
  const docVersion = useStore.getState().version
  const redraws = useStore.getState().signVersion

  useStore.getState().previewSignLayout(longer)
  const st = useStore.getState()
  // A live preview on a **placed** sign is the one thing the scene has to redraw, and
  // it says so on its own counter — `signVersion`. The document's `version` stays put,
  // because a preview is not a document edit: that counter is what the undo stack and
  // every other reader of the document key off (`Viewport`'s rebuild effect watches
  // both, since the redraw a preview asks for is the same `setStation`).
  assert.ok(st.signVersion > redraws, 'the preview asks for a redraw of the sign it is on')
  assert.equal(st.version, docVersion, 'and it is still not a document edit')
  // It follows the current boards, and it is what the model draws on the sign...
  assert.deepEqual(st.currentBoards, longer)
  assert.deepEqual(st.signPreview.boards, longer)
  const drawn = st.station.modules.find((m) => m.id === 'sign-1')
  assert.deepEqual(signModuleWithPreview(drawn, st.signPreview).cfg.front, longer.front, 'the sign draws the front being arranged')
  assert.deepEqual(signModuleWithPreview(drawn, st.signPreview).cfg.back, longer.back, 'and the back')
  assert.deepEqual(signModuleWithPreview(drawn, null).cfg.front, board, 'and its own front when nothing is open')
  assert.deepEqual(signModuleWithPreview(drawn, null).cfg.back, [], 'and its own empty back')

  // ...and it is not an edit: the document and the undo stack are untouched, however
  // many times the player drags a bin.
  useStore.getState().previewSignLayout({ front: board, back: [] })
  useStore.getState().previewSignLayout(longer)
  assert.deepEqual(moduleBoards(), boards, 'uncommitted boards never reach the document')
  assert.equal(undoDepth(), before, 'uncommitted boards never reach the undo stack')

  // ✓ writes them once, and drops the preview with them.
  useStore.getState().commitSignLayout(longer)
  assert.equal(useStore.getState().signPreview, null, 'kept boards leave no preview behind')
  assert.deepEqual(moduleBoards(), longer, '✓ is what writes the boards')
  assert.deepEqual(useStore.getState().currentBoards, longer, 'and what makes them current')
  useStore.getState().closeSignEditor()
  assert.deepEqual(moduleBoards(), longer, 'and they are still there after the editor closes')

  // ✕ throws the edit away — the editor's ✕ is `restoreSignLayout(opened)` then
  // `closeSignEditor` — and leaves the boards the sign was placed with.
  useStore.getState().openSignEditor('sign-1')
  useStore.getState().previewSignLayout({ front: board, back: [] })
  useStore.getState().restoreSignLayout(longer)
  useStore.getState().closeSignEditor()
  assert.deepEqual(moduleBoards(), longer, '✕ leaves the boards the sign holds')
  assert.deepEqual(useStore.getState().currentBoards, longer, 'and the current boards with them')
  assert.equal(useStore.getState().signPreview, null)
  assert.equal(editorOpen(), false)
})

test('editing a wall 指示牌 keeps it on its wall, and never gives it a back', () => {
  // The **mount** is the piece's own (`cfg.mount`), not the editor's: a wall board stays
  // bolted to its wall however often its board is rearranged, and it has one face — the
  // wall is behind it — so the back the current pair may carry never reaches it.
  const built = createModule('sign-wall', 2, 3, 0, 'sign-w', 0, undefined, 'up', 'right', [LINE])
  assert.equal(built.cfg.mount, 'wall')
  const state = toState({
    name: '墙面测试',
    seed: 1,
    // The wall the piece is bolted to: two courses, which is the band it asks for.
    cells: [{ x: 2, y: 3, z: 0, fill: 'solid' }, { x: 2, y: 2, z: 1, fill: 'solid' }, { x: 2, y: 2, z: 2, fill: 'solid' }],
    modules: [built],
    lines: [LINE],
  })
  useStore.getState().closeSignEditor()
  const boards = { front: state.modules[0].cfg.front, back: [] }
  useStore.setState({ station: state, currentBoards: boards, past: [], future: [] })

  useStore.getState().openSignEditor('sign-w')
  const longer = settleSignBoards({ front: [...boards.front, EXTRA], back: [] })
  useStore.getState().commitSignLayout(longer)
  useStore.getState().closeSignEditor()
  assert.equal(useStore.getState().signEditorFor, null, 'the editor closed on the kept boards')
  const mod = useStore.getState().station.modules.find((m) => m.id === 'sign-w')
  assert.equal(mod.cfg.mount, 'wall', 'the board is still on its wall')
  assert.deepEqual(mod.cfg.front, longer.front, 'and carries what was composed')
  assert.deepEqual(mod.cfg.back, [], 'a wall board has no second face to write')
  // The **preview** carries the mount as well: a wall board being arranged is still
  // bolted to its wall, and a preview that dropped `mount` would draw the overhead
  // piece — rods and all — over a sign the player hung flat.
  const drawn = signModuleWithPreview(mod, { moduleId: 'sign-w', boards: { front: longer.front, back: [] } })
  assert.equal(drawn.cfg.mount, 'wall')
  assert.deepEqual(drawn.cfg.front, longer.front, 'and shows the board being arranged')

  // Compose a back for the **next** sign — a hung one would hang it — and the wall
  // board placed from the same pair still comes out one-sided.
  useStore.setState({ currentBoards: { front: longer.front, back: BACK } })
  const st = useStore.getState()
  const wall = createModule('sign-wall', 6, 3, 0, 'sign-w2', 0, undefined, 'up', 'right', st.station, st.currentBoards)
  const hung = createModule('sign-ceiling', 6, 3, 0, 'sign-c2', 0, undefined, 'up', 'right', st.station, st.currentBoards)
  assert.deepEqual(wall.cfg.front, longer.front, 'the wall board takes the current front')
  assert.deepEqual(wall.cfg.back, [], 'and drops the back the current pair carries')
  assert.deepEqual(hung.cfg.back, BACK, 'while the hung board hangs it')
})

test('✓ makes a pair current, and the next sign is hung with a copy of it', () => {
  const { board } = stationWithSign()
  const longer = { front: longerThan(board), back: BACK }

  // Compose a pair with no module behind it, as the rail's 自定义 tile does: ✓ makes it
  // current, and nothing is written to the station yet.
  useStore.getState().openSignComposer()
  useStore.getState().previewSignLayout(longer)
  assert.deepEqual(useStore.getState().currentBoards, longer)
  assert.deepEqual(moduleBoards().front, board, 'composing does not reprint the sign already hanging')
  useStore.getState().commitSignLayout(longer)
  useStore.getState().closeSignEditor()
  assert.deepEqual(useStore.getState().currentBoards, longer, '✓ makes the boards current')
  const before = useStore.getState().station.modules.length

  // The next sign placed carries them — this is the bug the whole model exists to stop:
  // a composed board that the piece did not actually hang. Both faces travel, because a
  // sign is its two boards.
  const st = useStore.getState()
  const placed = createModule('sign', 6, 3, 0, 'sign-2', 0, undefined, 'up', 'right', st.station, st.currentBoards)
  assert.equal(placed.type, 'sign')
  assert.deepEqual(placed.cfg.front, longer.front, 'a new sign is hung with the current front')
  assert.deepEqual(placed.cfg.back, longer.back, 'and the current back')
  // And it is a **copy**: re-composing must not reprint a sign that is already up.
  placed.cfg.front[0].x = 99
  placed.cfg.back[0].x = 99
  assert.notEqual(useStore.getState().currentBoards.front[0].x, 99, 'the placed front is its own copy')
  assert.notEqual(useStore.getState().currentBoards.back[0].x, 99, 'and so is the placed back')

  // The sign already hanging kept its own boards through all of it.
  assert.deepEqual(moduleBoards().front, board, 'an old sign keeps the front it was placed with')
  assert.deepEqual(moduleBoards().back, [], 'and its empty back')
  assert.equal(useStore.getState().station.modules.length, before)

  // Editing the old sign opens *its* boards, and ✓ makes them the current ones — so the
  // next sign placed carries the old sign's boards rather than an older draft. (✓ also
  // lays each board out on the bins it is made of, so the comparison is against the
  // settled pair, not the raw one a reader of the module would have written.)
  useStore.getState().openSignEditor('sign-1')
  assert.deepEqual(useStore.getState().currentBoards, { front: board, back: [] })
  useStore.getState().commitSignLayout({ front: board, back: [] })
  const settled = settleSignBoards({ front: board, back: [] })
  useStore.getState().closeSignEditor()
  const next = createModule('sign', 7, 3, 0, 'sign-3', 0, undefined, 'up', 'right', useStore.getState().station, useStore.getState().currentBoards)
  assert.deepEqual(next.cfg.front, settled.front, 'and the next sign carries it')
  assert.deepEqual(next.cfg.back, [])

  // A sign placed with no current boards at all still gets a readable default front.
  const bare = createModule('sign', 8, 3, 0, 'sign-4', 0, undefined, 'up', 'right', [LINE])
  assert.ok(bare.cfg.front.length > 0, 'a bare sign is never blank on the front')
  assert.deepEqual(bare.cfg.back, [], 'and never invents a back')
})

test('the whole flow: compose both faces, ✓, place, and the station prints them', () => {
  const { board } = stationWithSign()
  // The front the player builds in the editor: the station's shield over an exit plate.
  const front = settleSignBoards({
    front: [
      { id: 'c1', kind: 'line', lineId: '5', english: true, x: 0, y: 0.35, scale: 1, side: 'both' },
      { id: 'c2', kind: 'icon', icon: 'exit', x: 0, y: 0.35, scale: 1, side: 'both' },
      { id: 'c3', kind: 'text', text: '出站\nExit', x: 0, y: 0.35, scale: 1, side: 'both' },
    ],
    back: [],
  }).front
  // ...and the back, which is a different board entirely: the label that sends people the
  // other way.
  const back = settleSignBoards({ front: [], back: BACK }).back
  const composed = { front, back }

  // 1. Compose it (the rail's 自定义 tile) and keep it with ✓, the way the editor's
  //    own handler does: `commitSignLayout(boards)` then close.
  //    Boards composed for the **next** sign are on nobody's screen, so composing must
  //    ask the scene for no rebuild at all: the preview counter stays exactly where it
  //    was (`version` is what used to move here, once per keystroke).
  const before = useStore.getState().signVersion
  useStore.getState().openSignComposer()
  useStore.getState().previewSignLayout(composed)
  useStore.getState().commitSignLayout(composed)
  useStore.getState().closeSignEditor()
  assert.equal(useStore.getState().signComposing, false, '✓ closed the editor')
  assert.equal(useStore.getState().signVersion, before, 'composing the next sign redraws nothing')
  assert.deepEqual(useStore.getState().currentBoards, composed, '✓ made the boards current')

  // 2. Hang the next sign with them, exactly as the placement path does: `createModule`
  //    is handed the station's lines and the **current** boards.
  const st = useStore.getState()
  const placed = createModule('sign', 9, 3, 0, 'sign-9', 0, undefined, 'up', 'right', st.station, st.currentBoards)
  assert.equal(placed.type, 'sign')
  assert.deepEqual(placed.cfg.front, composed.front, 'the placed sign carries the composed front')
  assert.deepEqual(placed.cfg.back, composed.back, 'and the composed back')

  // 3. And the station now prints both: draw each board at the size the model's own
  //    plates share, through the real renderer. The two faces are two plates on one piece
  //    of steel, so both are cut to the pair's panel.
  const pair = { front: placed.cfg.front, back: placed.cfg.back }
  const panel = signBoardsPanel(pair)
  const plate = signPlate(panel)
  const painted = (layout, face) => {
    const { g, ops } = stubCanvas(plate.width, plate.height)
    drawSignPanel(g, layout, { lines: useStore.getState().station.lines, panel }, face)
    return ops
  }
  // A printed front: the shield in the station's own colour, the 出口 plate in its green,
  // and every word — the line's name and gloss, the plate's 出/EXIT, and the label's two
  // rows. A board that came out black would be the ground alone.
  const face = painted(pair.front, 'left')
  assert.ok(face.filled.includes('#a6224a'), `the shield prints in the station’s line colour: ${JSON.stringify(face.filled)}`)
  assert.ok(face.filled.includes('#1f9c5e'), 'the exit plate prints its green')
  assert.deepEqual(face.texts, ['5号线', 'Line 5', '出', 'EXIT', '出', '站', 'E', 'x', 'i', 't'], `the front prints its marks: ${JSON.stringify(face.texts)}`)
  // And a printed **back**, which is the front's marks and nothing of the front: the two
  // faces are independent documents, printed on the two plates of one sign.
  const reverse = painted(pair.back, 'right')
  assert.ok(!reverse.filled.includes('#a6224a'), 'the back does not print the front’s shield')
  assert.ok(!reverse.filled.includes('#1f9c5e'), 'nor the front’s exit plate')
  assert.deepEqual(reverse.texts, ['电', '梯'], `the back prints its own board: ${JSON.stringify(reverse.texts)}`)
  // The sign already hanging was not reprinted by any of it.
  assert.deepEqual(moduleBoards().front, board, 'the old sign kept its own front')
  assert.deepEqual(moduleBoards().back, [], 'and its empty back')
})
