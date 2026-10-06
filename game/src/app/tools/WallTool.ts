// The 墙 tool: press to anchor a full-height wall column, drag for a straight
// 90° run, right-drag to lift the same run back out. Moved verbatim from
// app/Viewport.tsx (GAME-SPEC §4). This controller also owns the release of the
// 方块 tool's right-press wall-column drag — the release code is identical, and
// the viewport routes any non-single `wall` drag here.

import { addWalls, removeCells } from '../../build/model.ts'
import { blockRefusalNotice, checkBlockCells, dominantRefusal } from '../../build/validation.ts'
import { useStore } from '../store.ts'
import { straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { halfWallSideFor, wallSnapAt } from './geometry/walls.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'
import { wallColumnAt, wallColumnsAt, wallRun } from '../../build/model.ts'

export class WallTool extends ToolController {  readonly tool = 'wall' as const

  /**
   * Preview a wall run: the courses the release would lay, with the refused cells
   * boxed in red and the pieces standing in their way highlighted. A full-height
   * column is four candidates, so "this run is blocked" names the courses that are
   * really refused — the same rule `addWalls` applies on release.
   */
  private showWallGhost(cells: Array<[number, number, number]>): void {
    const scene = this.ctx.scene()
    if (!scene) return
    const st = useStore.getState()
    // The whole run, every course: a course the station already holds is not a
    // candidate, and a course a piece holds is refused and drawn as a red box with
    // the offending piece highlighted (`checkBlockCells` keeps both lists).
    const check = checkBlockCells(st.station, cells)
    scene.setGhost(check.acceptedCells, 'add', undefined, undefined, check.blockedCells)
    scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
  }

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // The 墙 tool drags out a run of full-height wall; right-click drags the
    // same run back out again, a whole column at a time.
    info.preventDefault()
    const mode: 'add' | 'remove' = info.button === 2 ? 'remove' : 'add'
    // The add path snaps the column to the cell that faces open space and to
    // the R-selected wall face; the remove path lifts exactly what the pointer
    // is on, a whole tagged column at a time.
    const anchor = mode === 'add' ? wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base : hit.cell
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
    if (mode === 'add') this.showWallGhost(wallRun([anchor]))
    else scene.setGhost(wallColumnAt(st.station, anchor[0], anchor[1], anchor[2]), 'remove')
    scene.setCursor(anchor, mode === 'add')
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    const d = this.ctx.drag.current
    if (d?.active) {
      const target = d.mode === 'add' ? wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base : hit.cell
      // Only a deliberate press becomes a run; a quick press stays one column.
      // The run snaps to the dominant axis — straight 90° lines only. The
      // anchor was already snapped at the press, so a drag extends that line
      // instead of re-snapping every cell it crosses.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
      if (d.mode === 'add') this.showWallGhost(wallRun(line))
      else scene.setGhost(wallColumnsAt(st.station, line), 'remove')
      scene.setCursor(dragging ? line[line.length - 1] : d.anchor, d.mode === 'add')
      return
    }
    const c = wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base
    this.showWallGhost(wallRun([c]))
    scene.setCursor(c, true)
  }

  onUp(info: PointerInfo): void {
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
    // A 墙 drag lays a straight axis-aligned run of full-height columns; a
    // quick press is one. The right drag lifts the same run, a whole tagged
    // column at a time. A **半墙** (`d.single`, the 方块 tool's mode) is always
    // exactly one block — the one the press landed on — however far the pointer
    // travelled, because that mode places one piece at a time.
    //
    // Both ends of `line` are already snapped: the press snapped the anchor
    // (`wallSnapAt`) and a drag snaps the target each move, so a run always
    // follows the cells that actually face open space and never re-snaps a
    // cell the pointer merely crossed on its way there.
    //
    // The thickness side is the one R had stepped to at the press (`d.wallDirs`
    // is the anchor's own candidate faces), so the wall laid is the wall the
    // ghost showed.
    const line = d.single === true || !rect ? [d.anchor] : straightLineCells(d.anchor, target, d.z)
    if (d.mode === 'add') {
      const side = d.wallDirs === undefined ? null : halfWallSideFor(line, d.wallDirs, st)
      // The courses the release would lay, judged once: the count it refuses here and
      // the red boxes the ghost drew are the same verdict (`checkBlockCells`), and a
      // refusal that is about a piece of equipment says so rather than blaming a
      // reserved opening.
      const check = checkBlockCells(st.station, d.single === true ? [d.anchor] : wallRun(line))
      const { state: next, changed, blocked } = addWalls(st.station, line, side, d.single === true ? 1 : undefined)
      if (changed > 0) st.commit(next)
      if (blocked > 0) st.setNotice(blockRefusalNotice(dominantRefusal(check)))
    } else {
      const remove = wallColumnsAt(st.station, line)
      if (remove.length === 0) return
      st.commit(removeCells(st.station, remove))
    }
  }
}
