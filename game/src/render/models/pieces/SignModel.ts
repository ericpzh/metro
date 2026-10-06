// Wayfinding sign (指示牌) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { mountedSignBoards, signBoardsOf, signBoardsPanel, signMountSpec } from '../../../sim/sign.ts'
import type { SignBoards, SignLayout, SignPanelSize } from '../../../sim/sign.ts'
import type { Module } from '../../../sim/types.ts'

/* ----------------------------------------------------------------- sign */

/** How deep the board's own dark body is, metres (the hung panel's thickness). */
const BOARD_T = 0.08

/**
 * The wall body's own thickness, metres — its back face is **flush with the wall** and
 * its front is this far into the room, so the piece stands off the wall by its body
 * rather than by a bracket (the hung body is the thinner `BOARD_T`). The same frameless
 * steel box the hung board is, bolted flat: a housing, a black lightbox and the lit
 * plate a few centimetres proud of it, exactly as a 广告牌 mounts its poster.
 */
const WALL_BODY_DEPTH = 0.16

/** How far the lit plate stands off the **lightbox**'s face, metres (so its own face is
 * `blackT` + this off the steel). */
const FACE_STAND_OFF = 0.025

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
 *    room it faces. It hangs on nothing and so carries no rods: the body's own back
 *    is the wall. Its wall is the placement rotation's, exactly as a 广告牌's is, so
 *    `autofaceWallMount` can turn it and the rule that asks for backing and the model
 *    that draws the panel agree about which way it faces.
 *
 * Either way the panel is **cut to the content the mount carries**
 * (`mountedSignBoards` → `signBoardsPanel`): a wide board is a wide piece of steel, and
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
 * A face with nothing on it is **not** mounted at all, and the model's own black
 * lightbox shows through: that is what the back of a freshly placed sign is, and
 * what a genuinely one-way sign is from behind.
 */
function buildSign(ctx: ModuleContext, mod: Extract<Module, { type: 'sign' }>): THREE.Group {
  const g = new THREE.Group()
  // A sign with neither face composed — a save written before a board was a
  // document, or one that lost its own — prints the station's default board on the
  // **front** rather than a blank face, which is the board `toState` backfills it
  // with. The front is the one face that is never allowed to be empty: a sign with
  // nothing on either side is a black rectangle in the station with nothing
  // anywhere to say why.
  const spec = signMountSpec(mod.cfg.mount)
  // The boards the **mount** actually mounts: a wall board is 正面 alone, so a stray back
  // in the document can neither widen its steel nor shift its plate (`mountedSignBoards`).
  const boards = mountedSignBoards(mod.cfg.mount, signBoardsOf(mod.cfg, ctx.data))
  const panel = signBoardsPanel(boards)
  if (spec.hung) mountHangingSign(ctx, mod, boards, panel, spec.panelZ, g)
  else mountWallSign(ctx, mod, boards, panel, spec.panelZ, g)
  return g
}

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
  const ceiling = 3.0 // the storey ceiling underside
  const rodX = Math.max(0.22, W / 2 - 0.35)
  for (const x of [-rodX, rodX]) {
    slab(g, ctx.mats.steel, x, 0, (zc + H / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + H / 2) - 0.04)
    slab(g, ctx.mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
  }
  // Panel body: a dark steel frame around a black lightbox.
  slab(g, ctx.mats.darkSteel, 0, 0, zc, W, BOARD_T, H)
  slab(g, ctx.mats.black, 0, 0, zc, W - 0.03, BOARD_T + 0.012, H - 0.03)
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
 * The **wall** board: the same panel bolted flat to the local −y wall at eye height,
 * with 正面 on the one face a passenger can read.
 *
 * The body's back face sits **on** the wall's plane (local y = −0.5 is the cell's own
 * edge, which is where a wall block's face is), so the panel is flush with the wall
 * it is bolted to rather than floating in front of it, and the room in front of it is
 * the room's — which is what `flatEnvelope`'s thin slab on a wall reserves.
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
  // The body: a dark steel box whose back face is the wall's own plane. It carries no
  // rods — there is nothing overhead to hang from — and the black lightbox is laid
  // **over its front**, a hair thicker, so the front stands proud of the steel (the two
  // back faces coincide on the wall plane by design: that plane *is* the wall, and the
  // steel is what it shows from inside the room).
  const blackT = WALL_BODY_DEPTH + 0.012
  slab(g, ctx.mats.darkSteel, 0, -0.5 + WALL_BODY_DEPTH / 2, zc, W, WALL_BODY_DEPTH, H)
  slab(g, ctx.mats.black, 0, -0.5 + blackT / 2, zc, W - 0.03, blackT, H - 0.03)
  // 正面, facing into the room. A wall sign has no second face: the wall is behind it.
  if (!signFaceHasInk(boards.front, 'left')) return
  const mat = ctx.signFace ? ctx.signFace(mod.id, boards.front, 'left', panel) : ctx.mats.signFace
  const mesh = plate(g, mat, W - 0.06, H - 0.06, 0, -0.5 + blackT + FACE_STAND_OFF, zc, Math.PI)
  mesh.renderOrder = 1
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
