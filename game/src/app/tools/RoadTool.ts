import { msg } from '../../sim/i18n.ts'
import { roadFromDrag, roadLayout } from '../../sim/roads.ts'
import { equipmentReason, equipmentRefusalNotice } from '../../sim/placement.ts'
import { addEquipment, nextModuleId, removeModule } from '../../build/model.ts'
import { useStore } from '../store.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/** A surface rectangle like the material brush, committed once on release (§9.5). */
export class RoadTool extends ToolController {
  readonly tool = 'module' as const
  onDown(info: PointerInfo): void {
    if (!info.hit) return
    info.preventDefault()
    const s = useStore.getState()
    const picked = this.pickModuleAt(info)
    const road = s.station.modules.find(m => m.id === picked && m.type === 'road')
    const anchor: [number, number, number] = [info.hit.cell[0], info.hit.cell[1], road?.z ?? info.hit.cell[2]]
    this.ctx.drag.current = { active: true, road: true, button: info.button, mode: info.button === 2 ? 'remove' : 'add',
      anchor, z: anchor[2], shift: false, sx: info.clientX, sy: info.clientY, downTime: performance.now() }
    this.onMove(info)
  }
  onMove(info: PointerInfo): void {
    if (!info.hit) return
    this.ctx.hover.current = { cell: info.hit.cell, place: info.hit.place, solid: info.hit.solid }
    const d = this.ctx.drag.current
    if (d?.road) {
      d.lx = info.clientX; d.ly = info.clientY
    }
    this.draw(info.hit.cell)
  }
  override refreshHover(): void { if (useStore.getState().tool === 'module' && useStore.getState().moduleType === 'road' && this.ctx.hover.current) this.draw(this.ctx.hover.current.cell) }
  private draw(target: [number, number, number]): void {
    const s = useStore.getState(), d = this.ctx.drag.current, scene = this.ctx.scene()
    const r = roadFromDrag(d?.road ? d.anchor : target, target, s.moduleRot, s.roadDirection, 'road-preview')
    if (d?.road) this.ctx.showMeasure(d.lx ?? d.sx, d.ly ?? d.sy, msg('road_measure', r.w, r.d, roadLayout(r).lanes))
    scene?.setGhost([], 'add')
    scene?.setCursor(null)
    scene?.setModulePreview([r], d?.mode === 'remove' || !!equipmentReason(s.station.cells, s.station.modules, r))
  }
  onUp(info: PointerInfo): void {
    const d = this.ctx.drag.current
    if (!d?.road) return
    const s = useStore.getState()
    const r = roadFromDrag(d.anchor, info.hit?.cell ?? this.ctx.hover.current?.cell ?? d.anchor, s.moduleRot, s.roadDirection, nextModuleId(s.station.modules, 'road'))
    this.ctx.drag.current = null
    this.ctx.clearMeasure()
    this.ctx.scene()?.setModulePreview(null)
    if (d.mode === 'remove') {
      let next = s.station
      for (const m of s.station.modules) if (m.type === 'road' && m.z === r.z && m.x < r.x + r.w && m.x + m.w > r.x && m.y < r.y + r.d && m.y + m.d > r.y) next = removeModule(next, m.id)
      if (next !== s.station) s.commit(next)
      else s.setNotice(msg('no_road_to_remove'))
      return
    }
    const why = equipmentReason(s.station.cells, s.station.modules, r)
    if (why) s.setNotice(equipmentRefusalNotice(why))
    else s.commit(addEquipment(s.station, r))
  }
}
