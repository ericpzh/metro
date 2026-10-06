// 指示牌 editor (§5.8) — one face's row of places. A bin is a place in a list, and the list
// it belongs to is the face whose row it is.

import { SIGN_BACK_MARK, type SignComponent, type SignFaceName } from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'
import { MarkArt } from './tileArt.tsx'
import { componentName } from './tokens.ts'

/**
 * The row of **places**: one square per mark on the board, and nothing else.
 *
 * A bin is not a measuring stick, it is a place in a list — the mark's position in the
 * list is its position on the board, and a drag puts one down *between* two others as
 * easily as at either end (the pointer's own x decides that, in `placeAt`). There is
 * therefore no spare slot trailing the row: a place nobody has filled is not a mark, and
 * a row with a `＋` on the end would say the only way to add one is there. (The **back**
 * row is the one exception, and it is not a spare slot either: `faceRowLayout` gives an
 * empty face the stand-in place it needs to be dropped into at all.)
 *
 * Every bin is the same square and shows nothing but the mark: the place in the list is
 * where it is on screen, so a number in the corner would only repeat the row's own order,
 * and the mark's name is its accessible label rather than a caption the tile has to
 * carry. What is left in a bin is the piece of sign that will stand there.
 *
 * The stand-in place carries nothing — no art, no delete button, no tooltip — because it
 * is not a mark: it is the absence of one, and the row it sits in is where the next mark
 * goes.
 */
export function BinStrip({
  face,
  layout,
  selectedId,
  dropping,
  onPickStart,
  lineDefs,
  ready,
  label,
}: {
  /**
   * **Which board this row is.** It is written onto the row as `data-face`, because the
   * row is what a drag hovers: `placeAt` reads the face off the element under the
   * pointer (`elementFromPoint`) and this attribute is the only thing that tells the two
   * rows apart once they are in the DOM. Without it every drop resolves to 正面 — which
   * is exactly what it did.
   */
  face: SignFaceName
  layout: readonly SignComponent[]
  selectedId: string | null
  /** A mark is in the air over the row, so the well shows it would take it. */
  dropping: boolean
  /** The pointer went down on a bin: how a move between places starts. */
  onPickStart: (id: string, e: React.PointerEvent) => void
  lineDefs: readonly LineDef[]
  ready: boolean
  /** Which face's row this is, for the row's own label. */
  label: string
}): React.ReactElement {
  return (
    <div className={dropping ? 'bins drop' : 'bins'} data-face={face} role="list" aria-label={label}>
      {layout.map((comp) => {
        // An empty face's one place: a well, drawn and measured as nothing, so the row
        // has somewhere to take the first mark and nothing else about it changes.
        if (comp.id === SIGN_BACK_MARK.id) return <div key={comp.id} className="bin empty" role="listitem" aria-label="空" />
        // A mark carries **no ✕**: a bin is dragged out to the rail's bin to delete it, so
        // the square holds nothing but the piece of sign that will stand there, and the
        // corner of a small canvas is not a target the player has to find.
        return (
          <div
            key={comp.id}
            className={comp.id === selectedId ? 'bin on' : 'bin'}
            role="listitem"
            aria-label={`${componentName(comp)} · 拖到别处换位置，拖出面板删除`}
            // The press only arms a possible drag: the window listeners in the editor
            // decide whether it became one, so a click still selects.
            onPointerDown={(e) => onPickStart(comp.id, e)}
          >
            <MarkArt mark={comp} lines={lineDefs} ready={ready} />
          </div>
        )
      })}
    </div>
  )
}
