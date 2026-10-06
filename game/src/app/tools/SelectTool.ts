// The 选择 tool: click to inspect, right-click to bulldoze. Moved verbatim from
// app/Viewport.tsx (GAME-SPEC §9.5). Hover is just the cursor — the inspector's
// selection box is drawn by the viewport effect, not by this tool.

import { cellKey } from '../../build/model.ts'
import { railModuleAt } from '../../build/rail.ts'
import { isCeilingHung, isWallMounted, moduleAt } from '../../sim/placement.ts'
import { moduleLabel, useStore } from '../store.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class SelectTool extends ToolController {
  readonly tool = 'select' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    if (!scene) return
    const hit = info.hit
    if (!hit) return
    const st = useStore.getState()
    // Right-click bulldozes the equipment under the pointer.
    if (info.button === 2) {
      const pickedId = this.pickModuleAt(info)
      const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
      if (picked) this.removePlacedModule(picked)
      else this.bulldoze(hit.cell, hit.place, this.facing())
      return
    }
    // A rail's bed is dug, so the ray lands on the block below or the work
    // plane; look for the track module at both the hit and the cell above.
    const rail =
      railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
      railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
    // The drawn mesh wins: a large exit is drawn far past its collision box,
    // so the visible model is what a click should select.
    const pickedId = this.pickModuleAt(info)
    const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
    const mod = picked ?? rail ?? (hit.solid ? moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined)
    const label = mod ? moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined) : ''
    st.select(mod ? { kind: 'module', key: mod.id, label } : { kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
    scene.setGhost([], 'add')
    // A hover ghost on a wall/ceiling piece must not outlive the click: the blue
    // selection box (`setSelection`) is the highlight from here on.
    scene.setModulePreview(null)
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    // A wall panel or a hung fitting lives on its surface, not on the floor
    // below it: hovering the drawn model highlights the piece itself (the same
    // translucent ghost the build tool shows) and no floor cell is ringed.
    const pickedId = this.pickModuleAt(info)
    if (pickedId) {
      const picked = useStore.getState().station.modules.find((m) => m.id === pickedId)
      if (picked && (isWallMounted(picked) || isCeilingHung(picked))) {
        scene.setCursor(null)
        scene.setModulePreview(picked, false)
        return
      }
    }
    scene.setModulePreview(null)
    const c = hit.solid ? hit.place : hit.cell
    scene.setCursor(c, true)
  }

  // Selection commits on press; the release owns nothing.
  onUp(_info: PointerInfo): void {}
}
