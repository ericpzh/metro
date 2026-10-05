// The 隧道 tool: hang a fixed-length extension off the end of the hovered rail,
// along that rail's own axis. Moved verbatim from app/Viewport.tsx (GAME-SPEC
// §7). A tunnel never touches the platform track's own cells — the run starts
// where that rail stops.

import { freeTunnelEnd, makeTunnel, railModuleAt, trackBlockReason, trackColliders } from '../../build/rail.ts'
import { useStore } from '../store.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class TunnelTool extends ToolController {
  readonly tool = 'tunnel' as const

  onDown(info: PointerInfo): void {
    const hit = info.hit
    if (!hit) return
    const st = useStore.getState()
    // A tunnel can only be hung off an existing rail, continuing it from one
    // end. It never touches the platform track's own cells — the run starts
    // where that rail stops.
    const src =
      railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
      railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
    if (!src) return
    if (info.button === 2) {
      st.removeRail(src.id)
      st.select(null)
      return
    }
    info.preventDefault()
    st.layTunnel(src.id, hit.cell)
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    // The extension hangs off the rail under the pointer; no rail, no ghost.
    const src = railModuleAt(useStore.getState().station, hit.cell[0], hit.cell[1], hit.cell[2])
    if (!src) {
      this.ctx.hover.current = null
      scene.setCursor(null)
      scene.setModulePreview(null)
      scene.setCollisionHighlight(null)
      return
    }
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: true }
    this.refreshHover()
  }

  // A tunnel commits on press; the release owns nothing.
  onUp(_info: PointerInfo): void {}

  /**
   * The tunnel run the tunnel tool would add: a fixed-length extension off the
   * end of the hovered rail, along that rail's own axis. It is only valid on an
   * existing track bed and is refused where it would collide with another.
   */
  override refreshHover(): void {
    const scene = this.ctx.scene()
    const h = this.ctx.hover.current
    if (!scene || !h) return
    const st = useStore.getState()
    const src = railModuleAt(st.station, h.cell[0], h.cell[1], h.cell[2])
    if (!src) {
      scene.setCursor(null)
      scene.setModulePreview(null)
      scene.setCollisionHighlight(null)
      return
    }
    const mod = makeTunnel(src, freeTunnelEnd(st.station, src, h.cell), st.tunnelLength, 'preview')
    const blocked = trackBlockReason(st.station, mod) !== null
    const colliderIds = blocked ? trackColliders(st.station, mod).map((m) => m.id) : []
    scene.setCursor(h.cell, !blocked)
    scene.setModulePreview(mod, blocked)
    scene.setCollisionHighlight(blocked ? colliderIds : null)
  }
}
