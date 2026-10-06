// The 指示牌 board editor (§5.8 custom text signage) — a modal, on demand.
//
// It is **two boards**, and they are shown as the two things they are:
//
//   1. **正面 and 背面** — a labelled row of bins each. A 指示牌 is read from both
//      sides of the concourse, so each side prints its own wayfinding: the front
//      is what an approaching passenger reads, the back is what someone coming the
//      other way reads, and they are independent lists. The 背面 row starts
//      **empty** — a one-sided sign is a real sign — and an empty row still has
//      its one place, so there is somewhere to drop the first mark.
//   2. **the four groups** — 箭头, 图标, 线路 or 文字, each a tab showing what it
//      makes, and one open at a time: the open group's palette folds out in the well
//      **under the tabs**.
//   3. **the open group's palette** — every option it offers, one square each, in a
//      wrapped grid. The palette is **shared**: the same tile drags onto either row,
//      and the row it lands in is the face it prints on. Nothing in it is unique — a
//      mark may be laid down as many times as the board has places.
//
// The modal is laid out the way it is used — **library on the left, boards on the
// right** — so the gesture runs left to right: a tile is picked up out of the library
// and put down on a board, and the board's own right-hand end, where the drag comes to
// rest, is where the bin stands. ✕ is in the header, top left, as a modal's close is.
//
// A bin is a **place in a list**, and the list it belongs to is the face whose row
// it is: an item may be dropped into a bin, from one bin into another **on the same
// face**, and nowhere else. Bin order is list order, all the way down to the model
// (`packSignRow`); dragging across the two rows would put a front board's mark on
// the back one, which is not a reorder but a different sign.
//
// A drag that ends **off** the rows — and off the two places that destroy what they are
// given — puts the mark back where it was. The two that destroy are the rail's bin and,
// for a mark lifted off a board, the **library** itself: the shelves are where a tile came
// from, so carrying one back into them is how it is given up, the same gesture run the
// other way (`pointerOverLibrary` → `endDrag`). A palette tile let go in the shelves has left
// nothing behind and simply stays there.
//
// There is no second view of either board, because a bin already *is* the board:
// every tile — a place, a group, a palette option, the mark in the air — is drawn
// with the *same* code as the sign (`render/signFace.ts` into a canvas, one metre to
// the tile), so a tile shows the black plate, the pictogram, the arrow or the shield
// that will be printed, and a row of bins is the board read left to right. No tile
// carries lettering: a name would be a second, worse picture of the thing.
//
// The action cluster under the boards is the bin and the two acts: **✓** keeps the edit and
// **✕** — in the header — throws it away. Nothing reaches the station's undo stack until ✓
// (`store.previewSignLayout` → `commitSignLayout`), so a half-arranged board is not an edit.
//
// The presentation sub-parts are their own units: the tile pictures (`tileArt.tsx`), the
// palette (`palette.tsx`), a row of places (`BinStrip.tsx`), the 文字 boxes (`TextFields.tsx`)
// and the carried ghost (`dragGhost.ts`). This file owns the drag state that binds them.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store.ts'
import { Icon } from '../../LeftRail.tsx'
import {
  SIGN_ARROWS,
  SIGN_COMPONENT_MAX,
  settleSignBins,
  signLayoutCarried,
  signLayoutInserted,
  signLayoutMoved,
  signMarkFits,
  type SignBoards,
  type SignComponent,
  type SignFaceName,
} from '../../../sim/sign.ts'
import { BinStrip } from './BinStrip.tsx'
import { GroupTile, MarkTile, PaletteRow } from './palette.tsx'
import { TextFields } from './TextFields.tsx'
import { makeDragGhost, moveDragGhost } from './dragGhost.ts'
import { usePictogramsReady } from './tileArt.tsx'
import {
  ARROW_ANGLE,
  DRAG_MARK_ID,
  DRAG_SLOP,
  FACE_LABEL,
  FACE_ROW_LABEL,
  SIGN_FACES,
  SIGN_GROUPS,
  SIGN_MARKS,
  TRASH_HIT,
  faceRowLayout,
  markFor,
  nextId,
  paletteMark,
  withHover,
  type SignGroupId,
} from './tokens.ts'

/**
 * The 指示牌 board editor. Mounted once at the app root and shown while the store has
 * an editing session: `signEditorFor !== null` (a placed sign) or `signComposing` (the
 * current boards alone), so it never competes with the viewport for a click.
 *
 * The **current boards** are deliberately not part of that test. They are what every
 * new sign is hung with, so they outlive the modal — and an open test of "are boards
 * set" left the editor up with its own ✕ unable to close it.
 */
export function SignEditor(): React.ReactElement | null {
  // Every tile in the modal is a picture of the mark it makes, and a pictogram's
  // picture is a bitmap, so the modal waits on the art — however it was opened.
  const ready = usePictogramsReady()
  const open = useStore((s) => s.signEditorFor !== null || s.signComposing)
  const target = useStore((s) => s.signEditorFor)
  const station = useStore((s) => s.station)
  const currentBoards = useStore((s) => s.currentBoards)
  const previewSignLayout = useStore((s) => s.previewSignLayout)
  const commitSignLayout = useStore((s) => s.commitSignLayout)
  const restoreSignLayout = useStore((s) => s.restoreSignLayout)
  const closeSignEditor = useStore((s) => s.closeSignEditor)
  const setNotice = useStore((s) => s.setNotice)

  const module = target === null ? undefined : station.modules.find((m) => m.id === target)
  // The boards being edited: the module's own when the editor was opened from a placed
  // sign, else the store's **current boards** — a session always opens on one of them,
  // and `openSignEditor` has already put the module's there.
  const stored: SignBoards = module?.type === 'sign' ? { front: module.cfg.front ?? currentBoards.front, back: module.cfg.back ?? [] } : currentBoards

  // The editor's own boards: taken once, when the editor opens, and written back on
  // ✓. `opened` is what a ✕ goes back to.
  const [boards, setBoards] = useState<SignBoards>(stored)
  // **箭头 is open on a fresh session.** The library is a well of tiles, and a well that starts
  // empty says the editor has nothing to put on a board — which is the opposite of true. It is
  // also the group a sign is most often built out of, and a group is only ever *open*, never
  // required: pressing the tab shuts it again (`toggleGroup`).
  const [group, setGroup] = useState<SignGroupId | null>('arrow')
  // The face whose row the palette is currently working on: the one last touched, and
  // the one a mark added by a **click** lands on. A drag re-reads the row under the
  // pointer (`trackDrag`), so a tile let go over 背面 is a back mark without the player
  // having to point at the face first.
  const [focusedFace, setFocusedFace] = useState<SignFaceName>('front')
  // The mark picked out of a row: which board it is on, and its id. A sign is two boards,
  // so the face travels with the id — see `selected` below.
  const [selection, setSelection] = useState<{ face: SignFaceName; id: string } | null>(null)
  // The drag in flight: the mark being carried, the row it would be put down in, and the
  // place in that row. All three are null when nothing is being dragged.
  const [dragMark, setDragMark] = useState<SignComponent | null>(null)
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [hoverFace, setHoverFace] = useState<SignFaceName | null>(null)
  const opened = useRef<SignBoards>(stored)

  useEffect(() => {
    if (!open) return
    // A modal opens on its own boards: the mark that was picked belongs to the boards that
    // were just closed, so it goes with them. The library opens on 箭头 (see `group`), which
    // is what makes a fresh session show tiles rather than an empty well.
    opened.current = stored
    setBoards(stored)
    setSelection(null)
    setGroup('arrow')
    setFocusedFace('front')
    setDragMark(null)
    setInsertAt(null)
    setHoverFace(null)
    // Deliberately keyed on the session, not on `stored`: an edit writes the current
    // boards as the player works, and re-seeding on every write would fight the edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  /**
   * The refusal the editor raises when a board has no room for one more mark. Kept
   * as a constant so the success path below can recognise — and clear — exactly
   * this notice once the board has room again, instead of leaving a stale toast
   * up after the mark was moved to the other face or deleted.
   */
  const SIGN_FULL_NOTICE = '这块牌子放不下了 — 先删掉一些内容'

  /**
   * The one place a board is written: the editor's own two lists, the bins, the hover
   * ghost and the module are all this call.
   *
   * Both faces are settled together (`previewSignLayout` → `settleSignBoards`) because
   * the two plates share one panel: a mark added to the front can lengthen the steel the
   * back is printed on, so writing one face without the other would leave the pair
   * disagreeing about the sign they hang on.
   *
   * A write that went through means the board has room again, so a stale
   * board-full refusal is cleared here rather than left on the global toast for
   * its full timeout: moving the mark to the other face or deleting it is the
   * fix the notice asked for. Only this editor's own refusals are cleared — any
   * other notice is left alone.
   */
  const apply = useCallback(
    (next: SignBoards) => {
      const trimmed: SignBoards = {
        front: next.front.slice(0, SIGN_COMPONENT_MAX),
        back: next.back.slice(0, SIGN_COMPONENT_MAX),
      }
      setBoards(trimmed)
      previewSignLayout(trimmed)
      const cur = useStore.getState().notice
      if (cur === SIGN_FULL_NOTICE || cur?.startsWith('一块指示牌最多放') === true) {
        useStore.getState().setNotice(null)
      }
    },
    [previewSignLayout],
  )

  const cancel = useCallback((): void => {
    restoreSignLayout(opened.current)
    closeSignEditor()
  }, [restoreSignLayout, closeSignEditor])

  const confirm = useCallback((): void => {
    commitSignLayout(boards)
    closeSignEditor()
  }, [commitSignLayout, closeSignEditor, boards])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, cancel, confirm])

  /* ------------------------------------------------------------ the drag */

  /**
   * One gesture, used by both drags: an item comes from the palette or from the row,
   * floats above the panel under the pointer, and lands wherever the pointer is on the
   * row. The row makes room while it hovers, so the drop is never a surprise.
   *
   * The pointer position never becomes React state — a drag reports one dozens of
   * times a second and re-rendering the editor for each would stutter. The floating
   * mark is a DOM node moved by `transform`, and state changes only when the **place**
   * under the pointer changes, which is the only thing the row's own layout depends on.
   */
  const drag = useRef<{
    /**
     * The id of the mark being carried, as it stands in the board it is currently on. A
     * move renumbers it (the settle mints ids from the list's order), so this is
     * reassigned on every move rather than being the id the drag started with.
     */
    id: string | null
    payload: string
    /**
     * **The board the mark is on**, which is the board it was lifted from until a move
     * takes it to the other one, and the board it lands on afterwards. It is where a
     * cancel or a throw away has to look for the mark.
     */
    remove: { face: SignFaceName | null; id: string }
    ghost: HTMLElement | null
    /** The pointer is over the bin, so the mark is about to be thrown away. */
    overTrash: boolean
    /**
     * The pointer is over the **library** — the tiles the mark was taken from — so it is
     * about to be thrown away there instead. The two are mutually exclusive and the bin is
     * asked first: the corner plate is inside the workspace and the library is the whole
     * left column, so nothing is ever over both, and asking the bin first is what keeps a
     * drag aimed at the corner from being read as a drag back into the shelves.
     */
    overLibrary: boolean
  } | null>(null)
  const armed = useRef<{ id: string; payload: string; face: SignFaceName; x: number; y: number } | null>(null)
  const placeRef = useRef<{ face: SignFaceName; index: number } | null>(null)
  // The bin in the rail's corner, and whether the mark in the air is over it: the one
  // place a drag can end that is not a place on a board.
  const trashRef = useRef<HTMLButtonElement | null>(null)
  const [overTrash, setOverTrash] = useState(false)
  // The library, and whether the mark in the air is over it: the **other** place a drag can
  // end without putting the mark down on a board — see `pointerOverLibrary` and `endDrag`.
  const libraryRef = useRef<HTMLDivElement | null>(null)
  const [overLibrary, setOverLibrary] = useState(false)
  // The newest boards, the newest writer and the newest lines, read through refs so the
  // window listeners are bound once per session rather than once per keystroke.
  const boardsRef = useRef(boards)
  boardsRef.current = boards
  const applyRef = useRef(apply)
  applyRef.current = apply
  // Taking a mark off a board, as the listeners see it (see `remove`): the way a drag
  // that ends on the rail's bin deletes.
  const removeRef = useRef<(face: SignFaceName, id: string) => void>(() => {})
  // The editor's own toast, as the listeners see it. A drop that is refused has to say so,
  // and it is refused inside a window listener (`endDrag`, `trackDrag`) that was bound once.
  const noticeRef = useRef<(text: string) => void>(() => {})
  const linesRef = useRef(station.lines)
  linesRef.current = station.lines
  // The mark being carried, as the listeners see it: the same value as `dragMark`, but
  // readable inside a window listener that was bound once and must not go stale.
  const dragMarkRef = useRef<SignComponent | null>(null)

  /**
   * The place a pointer at `x, y` would put a mark down: **which row** it is over, and
   * its index in that row — or null when the pointer is off both rows entirely.
   *
   * The row is a list of equal squares, so the place is read off the pointer's own x:
   * every square whose centre is left of it counts. That puts a mark **before** the
   * square under the pointer on the pointer's left half and **after** it on the right,
   * and past the last square's centre it is the end of the list — which is how a mark is
   * appended (the row carries no spare place) and how it is prepended at the other end
   * (left of the first centre).
   *
   * The **row** is what makes 正面 and 背面 two boards rather than one board printed
   * twice: the row under the pointer names the face, and that face is the board the mark
   * belongs to. Each row carries its own face as `data-face` (`BinStrip`), and the bins
   * are read from *that* row, so the index counts its squares and not the other row's.
   *
   * A row with no readable face is treated as no row at all rather than as 正面. That is
   * deliberate: the fallback is what made every drop land on the front board when the
   * attribute was missing, and a drop that quietly goes somewhere other than where the
   * player aimed is worse than a drop that does not happen.
   */
  const placeAt = (x: number, y: number): { face: SignFaceName; index: number } | null => {
    const el = document.elementFromPoint(x, y)
    const hit = el?.closest?.('.bins') as HTMLElement | null
    // A hit on the row is taken as read. Anything else falls back to the nearest row
    // **within a bin's height of the pointer**, because the rows are separated by a
    // caption and a gap, and `elementFromPoint` in that band answers with the row's own
    // container: a drag aimed at the top edge of 背面 would otherwise find no row at all
    // and go nowhere. The band is what keeps that from swallowing a pointer that is
    // genuinely somewhere else on the panel.
    let row = hit
    if (!row) {
      let best = Infinity
      for (const candidate of document.querySelectorAll<HTMLElement>('.bins[data-face]')) {
        const r = candidate.getBoundingClientRect()
        const slack = r.height || 1
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
        if (dy <= slack && dx <= slack) {
          // Ties go to the row the pointer is vertically nearer, then to 正面, so the
          // band between two rows belongs to the one being aimed at rather than to
          // whichever the document happens to list first.
          const distance = dy * 1000 + dx
          if (distance < best) {
            best = distance
            row = candidate
          }
        }
      }
    }
    if (!row) return null
    const face = row.dataset.face
    if (face !== 'front' && face !== 'back') return null
    let index = 0
    for (const bin of row.querySelectorAll('.bin')) {
      const r = bin.getBoundingClientRect()
      if (x <= r.left + r.width / 2) break
      index++
    }
    return { face, index }
  }

  /**
   * True when the pointer is over the corner bin. The bin's own box is small and it sits
   * beside two buttons, so the hit area is grown by `TRASH_HIT` on every side — a drag
   * aimed at "the corner" should not have to be aimed at the glyph.
   *
   * The box is read as its **layout** size, not its painted one: the bin grows while a
   * mark is over it (`.signAct.trash.over` scales it), and a hit test that grew with the
   * button would be chasing its own state — the pointer would have to leave a bigger and
   * bigger box to shed the highlight. `offsetWidth` / `offsetHeight` are the size before
   * the transform, so what "over the bin" means does not move while the highlight is on.
   */
  const overBin = (x: number, y: number): boolean => {
    const el = trashRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    const halfW = el.offsetWidth / 2
    const halfH = el.offsetHeight / 2
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    return (
      x >= cx - halfW - TRASH_HIT &&
      x <= cx + halfW + TRASH_HIT &&
      y >= cy - halfH - TRASH_HIT &&
      y <= cy + halfH + TRASH_HIT
    )
  }

  /**
   * True when the pointer is over the **library** — the column of tiles the mark was taken
   * out of in the first place.
   *
   * Letting go here **throws the mark away**, which is the same gesture run backwards: a
   * tile is dragged out of the shelves onto a board, so dragging it back off the board and
   * into the shelves is how it is given up, and it is the way a delete is asked for that
   * needs no second target to find — the library is already the size of a column. It is
   * the second of the two ends a drag can come to that is not a place on a board, and the
   * bin is the first (`overTrash`), which is why this one is only ever asked when the
   * pointer is not on the bin.
   *
   * The box is read as written (`getBoundingClientRect`), unlike the bin's: the bin grows
   * while a mark is over it, so its hit test has to measure the layout box to keep from
   * chasing its own state — nothing about the library moves, so what "over the library"
   * means cannot drift either, and a target the size of a column needs no slack around it.
   */
  const pointerOverLibrary = (x: number, y: number): boolean => {
    const el = libraryRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  /** Move the drag to the place under the pointer, if it changed. */
  const trackDrag = (x: number, y: number, mark: SignComponent): void => {
    const d = drag.current
    if (!d) return
    // The mark in the air, made once and then moved by transform for the rest of the
    // drag: re-drawing it per pointer move would be a canvas fill per frame.
    if (!d.ghost) d.ghost = makeDragGhost(mark, linesRef.current)
    moveDragGhost(d.ghost, x, y)
    // Over the bin: the pointer is over no *place*, so the row is left exactly as it was
    // — nothing is inserted, nothing is reordered, and a mark dragged out of a bin is
    // still in it (a drag that wanders onto the bin and back off must not have moved it).
    const over = overBin(x, y)
    if (over !== d.overTrash) {
      d.overTrash = over
      setOverTrash(over)
    }
    // The library is the other throw-away target, and the bin is asked first (see the
    // drag record): a pointer over the corner plate is never read as a drag into the
    // shelves, so the two cues cannot both be lit.
    const inLibrary = !over && pointerOverLibrary(x, y)
    if (inLibrary !== d.overLibrary) {
      d.overLibrary = inLibrary
      setOverLibrary(inLibrary)
    }
    // Over **either** one the pointer is over no place, and the row is left exactly as it
    // was for the same reason in both cases: the mark has not been put down anywhere yet.
    const place = over || inLibrary ? null : placeAt(x, y)
    if (place?.face === placeRef.current?.face && place?.index === placeRef.current?.index) return
    placeRef.current = place
    setInsertAt(place === null ? null : place.index)
    setHoverFace(place === null ? null : place.face)
    // A move reorders **as it is dragged**, so the place being hovered really does hold
    // the mark by the time the pointer is released. A drag that ends off the rows changes
    // nothing.
    if (d.id === null || place === null) return
    const held = d.remove
    if (held.face === null) return
    const list = boardsRef.current[held.face]
    const at = list.findIndex((c) => c.id === d.id)
    if (at < 0) return
    const comp = list[at]
    const sameFace = held.face === place.face
    // Nothing to do when the place is already the mark's own: it holds the place it is
    // being dragged to, and re-laying the row on every pointer move would be churn.
    if (sameFace && at === place.index) return
    // **Across the two rows is a move between boards**, not a reorder: the mark leaves the
    // board it was on and joins the one it is over. Both faces are written in the one call
    // (`signLayoutCarried`), so the pair is never left holding the same mark twice — and
    // because the editor *draws* what it stores, the mark travels with the pointer from one
    // row to the other as it is carried. A drag that wanders back before it is let go simply
    // puts it back, because this is the same statement run the other way.
    //
    // The mark arrives under a **new id**, minted against the board it joins: a board numbers
    // its own marks, so the two boards are full of the same names, and a mark handed over as
    // it stands is a second `c2` in a row that already holds one (see `signLayoutCarried`).
    // The drag follows the id it now has, because the next pointer move looks the mark up by
    // id — the old one would stop finding it and the drag would die in mid-air.
    if (!sameFace) {
      // The target board has to have room for it — asked **here**, at the moment the mark
      // would change boards, and never before: a press blocks nothing (a drag may be going
      // anywhere, including to the bin, or to the other face and back), so the refusal can
      // only be about a board that is actually being committed to. The refusal itself is
      // **silent**: hovering a full board is not a commitment, and the notice fires on the
      // drop (`endDrag`) — not on every pointer move across the row.
      if (!signMarkFits(boardsRef.current[place.face], comp)) {
        return
      }
      const carried = signLayoutCarried(list, boardsRef.current[place.face], comp.id, place.index)
      d.id = carried.id
      d.remove = { face: place.face, id: carried.id }
      applyRef.current({ ...boardsRef.current, [held.face]: carried.source, [place.face]: carried.target })
      return
    }
    // A move along a row is the model's own reorder (`signLayoutMoved`), which re-states
    // every mark's place along the row: the row the player watches shifting is the row that
    // will be there when they let go. The insert-and-filter form above is for crossing
    // *between* boards — applying it within a row re-pitched the row to its bin centres and
    // lost the place the pointer had aimed at.
    applyRef.current({ ...boardsRef.current, [held.face]: signLayoutMoved(list, comp.id, place.index) })
  }

  const endDrag = (commitDrop: boolean): void => {
    const d = drag.current
    drag.current = null
    armed.current = null
    if (d?.ghost) d.ghost.remove()
    const place = placeRef.current
    placeRef.current = null
    dragMarkRef.current = null
    setInsertAt(null)
    setHoverFace(null)
    setDragMark(null)
    setOverTrash(false)
    setOverLibrary(false)
    if (!commitDrop || !d) return
    // A mark that was **on a board** is thrown away by two gestures, and by nothing else:
    // let go over the rail's bin, or let go back over the **library** of tiles it was taken
    // from (`overLibrary`). Everything else that is not a place on a row puts it back where
    // it was — a drag that wanders off the panel and comes back, or ends on the scrim, is a
    // drag the player changed their mind about, and a gesture that quietly deletes a mark
    // for being released a few pixels too far is not one anybody can use. Neither gesture
    // reaches a **palette** tile (`d.id === null`): one that is let go back in the shelves
    // has not left anything, so there is nothing to give up.
    //
    // `d.remove` names the board the mark is on **now**, which is where a move across the
    // rows last put it — not the board it was lifted from. `d.id` is read from it rather
    // than remembered, because a move renumbers the mark (`trackDrag`).
    if (d.id !== null && (d.overTrash || d.overLibrary)) {
      if (d.remove.face !== null) removeRef.current(d.remove.face, d.id)
      return
    }
    // A drop from the palette is an insert into the row it was let go over, and its own
    // drag never had a mark to throw away: let go off the rows it simply ends, and the tile
    // stays in the palette. A drop of a board mark onto the row it is already on was made
    // place by place as the pointer moved — but a mark let go over the *other* face was
    // refused live (`trackDrag` stays silent while hovering), so the drop is where its
    // refusal is said: room means it lands, none means the notice.
    if (d.id === null && place !== null) {
      const list = boardsRef.current[place.face]
      const comp = markFor(d.payload)
      // **On the drop, not on the drag**: the tile armed and carried (it may have been aimed
      // at the other face, or at the bin), and it is only here, with the row it was let go
      // over in hand, that "does this board have room" is a question about anything.
      if (comp && signMarkFits(list, comp)) {
        applyRef.current({ ...boardsRef.current, [place.face]: signLayoutInserted(list, { ...comp, id: nextId(list) }, place.index) })
      } else if (comp) {
        noticeRef.current(SIGN_FULL_NOTICE)
      }
    }
    // A board mark let go over the other face never moved there live — the hover refusal
    // is silent — so the drop decides it: it lands when there is room, and only the drop
    // says so when there is none. Let go over its own face (or off the rows) it is already
    // where it belongs and there is nothing to refuse.
    if (d.id !== null && place !== null && d.remove.face !== null && d.remove.face !== place.face) {
      const list = boardsRef.current[d.remove.face]
      const comp = list.find((c) => c.id === d.id)
      if (comp) {
        if (signMarkFits(boardsRef.current[place.face], comp)) {
          // The same cross-board statement the live hover makes (`signLayoutCarried`), under
          // a new id on the board it joins: this is the drop of a drag the hover *refused*,
          // so the mark never moved and is still written at the place it was lifted from.
          const carried = signLayoutCarried(list, boardsRef.current[place.face], comp.id, place.index)
          applyRef.current({ ...boardsRef.current, [d.remove.face]: carried.source, [place.face]: carried.target })
        } else {
          noticeRef.current(SIGN_FULL_NOTICE)
        }
      }
    }
  }

  useEffect(() => {
    if (!open) return
    const onMove = (e: PointerEvent): void => {
      const a = armed.current
      if (!a) {
        // Already dragging: the carried mark travels with the pointer.
        if (drag.current) {
          const held = dragMarkRef.current
          if (held) trackDrag(e.clientX, e.clientY, held)
        }
        return
      }
      if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) < DRAG_SLOP) return
      // The press became a drag: the mark leaves its tile (or its place in the row) and floats.
      armed.current = null
      const mark = a.id === '' ? markFor(a.payload) : (boardsRef.current[a.face].find((c) => c.id === a.id) ?? null)
      if (!mark) return
      drag.current = {
        id: a.id === '' ? null : a.id,
        payload: a.payload,
        // Where the mark is **now**: the row it was lifted from, and the row `trackDrag`
        // files it on again after each move across. It is what a drop off the rows reads to
        // know which board to take the mark off; a palette tile has no board yet (`null`),
        // which is what makes it undeletable.
        remove: { face: a.id === '' ? null : a.face, id: a.id },
        ghost: null,
        overTrash: false,
        overLibrary: false,
      }
      dragMarkRef.current = mark
      setDragMark(mark)
      trackDrag(e.clientX, e.clientY, mark)
    }
    const onUp = (): void => {
      // Letting go: a drop if a drag is in flight, otherwise the press was a click and
      // the mark it landed on has already been selected.
      if (drag.current) endDrag(true)
      armed.current = null
    }
    const onCancel = (): void => {
      armed.current = null
      if (drag.current) endDrag(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [open])

  /* ------------------------------------------------------------- editing */

  // The face the palette is working on, and the board it writes to. `focusedFace` is
  // where a mark added without a drag goes: the row the player last touched, which is
  // what makes "click 线路 twice" and "drop this arrow" both mean the board on screen.
  const layout = boards[focusedFace]
  // The picked mark, as **which** board it is on and its id. A sign is two boards, so an
  // id alone would let a pick on one row light up a mark on the other simply because the
  // two hands minted the same `c1`.
  const selected = selection?.face === focusedFace ? layout.find((c) => c.id === selection.id) : undefined
  // Where a mark added from the palette goes when nothing is dragged: the bin after
  // the picked one, else the end of the row.
  const insertIndex = selected ? layout.findIndex((c) => c.id === selected.id) + 1 : layout.length
  // What a bin lights up with: the picked mark's id, but only on the board that holds it.
  const selectedId = (face: SignFaceName): string | null => (selection?.face === face ? selection.id : null)

  /**
   * Point the palette at a face. The pick is dropped when it belongs to the other board,
   * because it was a pick **on that board**: the other row cannot show it, and keeping the
   * id would light up whatever mark happened to share it.
   */
  const focusFace = (face: SignFaceName): void => {
    setFocusedFace(face)
    setSelection((cur) => (cur !== null && cur.face !== face ? null : cur))
  }

  /**
   * Whether one more mark of this kind would still fit on the focused board, **saying so**
   * when it will not.
   *
   * **Room is measured, not counted.** A board grows to `PANEL_MAX_W` and then stops, so how
   * many marks fit depends on how wide they are: six arrows fill it, nine pictograms come
   * close, and a board of arrows has no room for a seventh. Asking the model per mark
   * (`signMarkFits`) is what keeps the palette, the board's own length and what actually gets
   * printed saying the same thing — a count here would be wrong for every kind but one, and
   * was: the palette used to hand out marks the print then stacked on top of each other.
   *
   * **Nothing calls this on a press or on a pointer move.** A drag is not a commitment: one
   * carrying a palette tile may be aimed at either face or at the bin, and one carrying a
   * board mark may be crossing between the boards. So the question is asked where a mark is
   * actually put down — `trackDrag` when a mark crosses rows, `endDrag` when a tile is let go
   * — and this is only the wording of the refusal.
   */
  const noticeFull = (comp: SignComponent): boolean => {
    if (layout.length >= SIGN_COMPONENT_MAX) {
      setNotice(`一块指示牌最多放 ${SIGN_COMPONENT_MAX} 格内容`)
      return true
    }
    if (signMarkFits(layout, comp)) return false
    setNotice(SIGN_FULL_NOTICE)
    return true
  }

  /** True when the bin has something it could be given: a mark, on either face. */
  const populated = boards.front.length > 0 || boards.back.length > 0

  /**
   * Open a group, or shut the one that is open. One group at a time: opening another folds
   * the first, which is what makes the row a set of four rather than four drawers left out.
   *
   * It is called from a group tile's **press** and from its keyboard click alike (see
   * `GroupTile`), so the group is there the moment the pointer goes down.
   */
  const toggleGroup = (id: SignGroupId): void => {
    setGroup((cur) => (cur === id ? null : id))
  }

  /**
   * The bin's other gesture: **clicked with nothing in hand, it empties both boards**. A
   * drag onto it deletes the one mark being carried (see `endDrag`); a click deletes all of
   * them, on 正面 and 背面 alike, which is the only way to start a board over in one go.
   *
   * It is one step, not two: the whole clear goes through `apply`, so ✓ makes it the board
   * and ✕ puts the old one back like any other edit. The selection goes with it — the
   * palette's text boxes would otherwise go on editing a mark that is no longer there.
   */
  const clearAll = (): void => {
    if (!populated) return
    setSelection(null)
    setGroup(null)
    apply({ front: [], back: [] })
  }

  /**
   * 线路 **adds** a shield bound to that line: nothing limits it but the board's own length,
   * so a sign may carry 5号线 five times. The new shield lands after the selected mark, which
   * is what makes clicking one line twice lay the two shields side by side.
   */
  const setLine = (lineId: string): void => {
    const comp: SignComponent = { id: nextId(layout), kind: 'line', lineId, english: true, x: 0, y: 0, scale: 1, side: 'both' }
    if (noticeFull(comp)) return
    apply({ ...boards, [focusedFace]: signLayoutInserted(layout, comp, insertIndex) })
    setSelection({ face: focusedFace, id: comp.id })
  }

  /**
   * A label is put on a board by **dragging its tile into a bin**, and by nothing else:
   * this patches a label that is already up and never inserts one, so typing is an edit
   * of what is up rather than a way to add it. (Inserting on the first keystroke dropped
   * a mark into the row at a place nobody had chosen, and every letter after it wrote the
   * board again.)
   *
   * Which label it patches is the **selected** one — the same component the text boxes
   * are showing (`TextFields` reads `selected`, not the first label it can find). Labels
   * repeat freely now, so "the first text box on the board" would mean typing into one
   * label rewrote another; a selection is what the player has actually pointed the boxes
   * at, and with nothing selected there is nothing to edit.
   */
  const setText = (text: string): void => {
    if (selected?.kind !== 'text') return
    apply({ ...boards, [focusedFace]: layout.map((c) => (c.id === selected.id ? ({ ...c, text } as SignComponent) : c)) })
  }

  /**
   * Take a mark off **one** face. Which list it came out of is read from the argument
   * rather than from the focused face, because the rail's bin is not on a row and the
   * player may have touched the other one since. Clearing the selection is part of it: a
   * mark that is gone cannot stay picked, and the palette's boxes would go on editing it.
   */
  const remove = (face: SignFaceName, id: string): void => {
    setSelection((cur) => (cur?.face === face && cur.id === id ? null : cur))
    apply({ ...boards, [face]: boards[face].filter((c) => c.id !== id) })
  }
  removeRef.current = remove
  noticeRef.current = setNotice

  /**
   * A palette tile is picked up, not clicked: pressing one **arms** a drag (`payload`,
   * no id) and only a move that clears the slop starts it.
   *
   * Every tile arms, and every tile lands: marks repeat, so there is no tile the board
   * can already have too many of — the only refusal is a board with all ten places full
   * (`full`), asked here so a tile the board cannot take costs nothing but a press.
   * Letting go without moving is a click, which is what `pickExisting` answers.
   *
   * The face it arms is the **focused** one — the row the player last touched — and
   * `trackDrag` re-reads that from whichever row the pointer is actually over, so a tile
   * dropped in 背面 is armed on the front and let go on the back.
   *
   * A press **on the bin** arms nothing, whichever tile it came from: the bin is the one
   * place a mark is not put down, and arming there would have the drag's own move handler
   * pick the press up and carry a mark the player was never carrying. It is what leaves the
   * bin free to be clicked on its own — which is how a board is emptied (see `clearAll`).
   */
  const armPaletteDrag = (payload: string, e: React.PointerEvent): void => {
    // **Nothing is refused here.** A press arms a drag and says nothing about whether the
    // mark will land: it may be aimed at either face, at the other row, or at the bin, and a
    // board that is full is no reason to stop the player picking a tile up. Whether there is
    // room is asked where the mark is put down (`trackDrag` for a crossing, `endDrag` for the
    // drop) — see `noticeFull`.
    //
    // The exception is the bin itself: a press *on* the bin arms nothing, because it is the
    // one place a mark is not put down, and arming there would have the drag's own move
    // handler pick the press up and carry a mark the player was never carrying.
    if (overBin(e.clientX, e.clientY)) return
    armed.current = { id: '', payload, face: focusedFace, x: e.clientX, y: e.clientY }
  }

  /**
   * What a click on a tile means, now that a mark is not unique: **select a label**.
   *
   * Marks repeat, so a click has no "the one already there" to fall back on, and adding
   * is what the drag is for. The one click that does real work is the text box's: a label
   * is the only mark whose palette *is* an editor for it, so a click on the 文字 tile picks
   * the focused board's first label if it has one — which is the label whose text the
   * boxes then show and edit (`TextFields`, `setText`). With no label up, the click does
   * nothing and the boxes drag a new one in.
   */
  const pickExisting = (): void => {
    const found = layout.find((c) => c.kind === 'text')
    if (found && selection?.id !== found.id) setSelection({ face: focusedFace, id: found.id })
  }

  if (!open) return null

  const lines = station.lines
  // Whether what is in the air came **off a board**, which is the only thing the library's
  // throw-away cue is for: a palette tile let go over the shelves has left nothing behind,
  // so lighting the well for it would promise a delete that does not happen. A board mark
  // keeps its own id, and a palette tile is `DRAG_MARK_ID` (`markFor`), so the two are told
  // apart by the id the drag already carries.
  const carryingBoardMark = dragMark !== null && dragMark.id !== DRAG_MARK_ID
  // Each face's own geometry, for the two things a row of tiles needs from it: the
  // settled order and the marks on it. A tile is a fixed square rather than a slice of
  // the panel, but the row is still the board: one square per mark, in order. The back
  // row is laid over `faceRowLayout`, which is what gives an empty back its one place.
  const rows = SIGN_FACES.map((face) => {
    const board = settleSignBins(faceRowLayout(boards[face]))
    // What is drawn **while a mark is in the air**: it takes the place the pointer is
    // over and the row shifts along, so the row shows the drop that is about to happen
    // rather than the one that already did. Only the row under the pointer is drawn with
    // the mark in it: the other row is a different board and never takes a mark the
    // pointer is not over.
    const shown = withHover(board.layout, hoverFace === face ? dragMark : null, hoverFace === face ? insertAt : null)
    return { face, layout: shown === board.layout ? board.layout : settleSignBins(shown).layout }
  })
  return (
    <div className="signModal" role="dialog" aria-modal="true" aria-label="指示牌编辑器">
      <div className={dragMark === null ? 'signPanel' : 'signPanel dragging'}>
        {/* 0. the header: the way out, on the **right**. It is a bar of its own rather than a
            corner of the action cluster so that ✕ is not one more button inside the gesture's
            own strip — 应用 is the act that ends an edit, and a modal's close belongs at the top
            of the frame it closes. It is deliberately **small and unnamed**: the modal is the
            指示牌 editor by virtue of being open, and a title bar with a name in it only takes
            room from the board. */}
        <div className="signHead">
          <button type="button" className="signClose" aria-label="放弃修改" onClick={cancel}>
            ✕
          </button>
        </div>

        {/* 1. the two columns. **The library on the left, the boards on the right**: the tiles
            that make a mark are a store the player takes from, and the 正面 / 背面 rows are the
            thing being built — so the panel reads the way it is used, and the gesture runs left
            to right. It also leaves the boards' own right-hand end, where a carried mark comes
            to rest, beside the bin. */}
        <div className="signBody">
          {/* 1a. the library: the four groups as a row of **tabs**, and the open group's
              options in the well under them. It is also a **drop target** — the way back
              out of a board — so it carries a ref for the drag's own hit test
              (`pointerOverLibrary`) and wears the danger tint while a mark lifted off a board is
              held over it. */}
          <div
            ref={libraryRef}
            className={['signLibrary', overLibrary && carryingBoardMark ? 'over' : ''].filter(Boolean).join(' ')}
          >
            <div className="signTabs">
              {SIGN_GROUPS.map((g) => (
                <GroupTile
                  key={g.id}
                  id={g.id}
                  lines={lines}
                  ready={ready}
                  active={group === g.id}
                  label={g.label}
                  onToggle={() => toggleGroup(g.id)}
                />
              ))}
            </div>

            {/* 1b. the open group's palette. One group is open at a time, and the well folds
                its contents in and out: the row is a `0fr → 1fr` grid row whose child clips
                what it holds, so switching group is the old palette folding away while the
                new one folds out, in one movement — the same fold the build rail's folders
                use, turned to the library's width instead of its depth. */}
            <div className="signPalette">
              <PaletteRow open={group === 'arrow'}>
                {SIGN_ARROWS.map((a) => (
                  <MarkTile
                    key={a}
                    mark={paletteMark({ kind: 'arrow', arrow: a })}
                    lines={lines}
                    active={selected?.kind === 'arrow' && selected.arrow === a}
                    label={`箭头 ${ARROW_ANGLE[a]}°`}
                    onPointerDown={(e) => armPaletteDrag(`arrow:${a}`, e)}
                  />
                ))}
              </PaletteRow>

              <PaletteRow open={group === 'icon'}>
                {SIGN_MARKS.map((m) => (
                  <MarkTile
                    key={m.icon}
                    mark={paletteMark({ kind: 'icon', icon: m.icon })}
                    lines={lines}
                    ready={ready}
                    active={selected?.kind === 'icon' && selected.icon === m.icon}
                    label={m.label}
                    onPointerDown={(e) => armPaletteDrag(`icon:${m.icon}`, e)}
                  />
                ))}
              </PaletteRow>

              {/* 线路 is a mark, not a setting: a shield is dropped wherever the pointer lets
                  it go and may be laid down as many times as the board has places, so the same
                  line can stand five times on one sign. A click adds one after the selection. */}
              <PaletteRow open={group === 'line'}>
                {lines.map((l) => {
                  const active = selected?.kind === 'line' && (selected.lineId === l.id || (selected.lineId === '' && lines[0]?.id === l.id))
                  return (
                    <MarkTile
                      key={l.id}
                      mark={paletteMark({ kind: 'line', lineId: l.id })}
                      lines={lines}
                      active={active}
                      label={l.name}
                      onPointerDown={(e) => armPaletteDrag(`line:${l.id}`, e)}
                      onClick={() => setLine(l.id)}
                    />
                  )
                })}
              </PaletteRow>

              <PaletteRow open={group === 'text'}>
                <TextFields
                  comp={selected?.kind === 'text' ? selected : undefined}
                  lines={lines}
                  onCommit={setText}
                  onArmDrag={(text, e) => armPaletteDrag(`text:${text}`, e)}
                  onPick={pickExisting}
                />
              </PaletteRow>
            </div>
          </div>

          {/* 1c. the boards — 正面 and 背面, each a labelled row of places drawn the way the
              sign prints it. They are two independent boards, so each has its own row, its own
              order and its own (possibly empty) content. The label sits in a gutter to the
              **left** of the row, so the two plates line up one over the other and read as the
              two faces of one sign. */}
          <div className="signWorkspace">
            <div className="signBoards">
              {rows.map((row) => (
                <div key={row.face} className={focusedFace === row.face ? 'signFaceRow on' : 'signFaceRow'}>
                  <button
                    type="button"
                    className="signFaceLabel"
                    aria-pressed={focusedFace === row.face}
                    onClick={() => focusFace(row.face)}
                  >
                    {FACE_LABEL[row.face]}
                  </button>
                  <BinStrip
                    face={row.face}
                    layout={row.layout}
                    selectedId={selectedId(row.face)}
                    dropping={hoverFace === row.face && insertAt !== null}
                    onPickStart={(id, e) => {
                      // Pressing a bin is also how the palette is pointed at that face. The
                      // selection survives a press on a **different** face, because the press
                      // itself is about to select there: `focusFace` runs first and would
                      // otherwise drop the pick the player is in the middle of making.
                      if (focusedFace !== row.face) setFocusedFace(row.face)
                      setSelection({ face: row.face, id })
                      // Armed, not started: a press that never moves is a selection.
                      armed.current = { id, payload: '', face: row.face, x: e.clientX, y: e.clientY }
                    }}
                    lineDefs={lines}
                    ready={ready}
                    label={`${FACE_LABEL[row.face]} · ${FACE_ROW_LABEL[row.face]}`}
                  />
                </div>
              ))}
            </div>

            {/* What is left of the column, which is the gap the cluster is pushed down by: the
                panel's height is fixed, so the bin and ✓ sit on its floor rather than floating
                under whatever the boards happen to measure. */}
            <span className="signRailSpacer" />

            {/* 2. the action cluster, pinned to the column's **bottom-right** corner — the panel
                has a fixed height, so this corner does not move as the boards are arranged. The
                bin is the leftmost of the two because it is the thing a drag aims at: it sits
                under the boards' right-hand end, so a mark carried off a board travels into it
                down the same column the board finishes in. What is left of the row is empty
                space, not prose: the tiles say what to do with them, and the bin's own caption
                is the only line the cluster needs. */}
            <div className="signRail">
              <button
                type="button"
                ref={trashRef}
                className={[
                  'signAct',
                  'trash',
                  // The bin is **always there**, and red: it is a button with a press of its
                  // own (click it to empty both boards), so hiding it until a drag started would
                  // hide half of what it does. What a drag adds is the light: the caption says
                  // what the gesture is, and a mark over the plate lights it
                  // (`.signAct.trash.over`).
                  //
                  // **Anything carried lights it**, a palette tile included. It used to be
                  // exempt — `dragMark.id !== DRAG_MARK_ID`, a test that is false for every mark
                  // a palette arms, because `markFor` labels them all with `DRAG_MARK_ID` — so
                  // the one state the light exists for never once came on. What a drop *does*
                  // still turns on the mark's own provenance (`d.id`, `d.remove.face` in
                  // `endDrag`): a tile let go here is refused and stays in the library, a mark
                  // lifted off a board is thrown away, and the plate is the drop target either
                  // way.
                  overTrash && dragMark !== null && populated ? 'over' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label="删除拖入的内容，或点击清空正反面"
                // A **click** on a bin that is holding nothing: the whole board goes. A press
                // that became a drag never gets here — the browser withholds the click once the
                // pointer has moved, and the drag's own end (`endDrag`) has already deleted the
                // one mark it was carrying.
                onClick={clearAll}
              >
                <Icon name="delete" />
              </button>
              <button type="button" className="signAct ok" aria-label="完成" onClick={confirm}>
                ✓
              </button>
            </div>
          </div>
        </div>
      </div>
      <button className="signModalScrim" aria-label="关闭编辑器" onClick={cancel} />
    </div>
  )
}
