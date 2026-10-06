// The 方块 (block) tool: click for one block, long-press + drag for a rectangle
// patch (with an auto-wall ring when 生成墙壁 is on, which **Tab** and the ring's
// own tile raise), one **半墙** / 三角 block at a time when a cut piece is armed,
// right-press on a wall for a whole-column lift. Moved verbatim
// from app/Viewport.tsx (GAME-SPEC §4).

import {
  addCells,
  addFloor,
  addWalls,
  plannedAutoWalls,
  removeFloor,
  wallColumnAt,
  wallColumnsAt,
  wallSnap,
} from '../../build/model.ts'
import { blockRefusalNotice, checkBlockCells, dominantRefusal, newPreview } from '../../build/validation.ts'
import type { PlacementPreview } from '../../build/validation.ts'
import type { CellShape } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { pendingCells, rectCells, straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { cutShapeFor, shapeWallSide, thinGhost } from './geometry/walls.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class BlockTool extends ToolController {
  readonly tool = 'block' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // 方块: a click is one block, a long press + drag is a rectangle on the
    // pressed plane (the depth you are on, stepped with Q/E). With 生成墙壁
    // on the patch grows an auto-wall ring; off, it is plain blocks.
    // With a cut piece armed (半墙 / 三角, its own tile) it is neither: the click lays
    // one piece where it lands — a cut is one piece at a time, and it is what
    // the patch grows instead of the ring, so there is no patch and no auto wall
    // (`store.ts` keeps the two modes exclusive).
    info.preventDefault()
    const mode: 'add' | 'remove' = info.button === 2 ? 'remove' : 'add'
    const anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
    // A right-press on a tagged wall lifts the whole column, exactly as the 墙 tool's
    // own right-drag does — what the mode builds, it takes back in one action rather
    // than a course at a time. Anywhere else the 方块 tool's ordinary dig stands, so
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
    if (mode === 'add' && (st.halfWall || st.triangles)) {
      // The shape follows the wall tool's own rule — the cell's geometry first, then
      // whatever **R** has stepped to (`halfWallRunSide` / `triangleRunSide`) — but the
      // piece stands exactly where the click landed: a cut block is placed like a
      // block, not snapped to an edge like the 墙 tool's course. The resolved shape
      // goes on the drag, so the release lays the very piece the ghost is about to
      // draw rather than resolving it a second time and hoping the two agree.
      const open = wallSnap(st.station.cells, anchor, [hit.point[0], hit.point[1]], 0).dirs
      const shape = cutShapeFor([anchor], open, st)
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
        shape,
        sx: info.clientX,
        sy: info.clientY,
        downTime: performance.now(),
      }
      this.drawCutGhost(anchor, shape)
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
    // A cut mode (半墙 / 三角), add path: one piece, never a patch and never a run, so
    // there is no rectangle to preview and no patch size to report. The pressed
    // column's own candidate faces (`d.wallDirs`) are what **R** steps through, and
    // the shape it resolves to is written back to the drag so the release and the
    // ghost never part company.
    if ((st.halfWall || st.triangles) && d?.mode !== 'remove') {
      const held = d?.active === true && d.wall === true
      const base: [number, number, number] = held ? d.anchor : hit.solid ? hit.place : hit.cell
      const open = d?.wallDirs ?? wallSnap(st.station.cells, base, [hit.point[0], hit.point[1]], 0).dirs
      const shape = cutShapeFor([base], open, st)
      if (held) d.shape = shape
      const check = this.drawCutGhost(base, shape)
      // The pointer's own ring is the verdict too: a cell that refuses the piece
      // shows the ring red, not a hopeful cyan over a red box.
      scene.setCursor(base, check.blockedCells.length === 0)
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
      let valid = d.mode === 'add'
      if (d.mode === 'remove') {
        scene.setGhost(pendingCells(preview, 'remove', this.ctx.solids()), 'remove')
        scene.setCollisionHighlight(null)
      } else {
        // A deliberate 方块 drag with 生成墙壁 on draws a walled surface: the
        // ring the release would raise is previewed with the blocks themselves, and
        // it is judged by the same rule as they are. The raw rectangle goes in, so a
        // cell the release will refuse is drawn red rather than dropped in silence —
        // `checkBlockCells` is what decides, and `addCells` asks it again on release.
        const cells = [...preview]
        if (dragging && st.autoWalls) cells.push(...plannedAutoWalls(this.ctx.solids(), preview, st.station.modules))
        valid = this.showAddGhost(cells).blockedCells.length === 0
      }
      scene.setCursor(dragging ? target : d.anchor, valid)
      // The patch's own footprint, in metres (1 cell = 1 m), pinned to the
      // pointer so the player can size a foundation before releasing.
      const dx = dragging ? Math.abs(target[0] - d.anchor[0]) + 1 : 1
      const dy = dragging ? Math.abs(target[1] - d.anchor[1]) + 1 : 1
      this.ctx.showMeasure(info.clientX, info.clientY, `长 ${dx} m × 宽 ${dy} m`)
      return
    }
    const c = hit.solid ? hit.place : hit.cell
    const check = this.showAddGhost([c])
    scene.setCursor(c, check.blockedCells.length === 0)
    this.ctx.showMeasure(info.clientX, info.clientY, '长 1 m × 宽 1 m')
  }

  /**
   * Preview an add: the cyan shape the accepted cells will take, the refused ones
   * as red boxes, and the pieces standing in the way boxed in red beside them.
   *
   * The verdict is `build/validation.ts`'s, and it is the same one the release asks
   * (`addCells` / `addFloor` / `addWalls` all funnel through `blockReason`) — a block
   * refused by a 闸机, a 楼梯's corridor or a rail bed is shown refused here rather
   * than silently dropped, and the offending piece is named by highlighting it. A
   * cell the station already holds is not a candidate and is left alone.
   *
   * Returns the preview, so the caller can colour its pointer ring with the same
   * verdict: no candidate refused means the cell under the pointer is placeable.
   */
  private showAddGhost(cells: Array<[number, number, number]>): PlacementPreview {
    const scene = this.ctx.scene()
    if (!scene) return newPreview()
    const st = useStore.getState()
    const check = checkBlockCells(st.station, cells)
    scene.setGhost(check.acceptedCells, 'add', undefined, undefined, check.blockedCells)
    scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
    return check
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
      // The preview the release must agree with: `pendingCells` has already dropped
      // the cells that are not candidates (solid ground, a rail bed), and
      // `checkBlockCells` names the refused ones so the notice can say why.
      const check = checkBlockCells(st.station, cells)
      // A cut-mode click (半墙 / 三角) is one tagged course, not a plain block: it goes
      // through `addWalls` with the height of one and the shape the press resolved,
      // which is what writes the `half-wall:<side>` / `tri-upper:<side>` tag the
      // mesher draws the piece from. The plain-block path below would lay an untagged
      // solid — a whole block where the ghost showed a cut one — which is the whole
      // difference between the two.
      if ((st.halfWall || st.triangles) && d.single === true && d.wall === true) {
        const shape = d.shape ?? null
        const triangle = shape?.kind === 'triangle' ? { kind: shape.triangle, side: shape.side } : null
        const { state: next, changed, blocked } = addWalls(st.station, [d.anchor], shapeWallSide(shape), 1, triangle)
        if (changed > 0) st.commit(next)
        if (blocked > 0) st.setNotice(blockRefusalNotice('equipment'))
      } else if (rect && st.autoWalls) {
        // A deliberate 方块 drag with 生成墙壁 on draws a walled floor patch:
        // union it with earlier patches and rebuild the auto wall ring around
        // the new edge. With the toggle off it takes the plain-block path below
        // even for a drag — no tags, no walls.
        const next = addFloor(st.station, cells)
        if (next !== st.station) st.commit(next)
        if (check.blockedCells.length > 0) st.setNotice(blockRefusalNotice(dominantRefusal(check)))
      } else {
        const { cells: next, changed, blocked } = addCells(st.station.cells, cells, st.station.modules)
        if (changed > 0) st.commit({ ...st.station, cells: next })
        if (blocked > 0) st.setNotice(blockRefusalNotice(dominantRefusal(check)))
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
   * Draw the ghost for one cut piece: a **半墙** as a single half-thick course, a
   * **三角** as the 45° wedge it tags, so the preview is the piece — the cut *is* the
   * block (`thinGhost`). The shape is resolved before it gets here (`cutShapeFor`
   * over the pressed cell's own candidate faces), so the ghost that shows the piece
   * and the release that lays it read one answer.
   */
  private drawCutGhost(base: [number, number, number], shape: CellShape | null): PlacementPreview {
    const scene = this.ctx.scene()
    if (!scene) return newPreview()
    const st = useStore.getState()
    // A cut piece is a course like any other, so it answers to the same rule: the
    // cell a 闸机 holds, a ramp corridor or a rail bed refuses it, and the ghost says
    // so with the red box rather than laying a panel nobody asked for.
    const check = checkBlockCells(st.station, [base])
    scene.setGhost(check.acceptedCells, 'add', undefined, thinGhost(check.acceptedCells, shape), check.blockedCells)
    scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
    return check
  }

  /**
   * Rebuild the 方块 tool's hover ghost from the last tile it was over: the patch or
   * the single cut piece (半墙 / 三角), and for a cut piece the shape **R** has stepped
   * to. Shared by the pointer move and the Tab / R effect, because a ghost is only
   * redrawn when its key changes — nothing else would rebuild it under a still
   * pointer (`placementPreviewKey`, `scene.setGhost`).
   */
  override refreshHover(): void {
    const scene = this.ctx.scene()
    const h = this.ctx.hover.current
    if (!scene || !h) return
    const st = useStore.getState()
    if (st.tool !== 'block') return
    const base: [number, number, number] = h.solid ? h.place : h.cell
    let check: PlacementPreview
    if (st.halfWall || st.triangles) {
      const open = wallSnap(st.station.cells, base, h.point ?? null, 0).dirs
      const shape = cutShapeFor([base], open, st)
      // A press still held keeps its anchor: **R** stepped mid-drag has to move the
      // shape the release will lay, not only the one the ghost under the pointer
      // shows, or the two would disagree at the release.
      const d = this.ctx.drag.current
      if (d?.active === true && d.wall === true && d.single === true) d.shape = shape
      check = this.drawCutGhost(base, shape)
    } else {
      check = this.showAddGhost([base])
    }
    // The pointer ring is the same verdict as the ghost: a refused cell is red here
    // too, and a cell the station already holds is not a refusal (nothing to do).
    scene.setCursor(base, check.blockedCells.length === 0)
    // The patch's own size badge belongs to the block brush; it comes back on the
    // next pointer move if that is the mode the player is in.
    this.ctx.clearMeasure()
  }
}
