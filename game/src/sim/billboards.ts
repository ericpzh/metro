// Billboard formats — the 装饰 广告牌 variants, GAME-SPEC §5.7.
//
// A billboard is a wall-mounted lightbox whose run is `w` cells along its local
// +x and whose poster has a fixed aspect. This one table is shared by the
// builder (the module it creates), the placement/collision helpers, the
// renderer (the housing and lit poster it draws) and the palette thumbnails, so
// a variant cannot describe itself differently in two places. Pure data — no
// three, no DOM.

import type { BillboardAspect, BillboardVariant } from './types.ts'

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
  /** Which ad-frame aspect set the poster plays (`render/models.ts`). */
  aspect: BillboardAspect
}

export const BILLBOARD_SPECS: Record<BillboardVariant, BillboardSpec> = {
  wide: { variant: 'wide', label: '横版', w: 1, panelW: 0.86, panelH: 0.48, panelZ: 1.6, aspect: 'wide' },
  portrait: { variant: 'portrait', label: '竖版', w: 1, panelW: 0.5, panelH: 1.2, panelZ: 1.7, aspect: 'portrait' },
  square: { variant: 'square', label: '方形', w: 1, panelW: 0.8, panelH: 0.8, panelZ: 1.55, aspect: 'square' },
  large: { variant: 'large', label: '大横版', w: 2, panelW: 1.86, panelH: 0.95, panelZ: 1.7, aspect: 'wide' },
}

/** Every variant, in palette order. */
export const BILLBOARD_VARIANTS: readonly BillboardVariant[] = ['wide', 'portrait', 'square', 'large']

/** The spec for a variant, defaulting to `wide` for an unknown/legacy value. */
export function billboardSpec(variant: BillboardVariant | undefined): BillboardSpec {
  return BILLBOARD_SPECS[variant ?? 'wide'] ?? BILLBOARD_SPECS.wide
}
