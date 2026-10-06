// Swing-door sizes and hardware — the 装饰 门 pieces (GAME-SPEC §5.7), and the one
// table the **room doorway** is built from as well.
//
// A 门 is a **free-standing** door: a post at each end, a head across the top and a
// threshold on the floor, with the leaf hung between them. It stands on the ground like
// a 货架 or a 办公桌 — it is placed on a floor tile and needs nothing behind it — rather
// than being bolted to a wall like the 玻璃板. Three things make it its own piece:
//
//   * **It carries its own frame.** The two posts and the head are what hold the leaf
//     up, so the piece is a doorway in its own right: a player can stand it in a hall,
//     across a corridor or at a room's mouth, on any tile with floor under it.
//   * **It comes in four variants.** 单开 (one leaf) or 双开 (a pair meeting in the
//     middle) × 不锈钢 (stainless) or 木. A single door is one cell wide and a double one
//     two, so the leaf count and the space the piece asks for are the same choice.
//   * **The office reuses it.** Rooms draw their doorway with the very same builder
//     (`render/models/pieces/DoorModel.ts`), at the opening's own width, so a door
//     standing on the floor and the door an 办公室 closes itself with are one piece of
//     furniture rather than two near-identical drawings.
//
// This one table is shared by the builder (the module it creates), the placement rules
// (its run and its height), the renderer and the palette thumbnails, so a size cannot
// describe itself differently in two places. Pure data — no three, no DOM.

import type { DoorMaterial, DoorVariant } from './types.ts'

export interface DoorSpec {
  variant: DoorVariant
  /** Palette label shown in the 装饰 sub-menu. */
  label: string
  /** Run length in cells along the module's local +x: one leaf or two. */
  w: number
  /** Panel height in metres, measured from the floor top up. */
  h: number
  material: DoorMaterial
  /** Leaves across the opening: one for 单开, two for 双开. */
  leaves: number
}

/** The material's own name, for a label or a notice. */
export const DOOR_MATERIAL_LABEL: Record<DoorMaterial, string> = {
  steel: '不锈钢',
  wood: '木',
}

/** The leaf count's own name: 单开 / 双开. */
export function doorLeafLabel(leaves: number): string {
  return leaves > 1 ? '双开' : '单开'
}

/** The label one variant's tile wears: `门 单开 不锈钢`. */
export function doorLabel(material: DoorMaterial, leaves: number): string {
  return `门 ${doorLeafLabel(leaves)} ${DOOR_MATERIAL_LABEL[material]}`
}

export const DOOR_SPECS: Record<DoorVariant, DoorSpec> = {
  'steel-1': { variant: 'steel-1', label: doorLabel('steel', 1), w: 1, h: 2.05, material: 'steel', leaves: 1 },
  'steel-2': { variant: 'steel-2', label: doorLabel('steel', 2), w: 2, h: 2.05, material: 'steel', leaves: 2 },
  'wood-1': { variant: 'wood-1', label: doorLabel('wood', 1), w: 1, h: 2.05, material: 'wood', leaves: 1 },
  'wood-2': { variant: 'wood-2', label: doorLabel('wood', 2), w: 2, h: 2.05, material: 'wood', leaves: 2 },
}

/**
 * Every variant, in palette order: the two stainless pieces first, the two wooden
 * ones after them, and the single leaf before the pair at each material — the same
 * order the 座椅 sub-menu reads (a material's own runs together).
 */
export const DOOR_VARIANTS: readonly DoorVariant[] = ['steel-1', 'steel-2', 'wood-1', 'wood-2']

/** The variant the palette shows first in the 门 sub-menu. */
export const DEFAULT_DOOR_VARIANT: DoorVariant = 'steel-1'

/** The spec for a variant, defaulting to the single stainless door for a legacy value. */
export function doorSpec(variant: DoorVariant | undefined): DoorSpec {
  return DOOR_SPECS[variant ?? DEFAULT_DOOR_VARIANT] ?? DOOR_SPECS[DEFAULT_DOOR_VARIANT]
}

/* ------------------------------------------------------------ the hardware */

/**
 * The door's own geometry, shared by the model, the room doorway that reuses it and
 * their tests, so "a post at each end, a head, a threshold and a leaf between them" is a
 * number rather than a habit.
 *
 * The piece is a **free-standing doorway**: `threshold` is the plate it stands on, the
 * two `post`s are its jambs, `head` is the rail across their tops, and the leaf hangs
 * inside that opening on its own plane, `leafSet` back from the middle of the piece. The
 * local `x` runs along the piece, `z` up from the floor top and `y` across it, and every
 * member is measured from the opening's **centre plane** at `y = 0`.
 *
 * The frame is deliberately **not** a wall-mounting surround: it is the structure that
 * holds the leaf up, which is why the piece needs no wall behind it.
 *
 * A leaf wears a kick plate and a pull and **nothing glazed**: a panel lying a few
 * millimetres off the leaf's face is coplanar enough to z-fight, which shimmers as the
 * camera moves, so every fitting stands proud of the leaf by these numbers instead of
 * lying on it.
 */
export const DOOR_FRAME = {
  /**
   * The threshold's thickness (in z), metres, and its run across the doorway (in y).
   * Matches the posts, so the plate the door stands on is as deep as the frame it holds.
   */
  threshold: 0.04,
  thresholdDepth: 0.18,
  /**
   * Each post's width (in x) and its run across the doorway (in y), metres. The depth is
   * the frame's own — the plane it stands on — and a fitting may stand a little proud of it
   * (the pull reaches `leafSet + leaf / 2 + handle` ≈ 0.10, past this half-depth's 0.09):
   * the piece reserves **whole cells**, so what keeps it inside the space it claims is the
   * cell, not this number, and a pull that clears the frame reads as a handle rather than a
   * bump on the door.
   */
  post: 0.06,
  postDepth: 0.18,
  /** The head rail's height (in z) and its run across the piece (in y), metres. */
  head: 0.06,
  /** The leaf's thickness (in y), metres. */
  leaf: 0.04,
  /** How far the leaf's centre plane sits off the opening's centre, metres. */
  leafSet: 0.005,
  /** How far the leaf stops short of the head, and of each post, metres. */
  headGap: 0.01,
  jambGap: 0.01,
  /** The gap between a pair's two leaves, at their meeting edges, metres. */
  meetGap: 0.01,
  /** How proud of the leaf's front face the pull stands, metres. */
  handle: 0.05,
  /**
   * The kick plate's height off the floor and **how proud of the leaf it is**, metres.
   * Every fitting on a leaf stands clear of its face rather than lying on it: two plates
   * a few millimetres apart z-fight at any distance the camera plays at, which shimmers
   * as the view moves.
   */
  kick: 0.22,
  kickProud: 0.01,
  /** How proud of the leaf the pull's studs sit, metres (see `kickProud`). */
  studProud: 0.02,
} as const

/**
 * The leaf's own height: the opening between the threshold and the head. The panel's
 * `panelH` is the **piece's** height, so the leaf is what is left between the threshold
 * it stands on and the head above it.
 */
export function doorLeafHeight(panelH: number): number {
  const { threshold, head, headGap } = DOOR_FRAME
  return Math.max(0.2, panelH - threshold - head - headGap)
}

/**
 * The leaf widths across an opening `inner` metres wide — one leaf for a 单开, a pair
 * meeting in the middle for a 双开, with the jamb and meeting gaps taken out. Pure
 * arithmetic, so the standing piece and the room doorway size their leaves identically.
 */
export function doorLeafWidths(inner: number, leaves: number): number[] {
  const clear = Math.max(0.2, inner - DOOR_FRAME.jambGap * 2)
  if (leaves > 1) {
    const each = Math.max(0.1, (clear - DOOR_FRAME.meetGap) / 2)
    return [each, each]
  }
  return [clear]
}

/**
 * The width of the **opening** between the two posts, metres: the run the piece covers
 * less a post at each end. This is what the leaves are sized across, so the piece reads
 * as a doorway rather than as a wall of leaves.
 */
export function doorOpeningWidth(span: number): number {
  return Math.max(DOOR_FRAME.post * 2 + 0.2, span) - DOOR_FRAME.post * 2
}
