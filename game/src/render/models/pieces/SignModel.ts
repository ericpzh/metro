// Wayfinding sign (指示牌) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { omitModelDetail, tubeModelDetail } from '../../modelDetail.ts'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { mountedSignBoards, signBoardsOf, signBoardsPanel, signMountSpec } from '../../../sim/sign.ts'
import type { SignBoards, SignLayout, SignPanelSize } from '../../../sim/sign.ts'
import type { Module } from '../../../sim/types.ts'
import { BOOTH_SIGN_PANEL_Z, WALL_SIGN_STAND_OFF } from '../../../sim/boothSigns.ts'
import { hangCeilingLocal } from '../../../sim/placement.ts'

/* ----------------------------------------------------------------- sign */

/** How deep the hung board's own dark body is, metres. */
const BOARD_T = 0.08

/**
 * Wayfinding sign (指示牌, 装饰), in the two mounts `sim/sign.ts` describes:
 *
 *  * **吊挂** (`cfg.mount` absent or `ceiling`) — a lit directional board hung by two
 *    rods from the storey ceiling, readable from both faces. The floor top is the
 *    local origin and the ceiling slab is one storey up (`LEVEL_STEPS`, 4 m = local
 *    z 3.0), which is exactly what `ceilingMountMissing` required before the piece
 *    could be placed. `placeLocal` turns the board with the placement rotation, so
 *    R aims it along the concourse or across it.
 *  * **墙面** (`cfg.mount: 'wall'`) — the same board bolted flat to the wall on the
 *    piece's local −y face, at the eye height `SIGN_WALL_PANEL_Z` names, read from the
 *    room it faces. It hangs on nothing and so carries no rods or housing; its printed
 *    sheet sits 3 mm proud of the wall. Its wall is the placement rotation's, exactly
 *    as a 广告牌's is, so
 *    `autofaceWallMount` can turn it and the rule that asks for backing and the model
 *    that draws the panel agree about which way it faces.
 *
 * Either way the panel is **cut to the content the mount carries**
 * (`mountedSignBoards` → `signBoardsPanel`): a wide board is a wide panel, and
 * on the hung board — the one that mounts both faces — a short back prints on the same
 * panel as a long front, while a wall board is sized to its 正面 alone however long a
 * back its `cfg` still carries.
 *
 * The two faces of a **hung** sign are **two boards** (§5.8): 正面 (`cfg.front`) is the
 * panel's left face and 背面 (`cfg.back`) its right, and each prints its own list,
 * drawn by `render/signFace.ts` from the module's own document, with the line shields
 * reading the live station document. Neither is mirrored for the other: a plate is
 * turned `π` from its neighbour (`plate`'s yaw), which is precisely what leaves
 * both right way up for the passenger each one faces — so text and arrows on the
 * back read correctly from behind without any redrawing of the plate. A **wall**
 * board has one face: the wall is behind it, so `cfg.back` is not read at all.
 *
 * A face with nothing on it is **not** mounted at all. The hung sign's black lightbox
 * shows through on its unprinted back; a wall sign shows the wall behind its sheet.
 */
function buildSign(ctx: ModuleContext, mod: Extract<Module, { type: 'sign' }>): THREE.Group {
  const g = new THREE.Group()
  // A sign with neither face composed — a save written before a board was a
  // document, or one that lost its own — prints the station's default board on the
  // **front** rather than a blank face, which is the board `toState` backfills it
  // with. The front is the one face that is never allowed to be empty: a sign with
  // nothing on either side has no message to show.
  const spec = signMountSpec(mod.cfg.mount)
  // The boards the **mount** actually mounts: a wall board is 正面 alone, so a stray back
  // in the document can neither widen its steel nor shift its plate (`mountedSignBoards`).
  const boards = mountedSignBoards(mod.cfg.mount, signBoardsOf(mod.cfg, ctx.data))
  const panel = signBoardsPanel(boards)
  // A **hung** board rides just under the surface it hangs from (`hangCeilingLocal`): the slab
  // over its cell, or the line the player aimed at — its own 0.65 m of rod and plate, so a board
  // under a 4 m ceiling hangs where it always did and still hugs a taller one. The **wall** board
  // is bolted at `panelZ` as it always was.
  if (spec.hung) mountHangingSign(ctx, mod, boards, panel, hangCeilingLocal(mod, ctx.data.cells, ctx.data.modules) - SIGN_HANG, g)
  else mountWallSign(ctx, mod, boards, panel, mod.cfg.boothId ? BOOTH_SIGN_PANEL_Z : spec.panelZ, g)
  return g
}

/**
 * The board's centre, in metres, below the surface a **hung** board hangs from: the drop its own
 * rods and ceiling plate make, so a board sits close under the slab rather than a metre down.
 */
const SIGN_HANG = 0.65

/**
 * The **hung** board: two rods up to the ceiling plate, a dark steel frame around a
 * black lightbox, and one lit plate per composed face.
 *
 * The rods are spaced to the board's own width, so a wide sign hangs from two rods
 * that really are under it.
 */
function mountHangingSign(
  ctx: ModuleContext,
  mod: Extract<Module, { type: 'sign' }>,
  boards: SignBoards,
  panel: SignPanelSize,
  /** The panel's centre above the floor top, metres (`signMountSpec`). */
  zc: number,
  g: THREE.Group,
): void {
  const W = panel.w
  const H = panel.h
  const ceiling = hangCeilingLocal(mod, ctx.data.cells, ctx.data.modules)
  const rodX = Math.max(0.22, W / 2 - 0.35)
  for (const x of [-rodX, rodX]) {
    tubeModelDetail(slab(g, ctx.mats.steel, x, 0, (zc + H / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + H / 2) - 0.04))
    omitModelDetail(slab(g, ctx.mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04))
  }
  // Panel body: a dark steel frame around a black lightbox.
  slab(g, ctx.mats.darkSteel, 0, 0, zc, W, BOARD_T, H)
  omitModelDetail(slab(g, ctx.mats.black, 0, 0, zc, W - 0.03, BOARD_T + 0.012, H - 0.03))
  // The lit faces, each drawn the right way up and carrying **its own** board: the
  // left face is 正面, the right is 背面, and the two yaws are what turn each plate
  // toward the passenger it serves.
  for (const [y, yaw, face, layout] of [
    [BOARD_T / 2 + 0.012, Math.PI, 'left', boards.front],
    [-BOARD_T / 2 - 0.012, 0, 'right', boards.back],
  ] as const) {
    // A face with nothing to print is left as the model's own black panel rather
    // than hanging a blank lit plate — which is what the back of a one-sided sign
    // is, and what the piece's own dark lightbox already looks like.
    if (!signFaceHasInk(layout, face)) continue
    const mat = ctx.signFace ? ctx.signFace(mod.id, layout, face, panel) : ctx.mats.signFace
    const mesh = plate(g, mat, W - 0.06, H - 0.06, 0, y, zc, yaw)
    mesh.renderOrder = 1
  }
}

/**
 * The **wall** board: its printed sheet sits just off the local −y wall at eye height,
 * with 正面 on the one face a passenger can read. There is no housing behind it.
 *
 * The wall is its only backing; omitting the steel body keeps the sign close to the
 * wall while leaving the room in front of it clear.
 */
function mountWallSign(
  ctx: ModuleContext,
  mod: Extract<Module, { type: 'sign' }>,
  boards: SignBoards,
  panel: SignPanelSize,
  /** The panel's centre above the floor top, metres (`SIGN_WALL_PANEL_Z`). */
  zc: number,
  g: THREE.Group,
): void {
  const W = panel.w
  const H = panel.h
  if (mod.cfg.boothId) {
    // The booth header is the backing: attach only the printed sheet (§5.8).
    if (!signFaceHasInk(boards.front, 'left')) return
    const mat = ctx.signFace ? ctx.signFace(mod.id, boards.front, 'left', panel) : ctx.mats.signFace
    const sheet = plate(g, mat, W, H, 0, -0.5 + WALL_SIGN_STAND_OFF, zc, Math.PI)
    sheet.renderOrder = 1
    return
  }
  // 正面, facing into the room. The wall itself backs this plate; a box here would
  // stand proud of the wall and obscure adjacent equipment in a narrow passage.
  if (!signFaceHasInk(boards.front, 'left')) return
  const mat = ctx.signFace ? ctx.signFace(mod.id, boards.front, 'left', panel) : ctx.mats.signFace
  const mesh = plate(g, mat, W, H, 0, -0.5 + WALL_SIGN_STAND_OFF, zc, Math.PI)
  mesh.renderOrder = 1
}

/** True when any component of `layout` prints on `face`. */
function signFaceHasInk(layout: SignLayout, face: 'left' | 'right'): boolean {
  return layout.some((c) => c.side === 'both' || c.side === face)
}

export class SignModel extends PieceBuilder {
  readonly kind = 'sign'
  build(mod: Extract<Module, { type: 'sign' }>): THREE.Group {
    const group = placeLocal(buildSign(this.ctx, mod), mod)
    if (mod.cfg.mount === 'wall' && mod.cfg.boothId) {
      group.position.x += mod.cfg.boothOffset?.x ?? 0
      group.position.y += mod.cfg.boothOffset?.y ?? 0
    }
    return group
  }
}
