import { msg } from '../../sim/i18n.ts'
// The 方块 (block) tool: click for one block, long-press + drag for a rectangle
// patch (with an auto-wall ring when 生成墙壁 is on, which **Shift+Tab** and the ring's
// own tile raise), one **半墙** block at a time or a ridge-locked **三角** line
// when a cut piece is armed, right-press on a wall for a whole-column lift.
// right-press on a wall for a whole-column lift. Moved verbatim
// from app/Viewport.tsx (GAME-SPEC §4).

import {
  addCells,
  addSuspendedCeiling,
  addFloor,
  addWalls,
  plannedAutoWalls,
  removeFloor,
  sameCells,
  wallColumnAt,
  wallColumnsAt,
  wallSnap,
} from '../../build/model.ts'
import { checkBlockCells, newPreview, previewNotice } from '../../build/validation.ts'
import type { PlacementPreview } from '../../build/validation.ts'
import type { Cell, CellShape } from '../../sim/types.ts'
import { triangleOf } from '../../sim/types.ts'
import { useStore } from '../store.ts'
import { cutLineCellCount, dragCellCount, pendingCells, rectCells, straightLineCells, triangleLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { cutShapeFor, shapeWallSide, thinGhost } from './geometry/walls.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class BlockTool extends ToolController {
  readonly tool = 'block' as const

  private blockedPreview: {
    station: ReturnType<typeof useStore.getState>['station']; key: string
    autoWalls: boolean; suspendedCeiling: boolean; cell: [number, number, number]
  } | null = null

  override cancelPreview(): void {
    super.cancelPreview()
    this.blockedPreview = null
  }

  onDown(info: PointerInfo): void {
    this.cancelPreview()
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
    let anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
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
      this.drawCutGhost([anchor], shape)
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
    scene.setGhost(pendingCells([anchor], mode, this.ctx.solids(), st.station), mode)
    this.ctx.showMeasure(info.clientX, info.clientY, msg('length_1_m_width_1_m'))
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) {
      this.cancelPreview()
      return
    }
    const st = useStore.getState()
    // The tile under the pointer, so Tab (半墙) and R (its side) rebuild the
    // ghost in place instead of waiting for the next move.
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
    const d = this.ctx.drag.current
    // A wall remove drag — the right-press that landed on a 半墙 or any other
    // tagged column — previews the columns the release lifts, exactly as the 墙
    // tool's own right-drag does. A 三角 column drags a ridge-locked line, so the
    // run it lifts is the run its slopes join.
    if (d?.active && d.wall === true && d.mode === 'remove') {
      this.cancelPreview()
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const rawLine = dragging ? straightLineCells(d.anchor, hit.cell, d.z) : [d.anchor]
      const line = dragging ? this.wallRemoveLine(st.station.cells, d.anchor, hit.cell, d.z, rawLine) : rawLine
      scene.setGhost(wallColumnsAt(st.station, line), 'remove')
      scene.setCursor(dragging ? hit.cell : d.anchor, true)
      this.ctx.clearMeasure()
      return
    }
    // A cut mode (半墙 / 三角), add path: a 半墙 is one piece, never a patch and
    // never a run; a 三角 drags a ridge-locked line, so its slopes join as one
    // smooth surface. There is no rectangle to preview and no patch size to report.
    // The pressed column's own candidate faces (`d.wallDirs`) are what **R** steps
    // through, and the shape it resolves to is written back to the drag so the
    // release and the ghost never part company.
    if ((st.halfWall || st.triangles) && d?.mode !== 'remove') {
      this.cancelPreview()
      const held = d?.active === true && d.wall === true
      const base: [number, number, number] = held ? d.anchor : hit.solid ? hit.place : hit.cell
      const open = d?.wallDirs ?? wallSnap(st.station.cells, base, [hit.point[0], hit.point[1]], 0).dirs
      const shape = cutShapeFor([base], open, st)
      if (held) d.shape = shape
      // A held 三角 press becomes a line along its own ridge once the pointer
      // moves; a tap stays one wedge, and a 半墙 stays one panel either way.
      const target: [number, number, number] = hit.solid ? hit.place : hit.cell
      const dragging = held && performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const triangleDrag = dragging && shape?.kind === 'triangle'
      // A run over the drag budget is refused whole: every wedge is drawn red
      // and the release lays none of them, rather than the ghost promising a
      // shorter run than the pointer drew.
      const tooLarge = triangleDrag
        && cutLineCellCount(d.anchor, [target[0], target[1], d.z], shape.side) > this.multiPlace.limit
      const cursor: [number, number, number] = triangleDrag ? [target[0], target[1], d.z] : base
      if (tooLarge) {
        this.multiPlace.setNotice(true)
        const key = [...d.anchor, ...target, d.z, shape.side, st.stationEpoch].join(':')
        this.multiPlace.deferRefusal(scene, key, () => {
          if (this.ctx.drag.current !== d) return
          const line = triangleLineCells(d.anchor, [target[0], target[1], d.z], d.z, shape.side)
          this.multiPlace.refuse(this.ctx.scene(), line, cursor)
        })
        scene.setCursor(cursor, false)
        this.ctx.clearMeasure()
        return
      }
      this.multiPlace.setNotice(false)
      const draw = () => {
        const line = triangleDrag
          ? triangleLineCells(d.anchor, [target[0], target[1], d.z], d.z, shape!.side)
          : [base]
        const blocked = this.drawCutGhost(line, shape).blockedCells.length > 0
        scene.setCursor(cursor, !blocked)
      }
      if (triangleDrag) {
        const key = [...d.anchor, ...target, d.z, shape!.side, st.stationEpoch].join(':')
        this.multiPlace.deferPreview(scene, key, () => { if (this.ctx.drag.current === d) draw() })
      } else {
        this.cancelPreview()
        draw()
      }
      this.ctx.clearMeasure()
      return
    }
    if (d?.active) {
      d.shift = info.shiftKey
      const target = d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
      // Only a deliberate press becomes a rectangle; a quick press stays one
      // block even if the pointer jitters.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      if (dragging && d.mode === 'add') {
        // Snap the ring immediately; coalesce the latest full preview within
        // 50 ms even while the pointer keeps crossing new cells.
        const addTarget = hit.solid ? hit.place : hit.cell
        const tooLarge = this.multiPlace.check(dragCellCount(d.anchor, addTarget, info.shiftKey))
        scene.setCursor(addTarget, !tooLarge)
        this.ctx.showMeasure(info.clientX, info.clientY, msg(
          'length_value_m_width_value_m',
          Math.abs(addTarget[0] - d.anchor[0]) + 1,
          Math.abs(addTarget[1] - d.anchor[1]) + 1,
        ))
        this.scheduleAddDragPreview(d.anchor, addTarget, d.z, info.shiftKey, info.clientX, info.clientY)
        return
      }
      this.cancelPreview()
      const preview = dragging ? rectCells(d.anchor, target, d.z, info.shiftKey) : [d.anchor]
      let valid = true
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
        if (dragging && st.autoWalls) cells.push(...plannedAutoWalls(this.ctx.solids(), preview, st.station.modules, st.station.storeyHeight))
        valid = this.showAddGhost(cells).blockedCells.length === 0
        scene.setCursor(dragging ? target : d.anchor, valid)
      }
      if (d.mode === 'remove') scene.setCursor(dragging ? target : d.anchor, valid)
      // The patch's own footprint, in metres (1 cell = 1 m), pinned to the
      // pointer so the player can size a foundation before releasing.
      const dx = dragging ? Math.abs(target[0] - d.anchor[0]) + 1 : 1
      const dy = dragging ? Math.abs(target[1] - d.anchor[1]) + 1 : 1
      this.ctx.showMeasure(info.clientX, info.clientY, msg('length_value_m_width_value_m', dx, dy))
      return
    }
    this.cancelPreview()
    const c = hit.solid ? hit.place : hit.cell
    const check = this.showAddGhost([c])
    scene.setCursor(c, check.blockedCells.length === 0)
    this.ctx.showMeasure(info.clientX, info.clientY, msg('length_1_m_width_1_m'))
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

  private scheduleAddDragPreview(
    anchor: [number, number, number],
    target: [number, number, number],
    z: number,
    shift: boolean,
    clientX: number,
    clientY: number,
  ): void {
    const initial = useStore.getState()
    const key = [
      ...anchor, ...target, z, Number(shift), Number(initial.autoWalls),
      Number(initial.suspendedCeiling), initial.stationEpoch,
    ].join(':')
    const known = this.blockedPreview
    if (known && known.station.cells === initial.station.cells && known.station.modules === initial.station.modules
      && known.autoWalls === initial.autoWalls
      && known.suspendedCeiling === initial.suspendedCeiling) {
      const [x, y, wz] = known.cell
      const included = !shift && !initial.suspendedCeiling && wz === z && x >= Math.min(anchor[0], target[0]) && x <= Math.max(anchor[0], target[0])
        && y >= Math.min(anchor[1], target[1]) && y <= Math.max(anchor[1], target[1])
      // A remembered witness keeps the ring red immediately, even when the
      // scheduler reuses an unchanged preview or defers its replacement.
      if (known.key === key || included) this.ctx.scene()?.setCursor(target, false)
      else this.blockedPreview = null
    } else this.blockedPreview = null
    const changed = this.multiPlace.schedule(key, () => {
      const st = useStore.getState()
      if (st.tool !== 'block' || st.station.cells !== initial.station.cells || st.station.modules !== initial.station.modules ||
          st.autoWalls !== initial.autoWalls || st.suspendedCeiling !== initial.suspendedCeiling) return
      const scene = this.ctx.scene()
      if (!scene) return
      const footprint = this.addDragFootprint(anchor, target, z, shift, st)
      this.ctx.showMeasure(clientX, clientY, msg(
        'length_value_m_width_value_m',
        Math.abs(target[0] - anchor[0]) + 1,
        Math.abs(target[1] - anchor[1]) + 1,
      ))
      if (footprint.overLimit) {
        // The whole footprint is refused, so every cell it covers is a red box:
        // the player sees the drag is too large before releasing, not a smaller
        // patch that silently replaced the rectangle they drew.
        this.multiPlace.refuse(scene, [...footprint.cells, ...footprint.autoWalls], target)
        return
      }
      this.multiPlace.setNotice(false)
      const cells = [...footprint.cells, ...footprint.autoWalls]
      const check = checkBlockCells(st.station, cells)
      this.blockedPreview = check.blockedCells[0] ? {
        station: st.station, key, autoWalls: st.autoWalls, suspendedCeiling: st.suspendedCeiling,
        cell: check.blockedCells[0],
      } : null
      scene.setGhost(check.acceptedCells, 'add', undefined, undefined, check.blockedCells)
      scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
      scene.setCursor(target, check.blockedCells.length === 0)
    })
    if (changed && dragCellCount(anchor, target, shift) > this.multiPlace.limit) {
      const scene = this.ctx.scene()
      scene?.setGhost([], 'add')
      scene?.setCollisionHighlight(null)
    }
  }

  /**
   * The floor cells a 方块 drag would lay, plus its generated auto-wall courses.
   * A footprint over the shared drag budget — walls included — is not clipped:
   * `overLimit` refuses it whole, and the caller draws every cell red.
   */
  private addDragFootprint(
    anchor: [number, number, number],
    target: [number, number, number],
    z: number,
    line: boolean,
    st: ReturnType<typeof useStore.getState>,
  ): {
    cells: Array<[number, number, number]>
    autoWalls: Array<[number, number, number]>
    overLimit: boolean
  } {
    const count = dragCellCount(anchor, target, line)
    if (count > this.multiPlace.limit) {
      return { cells: rectCells(anchor, target, z, line), autoWalls: [], overLimit: true }
    }
    const cells = rectCells(anchor, target, z, line)
    if (!st.autoWalls || st.suspendedCeiling) return { cells, autoWalls: [], overLimit: false }
    const autoWalls = plannedAutoWalls(this.ctx.solids(), cells, st.station.modules, st.station.storeyHeight)
    return { cells, autoWalls, overLimit: cells.length + autoWalls.length > this.multiPlace.limit }
  }

  onUp(info: PointerInfo): void {
    this.cancelPreview()
    // The viewport routes only plain and single-cut drags here; any
    // `wall` run release belongs to the wall tool. The cells tail below is the
    // same code for both — a quick press is one block, a deliberate drag a
    // rectangle (or line with Shift). A 三角 drag is the ridge-locked line its
    // ghost drew, still released here because it lays single courses.
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
    if (d.mode === 'add') {
      // A cut-mode click (半墙 / 三角) is tagged courses, not plain blocks: it goes
      // through `addWalls` with the height of one and the shape the press resolved,
      // which is what writes the `half-wall:<side>` / `tri-upper:<side>` tag the
      // mesher draws the piece from. A 三角 drag lays the ridge-locked line its
      // ghost drew — same side on every cell, so the slopes join as one surface.
      // The plain-block path below would lay untagged solids — whole blocks where
      // the ghost showed cut ones — which is the whole difference between the two.
      if ((st.halfWall || st.triangles) && d.single === true && d.wall === true) {
        const shape = d.shape ?? null
        const triangle = shape?.kind === 'triangle' ? { kind: shape.triangle, side: shape.side } : null
        if (rect && triangle && cutLineCellCount(d.anchor, [target[0], target[1], d.z], triangle.side) > this.multiPlace.limit) {
          this.multiPlace.setNotice(true)
          return
        }
        this.multiPlace.setNotice(false)
        const line =
          rect && triangle ? triangleLineCells(d.anchor, [target[0], target[1], d.z], d.z, triangle.side) : [d.anchor]
        const { state: next, changed, blocked } = addWalls(st.station, line, shapeWallSide(shape), 1, triangle)
        if (changed > 0) st.commit(next)
        // The cut piece answers to the same block verdict, so name the same
        // conflict the red ghost boxed rather than a bare `equipment`. A cell
        // the station already holds is neither accepted nor refused — the ghost
        // stays blue over it — so a click that lays nothing there says so
        // instead of dropping the press in silence.
        if (blocked > 0) st.setNotice(previewNotice(st.station, checkBlockCells(st.station, line)))
        else if (changed === 0) st.setNotice(msg('cannot_place_value_here_a_block_already_exists', triangle ? msg('wedge') : msg('half_wall')))
      } else {
        // The patch a release lays, with its generated wall courses counted
        // against the same budget. Over the budget it is refused whole, so a
        // rectangle the ghost drew red never turns into a smaller patch.
        const footprint = rect ? this.addDragFootprint(d.anchor, target, d.z, d.shift, st) : null
        if (footprint?.overLimit) {
          this.multiPlace.setNotice(true)
          return
        }
        this.multiPlace.setNotice(false)
        const cells = footprint?.cells ?? [d.anchor]
        // The preview the release must agree with: `pendingCells` has already dropped
        // the cells that are not candidates (solid ground, a rail bed), and
        // `checkBlockCells` names the refused ones so the notice can say why.
        const check = checkBlockCells(st.station, cells)
        if (st.suspendedCeiling) {
          const result = addSuspendedCeiling(st.station, cells)
          if (result.changed > 0) st.commit(result.state)
          if (result.blocked > 0) st.setNotice(previewNotice(st.station, check))
        } else if (rect && st.autoWalls) {
          // A deliberate 方块 drag with 生成墙壁 on draws a walled floor patch:
          // union it with earlier patches and rebuild the auto wall ring around
          // the new edge. With the toggle off it takes the plain-block path below
          // even for a drag — no tags, no walls.
          //
          // The release lays the cells the ghost drew — `check.acceptedCells`, not the
          // raw rectangle — which is what `addFloor`'s own contract asks for ("the patch
          // lays exactly the accepted cells"). The two differ on the implicit street at
          // z = 0 (`sim/ground.ts`): `checkBlockCells` holds the plane to be floor
          // already and leaves it out of both lists, so a drag on virgin ground previews
          // nothing and must lay nothing. Handing `addFloor` the raw rectangle instead
          // poured 25 explicit blocks and a 4 m wall ring onto ground the file never
          // stores, for a ghost that had shown the player none of it.
          const next = addFloor(st.station, check.acceptedCells)
          if (next !== st.station) st.commit(next)
          // The notice names the conflict — the 闸机, the ramp corridor, the rail
          // bed — from the same preview the ghost drew, so the two cannot disagree.
          if (check.blockedCells.length > 0) st.setNotice(previewNotice(st.station, check))
        } else {
          const { cells: next, changed, blocked } = addCells(st.station.cells, cells, st.station.modules)
          if (changed > 0) st.commit({ ...st.station, cells: next })
          if (blocked > 0) st.setNotice(previewNotice(st.station, check))
          else if (changed === 0) st.setNotice(msg('cannot_place_a_block_here_a_block_already_exists'))
        }
      }
    } else {
      // Only the document's **own** blocks count against the seed's integrity
      // (§4.1). The street at z = 0 is implicit (`sim/ground.ts`) and is in the
      // live solid set, so counting it would make the arithmetic negative for any
      // drag at grade and refuse every dig — the one gesture the hole records
      // exist for. A drag that takes none of the document's blocks is not the
      // guard's business at all, which is what keeps a brand-new station (no cells
      // of its own) diggable. A rectangle drawn across void counts for nothing, as
      // before.
      const cells = rect ? rectCells(d.anchor, target, d.z, d.shift) : [d.anchor]
      const remove = pendingCells(cells, 'remove', this.ctx.solids())
      const authored = remove.filter(([x, y, z]) =>
        st.station.cells.some((c) => c.x === x && c.y === y && c.z === z),
      )
      // The seed guard refuses rather than digs: say why instead of dropping the
      // gesture in silence — the station keeps at least four blocks.
      if (authored.length > 0 && st.station.cells.length - authored.length < 4) {
        st.setNotice(msg('cannot_delete_more_keep_at_least_4_blocks_in_the_station'))
        return
      }
      // A dug auto-floor brings its wall ring along; a hand-placed block is
      // just removed. The change is read by content, not by length: digging a
      // block at grade swaps a `solid` for the street's `void` hole record, so
      // the list is the same length but the station changed — gating on length
      // dropped that commit and the block could never be dug back out.
      const next = removeFloor(st.station, remove)
      if (!sameCells(next.cells, st.station.cells)) st.commit(next)
      else st.setNotice(msg('no_block_to_delete_here'))
    }
  }

  /**
   * Draw the ghost for a cut run: a **半墙** as single half-thick courses, a
   * **三角** as the 45° wedges it tags — one shape on every cell, so a dragged
   * line previews the smooth slope the release will lay (`thinGhost`). The shape
   * is resolved before it gets here (`cutShapeFor` over the pressed cell's own
   * candidate faces), so the ghost that shows the pieces and the release that
   * lays them read one answer.
   */
  private drawCutGhost(bases: Array<[number, number, number]>, shape: CellShape | null): PlacementPreview {
    const scene = this.ctx.scene()
    if (!scene) return newPreview()
    const st = useStore.getState()
    // A cut piece is a course like any other, so it answers to the same rule: the
    // cell a 闸机 holds, a ramp corridor or a rail bed refuses it, and the ghost says
    // so with the red box rather than laying a panel nobody asked for.
    const check = checkBlockCells(st.station, bases)
    scene.setGhost(check.acceptedCells, 'add', undefined, thinGhost(check.acceptedCells, shape), check.blockedCells)
    scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
    return check
  }

  /**
   * A wall-remove line through the pressed column: the dominant-axis run, unless
   * the column is a 三角 — then the ridge-locked line its slopes join along, so a
   * delete drag can never take half a ramp and leave the rest stepped.
   */
  private wallRemoveLine(
    cells: readonly Cell[],
    anchor: [number, number, number],
    target: [number, number, number],
    z: number,
    fallback: Array<[number, number, number]>,
  ): Array<[number, number, number]> {
    const found = cells.find((c) => c.x === anchor[0] && c.y === anchor[1] && c.z === anchor[2])
    const tri = found ? triangleOf(found) : null
    if (!tri) return fallback
    return triangleLineCells(anchor, [target[0], target[1], z], z, tri.side)
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
      check = this.drawCutGhost([base], shape)
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
