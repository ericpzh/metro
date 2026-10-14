import { msg } from '../../sim/i18n.ts'
// The 分区 tool paints floor labels; ticket and information counters remain
// buildable room modules. Moved verbatim from app/Viewport.tsx (GAME-SPEC §10).
//
// A fare zone is painted on **floor** and nowhere else (§4.5). The brush asks the
// viewport's floor key set (`ToolContext.floors`, built by `zoneFloorKeys`), which
// is the same rule the 分区 map draws with, so what the pointer accepts is exactly
// what the overlay can tint.

import {
  cellKey,
  eraseZoneCells,
  facilityAt,
  facilityPlan,
  facilityRect,
  boothBenchSpots,
  FACILITY_MIN,
  paintZoneCells,
  placeFacility,
  removeFacility,
  type FacilityKind,
} from '../../build/model.ts'
import { isTrackCell } from '../../sim/placement.ts'
import { ZONE_PAINT_LIST } from '../../sim/zones.ts'
import type { Module } from '../../sim/types.ts'
import { FACILITY_OPTIONS, isEraseBrush, isFacilityBrush, moduleLabel, useStore, type ZoneBrush } from '../store.ts'
import { rectCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo, ZoneDragState } from './ToolContext.ts'

/** Highlight colour for a facility-room drag. */
function facilityColour(kind: FacilityKind): number {
  return FACILITY_OPTIONS.find((f) => f.id === kind)?.colour ?? 0x7fe4ff
}

/**
 * The eraser's preview colour: the same warning red the 材质 brush erases in
 * (`app/tools/PaintTool.ts`), because it is the same gesture meaning the same
 * thing — this rectangle is having something taken off it.
 */
const ERASE_PREVIEW = 0xff7a7a

/** Preview colour of either brush the zone tool carries: a fare zone or a room. */
function brushColour(brush: ZoneBrush): number {
  if (isEraseBrush(brush)) return ERASE_PREVIEW
  if (isFacilityBrush(brush)) return facilityColour(brush)
  return ZONE_PAINT_LIST.find((z) => z.id === brush)?.colour ?? 0x7fe4ff
}

export class ZoneTool extends ToolController {
  readonly tool = 'zone' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // Counter modules can be removed as modules. Room labels are ordinary zones.
    if (info.button === 2) {
      const fac = hit.solid ? facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined
      if (fac?.type === 'booth') {
        st.commit(removeFacility(st.station, fac.id))
        st.select(null)
        st.setNotice(msg('removed_value', moduleLabel(fac.type, fac.type === 'booth' ? fac.cfg.kind : undefined)))
        return
      }
      if (hit.solid) this.bulldoze(hit.cell, hit.place, this.facing())
      return
    }
    // Zone brushes paint floors; ticket and information brushes build counters.
    info.preventDefault()
    const brush = st.zoneBrush
    // §4.5: a zone belongs to a **floor** cell, so a fare-zone patch may not be
    // started on a wall coping, a ceiling or the earth over a tunnel — the tiles
    // that are solid and are not floor. Such a press paints nothing and says why,
    // rather than opening a drag that would write a label no overlay can draw.
    if (!isFacilityBrush(brush) && !this.ctx.floors().has(cellKey(hit.cell[0], hit.cell[1], hit.cell[2]))) {
      st.setNotice(isEraseBrush(brush) ? msg('zones_can_only_be_erased_on_floors') : msg('zones_can_only_be_painted_on_floors'))
      return
    }
    const z = isFacilityBrush(brush) ? st.activeZ : hit.cell[2]
    const anchor: [number, number, number] = [hit.cell[0], hit.cell[1], z]
    this.ctx.zoneDrag.current = {
      active: true,
      brush,
      anchor,
      target: anchor,
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
    const zd = this.ctx.zoneDrag.current
    if (zd?.active) {
      const target: [number, number, number] = [hit.cell[0], hit.cell[1], zd.z]
      zd.target = target
      if (isFacilityBrush(zd.brush)) {
        // Live highlight of the area about to become a room: the rectangle
        // between the pressed cell and the pointer, merged with any same-type
        // room the drag extends. A different-type clash flags red.
        this.showFacilityPreview(zd, target)
        return
      }
      // Tint exactly the floor the rectangle covers. The
      // brush's own floor set is the filter — a rectangle dragged across a wall
      // row tints the floor it crosses and drops the copings it also swept.
      const cells = rectCells(zd.anchor, target, zd.z, false)
      const floor = cells.filter(([x, y, z]) => this.ctx.floors().has(cellKey(x, y, z)))
      scene.setGhost([], 'remove')
      scene.setFaceGhost(floor, 'top', brushColour(zd.brush))
      scene.setCursor(target, true)
      return
    }
    scene.setModulePreview(null)
    // A fare-zone brush hovers as a single tinted floor cell, ready to drag — and
    // only on floor: over a wall coping or a ceiling there is nothing a zone
    // could be painted on, so the ghost goes and the cursor reads refused.
    scene.setGhost([], 'remove')
    const onFloor = hit.solid && this.ctx.floors().has(cellKey(hit.cell[0], hit.cell[1], hit.cell[2]))
    if (onFloor) scene.setFaceGhost([hit.cell], 'top', brushColour(st.zoneBrush))
    else scene.clearFaceGhost()
    scene.setCursor(hit.cell, onFloor)
  }

  /** Rebuild the room ghost when R changes its front during a held drag. */
  refreshFacilityPreview(): void {
    const zd = this.ctx.zoneDrag.current
    if (zd?.active && isFacilityBrush(zd.brush)) this.showFacilityPreview(zd, zd.target)
  }

  private showFacilityPreview(zd: ZoneDragState, target: [number, number, number]): void {
    const scene = this.ctx.scene()
    if (!scene) return
    const st = useStore.getState()
    const kind = zd.brush as FacilityKind
    const plan = facilityPlan(st.station, kind, facilityRect(zd.anchor, target, zd.z))
    const area = plan.rect
    const cells = rectCells([area.x0, area.y0, area.z], [area.x1, area.y1, area.z], zd.z, false)
    scene.clearFaceGhost()
    const front = st.facilityRot as 0 | 1 | 2 | 3
    const width = area.x1 - area.x0 + 1
    const height = area.y1 - area.y0 + 1
    const modules: Module[] = zd.brush === 'ticket' || zd.brush === 'info'
      ? [
          { id: 'facility-preview', type: 'booth', x: area.x0, y: area.y0, z: area.z, w: width, h: height, cfg: { kind: zd.brush, stocked: true, front } },
          ...boothBenchSpots(area, front).map((spot, i): Module => ({ id: `facility-preview-bench-${i}`, type: 'bench', x: spot.x, y: spot.y, z: area.z, rot: spot.rot, cfg: { auto: true } })),
        ]
      : []
    scene.setGhost([], 'remove')
    scene.setModulePreview(modules.length ? modules : null, plan.blockedBy !== null)
    if (!modules.length) scene.setFaceGhost(cells, 'top', plan.blockedBy ? 0xff7a7a : facilityColour(kind))
    scene.setCursor(target, true)
  }

  onUp(info: PointerInfo): void {
    const zd = this.ctx.zoneDrag.current
    this.ctx.zoneDrag.current = null
    if (zd?.active) {
      this.ctx.scene()?.clearFaceGhost()
      this.ctx.scene()?.setModulePreview(null)
      const st = useStore.getState()
      const hit = info.hit
      const target: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], zd.z] : zd.anchor
      // A deliberate press becomes a rectangle; a quick tap stays one cell.
      const wasRect = performance.now() - zd.downTime >= LONG_PRESS_MS && isMoved(zd, info)
      if (!isFacilityBrush(zd.brush)) {
        // A zone patch: a quick tap is one cell and a deliberate drag a rectangle of
        // the chosen zone — or, with the folder's **无分区** armed, the very same
        // rectangle with the labels taken *off* it. Either way only the floor is
        // asked about (§4.5), by the same rule the 分区 map draws with.
        const erasing = isEraseBrush(zd.brush)
        const rect = rectCells(zd.anchor, wasRect ? target : zd.anchor, zd.z, false)
        const floor = rect.filter(([x, y, z]) => this.ctx.floors().has(cellKey(x, y, z)))
        if (floor.length === 0) {
          st.setNotice(erasing ? msg('zones_can_only_be_erased_on_floors') : msg('zones_can_only_be_painted_on_floors'))
          return
        }
        // The cells go back to **reading** their storey's default rather than being
        // handed one (`eraseZoneCells`), which is the whole of what 无分区 does.
        const next = isEraseBrush(zd.brush) ? eraseZoneCells(st.station, floor) : paintZoneCells(st.station, floor, zd.brush)
        if (next === st.station) {
          if (erasing) st.setNotice(msg('these_cells_have_no_zone'))
          return
        }
        st.commit(next)
        return
      }
      const r = facilityRect(zd.anchor, wasRect ? target : zd.anchor, zd.z)
      // Overlapping another room type is refused; the same type is extended, so
      // the size and rail checks apply to the resulting room, not just the strip
      // the pointer covered.
      const plan = facilityPlan(st.station, zd.brush, r)
      if (plan.blockedBy) {
        st.setNotice(msg('different_room_types_cannot_overlap'))
        return
      }
      const area = plan.rect
      const aw = area.x1 - area.x0 + 1
      const ah = area.y1 - area.y0 + 1
      if (aw < FACILITY_MIN || ah < FACILITY_MIN) {
        st.setNotice(msg('room_minimum_is_value_value_current_size_is_value_value_draw_a_l', FACILITY_MIN, FACILITY_MIN, aw, ah))
        return
      }
      // A room may not straddle the rails: its floor must not be a track bed.
      for (let x = area.x0; x <= area.x1; x++) {
        for (let y = area.y0; y <= area.y1; y++) {
          if (isTrackCell(st.station.cells, st.station.modules, x, y, area.z)) {
            st.setNotice(msg('cannot_build_rooms_on_track'))
            return
          }
        }
      }
      const next = placeFacility(st.station, zd.brush, r, undefined, st.facilityRot)
      if (next === st.station) {
        st.setNotice(msg('lay_a_complete_floor_before_drawing_a_room_here'))
        return
      }
      st.commit(next)
      st.select({ kind: 'cell', key: cellKey(area.x0, area.y0, area.z), label: `(${area.x0}, ${area.y0}, ${area.z}) ${aw}×${ah}` })
      const built = zd.brush === 'ticket' ? msg('ticket_booth') : msg('information_desk')
      st.setNotice(plan.merge.length > 0 ? msg('room_expanded_to_the_new_bounds') : msg('built_value_with_counters_around_it_serving_from_outside', built))
    }
  }
}
