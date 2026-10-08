// The 材质 (paint) tool: press a face, drag a rectangle on its plane; a stair's
// walking surface paints as one piece. The brush's own `pick` overlay lifts a
// finish back into it; the 工具 folder's 吸取 (`P`) is the eyedropper players
// reach for — it lifts equipment as well as finishes. Moved verbatim from
// app/Viewport.tsx (GAME-SPEC §8: 材质 paint tools).

import { eraseFaces, faceFinish, fillSurface, paintFaces, paintRoofSurface, paintStairSurface } from '../../build/model.ts'
import { DEFAULT_ROOF_FINISH } from '../../sim/structures.ts'
import { finishDef } from '../../sim/finishes.ts'
import type { FinishId } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { dominantFace, faceTargets, planeCells } from './geometry/faces.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/** Preview colour: the brush's own tint, or a warning red when erasing. */
function paintColour(button: number, finish: FinishId): number {
  return button === 2 ? 0xff7a7a : finishDef(finish).tint
}

export class PaintTool extends ToolController {
  readonly tool = 'paint' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    if (!scene) return
    const st = useStore.getState()
    // A stair's walking surface is the **piece**, not the floor it stands on: the
    // pointer lands on treads, which no cell owns (and the flights run over a
    // carved well), so the brush resolves the stair before anything that needs the
    // cell the ray hit — its treads, risers and half-landing are one material.
    const pickedId = this.pickModuleAt(info)
    const stair = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
    if (stair?.type === 'roof') {
      info.preventDefault()
      if (st.paintMode === 'pick') {
        st.setPaintFinish(stair.cfg.finish ?? DEFAULT_ROOF_FINISH)
        st.resumePaintMode()
        return
      }
      const next = paintRoofSurface(st.station, stair.id, info.button === 2 ? null : st.paintFinish, st.paintMode === 'surface')
      if (next !== st.station) st.commit(next)
      return
    }
    if (stair && stair.type === 'stair') {
      if (st.paintMode === 'pick') {
        st.setPaintFinish(stair.cfg.finish ?? faceFinish(st.station.cells, stair.from.x, stair.from.y, stair.from.z, 'top'))
        // 取色 is momentary, exactly as it is over a floor cell.
        st.resumePaintMode()
        return
      }
      // One press is the whole gesture: a stair has one walking surface, so
      // nothing is held open for a drag. Right-click hands it back to the floor.
      info.preventDefault()
      const next = paintStairSurface(st.station, stair.id, info.button === 2 ? null : st.paintFinish)
      if (next !== st.station) st.commit(next)
      return
    }
    const hit = info.hit
    if (!hit) return
    if (!hit.solid) return
    const face = dominantFace(hit.normal)
    if (st.paintMode === 'pick') {
      st.setPaintFinish(faceFinish(st.station.cells, hit.cell[0], hit.cell[1], hit.cell[2], face))
      // 取色 is momentary: hand the brush back in the `N`/`M` mode it was entered
      // with, so eyedropping a whole-surface brush does not drop it to 单块.
      st.resumePaintMode()
      return
    }
    // Press holds the anchor face; release paints it, or the dragged rectangle.
    info.preventDefault()
    this.ctx.paint.current = {
      active: true,
      button: info.button,
      face,
      anchor: hit.cell,
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    scene.setFaceGhost(faceTargets([hit.cell], face, this.ctx.solids(), this.ctx.thins()), face, paintColour(info.button, st.paintFinish))
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene) return
    const st = useStore.getState()
    // Over a stair the brush finishes the **piece**, not the floor the ray found
    // under its treads: the stair itself is ghosted as the target, and no cell
    // face is previewed (that would point at the wrong thing).
    const stairId = this.pickModuleAt(info)
    const stair = stairId ? st.station.modules.find((m) => m.id === stairId) : undefined
    if (stair && (stair.type === 'stair' || stair.type === 'roof')) {
      scene.clearFaceGhost()
      scene.setModulePreview(stair, false)
      scene.setCursor([stair.x, stair.y, stair.z], true)
      return
    }
    scene.setModulePreview(null)
    if (!hit) return
    const p = this.ctx.paint.current
    if (p?.active) {
      // The rectangle runs to the cell under the pointer, on the anchor plane.
      const cells = planeCells(p.anchor, hit.cell, p.face)
      scene.setFaceGhost(faceTargets(cells, p.face, this.ctx.solids(), this.ctx.thins()), p.face, paintColour(p.button, st.paintFinish))
    } else if (st.paintMode !== 'pick' && hit.solid) {
      const face = dominantFace(hit.normal)
      scene.setFaceGhost(faceTargets([hit.cell], face, this.ctx.solids(), this.ctx.thins()), face, paintColour(0, st.paintFinish))
    } else {
      scene.clearFaceGhost()
    }
    scene.setCursor(hit.cell, true)
  }

  onUp(info: PointerInfo): void {
    const p = this.ctx.paint.current
    this.ctx.paint.current = null
    if (p?.active) {
      this.ctx.scene()?.clearFaceGhost()
      const hit = info.hit
      const rect = performance.now() - p.downTime >= LONG_PRESS_MS && isMoved(p, info)
      const cells = rect ? planeCells(p.anchor, hit ? hit.cell : p.anchor, p.face) : [p.anchor]
      const targets = faceTargets(cells, p.face, this.ctx.solids(), this.ctx.thins())
      if (targets.length === 0) return
      const st = useStore.getState()
      const next =
        p.button === 2
          ? eraseFaces(st.station, targets, p.face)
          : !rect && st.paintMode === 'surface'
            ? fillSurface(st.station, p.anchor[0], p.anchor[1], p.anchor[2], p.face, st.paintFinish)
            : paintFaces(st.station, targets, p.face, st.paintFinish)
      if (next !== st.station) st.commit(next)
    }
  }
}
