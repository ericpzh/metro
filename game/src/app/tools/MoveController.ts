// The 移动 controller: its tile picks up equipment on the first click and drops
// it on the next. An already-carried piece owns the pointer from either this tool
// or the 信息 card flow (GAME-SPEC §9.5).

import { exitFloorAt } from '../../sim/exits.ts'
import { ceilingMountStandCell, isCeilingHung, isWallMounted, moveCandidate, placementColliders, wallMountStandCell } from '../../sim/placement.ts'
import type { Vec3i } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/**
 * The id a carried piece (移动) wears as a ghost. A translated piece must not mint
 * into the caches keyed by a *placed* module's id — a 指示牌's printed plate and a
 * 电视's station plate are looked up by id, and a preview owns only what it made
 * itself (`SceneRenderer.setModulePreview`).
 */
const MOVE_GHOST_ID = 'move-preview'

export class MoveController extends ToolController {
  readonly tool = 'move' as const

  onDown(info: PointerInfo): void {
    const st = useStore.getState()
    // In the 移动 tool, the first click picks up the equipment under the pointer;
    // a later click drops it. This is the select-then-move flow in one gesture.
    if (!st.moveDraft) {
      if (info.button !== 0) return
      const id = this.ctx.pickModule(info.clientX, info.clientY)
      if (!id) return
      info.preventDefault()
      st.liftModule(id)
      const hit = info.hit
      if (useStore.getState().moveDraft && hit) {
        this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
        this.refreshHover()
      }
      return
    }
    // A right press puts the piece back where it came from (the card's 取消).
    if (info.button === 2) {
      info.preventDefault()
      st.cancelMove()
      this.clearPreview()
      return
    }
    // A left press drops it at the pointer — aimed from the press itself, so a
    // touch that never saw a pointer move still lands where it was tapped.
    const hit = info.hit
    if (hit) {
      this.ctx.hover.current = {
        cell: hit.cell,
        place: hit.place,
        solid: hit.solid,
        point: [hit.point[0], hit.point[1]],
      }
      this.refreshHover()
    }
    info.preventDefault()
    st.confirmMove()
    if (!useStore.getState().moveDraft) this.clearPreview()
  }

  onMove(info: PointerInfo): void {
    // While a piece is in the air every move only aims it. Nothing else
    // the pointer could do — selecting, building, painting — happens until it is
    // dropped or put back.
    const hit = info.hit
    if (!hit) return
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
    this.refreshHover()
  }

  // The drop commits on press; the release owns nothing.
  onUp(_info: PointerInfo): void {}

  /**
   * The cell a carried piece is aimed at: the floor block under the pointer, or —
   * for a wall panel, the cell in front of that wall (`wallMountStandCell`), and
   * for a hung fitting, the floor under the ceiling slab (`ceilingMountStandCell`)
   * — exactly as a fresh placement resolves the same hover.
   */
  private moveAnchorAt(h: { cell: [number, number, number]; place: [number, number, number]; solid: boolean }): Vec3i {
    const st = useStore.getState()
    const d = st.moveDraft
    if (d && isWallMounted(d.module)) {
      const [x, y, z] = wallMountStandCell(st.station.cells, h.cell, h.place)
      return { x, y, z }
    }
    if (d && isCeilingHung(d.module)) {
      const [x, y, z] = ceilingMountStandCell(h.cell, h.place)
      return { x, y, z }
    }
    const [x, y, z] = h.solid || exitFloorAt(st.station.modules, h.cell[0], h.cell[1], h.cell[2]) ? h.cell : h.place
    return { x, y, z }
  }

  /** Drop the lift's ghost, cursor and highlight. The piece itself is untouched. */
  clearPreview(): void {
    this.ctx.scene()?.setModulePreview(null)
    this.ctx.scene()?.setCollisionHighlight(null)
    this.ctx.scene()?.setCursor(null)
  }

  /**
   * Rebuild a carried piece's ghost where it is aimed. The piece is *not* in the
   * drawn station while it is in the air (`moveDraft`), so this translucent copy —
   * the same one a fresh placement shows — is the whole read of "in the hand".
   *
   * With no hover (the pointer is off the canvas, or on the 信息 card reaching for
   * 确认) the piece stays parked where it was last aimed, so the card still has
   * something to drop. Everything the ghost shows is pushed back into the draft
   * (`aimMove`), including the exact module it would place, so the 确认 and the commit
   * cannot disagree with what is on screen.
   */
  override refreshHover(): void {
    const scene = this.ctx.scene()
    const st = useStore.getState()
    const d = st.moveDraft
    if (!scene || !d) return
    const h = this.ctx.hover.current
    const at = h ? this.moveAnchorAt(h) : d.at
    if (!at) {
      this.clearPreview()
      st.aimMove(null, null, '')
      return
    }
    // The piece is rebuilt from the **document's** copy every time, so a board
    // edited, or an undo taken, while it is in the air shows up under the pointer
    // instead of a lift-time snapshot — its `cfg` is the live one; only the cell
    // and the rotation are the player's aim.
    const current = st.station.modules.find((m) => m.id === d.module.id) ?? d.module
    const { module: candidate, reason } = moveCandidate(st.station.cells, st.station.modules, current, at, d.rot)
    // A ghost carries a private id: a 指示牌's printed plate and a 电视's station
    // plate are cached per module id, and a preview must never mint into the copy a
    // placed piece owns (`setModulePreview` disposes what its ghost created).
    // A wall panel or a hung fitting lives on its surface: the ghost is the
    // highlight, never a floor cell.
    scene.setCursor(isWallMounted(candidate) || isCeilingHung(candidate) ? null : [at.x, at.y, at.z], reason === '')
    scene.setModulePreview({ ...candidate, id: MOVE_GHOST_ID }, reason !== '')
    scene.setCollisionHighlight(reason === '' ? null : placementColliders(st.station.modules, candidate).map((m) => m.id))
    st.aimMove(at, candidate, reason)
  }
}
