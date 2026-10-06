// Glass panel sizes — the 装饰 玻璃板 pieces (GAME-SPEC §5.7).
//
// A 玻璃板 is the 围栏's wall-mounted cousin: a sheet of glass held by a frame and
// bolted flat to a wall. Two things separate it from a fence, and both are the
// point of the piece:
//
//   * **The frame is the outer frame only.** A fence draws a post and a pair of
//     rails *per cell*, so a run of them reads as a row of 1 m panels. A glass
//     panel has one sill, one head and two end posts around the whole run, with
//     nothing between them, so a three-cell panel is **one** window rather than
//     three windows butted together.
//   * **It comes in sizes.** Six of them — one, two or three cells wide, each in
//     a 1 m and a 2 m height — picked from the rail's sub-menu rather than cycled
//     with Tab, because a size is a choice of furniture rather than a mode.
//
// This one table is shared by the builder (the module it creates), the placement
// rules (its run, its height and the wall courses it needs behind it), the
// renderer and the palette thumbnails, so a size cannot describe itself
// differently in two places. Pure data — no three, no DOM.

import { wallCourses } from './courses.ts'
import type { GlassVariant } from './types.ts'

export interface GlassSpec {
  variant: GlassVariant
  /** Palette label shown in the 装饰 sub-menu. */
  label: string
  /** Run length in cells along the module's local +x. */
  w: number
  /** Panel height in metres, measured from the floor top up. */
  h: number
}

export const GLASS_SPECS: Record<GlassVariant, GlassSpec> = {
  '1x1': { variant: '1x1', label: '玻璃板 1×1', w: 1, h: 1 },
  '2x1': { variant: '2x1', label: '玻璃板 2×1', w: 2, h: 1 },
  '3x1': { variant: '3x1', label: '玻璃板 3×1', w: 3, h: 1 },
  '1x2': { variant: '1x2', label: '玻璃板 1×2', w: 1, h: 2 },
  '2x2': { variant: '2x2', label: '玻璃板 2×2', w: 2, h: 2 },
  '3x2': { variant: '3x2', label: '玻璃板 3×2', w: 3, h: 2 },
}

/** Every size, in palette order: the 1 m band first, the tall ones after it. */
export const GLASS_VARIANTS: readonly GlassVariant[] = ['1x1', '2x1', '3x1', '1x2', '2x2', '3x2']

/** The size the palette shows first in the 玻璃板 sub-menu. */
export const DEFAULT_GLASS_VARIANT: GlassVariant = '1x1'

/** The spec for a size, defaulting to the single-cell 1 m panel for a legacy value. */
export function glassSpec(variant: GlassVariant | undefined): GlassSpec {
  return GLASS_SPECS[variant ?? DEFAULT_GLASS_VARIANT] ?? GLASS_SPECS[DEFAULT_GLASS_VARIANT]
}

/**
 * The wall courses (local, 0 = the first metre above the floor) a panel needs
 * behind it. The panel is cladding: it starts at the floor top and rises its own
 * height, so a 1 m panel bolts to the first course and a 2 m one crosses two — and
 * a wall that stops after one metre cannot carry the tall panel
 * (`wallMountMissing`, `sim/placement.ts`).
 */
export function glassWallCourses(spec: GlassSpec): number[] {
  return wallCourses(0, spec.h)
}

/* ------------------------------------------------------------- the frame */

/**
 * The frame members, as fractions of the panel, shared by the model and its
 * tests so "outer frame only" is a number rather than a habit: the sill and the
 * head are `RAIL` thick and run the full width, each end post is `POST` wide, and
 * the pane is inset by them. Nothing is drawn between the posts — that is the
 * whole difference from a 围栏, which stands one of these frames up per cell.
 */
export const GLASS_FRAME = {
  /** Depth of every member off the wall, metres. */
  depth: 0.1,
  /** The sill's and head's height (in z), metres. */
  rail: 0.1,
  /** The end posts' width (in x), metres. */
  post: 0.1,
  /** How proud of the frame the pane's own face sits, metres. */
  pane: 0.02,
} as const
