// Roof bays and small stair blocks share the block tool's rectangular gesture
// and equipment's placement verdict.
import { addEquipment, createModule, nextModuleId, removeModule } from '../../build/model.ts'
import { checkModulePlacements } from '../../build/validation.ts'
import { equipmentRefusalNotice } from '../../sim/placement.ts'
import { trackCells } from '../../sim/track.ts'
import type { Module } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { rectCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

function pieceAt(modules: readonly Module[], x: number, y: number, z: number): Module | undefined {
  const stair = useStore.getState().moduleType === 'stair-block'
  return modules.find((m) => m.z === z && (stair
    ? m.type === 'stair' && m.cfg.block && m.x === x && m.y === y
    : m.type === 'roof' && trackCells(m).some(([cx, cy]) => cx === x && cy === y)))
}

function bayStep(type: string, rot: number, width: number): [number, number] {
  const mod = createModule(type, 0, 0, 0, 'roof-step', rot, width)
  if (mod?.type !== 'roof') return [1, 1]
  return rot % 2 === 0 ? [mod.w, mod.d] : [mod.d, mod.w]
}

export class TileEquipmentTool extends ToolController {
  readonly tool = 'module' as const

  onDown(info: PointerInfo): void {
    const hit = info.hit
    if (!hit || !this.ctx.scene()) return
    info.preventDefault()
    const picked = useStore.getState().station.modules.find((m) => m.id === this.pickModuleAt(info))
    const anchor: [number, number, number] = picked && (picked.type === 'roof' || (picked.type === 'stair' && picked.cfg.block)) ? [picked.x, picked.y, picked.z] : hit.cell
    this.ctx.drag.current = { active: true, roof: true, button: info.button, mode: info.button === 2 ? 'remove' : 'add', anchor, z: anchor[2], shift: false, sx: info.clientX, sy: info.clientY, downTime: performance.now() }
    this.draw([anchor])
  }

  onMove(info: PointerInfo): void {
    const hit = info.hit
    if (!hit) return
    const drag = this.ctx.drag.current
    if (drag?.roof) {
      const cells = this.cells(info)
      this.draw(cells)
      const xs = cells.map(([x]) => x)
      const ys = cells.map(([, y]) => y)
      const st = useStore.getState()
      const [stepX, stepY] = bayStep(st.moduleType, st.moduleRot, st.roofWidth)
      this.ctx.showMeasure(info.clientX, info.clientY, `${Math.max(...xs) - Math.min(...xs) + stepX} × ${Math.max(...ys) - Math.min(...ys) + stepY} m`)
      return
    }
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid }
    this.draw([hit.cell])
  }

  override refreshHover(): void {
    const drag = this.ctx.drag.current
    if (drag?.roof) this.draw(drag.tileCells ?? [drag.anchor])
    else if (this.ctx.hover.current) this.draw([this.ctx.hover.current.cell])
  }

  private cells(info: PointerInfo): Array<[number, number, number]> {
    const drag = this.ctx.drag.current!
    const rect = performance.now() - drag.downTime >= LONG_PRESS_MS && isMoved(drag, info)
    if (!rect) return [drag.anchor]
    const all = rectCells(drag.anchor, info.hit?.cell ?? drag.anchor, drag.z, false)
    const st = useStore.getState()
    const [stepX, stepY] = bayStep(st.moduleType, st.moduleRot, st.roofWidth)
    // One anchor per whole bay, even after R swaps its world-space axes.
    return all.filter(([x, y]) => Math.abs(x - drag.anchor[0]) % stepX === 0 && Math.abs(y - drag.anchor[1]) % stepY === 0)
  }

  private draw(cells: Array<[number, number, number]>): void {
    if (this.ctx.drag.current?.roof) this.ctx.drag.current.tileCells = cells
    const scene = this.ctx.scene()
    if (!scene) return
    const st = useStore.getState()
    const removing = this.ctx.drag.current?.mode === 'remove'
    const mods: Module[] = []
    for (const [x, y, z] of cells) {
      const roof = pieceAt(st.station.modules, x, y, z)
      if (removing) { if (roof) mods.push(roof); continue }
      if (roof?.x === x && roof.y === y) continue
      const mod = createModule(st.moduleType, x, y, z, `roof-preview-${x}-${y}`, st.moduleRot, st.moduleType === 'stair-block' ? st.stairBlockHeight : st.roofWidth)
      if (mod) mods.push(mod)
    }
    const check = checkModulePlacements(st.station, mods.map((module) => ({ id: module.id, module, layer: true })))
    scene.setGhost([], 'add')
    scene.setModulePreview(mods.length ? mods : null, removing || check.refused.size > 0)
    scene.setCollisionHighlight(removing ? null : check.colliderIds)
    scene.setCursor(null)
  }

  onUp(info: PointerInfo): void {
    const drag = this.ctx.drag.current
    if (!drag?.roof) return
    const cells = this.cells(info)
    this.ctx.drag.current = null
    this.ctx.clearMeasure()
    const scene = this.ctx.scene()
    scene?.setModulePreview(null)
    scene?.setCollisionHighlight(null)
    scene?.setCursor(null)
    const st = useStore.getState()
    let next = st.station
    let why = ''
    for (const [x, y, z] of cells) {
      const roof = pieceAt(next.modules, x, y, z)
      if (drag.mode === 'remove') { if (roof) next = removeModule(next, roof.id); continue }
      if (roof?.x === x && roof.y === y) continue
      const mod = createModule(st.moduleType, x, y, z, nextModuleId(next.modules, st.moduleType === 'stair-block' ? 'stair' : 'roof'), st.moduleRot, st.moduleType === 'stair-block' ? st.stairBlockHeight : st.roofWidth)
      if (!mod) continue
      const check = checkModulePlacements(next, [{ id: mod.id, module: mod, layer: true }])
      if (check.refused.size) {
        why ||= equipmentRefusalNotice(check.refused.values().next().value as Parameters<typeof equipmentRefusalNotice>[0])
        continue
      }
      next = addEquipment(next, mod)
    }
    if (next !== st.station) st.commit(next)
    if (why) st.setNotice(why)
  }
}
