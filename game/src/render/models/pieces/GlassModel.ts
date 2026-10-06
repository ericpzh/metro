// Glass panel (玻璃板) builder. One piece file per piece, like every other model
// here: see PieceBuilder.ts for the shared kit.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { GLASS_FRAME, glassSpec } from '../../../sim/glassPanels.ts'
import { normRot, rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/** How far the whole assembly stands off the wall's face, metres (`−y` is the wall). */
const WALL_OFFSET = 0.44

/**
 * Glass panel (玻璃板): a sheet of glass in an **outer frame only**, bolted flat to
 * the wall on the module's local −y face, so the 装饰 rotation picks which wall it
 * hangs on. It is cladding, so it runs from the floor top up to `cfg.variant`'s
 * height (`sim/glassPanels.ts`) — a 1 m band along a wall, or a 2 m window.
 *
 * The frame is the whole difference from a 围栏, which stands a post and a pair of
 * rails up *per cell*: here one sill, one head and two end posts wrap the entire
 * run and a **single pane** spans between them, so a three-cell panel is one
 * window rather than three butted together. Nothing is drawn at a cell seam — only
 * the run's own two ends.
 *
 * The group is placed at the run's centre and turned with the placement rotation,
 * exactly as the 广告牌's is, so the panel hangs on the local −y wall whatever its
 * length.
 */
function buildGlass(ctx: ModuleContext, mod: Extract<Module, { type: 'glass' }>): THREE.Group {
  const spec = glassSpec(mod.cfg?.variant)
  const g = new THREE.Group()
  const run = mod.w > 0 ? mod.w : spec.w
  const [dx, dy] = rotateLocal(mod.rot, (run - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2

  const w = run
  const h = spec.h
  const y = -WALL_OFFSET
  const { depth, rail, post, pane } = GLASS_FRAME

  // The outer frame: a sill on the floor, a head at the top, and one post at each
  // end of the run. Nothing between them — five meshes for a panel of any size,
  // which is the whole difference from a 围栏 run of the same length.
  slab(g, ctx.mats.darkSteel, 0, y, rail / 2, w, depth, rail)
  slab(g, ctx.mats.darkSteel, 0, y, h - rail / 2, w, depth, rail)
  slab(g, ctx.mats.steel, -(w / 2 - post / 2), y, h / 2, post, depth, h)
  slab(g, ctx.mats.steel, w / 2 - post / 2, y, h / 2, post, depth, h)
  // One pane across the whole run, proud of the frame's centre line by a hair so it
  // catches the light rather than reading as the frame's own shadow.
  const glass = slab(g, ctx.mats.glass, 0, y + pane, h / 2, Math.max(0.05, w - post * 2), pane, Math.max(0.05, h - rail * 2))
  glass.userData.glassPane = true
  return g
}

export class GlassModel extends PieceBuilder {
  readonly kind = 'glass'
  build(mod: Extract<Module, { type: 'glass' }>): THREE.Group {
    return buildGlass(this.ctx, mod)
  }
}
