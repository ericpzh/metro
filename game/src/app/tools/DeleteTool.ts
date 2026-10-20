import { msg } from '../../sim/i18n.ts'
// The 删除 tool: button-agnostic teardown — tap a block, drag an area of blocks
// (a line with Shift, exactly like the 方块 tool's right-drag), or sweep same-type 设备/装饰 in one
// commit. Moved verbatim from app/Viewport.tsx (GAME-SPEC §9.5). The sweep rule
// itself lives in app/sweep.ts; this file only owns the pointer gesture.

import { removeFloor, removeLiftExtension, removeModule, sameCells } from '../../build/model.ts'
import { isOutdoorSurface } from '../../sim/outdoorSurfaces.ts'
import { liftRises } from '../../sim/lifts.ts'
import type { Module } from '../../sim/types.ts'
import { removeSweptModules, sweepFamily, sweepThrough } from '../sweep.ts'
import { moduleLabel, useStore } from '../store.ts'
import { TactileTool } from './TactileTool.ts'
import { TileEquipmentTool } from './TileEquipmentTool.ts'
import { RoadTool } from './RoadTool.ts'
import { deletionTarget } from './deletionTarget.ts'
import { pendingCells, rectCells, straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/** Return an outer extension only; clicking the base or an interior interval keeps whole-shaft teardown. */
function liftExtensionAtPoint(mod: Extract<Module, { type: 'lift' }>, point: readonly number[]): 'bottom' | 'top' | undefined {
  const rises = liftRises(mod)
  if (rises.length < 2 || point.length < 3 || !Number.isFinite(point[2])) return undefined
  const starts: number[] = []
  let z = Math.min(mod.from.z, mod.to.z)
  for (const rise of rises) { starts.push(z); z += rise }
  const baseIndex = starts.findIndex((start, index) => mod.z >= start - 1e-6 && mod.z < start + rises[index]! - 1e-6)
  const hitZ = point[2]!
  let hitIndex = starts.findIndex((start, index) => hitZ >= start - 1e-5 && hitZ < start + rises[index]! - 1e-5)
  // The top cap belongs to the last interval for picking purposes.
  if (hitIndex < 0 && hitZ >= mod.to.z - 1e-5 && hitZ <= mod.to.z + 1e-5) hitIndex = rises.length - 1
  if (baseIndex < 0 || hitIndex < 0) return undefined
  if (hitIndex === 0 && baseIndex !== 0) return 'bottom'
  if (hitIndex === rises.length - 1 && baseIndex !== rises.length - 1) return 'top'
  return undefined
}

function liftExtensionPreview(mod: Extract<Module, { type: 'lift' }>, end: 'bottom' | 'top'): Extract<Module, { type: 'lift' }> {
  const rises = liftRises(mod)
  if (end === 'bottom') {
    const rise = rises[0]!
    return { ...mod, z: mod.from.z, from: { ...mod.from }, to: { ...mod.from, z: mod.from.z + rise }, cfg: { ...mod.cfg, rises: [rise], doors: undefined } }
  }
  const rise = rises[rises.length - 1]!
  return { ...mod, z: mod.to.z - rise, from: { ...mod.to, z: mod.to.z - rise }, to: { ...mod.to }, cfg: { ...mod.cfg, rises: [rise], doors: undefined } }
}

export class DeleteTool extends ToolController {
  readonly tool = 'delete' as const

  /**
   * The piece one press means: the drawn model the ray hit when it stands in the
   * pointed cell, otherwise the piece that cell holds (`deletionTarget`). The
   * same resolution the right-click teardown uses, and it is asked **once** per
   * event — the scene pick is the expensive half of it.
   */
  private deleteTarget(info: PointerInfo): { module: Module | undefined; point?: [number, number, number] } {
    const hit = info.hit
    if (!hit) return { module: undefined }
    // Keep the module identity and its actual surface point from one scene pick.
    // The terrain hit alone cannot tell which interval of a tall shaft was aimed at.
    const scene = this.ctx.scene()
    const moduleHit = scene && 'pickModuleHit' in scene
      ? scene.pickModuleHit(info.clientX, info.clientY)
      : null
    const pickedId = scene && 'pickModuleHit' in scene ? moduleHit?.moduleId ?? null : this.pickModuleAt(info)
    const modules = useStore.getState().station.modules
    return {
      module: this.visibleModule(deletionTarget(modules, pickedId, hit.cell, this.facing())),
      point: moduleHit?.point,
    }
  }

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    // The delete tool is button-agnostic: press a block and tap (one block) or
    // drag an area (a rectangle of blocks, a line with Shift). It reuses the `drag`
    // ref in remove mode with `shift` following the key, so the release takes the
    // block tool's right-drag path.
    // A drawn module under the pointer is the pending delete instead — the
    // whole piece goes, not the floor block beneath it — except a 围栏 panel,
    // which drags out a line of its own like the 围栏 tool (see below).
    const { module: picked, point } = this.deleteTarget(info)
    if (picked) {
      if (picked.type === 'road') { new RoadTool(this.ctx).beginDelete(info,picked.id); return }
      if (picked.type === 'tactile') { new TactileTool(this.ctx).onDown(info); return }
      // 人行道 / 草坪 are tiles too: the delete tool hands them to the tile tool
      // with the *tile's own* finish, exactly as it does for roof and stair blocks
      // — that is the teardown the tile tool's right-drag performs, one
      // `editOutdoorSurfaces` commit for the whole rectangle. Without this the
      // press fell through to the generic module path, which is a ray-resolved
      // single-tile `removeModule`: right-click and B then disagreed about both
      // the target and the run.
      if (isOutdoorSurface(picked)) {
        info.preventDefault()
        const anchor: [number, number, number] = [picked.x, picked.y, picked.z]
        this.ctx.drag.current = {
          active: true, roof: true, deleteTile: true, button: info.button, mode: 'remove', anchor, z: picked.z,
          shift: false, sx: info.clientX, sy: info.clientY, downTime: performance.now(),
          tileType: picked.type, tileRot: picked.rot ?? 0,
        }
        new TileEquipmentTool(this.ctx).refreshHover()
        return
      }
      if (picked.type === 'roof' || (picked.type === 'stair' && picked.cfg.block)) {
        info.preventDefault()
        const stairBlock = picked.type === 'stair'
        const tileType = stairBlock
          ? 'stair-block'
          : picked.cfg.variant === 'canopy' ? 'roof-canopy'
        : picked.cfg.variant === 'shell' ? 'roof-shell'
            : picked.cfg.variant === 'truss' ? 'roof-truss'
            : picked.cfg.variant === 'tapered-truss' ? 'roof-tapered' : 'roof'
        const width = picked.type === 'roof' ? picked.d : 1
        const anchor: [number, number, number] = [picked.x, picked.y, picked.z]
        this.ctx.drag.current = {
          active: true, roof: true, deleteTile: true, button: info.button, mode: 'remove', anchor, z: picked.z,
          shift: false, sx: info.clientX, sy: info.clientY, downTime: performance.now(),
          tileType, tileRot: picked.rot ?? 0, tileWidth: width,
        }
        new TileEquipmentTool(this.ctx).refreshHover()
        return
      }
      info.preventDefault()
      // A fence panel is one cell of a run, so the delete tool drags it like
      // the 围栏 tool: press anchors, a drag draws a straight line, and the
      // release lifts every panel on it. Any other module is removed whole —
      // and an equipment (设备) or 装饰 piece starts a same-type sweep: hold
      // the button and drag across matching pieces, and each one the pointer
      // passes through is highlighted and joins the pending list (§9.5).
      const fence = picked.type === 'fence'
      const family = fence ? null : sweepFamily(picked)
      const liftExtension = picked.type === 'lift' && point ? liftExtensionAtPoint(picked, point) : undefined
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
        liftExtension,
        family: family ?? undefined,
        lx: info.clientX,
        ly: info.clientY,
        sx: info.clientX,
        sy: info.clientY,
        downTime: performance.now(),
      }
      scene.setModulePreview(liftExtension && picked.type === 'lift' ? liftExtensionPreview(picked, liftExtension) : picked, true)
      scene.setCollisionHighlight(null)
      scene.setGhost([], 'remove')
      // The equipment model is the delete preview; a cell cursor underneath it
      // makes the floor look like the thing being removed.
      scene.setCursor(null)
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
      shift: info.shiftKey,
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    scene.setGhost(pendingCells([hit.cell], 'remove', this.ctx.solids()), 'remove')
    scene.setCollisionHighlight(null)
    scene.setCursor(hit.cell, true)
    this.ctx.showMeasure?.(info.clientX, info.clientY, msg('length_1_m_width_1_m'))
  }

  onMove(info: PointerInfo): void {
    if (this.ctx.drag.current?.road) { new RoadTool(this.ctx).onMove(info); return }
    if (this.ctx.drag.current?.tactile) { new TactileTool(this.ctx).onMove(info); return }
    if (this.ctx.drag.current?.roof) { new TileEquipmentTool(this.ctx).onMove(info); return }
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
        const modules: Module[] = []
        for (const [x, y, z] of line) {
          const mod = st.station.modules.find((m) => m.type === 'fence' && m.x === x && m.y === y && m.z === z)
          if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
          seen.add(mod.id)
          modules.push(mod)
        }
        scene.setModulePreview(modules, true)
        scene.setCollisionHighlight(null)
        scene.setGhost([], 'remove')
        scene.setCursor(null)
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
          .filter((m) => this.visibleModule(m) !== undefined)
        scene.setGhost([], 'remove')
        scene.setCollisionHighlight(null)
        const preview = mods.map((mod, index) => index === 0 && d.liftExtension && mod.type === 'lift'
          ? liftExtensionPreview(mod, d.liftExtension)
          : mod)
        scene.setModulePreview(preview, true)
        scene.setCursor(null)
        return
      }
      // A deliberate press draws the area of blocks the release will remove —
      // a rectangle like the 方块 tool's right-drag (a line with Shift); a quick
      // tap stays one block even if the pointer jitters.
      d.shift = info.shiftKey
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const line = dragging ? rectCells(d.anchor, hit.cell, d.z, info.shiftKey) : [d.anchor]
      scene.setGhost(pendingCells(line, 'remove', this.ctx.solids()), 'remove')
      scene.setCursor(dragging ? hit.cell : d.anchor, true)
      const dx = dragging ? Math.abs(hit.cell[0] - d.anchor[0]) + 1 : 1
      const dy = dragging ? Math.abs(hit.cell[1] - d.anchor[1]) + 1 : 1
      this.ctx.showMeasure?.(info.clientX, info.clientY, msg('length_value_m_width_value_m', dx, dy))
      return
    }
    // Hover: a drawn module under the pointer is the pending delete, shown as
    // a red ghost of the piece itself; otherwise the block under it. A wall
    // panel or a hung fitting never rings the floor beneath it. The same
    // resolution the press uses, so the ghost is the piece the release removes —
    // a 人行道 tile under a tree's canopy is ghosted, not the tree.
    const { module: picked, point } = this.deleteTarget(info)
    if (picked) {
      if (picked.type === 'road') {
        new RoadTool(this.ctx).previewDelete(info, picked.id)
        return
      }
      scene.setGhost([], 'remove')
      scene.setCollisionHighlight(null)
      const liftExtension = picked.type === 'lift' && point ? liftExtensionAtPoint(picked, point) : undefined
      scene.setModulePreview(liftExtension && picked.type === 'lift' ? liftExtensionPreview(picked, liftExtension) : picked, true)
      scene.setCursor(null)
    } else {
      scene.setModulePreview(null)
      scene.setCollisionHighlight(null)
      scene.setGhost(pendingCells([hit.cell], 'remove', this.ctx.solids()), 'remove')
      scene.setCursor(hit.cell, hit.solid)
    }
  }

  onUp(info: PointerInfo): void {
    if (this.ctx.drag.current?.road) { new RoadTool(this.ctx).onUp(info); return }
    if (this.ctx.drag.current?.tactile) { new TactileTool(this.ctx).onUp(info); return }
    // The viewport routes module/fence/plain-block drags here (never a 围栏
    // placement run — that release belongs to the equipment tool). Each branch
    // below is the delete side of the release the press promised.
    const d = this.ctx.drag.current
    if (d?.roof) { new TileEquipmentTool(this.ctx).onUp(info); return }
    this.ctx.drag.current = null
    const scene = this.ctx.scene()
    if (!scene || !d?.active) return
    scene.setGhost([], 'add')
    scene.setModulePreview(null)
    scene.setFencePreview(null)
    scene.setCollisionHighlight(null)
    this.ctx.clearMeasure?.()
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
        .filter((m) => this.visibleModule(m) !== undefined)
      if (swept.length === 0) {
        st.setNotice(msg('nothing_to_remove_here'))
        return
      }
      if (swept.length === 1) {
        if (d.liftExtension && swept[0].type === 'lift') {
          st.commit(removeLiftExtension(st.station, swept[0].id, d.liftExtension))
          st.select(null)
          st.setNotice(msg('removed_value', moduleLabel(swept[0])))
          return
        }
        this.removePlacedModule(swept[0])
        return
      }
      st.commit(removeSweptModules(st.station, swept.map((m) => m.id)))
      st.select(null)
      const head = swept[0]
      const label = moduleLabel(head)
      st.setNotice(msg('removed_value_value', swept.length, label))
      return
    }
    if (d.fence) {
      // A 围栏 line drag lifts every panel on it, one cell of the run at a time.
      const line = rect ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
      const seen = new Set<string>()
      let next = st.station
      let removed = 0
      for (const [x, y, z] of line) {
        const mod = next.modules.find((m) => m.type === 'fence' && m.x === x && m.y === y && m.z === z)
        if (!mod || mod.type !== 'fence' || seen.has(mod.id) || !this.visibleModule(mod)) continue
        seen.add(mod.id)
        next = removeModule(next, mod.id)
        removed++
      }
      if (removed > 0) {
        st.commit(next)
        st.select(null)
        st.setNotice(msg('removed_value_fence_sections', removed))
      } else {
        st.setNotice(msg('no_fence_to_remove_here'))
      }
      return
    }
    // A deliberate press draws the area of blocks the release removes — a
    // rectangle like the 方块 tool's right-drag (a line with Shift).
    const cells = rect ? rectCells(d.anchor, target, d.z, d.shift) : [d.anchor]
    // Only the document's own blocks count against the seed's integrity (§4.1):
    // the implicit street at z = 0 is in the live solid set, and counting it would
    // refuse every dig at grade — the gesture the hole records exist for. An area
    // that takes none of the document's blocks is not the guard's business.
    const remove = pendingCells(cells, 'remove', this.ctx.solids())
    const authored = remove.filter(([x, y, z]) => st.station.cells.some((c) => c.x === x && c.y === y && c.z === z))
    // The seed guard refuses rather than digs: say why instead of silence.
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
