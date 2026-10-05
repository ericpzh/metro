// 指示牌 editor (§5.8) — the palette: a group's tile, one option's tile, and the row that
// folds an open group's options out beside it. Presentation only; the drag logic lives in
// `SignEditor.tsx`.

import { Fragment } from 'react'
import type { SignComponent } from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'
import { MarkArt } from './tileArt.tsx'
import { groupMarks, type SignGroupId } from './tokens.ts'

/**
 * A **group's** tile: the marks `groupMarks` gives it, opened by its own press and click.
 *
 * It is here rather than inside `MarkTile` because a group is a different object from an
 * option: an option carries one mark out to a board, and a group's tile carries nothing —
 * it is the lid on a palette. The two look alike and behave alike (press opens, keyboard
 * opens, `aria-expanded` says which), so they share every class and the same slots for what
 * they hold; what they do not share is how many marks they hold.
 */
export function GroupTile({
  id,
  lines,
  ready,
  active,
  title,
  onToggle,
}: {
  id: SignGroupId
  lines: readonly LineDef[]
  ready: boolean
  active: boolean
  title: string
  onToggle: () => void
}): React.ReactElement {
  const { marks, split } = groupMarks(id, lines)
  return (
    <button
      type="button"
      className={split ? 'tile group split' : 'tile group'}
      title={title}
      aria-label={title}
      // A group's tile is a disclosure, and `aria-expanded` is what says which it is.
      aria-expanded={active}
      onPointerDown={onToggle}
      // The press has already opened it, so the click that follows must not shut it again.
      // A **pointer** click carries a `detail` (its click count) and the one a keyboard fires
      // on Enter or Space carries none, so this drops the first and keeps the second —
      // without it, opening on the press would mean giving up the keyboard.
      onClick={(e: React.MouseEvent) => {
        if (e.detail > 0) return
        onToggle()
      }}
    >
      {marks.map((mark, i) => (
        // The diagonal goes *between* the two marks, and is a child of the row rather than a
        // background on it, so it sits in the gap the two plates leave rather than under them.
        <Fragment key={i}>
          {i > 0 && split ? <span className="tileSplit" aria-hidden="true" /> : null}
          <MarkArt mark={mark} lines={lines} ready={ready} />
        </Fragment>
      ))}
    </button>
  )
}

/**
 * One option, as the square blueprint tile that offers it. The tile is furniture —
 * flat navy with the rail's own dashed technical frame — and everything inside it is
 * the mark, drawn by the sign's own code. No tile carries lettering: the name is its
 * tooltip and nothing else, because a picture of the thing beats a word for it.
 */
export function MarkTile({
  mark,
  lines,
  ready = false,
  active,
  title,
  onPointerDown,
  onClick,
}: {
  mark: SignComponent
  lines: readonly LineDef[]
  /** Whether the pictograms are decoded. A text or shield tile has no use for it. */
  ready?: boolean
  active: boolean
  title: string
  /** The press that arms a drag. Absent for a tile that is only ever clicked. */
  onPointerDown?: (e: React.PointerEvent) => void
  onClick?: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      // `grab` only where the gesture is a drag: a 线路 tile is clicked, and the cursor is
      // the one thing that says which of the two a tile is.
      className={['tile', active ? 'on' : '', onPointerDown ? 'grab' : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <MarkArt mark={mark} lines={lines} ready={ready} />
    </button>
  )
}

/**
 * One group's palette, folding out **to the right** of the group bar.
 *
 * The build rail's `InlineExpand` is the same idea vertically: a `0fr → 1fr` track
 * that animates, a child that clips it, and the row keeps rendering even while it is
 * shut so the animation has something to slide.
 *
 * Here the track is a *column* — `grid-template-columns: 0fr → 1fr` — so the palette
 * grows out of the tile that opened it, and the four rows can be mounted together with
 * one open: switching group slides the old row away while the new one slides in, which
 * is what makes the swap one movement instead of two pictures.
 *
 * Closed rows stay in the DOM (`inert`, so nothing inside can take a press or a tab)
 * because an unmounted row cannot animate out. What keeps a closed row from being
 * *seen* is the inner `overflow: hidden` clipping it to the zero-width track.
 *
 * **The children are always the current ones.** A shut row is clipped, not frozen: its
 * tiles are built from the editor's live state on every render, so a tile in a row that
 * is about to fold open already means what it will mean when it does. Keeping a
 * *retained copy* of the last open children instead is the trap — those elements carry
 * the props and the handlers of the render that made them, so a palette shut since
 * before the player switched to 背面 would still add its mark to 正面, and its `selected`
 * highlight would be the selection of a board the player has left. `aria-hidden` and
 * `inert` are what make a clipped row inert; React's own state is what keeps it honest.
 */
export function PaletteRow({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div className={open ? 'signRow open' : 'signRow'} aria-hidden={!open} inert={!open}>
      <div className="signRowInner">
        <div className="signRowPad">{children}</div>
      </div>
    </div>
  )
}
