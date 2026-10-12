import { msg } from './i18n.ts'
import { POSTER_CATALOGUE } from './posterCatalogue.ts'
// Billboard formats and the advertising poster catalogue — the 装饰 广告牌
// variants and the artwork they print, GAME-SPEC §5.7.
//
// A billboard is a wall-mounted lightbox whose run is `w` cells along its local
// +x and whose poster has a fixed silhouette. This one table is shared by the
// builder (the module it creates), the placement/collision helpers, the
// renderer (the housing and lit poster it draws) and the palette thumbnails, so
// a variant cannot describe itself differently in two places. Pure data — no
// three, no DOM.
//
// The second table is the poster catalogue. Like the billboard formats it is
// pure data, but only the slugs live here: the artwork itself is a real image
// under `src/assets/posters/<slug>.webp`, and `render/adArt.ts` (browser-only) is the
// one place that pairs the two. Keeping the catalogue here means the placement
// code can roll a poster without touching the DOM.

import type { BillboardShape, BillboardVariant } from './types.ts'

export interface BillboardSpec {
  variant: BillboardVariant
  /** Palette label shown in the 装饰 sub-menu. */
  label: string
  /** Run length in cells along the module's local +x. */
  w: number
  /** Lit poster width and height, metres. */
  panelW: number
  panelH: number
  /** Poster centre height above the floor top, metres. */
  panelZ: number
  /** The poster silhouette this panel is cut for (`AD_POSTERS[].shapes`). */
  shape: BillboardShape
  /**
   * The formats after this one in the sub-menu that are the same family — one
   * landscape panel in three lengths, one portrait, one square. The rail groups
   * by this so a growing menu still reads as a menu; `family[0]` is the head of
   * the family and every member lists the whole family, itself included.
   */
  family: readonly BillboardVariant[]
}

/**
 * The six formats. `panelW`/`panelH` are what the artwork is cut to: the three
 * landscape panels are 16:9, 2.25:1 and 3.75:1 so a real poster fills one
 * without stretching, and the portrait and square sit inside their cells.
 */
export const BILLBOARD_SPECS: Record<BillboardVariant, BillboardSpec> = {
  wide: {
    variant: 'wide',
    label: msg('landscape_16_9'),
    w: 1,
    panelW: 0.86,
    panelH: 0.48,
    panelZ: 1.6,
    shape: 'landscape',
    family: ['wide', 'standard', 'large'],
  },
  standard: {
    variant: 'standard',
    label: msg('standard_2_25_1'),
    w: 2,
    panelW: 1.72,
    panelH: 0.76,
    panelZ: 1.65,
    shape: 'wide',
    family: ['wide', 'standard', 'large'],
  },
  large: {
    variant: 'large',
    label: msg('large_landscape_16_9'),
    w: 2,
    panelW: 1.86,
    panelH: 0.95,
    panelZ: 1.7,
    shape: 'landscape',
    family: ['wide', 'standard', 'large'],
  },
  panorama: {
    variant: 'panorama',
    label: msg('wide_3_75_1'),
    w: 3,
    panelW: 2.82,
    panelH: 0.75,
    panelZ: 1.65,
    shape: 'panorama',
    family: ['panorama'],
  },
  portrait: {
    variant: 'portrait',
    label: msg('portrait_0_7_1'),
    w: 1,
    // The full portrait artwork fits within this panel with narrow margins.
    panelW: 0.8,
    panelH: 1.16,
    panelZ: 1.7,
    shape: 'portrait',
    family: ['portrait'],
  },
  square: {
    variant: 'square',
    label: msg('square_1_1'),
    w: 1,
    panelW: 0.8,
    panelH: 0.8,
    panelZ: 1.55,
    shape: 'square',
    family: ['square'],
  },
}

/**
 * Every variant, in palette order: the landscape family shortest first, so the
 * sub-menu reads 横版 → 标准 → 大横版 → 长幅, then the tall ones.
 */
export const BILLBOARD_VARIANTS: readonly BillboardVariant[] = ['wide', 'standard', 'large', 'panorama', 'portrait', 'square']

/** The variant the palette shows first in the 广告牌 sub-menu. */
export const DEFAULT_BILLBOARD_VARIANT: BillboardVariant = 'wide'

/** The spec for a variant, defaulting to `wide` for an unknown/legacy value. */
export function billboardSpec(variant: BillboardVariant | undefined): BillboardSpec {
  return BILLBOARD_SPECS[variant ?? 'wide'] ?? BILLBOARD_SPECS.wide
}

/* ------------------------------------------------------------ poster catalogue */

export interface AdPoster {
  /** The asset stem: `src/assets/posters/<slug>.webp` (`render/adArt.ts`). */
  slug: string
  /** What the artwork is, for the reading of this table and the test suite. */
  subject: string
  /**
   * The panels this poster may be printed on. A format's `shape` must be in
   * here, or the poster would be rolled for a mismatched display family — the
   * placement roll filters by it (`postersFor`). The render fit uses a centred
   * crop so the image fills its panel without stretching.
   */
  shapes: readonly BillboardShape[]
}

/** Optimized square, portrait and landscape artwork from the supplied folder. */
export const AD_POSTERS: readonly AdPoster[] = POSTER_CATALOGUE

/** Every poster slug, in catalogue order. */
export function adSlugs(): string[] {
  return AD_POSTERS.map((p) => p.slug)
}

/** The poster with this slug, or undefined for an unknown/legacy value. */
export function adPoster(slug: string | undefined): AdPoster | undefined {
  return slug === undefined ? undefined : AD_POSTERS.find((p) => p.slug === slug)
}

/**
 * The posters a panel of this silhouette may print, in catalogue order. Never
 * empty: every shape in `BillboardShape` is claimed by at least one poster, and
 * a shape with no claimant falls back to the whole catalogue so placement can
 * always answer with something.
 */
export function postersFor(shape: BillboardShape): AdPoster[] {
  const matching = AD_POSTERS.filter((p) => p.shapes.includes(shape))
  return matching.length > 0 ? matching : [...AD_POSTERS]
}

/**
 * The poster a module prints. A legacy save or a hand-written station may carry
 * a slug this build does not know, so the catalogue head answers instead — the
 * panel then still reads as a real ad rather than a blank face.
 */
export function posterFor(slug: string | undefined): AdPoster {
  return adPoster(slug) ?? AD_POSTERS[0]
}
