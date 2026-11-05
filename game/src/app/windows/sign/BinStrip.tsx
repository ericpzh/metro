import { translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// 指示牌 editor (§5.8) — one face's row of places. A bin is a place in a list, and the list
// it belongs to is the face whose row it is.

import { useLayoutEffect, useRef } from 'react'
import { drawSignPanel } from '../../../render/signFace.ts'
import { SIGN_BACK_MARK, signPlate, signPieces, type SignPanelSize, type SignComponent, type SignFaceName } from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'
import { componentName } from './tokens.ts'

/** A complete sign face at production scale, with transparent drag targets.
 * Both faces use the same panel size; a shorter face stays centred on its steel.
 * The canvas is retained across renders so dragging never encodes PNG data.
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
  panel,
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
  panel: SignPanelSize
}): React.ReactElement {
  useLanguage()
  const art = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = art.current
    if (!canvas) return
    const size = signPlate(panel)
    canvas.width = size.width
    canvas.height = size.height
    const g = canvas.getContext('2d')
    if (!g) return
    drawSignPanel(g, layout, { lines: [...lineDefs], panel }, 'both')
  }, [layout, lineDefs, panel.w, panel.h, ready])
  const pieces = signPieces(layout, panel, 'both')
  const left = Math.min(...pieces.map(p => p.x - p.inkW / 2))
  const right = Math.max(...pieces.map(p => p.x + p.inkW / 2))
  const centres = pieces.map(p => .5 + (p.x - (left + right) / 2) / panel.w)
  // Drag targets meet halfway between the printed marks, including the wider
  // text boxes. Scaling target widths by ink size can put a pictogram under a
  // neighbouring label's target even when the artwork itself is correct.
  const edges = [0, ...centres.slice(1).map((x, i) => (x + centres[i]) / 2), 1]
  // Keep a stable artwork height. Fitting every board to the workspace width
  // magnifies the remaining marks whenever deletion shortens the panel.
  return (
    <div className={dropping ? 'bins signBoardPreview drop' : 'bins signBoardPreview'} style={{ aspectRatio: `${panel.w} / ${panel.h}`, width: `${64 * panel.w / panel.h}px`, minHeight: 0 }} data-face={face} role="list" aria-label={translate(label)}>
      <canvas ref={art} aria-hidden="true" />
      {layout.map((comp) => {
        // An empty face's one place: a well, drawn and measured as nothing, so the row
        // has somewhere to take the first mark and nothing else about it changes.
        if (comp.id === SIGN_BACK_MARK.id) return <div key={comp.id} className="bin empty" role="listitem" aria-label={t('empty')} />
        const index = pieces.findIndex(p => p.id === comp.id)
        const width = index < 0 ? 0 : edges[index + 1] - edges[index]
        // A mark carries **no ✕**: a bin is dragged out to the rail's bin to delete it, so
        // the square holds nothing but the piece of sign that will stand there, and the
        // corner of a small canvas is not a target the player has to find.
        return (
          <div
            key={comp.id}
            data-sign-mark={comp.id}
            className={comp.id === selectedId ? 'bin on' : 'bin'}
            style={{ width: `${100 * width}%`, height: '100%', background: 'transparent' }}
            role="listitem"
            aria-label={t('value_drag_to_rearrange_drag_off_the_board_to_delete', componentName(comp))}
            // The press only arms a possible drag: the window listeners in the editor
            // decide whether it became one, so a click still selects.
            onPointerDown={(e) => onPickStart(comp.id, e)}
          />
        )
      })}
    </div>
  )
}
