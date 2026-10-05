// Overhead wayfinding sign (指示牌) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { signBoardsOf, signBoardsPanel } from '../../../sim/sign.ts'
import type { SignLayout } from '../../../sim/sign.ts'
import type { Module } from '../../../sim/types.ts'

/* ----------------------------------------------------------------- sign */

/**
 * Overhead wayfinding sign (指示牌, 装饰): a lit directional board hung by two
 * rods from the storey ceiling, readable from both faces. The floor top is the
 * local origin and the ceiling slab is one storey up (`LEVEL_STEPS`, 4 m = local
 * z 3.0), which is exactly what `ceilingMountMissing` required before the piece
 * could be placed. `placeLocal` turns the board with the placement rotation, so
 * R aims it along the concourse or across it.
 *
 * The two faces are **two boards** (§5.8): 正面 (`cfg.front`) is the panel's left
 * face and 背面 (`cfg.back`) its right, and each prints its own list, drawn by
 * `render/signFace.ts` from the module's own document, with the line shields
 * reading the live station document. Neither is mirrored for the other: a plate is
 * turned `π` from its neighbour (`plate`'s yaw), which is precisely what leaves
 * both right way up for the passenger each one faces — so text and arrows on the
 * back read correctly from behind without any redrawing of the plate.
 *
 * A face with nothing on it is **not** mounted at all, and the model's own black
 * lightbox shows through: that is what the back of a freshly placed sign is, and
 * what a genuinely one-way sign is from behind. The two plates share the pair's
 * panel (`signBoardsPanel`), so the hardware is cut to the longer of the two faces
 * and a short back prints on the same piece of steel as a long front.
 */
function buildSign(ctx: ModuleContext, mod: Extract<Module, { type: 'sign' }>): THREE.Group {
  const g = new THREE.Group()
  // The board's own dimensions, taken from the layout module so the drawn panel
  // and the printed faces cannot disagree about their size (`sim/sign.ts`). A sign
  // **grows with its content**, so the hardware is cut to the settled panel rather
  // than to a constant.
  //
  // A sign with neither face composed — a save written before a board was a
  // document, or one that lost its own — prints the station's default board on the
  // **front** rather than a blank face, which is the board `toState` backfills it
  // with. The front is the one face that is never allowed to be empty: a sign with
  // nothing on either side is a black rectangle in the station with nothing
  // anywhere to say why.
  const boards = signBoardsOf(mod.cfg, ctx.data)
  const panel = signBoardsPanel(boards)
  const W = panel.w
  const H = panel.h
  const T = 0.08
  const zc = 2.35 // panel centre above the floor top
  const ceiling = 3.0 // the storey ceiling underside
  // Suspension rods and their ceiling plates, spaced to the board's own width so a
  // wide sign hangs from two rods that really are under it.
  const rodX = Math.max(0.22, W / 2 - 0.35)
  for (const x of [-rodX, rodX]) {
    slab(g, ctx.mats.steel, x, 0, (zc + H / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + H / 2) - 0.04)
    slab(g, ctx.mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
  }
  // Panel body: a dark steel frame around a black lightbox.
  slab(g, ctx.mats.darkSteel, 0, 0, zc, W, T, H)
  slab(g, ctx.mats.black, 0, 0, zc, W - 0.03, T + 0.012, H - 0.03)
  // The lit faces, each drawn the right way up and carrying **its own** board: the
  // left face is 正面, the right is 背面, and the two yaws are what turn each plate
  // toward the passenger it serves.
  for (const [y, yaw, face, layout] of [
    [T / 2 + 0.012, Math.PI, 'left', boards.front],
    [-T / 2 - 0.012, 0, 'right', boards.back],
  ] as const) {
    // A face with nothing to print is left as the model's own black panel rather
    // than hanging a blank lit plate — which is what the back of a one-sided sign
    // is, and what the piece's own dark lightbox already looks like.
    if (!signFaceHasInk(layout, face)) continue
    const mat = ctx.signFace ? ctx.signFace(mod.id, layout, face, panel) : ctx.mats.signFace
    const mesh = plate(g, mat, W - 0.06, H - 0.06, 0, y, zc, yaw)
    mesh.renderOrder = 1
  }
  return g
}

/** True when any component of `layout` prints on `face`. */
function signFaceHasInk(layout: SignLayout, face: 'left' | 'right'): boolean {
  return layout.some((c) => c.side === 'both' || c.side === face)
}

export class SignModel extends PieceBuilder {
  readonly kind = 'sign'
  build(mod: Extract<Module, { type: 'sign' }>): THREE.Group {
    return placeLocal(buildSign(this.ctx, mod), mod)
  }
}

