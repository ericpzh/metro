// The 站台 rail tool: click drops the whole pre-sized track module for the bound
// line (R turns it), right-click removes one. Moved verbatim from
// app/Viewport.tsx (GAME-SPEC §7: 站台/隧道 rail tools).

import { defaultLine, makeTrack, railModuleAt, trackBlockReason, trackColliders, trackPieceForLine } from '../../build/rail.ts'
import { trackOriginForCentre } from '../../sim/track.ts'
import type { Module } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class PlatformTool extends ToolController {
  readonly tool = 'rail' as const

  onDown(info: PointerInfo): void {
    const hit = info.hit
    if (!hit) return
    const st = useStore.getState()
    // Right-click bulldozes a rail under the pointer.
    if (info.button === 2) {
      const rail =
        railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
        railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
      if (rail) {
        st.removeRail(rail.id)
        st.select(null)
      }
      return
    }
    // A track piece sits on floor like equipment: a click drops the whole
    // pre-sized module (R turns it), a right-click removes one.
    if (!hit.solid) return
    info.preventDefault()
    st.layTrack(hit.cell)
  }

  onMove(info: PointerInfo): void {
    const hit = info.hit
    if (!hit) return
    // The pre-rendered piece follows the pointer exactly as equipment does.
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid }
    this.refreshHover()
  }

  // A rail commits on press; the release owns nothing.
  onUp(_info: PointerInfo): void {}

  /**
   * The fixed track piece the rail tool would drop at the hovered cell. It is
   * sized from the bound line's consist (or a default line on a fresh station),
   * so the ghost is the exact module the click would place — rotation and all.
   */
  private railPiece(): Module | null {
    const st = useStore.getState()
    const h = this.ctx.hover.current
    if (!h) return null
    const line = st.station.lines.find((l) => l.id === st.railLineId) ?? st.station.lines[0] ?? defaultLine(st.railLineId || '1', st.railDir, 'third-rail')
    const { w, d } = trackPieceForLine(line)
    // Centre the long run on the highlighted tile, so it grows evenly both ways.
    const [ox, oy] = trackOriginForCentre(st.railRot, h.cell[0], h.cell[1], w, d)
    return makeTrack({ id: 'preview', lineId: line.id, dir: st.railDir, power: line.power, rot: st.railRot, x: ox, y: oy, z: h.cell[2], w, d })
  }

  /** Rebuild the rail hover ghost from the last hovered tile. */
  override refreshHover(): void {
    const scene = this.ctx.scene()
    const h = this.ctx.hover.current
    if (!scene || !h) return
    const st = useStore.getState()
    // A piece only ever stands on floor, so a non-floor centre cell shows no
    // ghost at all (and no blue highlight) — the equipment tool's rule.
    const mod = h.solid ? this.railPiece() : null
    const blocked = !!mod && (mod.type !== 'track' || trackBlockReason(st.station, mod) !== null)
    const colliderIds = mod && mod.type === 'track' && blocked ? trackColliders(st.station, mod).map((m) => m.id) : []
    scene.setCursor(h.cell, h.solid && !blocked)
    scene.setModulePreview(mod, blocked)
    scene.setCollisionHighlight(blocked ? colliderIds : null)
  }
}
