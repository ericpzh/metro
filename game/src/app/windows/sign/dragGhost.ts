// 指示牌 editor (§5.8) — the floating mark a drag carries. It is a plain DOM node rather
// than React state on purpose: a drag reports a pointer position dozens of times a second,
// and moving an element through the store or a component's state would re-render the whole
// editor for every one of them.

import type { SignComponent } from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'
import { drawTileMark } from './tileArt.tsx'
import { DRAG_ART_PX } from './tokens.ts'

/**
 * The floating mark the pointer carries: a small canvas of the real mark, drawn by
 * the same code as the board, lifted above the modal and moved with the pointer.
 */
export function makeDragGhost(comp: SignComponent, lines: readonly LineDef[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'dragGhost'
  const canvas = document.createElement('canvas')
  // Drawn at the size it is shown at (`.dragGhostArt`, `DRAG_ART_PX`), at the display's own
  // density, and told the panel is a **tile** — so the picture is a tile's, and everything
  // printed on it, mark included, is scaled up by `DRAG_ART_PX / TILE_ART`. The box grows
  // and the content grows with it, which is what the eye reads as "picked up".
  const px = Math.round(DRAG_ART_PX * Math.min(2, window.devicePixelRatio || 1))
  canvas.width = px
  canvas.height = px
  canvas.className = 'dragGhostArt'
  const g = canvas.getContext('2d')
  if (g) drawTileMark(g, comp, 1, lines, px)
  el.appendChild(canvas)
  document.body.appendChild(el)
  return el
}

export function moveDragGhost(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate3d(${x}px, ${y}px, 0)`
}
