// The 站名 pixels — the station's own name, cut as an ink inscription.
//
// This is the *only* drawing code for a station-name inscription. A placed piece's
// lit face, its palette thumbnail and the tests all call `drawCalligraphyPanel`
// into a canvas of their own, and the text is always the **live station name**
// (`StationData.name`), so renaming a station reprints every inscription in it
// (`render/scene/systems/PlateSystem.ts`). The piece carries the hand and the axis;
// the name is the document's.
//
// Two things are load-bearing:
//
//   * **The ink is transparent.** An inscription is brush strokes *on the wall*, not
//     a printed board: the plate draws no ground, so the wall's own finish — 搪瓷板,
//     granite, the enamel of the reference photographs — shows between the strokes.
//     A ground here would hang a grey rectangle on the wall and the piece would read
//     as a poster of calligraphy rather than as calligraphy.
//   * **The characters are cut to the panel they are given.** The panel is sized
//     when the piece is placed (`sim/calligraphy.ts`); a later rename sets the type
//     to whatever fits that panel rather than spilling off it, which is why the size
//     is derived here from the panel and the character count and never trusted from
//     the module.
//
// A hand is a font stack plus the treatment that stands in for a brush when the
// machine has no brush face: a second, drier strike offset from the first (`strike`),
// tracking between the characters, a horizontal stretch, and — for the hands that
// wear one — a vermilion 印章 beside the last character. Everything is derived from
// the character itself, so a given station name prints the same way on every
// rebuild: jitter from `Math.random` would make the wall twitch on every edit.

import {
  CALLIGRAPHY_AXIS_LABEL,
  CALLIGRAPHY_INK_MAX,
  CALLIGRAPHY_PAD,
  calligraphyStyle,
  type CalligraphyStyleSpec,
} from '../sim/calligraphy.ts'
import type { CalligraphyAxis, CalligraphyStyle } from '../sim/types.ts'

/** The plate's resolution: pixels per metre of panel. */
export const PX_PER_METRE = 512

/** The panel an inscription is drawn on, in metres. */
export interface CalligraphyPanelSize {
  w: number
  h: number
}

/** The texture an inscription needs: `PX_PER_METRE` per metre, never below 64 px. */
export function calligraphyPlate(panel: CalligraphyPanelSize): { width: number; height: number } {
  return {
    width: Math.max(64, Math.round(panel.w * PX_PER_METRE)),
    height: Math.max(64, Math.round(panel.h * PX_PER_METRE)),
  }
}

/* ------------------------------------------------------------------ layout */

/** One character's slot on the panel: where its ink is centred and how big it is. */
export interface CalligraphyGlyph {
  char: string
  /** The centre of the character's box, metres from the panel's left/top edge. */
  x: number
  y: number
  /** The character's own size, metres. */
  size: number
  /**
   * The character's own turn, radians — a hair either way, derived from the character
   * so a wall of inscriptions is hand-set rather than machine-set and still prints
   * identically on every rebuild.
   */
  turn: number
  /**
   * The wash off the run's own centre line, metres — the rise and fall of a 横排
   * inscription, or how far a 竖排 column's character sits off its line. Applied
   * perpendicular to the run (the drawing turns it by the axis), so the run itself
   * stays straight.
   */
  drift: number
}

export interface CalligraphyLayout {
  glyphs: CalligraphyGlyph[]
  axis: CalligraphyAxis
  style: CalligraphyStyle
  /** The panel's size, metres. */
  panel: CalligraphyPanelSize
}

/**
 * A stable fraction in `[-1, 1)` from a character and its index.
 *
 * The wash of a hand-set inscription is a property of the *text*, not of the
 * moment it was drawn: a FNV-1a hash of the character and its place in the run,
 * mapped to the unit interval. `Math.random` here would re-jitter the whole
 * inscription on every module rebuild — a wall that twitches when the player
 * clicks anywhere in the station.
 */
function jitter(char: string, index: number): number {
  let hash = 2166136261
  const key = `${index}:${char}`
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967296) * 2 - 1
}

/**
 * Where every character sits, in metres on a panel of this size.
 *
 * A **横排** inscription fills the panel's width, a **竖排** one its height, and the
 * characters are cut to the slot that leaves: the panel's own pad is split between
 * the ends, and whatever is left over is divided by the character count. The size is
 * therefore `min(ink, slot × 0.92)` — the run's own breathing space — which is what
 * makes a three-character name on a four-cell panel print large and an eight-
 * character name on the same panel print small, without either leaving the panel.
 *
 * A 竖排 inscription is read top to bottom and a 横排 one left to right, so both are
 * one straight run: the drift is a few centimetres off the centre line, never a
 * second column.
 */
export function calligraphyLayout(
  chars: readonly string[],
  axis: CalligraphyAxis,
  style: CalligraphyStyle,
  panel: CalligraphyPanelSize,
): CalligraphyLayout {
  const n = Math.max(1, chars.length)
  const ink = CALLIGRAPHY_INK_MAX
  const glyphs: CalligraphyGlyph[] = []
  if (axis === 'v') {
    const slot = Math.max(0.05, (panel.h - CALLIGRAPHY_PAD) / n)
    const size = Math.min(ink, slot * 0.92)
    chars.forEach((char, i) => {
      glyphs.push({
        char,
        // A 竖排 run is one column down the wall: the characters sit on its centre
        // line and only the wash moves, a few centimetres either side.
        x: panel.w / 2,
        y: CALLIGRAPHY_PAD / 2 + slot * (i + 0.5),
        size,
        turn: jitter(char, i + 97) * 0.035,
        drift: jitter(char, i + 31) * panel.w * 0.03,
      })
    })
  } else {
    const slot = Math.max(0.05, (panel.w - CALLIGRAPHY_PAD) / n)
    const size = Math.min(ink, slot * 0.92)
    chars.forEach((char, i) => {
      glyphs.push({
        char,
        // …and a 横排 run is one line across it, so the wash is its rise and fall.
        x: CALLIGRAPHY_PAD / 2 + slot * (i + 0.5),
        y: panel.h / 2,
        size,
        turn: jitter(char, i + 97) * 0.035,
        drift: jitter(char, i + 31) * panel.h * 0.05,
      })
    })
  }

  return { glyphs, axis, style, panel }
}

/* ---------------------------------------------------------------- drawing */

export interface CalligraphyFaceOptions {
  /** The station's name, exactly as the document spells it. */
  text: string
  /** The hand it is written in. */
  style: CalligraphyStyle
  /** The way it runs: 横排 along the wall, 竖排 down it. */
  axis: CalligraphyAxis
  /** The panel's size, metres. */
  panel: CalligraphyPanelSize
  /** Pixels per metre. Defaults to the plate's own resolution. */
  ppm?: number
}

/**
 * Draw one inscription and hand back the layout it drew.
 *
 * The strokes are a `fillText` per character — twice, the second offset and
 * lighter, which is what gives a flat font a brush edge — under a small turn so the
 * run is hand-set. **The station's name is the whole plate**: no seal, no frame, no
 * ground — the wall behind the piece is the inscription's paper, so the piece adds
 * the characters and nothing else.
 */
export function drawCalligraphyPanel(g: CanvasRenderingContext2D, opts: CalligraphyFaceOptions): CalligraphyLayout {
  const ppm = opts.ppm ?? PX_PER_METRE
  const spec = calligraphyStyle(opts.style)
  const chars = Array.from(opts.text.trim())
  const layout = calligraphyLayout(chars.length > 0 ? chars : ['未'], opts.axis, opts.style, opts.panel)

  // The plate is the ink alone: the wall behind the piece is the inscription's
  // paper, so nothing here fills a ground. Both alignments are centred, because
  // every glyph is drawn about its own slot's centre.
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const glyph of layout.glyphs) {
    // The wash runs **across** the run, never along it: a 横排 inscription rises and
    // falls, a 竖排 column wanders a little either side of its line, and in both
    // cases the run itself stays straight.
    const washX = layout.axis === 'v' ? glyph.drift : 0
    const washY = layout.axis === 'v' ? 0 : glyph.drift
    g.save()
    g.translate((glyph.x + washX) * ppm, (glyph.y + washY) * ppm)
    g.rotate(glyph.turn)
    g.scale(spec.stretch, 1)
    g.fillStyle = spec.ink
    g.globalAlpha = 1
    const size = glyph.size * ppm
    g.font = `${spec.italic ? 'italic ' : ''}${spec.weight} ${size}px ${spec.family}`
    g.fillText(glyph.char, 0, 0)
    // The drier second strike: the same character a hair to one side and a little
    // lighter, which is the fibre a brush leaves at the end of a stroke. A hand with
    // no strike (黑体) is one clean pass — a printed sans has no brush edge at all.
    if (spec.strike > 0) {
      g.globalAlpha = 0.42
      g.fillText(glyph.char, size * spec.strike, size * spec.strike * 0.7)
    }
    g.globalAlpha = 1
    g.restore()
  }

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  return layout
}

/** What the piece says, for a notice or a tooltip: `楷书 · 横排`. */
export function calligraphyLabel(style: CalligraphyStyle, axis: CalligraphyAxis): string {
  return `${calligraphyStyle(style).label} · ${CALLIGRAPHY_AXIS_LABEL[axis]}`
}

/** The style spec, re-exported so a caller drawing a swatch has the same table. */
export type { CalligraphyStyleSpec }
