// Glass panel (玻璃板) builder. One piece file per piece, like every other model
// here: see PieceBuilder.ts for the shared kit.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { GLASS_FRAME, glassSpec, glassStandsOnFloor } from '../../../sim/glassPanels.ts'
import { doorSpec } from '../../../sim/doors.ts'
import { curtainDoorShare, doorCells, glassCells } from '../../../sim/placement.ts'
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
  // Floor-standing panels follow the doorway's placement: their pane sits on the
  // anchor tile's leading edge, and R turns that edge around the tile. Wall panels
  // keep their backing-wall offset.
  const edgeIn = GLASS_FRAME.depth / 2 - 0.5
  const [dx, dy] = glassStandsOnFloor(spec)
    ? rotateLocal(mod.rot, (run - 1) / 2, edgeIn)
    : rotateLocal(mod.rot, (run - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2

  const w = run
  const h = spec.h
  const y = glassStandsOnFloor(spec) ? 0 : -WALL_OFFSET
  const { depth, rail, post, pane } = GLASS_FRAME

  // A 门 fitted into a curtain replaces the lower doorway-sized section of
  // that panel. Keep the upper glazing continuous, and retain lower glazing only
  // in the run cells the door does not occupy.
  const fittedDoors = glassStandsOnFloor(spec)
    ? ctx.data.modules.filter((other): other is Extract<Module, { type: 'door' }> => other.type === 'door' && curtainDoorShare(mod, other))
    : []
  if (fittedDoors.length > 0) {
    const covered = new Set<number>()
    const runCells = glassCells(mod)
    for (const door of fittedDoors) {
      for (const [x, y] of doorCells(door)) {
        const i = runCells.findIndex(([gx, gy]) => gx === x && gy === y)
        if (i >= 0) covered.add(i)
      }
    }
    const cut = Math.max(...fittedDoors.map((door) => doorSpec(door.cfg?.variant).h))
    const centerX = (i: number): number => i - (w - 1) / 2
    const paneH = Math.max(0.05, h - cut - rail * 2)
    slab(g, ctx.mats.darkSteel, 0, y, cut + rail / 2, w, depth, rail)
    slab(g, ctx.mats.darkSteel, 0, y, h - rail / 2, w, depth, rail)
    const upperPostH = Math.max(0, h - cut - rail * 2)
    slab(g, ctx.mats.steel, -(w / 2 - post / 2), y, cut + rail + upperPostH / 2, post, depth, upperPostH)
    slab(g, ctx.mats.steel, w / 2 - post / 2, y, cut + rail + upperPostH / 2, post, depth, upperPostH)
    const upper = slab(g, ctx.mats.glass, 0, y + pane, cut + rail + paneH / 2, Math.max(0.05, w - post * 2), pane, paneH)
    upper.userData.glassPane = true

    // Draw lower panel sections one uninterrupted span at a time. Door jambs
    // replace the inner end posts wherever the door occupies a cell.
    let i = 0
    while (i < w) {
      if (covered.has(i)) { i++; continue }
      const first = i
      while (i + 1 < w && !covered.has(i + 1)) i++
      const last = i
      const sectionW = last - first + 1
      const cx = (centerX(first) + centerX(last)) / 2
      slab(g, ctx.mats.darkSteel, cx, y, rail / 2, sectionW, depth, rail)
      slab(g, ctx.mats.darkSteel, cx, y, cut - rail / 2, sectionW, depth, rail)
      const lowerPaneH = Math.max(0.05, cut - rail * 2)
      const lower = slab(g, ctx.mats.glass, cx, y + pane, cut / 2, sectionW - (first === 0 ? post / 2 : 0) - (last === w - 1 ? post / 2 : 0), pane, lowerPaneH)
      lower.userData.glassPane = true
      if (first === 0) slab(g, ctx.mats.steel, -w / 2 + post / 2, y, cut / 2, post, depth, cut - rail * 2)
      if (last === w - 1) slab(g, ctx.mats.steel, w / 2 - post / 2, y, cut / 2, post, depth, cut - rail * 2)
      i++
    }
    return g
  }

  // The outer frame: a sill on the floor, a head at the top, and one post at each
  // end of the run. Nothing between them — five meshes for a panel of any size,
  // which is the whole difference from a 围栏 run of the same length.
  slab(g, ctx.mats.darkSteel, 0, y, rail / 2, w, depth, rail)
  slab(g, ctx.mats.darkSteel, 0, y, h - rail / 2, w, depth, rail)
  const postH = Math.max(0, h - rail * 2)
  slab(g, ctx.mats.steel, -(w / 2 - post / 2), y, h / 2, post, depth, postH)
  slab(g, ctx.mats.steel, w / 2 - post / 2, y, h / 2, post, depth, postH)
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
