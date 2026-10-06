// Station-name calligraphy — the 装饰 站名 pieces (GAME-SPEC §5.7).
//
// A 站名 is the station's own name, drawn as a large ink inscription and bolted
// to a wall: the brush lettering a real station wears beside its name plate. It is
// **generated, not authored** — the characters come from the station document
// (`StationData.name`), so renaming the station reprints every inscription in the
// station, and the piece itself carries no text at all: only the hand it is
// written in (`cfg.style`), whether it runs sideways or down the wall
// (`cfg.axis`), and the panel it was cut for (`w`, `panelH`).
//
// The hand is the *font choice* the sub-menu offers — 楷书 / 行书 / 隶书 / 魏碑 /
// 黑体 / 宋体 — described here as a stack of real families with the ink, the
// tracking and the second (drier) strike that make them read differently even on a
// machine that has never had a Chinese brush face installed. The pixels are
// `render/calligraphyFace.ts`'s business; this module is the table and the
// arithmetic, so a test can ask what a panel's size is without a canvas.
//
// **The panel is sized from the name when the piece is placed, and never again.**
// A wider inscription is a wider piece of wall — it needs more cells backed by
// solid block — so a rename reprints the ink *inside the panel it already has*
// (shrinking the characters to fit) rather than quietly rebuilding a wall of a
// different width behind a placed piece. What the player hangs is where it hangs.
// The width is always an **odd** number of cells (`calligraphyPanelCells`), which
// is what puts the inscription's own centre on the cell the pointer is aimed at;
// a piece a save carries from before that rule keeps the even panel it was cut
// with, since the panel is the piece's own wall footprint.
//
// Pure data — no three, no DOM.

import { wallCourses } from './courses.ts'
import type { CalligraphyAxis, CalligraphyStyle } from './types.ts'

export interface CalligraphyStyleSpec {
  style: CalligraphyStyle
  /** Palette label. */
  label: string
  /** Font weight for the canvas face (`400` or `700`). */
  weight: string
  /**
   * Whether the hand leans. 行书 is a running script and is the one style whose
   * strokes are slanted; the browser synthesises the oblique for a family with no
   * italic face of its own, which is exactly the look this wants.
   */
  italic: boolean
  /** The font stack, in preference order: a real brush face first, a stock fallback last. */
  family: string
  /** The ink the characters are printed in. */
  ink: string
  /** The second strike's offset, as a fraction of the ink size (0 for a clean hand). */
  strike: number
  /** Extra tracking between characters, as a fraction of the ink size. */
  tracking: number
  /** The characters are stretched across their box by this much (隶书 is wide). */
  stretch: number
}

/**
 * The six hands, in palette order: the three brush hands first (楷 / 行 / 隶), then
 * the stele, then the two that a sign shop would print — 黑体 and 宋体.
 */
export const CALLIGRAPHY_STYLES: Record<CalligraphyStyle, CalligraphyStyleSpec> = {
  kai: {
    style: 'kai',
    label: '楷书',
    weight: '400',
    italic: false,
    family: '"KaiTi", "STKaiti", "Kaiti SC", "Kaiti TC", "DFKai-SB", "SimSun", serif',
    ink: '#171a20',
    strike: 0.014,
    tracking: 0.02,
    stretch: 1,
  },
  xing: {
    style: 'xing',
    label: '行书',
    weight: '400',
    italic: true,
    family: '"STXingkai", "Xingkai SC", "KaiTi", "STKaiti", "DFKai-SB", cursive',
    ink: '#14161b',
    strike: 0.032,
    tracking: 0.05,
    stretch: 1.02,
  },
  li: {
    style: 'li',
    label: '隶书',
    weight: '400',
    italic: false,
    family: '"LiSu", "Baoli SC", "SimLi", "STLiti", "STSong", serif',
    ink: '#1b1d22',
    strike: 0.008,
    tracking: 0.11,
    stretch: 1.1,
  },
  wei: {
    style: 'wei',
    label: '魏碑',
    weight: '700',
    italic: false,
    family: '"STXinwei", "Weibei SC", "SimHei", "Microsoft YaHei", sans-serif',
    ink: '#101217',
    strike: 0.026,
    tracking: 0,
    stretch: 1.03,
  },
  hei: {
    style: 'hei',
    label: '黑体',
    weight: '700',
    italic: false,
    family: '"Microsoft YaHei", "PingFang SC", "Heiti SC", "SimHei", sans-serif',
    ink: '#1d2126',
    // A printed sans has no brush edge at all: one clean strike, which is what the
    // modern station wall beside a 楷书 inscription looks like.
    strike: 0,
    tracking: 0.03,
    stretch: 1,
  },
  song: {
    style: 'song',
    label: '宋体',
    weight: '400',
    italic: false,
    family: '"SimSun", "Songti SC", "STSong", "Noto Serif SC", serif',
    ink: '#191c22',
    strike: 0.012,
    tracking: 0.04,
    stretch: 0.97,
  },
}

/** Every hand, in palette order. */
export const CALLIGRAPHY_STYLE_LIST: readonly CalligraphyStyle[] = ['kai', 'xing', 'li', 'wei', 'hei', 'song']

/** The two ways the inscription runs. */
export const CALLIGRAPHY_AXES: readonly CalligraphyAxis[] = ['h', 'v']

/** What each axis is called in the palette. */
export const CALLIGRAPHY_AXIS_LABEL: Record<CalligraphyAxis, string> = { h: '横排', v: '竖排' }

/** The hand and the axis a legacy or hand-written module falls back to. */
export const DEFAULT_CALLIGRAPHY_STYLE: CalligraphyStyle = 'kai'
export const DEFAULT_CALLIGRAPHY_AXIS: CalligraphyAxis = 'h'

/** The style spec, defaulting to 楷书 for an unknown/legacy value. */
export function calligraphyStyle(style: CalligraphyStyle | undefined): CalligraphyStyleSpec {
  return CALLIGRAPHY_STYLES[style ?? DEFAULT_CALLIGRAPHY_STYLE] ?? CALLIGRAPHY_STYLES[DEFAULT_CALLIGRAPHY_STYLE]
}

export function isCalligraphyStyle(v: unknown): v is CalligraphyStyle {
  return typeof v === 'string' && v in CALLIGRAPHY_STYLES
}

export function isCalligraphyAxis(v: unknown): v is CalligraphyAxis {
  return v === 'h' || v === 'v'
}

/* ------------------------------------------------------------- the panel */

/** One character's advance, metres — what the run wants per character. */
export const CALLIGRAPHY_ADVANCE = 0.86

/** The largest a character is cut, metres. */
export const CALLIGRAPHY_INK_MAX = 0.85

/** The margin the panel keeps around the run, metres (half at each end). */
export const CALLIGRAPHY_PAD = 0.3

/** The most characters an inscription carries; the rest are dropped. */
export const CALLIGRAPHY_MAX_CHARS = 8

/** What a name that has none of its own is printed as (`StationData.name` is never blank). */
export const CALLIGRAPHY_FALLBACK_NAME = '未命名车站'

/**
 * 横排: a band one course high at eye height — 1.2 m up, so the characters run
 * roughly 1.2–2.2 m above the floor the player stands on and keep a good margin under
 * the storey's ceiling. 竖排: a column in one cell, from near the floor up to the
 * ceiling slab.
 *
 * `maxCells` is **odd, and so is every panel under it** (`calligraphyPanelCells`):
 * a run is centred on the cell the pointer is on, and only an odd count leaves
 * the inscription's own centre on that cell. An even one puts it on the boundary
 * between two cells — half a metre to one side of the tile the player aimed at —
 * which for a short name is the whole inscription.
 */
export const CALLIGRAPHY_H = { panelH: 1, bottom: 1.2, maxCells: 5 } as const
export const CALLIGRAPHY_V = { panelW: 0.98, bottom: 0.4, maxPanelH: 2.6 } as const

export interface CalligraphyGeometry {
  /** The characters the inscription prints, in reading order. */
  chars: string[]
  axis: CalligraphyAxis
  /** The panel's size, metres. */
  panelW: number
  panelH: number
  /** The character size the ink is cut at, metres. */
  ink: number
  /** The run in cells along the module's local +x — the module's `w`. */
  cells: number
  /** The panel's bottom edge above the floor top, metres. */
  bottom: number
  /**
   * The wall courses the panel crosses, local (0 = the first metre above the
   * floor): every one of them needs solid backing behind the piece.
   */
  courses: number[]
}

/**
 * The characters an inscription prints. A blank name (which cannot be saved) falls
 * back to 未命名车站, and a name past `CALLIGRAPHY_MAX_CHARS` is cut off — eight
 * characters already sets at about half the size a two-character name gets on the same
 * panel, and a ninth would only shrink the eight that are there.
 */
export function calligraphyChars(name: string): string[] {
  const chars = Array.from(name.trim())
  const usable = chars.length > 0 ? chars : Array.from(CALLIGRAPHY_FALLBACK_NAME)
  return usable.slice(0, CALLIGRAPHY_MAX_CHARS)
}

/**
 * The wall courses a panel from `bottom` to `bottom + panelH` crosses: the
 * inscription's own reading of `wallCourses`, so the piece and the rule that backs
 * it can never disagree about where a course begins.
 */
export function calligraphyCourses(bottom: number, panelH: number): number[] {
  return wallCourses(bottom, panelH)
}

/** The panel's bottom edge above the floor top, for an axis. */
export function calligraphyBottom(axis: CalligraphyAxis): number {
  return axis === 'v' ? CALLIGRAPHY_V.bottom : CALLIGRAPHY_H.bottom
}

/**
 * The panel a 横排 run of `want` metres takes, in whole cells: rounded **up to the
 * next odd** count, clamped to `[1, CALLIGRAPHY_H.maxCells]`.
 *
 * The odd step is the point of this function, and it is about aiming rather than
 * about looks. The factory centres a run on the cell the pointer is on
 * (`trackOriginForCentre`), so a run of `c` cells covers `(c - 1) / 2` cells either
 * side of it: centred **on that cell's own centre** for an odd `c`, and on the
 * **boundary between two cells** for an even one. The ink is centred in its panel
 * (`calligraphyLayout`), so an even panel drew the station's name half a metre to
 * one side of the tile under the pointer — invisible in the middle of a long run
 * of characters, but the whole piece when the name is one or two characters, which
 * read as a 站名 that was not following the mouse.
 *
 * The ceiling is odd for the same reason: a name long enough to be capped must land
 * on an odd count too, or the cap itself would put it back on a cell edge.
 */
export function calligraphyPanelCells(want: number, max: number = CALLIGRAPHY_H.maxCells): number {
  const up = Math.max(1, Math.ceil(want - 1e-9))
  const odd = up % 2 === 1 ? up : up + 1
  // The ceiling is odd as well (`CALLIGRAPHY_H.maxCells`), and a caller that hands
  // over an even one still gets an odd count back: odd is the contract, not a
  // property of the default.
  const ceiling = Math.max(1, max % 2 === 1 ? max : max - 1)
  return Math.min(odd, ceiling)
}

/**
 * The panel a station name is cut for, on an axis.
 *
 * 横排 is a whole number of cells wide — the panel **is** its run, so what the
 * collision envelope reserves is what the wall carries — from one cell up to
 * `CALLIGRAPHY_H.maxCells`, at a fixed 1 m height. The count steps in **odd**
 * numbers (`calligraphyPanelCells`), so the run is symmetric about the cell the
 * pointer is on at every name length and the inscription's own centre lands on the
 * tile being aimed at.
 *
 * 竖排 is one cell wide and as tall as the name wants, up to `maxPanelH`, which is
 * what keeps its top under the storey's ceiling slab (the free height above a
 * floor is 3 m, and the column starts at 0.4 m). One cell is odd, so the column is
 * centred on the pointer's own cell like every 横排 panel.
 *
 * Either way the characters are cut to fit whatever the panel turned out to be, so
 * a name too long for its ceiling sets smaller type rather than spilling off the
 * panel.
 */
export function calligraphyGeometry(name: string, axis: CalligraphyAxis): CalligraphyGeometry {
  const chars = calligraphyChars(name)
  const n = chars.length
  const want = CALLIGRAPHY_PAD + n * CALLIGRAPHY_ADVANCE
  if (axis === 'v') {
    const panelW = CALLIGRAPHY_V.panelW
    const panelH = Math.min(CALLIGRAPHY_V.maxPanelH, Math.max(1, want))
    const bottom = CALLIGRAPHY_V.bottom
    const advance = (panelH - CALLIGRAPHY_PAD) / n
    return {
      chars,
      axis,
      panelW,
      panelH,
      ink: Math.min(CALLIGRAPHY_INK_MAX, advance * 0.92),
      cells: 1,
      bottom,
      courses: calligraphyCourses(bottom, panelH),
    }
  }
  const cells = calligraphyPanelCells(want)
  const panelH = CALLIGRAPHY_H.panelH
  const bottom = CALLIGRAPHY_H.bottom
  const advance = (cells - CALLIGRAPHY_PAD) / n
  return {
    chars,
    axis,
    panelW: cells,
    panelH,
    ink: Math.min(CALLIGRAPHY_INK_MAX, advance * 0.92),
    cells,
    bottom,
    courses: calligraphyCourses(bottom, panelH),
  }
}

/**
 * The panel a **placed** module draws: the size recorded on it, not the size the
 * name would want today. A rename reprints the ink inside this box
 * (`render/calligraphyFace.ts` fits the characters to the panel it is given), so
 * the geometry the model draws and the plate the player reads cannot disagree.
 */
export function calligraphyPanelSize(axis: CalligraphyAxis, w: number, panelH: number): { w: number; h: number } {
  return {
    // 横排's panel is its run, so the recorded cell count *is* the metres; 竖排's
    // column is one cell wide and never fills it, so it takes the column's width.
    w: axis === 'v' ? CALLIGRAPHY_V.panelW : Math.max(0.5, w || 1),
    h: Math.max(0.4, panelH || CALLIGRAPHY_H.panelH),
  }
}
