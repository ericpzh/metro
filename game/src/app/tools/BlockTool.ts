// The 地基 (block) tool: click for one block, long-press + drag for a rectangle
// patch (with an auto-wall ring when 自动生成墙壁 is on), Tab for one **半墙**
// block at a time, right-press on a wall for a whole-column lift. Moved verbatim
// from app/Viewport.tsx (GAME-SPEC §4).

import {
  addCells,
  addFloor,
  plannedAutoWalls,
  removeFloor,
  wallColumnAt,
  wallColumnsAt,
  wallSnap,
  type WallDir,
} from '../../build/model.ts'
import { useStore } from '../store.ts'
import { pendingCells, rectCells, straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { halfWallSideFor, thinGhost } from './geometry/walls.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class BlockTool extends ToolController {
  readonly tool = 'block' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // 地基: a click is one block, a long press + drag is a rectangle on the
    // pressed plane (the depth you are on, stepped with Q/E). With 自动生成墙壁
    // on (the default) the patch grows an auto-wall ring; off, it is plain blocks.
    // With **半墙** on (Tab) it is neither: the click lays one half-block wall
    // block where it lands — the 半墙 mode is one piece at a time, and it is what
    // the patch grows instead of the ring, so there is no patch and no auto wall
    // (`store.ts` keeps the two modes exclusive).
    info.preventDefault()
    const mode: 'add' | 'remove' = info.button === 2 ? 'remove' : 'add'
    const anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
    // A right-press on a tagged wall lifts the whole column, exactly as the 墙 tool's
    // own right-drag does — what the mode builds, it takes back in one action rather
    // than a course at a time. Anywhere else the 地基 tool's ordinary dig stands, so
    // a misplaced floor block is still dug without leaving the mode.
    if (mode === 'remove') {
      const column = wallColumnAt(st.station, anchor[0], anchor[1], anchor[2])
      if (column.length > 0) {
        this.ctx.drag.current = {
          active: true,
          button: info.button,
          mode,
          anchor,
          z: anchor[2],
          shift: false,
          wall: true,
          sx: info.clientX,
          sy: info.clientY,
          downTime: performance.now(),
        }
        scene.setGhost(column, 'remove')
        scene.setCursor(anchor, true)
        return
      }
    }
    if (mode === 'add' && st.halfWall) {
      // The side follows the wall tool's own rule — the cell's geometry first, then
      // whatever **R** has stepped to (`halfWallRunSide`) — but the block stands
      // exactly where the click landed: a 半墙 is placed like a block, not snapped
      // to an edge like the 墙 tool's course.
      const open = wallSnap(st.station.cells, anchor, [hit.point[0], hit.point[1]], 0).dirs
      this.ctx.drag.current = {
        active: true,
        button: info.button,
        mode,
        anchor,
        z: anchor[2],
        shift: false,
        wall: true,
        single: true,
        wallDirs: open,
        sx: info.clientX,
        sy: info.clientY,
        downTime: performance.now(),
      }
      this.drawHalfWallGhost(anchor, open)
      scene.setCursor(anchor, true)
      return
    }
    this.ctx.drag.current = {
      active: true,
      button: info.button,
      mode,
      anchor,
      z: anchor[2],
      shift: info.shiftKey,
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    scene.setGhost(pendingCells([anchor], mode, this.ctx.solids(), st.station.modules), mode)
    this.ctx.showMeasure(info.clientX, info.clientY, '长 1 m × 宽 1 m')
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // The tile under the pointer, so Tab (半墙) and R (its side) rebuild the
    // ghost in place instead of waiting for the next move.
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
    const d = this.ctx.drag.current
    // A wall remove drag — the right-press that landed on a 半墙 or any other
    // tagged column — previews the columns the release lifts, exactly as the 墙
    // tool's own right-drag does.
    if (d?.active && d.wall === true && d.mode === 'remove') {
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const line = dragging ? straightLineCells(d.anchor, hit.cell, d.z) : [d.anchor]
      scene.setGhost(wallColumnsAt(st.station, line), 'remove')
      scene.setCursor(dragging ? hit.cell : d.anchor, true)
      this.ctx.clearMeasure()
      return
    }
    // 半墙 mode, add path: one wall block, never a patch and never a run, so
    // there is no rectangle to preview and no patch size to report.
    if (st.halfWall && d?.mode !== 'remove') {
      const base: [number, number, number] = hit.solid ? hit.place : hit.cell
      const open = d?.wallDirs ?? wallSnap(st.station.cells, base, [hit.point[0], hit.point[1]], 0).dirs
      this.drawHalfWallGhost(d?.active && d.wall ? d.anchor : base, open)
      scene.setCursor(d?.active && d.wall ? d.anchor : base, true)
      this.ctx.clearMeasure()
      return
    }
    if (d?.active) {
      d.shift = info.shiftKey
      const target = d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
      // Only a deliberate press becomes a rectangle; a quick press stays one
      // block even if the pointer jitters.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const preview = dragging ? rectCells(d.anchor, target, d.z, info.shiftKey) : [d.anchor]
      // A deliberate 地基 drag with 自动生成墙壁 on draws a walled surface:
      // show the auto wall ring the release would raise, so the shell is not a
      // surprise. With the toggle off, it is the same drag with plain blocks.
      const cells = pendingCells(preview, d.mode, this.ctx.solids(), st.station.modules)
      if (d.mode === 'add' && dragging && st.autoWalls)
        cells.push(...plannedAutoWalls(this.ctx.solids(), preview, st.station.modules))
      scene.setGhost(cells, d.mode)
      scene.setCursor(dragging ? target : d.anchor, d.mode === 'add')
      // The patch's own footprint, in metres (1 cell = 1 m), pinned to the
      // pointer so the player can size a foundation before releasing.
      const dx = dragging ? Math.abs(target[0] - d.anchor[0]) + 1 : 1
      const dy = dragging ? Math.abs(target[1] - d.anchor[1]) + 1 : 1
      this.ctx.showMeasure(info.clientX, info.clientY, `长 ${dx} m × 宽 ${dy} m`)
      return
    }
    const c = hit.solid ? hit.place : hit.cell
    scene.setGhost([c], 'add')
    scene.setCursor(c, true)
    this.ctx.showMeasure(info.clientX, info.clientY, '长 1 m × 宽 1 m')
  }

  onUp(info: PointerInfo): void {
    // The viewport routes only plain and single-half-wall drags here; any
    // `wall` run release belongs to the wall tool. The cells tail below is the
    // same code for both — a quick press is one block, a deliberate drag a
    // rectangle (or line with Shift).
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
    const target = hit ? (d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell) : d.anchor
    const st = useStore.getState()
    const cells = rect ? rectCells(d.anchor, target, d.z, d.shift) : [d.anchor]
    if (d.mode === 'add') {
      if (rect && st.autoWalls) {
        // A deliberate 地基 drag with 自动生成墙壁 on draws a walled floor patch:
        // union it with earlier patches and rebuild the auto wall ring around
        // the new edge. With the toggle off it takes the plain-block path below
        // even for a drag — no tags, no walls.
        const next = addFloor(st.station, cells)
        if (next !== st.station) st.commit(next)
      } else {
        const { cells: next, changed, blocked } = addCells(st.station.cells, cells, st.station.modules)
        if (changed > 0) st.commit({ ...st.station, cells: next })
        if (blocked > 0) st.setNotice('预留开口要留空：楼梯、扶梯和出入口的地板不能用方块盖住')
      }
    } else {
      // Only real blocks count against the seed's integrity (§4.1); a rectangle
      // drawn across void would otherwise trip the guard for nothing.
      const remove = pendingCells(cells, 'remove', this.ctx.solids())
      if (st.station.cells.length - remove.length < 4) return
      // A dug auto-floor brings its wall ring along; a hand-placed block is
      // just removed.
      const next = removeFloor(st.station, remove)
      if (next.cells.length !== st.station.cells.length) st.commit(next)
    }
  }

  /**
   * Draw the **半墙** ghost for one block: a single half-thick course, on the side
   * **R** has stepped to, so the preview is the piece — the half thickness *is* the
   * wall (`thinGhost`). `open` is the cell's own geometry (`wallSnap`'s candidate
   * faces), which the side rule orders the player's choice behind.
   */
  private drawHalfWallGhost(base: [number, number, number], open: readonly WallDir[]): void {
    const scene = this.ctx.scene()
    if (!scene) return
    const st = useStore.getState()
    const cells = pendingCells([base], 'add', this.ctx.solids(), st.station.modules)
    scene.setGhost(cells, 'add', undefined, thinGhost(cells, halfWallSideFor([base], open, st)))
  }

  /**
   * Rebuild the 地基 tool's hover ghost from the last tile it was over: the patch or
   * the single **半墙** block (Tab), and for a 半墙 the side **R** has stepped to. Shared by
   * the pointer move and the Tab / R effect, because a ghost is only redrawn when
   * its key changes — nothing else would rebuild it under a still pointer
   * (`placementPreviewKey`, `scene.setGhost`).
   */
  override refreshHover(): void {
    const scene = this.ctx.scene()
    const h = this.ctx.hover.current
    if (!scene || !h) return
    const st = useStore.getState()
    if (st.tool !== 'block') return
    const base: [number, number, number] = h.solid ? h.place : h.cell
    if (st.halfWall) {
      this.drawHalfWallGhost(base, wallSnap(st.station.cells, base, h.point ?? null, 0).dirs)
    } else {
      scene.setGhost([base], 'add')
    }
    scene.setCursor(base, true)
    // The patch's own size badge belongs to the block brush; it comes back on the
    // next pointer move if that is the mode the player is in.
    this.ctx.clearMeasure()
  }
}
