// Line system map (线网图) builder. One piece file per piece; see PieceBuilder.ts
// for the shared kit.

import * as THREE from 'three'
import { PieceBuilder, plate, plateOf, slab } from '../PieceBuilder.ts'
import type { ModuleContext, PrintedFace } from '../PieceBuilder.ts'
import { lineMapSpec } from '../../../sim/linemaps.ts'
import { normRot, rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * How far the whole board stands off the wall's face, metres (`−y` is the wall).
 * The board is a framed panel like a 广告牌's housing, so it sits a hand's width
 * proud — its back face flush with the wall — and its lit face another few
 * centimetres out again.
 */
const BOARD_OFFSET = 0.42

/** The board's frame, metres: the backing's depth and the plate's stand-off. */
const FRAME_DEPTH = 0.16
const FACE_STAND_OFF = 0.025

/**
 * Line system map (线网图, 装饰): the supplied 线网示意图 on a board, or on a totem.
 *
 * The poster is **artwork**, not a drawing: `render/lineMapArt.ts` decodes
 * `src/assets/linemaps/network-map.jpg` and hands the model a quad whose UVs hold the
 * crop window that fits it to the panel (a real image is cropped, never stretched),
 * and until those pixels land `render/lineMapFace.ts`'s drawn placeholder board stands
 * in. A face with a geometry of its own is mounted through `plateOf` — the same way a
 * 广告牌 mounts its poster — and a drawn plate through `plate` at the panel's size.
 *
 * The two variants are two pieces of furniture (`sim/linemaps.ts`), both two cells wide
 * and the same board:
 *
 *   * **wall** (墙面线网图) is a framed board bolted flat to the local −y wall, read
 *     from one side: a housing, a steel edge frame and one lit face.
 *   * **stand** (立式线网图) is a free-standing totem: a plinth, a post and the same
 *     board with a **lit face on each side**, so a passenger reads it from either
 *     direction down the concourse. The two faces are two planes each turned to its own
 *     side (`plate`) — never one double-sided plane, which would print the map mirrored
 *     on the back — so both read the right way round from their own side, off the one
 *     texture.
 */
function buildLineMap(ctx: ModuleContext, mod: Extract<Module, { type: 'linemap' }>): THREE.Group {
  const spec = lineMapSpec(mod.cfg?.mount)
  const g = new THREE.Group()
  const panel = { w: spec.panelW, h: spec.panelH }
  const face: PrintedFace = ctx.lineMapFace?.(mod.id, panel) ?? { material: ctx.mats.lineMapPlaceholder }

  /** Mount one lit board on a face that already carries its own crop window. */
  const board = (x: number, y: number, z: number, yaw: number): THREE.Mesh => {
    const mesh = face.geometry
      ? plateOf(g, face.geometry, face.material, x, y, z, yaw)
      : plate(g, face.material, panel.w, panel.h, x, y, z, yaw)
    mesh.renderOrder = 1
    return mesh
  }

  if (spec.mount === 'stand') {
    // The totem is a two-cell run like the wall board, so it is centred on its run and
    // turned with the placement rotation: a plinth and a post under the same board,
    // printed on both sides.
    const [dx, dy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
    g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
    g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
    const zc = spec.panelZ
    const base = zc - spec.panelH / 2
    // Plinth and post, standing on the floor in the middle of the run: the board is
    // carried, not propped, so the whole piece fits the cell column it reserves.
    slab(g, ctx.mats.darkSteel, 0, 0, 0.035, 0.62, 0.62, 0.07)
    slab(g, ctx.mats.steel, 0, 0, base / 2 + 0.035, 0.12, 0.12, Math.max(0.1, base - 0.035))
    // The board's own body, two panels thick, with a face proud of each side.
    slab(g, ctx.mats.darkSteel, 0, 0, zc, panel.w + 0.06, 0.11, panel.h + 0.06)
    board(0, -0.06 - FACE_STAND_OFF, zc, 0).userData.lineMapFace = 'front'
    board(0, 0.06 + FACE_STAND_OFF, zc, Math.PI).userData.lineMapFace = 'back'
    return g
  }

  // The wall board: centred on its run like a billboard, hung at `panelZ`.
  const run = mod.w > 0 ? mod.w : spec.w
  const [dx, dy] = rotateLocal(mod.rot, (run - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  const pz = spec.panelZ
  // Housing flat against the wall, with a steel edge frame around it — the same
  // construction a 广告牌 uses, in the map's own format.
  slab(g, ctx.mats.darkSteel, 0, -BOARD_OFFSET, pz, panel.w + 0.08, FRAME_DEPTH, panel.h + 0.1)
  slab(g, ctx.mats.steel, 0, -BOARD_OFFSET + FRAME_DEPTH / 2, pz, panel.w + 0.12, 0.04, panel.h + 0.14)
  board(0, -BOARD_OFFSET + FRAME_DEPTH / 2 + FACE_STAND_OFF, pz, Math.PI).userData.lineMapFace = 'front'
  return g
}

export class LineMapModel extends PieceBuilder {
  readonly kind = 'linemap'
  build(mod: Extract<Module, { type: 'linemap' }>): THREE.Group {
    return buildLineMap(this.ctx, mod)
  }
}
