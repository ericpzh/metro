import { addEquipment, createModule, fenceRotForLine, nextModuleId, removeModule } from '../../build/model.ts'
import { checkModulePlacements } from '../../build/validation.ts'
import { tactileAt } from '../../sim/floorDecor.ts'
import { equipmentReason, equipmentRefusalNotice } from '../../sim/placement.ts'
import type { Module } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/** Tactile tiles use the fence's straight-run gesture and one edit per release (§9.5). */
export class TactileTool extends ToolController {
  readonly tool = 'module' as const

  onDown(info: PointerInfo): void {
    if (!info.hit) return
    const st = useStore.getState()
    const removing = st.tool === 'delete' || info.button === 2
    const picked = st.station.modules.find((m) => m.id === this.pickModuleAt(info))
    const old = picked?.type === 'tactile' ? picked : tactileAt(st.station.modules, ...info.hit.cell)
    if (removing && old?.type !== 'tactile') return
    if (!removing && !info.hit.solid) return
    info.preventDefault()
    const anchor: [number, number, number] = removing && old ? [old.x, old.y, old.z] : info.hit.cell
    this.ctx.drag.current = {
      active: true, tactile: true, button: info.button, mode: removing ? 'remove' : 'add',
      anchor, z: anchor[2], shift: true, sx: info.clientX, sy: info.clientY, downTime: performance.now(),
      tileType: removing && old?.type === 'tactile' ? `tactile-${old.cfg.variant}` : st.moduleType,
    }
    this.draw([anchor])
  }

  onMove(info: PointerInfo): void {
    if (!info.hit) return
    if (this.ctx.drag.current?.tactile) this.draw(this.cells(info))
    else {
      this.ctx.hover.current = { cell: info.hit.cell, place: info.hit.place, solid: info.hit.solid }
      this.draw([info.hit.cell])
    }
  }

  override refreshHover(): void {
    const d = this.ctx.drag.current
    if (d?.tactile) this.draw(d.tileCells ?? [d.anchor])
    else if (this.ctx.hover.current) this.draw([this.ctx.hover.current.cell])
  }

  private cells(info: PointerInfo): Array<[number, number, number]> {
    const d = this.ctx.drag.current!
    return (d.mode === 'remove' || performance.now() - d.downTime >= LONG_PRESS_MS) && isMoved(d, info)
      ? straightLineCells(d.anchor, info.hit?.cell ?? d.anchor, d.z) : [d.anchor]
  }

  private candidates(cells: Array<[number, number, number]>): Module[] {
    const st = useStore.getState()
    const d = this.ctx.drag.current
    const type = d?.tileType ?? st.moduleType
    const variant = type === 'tactile-warning' ? 'warning' : 'guide'
    const rot = fenceRotForLine(cells) ?? st.moduleRot
    return cells.flatMap(([x, y, z]) => {
      if (d?.mode === 'remove') {
        const old = tactileAt(st.station.modules, x, y, z, variant)
        return old ? [old] : []
      }
      if (tactileAt(st.station.modules, x, y, z)) return []
      const m = createModule(type, x, y, z, `tactile-preview-${x}-${y}`, rot)
      return m ? [m] : []
    })
  }

  private draw(cells: Array<[number, number, number]>): void {
    if (this.ctx.drag.current?.tactile) this.ctx.drag.current.tileCells = cells
    const scene = this.ctx.scene()
    if (!scene) return
    const mods = this.candidates(cells)
    const removing = this.ctx.drag.current?.mode === 'remove'
    const check = checkModulePlacements(useStore.getState().station, mods.map((module) => ({ id: module.id, module })))
    scene.setGhost([], removing ? 'remove' : 'add')
    scene.setModulePreview(mods, removing || check.refused.size > 0)
    scene.setCollisionHighlight(removing ? null : check.colliderIds)
    scene.setCursor(null)
  }

  onUp(info: PointerInfo): void {
    const d = this.ctx.drag.current
    if (!d?.tactile) return
    const mods = this.candidates(this.cells(info))
    this.ctx.drag.current = null
    const scene = this.ctx.scene()
    scene?.setModulePreview(null)
    scene?.setCollisionHighlight(null)
    scene?.setCursor(null)
    const st = useStore.getState()
    let next = st.station
    let why = ''
    for (const mod of mods) {
      if (d.mode === 'remove') { next = removeModule(next, mod.id); continue }
      const check = checkModulePlacements(next, [{ id: mod.id, module: mod }])
      if (check.refused.size) {
        why ||= equipmentRefusalNotice(equipmentReason(next.cells, next.modules, mod))
        continue
      }
      next = addEquipment(next, { ...mod, id: nextModuleId(next.modules, 'tactile') })
    }
    if (next !== st.station) { st.commit(next); if (d.mode === 'remove') st.select(null) }
    if (why) st.setNotice(why)
  }
}
