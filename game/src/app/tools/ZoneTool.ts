// The 分区 (zone) tool: drag a fare-zone patch, or a facility room when a room
// brush is chosen; right-drag over a shop cuts wall openings (or swallows the
// room to delete it). Moved verbatim from app/Viewport.tsx (GAME-SPEC §10).

import {
  carveFacilityOpenings,
  cellKey,
  facilityAt,
  facilityCovers,
  facilityFloorCells,
  facilityOpeningCells,
  facilityPlan,
  facilityRect,
  facilityWallCells,
  FACILITY_MIN,
  paintZoneCells,
  placeFacility,
  removeFacility,
  SHOP_WALL_H,
  type FacilityKind,
} from '../../build/model.ts'
import { isTrackCell } from '../../sim/placement.ts'
import { ZONE_LIST } from '../../sim/zones.ts'
import { FACILITY_OPTIONS, isFacilityBrush, moduleLabel, useStore, type ZoneBrush } from '../store.ts'
import { rectCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/** Highlight colour for a facility-room drag. */
function facilityColour(kind: FacilityKind): number {
  return FACILITY_OPTIONS.find((f) => f.id === kind)?.colour ?? 0x7fe4ff
}

/** Preview colour of either brush the zone tool carries: a fare zone or a room. */
function brushColour(brush: ZoneBrush): number {
  if (isFacilityBrush(brush)) return facilityColour(brush)
  return ZONE_LIST.find((z) => z.id === brush)?.colour ?? 0x7fe4ff
}

/** Colour of the "cut an opening" right-click preview. */
const OPENING_PREVIEW = 0x7fe4ff

/** Every cell a whole-store delete would clear, for the red preview volume. */
function facilityVolume(mod: { x: number; y: number; z: number; w?: number; h?: number }): Array<[number, number, number]> {
  const w = mod.w ?? 1
  const h = mod.h ?? 1
  const out: Array<[number, number, number]> = []
  for (let x = mod.x; x < mod.x + w; x++) {
    for (let y = mod.y; y < mod.y + h; y++) {
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) out.push([x, y, mod.z + dz])
    }
  }
  return out
}

export class ZoneTool extends ToolController {
  readonly tool = 'zone' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // Right-click edits a walled room: drag over its walls to cut openings, or
    // drag across the whole room to delete it. Booths have no opening, so a
    // right-click deletes them outright.
    if (info.button === 2) {
      const fac = hit.solid ? facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined
      if (fac && fac.type === 'shop') {
        info.preventDefault()
        const anchor: [number, number, number] = [hit.cell[0], hit.cell[1], fac.z]
        this.ctx.facilityDrag.current = { active: true, id: fac.id, anchor, z: fac.z, sx: info.clientX, sy: info.clientY, downTime: performance.now() }
        const r = facilityRect(anchor, anchor, fac.z)
        scene.setGhost(facilityOpeningCells(st.station.cells, fac, r), 'remove', OPENING_PREVIEW)
        scene.setCursor(anchor, true)
        return
      }
      if (fac) {
        st.commit(removeFacility(st.station, fac.id))
        st.select(null)
        st.setNotice(`已拆掉${moduleLabel(fac.type)}`)
        return
      }
      if (hit.solid) this.bulldoze(hit.cell, hit.place, this.facing())
      return
    }
    // Both brushes are a long-press drag: the press holds the anchor, the
    // rectangle previews live, and the release applies it — a room when a
    // shop/booth is chosen, a painted zone patch when a fare zone is.
    info.preventDefault()
    const brush = st.zoneBrush
    const z = isFacilityBrush(brush) ? st.activeZ : hit.cell[2]
    const anchor: [number, number, number] = [hit.cell[0], hit.cell[1], z]
    this.ctx.zoneDrag.current = {
      active: true,
      brush,
      anchor,
      z,
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    scene.setFaceGhost([anchor], 'top', brushColour(brush))
    scene.setCursor(anchor, true)
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    const fd = this.ctx.facilityDrag.current
    if (fd?.active) {
      const mod = st.station.modules.find((m) => m.id === fd.id)
      if (!mod) return
      const target: [number, number, number] = [hit.cell[0], hit.cell[1], fd.z]
      const r = facilityRect(fd.anchor, target, fd.z)
      scene.clearFaceGhost()
      if (facilityCovers(mod, r)) scene.setGhost(facilityVolume(mod), 'remove')
      else scene.setGhost(facilityOpeningCells(st.station.cells, mod, r), 'remove', OPENING_PREVIEW)
      scene.setCursor(target, true)
      return
    }
    const zd = this.ctx.zoneDrag.current
    if (zd?.active) {
      const target: [number, number, number] = [hit.cell[0], hit.cell[1], zd.z]
      if (isFacilityBrush(zd.brush)) {
        // Live highlight of the area about to become a room: the rectangle
        // between the pressed cell and the pointer, merged with any same-type
        // room the drag extends. A different-type clash flags red.
        const plan = facilityPlan(st.station, zd.brush, facilityRect(zd.anchor, target, zd.z))
        const area = plan.rect
        const cells = rectCells([area.x0, area.y0, area.z], [area.x1, area.y1, area.z], zd.z, false)
        scene.setGhost([], 'remove')
        scene.setFaceGhost(cells, 'top', plan.blockedBy ? 0xff7a7a : facilityColour(zd.brush))
        scene.setCursor(target, true)
        return
      }
      // A fare-zone patch: tint exactly the floor the rectangle covers.
      const cells = rectCells(zd.anchor, target, zd.z, false)
      const floor = cells.filter(([x, y, z]) => this.ctx.solids().has(cellKey(x, y, z)))
      scene.setGhost([], 'remove')
      scene.setFaceGhost(floor, 'top', brushColour(zd.brush))
      scene.setCursor(target, true)
      return
    }
    if (isFacilityBrush(st.zoneBrush)) {
      // Over an existing room, light up its walls — the floor tile sits under
      // the wall blocks and is invisible. A room with no walls (a booth, or a
      // shop already opened up) highlights its footprint instead.
      const fac = hit.solid ? facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined
      if (fac) {
        const walls = facilityWallCells(st.station.cells, fac)
        scene.clearFaceGhost()
        if (walls.length > 0) scene.setGhost(walls, 'remove', facilityColour(st.zoneBrush))
        else {
          scene.setGhost([], 'remove')
          scene.setFaceGhost(facilityFloorCells(fac), 'top', facilityColour(st.zoneBrush))
        }
        scene.setCursor([hit.cell[0], hit.cell[1], fac.z], true)
        return
      }
      scene.setGhost([], 'remove')
      const c: [number, number, number] = [hit.cell[0], hit.cell[1], st.activeZ]
      scene.setFaceGhost([c], 'top', facilityColour(st.zoneBrush))
      scene.setCursor(c, true)
      return
    }
    // A fare-zone brush hovers as a single tinted floor cell, ready to drag.
    scene.setGhost([], 'remove')
    if (hit.solid) scene.setFaceGhost([hit.cell], 'top', brushColour(st.zoneBrush))
    else scene.clearFaceGhost()
    scene.setCursor(hit.cell, hit.solid)
  }

  onUp(info: PointerInfo): void {
    // The viewport routes both the shop right-drag and the zone/room rectangle
    // here; whichever ref is active owns the release.
    const fd = this.ctx.facilityDrag.current
    this.ctx.facilityDrag.current = null
    if (fd?.active) {
      this.ctx.scene()?.setGhost([], 'remove')
      const st = useStore.getState()
      const mod = st.station.modules.find((m) => m.id === fd.id)
      if (!mod) return
      const hit = info.hit
      const target: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], fd.z] : fd.anchor
      const r = facilityRect(fd.anchor, target, fd.z)
      // A drag that swallows the whole room means delete; anything narrower
      // cuts the wall openings it touches.
      if (facilityCovers(mod, r)) {
        st.commit(removeFacility(st.station, mod.id))
        st.select(null)
        st.setNotice('房间拆掉了')
        return
      }
      const walls = facilityOpeningCells(st.station.cells, mod, r)
      if (walls.length === 0) {
        st.setNotice('在墙上右键拖拽开门；框住整个房间就是拆除')
        return
      }
      const cut = carveFacilityOpenings(st.station, mod.id, walls)
      st.commit(cut)
      if (!cut.modules.some((m) => m.id === mod.id)) st.setNotice('房间的墙全拆光了')
      return
    }
    const zd = this.ctx.zoneDrag.current
    this.ctx.zoneDrag.current = null
    if (zd?.active) {
      this.ctx.scene()?.clearFaceGhost()
      const st = useStore.getState()
      const hit = info.hit
      const target: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], zd.z] : zd.anchor
      // A deliberate press becomes a rectangle; a quick tap stays one cell.
      const wasRect = performance.now() - zd.downTime >= LONG_PRESS_MS && isMoved(zd, info)
      if (!isFacilityBrush(zd.brush)) {
        // A fare-zone patch: a quick tap tints one cell, a deliberate drag a
        // rectangle of the chosen zone across the floor it covers.
        const rect = rectCells(zd.anchor, wasRect ? target : zd.anchor, zd.z, false)
        const floor = rect.filter(([x, y, z]) => this.ctx.solids().has(cellKey(x, y, z)))
        const next = paintZoneCells(st.station, floor, zd.brush)
        if (next !== st.station) st.commit(next)
        return
      }
      const r = facilityRect(zd.anchor, wasRect ? target : zd.anchor, zd.z)
      // Overlapping another room type is refused; the same type is extended, so
      // the size and rail checks apply to the resulting room, not just the strip
      // the pointer covered.
      const plan = facilityPlan(st.station, zd.brush, r)
      if (plan.blockedBy) {
        st.setNotice('不同类型房间不能重叠')
        return
      }
      const area = plan.rect
      const aw = area.x1 - area.x0 + 1
      const ah = area.y1 - area.y0 + 1
      if (aw < FACILITY_MIN || ah < FACILITY_MIN) {
        st.setNotice(`房间最小 ${FACILITY_MIN}×${FACILITY_MIN}，现在才 ${aw}×${ah}，再画大点`)
        return
      }
      // A room may not straddle the rails: its floor must not be a track bed.
      for (let x = area.x0; x <= area.x1; x++) {
        for (let y = area.y0; y <= area.y1; y++) {
          if (isTrackCell(st.station.cells, st.station.modules, x, y, area.z)) {
            st.setNotice('轨道上不能建房间')
            return
          }
        }
      }
      const next = placeFacility(st.station, zd.brush, r)
      if (next === st.station) {
        st.setNotice('这里画不了房间，得先铺好整块地面')
        return
      }
      st.commit(next)
      st.select({ kind: 'cell', key: cellKey(area.x0, area.y0, area.z), label: `(${area.x0}, ${area.y0}, ${area.z}) ${aw}×${ah}` })
      const built = FACILITY_OPTIONS.find((f) => f.id === zd.brush)?.label ?? '房间'
      st.setNotice(
        plan.merge.length > 0
          ? '房间已扩大到新的范围'
          : zd.brush === 'ticket'
            ? `${built}建好了，四周是柜台，从外面服务`
            : `${built}建好了，在墙上右键拖拽开门`,
      )
    }
  }
}
