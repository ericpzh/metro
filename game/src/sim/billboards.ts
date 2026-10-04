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
// under `src/assets/posters/<slug>.jpg`, and `render/adArt.ts` (browser-only) is the
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
    label: '横版 16:9',
    w: 1,
    panelW: 0.86,
    panelH: 0.48,
    panelZ: 1.6,
    shape: 'landscape',
    family: ['wide', 'standard', 'large'],
  },
  standard: {
    variant: 'standard',
    label: '标准 2.25:1',
    w: 2,
    panelW: 1.72,
    panelH: 0.76,
    panelZ: 1.65,
    shape: 'wide',
    family: ['wide', 'standard', 'large'],
  },
  large: {
    variant: 'large',
    label: '大横版 16:9',
    w: 2,
    panelW: 1.86,
    panelH: 0.95,
    panelZ: 1.7,
    shape: 'landscape',
    family: ['wide', 'standard', 'large'],
  },
  panorama: {
    variant: 'panorama',
    label: '长幅 3.75:1',
    w: 3,
    panelW: 2.82,
    panelH: 0.75,
    panelZ: 1.65,
    shape: 'panorama',
    family: ['panorama'],
  },
  portrait: {
    variant: 'portrait',
    label: '竖版 0.7:1',
    w: 1,
    // 0.8 × 1.16 is 0.69:1 — the two portrait posters in the catalogue are
    // 0.68:1 and 0.75:1, so the tall panel is cut for the artwork rather than
    // the other way round.
    panelW: 0.8,
    panelH: 1.16,
    panelZ: 1.7,
    shape: 'portrait',
    family: ['portrait'],
  },
  square: {
    variant: 'square',
    label: '方形 1:1',
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
  /** The asset stem: `src/assets/posters/<slug>.jpg` (`render/adArt.ts`). */
  slug: string
  /** What the artwork is, for the reading of this table and the test suite. */
  subject: string
  /**
   * The panels this poster may be printed on. A format's `shape` must be in
   * here, or the lit face would show the picture squeezed into the wrong
   * rectangle — the placement roll filters by it (`postersFor`).
   */
  shapes: readonly BillboardShape[]
}

/**
 * The twelve supplied posters, in palette order. This is the whole catalogue:
 * `adSlugs()` is its order and `postersFor()` filters it, so a new image is one
 * row here plus the JPEG beside it.
 */
export const AD_POSTERS: readonly AdPoster[] = [
  // Landscape — a standard poster, at home on 横版 / 标准 / 大横版.
  { slug: 'metro-security', subject: '广州地铁 进站安检', shapes: ['landscape', 'wide'] },
  { slug: 'property-hotline', subject: '售楼处预约专线', shapes: ['landscape', 'wide'] },
  { slug: 'games-2025-blue', subject: '十五运会 激情全运会', shapes: ['landscape', 'wide'] },
  { slug: 'guangdong-league', subject: '粤超 一战城名', shapes: ['landscape', 'wide'] },
  { slug: 'cloud-security', subject: '云安全是什么', shapes: ['landscape', 'wide'] },
  // Wide — a 2.25:1 poster, cut for 标准; 横版 crops it rather than stretching.
  { slug: 'heinz-league', subject: '想赢的番茄在亨氏里', shapes: ['wide', 'landscape'] },
  { slug: 'animal-help', subject: '一撕一拉 流浪猫一餐', shapes: ['wide', 'landscape'] },
  { slug: 'rhinitis-spray', subject: '中药雾化治鼻炎', shapes: ['wide', 'landscape'] },
  // Panorama — a long strip, only the three-cell 长幅 shows it whole.
  { slug: 'yupao-hiring', subject: '鱼泡直聘 找工作', shapes: ['panorama'] },
  { slug: 'haoyibao', subject: '好医保 支持上海医保', shapes: ['panorama'] },
  // Portrait and square.
  { slug: 'games-2025-red', subject: '十五运会 广州开幕', shapes: ['portrait'] },
  { slug: 'heinz-body', subject: '用身体去回答人体的可能', shapes: ['portrait', 'square'] },
]

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
