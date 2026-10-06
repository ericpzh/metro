// The 删除 tool: button-agnostic teardown — tap a block, drag a line of blocks,
// press a module to remove the whole piece, or sweep same-type 设备/装饰 in one
// commit. Moved verbatim from app/Viewport.tsx (GAME-SPEC §9.5). The sweep rule
// itself lives in app/sweep.ts; this file only owns the pointer gesture.

import { removeFloor, removeModule } from '../../build/model.ts'
import { isCeilingHung, isWallMounted, moduleAt } from '../../sim/placement.ts'
import type { Module } from '../../sim/types.ts'
import { removeSweptModules, sweepFamily, sweepThrough } from '../sweep.ts'
import { moduleLabel, useStore } from '../store.ts'
import { pendingCells, rectCells, straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class DeleteTool extends ToolController {
  readonly tool = 'delete' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // The delete tool is button-agnostic: press a block and tap (one block) or
    // drag a line (a run of blocks). It reuses the `drag` ref in remove mode
    // with `shift` pinned, so the release takes the block tool's line path.
    // A drawn module under the pointer is the pending delete instead — the
    // whole piece goes, not the floor block beneath it — except a 围栏 panel,
    // which drags out a line of its own like the 围栏 tool (see below).
    const pickedId = this.pickModuleAt(info)
    const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
    if (picked) {
      info.preventDefault()
      // A fence panel is one cell of a run, so the delete tool drags it like
      // the 围栏 tool: press anchors, a drag draws a straight line, and the
      // release lifts every panel on it. Any other module is removed whole —
      // and an equipment (设备) or 装饰 piece starts a same-type sweep: hold
      // the button and drag across matching pieces, and each one the pointer
      // passes through is highlighted and joins the pending list (§9.5).
      const fence = picked.type === 'fence'
      const family = fence ? null : sweepFamily(picked)
      this.ctx.drag.current = {
        active: true,
        button: info.button,
        mode: 'remove',
        anchor: [picked.x, picked.y, picked.z],
        z: picked.z,
        shift: true,
        fence: fence || undefined,
        // A piece that may not be swept still rides the same list, so the
        // release has one path: a one-id sweep is the plain bulldoze.
        modules: fence ? undefined : [picked.id],
        family: family ?? undefined,
        lx: info.clientX,
        ly: info.clientY,
        sx: info.clientX,
        sy: info.clientY,
        downTime: performance.now(),
      }
      scene.setModulePreview(fence ? null : picked, true)
      scene.setCollisionHighlight(null)
      scene.setGhost(fence ? [[picked.x, picked.y, picked.z]] : [], 'remove')
      // A wall panel or a hung fitting is the pending delete itself: its own
      // red ghost is the highlight, never the floor cell beneath it.
      scene.setCursor(isWallMounted(picked) || isCeilingHung(picked) ? null : [picked.x, picked.y, picked.z], true)
      return
    }
    if (!hit.solid) return
    info.preventDefault()
    this.ctx.drag.current = {
      active: true,
      button: info.button,
      mode: 'remove',
      anchor: hit.cell,
      z: hit.cell[2],
      shift: true,
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    scene.setGhost(pendingCells([hit.cell], 'remove', this.ctx.solids()), 'remove')
    scene.setCollisionHighlight(null)
    scene.setCursor(hit.cell, true)
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    const d = this.ctx.drag.current
    if (d?.active) {
      if (d.fence) {
        // Drag a straight, axis-aligned line across the 围栏 run: highlight
        // exactly the panels the release will lift, one red cell each. A quick
        // tap stays one panel even if the pointer jitters.
        const target: [number, number, number] = [hit.cell[0], hit.cell[1], d.z]
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
        const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
        const seen = new Set<string>()
        const cells: Array<[number, number, number]> = []
        for (const [x, y, z] of line) {
          const mod = moduleAt(st.station.modules, x, y, z)
          if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
          seen.add(mod.id)
          cells.push([mod.x, mod.y, mod.z])
        }
        scene.setModulePreview(null)
        scene.setCollisionHighlight(null)
        scene.setGhost(cells, 'remove')
        scene.setCursor(dragging ? line[line.length - 1] : d.anchor, true)
        return
      }
      if (d.modules) {
        // A module delete: the pressed piece stays pending while the button
        // holds, and — for a piece that may be swept — every *matching* piece
        // the pointer passes over joins the list, so the highlight reads as
        // exactly "what this release will bulldoze". A sweep never shrinks: a
        // piece crossed once stays pending even if the pointer leaves it.
        const ids = d.modules
        if (d.family && isMoved(d, info)) {
          sweepThrough(
            ids,
            d.family,
            { x: d.lx ?? d.sx, y: d.ly ?? d.sy },
            { x: info.clientX, y: info.clientY },
            (x, y) => scene.pickModule(x, y),
            st.station.modules,
          )
        }
        d.lx = info.clientX
        d.ly = info.clientY
        const mods = ids
          .map((id) => st.station.modules.find((m) => m.id === id))
          .filter((m): m is Module => m !== undefined)
        scene.setGhost([], 'remove')
        scene.setCollisionHighlight(null)
        scene.setModulePreview(mods, true)
        return
      }
      // A deliberate press draws the line of blocks the release will remove;
      // a quick tap stays one block even if the pointer jitters.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const line = dragging ? rectCells(d.anchor, hit.cell, d.z, true) : [d.anchor]
      scene.setGhost(pendingCells(line, 'remove', this.ctx.solids()), 'remove')
      scene.setCursor(dragging ? hit.cell : d.anchor, true)
      return
    }
    // Hover: a drawn module under the pointer is the pending delete, shown as
    // a red ghost of the piece itself; otherwise the block under it. A wall
    // panel or a hung fitting never rings the floor beneath it.
    const pickedId = this.pickModuleAt(info)
    const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
    if (picked) {
      scene.setGhost([], 'remove')
      scene.setCollisionHighlight(null)
      scene.setModulePreview(picked, true)
      scene.setCursor(isWallMounted(picked) || isCeilingHung(picked) ? null : [picked.x, picked.y, picked.z], true)
    } else {
      scene.setModulePreview(null)
      scene.setCollisionHighlight(null)
      scene.setGhost(pendingCells([hit.cell], 'remove', this.ctx.solids()), 'remove')
      scene.setCursor(hit.cell, hit.solid)
    }
  }

  onUp(info: PointerInfo): void {
    // The viewport routes module/fence/plain-block drags here (never a 围栏
    // placement run — that release belongs to the equipment tool). Each branch
    // below is the delete side of the release the press promised.
    const d = this.ctx.drag.current
    this.ctx.drag.current = null
    const scene = this.ctx.scene()
    if (!scene || !d?.active) return
    scene.setGhost([], 'add')
    scene.setModulePreview(null)
    scene.setFencePreview(null)
    scene.setCollisionHighlight(null)
    const hit = info.hit
    const rect = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
    const target = hit ? hit.cell : d.anchor
    const st = useStore.getState()
    if (d.modules) {
      // A delete-tool press on a module removes that whole piece, wherever the
      // pointer was released. A sweep that crossed same-type pieces takes them
      // all in one commit, so a single undo puts the run back together.
      const swept = d.modules
        .map((id) => st.station.modules.find((m) => m.id === id))
        .filter((m): m is Module => m !== undefined)
      if (swept.length === 0) return
      if (swept.length === 1) {
        this.removePlacedModule(swept[0])
        return
      }
      st.commit(removeSweptModules(st.station, swept.map((m) => m.id)))
      st.select(null)
      const head = swept[0]
      const label = moduleLabel(head.type, head.type === 'shop' ? head.cfg.kind : undefined)
      st.setNotice(`已拆掉 ${swept.length} 件${label}`)
      return
    }
    if (d.fence) {
      // A 围栏 line drag lifts every panel on it, one cell of the run at a time.
      const line = rect ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
      const seen = new Set<string>()
      let next = st.station
      let removed = 0
      for (const [x, y, z] of line) {
        const mod = moduleAt(next.modules, x, y, z)
        if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
        seen.add(mod.id)
        next = removeModule(next, mod.id)
        removed++
      }
      if (removed > 0) {
        st.commit(next)
        st.select(null)
        st.setNotice(`已拆掉${removed}段围栏`)
      }
      return
    }
    // A deliberate press draws the line of blocks the release removes — always
    // a straight line (`shift` pinned at the press), never a rectangle.
    const cells = rect ? rectCells(d.anchor, target, d.z, true) : [d.anchor]
    const remove = pendingCells(cells, 'remove', this.ctx.solids())
    if (st.station.cells.length - remove.length < 4) return
    // A dug auto-floor brings its wall ring along; a hand-placed block is
    // just removed.
    const next = removeFloor(st.station, remove)
    if (next.cells.length !== st.station.cells.length) st.commit(next)
  }
}
