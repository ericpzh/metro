import { msg } from '../../sim/i18n.ts'
// The 墙 tool: press to anchor a full-height wall column, drag for a straight
// 90° run, right-drag to clear each column's storey (GAME-SPEC §4).
// Also releases the 方块 tool's tagged-wall drag; that path keeps its own
// column lookup so release matches the 方块 preview.

import { addWalls, removeCells } from '../../build/model.ts'
import { checkBlockCells, previewNotice } from '../../build/validation.ts'
import { triangleOf } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { dragCellCount, straightLineCells, triangleLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { halfWallSideFor, wallSnapAt } from './geometry/walls.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'
import { storeyColumnsAt, wallColumnsAt, storeyWallRun } from '../../build/model.ts'

export class WallTool extends ToolController {  readonly tool = 'wall' as const

  /**
   * A remove line through the pressed column: the dominant-axis run, unless the
   * column is a 三角 — then the ridge-locked line its slopes join along, so the
   * drag lifts the run it was placed as.
   */
  private removeLine(
    anchor: [number, number, number],
    target: [number, number, number],
    z: number,
  ): Array<[number, number, number]> {
    const st = useStore.getState()
    const found = st.station.cells.find((c) => c.x === anchor[0] && c.y === anchor[1] && c.z === anchor[2])
    const tri = found ? triangleOf(found) : null
    if (tri) return triangleLineCells(anchor, [target[0], target[1], z], z, tri.side)
    return straightLineCells(anchor, target, z)
  }

  /**
   * Preview a wall run: the courses the release would lay, with the refused cells
   * boxed in red and the pieces standing in their way highlighted. A story-bounded
   * column can contain several candidates, so "this run is blocked" names the courses that are
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
    // is on, every block in that column's storey regardless of wall tags.
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
    if (mode === 'add') this.showWallGhost(storeyWallRun([anchor], st.station.levelBase, st.station.storeyHeight))
    else scene.setGhost(storeyColumnsAt(st.station, [anchor]), 'remove')
    scene.setCursor(anchor, true)
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
      // A full wall snaps to the dominant axis — straight 90° lines only — while
      // a 三角 remove run is ridge-locked, so it lifts the smooth run it was
      // placed as. The anchor was already snapped at the press, so a drag
      // extends that line instead of re-snapping every cell it crosses.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const cursor = dragging ? target : d.anchor
      const columns = dragging ? dragCellCount(d.anchor, target, true) : 1
      if (d.mode === 'add') {
        // A wall run is columns × courses, not one cell per pointer step: count
        // the blocks the release would actually lay, so it shares the same
        // budget as a 方块 patch with generated walls.
        const courses = storeyWallRun([d.anchor], st.station.levelBase, st.station.storeyHeight).length
        const over = this.multiPlace.check(columns * courses)
        scene.setCursor(cursor, !over)
        if (over) {
          // Coalesce the red footprint on the shared 50 ms cadence; the
          // notice and pointer verdict are already live.
          const initial = st
          const key = [...d.anchor, ...target, d.z, courses, initial.stationEpoch].join(':')
          this.multiPlace.deferRefusal(scene, key, () => {
            const latest = useStore.getState()
            if (latest.station !== initial.station || latest.tool !== 'wall') return
            const sceneNow = this.ctx.scene()
            if (!sceneNow) return
            const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
            this.multiPlace.refuse(sceneNow, storeyWallRun(line, latest.station.levelBase, latest.station.storeyHeight), cursor)
          })
          return
        }
        this.multiPlace.setNotice(false)
      }
      if (d.mode === 'add' && columns > 1) {
        const key = [...d.anchor, ...target, d.z, st.station.storeyHeight, st.stationEpoch].join(':')
        this.multiPlace.deferPreview(scene, key, () => {
          if (this.ctx.drag.current !== d) return
          const line = straightLineCells(d.anchor, target, d.z)
          const sceneNow = this.ctx.scene()
          if (!sceneNow) return
          this.showWallGhost(storeyWallRun(line, useStore.getState().station.levelBase, useStore.getState().station.storeyHeight))
          sceneNow.setCursor(line[line.length - 1], true)
        })
        return
      }
      if (d.mode === 'add') this.cancelPreview()
      const line = dragging ? (d.mode === 'remove' ? this.removeLine(d.anchor, target, d.z) : straightLineCells(d.anchor, target, d.z)) : [d.anchor]
      if (d.mode === 'add') this.showWallGhost(storeyWallRun(line, st.station.levelBase, st.station.storeyHeight))
      else scene.setGhost(storeyColumnsAt(st.station, line), 'remove')
      scene.setCursor(dragging ? line[line.length - 1] : d.anchor, true)
      return
    }
    const c = wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base
    this.showWallGhost(storeyWallRun([c], st.station.levelBase, st.station.storeyHeight))
    scene.setCursor(c, true)
  }

  onUp(info: PointerInfo): void {
    this.cancelPreview()
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
    // Refuse the whole run before allocating it. Count the remaining courses in
    // the anchor story, so the same 10,000-cell budget that covers a 方块
    // patch with generated walls covers this one too.
    const courses = d.single === true ? 1 : storeyWallRun([d.anchor], st.station.levelBase, st.station.storeyHeight).length
    const columns = d.single === true || !rect ? 1 : dragCellCount(d.anchor, target, true)
    if (d.mode === 'add' && columns * courses > this.multiPlace.limit) {
      this.multiPlace.setNotice(true)
      return
    }
    if (d.mode === 'add') this.multiPlace.setNotice(false)
    // A 墙 drag lays a straight axis-aligned run of full-height columns; a
    // quick press is one. The right drag lifts all blocks in each column's
    // storey. A **半墙** (`d.single`, the 方块 tool's mode) is always
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
    const rawLine = d.single === true || !rect ? [d.anchor] : straightLineCells(d.anchor, target, d.z)
    const line = d.single === true || !rect || d.mode === 'add' ? rawLine : this.removeLine(d.anchor, target, d.z)
    if (d.mode === 'add') {
      const side = d.wallDirs === undefined ? null : halfWallSideFor(line, d.wallDirs, st)
      // The courses the release would lay, judged once: the count it refuses here and
      // the red boxes the ghost drew are the same verdict (`checkBlockCells`), and a
      // refusal that is about a piece of equipment says so rather than blaming a
      // reserved opening.
      const check = checkBlockCells(st.station, d.single === true ? [d.anchor] : storeyWallRun(line, useStore.getState().station.levelBase, useStore.getState().station.storeyHeight))
      const { state: next, changed, blocked } = addWalls(st.station, line, side, d.single === true ? 1 : undefined)
      if (changed > 0) st.commit(next)
      // Name the conflict the red boxes showed — the piece, the corridor, the
      // rail bed — from the same preview the ghost drew.
      if (blocked > 0) st.setNotice(previewNotice(st.station, check))
      else if (changed === 0) st.setNotice(msg('cannot_place_a_wall_here_a_wall_already_exists'))
    } else {
      const remove = st.tool === 'block' ? wallColumnsAt(st.station, line) : storeyColumnsAt(st.station, line)
      if (remove.length === 0) {
        st.setNotice(msg('no_blocks_to_remove_here'))
        return
      }
      st.commit(removeCells(st.station, remove))
    }
  }
}
