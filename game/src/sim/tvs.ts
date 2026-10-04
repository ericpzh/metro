// Two 电视 on one tile, back to back (装饰, GAME-SPEC §5.7).
//
// A 电视 is normally one panel hung over one cell, lit on its local −y face and
// dark behind. Two of them dropped on the *same* cell facing opposite ways is a
// single object in the real world — one housing with a screen on each face, which
// is how a concourse hangs a screen over a passage that is walked both ways — so
// this module owns the whole rule: when the pair is legal, which element hangs the
// shared hardware, and which way each one looks.
//
// It is one module because three separate places have to agree about it and none
// of them may guess:
//
//   * `sim/placement.ts` exempts the pair from the strict "two modules may not
//     share space" rule — but only the pair, and only facing 180° apart;
//   * `render/models.ts` draws the shared housing **once**, because two housings in
//     one cell are not merely wasteful: the housing is symmetric about its centre,
//     so each panel's dark backing is left-half-coincident with the other's — the
//     station board ends up exactly coplanar with the far face of the opposite
//     backing and z-fights it, and the backing also swallows the outer 0.006 m of
//     the lit pane (see `test/tv-pair.test.mjs`);
//   * the picker has to know which of the two the pointer is looking at, or a
//     right-click on either one bulldozes whichever happens to be first in the
//     module list.
//
// Pure data — no three, no DOM.

import { normRot, rotateLocal } from './track.ts'
import type { Module } from './types.ts'

type Tv = Extract<Module, { type: 'tv' }>

/** The pair has no 180° axis: the two look the same way, or across each other. */
export const TV_PAIR_AXIS_NONE = -1

/**
 * The 180° axis the two 电视 are back to back on, or `TV_PAIR_AXIS_NONE`.
 *
 * `0` is the north–south pair (local ±y: rot 0 looking −y, rot 2 looking +y) and
 * `1` the east–west one (rot 1 looking +x, rot 3 looking −x) — `sim/track.ts`'s
 * counter-clockwise quarter-turn, so `rotateLocal(rot, 0, -1)` is each TV's
 * viewing direction.
 *
 * Two pieces a quarter-turn apart are deliberately **not** a pair. Physically they
 * would be two panels crossing inside one block, and the merged draw would then be
 * wrong rather than merely ugly: the pair shares one housing, and a housing whose
 * two screens are perpendicular has no single body to draw them on. The builder
 * refuses that arrangement instead of drawing a lie (`placementColliders`).
 *
 * The relation is symmetric: rotating the two by the same amount keeps both the
 * axis and the 180° between them, and reversing the arguments changes nothing
 * because the answer depends only on which axis the *first* one looks along.
 */
export function tvPairAxis(a: Tv, b: Tv): number {
  const ra = normRot(a.rot)
  const rb = normRot(b.rot)
  if (normRot(rb - ra) !== 2) return TV_PAIR_AXIS_NONE
  return ra % 2
}

/** True when the two 电视 face each other across one tile, so they may share it. */
export function tvBackToBack(a: Tv, b: Tv): boolean {
  return tvPairAxis(a, b) !== TV_PAIR_AXIS_NONE
}

/**
 * Which way a 电视 looks, as a world step. The model is built with its lit face on
 * local −y (`buildTv`), and `placeLocal` turns it by `rot`, so this is that face's
 * world direction — the same relationship `wallSide` describes for a 广告牌.
 *
 * Normalised to a plain 0 on the axis it does not use, exactly as `wallSide` does:
 * the quarter-turn maths yields `-0` for a half turn, and a caller comparing steps
 * (or a test reading them) should not have to know that.
 */
export function tvFacing(rot: number | undefined): [number, number] {
  const [dx, dy] = rotateLocal(rot, 0, -1)
  return [dx === 0 ? 0 : dx, dy === 0 ? 0 : dy]
}

/** A 电视's part in its back-to-back pair, as `render/models.ts` draws it. */
export interface TvPairSlot {
  /**
   * `true` for the element that draws the whole pair: the shared housing — the
   * bezel, the two suspension rods and the ceiling plates. The other element draws
   * only its own lit panes and their backing on that housing.
   */
  hangs: boolean
  /**
   * The pair shares a housing, and this is how deep it is: two panels' worth. It is
   * a **presence** rather than a measurement the model needs handed to it (`0` is a
   * lone 电视, anything else a pair), because the thickness of one panel is the
   * model's own business — `TV_HALF_DEPTH` in `render/models.ts`. The value here is
   * that thickness doubled, so the two sides of the interface state the same number.
   *
   * **Which side a member prints on is not here, and must not be.** A 电视's panes
   * are always built on its own local −y — that is the model the station has had
   * since it was a poster — and a pair's two members end up on opposite sides of the
   * cell because their `rot` values differ by a half-turn and `placeLocal` turns each
   * group by its own. Handing the model a "which way" as well would rotate the same
   * turn twice: expressed in the module's frame it cancels the group's own turn and
   * puts both screens on one side of the cell, facing the same way, which is the
   * defect this whole module exists to avoid. `test/tv-pair.test.mjs` pins the two
   * sides of the cell, not the two values of a field.
   */
  depth: number
  /** The element hanging the pair on the ceiling, for the rods and their plates. */
  rodId: string
}

/**
 * The depth of one 电视 panel, either side of its own origin, in metres. The
 * renderer's `TV_HALF_DEPTH` is the same number and the same single source of the
 * shape: **two** of these make a back-to-back pair, so a merged pair is a slim
 * housing rather than a metre-deep box. Restated here because this module decides
 * whether a piece is *in* a pair, and `test/tv-pair.test.mjs` checks the drawn pair
 * against the number the rule reports.
 */
export const TV_HALF = 0.05

/**
 * How one 电视 draws itself among the others on its cell.
 *
 * `moduleId` is the piece being drawn and `modules` the station's live list, in
 * document order. A lone TV, or one whose cell also holds a piece that is not its
 * back-to-back partner, comes back as a whole unit of its own — the ordinary
 * one-sided 电视, drawn exactly as it always was, which is what keeps a station
 * built before this rule rendering unchanged.
 *
 * Among a legal pair the **first piece in the document hangs them both**, so the
 * choice is a property of the station rather than of the draw order: the ghost,
 * the frame and a reload all agree, and moving one of the pair out of the cell
 * flips the other back to hanging itself with nothing to migrate.
 */
export function tvPairSlot(moduleId: string, modules: readonly Module[]): TvPairSlot {
  const me = findTv(modules, moduleId)
  if (!me) return { hangs: true, depth: 0, rodId: moduleId }
  const mate = partnerOf(me, modules)
  if (!mate) return { hangs: true, depth: 0, rodId: moduleId }
  // Back to back on one tile: the two panels stand against each other, so the housing
  // they share is exactly two panels thick and nothing more.
  const first = modules.findIndex((m) => m.id === me.id) < modules.findIndex((m) => m.id === mate.id)
  return { hangs: first, depth: 2 * TV_HALF, rodId: first ? me.id : mate.id }
}

function findTv(modules: readonly Module[], id: string): Tv | undefined {
  const m = modules.find((x) => x.id === id)
  return m && m.type === 'tv' ? m : undefined
}

/** The other 电视 sharing this one's cell and facing back at it, if any. */
function partnerOf(me: Tv, modules: readonly Module[]): Tv | undefined {
  return modules.find(
    (m): m is Tv => m.type === 'tv' && m !== me && m.x === me.x && m.y === me.y && m.z === me.z && tvBackToBack(me, m),
  )
}
