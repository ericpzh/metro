// 指示牌 editor (§5.8) — the tile pictures. Every tile is a photograph of the mark it
// makes, drawn by the sign's own renderer onto a canvas, so the palette, the bins and the
// mark in the air are all the same picture at different sizes. No state, no drag logic.

import { useEffect, useState } from 'react'
import { drawSignPanel, pictograms } from '../../../render/signFace.ts'
import { loadPictograms } from '../../../render/pictograms.ts'
import type { SignComponent, SignPanelSize } from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'
import { TILE_ART, markInk, markKey } from './tokens.ts'

/**
 * True once the pictograms are decoded. A tile's picture is a **bitmap** of the
 * mark (`render/pictograms.ts`), so a tile drawn before the art exists shows a
 * board with nothing on it — and the tile is cached by its own key, so it would
 * stay empty. The flag is what makes every tile redraw the moment the art lands.
 */
export function usePictogramsReady(): boolean {
  const [ready, setReady] = useState(() => pictograms().size > 0)
  useEffect(() => {
    if (ready) return
    let live = true
    void loadPictograms().then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [ready])
  return ready
}

/**
 * One mark's own picture: a square canvas drawn by `drawSignPanel` with the canvas'
 * own size as the plate — **one metre of board per tile**, however many device
 * pixels that tile is. Matching the two is the whole trick: a tile that hands the
 * drawing different metres and pixels from the canvas it owns prints at the wrong
 * scale, which is what turned every tile into a speck. The board's own near-black
 * ground fills the tile, so a tile is a piece of the sign — the plate and the mark
 * on it — rather than a glyph on the panel's blue.
 */
export function useTileArt(mark: SignComponent, lines: readonly LineDef[], ready: boolean): string {
  const key = `${markKey(mark)}:${lines.map((l) => l.colour).join()}`
  const [url, setUrl] = useState('')
  useEffect(() => {
    const canvas = document.createElement('canvas')
    const px = Math.round(TILE_ART * Math.min(2, window.devicePixelRatio || 1))
    canvas.width = px
    canvas.height = px
    const g = canvas.getContext('2d')
    if (!g) return
    drawTileMark(g, mark, 1, lines, px)
    setUrl(canvas.toDataURL('image/png'))
    // `key` names everything the drawing depends on — a line's colour, an arrow's
    // direction, a pictogram, a typed label — so a changed tile redraws and an
    // unchanged one does not, however fresh the mark around it is. `ready` is the
    // one thing outside the mark: the art arriving reprints every tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready])
  return url
}

/** One mark, as the picture a tile shows. */
export function MarkArt({ mark, lines, ready }: { mark: SignComponent; lines: readonly LineDef[]; ready: boolean }): React.ReactElement | null {
  const url = useTileArt(mark, lines, ready)
  return url ? <img src={url} alt="" draggable={false} /> : null
}

/**
 * One mark on a **square canvas**, drawn to fill it: the board's own black ground, and the
 * mark centred on it at the size that fills the square.
 *
 * `size` is the canvas's own side in the drawing's units and `artPx` the side it will be
 * *shown* at, in CSS pixels. They are two different things on purpose: the panel the board
 * is stated in is `size × size` and the conversion to pixels is `artPx / size`, so a caller
 * that wants a bigger picture passes a bigger `artPx` and the mark inside it grows in step
 * — which is exactly what the carried mark in a drag needs, and what it did not do while the
 * two were the same number (`TILE_ART`): the ghost was a bigger box around a picture drawn
 * for the tile, so the content looked like it shrank.
 */
export function drawTileMark(
  g: CanvasRenderingContext2D,
  mark: SignComponent,
  size: number,
  lines: readonly LineDef[],
  artPx = TILE_ART,
  frame = false,
): void {
  const panel: SignPanelSize = { w: size, h: size }
  const ppm = artPx / size
  // The mark is **scaled to the tile** rather than drawn at its board size: a tile is
  // a picture of the mark, so a 0.3 m pictogram and a 0.5 m arrow both fill it.
  const ink = markInk(mark)
  const fit = Math.min(panel.w / Math.max(0.01, ink.w), panel.h / Math.max(0.01, ink.h)) * 0.82
  // `frame: false` by default: a tile is a patch of the board's lit face, so it prints
  // the board's own black ground with the mark on it and no border — the border belongs
  // to the panel's edge, and a tile is not the panel's edge.
  drawSignPanel(g, [{ ...mark, x: panel.w / 2, y: panel.h / 2, scale: fit }], { lines: [...lines], panel, ppm, frame }, 'both')
}
