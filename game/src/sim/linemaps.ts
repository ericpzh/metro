// Line system maps — the 装饰 线网图 pieces (GAME-SPEC §5.7).
//
// A 线网图 is the network poster a real station hangs on its wall or stands in its
// concourse. The artwork is **supplied**, not drawn: `src/assets/linemaps/` holds the
// 广州地铁 线网示意图 itself, and `render/lineMapArt.ts` is the one place that pairs
// this table's panel with those pixels — the same split the ad posters use
// (`sim/billboards.ts` names a slug, `render/adArt.ts` holds the JPEG).
//
// Two mounts, **one board**: a wall board bolted flat to a wall and read from one
// side, and a free-standing totem printed on **both** faces. They share the panel and
// therefore the aspect ratio, because they print the same poster — a wall map and a
// concourse totem that cropped the same artwork differently would be two different
// pictures of one network. The totem is the one piece here that is floor-standing
// rather than wall-mounted, and it is **two cells wide** like the board: "more than
// one block" is what a board this shape needs, and on the ground it is free to take it.
//
// This one table is shared by the builder, the placement rules (the run, the courses a
// board wants, the totem's own cell and head), the renderer and the palette
// thumbnails. Pure data — no three, no DOM.

import { wallCourses } from './courses.ts'
import type { LineMapVariant } from './types.ts'

/**
 * The supplied poster's own aspect ratio, and therefore the panel's: 2048 × 2047 px
 * (`src/assets/linemaps/network-map.jpg`). Both mounts are cut to it, so the poster
 * fills its board exactly — `render/lineMapArt.ts` still crops rather than stretches
 * (it cuts the centred window that fits the panel), but on this panel the crop is the
 * whole image, not a slice of it. `test/line-map.test.mjs` reads the file's real
 * header and pins the two against each other.
 */
export const LINE_MAP_ASPECT = 2048 / 2047

/** The board's width, metres — two cells, the same for both mounts. */
export const LINE_MAP_PANEL_W = 1.8

/** The board's height: the width over the poster's own aspect (~1.9 m). */
export const LINE_MAP_PANEL_H = LINE_MAP_PANEL_W / LINE_MAP_ASPECT

/**
 * How far the board's housing stands proud of the panel on every side, metres — the
 * frame the poster is mounted in (`render/models/pieces/LineMapModel.ts` draws a
 * housing `panelH + 0.1` tall). Shared by the collision envelope and the backing rule,
 * so neither can describe the board differently from the model.
 */
export const LINE_MAP_FRAME_PAD = 0.05

/**
 * How high the **wall board's frame** sits above the floor top, metres: a metre for the
 * air a bench against the same wall reserves, the frame's own pad, and a centimetre of
 * daylight. It is a named number because two rules read it — the board's own `panelZ`
 * and the courses it is backed on — and because "just touching" is not a clearance: at
 * exactly 1 m a bench's box and the board's box meet on a float and count as a clash.
 */
export const LINE_MAP_WALL_BOTTOM = 1 + LINE_MAP_FRAME_PAD + 0.01

export interface LineMapSpec {
  variant: LineMapVariant
  /** Palette label shown in the 装饰 sub-menu. */
  label: string
  /** How the piece is mounted: a board on a wall, or a totem on the floor. */
  mount: LineMapVariant
  /** Run length in cells along the module's local +x. */
  w: number
  /** The printed board's size, metres — the same board for both mounts. */
  panelW: number
  panelH: number
  /** The board's centre above the floor top, metres. */
  panelZ: number
  /** The whole piece's drawn height, metres — what its collision body reserves. */
  height: number
  /** True when the map prints on both faces (the totem); a wall board reads one way. */
  doubleSided: boolean
}

export const LINE_MAP_SPECS: Record<LineMapVariant, LineMapSpec> = {
  wall: {
    variant: 'wall',
    label: '墙面线网图',
    mount: 'wall',
    w: 2,
    panelW: LINE_MAP_PANEL_W,
    panelH: LINE_MAP_PANEL_H,
    // The **framed board's** bottom hangs at 1.06 m: a metre for the air a 座椅 against
    // the same wall reserves (`FLAT_HEIGHT.bench`), plus the frame's own pad, plus a
    // centimetre of daylight — so the bench stands under the board rather than touching
    // it at the mercy of a float. Its top is then at 2.91 m, under the storey's ceiling
    // slab, and it crosses the wall's 2nd and 3rd courses (`lineMapWallCourses`).
    panelZ: LINE_MAP_WALL_BOTTOM + LINE_MAP_PANEL_H / 2,
    height: LINE_MAP_WALL_BOTTOM + LINE_MAP_PANEL_H + LINE_MAP_FRAME_PAD,
    doubleSided: false,
  },
  stand: {
    variant: 'stand',
    label: '立式线网图',
    mount: 'stand',
    w: 2,
    // The **same board** as the wall piece, on a plinth: a passenger reads the same
    // map from either direction down the concourse.
    panelW: LINE_MAP_PANEL_W,
    panelH: LINE_MAP_PANEL_H,
    // 0.45 m to the board's bottom on a plinth and a post, 2.35 m to its top: read
    // over, and read across a hall.
    panelZ: 0.45 + LINE_MAP_PANEL_H / 2,
    height: 0.45 + LINE_MAP_PANEL_H + 0.05,
    doubleSided: true,
  },
}

/** Every variant, in palette order: the wall board first, then the totem. */
export const LINE_MAP_VARIANTS: readonly LineMapVariant[] = ['wall', 'stand']

/** The variant the palette shows first in the 线网图 sub-menu. */
export const DEFAULT_LINE_MAP_VARIANT: LineMapVariant = 'wall'

/** The spec for a variant, defaulting to the wall board for a legacy value. */
export function lineMapSpec(variant: LineMapVariant | undefined): LineMapSpec {
  return LINE_MAP_SPECS[variant ?? DEFAULT_LINE_MAP_VARIANT] ?? LINE_MAP_SPECS[DEFAULT_LINE_MAP_VARIANT]
}

/** True when this variant is the free-standing, double-sided totem. */
export function isStandingLineMap(variant: LineMapVariant | undefined): boolean {
  return lineMapSpec(variant).mount === 'stand'
}

/**
 * The wall courses a **wall board** needs behind it, local (0 = the first metre
 * above the floor): the band its panel crosses, with the frame's own clearance
 * (`LINE_MAP_FRAME_PAD`) included, so the rule and the drawn housing agree. The
 * `stand` totem hangs on nothing, so it has none.
 */
export function lineMapWallCourses(spec: LineMapSpec): number[] {
  if (spec.mount !== 'wall') return []
  const bottom = spec.panelZ - spec.panelH / 2
  return wallCourses(bottom - LINE_MAP_FRAME_PAD, spec.panelH + LINE_MAP_FRAME_PAD * 2)
}
