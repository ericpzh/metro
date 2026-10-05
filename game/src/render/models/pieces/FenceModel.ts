// Fence (围栏) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, drawFence } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { fenceArms, railLandingAt } from '../../../sim/fences.ts'
import { gateSolidFaces } from '../../../sim/gates.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * Fence (围栏, §5.2): a 1 m high, very thin metal frame around a glass panel,
 * standing through the middle of its block. One panel per cell; a dragged run
 * lays one per cell along the drag, and the rotation (R for a single, the drag
 * direction for a run) picks the main axis of a lone panel.
 *
 * Every panel is built from its neighbours, not from a fixed main axis, so all
 * joints are clean at 90°: a cell draws a half panel from its centre post to
 * each edge a fence or gate neighbour touches, and nothing toward an open edge.
 * A dead end (degree 1) or an isolated panel (degree 0, using `rot`) caps itself
 * to the far edge with an end post; a cell at an L, T or + junction has no cap,
 * so nothing overhangs past the turn. Because the geometry is derived from the
 * neighbours, dragging a new segment against an existing end regenerates that
 * end's block the moment it is committed — the old end post and overhang go.
 */
function buildFence(ctx: ModuleContext, mod: Extract<Module, { type: 'fence' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // A fence connects to another fence, to a gate's **machine** side, and to a
  // stair/escalator landing — the run's handrail reaches that cell, so the fence
  // drops its end cap and butts up to the railing instead of stopping short.
  // A gate is a machine body beside a lane, and only the machine is something a
  // run may butt into: a fence on the lane side ends at the doorway with its own
  // end post, so the opening is left open (`gateSolidFaces`). A **doorless** gate
  // is solid all round, its own half of the block being fence.
  const joined = (x: number, y: number): boolean =>
    ctx.data.modules.some((m) => {
      if (m.z !== mod.z) return false
      if (m.type === 'fence') return m.x === x && m.y === y
      // `gateSolidFaces` reads the offset from the gate back to this fence cell.
      return m.type === 'gate' && m.x === x && m.y === y && gateSolidFaces(m, mod.x - x, mod.y - y)
    }) || railLandingAt(ctx.data.modules, x, y, mod.z)
  const e = joined(mod.x + 1, mod.y)
  const w = joined(mod.x - 1, mod.y)
  const n = joined(mod.x, mod.y + 1)
  const s = joined(mod.x, mod.y - 1)
  drawFence(g, mats, fenceArms(mod.rot, { e, w, n, s }))
  // The orientation is baked into the geometry (neighbour arms + caps), so the
  // group is positioned but never rotated — a 180° turn is the same panel.
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z + 1)
  return g
}

export class FenceModel extends PieceBuilder {
  readonly kind = 'fence'
  build(mod: Extract<Module, { type: 'fence' }>): THREE.Group {
    return buildFence(this.ctx, mod)
  }
}

