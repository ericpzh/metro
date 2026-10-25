import { moduleAim } from './moduleAim.ts'
import { RoadTool } from './RoadTool.ts'
import { msg } from '../../sim/i18n.ts'
// The 设备 (equipment) tool: press to place the chosen module — fence runs drag
// out like walls, lifts extend in-column, stairs place as complete flights, billboards
// autoface their wall. Moved verbatim from app/Viewport.tsx (GAME-SPEC §5–§6).

import {
  addEquipment,
  cellKey,
  createModule,
  extendLift,
  facilityAt,
  fenceRotForLine,
  nextExitLetter,
  nextExitName,
  nextModuleId,
  randomAdSlug,
  removeModule,
} from '../../build/model.ts'
import { railModuleAtPlatform, makeBridge, freeTunnelEnd, trackBlockNotice, trackBlockReason, trackColliders, commitTrack } from '../../build/rail.ts'
import { bridgePillarCandidates } from '../../build/model/BridgePillars.ts'
import { edgeCells, rotateLocal } from '../../sim/track.ts'
import { snapPsdEnd, snapPsdEndCover } from '../../sim/psdEnds.ts'
import { extendedPillar } from '../../sim/structures.ts'
import { escalatorLengthSpec, escalatorModule } from '../../sim/escalators.ts'
import { walkwayModule } from '../../sim/walkways.ts'
import { RAMP_LENGTH_DEFAULT, stairLengthSpec, type RampLength, type RampLengthSpec } from '../../sim/rampLengths.ts'
import { exitFloorAt, exitRunSnap, snapExitToRamp } from '../../sim/exits.ts'
import { glassModuleSpec, glassStandsOnFloor } from '../../sim/glassPanels.ts'
import { liftExtendedDown, liftExtendedUp, type LiftModule } from '../../sim/lifts.ts'
import {
  autofaceWallMount,
  blockerLabels,
  equipmentReason,
  equipmentRefusalNotice,
  isCeilingHung,
  liftAt,
  pillarAt,
  placementColliders,
  glassCells,
  snapDoorToCurtain,
  topBlockOver,
} from '../../sim/placement.ts'
import { checkModulePlacements } from '../../build/validation.ts'
import type { Module } from '../../sim/types.ts'
import { isDecorType, isFenceType, isStairType, isWallMountedType, signModuleWithPreview, useStore } from '../store.ts'
import { dragCellCount, straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { TactileTool } from './TactileTool.ts'
import { TileEquipmentTool } from './TileEquipmentTool.ts'
import { snapBoardingMark } from '../../sim/floorDecor.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'
import { deletionTarget } from './deletionTarget.ts'
import { canPlaceWithoutFloorHit } from './placementInput.ts'
import { snapSignToBooth } from '../../sim/boothSigns.ts'
import { boothSignAim, boothSignHitOf } from './boothSignHit.ts'

/** Rotation whose local back points from the stand cell to the hit block. */
function wallRotationForSide(dx: number, dy: number): number | null {
  if (dx === 0 && dy === -1) return 0
  if (dx === 1 && dy === 0) return 1
  if (dx === 0 && dy === 1) return 2
  if (dx === -1 && dy === 0) return 3
  return null
}

function isHeadHouseExitType(type: string): boolean {
  return type === 'exit' || type.startsWith('exit-covered-') || type.startsWith('exit-uncovered-')
}

function isSnapRamp(mod: Module | undefined): mod is Extract<Module, { type: 'stair' | 'escalator' }> {
  return !!mod && (mod.type === 'escalator' || (mod.type === 'stair' && !mod.cfg.block && (!mod.cfg.style || mod.cfg.style === 'straight')))
}

export class EquipmentTool extends ToolController {
  readonly tool = 'module' as const

  /**
   * The booth this event's pointer picked, for the 墙面指示牌 snap. Resolved once per
   * event beside the hit (`boothSignAim`), so the ghost and the click snap to the
   * booth the player can see even when the ray's own surface point falls just past
   * its footprint — and aiming at a board already bolted to a booth keeps meaning
   * that booth. Null for every other piece.
   */
  private signBoothId: string | null = null

  onDown(info: PointerInfo): void {
    if (useStore.getState().moduleType === 'road' || this.ctx.drag.current?.road) { new RoadTool(this.ctx).onDown(info); return }
    if (useStore.getState().moduleType.startsWith('tactile-')) { new TactileTool(this.ctx).onDown(info); return }
    if ((useStore.getState().moduleType.startsWith('roof') || useStore.getState().moduleType === 'stair-block' || useStore.getState().moduleType === 'sidewalk' || useStore.getState().moduleType === 'lawn')) { new TileEquipmentTool(this.ctx).onDown(info); return }
    const scene = this.ctx.scene()
    if (!scene) return
    const signAim = useStore.getState().moduleType === 'sign-wall'
      ? boothSignAim(scene, useStore.getState().station.modules, info.clientX, info.clientY)
      : undefined
    this.signBoothId = signAim?.booth.id ?? null
    const hit = useStore.getState().moduleType === 'bridge'
      ? this.bridgePointerHit(info)
      : signAim
      ? boothSignHitOf(signAim)
      : info.hit
    const st = useStore.getState()
    // Resolve the drawn target once for this press. A direct PSD pick applies a
    // cover to its whole run; a floor hit stays a one-tile placement.
    const pickedCoverId = info.button !== 2 && st.moduleType === 'psd-end-cover'
      ? this.ctx.pickModule(info.clientX, info.clientY, true)
      : null
    const pickedCoverTarget = pickedCoverId
      ? st.station.modules.find((m) => m.id === pickedCoverId)
      : undefined
    if ((pickedCoverTarget?.type === 'platform-edge' || pickedCoverTarget?.type === 'psd-end') && !hit) {
      const [x, y, z] = pickedCoverTarget.type === 'platform-edge'
        ? edgeCells(pickedCoverTarget)[0] ?? [pickedCoverTarget.x, pickedCoverTarget.y, pickedCoverTarget.z]
        : [pickedCoverTarget.x, pickedCoverTarget.y, pickedCoverTarget.z]
      this.placeModule([x, y, z], [x, y, z], false, st.moduleType, undefined, undefined, pickedCoverTarget)
      return
    }
    const pickedRamp = isHeadHouseExitType(st.moduleType) ? this.pickSnapRamp(info) : undefined
    if (info.button !== 2 && !hit && pickedRamp) {
      const upper = pickedRamp.from.z >= pickedRamp.to.z ? pickedRamp.from : pickedRamp.to
      this.placeModule([upper.x, upper.y, upper.z], [upper.x, upper.y, upper.z], false, st.moduleType, undefined, pickedRamp)
      return
    }
    if (!hit) return
    if (info.button === 2 && st.moduleType.startsWith('floor-mark-')) {
      // Vinyl can share a screen-door strip: erase the print the ray hits,
      // rather than tearing down the screen standing over that floor (§9.5).
      const pickedId = this.pickModuleAt(info)
      const picked = st.station.modules.find((m) => m.id === pickedId)
      if (picked?.type === 'floor-mark') this.removePlacedModule(picked)
      else st.setNotice(msg('no_floor_marking_to_erase_here'))
      return
    }
    if (st.moduleType === 'bridge') {
      const src = railModuleAtPlatform(st.station, ...hit.cell) ?? railModuleAtPlatform(st.station, ...hit.place)
      if (!src) { st.setNotice(msg('select_existing_track_first_the_bridge_connects_to_its_end')); return }
      if (info.button === 2) { st.removeRail(src.id); return }
      const bridge = makeBridge(src, freeTunnelEnd(st.station, src, hit.cell), st.bridgeLength, nextModuleId(st.station.modules, 'track'), st.bridgeRailing)
      const next = commitTrack(st.station, bridge)
      if (next === st.station) {
        const block = trackBlockReason(st.station, bridge)
        const colliders = trackColliders(st.station, bridge)
        st.setNotice(
          block
            ? trackBlockNotice(st.station, bridge, block)
            : colliders.length > 0
              ? msg('cannot_place_bridge_blocked_by_value', blockerLabels(colliders))
              : msg('cannot_place_bridge_check_its_height_and_obstacles_along_the_rou'),
        )
        return
      }
      st.commit(next)
      return
    }
    if (st.moduleType.startsWith('pillar')) {
      const old = pillarAt(st.station.modules, ...hit.cell, st.station.levelBase, st.station.storeyHeight)
      if (old && info.button !== 2) {
        const grown = extendedPillar(old, st.pillarLength)
        const others = st.station.modules.filter((m) => m.id !== old.id)
        const colliders = placementColliders(others, grown)
        const refusal = equipmentReason(st.station.cells, others, grown, true)
        if (refusal) {
          st.setNotice(equipmentRefusalNotice(refusal, colliders))
          scene.setCollisionHighlight(colliders.length > 0 ? colliders.map((m) => m.id) : null)
          return
        }
        st.commit({ ...st.station, modules: st.station.modules.map((m) => m.id === old.id ? grown : m) })
        return
      }
    }
    // A fence (围栏) drags out a run like the 墙 tool: press to anchor, drag
    // for a straight 90° line whose panels follow the drag direction, release
    // to lay one panel per cell. A quick tap stays a single panel with the R
    // rotation. Right-drag lifts the run back out, one panel at a time.
    if (isFenceType(st.moduleType)) {
      const mode: 'add' | 'remove' = info.button === 2 ? 'remove' : 'add'
      // A fence stands on floor like any equipment: pressing void is a `floor`
      // refusal, not a silent no-op.
      if (mode === 'add' && !hit.solid) {
        st.setNotice(equipmentRefusalNotice('floor'))
        return
      }
      info.preventDefault()
      this.ctx.drag.current = {
        active: true,
        button: info.button,
        mode,
        anchor: hit.cell,
        z: hit.cell[2],
        shift: false,
        fence: true,
        sx: info.clientX,
        sy: info.clientY,
        downTime: performance.now(),
      }
      if (mode === 'add') {
        const { mods, blocked, colliderIds } = this.fenceRunPreview([hit.cell], st.moduleRot)
        scene.setGhost([], 'add')
        scene.setModulePreview(null)
        scene.setFencePreview(mods, blocked)
        scene.setCollisionHighlight(blocked ? colliderIds : null)
        scene.setCursor(hit.cell, !blocked)
      } else {
        scene.setFencePreview(null)
        scene.setCollisionHighlight(null)
        scene.setGhost([hit.cell], 'remove')
        scene.setCursor(hit.cell, true)
      }
      return
    }
    // 电梯 is special: clicking any cell of an existing shaft extends it, even
    // where that level has no floor (a shaft may run past a floorless storey).
    // A fresh lift still needs solid floor under its 2 × 2 footprint, which
    // `placeLift` checks. Right-click removes the shaft.
    if (st.moduleType === 'lift') {
      if (info.button === 2) {
        this.bulldoze(hit.cell, hit.place, this.facing())
        return
      }
      const shaft = liftAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2], st.station.levelBase, st.station.storeyHeight)
      if (shaft || hit.solid) this.placeLift(hit)
      else st.setNotice(equipmentRefusalNotice('lift-footprint'))
      return
    }
    if (info.button === 2) {
      // Use the drawn module under the pointer first. Wall/ceiling fixtures and
      // tall equipment often sit above a void, wall, or rail cell, where the
      // grid cell alone can identify the wrong object (or none at all).
      if (isDecorType(st.moduleType)) {
        const pointed = deletionTarget(st.station.modules, this.pickModuleAt(info), hit.cell, this.facing(), st.station.levelBase, st.station.storeyHeight)
        if (pointed && pointed.type !== 'shop' && pointed.type !== 'booth' && pointed.type !== 'retail') {
          this.removePlacedModule(pointed)
          return
        }
        const room = facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
        st.setNotice(room ? msg('remove_shelves_one_at_a_time_point_at_a_shelf_and_right_click') : msg('no_decoration_to_remove_here'))
        return
      }
      const pointed = deletionTarget(st.station.modules, this.pickModuleAt(info), hit.cell, this.facing(), st.station.levelBase, st.station.storeyHeight)
      if (pointed) {
        this.removePlacedModule(pointed)
        return
      }
      this.bulldoze(hit.cell, hit.place, this.facing())
      return
    }
    // An exit can be placed by picking the stair/escalator it should enclose;
    // the ramp's upper landing supplies the bay position and orientation.
    const targetRamp = pickedRamp
    if (targetRamp) {
      this.placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1]], targetRamp)
      return
    }
    // Wall/ceiling mounts are placed from their backing surface, so the pointer
    // may be in open air even though the hover has resolved a valid wall or slab.
    // Let their placement checks decide; floor-standing equipment still needs
    // an actual solid floor hit — and a press on void says so instead of
    // dropping the click in silence.
    const directCoverPick = pickedCoverTarget?.type === 'platform-edge' || pickedCoverTarget?.type === 'psd-end'
    if (!hit.solid && !directCoverPick && !canPlaceWithoutFloorHit(st.moduleType)) {
      st.setNotice(equipmentRefusalNotice('floor'))
      return
    }
    this.placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1]], undefined, pickedCoverTarget)
  }

  onMove(info: PointerInfo): void {
    if (useStore.getState().moduleType === 'road' || this.ctx.drag.current?.road) { new RoadTool(this.ctx).onMove(info); return }
    if (useStore.getState().moduleType.startsWith('tactile-') || this.ctx.drag.current?.tactile) { new TactileTool(this.ctx).onMove(info); return }
    if ((useStore.getState().moduleType.startsWith('roof') || useStore.getState().moduleType === 'stair-block' || useStore.getState().moduleType === 'sidewalk' || useStore.getState().moduleType === 'lawn') || this.ctx.drag.current?.roof) { new TileEquipmentTool(this.ctx).onMove(info); return }
    const scene = this.ctx.scene()
    if (!scene) return
    const signAim = useStore.getState().moduleType === 'sign-wall'
      ? boothSignAim(scene, useStore.getState().station.modules, info.clientX, info.clientY)
      : undefined
    this.signBoothId = signAim?.booth.id ?? null
    const hit = useStore.getState().moduleType === 'bridge'
      ? this.bridgePointerHit(info)
      : signAim
      ? boothSignHitOf(signAim)
      : info.hit
    const st = useStore.getState()
    const pickedCoverId = st.moduleType === 'psd-end-cover'
      ? this.ctx.pickModule(info.clientX, info.clientY, true)
      : null
    if (!hit) {
      const coverTarget = pickedCoverId ? st.station.modules.find((m) => m.id === pickedCoverId) : undefined
      if (coverTarget?.type === 'platform-edge' || coverTarget?.type === 'psd-end') {
        this.ctx.hover.current = {
          cell: [coverTarget.x, coverTarget.y, coverTarget.z],
          place: [coverTarget.x, coverTarget.y, coverTarget.z],
          solid: false,
          moduleId: coverTarget.id,
        }
        this.refreshHover()
        return
      }
      const targetRamp = isHeadHouseExitType(st.moduleType) ? this.pickSnapRamp(info) : undefined
      if (targetRamp) {
        const upper = targetRamp.from.z >= targetRamp.to.z ? targetRamp.from : targetRamp.to
        this.ctx.hover.current = {
          cell: [upper.x, upper.y, upper.z],
          place: [upper.x, upper.y, upper.z],
          solid: false,
          moduleId: targetRamp.id,
        }
        this.refreshHover()
      } else {
        this.ctx.hover.current = null
        scene.setModulePreview(null)
        scene.setCursor(null)
        scene.setCollisionHighlight(null)
      }
      return
    }
    // An in-progress fence drag previews the straight run the release would
    // lay — one panel per cell, snapped to the dominant axis like the wall —
    // as real translucent fence models, with the existing runs rebuilt so an
    // end you drag up to loses its cap live.
    const d = this.ctx.drag.current
    if (d?.active && d.fence) {
      const target: [number, number, number] = [hit.cell[0], hit.cell[1], d.z]
      // Only a deliberate press becomes a run; a quick press stays one panel.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const cursor = dragging ? target : d.anchor
      if (d.mode === 'add') {
        const count = dragging ? dragCellCount(d.anchor, target, true) : 1
        const over = this.multiPlace.check(count)
        scene.setCursor(cursor, !over)
        const lineKey = [...d.anchor, ...target, d.z, st.moduleType, st.moduleRot, st.stationEpoch].join(':')
        if (over) {
          // Count first, then build the red run on the shared 50 ms cadence.
          // The accepted fence preview is cleared immediately so the
          // player never reads a shorter run as the one about to be laid.
          this.multiPlace.deferRefusal(scene, lineKey, () => {
            if (this.ctx.drag.current !== d) return
            const sceneNow = this.ctx.scene()
            if (!sceneNow) return
            const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
            this.multiPlace.refuse(sceneNow, line, cursor)
          })
          return
        }
        this.multiPlace.setNotice(false)
        if (count > 1) {
          this.multiPlace.deferPreview(scene, lineKey, () => {
            if (this.ctx.drag.current !== d) return
            const line = straightLineCells(d.anchor, target, d.z)
            const rot = this.fenceRunRotation(line)
            const { mods, blocked, colliderIds } = this.fenceRunPreview(line, rot)
            const sceneNow = this.ctx.scene()
            sceneNow?.setFencePreview(mods, blocked)
            sceneNow?.setCollisionHighlight(blocked ? colliderIds : null)
            sceneNow?.setCursor(line[line.length - 1] ?? cursor, !blocked)
          })
          return
        }
        this.cancelPreview()
        const line = [d.anchor]
        const rot = this.fenceRunRotation(line)
        const { mods, blocked, colliderIds } = this.fenceRunPreview(line, rot)
        scene.setGhost([], 'add')
        scene.setModulePreview(null)
        scene.setFencePreview(mods, blocked)
        scene.setCollisionHighlight(blocked ? colliderIds : null)
        scene.setCursor(d.anchor, !blocked)
      } else {
        // Preview exactly the fence panels the release would lift.
        const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
        const seen = new Set<string>()
        const cells: Array<[number, number, number]> = []
        for (const [x, y, z] of line) {
          const mod = st.station.modules.find((m) => m.type === 'fence' && m.x === x && m.y === y && m.z === z)
          if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
          seen.add(mod.id)
          cells.push([mod.x, mod.y, mod.z])
        }
        scene.setFencePreview(null)
        scene.setCollisionHighlight(null)
        scene.setGhost(cells, 'remove')
        scene.setCursor(dragging ? line[line.length - 1] : d.anchor, true)
      }
      return
    }
    // Equipment stands on the floor block under the pointer, so the highlight
    // snaps to that tile instead of floating a metre above it, and a
    // translucent copy of the module shows exactly what the click will place.
    // Bare void and a clash with existing equipment both flag red.
    scene.setFencePreview(null)
    this.ctx.hover.current = {
      cell: hit.cell,
      place: hit.place,
      solid: hit.solid,
      moduleId: st.moduleType === 'psd-end-cover'
        ? pickedCoverId
        : isHeadHouseExitType(st.moduleType) ? this.pickSnapRamp(info)?.id ?? null : null,
      point: [hit.point[0], hit.point[1]],
    }
    this.refreshHover()
  }

  onUp(info: PointerInfo): void {
    this.cancelPreview()
    if (useStore.getState().moduleType === 'road' || this.ctx.drag.current?.road) { new RoadTool(this.ctx).onUp(info); return }
    if (this.ctx.drag.current?.tactile) { new TactileTool(this.ctx).onUp(info); return }
    if (this.ctx.drag.current?.roof) { new TileEquipmentTool(this.ctx).onUp(info); return }
    // The viewport routes only 围栏 runs here; any other drag release belongs
    // to its own tool. A fence run lays (or lifts) one panel per cell.
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
    const st = useStore.getState()
    // A 围栏 drag lays one panel per cell along a straight axis-aligned run;
    // a quick press is one panel with the R rotation. The run's panels follow
    // the drag direction, and the right drag lifts the same run back out.
    const lineTarget: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], d.z] : d.anchor
    // Count the run before allocating its cells. An over-budget fence is
    // refused whole: no panel on the line is laid and nothing is clipped.
    const panels = rect ? dragCellCount(d.anchor, lineTarget, true) : 1
    if (d.mode === 'add' && panels > this.multiPlace.limit) {
      this.multiPlace.setNotice(true)
      return
    }
    if (d.mode === 'add') this.multiPlace.setNotice(false)
    const line = rect ? straightLineCells(d.anchor, lineTarget, d.z) : [d.anchor]
    if (d.mode === 'add') {
      // The panel follows the run's own span. Using the run cells (not the
      // press cell against the sorted end) keeps a run laid toward −x/−y from
      // turning crosswise; a single cell keeps the R rotation.
      const rot = this.fenceRunRotation(line)
      let next = st.station
      let placed = 0
      let blocked = 0
      // Why the first refused cell was refused, so the notice names it instead of
      // leaving the player to guess which rule fired (a void cell, a rail bed, or
      // the piece already holding the space — a staircase's treads included).
      let why = ''
      const seen = new Set<string>()
      for (const [x, y, z] of line) {
        const k = cellKey(x, y, z)
        if (seen.has(k)) continue
        seen.add(k)
        const mod = createModule(st.moduleType, x, y, z, nextModuleId(next.modules, 'fence'), rot)
        if (!mod) continue
        // A fence stands on floor like any equipment, and is refused by the one
        // verdict every other piece answers to (`equipmentReason`), which already
        // says "no floor here" as `floor`.
        const refusal = equipmentReason(next.cells, next.modules, mod)
        if (refusal !== '') {
          blocked++
          why ||= equipmentRefusalNotice(refusal, placementColliders(next.modules, mod))
          continue
        }
        next = addEquipment(next, mod)
        placed++
      }
      if (placed > 0) st.commit(next)
      if (blocked > 0) {
        st.setNotice(
          placed > 0
            ? msg('placed_value_fence_sections_value_cells_blockedvalue', placed, blocked, why ? `（${why}）` : '')
            : msg('cannot_place_a_fence_here_value', why || msg('choose_another_location')),
        )
      }
    } else {
      const seen = new Set<string>()
      let next = st.station
      let removed = 0
      for (const [x, y, z] of line) {
        const mod = next.modules.find((m) => m.type === 'fence' && m.x === x && m.y === y && m.z === z)
        if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
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
    }
  }

  /**
   * The fence panels a drag run would place: one 1 m panel per cell, all at the
   * run's rotation, skipping cells that are not floor or already occupied. The
   * result drives the live fence preview; `blocked` is true when any cell of the
   * run was refused, so the whole ghost flags red, and `colliderIds` names the
   * placed modules the refused panels hit.
   */
  private fenceRunRotation(line: Array<[number, number, number]>): number {
    const st = useStore.getState()
    const axis = fenceRotForLine(line)
    if (axis === null) return st.moduleRot
    // An offset barrier has two distinct sides along the same run axis. Keep
    // the R-selected half-turn while the drag chooses the run's axis (§5.4).
    return axis + (st.moduleType.startsWith('noise-barrier') && st.moduleRot >= 2 ? 2 : 0)
  }

  private fenceRunPreview(line: Array<[number, number, number]>, rot: number): { mods: Module[]; blocked: boolean; colliderIds: string[] } {
    const st = useStore.getState()
    const mods: Module[] = []
    let blocked = false
    const colliderIds: string[] = []
    const seen = new Set<string>()
    for (const [x, y, z] of line) {
      const k = cellKey(x, y, z)
      if (seen.has(k)) continue
      seen.add(k)
      const mod = createModule(st.moduleType, x, y, z, 'preview', rot)
      if (!mod) continue
      // The same verdict the release asks, so the red run under the drag is the run
      // the release refuses.
      const check = checkModulePlacements(st.station, [{ id: mod.id, module: mod }])
      if (check.refused.size > 0) {
        blocked = true
        for (const id of check.colliderIds) if (!colliderIds.includes(id)) colliderIds.push(id)
        continue
      }
      mods.push(mod)
    }
    return { mods, blocked, colliderIds }
  }

  /**
   * The shaft a 电梯 hover would extend. A hover in the same column as a placed
   * shaft grows it a storey — upper half up, lower half down — instead of
   * dropping a second piece. Extending never checks for floor: a shaft may run
   * past a level that has no slab (it just has no landing there).
   *
   * The shaft is found from its own 2 × 2 column (`liftAt`), not from the first
   * module whose envelope covers the cell: a canopy roof or a stair's turn
   * envelope spans the plan without occupying the shaft, and a generic `moduleAt`
   * answers one of those whenever it is earlier in the document, so the snap
   * silently never fires. Hover and release ask the same resolver.
   */
  private liftHover(x: number, y: number, z: number): { mod: LiftModule } | null {
    const st = useStore.getState()
    const shaft = liftAt(st.station.modules, x, y, z, st.station.levelBase, st.station.storeyHeight)
    if (!shaft) return null
    const lo = Math.min(shaft.from.z, shaft.to.z)
    const hi = Math.max(shaft.from.z, shaft.to.z)
    // The midpoint belongs to the upper half, so hovering the exact middle of a
    // two-storey shaft grows it up rather than down.
    const up = z >= (lo + hi) / 2
    return { mod: up ? liftExtendedUp(shaft, st.liftInterval) : liftExtendedDown(shaft, st.liftInterval) }
  }

  /**
   * A straight ramp type: the pieces an exit bay can hold, and the pieces that
   * carry the run-length variants. A turning stair is
   * excluded — its run does not end at the bay, so snapping it would not line
   * its landing up with the hole.
   */
  private isStraightRamp(type: string): boolean {
    return type === 'escalator' || type === 'stair' || type === 'stair-straight'
  }

  /**
   * The length a hovered run would be built at: the armed one-floor setting for a
   * stair and a 单层 扶梯 (both carry 超长 6 m), and — for a 扶梯 — the family its
   * 单层 / 双层 span selected. A type with no run reads the one-floor default only
   * so the caller has something to hold.
   */
  private rampLengthFor(type: string): RampLength {
    const st = useStore.getState()
    if (type === 'escalator') return st.escalatorSpan === 'double' ? st.doubleRampLength : st.rampLength
    return isStairType(type) ? st.rampLength : RAMP_LENGTH_DEFAULT
  }

  /**
   * The rise and run an exit-bay snap descends at for the armed type: the piece's
   * own length on the station's own grid, exactly as `buildPlacementModule` builds
   * it. The hover must ask the same question the release does, or a bay the ghost
   * says the run will snap into is built unsnapped (and the other way round).
   */
  private rampSnapSpec(type: string): RampLengthSpec {
    const st = useStore.getState()
    const length = this.rampLengthFor(type)
    return type === 'escalator'
      ? escalatorLengthSpec(length, st.station.storeyHeight, st.escalatorSpan)
      : stairLengthSpec(length)
  }

  /**
   * Build the module a pointer at `cell` would place. A straight stair or
   * escalator dropped inside an exit head-house snaps into a bay: its upper
   * landing on the street in the column under the pointer, its base the chosen
   * rise down toward the mouth, so
   * the pointer positions the run on the top floor the exit opens onto rather
   * than the floor it climbs from. Everywhere else the cell is the base.
   */
  private buildPlacementModule(type: string, cell: [number, number, number], id: string, targetRamp?: Module, psdCoverSupport?: Module): Module | null {
    const st = useStore.getState()
    const placementType = type.startsWith('door-')
      ? type.replace(/-[12]$/, st.doorWide ? '-2' : '-1')
      : type === 'tv-double' ? 'tv'
      : type
    let mod: Module | null
    if (type === 'walkway') {
      // A 自动步道 is level, so it never snaps into an exit bay (whose run descends a
      // storey): the cell is its near landing, the run runs along the placement
      // rotation, and `st.walkwayLength` picks 短 30 m / 中 60 m / 长 90 m. Width and
      // direction are the shared escalator settings.
      mod = walkwayModule(
        { x: cell[0], y: cell[1], z: cell[2] },
        st.moduleRot,
        st.escalatorDir,
        id,
        st.escalatorWide ? 2 : 1,
        st.walkwayLength,
      )
    } else if (this.isStraightRamp(type)) {
      const width = type === 'escalator' ? (st.escalatorWide ? 2 : 1) : st.stairWidth
      // The piece's own length decides both the bay snap's descent and the run
      // that is built, so a 超短 / 短 / 中 / 长 / 超长 piece snaps to the floor its
      // own rise reaches instead of always to the storey below. Both a 楼梯 and a
      // 单层 扶梯 take the shared 超长 6 m rung.
      const length = this.rampLengthFor(type)
      const spec = this.rampSnapSpec(type)
      const snap = exitRunSnap(st.station.modules, cell[0], cell[1], cell[2], spec.run, spec.rise)
      mod = type === 'escalator'
        ? escalatorModule(snap ? snap.base : { x: cell[0], y: cell[1], z: cell[2] }, snap ? snap.rot : st.moduleRot, st.escalatorDir, id, st.escalatorWide ? 2 : 1, length, st.station.storeyHeight, st.escalatorSpan)
        : snap
          ? createModule(type, snap.base.x, snap.base.y, snap.base.z, id, snap.rot, width, st.escalatorDir, 'lane', [], undefined, { rampLength: length, storeyHeight: st.station.storeyHeight })
          : createModule(type, cell[0], cell[1], cell[2], id, st.moduleRot, width, st.escalatorDir, 'lane', [], undefined, { rampLength: length, storeyHeight: st.station.storeyHeight })
    } else {
      // `st.gateDoor` rides along like the escalator direction: the 闸机's door
      // side is a tool setting, cycled with Tab, and lands in the piece's
      // `cfg.door` (every other type ignores it). The last two arguments are only
      // read by a 指示牌: the station's own lines, so a bare board still wears the
      // player's 1号线 shield, and the **current** boards, so the sign is hung with
      // the pair the editor is showing. A turning 楼梯 reads `rampLength` — every
      // staircase climbs a chosen rise, straight or not — and a 电梯 its interval.
      mod = createModule(
        placementType,
        cell[0],
        cell[1],
        cell[2],
        id,
        st.moduleRot,
        type === 'curtain-wall' ? st.curtainWidth : type === 'hanger-roof' || type === 'hanger-post' ? st.hangerLength : st.stairWidth,
        st.escalatorDir,
        st.gateDoor,
        st.station,
        st.currentBoards,
        {
          curtainHeight: st.curtainHeight,
          storeyHeight: st.station.storeyHeight,
          levelBase: st.station.levelBase,
          rampLength: st.rampLength,
          escalatorSpan: st.escalatorSpan,
          liftInterval: st.liftInterval,
        },
      )
    }
    if (mod?.type === 'pillar') mod.cfg.height = st.pillarLength
    // Fit a door into the curtain panel under the pointer. Use the curtain's
    // own axis and edge as the snap frame, then clamp a double door to its run.
    if (mod?.type === 'door') {
      const curtain = st.station.modules.find((placed) => placed.type === 'glass'
        && placed.z === cell[2]
        && glassStandsOnFloor(glassModuleSpec(placed.cfg?.variant, placed.cfg?.curtainHeight))
        && glassCells(placed).some(([x, y]) => x === cell[0] && y === cell[1]))
      if (curtain?.type === 'glass') mod = snapDoorToCurtain(mod, curtain, [cell[0], cell[1]])
    }
    if (mod?.type === 'guidepost') {
      const exit = st.station.modules.find((m) => m.type === 'exit' && m.id === st.guideExitId) ?? st.station.modules.find((m) => m.type === 'exit');
      mod.cfg.exitId = exit?.id;
    }
    if (mod?.type === 'psd-end') {
      if (mod.cfg.variant === 'cover') {
        mod = snapPsdEndCover(mod, st.station.modules, st.station.lines, psdCoverSupport?.id)
      } else {
        mod.cfg.psd = st.psdEndHeight
        mod = snapPsdEnd(mod, st.station.modules, st.station.lines)
      }
    }
    if (mod?.type === 'lift') mod.cfg.style = st.liftStyle
    if (mod?.type === 'light') mod.cfg.position = st.lightPosition
    if (mod?.type === 'exit' && targetRamp) mod = snapExitToRamp(mod, targetRamp) ?? mod
    // The ghost and the eventual commit share this prospective id. Ads freeze their
    // campaign from that id when placed, so carry the same poster in the preview.
    if (mod?.type === 'billboard' && mod.cfg.poster === undefined) {
      mod.cfg.poster = randomAdSlug(mod)
    }
    if (mod?.type === 'floor-mark') {
      if (mod.cfg.variant === 'direction') mod.cfg.line = st.station.lines.find((l) => l.id === st.railLineId)?.id || st.station.lines.find((l) => l.id === '5')?.id || st.station.lines[0]?.id || '5'
      mod = snapBoardingMark(mod, st.station.modules, st.station.lines)
    }
    // A sign whose board is open in the editor draws the board being arranged.
    if (mod) mod = signModuleWithPreview(mod, st.signPreview)
    // A fresh exit letters itself A ~ Z rather than wearing the 未命名口
    // placeholder, so the card and the 3D header read like real signage. A 虚拟
    // exit takes the bare letter (`C`, not `C口`), matching the pillar it reuses.
    if (mod && mod.type === 'exit' && mod.cfg.name === msg('unnamed_exit')) {
      mod.cfg.name = mod.cfg.style === 'virtual'
        ? (nextExitLetter(st.station.modules) ?? msg('unnamed_exit'))
        : nextExitName(st.station.modules)
    }
    if (mod && mod.type !== 'hanger' && isCeilingHung(mod)) mod = {
      ...mod, ceilingAnchored: topBlockOver(st.station.cells, mod, st.station.modules) || undefined,
    }
    return mod
  }

  /** The visible rail can sit above the floor that the block picker sees. */
  private bridgePointerHit(info: PointerInfo): PointerInfo['hit'] {
    const picked = this.ctx.scene()?.pickModuleHit(info.clientX, info.clientY)
    const modules = useStore.getState().station.modules
    const pointed = picked ? modules.find((m) => m.id === picked.moduleId) : undefined
    const track = pointed?.type === 'track' ? pointed
      : pointed?.type === 'platform-edge' ? modules.find((m) => m.type === 'track' && m.id === pointed.cfg.from)
      : undefined
    if (!picked || track?.type !== 'track') return info.hit
    // Project onto the owning bed, retaining the hovered half even when a
    // screen-door frame overhangs its platform floor.
    const [i] = rotateLocal(-(track.rot ?? 0), Math.floor(picked.point[0]) - track.x, Math.floor(picked.point[1]) - track.y)
    const [dx, dy] = rotateLocal(track.rot, Math.max(0, Math.min(track.w - 1, i)), 0)
    const cell: [number, number, number] = [track.x + dx, track.y + dy, track.z]
    return { cell, place: cell, point: picked.point, normal: [0, 0, 1], solid: false }
  }

  /** Preview and commit both place one complete module at every stair width. */
  private pickSnapRamp(info: PointerInfo): Extract<Module, { type: 'stair' | 'escalator' }> | undefined {
    const modules = useStore.getState().station.modules
    const pickedId = this.pickModuleAt(info)
    const direct = modules.find((m) => m.id === pickedId)
    if (isSnapRamp(direct)) return direct
    // Stair treads are separated, so a ray can hit the floor in the visible
    // stair footprint. Resolve only eligible straight ramps against their model
    // bounds as a fallback; the renderer still rejects hidden or occluded roots.
    const candidates = modules.filter(isSnapRamp)
    if (candidates.length === 0) return undefined
    const id = this.ctx.scene()?.pickModuleInBounds(
      info.clientX,
      info.clientY,
      new Set(candidates.map((mod) => mod.id)),
    )
    return candidates.find((mod) => mod.id === id)
  }

  /** Preview and commit both place one complete module at every stair width. */
  private buildPlacementModules(type: string, cell: [number, number, number], id: string, targetRamp?: Module): Module[] {
    if (type === 'tv-double') {
      const first = this.buildPlacementModule('tv-double', cell, id, targetRamp)
      if (first?.type !== 'tv') return []
      const secondId = nextModuleId([...useStore.getState().station.modules, first], 'tv-double')
      const second = this.buildPlacementModule('tv-double', cell, secondId, targetRamp)
      if (second?.type !== 'tv') return []
      second.rot = ((first.rot ?? 0) + 2) % 4
      return [first, second]
    }
    const one = this.buildPlacementModule(type, cell, id, targetRamp)
    return one ? [one] : []
  }

  /** A direct screen pick lays one cover over every tile in that screen run. */
  private buildPsdEndCoverModules(cell: [number, number, number], direct?: Module): Module[] {
    const st = useStore.getState()
    const cells = direct?.type === 'platform-edge'
      ? edgeCells(direct)
      : direct?.type === 'psd-end' ? [[direct.x, direct.y, direct.z] as [number, number, number]] : [cell]
    const mods: Module[] = []
    for (const target of cells) {
      const id = nextModuleId([...st.station.modules, ...mods], 'psd-end-cover')
      const mod = this.buildPlacementModule('psd-end-cover', target, id, undefined, direct)
      if (!mod) continue
      // A run click fills uncovered cells. Existing covers at the same course
      // already satisfy that tile, so they are not a placement collision.
      const alreadyCovered = !!direct && st.station.modules.some((placed) => placed.type === 'psd-end' &&
        placed.cfg.variant === 'cover' && mod.type === 'psd-end' && placed.cfg.support === mod.cfg.support &&
        placed.x === mod.x && placed.y === mod.y && placed.z === mod.z)
      if (!alreadyCovered) mods.push(mod)
    }
    return mods
  }

  /**
   * The billboard a wall-mounted hover would place. Normally it stands on the
   * hovered floor cell; a hover on a wall itself (e.g. the station wall across
   * the track, behind the screen doors) stands the panel in the face-adjacent
   * `place` cell instead — so an ad can be fixed to a wall that has no walkable
   * floor in front of it.
   *
   * The panel is then **turned to face its wall** (`autofaceWallMount`): a poster
   * bolted flat to a wall has exactly one correct orientation, so the player never
   * has to press R to match the wall before the tool agrees. The shared placement
   * validator decides whether that candidate has backing.
   */
  private wallMountPlacement(
    cell: [number, number, number],
    place: [number, number, number],
    id: string,
    near?: readonly [number, number],
  ): Module | null {
    const st = useStore.getState()
    const groundExit = st.moduleType.startsWith('exit-doorway-')
    // A 玻璃板 is cladding from its base, so it **hangs over the course the pointer is
    // on** rather than always at the storey floor (`wallMountFollowsCourse`): aim at a
    // wall's third course and the window covers the third course.
    const at = moduleAim(st.station, st.moduleType, { cell, place, solid: true })
    const hitBlock = st.station.cells.some((block) => block.fill === 'solid'
      && block.x === cell[0] && block.y === cell[1] && block.z === cell[2])
    const snappedRot = groundExit && hitBlock
      ? wallRotationForSide(cell[0] - at[0], cell[1] - at[1])
      : null
    // The piece is built the way the hung one is — the tool's own settings, and for a
    // 指示牌 the station's lines and the **current** boards, so a wall board hung while
    // its editor is open carries what is on screen and a bare one still wears the
    // player's 1号线 shield.
    const draft = createModule(
      st.moduleType,
      at[0],
      at[1],
      at[2],
      id,
      snappedRot ?? st.moduleRot,
      st.stairWidth,
      st.escalatorDir,
      st.gateDoor,
      st.station,
      st.currentBoards,
    )
    if (!draft) return null
    if (groundExit && hitBlock && draft.type === 'exit') draft.cfg.mountZ = cell[2]
    if (draft.type === 'billboard' && draft.cfg.poster === undefined) {
      draft.cfg.poster = randomAdSlug(draft)
    }
    // A wall 指示牌 whose board is open in the editor draws the board being arranged.
    const printed = signModuleWithPreview(draft, st.signPreview)
    const snapped = printed.type === 'sign' && near
      ? snapSignToBooth(st.station.modules, printed, near, cell[2], this.signBoothId ?? undefined)
      : printed
    // The wall the panel hangs on is the one the camera is looking at
    // (`autofaceWallMount`) — except for a 地面出入口, which is a shallow sign on the
    // **block face the pointer clicked** (`snappedRot`, and its `cfg.mountZ` names that
    // course): the view can see the block, but it cannot know which one was aimed at,
    // and a floor cell beside the piece backs a panel just as well.
    const mod = autofaceWallMount(
      st.station.cells,
      snapped,
      near,
      st.station.modules,
      snappedRot === null ? this.facing() : undefined,
    )
    return mod
  }

  /**
   * The hung piece a ceiling-hover would place. The pointer may be on the floor
   * below, on the ceiling slab overhead, or on a wall course between them —
   * `ceilingMountStandCell` resolves all three to the floor the piece hangs over,
   * so a 指示牌 is aimed at the ceiling the way a 广告牌 is aimed at its wall.
   */
  private ceilingPlacement(
    cell: [number, number, number],
    place: [number, number, number],
    id: string,
  ): Module[] {
    const st = useStore.getState()
    const at = moduleAim(st.station, st.moduleType, { cell, place, solid: true })
    return this.buildPlacementModules(st.moduleType, at, id)
  }

  /**
   * Rebuild the equipment hover ghost from the last hovered tile. Only the
   * equipment tool has one: the 方块 tool keeps the same hover ref for its own
   * ghost, and a Tab in *that* tool must not drop a piece into the station
   * (`placementPreviewKey` names the settings of both).
   */
  override refreshHover(): void {
    const st = useStore.getState()
    // The placement settings are shared with the 方块 tool. A cut-mode change
    // can refresh this effect after the tool switch, so never rebuild an
    // equipment ghost unless the equipment tool still owns the pointer (§9.5).
    if (st.tool !== 'module') return
    if (st.moduleType === 'road') { new RoadTool(this.ctx).refreshHover(); return }
    if (useStore.getState().moduleType.startsWith('tactile-') || this.ctx.drag.current?.tactile) { new TactileTool(this.ctx).refreshHover(); return }
    if ((useStore.getState().moduleType.startsWith('roof') || useStore.getState().moduleType === 'stair-block' || useStore.getState().moduleType === 'sidewalk' || useStore.getState().moduleType === 'lawn')) { new TileEquipmentTool(this.ctx).refreshHover(); return }
    const scene = this.ctx.scene()
    const h = this.ctx.hover.current
    if (!scene || !h) return
    const [x, y, z] = h.cell
    const pointed = h.moduleId ? st.station.modules.find((m) => m.id === h.moduleId) : undefined
    const snapRamp = isHeadHouseExitType(st.moduleType) && isSnapRamp(pointed) ? pointed : undefined
    if (snapRamp) {
      const exit = this.buildPlacementModules(st.moduleType, [x, y, z], nextModuleId(st.station.modules, st.moduleType), snapRamp)
      const check = checkModulePlacements(st.station, exit.map((module) => ({ id: module.id, module, layer: true })))
      scene.setCursor(null)
      scene.setModulePreview(exit.length > 0 ? exit : null, exit.length === 0 || check.refused.size > 0)
      scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
      return
    }
    if (st.moduleType === 'bridge') {
      const src = railModuleAtPlatform(st.station, ...h.cell) ?? railModuleAtPlatform(st.station, ...h.place)
      if (!src) { scene.setModulePreview(null); scene.setCursor(null); scene.setCollisionHighlight(null); return }
      const bridge = makeBridge(src, freeTunnelEnd(st.station, src, h.cell), st.bridgeLength, 'preview', st.bridgeRailing)
      const blocked = trackBlockReason(st.station, bridge) !== null
      scene.setModulePreview([bridge, ...bridgePillarCandidates(st.station.cells, st.station.modules, bridge)], blocked)
      scene.setCollisionHighlight(blocked ? trackColliders(st.station, bridge).map((m) => m.id) : null)
      scene.setCursor(null)
      return
    }
    if (st.moduleType.startsWith('pillar')) {
      const old = pillarAt(st.station.modules, ...h.cell, st.station.levelBase, st.station.storeyHeight)
      if (old) {
        const grown = extendedPillar(old, st.pillarLength)
        const others = st.station.modules.filter((m) => m.id !== old.id)
        const colliders = placementColliders(others, grown)
        const blocked = equipmentReason(st.station.cells, others, grown, true) !== ''
        scene.setModulePreview(grown, blocked)
        scene.setCollisionHighlight(colliders.length > 0 ? colliders.map((m) => m.id) : null)
        scene.setCursor(null)
        return
      }
    }
    // An exit lays its own floor: cells it covers count even where a ramp
    // carved a hole, so stairs and escalators can land through an exit.
    const floorHere = h.solid || exitFloorAt(st.station.modules, x, y, z)
    // A surface exit is rooted at the street (h = 0 m): it may not be dropped on
    // a concourse or platform slab.
    // 广告牌 is wall-mounted and may hang over a track (there is no floor in front
    // of a station wall across the rails), so it is resolved from the wall alone.
    // The panel lives **on the wall**: the ghost is the panel itself, so no floor
    // cell is highlighted with it.
    if (isWallMountedType(st.moduleType)) {
      const billboard = this.wallMountPlacement(
        h.cell,
        h.place,
        nextModuleId(st.station.modules, st.moduleType),
        h.point,
      )
      const check = billboard ? checkModulePlacements(st.station, [{ id: billboard.id, module: billboard }]) : null
      // No wall at all is a refusal of its own: a panel has nowhere to bolt.
      const blocked = check === null || check.refused.size > 0
      scene.setCursor(null)
      scene.setModulePreview(billboard, blocked)
      scene.setCollisionHighlight(check && check.colliderIds.length > 0 ? check.colliderIds : null)
      return
    }
    // A hung piece (指示牌 / 电视 / 时钟 / 监控) lives **on the ceiling**: the
    // pointer may be on the floor below, the slab overhead or a wall course
    // between them, and the ghost is the fitting itself — never a floor cell.
    if (isCeilingHung({ type: st.moduleType })) {
      const hung = this.ceilingPlacement(h.cell, h.place, 'preview')
      const check = checkModulePlacements(
        st.station,
        hung.map((module) => ({ id: module.id, module, layer: true })),
      )
      const blocked = hung.length === 0 || check.refused.size > 0
      scene.setCursor(null)
      scene.setModulePreview(hung.length > 0 ? hung : null, blocked)
      scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
      return
    }
    // 电梯: hovering any cell of an existing shaft previews its extension even
    // where that level has no floor; a fresh lift still needs floor under it.
    const liftExt = st.moduleType === 'lift' ? this.liftHover(x, y, z) : null
    // A ramp dropped inside an exit snaps into a bay and descends to the floor
    // below, so the exit's own floor is enough to stand its upper landing on.
    const snapSpec = this.isStraightRamp(st.moduleType) ? this.rampSnapSpec(st.moduleType) : null
    const snap = snapSpec ? exitRunSnap(st.station.modules, x, y, z, snapSpec.run, snapSpec.rise) : null
    const directCoverTarget = st.moduleType === 'psd-end-cover' && (pointed?.type === 'platform-edge' || pointed?.type === 'psd-end')
    const placeable = floorHere || !!liftExt || !!snap || directCoverTarget
    let mods: Module[] = []
    if (st.moduleType === 'lift') {
      if (liftExt) {
        mods = [liftExt.mod]
      } else if (floorHere) {
        const lift = this.buildPlacementModule('lift', [x, y, z], 'preview')
        if (lift) mods = [lift]
      }
    } else if (placeable) {
      mods = st.moduleType === 'psd-end-cover'
        ? this.buildPsdEndCoverModules(h.cell, directCoverTarget ? pointed : undefined)
        : this.buildPlacementModules(st.moduleType, h.cell, nextModuleId(st.station.modules, st.moduleType))
    }
    // **One verdict, one display.** The rules are `build/validation.ts`'s (the same
    // ones the release asks), so a piece is refused here for exactly the reason it
    // would be refused on release — a 扶梯 whose landings are not solid ground, a
    // 电梯 whose bay is not floor, a 指示牌 with no slab overhead — and the refused
    // pieces are boxed in red beside the red ghost.
    const check = checkModulePlacements(
      st.station,
      mods.map((module) => ({ id: module.id, module, layer: true })),
    )
    const blocked = check.refused.size > 0
    scene.setCursor(h.cell, placeable && !blocked)
    scene.setModulePreview(mods.length > 0 ? mods : null, blocked)
    scene.setCollisionHighlight(check.colliderIds.length > 0 ? check.colliderIds : null)
  }

  private placeModule(
    cell: [number, number, number],
    place: [number, number, number],
    solid: boolean,
    type: string,
    near?: [number, number],
    targetRamp?: Module,
    directTarget?: Module,
  ): void {
    const st = useStore.getState()
    if (type === 'psd-end-cover') {
      const mods = this.buildPsdEndCoverModules(cell, directTarget)
      if (mods.length === 0 && directTarget && st.station.modules.some((placed) => placed.type === 'psd-end' &&
        placed.cfg.variant === 'cover' && placed.cfg.support === directTarget.id)) return
      if (mods.length === 0 || mods.some((mod) => mod.type !== 'psd-end')) {
        st.setNotice(equipmentRefusalNotice('floor'))
        return
      }
      for (const mod of mods) {
        const refusal = equipmentReason(st.station.cells, st.station.modules, mod, true)
        if (refusal) {
          st.setNotice(equipmentRefusalNotice(refusal, placementColliders(st.station.modules, mod)))
          return
        }
      }
      st.commit(mods.reduce((state, mod) => addEquipment(state, mod), st.station))
      return
    }
    // A wall-mounted 广告牌 needs only a wall behind it — it may hang over a
    // track, so it goes through the same verdict as everything else and never
    // through the ground rules.
    if (isWallMountedType(type)) {
      // The panel turns itself to face whatever wall backs it, so the only
      // failure left is "there is no wall here at all".
      const mod = this.wallMountPlacement(cell, place, nextModuleId(st.station.modules, type), near)
      if (!mod) {
        st.setNotice(type.startsWith('exit-doorway-')
          ? msg('ground_exits_need_a_solid_block_behind_their_wall_facing_side')
          : equipmentRefusalNotice('wall'))
        return
      }
      const refusal = equipmentReason(st.station.cells, st.station.modules, mod)
      if (refusal !== '') {
        st.setNotice(equipmentRefusalNotice(refusal, placementColliders(st.station.modules, mod)))
        return
      }
      st.commit(addEquipment(st.station, mod))
      return
    }
    // Aim builds the candidate; the same shared verdict used by the hover
    // decides whether its ceiling and occupied space permit the commit.
    if (isCeilingHung({ type })) {
      const mods = this.ceilingPlacement(cell, place, nextModuleId(st.station.modules, type))
      if (mods.length === 0) {
        st.setNotice(equipmentRefusalNotice('ceiling'))
        return
      }
      for (const mod of mods) {
        const refusal = equipmentReason(st.station.cells, st.station.modules, mod, true)
        if (refusal !== '') {
          st.setNotice(equipmentRefusalNotice(refusal, placementColliders(st.station.modules, mod)))
          return
        }
      }
      st.commit(mods.reduce((state, mod) => addEquipment(state, mod), st.station))
      return
    }
    const at = moduleAim(st.station, type, { cell, place, solid })
    const mods = this.buildPlacementModules(type, at, nextModuleId(st.station.modules, type), targetRamp)
    if (mods.length === 0) {
      st.setNotice(msg('cannot_place_equipment_here_choose_another_location'))
      return
    }
    // **One verdict, one refusal.** Every rule a module answers to lives in
    // `build/validation.ts` (which reads `equipmentReason`), so the piece the red
    // ghost refused is the piece this refuses, in the same words — with the
    // conflicting piece named.
    for (const mod of mods) {
      const refusal = equipmentReason(st.station.cells, st.station.modules, mod, true)
      if (refusal !== '') {
        st.setNotice(equipmentRefusalNotice(refusal, placementColliders(st.station.modules, mod)))
        return
      }
    }
    // A wide stair's lanes are one placement: one commit, so one undo puts the
    // whole flight back.
    st.commit(mods.reduce((state, mod) => addEquipment(state, mod), st.station))
    // The boards a 指示牌 was hung with are `currentBoards`, and they stay current:
    // the next sign the player places carries them too, which is the point of
    // composing one.
  }

  /**
   * Place or extend an elevator. A hover in the same column as an existing shaft
   * grows it one storey — up if the hover is in the shaft's upper half, down if
   * below — with no floor check, so a shaft can run past a level that has no
   * slab. Otherwise a fresh two-storey shaft is dropped on the hovered floor.
   */
  private placeLift(hit: { cell: [number, number, number]; place: [number, number, number]; solid: boolean }): void {
    const st = useStore.getState()
    const [x, y, z] = hit.cell
    const shaft = liftAt(st.station.modules, x, y, z, st.station.levelBase, st.station.storeyHeight)
    if (shaft) {
      const lo = Math.min(shaft.from.z, shaft.to.z)
      const hi = Math.max(shaft.from.z, shaft.to.z)
      const up = z >= (lo + hi) / 2
      const grown = up ? liftExtendedUp(shaft, st.liftInterval) : liftExtendedDown(shaft, st.liftInterval)
      const blockers = placementColliders(st.station.modules, grown)
      if (blockers.length > 0) {
        st.setNotice(msg('cannot_extend_the_lift_through_this_floor_blocked_by_value', blockerLabels(blockers)))
        return
      }
      st.commit(extendLift(st.station, shaft.id, up, st.liftInterval))
      st.setNotice(up ? msg('lift_extended_up_one_floor', st.liftInterval) : msg('lift_extended_down_one_floor', st.liftInterval))
      return
    }
    this.placeModule(hit.cell, hit.place, hit.solid, 'lift')
  }
}
