// The 指示牌 slice: the board editor's session (§5.8). There is one current pair
// of boards — what the editor edits and what every new sign is hung with — and
// a live preview pair that is drawn on the placed sign being edited but never
// committed until ✓.

import type { StateCreator } from 'zustand'
import { initialStation } from '../../../build/model.ts'
import { makeSignBoards, settleSignBoards, signBoardsOf, type SignBoards } from '../../../sim/sign.ts'
import type { Module } from '../../../sim/types.ts'
import type { AppState } from '../Store.ts'

export interface SignSlice {
  /**
   * **The current boards**: the 指示牌 the player is working on, and the one every
   * new sign is hung with.
   *
   * There is one current pair, and it is the whole of the signage model:
   *
   *  - the editor (the rail's 自定义 tile, or the boards a placed sign holds) edits
   *    **this** pair, and ✓ makes it current;
   *  - a sign placed afterwards carries **a copy of it**, so the player composes
   *    once and hangs as many as they like;
   *  - a sign already hanging is untouched by any of it: it keeps the boards it was
   *    placed with (`cfg.front` / `cfg.back`), which is what makes an old sign an
   *    old sign.
   *
   * Neither face is ever missing: a station with no signage yet starts from
   * `defaultSignLayout` on the front and an empty back, and `toState` backfills an
   * old save the same way.
   */
  currentBoards: SignBoards
  /** Which module the board editor is editing: null when it is the current boards alone. */
  signEditorFor: string | null
  /**
   * True while the editor is open on the **current boards** alone — no module
   * behind it (the rail's 自定义 tile).
   *
   * The editor is open on `signEditorFor` (a placed sign) or on this. The boards
   * themselves are deliberately *not* the flag: the current pair outlives the
   * modal, so an open test of "is a board set" would leave the editor up with no
   * way to close it.
   */
  signComposing: boolean
  /**
   * The boards the open editor is showing on a **placed** sign, before they are
   * kept.
   *
   * The editor is a modal over the station, so the sign it is editing has to show
   * the boards being arranged — but boards that are still being arranged are not an
   * edit: they must not land in the document (✕ would have nothing to put back) and
   * they must not land on the undo stack, once per keystroke. So the live pair
   * lives here and the model draws it in place of the module's own
   * (`signModuleWithPreview`); ✓ writes it to the module as one commit, and ✕ drops
   * it.
   */
  signPreview: { moduleId: string; boards: SignBoards } | null
  /**
   * The redraw counter for a **live** board edit, kept apart from the document's
   * own `version`.
   *
   * `version` means "the station changed": it drives the whole rebuild and the undo
   * stack's `cloneState`, and it is what every other reader of the document keys
   * off. A preview is *not* a document change — nothing is written to the module
   * until ✓ — so it must not look like one, or arranging a board would push frames
   * onto the undo stack that nobody asked for.
   *
   * The scene still has to draw the sign being arranged, and a board can change the
   * panel's size, so that redraw is the same full `setStation` a document edit takes
   * (`Viewport`'s rebuild effect watches this counter alongside `version`). What the
   * separate counter buys is that a preview stays invisible to every *other* reader
   * of `version`.
   */
  signVersion: number

  /**
   * Rewrite one 指示牌's printed **boards** (§5.8). Both faces are replaced, so
   * every edit — a drag, a stamp, a delete — is one `commit` and therefore one
   * `Ctrl+Z`. Each face is settled on the way in (`settleSignBoards`), so the two
   * boards, the shared panel and their content can never disagree.
   */
  setSignBoards: (moduleId: string, boards: SignBoards) => void
  /** Open the board editor on the current boards (no module behind it). */
  openSignComposer: () => void
  /**
   * Make one placed sign's printed boards **the current pair** — what 吸取 does when
   * it lifts a 指示牌: the piece's own two faces become the boards the next sign is
   * hung with, so the copy a pick arms carries the exact sign the player pointed at
   * (`cfg.front` / `cfg.back`, settled as they are printed) rather than whatever
   * board was composed last.
   *
   * Unlike `openSignEditor` this opens nothing and writes nothing to the module: it
   * is a copy **out** of a placed sign, not an edit of it.
   */
  adoptSignBoards: (boards: SignBoards) => void
  /** Open the board editor on one placed sign, whose boards become the current ones. */
  openSignEditor: (moduleId: string) => void
  /**
   * Close the board editor: it is no longer open on a placed sign or on the current
   * boards. The boards themselves stay current for the next open and the next sign.
   */
  closeSignEditor: () => void
  /**
   * Show boards that have **not** been committed — the editor's live pair.
   *
   * The editor owns its own lists and writes them here as the player works: a
   * placed sign shows them in place of its own boards (`signPreview`), and
   * `currentBoards` follows so the next sign placed carries what is on screen. It
   * is not an edit: nothing lands in a module and nothing lands on the undo stack,
   * however much the player drags, until ✓ (`commitSignLayout`).
   */
  previewSignLayout: (boards: SignBoards) => void
  /** Make the arranged boards the current ones — and, on a placed sign, that sign's. */
  commitSignLayout: (boards: SignBoards) => void
  /** Throw the edit away, putting the current boards back as they were (the editor's ✕). */
  restoreSignLayout: (boards: SignBoards) => void
}

export const createSignSlice: StateCreator<AppState, [], [], SignSlice> = (set, get) => ({
  // The boards every new 指示牌 is hung with, and the ones the editor edits. The
  // front starts as the default board for the station the app opens on, so the first
  // sign placed is already readable; the back starts **empty**, which is the whole
  // point of a second face — it is black until the player puts something on it.
  currentBoards: makeSignBoards(undefined, initialStation()),
  signEditorFor: null,
  signComposing: false,
  signPreview: null,
  signVersion: 0,

  setSignBoards: (moduleId, boards) => {
    const st = get()
    const mod = st.station.modules.find((m) => m.id === moduleId)
    if (!mod || mod.type !== 'sign') return
    const next = settleSignBoards(boards, st.station)
    const modules = st.station.modules.map((m) => {
      if (m.id !== moduleId || m.type !== 'sign') return m
      // The **mount** is the piece's own and is not the editor's to write: a wall
      // board stays bolted to its wall and a hung board stays on its rods however the
      // boards are rearranged. Everything else the config might carry is the legacy
      // `components` list, which the pair replaces (`ensureSignLayouts`).
      const cfg: typeof m.cfg = { front: next.front, back: next.back }
      if (m.cfg.mount !== undefined) cfg.mount = m.cfg.mount
      return { ...m, cfg }
    })
    get().commit({ ...st.station, modules })
  },
  // There is one **current pair of boards**, and the editor edits it. A session on a
  // placed sign also carries that sign's id, so ✓ writes the boards back to it; a
  // session with no id is the rail's 自定义 tile, and ✓ simply makes the boards
  // current.
  openSignComposer: () =>
    set({
      signEditorFor: null,
      signComposing: true,
      signPreview: null,
      // A piece in the air (移动) is put back here too, for the same reason
      // `openSignEditor` does it: the composer takes over the keyboard, and its ✓
      // is `Enter` — which the viewport also reads as the move's 确认, so a lift
      // left standing would be dropped behind the modal by one keypress.
      moveDraft: null,
    }),
  // A sign's boards are lifted **out** of the piece and into the current pair, with
  // nothing else touched: the module keeps its own faces (this is a copy, not an
  // edit) and no editor opens. Settled on the way in like every other write, so the
  // pair the picker arms is a pair the print can lay out.
  adoptSignBoards: (boards) => set({ currentBoards: settleSignBoards(boards, get().station) }),
  openSignEditor: (moduleId) => {
    const mod = get().station.modules.find((m) => m.id === moduleId)
    if (!mod || mod.type !== 'sign') return
    // Editing a placed sign opens **its** boards as the current ones, so the editor,
    // the next sign placed and the sign on screen are all the same boards while it is
    // open. ✕ puts the current boards back (`restoreSignLayout`), and the module —
    // which was never touched — is exactly as it was.
    const boards = signBoardsOf(mod.cfg, get().station)
    set({
      signEditorFor: moduleId,
      signComposing: false,
      currentBoards: boards,
      signPreview: { moduleId, boards },
      // A sign in the air (移动) is put back first: the editor composes a board
      // against the station it hangs in, and a piece that is not drawn has no place
      // to compose against.
      moveDraft: null,
    })
  },
  /**
   * Close the board editor: it is no longer open on a placed sign or on the current
   * boards. The boards stay current — they are what the next sign will hang — and a
   * placed sign's ✕/✓ have already dealt with the module through
   * `commitSignLayout`/`restoreSignLayout`.
   */
  closeSignEditor: () => set({ signEditorFor: null, signComposing: false, signPreview: null }),
  previewSignLayout: (boards) => {
    const st = get()
    const next = settleSignBoards(boards, st.station)
    // The live boards: current for the next sign, and drawn on the sign being edited
    // (the module itself is not written until ✓, so ✕ has something to put back and
    // the undo stack does not collect a frame per dragged bin).
    const patch: Partial<AppState> = { currentBoards: next }
    if (st.signEditorFor !== null) {
      patch.signPreview = { moduleId: st.signEditorFor, boards: next }
      // **Only a placed sign asks for a redraw.** Boards being composed for the
      // *next* sign are not on screen anywhere, so raising a scene counter for them
      // would rebuild the station for nothing — which is what hanging this on
      // `version` did, one keystroke at a time.
      patch.signVersion = st.signVersion + 1
    }
    set(patch)
  },
  commitSignLayout: (boards) => {
    const st = get()
    const next = settleSignBoards(boards, st.station)
    // ✓ is what makes boards the current ones: they are what the next sign will hang.
    set({ currentBoards: next, signPreview: null })
    if (st.signEditorFor === null) return
    // And on a placed sign they are also that sign's boards — one commit, so one undo.
    const mod = st.station.modules.find((m) => m.id === st.signEditorFor)
    if (!mod || mod.type !== 'sign') return
    get().setSignBoards(st.signEditorFor, next)
  },
  restoreSignLayout: (boards) => {
    const st = get()
    const next = settleSignBoards(boards, st.station)
    // ✕ puts the current boards back to what the editor opened on, and drops the
    // preview that stood in for them. Nothing is undone, because nothing was done: a
    // placed sign was never written to.
    set({ currentBoards: next, signPreview: null, signVersion: st.signVersion + 1 })
  },
})

/**
 * One module as it should be **drawn**: a 指示牌 whose boards are open in the
 * editor shows the boards being arranged rather than the ones on disk, so the
 * player arranges them against the station the sign hangs in.
 *
 * The preview is read here, at the last moment, instead of being written into the
 * document: it is not an edit until ✓ says so, and boards that committed themselves
 * per keystroke would fill `Ctrl+Z` with frames of a half-arranged sign.
 *
 * The **mount** is carried through, because it is not one of the boards: a wall board
 * being arranged is still bolted to its wall, and a preview that dropped the mount
 * would draw the overhead piece — rods and all — over a sign the player hung flat.
 */
export function signModuleWithPreview(mod: Module, preview: AppState['signPreview']): Module {
  if (!preview || mod.type !== 'sign' || mod.id !== preview.moduleId) return mod
  const cfg: typeof mod.cfg = { front: preview.boards.front, back: preview.boards.back }
  if (mod.cfg.mount !== undefined) cfg.mount = mod.cfg.mount
  return { ...mod, cfg }
}
