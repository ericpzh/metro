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
  calligraphyOnPillar,
  blockerLabels,
  equipmentReason,
  equipmentRefusalNotice,
  isCeilingHung,
  isWallMounted,
  wallDecorAnchorZ,
  liftAt,
  pillarAt,
  placementColliders,
  glassCells,
  moduleFootprint,
  snapDoorToCurtain,
  topBlockOver,
  wallSide,
  type EquipmentRefusal,
} from '../../sim/placement.ts'
import { checkModulePlacements } from '../../build/validation.ts'
import type { Module } from '../../sim/types.ts'
import { isCounterType } from '../store/catalog.ts'
import { isDecorType, isFenceType, isStairType, isWallMountedType, signModuleWithPreview, supportsLinePlacement, useStore } from '../store.ts'
import { straightLineCells } from './geometry/cells.ts'
import { lineAnchorCount, lineAnchors, lineAxis, lineRunRotation, lineSpan, lineStep, type LineCell } from './geometry/linePlacement.ts'
import { isLineDeletable } from '../../sim/lineDeletion.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { TactileTool } from './TactileTool.ts'
import { TileEquipmentTool } from './TileEquipmentTool.ts'
import { snapBoardingMark } from '../../sim/floorDecor.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'
import type { AreaDrag } from './ToolContext.ts'
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

/** The immutable station document the shared placement verdict reads. */
type StationDoc = ReturnType<typeof useStore.getState>['station']

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
    if (!hit) {
      if (info.button === 2) {
        const pickedId = this.pickModuleAt(info)
        const picked = st.station.modules.find(m => m.id === pickedId)
        if (picked?.type === 'shelf' || picked?.type === 'checkout') this.removePlacedModule(picked)
      }
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
    if (isFenceType(st.moduleType) || st.moduleType === 'court-divider') {
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
        const { mods, blockedCells, colliderIds } = this.fenceRunPreview([hit.cell], st.moduleRot)
        scene.setGhost([], 'add', undefined, undefined, blockedCells)
        scene.setModulePreview(null)
        scene.setFencePreview(mods)
        scene.setCollisionHighlight(colliderIds.length ? colliderIds : null)
        scene.setCursor(hit.cell, blockedCells.length === 0)
      } else {
        scene.setFencePreview(null)
        scene.setCollisionHighlight(null)
        if (st.moduleType === 'court-divider') {
          const mods = st.station.modules.filter(m => this.runModuleAt(m, ...hit.cell))
          scene.setModulePreview(mods, true)
          scene.setGhost([], 'remove')
          scene.setCursor(null)
        } else {
          scene.setGhost([hit.cell], 'remove')
          scene.setCursor(hit.cell, true)
        }
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
    // Every loose 装饰 / 设备 piece lays a line: press, drag along one axis and
    // release to place the row at the rail's 间隔. Right-drag lifts the same row
    // back out (a quick right click still removes just the pointed piece).
    if (supportsLinePlacement(st.moduleType) && info.button === 2) {
      this.beginLineRemove(info, hit)
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
      this.placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1], hit.point[2]], targetRamp)
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
    // A loose 装饰 / 设备 piece is deferred to release so a drag can lay its line:
    // the click is still one piece, and the whole row is one commit (one undo).
    if (supportsLinePlacement(st.moduleType)) {
      this.beginLineAdd(info, hit)
      return
    }
    this.placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1], hit.point[2]], undefined, pickedCoverTarget ?? st.station.modules.find(m => m.id === hit.moduleId))
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
    const activeDrag = this.ctx.drag.current
    if (activeDrag?.decorLine) { this.moveLine(info, activeDrag, hit); return }
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
        const step = this.fenceLineStep(st.moduleType)
        const anchors = dragging ? lineAnchors(d.anchor, target, step) : [d.anchor]
        const count = anchors.length
        const over = this.multiPlace.check(count)
        scene.setCursor(cursor, !over)
        const lineKey = [...d.anchor, ...target, d.z, st.moduleType, st.moduleRot, st.lineSpacing, st.stationEpoch].join(':')
        if (over) {
          // Count first, then build the red run on the shared 50 ms cadence.
          // The accepted fence preview is cleared immediately so the
          // player never reads a shorter run as the one about to be laid.
          this.multiPlace.deferRefusal(scene, lineKey, () => {
            if (this.ctx.drag.current !== d) return
            const sceneNow = this.ctx.scene()
            if (!sceneNow) return
            this.multiPlace.refuse(sceneNow, anchors, cursor)
          })
          return
        }
        this.multiPlace.setNotice(false)
        if (count > 1) {
          this.multiPlace.deferPreview(scene, lineKey, () => {
            if (this.ctx.drag.current !== d) return
            const rot = this.fenceRunRotation(anchors)
            const { mods, blockedCells, colliderIds } = this.fenceRunPreview(anchors, rot)
            const sceneNow = this.ctx.scene()
            sceneNow?.setGhost([], 'add', undefined, undefined, blockedCells)
            sceneNow?.setFencePreview(mods)
            sceneNow?.setCollisionHighlight(colliderIds.length ? colliderIds : null)
            sceneNow?.setCursor(anchors[anchors.length - 1] ?? cursor, blockedCells.length === 0)
          })
          return
        }
        this.cancelPreview()
        const rot = this.fenceRunRotation(anchors)
        const { mods, blockedCells, colliderIds } = this.fenceRunPreview(anchors, rot)
        scene.setGhost([], 'add', undefined, undefined, blockedCells)
        scene.setModulePreview(null)
        scene.setFencePreview(mods)
        scene.setCollisionHighlight(colliderIds.length ? colliderIds : null)
        scene.setCursor(d.anchor, blockedCells.length === 0)
      } else {
        // Preview exactly the fence panels the release would lift.
        const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
        const seen = new Set<string>()
        const cells: Array<[number, number, number]> = []
        const mods: Module[] = []
        for (const [x, y, z] of line) {
          const mod = st.station.modules.find((m) => this.runModuleAt(m, x, y, z))
          if (!mod || seen.has(mod.id)) continue
          seen.add(mod.id)
          cells.push([mod.x, mod.y, mod.z])
          mods.push(mod)
        }
        scene.setFencePreview(null)
        scene.setCollisionHighlight(null)
        if (st.moduleType === 'court-divider') {
          scene.setModulePreview(mods, true)
          scene.setGhost([], 'remove')
          scene.setCursor(null)
        } else {
          scene.setGhost(cells, 'remove')
          scene.setCursor(dragging ? line[line.length - 1] : d.anchor, true)
        }
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
        : isHeadHouseExitType(st.moduleType) ? this.pickSnapRamp(info)?.id ?? null : hit.moduleId ?? null,
      point: [hit.point[0], hit.point[1], hit.point[2]],
    }
    this.refreshHover()
  }

  onUp(info: PointerInfo): void {
    this.cancelPreview()
    if (useStore.getState().moduleType === 'road' || this.ctx.drag.current?.road) { new RoadTool(this.ctx).onUp(info); return }
    if (this.ctx.drag.current?.tactile) { new TactileTool(this.ctx).onUp(info); return }
    if (this.ctx.drag.current?.roof) { new TileEquipmentTool(this.ctx).onUp(info); return }
    if (this.ctx.drag.current?.decorLine) { this.finishLine(info); return }
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
    // A 围栏 drag lays one panel per cell (or one every 间隔 + 1 cells) along a
    // straight axis-aligned run; a quick press is one panel with the R rotation.
    // The run's panels follow the drag direction, and the right drag lifts the
    // same run back out — every cell it crosses, whatever spacing it was laid at.
    const lineTarget: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], d.z] : d.anchor
    const step = this.fenceLineStep(st.moduleType)
    const anchors = rect ? lineAnchors(d.anchor, lineTarget, step) : [d.anchor]
    // Count the run before allocating its cells. An over-budget fence is
    // refused whole: no panel on the line is laid and nothing is clipped.
    if (d.mode === 'add' && anchors.length > this.multiPlace.limit) {
      this.multiPlace.setNotice(true)
      return
    }
    if (d.mode === 'add') this.multiPlace.setNotice(false)
    const line = rect ? straightLineCells(d.anchor, lineTarget, d.z) : [d.anchor]
    if (d.mode === 'add') {
      // The panel follows the run's own span. Using the run cells (not the
      // press cell against the sorted end) keeps a run laid toward −x/−y from
      // turning crosswise; a single cell keeps the R rotation.
      const rot = this.fenceRunRotation(anchors)
      let next = st.station
      let placed = 0
      let blocked = 0
      // Why the first refused cell was refused, so the notice names it instead of
      // leaving the player to guess which rule fired (a void cell, a rail bed, or
      // the piece already holding the space — a staircase's treads included).
      let why = ''
      const seen = new Set<string>()
      for (const [x, y, z] of anchors) {
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
        const mod = next.modules.find((m) => this.runModuleAt(m, x, y, z))
        if (!mod || seen.has(mod.id)) continue
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

  // ---------------------------------------------------------------- line runs

  /**
   * Start the deferred line gesture for a loose 装饰 / 设备 piece. The click no
   * longer commits on the press: a release without a drag still places exactly
   * one piece, while a press-and-drag lays the row at the armed 间隔 — and
   * because the whole row is built on release, it is one commit and one undo.
   *
   * A **touch tap** never receives a release in this viewport, so touch keeps
   * the old press-to-place behaviour (one piece) instead of waiting for an up
   * that will not arrive.
   */
  private beginLineAdd(info: PointerInfo, hit: NonNullable<PointerInfo['hit']>): void {
    const st = useStore.getState()
    if (info.pointerType === 'touch') {
      this.placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1], hit.point[2]])
      return
    }
    const anchor = moduleAim(st.station, st.moduleType, {
      cell: hit.cell,
      place: hit.place,
      solid: hit.solid,
      point: [hit.point[0], hit.point[1], hit.point[2]],
    })
    // A press on a wall **face** carries a course to keep along the row. A floor
    // cell in front of the wall does not: the panel keeps its authored height,
    // exactly as the same click does.
    const wallFace = hit.cell[0] !== hit.place[0] || hit.cell[1] !== hit.place[1]
    const lineWall = isWallMountedType(st.moduleType) && wallFace
      ? this.lineWallAim(st.moduleType, anchor, st.moduleRot, hit.cell[2])
      : undefined
    info.preventDefault()
    this.ctx.drag.current = {
      active: true,
      button: info.button,
      mode: 'add',
      anchor,
      z: anchor[2],
      shift: false,
      decorLine: true,
      lineType: st.moduleType,
      lineDrag: false,
      lineWall,
      linePress: [hit.cell[0], hit.cell[1], hit.cell[2]],
      lineTarget: anchor,
      lineHit: {
        cell: [hit.cell[0], hit.cell[1], hit.cell[2]],
        place: [hit.place[0], hit.place[1], hit.place[2]],
        solid: hit.solid,
        point: [hit.point[0], hit.point[1], hit.point[2]],
        ...(hit.moduleId ? { moduleId: hit.moduleId } : {}),
      },
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    // Until the press becomes a drag, the piece keeps the hover ghost the player
    // was already reading — the same aim, snap and course the click will use.
    this.ctx.hover.current = {
      cell: hit.cell,
      place: hit.place,
      solid: hit.solid,
      moduleId: hit.moduleId ?? null,
      point: [hit.point[0], hit.point[1], hit.point[2]],
    }
    this.refreshHover()
  }

  /**
   * Start a right-drag line delete. A quick right click removes the pointed
   * piece (as it always has); a drag lifts every loose 装饰 / 设备 piece whose
   * footprint crosses the line, whatever 间隔 it was laid at, in one commit.
   *
   * Pieces that own their own teardown (a room, a rail, a structure) keep their
   * single delete: the row never silently folds a 商店's walls or a 楼梯's
   * carved opening into a sweep.
   */
  private beginLineRemove(info: PointerInfo, hit: NonNullable<PointerInfo['hit']>): void {
    const st = useStore.getState()
    const scene = this.ctx.scene()
    if (!scene) return
    const pointed = deletionTarget(st.station.modules, this.pickModuleAt(info), hit.cell, this.facing(), st.station.levelBase, st.station.storeyHeight)
    if (pointed && (pointed.type === 'shop' || pointed.type === 'booth' || pointed.type === 'retail')) {
      // A room is not a loose piece: the decor tool has always said to remove
      // its shelves one at a time, while the equipment tool removed the room
      // itself. Keep each tool's single-click answer here.
      if (isDecorType(st.moduleType)) {
        st.setNotice(msg('remove_shelves_one_at_a_time_point_at_a_shelf_and_right_click'))
        return
      }
      this.removePlacedModule(pointed)
      return
    }
    if (pointed && !isLineDeletable(pointed)) {
      this.removePlacedModule(pointed)
      return
    }
    const anchor: LineCell = pointed ? [pointed.x, pointed.y, pointed.z] : [hit.cell[0], hit.cell[1], hit.cell[2]]
    info.preventDefault()
    this.ctx.drag.current = {
      active: true,
      button: 2,
      mode: 'remove',
      anchor,
      z: anchor[2],
      shift: false,
      decorLine: true,
      linePress: [hit.cell[0], hit.cell[1], hit.cell[2]],
      lineTarget: anchor,
      lineRemoveId: pointed?.id,
      sx: info.clientX,
      sy: info.clientY,
      downTime: performance.now(),
    }
    this.drawLineRemove(anchor, false)
  }

  /** The pointer cell translated into the run's own anchor row. */
  private lineTargetFrom(drag: AreaDrag, cell: readonly [number, number, number]): LineCell {
    const press = drag.linePress ?? drag.anchor
    return [cell[0] + drag.anchor[0] - press[0], cell[1] + drag.anchor[1] - press[1], drag.anchor[2]]
  }

  /** A press has become a deliberate drag, matching the fence and wall runs. */
  private lineDragging(info: PointerInfo): boolean {
    const drag = this.ctx.drag.current
    return !!drag && performance.now() - drag.downTime >= LONG_PRESS_MS && isMoved(drag, info)
  }

  /**
   * The wall face a row mounts on, captured at the press: the panel's own turn
   * from the first candidate and the course the pointer aimed at. A wall row
   * keeps both, so a dragged poster line does not climb or flip at every tile.
   */
  private lineWallAim(type: string, anchor: LineCell, baseRot: number, course: number): AreaDrag['lineWall'] {
    const probe = this.buildLineModules(type, anchor, 'line-wall-probe', baseRot)
    const rot = probe[0]?.rot ?? baseRot
    const [nx, ny] = wallSide(rot)
    return { rot, course, normal: [nx, ny] }
  }

  /**
   * One anchor's modules through the same path its single click takes: wall
   * pieces autoface their backing, hung pieces find their slab, and a floor
   * piece asks `moduleAim` for its cell. `rot` overrides R only for the run's
   * long-axis alignment; a wall mount still answers for itself.
   */
  private buildLineModules(type: string, cell: LineCell, id: string, rot?: number, wall?: AreaDrag['lineWall']): Module[] {
    const st = useStore.getState()
    // A 屏蔽端门's single click snaps to a screen corner, which is the right
    // answer for one piece but would fold every cell of a row onto the same
    // corner. The row lays plain metre-grid end panels; a click still uses the
    // snapped `placeModule` path.
    if (type === 'psd-end') {
      const mod = createModule(type, cell[0], cell[1], cell[2], id, rot)
      if (mod?.type !== 'psd-end') return []
      mod.cfg.psd = st.psdEndHeight
      return [mod]
    }
    if (isWallMountedType(type)) {
      if (wall) {
        // The line anchor is the stand cell; the wall is one step out along the
        // captured face, and the pointed course is what keeps the row at height.
        const wallCell: LineCell = [cell[0] + wall.normal[0], cell[1] + wall.normal[1], wall.course]
        const standCell: LineCell = [cell[0], cell[1], wall.course]
        const near: [number, number, number] = [cell[0] + 0.5, cell[1] + 0.5, wall.course]
        const mod = this.wallMountPlacement(wallCell, standCell, id, near, undefined, type, wall.rot)
        return mod ? [mod] : []
      }
      const mod = this.wallMountPlacement(cell, [cell[0], cell[1], cell[2] + 1], id, undefined, undefined, type, rot)
      return mod ? [mod] : []
    }
    if (isCeilingHung({ type })) {
      return this.ceilingPlacement(cell, [cell[0], cell[1], cell[2] + 1], id, type, rot)
    }
    const at = moduleAim(st.station, type, { cell, place: [cell[0], cell[1], cell[2] + 1], solid: true })
    return this.buildPlacementModules(type, at, id, undefined, rot)
  }

  /**
   * The run's own rotation and pitch. The first piece is built at the R
   * rotation so its footprint can say which way it is long; a piece wider than
   * one tile turns so that long axis follows the drag, and the pitch is that
   * footprint plus the 间隔 (never less than one cell).
   */
  private lineRunSpec(type: string, anchor: LineCell, target: LineCell, wall?: AreaDrag['lineWall']): { rot: number; step: number } {
    const st = useStore.getState()
    const axis = lineAxis(anchor, target)
    const baseRot = wall?.rot ?? st.moduleRot
    const base = this.buildLineModules(type, anchor, 'line-probe', baseRot, wall)
    const rotated = isWallMountedType(type) ? baseRot : lineRunRotation(baseRot, axis, lineSpan(base, 0), lineSpan(base, 1))
    const first = rotated === baseRot ? base : this.buildLineModules(type, anchor, 'line-probe-aligned', rotated, wall)
    return { rot: rotated, step: lineStep(first, axis, st.lineSpacing) }
  }

  /** Build one module list per anchor, with ids unique for the preview and for posters. */
  private lineCandidates(anchors: readonly LineCell[], type: string, rot: number, prefix: string, wall?: AreaDrag['lineWall']): Module[] {
    const out: Module[] = []
    anchors.forEach((cell, index) => {
      const built = this.buildLineModules(type, cell, `${prefix}-${index}`, rot, wall)
      built.forEach((mod, slot) => out.push({ ...mod, id: `${prefix}-${index}-${slot}` }))
    })
    return out
  }

  /**
   * The candidates that may land, in drag order. Each is asked of the same
   * shared verdict the release uses. Candidates are also refused when they
   * overlap a **previously accepted** one: an autofaced row can turn at a wall
   * corner, so a pitch that is right for the first piece is not proof for the
   * rest.
   */
  private lineAccepted(mods: readonly Module[], station: StationDoc): {
    accepted: Module[]
    blockedCells: LineCell[]
    reason: EquipmentRefusal | ''
    colliderIds: string[]
  } {
    const check = checkModulePlacements(station, mods.map((module) => ({ id: module.id, module, layer: true })))
    const used = new Set<string>()
    const blocked = new Set<string>()
    const accepted: Module[] = []
    let reason: EquipmentRefusal | '' = ''
    const block = (module: Module): void => {
      for (const [x, y] of moduleFootprint(module)) blocked.add(`${x},${y},${module.z}`)
    }
    for (const module of mods) {
      const refused = check.refused.get(module.id)
      if (refused !== undefined) {
        reason ||= refused as EquipmentRefusal
        block(module)
        continue
      }
      const cells = moduleFootprint(module).map(([x, y]) => `${x},${y},${module.z}`)
      if (cells.some((key) => used.has(key))) {
        block(module)
        continue
      }
      for (const key of cells) used.add(key)
      accepted.push(module)
    }
    return {
      accepted,
      blockedCells: [...blocked].map((key) => {
        const [x, y, z] = key.split(',').map(Number)
        return [x, y, z] as LineCell
      }),
      reason,
      colliderIds: [...check.colliderIds],
    }
  }

  /** Preview a live add run. `target` is already in the anchor's own row. */
  private drawLineAdd(target: LineCell, dragging: boolean): void {
    const drag = this.ctx.drag.current
    const scene = this.ctx.scene()
    if (!drag?.decorLine || !scene) return
    const st = useStore.getState()
    const type = drag.lineType ?? st.moduleType
    let anchors: LineCell[] = [drag.anchor]
    let rot = st.moduleRot
    if (dragging && (target[0] !== drag.anchor[0] || target[1] !== drag.anchor[1])) {
      const spec = this.lineRunSpec(type, drag.anchor, target, drag.lineWall)
      rot = spec.rot
      anchors = lineAnchors(drag.anchor, target, spec.step)
    }
    const mods = this.lineCandidates(anchors, type, rot, 'line-preview', drag.lineWall)
    const { accepted, blockedCells, colliderIds } = this.lineAccepted(mods, st.station)
    const mounted = isWallMountedType(type) || isCeilingHung({ type })
    scene.setGhost([], 'add', undefined, undefined, blockedCells)
    scene.setModulePreview(accepted.length ? accepted : null, false)
    scene.setCollisionHighlight(colliderIds.length ? colliderIds : null)
    scene.setCursor(mounted ? null : anchors[anchors.length - 1] ?? drag.anchor, blockedCells.length === 0)
  }

  /** The pieces a right-drag line would lift: the pressed one plus every footprint on the line. */
  private lineRemoveModules(drag: AreaDrag, target: LineCell, dragging: boolean): Module[] {
    const st = useStore.getState()
    const cells = dragging ? straightLineCells(drag.anchor, target, drag.anchor[2]) : [drag.anchor]
    const keys = new Set(cells.map(([x, y]) => `${x},${y}`))
    const out: Module[] = []
    const seen = new Set<string>()
    const first = drag.lineRemoveId ? st.station.modules.find((mod) => mod.id === drag.lineRemoveId) : undefined
    if (first && isLineDeletable(first)) {
      out.push(first)
      seen.add(first.id)
    }
    for (const mod of st.station.modules) {
      if (seen.has(mod.id) || !isLineDeletable(mod) || mod.z !== drag.anchor[2]) continue
      if (!moduleFootprint(mod).some(([x, y]) => keys.has(`${x},${y}`))) continue
      out.push(mod)
      seen.add(mod.id)
    }
    return out
  }

  private drawLineRemove(target: LineCell, dragging: boolean): void {
    const drag = this.ctx.drag.current
    const scene = this.ctx.scene()
    if (!drag?.decorLine || !scene) return
    const modules = this.lineRemoveModules(drag, target, dragging)
    scene.setGhost([], 'remove')
    scene.setModulePreview(modules.length ? modules : null, true)
    scene.setCollisionHighlight(null)
    scene.setCursor(null)
  }

  /** The line drag's move: preview the row, or the row it would lift. */
  private moveLine(info: PointerInfo, drag: AreaDrag, hit: PointerInfo['hit']): void {
    const scene = this.ctx.scene()
    if (!scene) return
    if (!hit) {
      scene.setGhost([], 'add')
      scene.setModulePreview(null)
      scene.setCursor(null)
      return
    }
    const st = useStore.getState()
    const type = drag.lineType ?? st.moduleType
    const target = this.lineTargetFrom(drag, hit.cell)
    drag.lineTarget = target
    const dragged = this.lineDragging(info) && (target[0] !== drag.anchor[0] || target[1] !== drag.anchor[1])
    drag.lineDrag = dragged
    if (drag.mode === 'remove') {
      this.drawLineRemove(target, dragged)
      return
    }
    if (!dragged) {
      this.cancelPreview()
      this.multiPlace.setNotice(false)
      this.ctx.hover.current = {
        cell: hit.cell,
        place: hit.place,
        solid: hit.solid,
        moduleId: hit.moduleId ?? null,
        point: [hit.point[0], hit.point[1], hit.point[2]],
      }
      this.refreshHover()
      return
    }
    const spec = this.lineRunSpec(type, drag.anchor, target, drag.lineWall)
    const count = lineAnchorCount(drag.anchor, target, spec.step)
    const key = [...drag.anchor, ...target, type, st.moduleRot, st.lineSpacing, spec.step, spec.rot, st.stationEpoch].join(':')
    if (this.multiPlace.check(count)) {
      scene.setCursor(target, false)
      this.multiPlace.deferRefusal(scene, key, () => {
        if (this.ctx.drag.current !== drag) return
        this.multiPlace.refuse(this.ctx.scene(), lineAnchors(drag.anchor, target, spec.step), target)
      })
      return
    }
    this.multiPlace.setNotice(false)
    this.multiPlace.deferPreview(scene, key, () => {
      if (this.ctx.drag.current !== drag) return
      this.drawLineAdd(target, true)
    })
  }

  /** Release the line: place the whole row, or lift the whole row, in one commit. */
  private finishLine(info: PointerInfo): void {
    const drag = this.ctx.drag.current
    if (!drag?.decorLine) return
    const st = useStore.getState()
    const scene = this.ctx.scene()
    const target = drag.lineTarget ?? (info.hit ? this.lineTargetFrom(drag, info.hit.cell) : drag.anchor)
    const dragged = this.lineDragging(info) && (target[0] !== drag.anchor[0] || target[1] !== drag.anchor[1])
    this.ctx.drag.current = null
    this.cancelPreview()
    scene?.setGhost([], 'add')
    scene?.setModulePreview(null)
    scene?.setCollisionHighlight(null)
    scene?.setCursor(null)
    if (drag.mode === 'remove') {
      const modules = this.lineRemoveModules(drag, target, dragged)
      if (modules.length === 0) {
        const removeType = drag.lineType ?? st.moduleType
        // A quick click on a rail or another non-swept target keeps the old
        // single-target bulldoze; a decor-armed click keeps its own notice.
        if (!dragged && !isDecorType(removeType) && drag.lineHit) {
          this.bulldoze(drag.lineHit.cell, drag.lineHit.place, this.facing())
          return
        }
        st.setNotice(dragged
          ? msg('nothing_to_remove_along_this_line')
          : msg(isDecorType(removeType) ? 'no_decoration_to_remove_here' : 'nothing_to_remove_here'))
        return
      }
      const gone = new Set(modules.map((mod) => mod.id))
      const pillars = new Set(modules.filter((mod) => mod.type === 'pillar').map((mod) => mod.id))
      // A pillar owns its bridge-pier choice and any inscription on it; use its
      // own teardown when the line contains one. Everything else is one list
      // filter, which keeps a long row linear rather than N document copies.
      let next = pillars.size
        ? { ...st.station, modules: st.station.modules.filter((mod) => !gone.has(mod.id) || pillars.has(mod.id)) }
        : { ...st.station, modules: st.station.modules.filter((mod) => !gone.has(mod.id)) }
      for (const id of pillars) next = removeModule(next, id)
      st.commit(next)
      st.select(null)
      st.setNotice(msg('removed_value_line_pieces', modules.length))
      return
    }
    const type = drag.lineType ?? st.moduleType
    // A click is still the piece's own single placement: it keeps every special
    // notice and snap (a wall with no backing, a sign on a booth, a course the
    // pointer aimed at) instead of the run's generic refusal.
    if (!dragged) {
      const click = drag.lineHit
      if (!click) return
      this.placeModule(
        click.cell,
        click.place,
        click.solid,
        type,
        [click.point[0], click.point[1], click.point[2]],
        undefined,
        st.station.modules.find((mod) => mod.id === click.moduleId),
      )
      return
    }
    const spec = this.lineRunSpec(type, drag.anchor, target, drag.lineWall)
    const anchors = lineAnchors(drag.anchor, target, spec.step)
    const rot = spec.rot
    this.multiPlace.setNotice(anchors.length > this.multiPlace.limit)
    if (anchors.length > this.multiPlace.limit) return
    const mods = this.lineCandidates(anchors, type, rot, 'line-new', drag.lineWall)
    const { accepted, blockedCells, reason, colliderIds } = this.lineAccepted(mods, st.station)
    const blockers = colliderIds
      .map((id) => st.station.modules.find((mod) => mod.id === id))
      .filter((mod): mod is Module => mod !== undefined)
    const why = reason ? equipmentRefusalNotice(reason, blockers) : ''
    if (accepted.length === 0) {
      st.setNotice(msg('cannot_place_along_this_line_value', why || msg('choose_another_location')))
      return
    }
    // Mint the saved ids after the verdict, so the run the player saw is the
    // run appended. Provisional ids already gave each poster its own campaign.
    const taken = new Set(st.station.modules.map((mod) => mod.id))
    let seed = st.station.modules.length
    const final = accepted.map((mod) => {
      let n = ++seed
      while (taken.has(`${mod.type}-${n}`)) n++
      const id = `${mod.type}-${n}`
      taken.add(id)
      return { ...mod, id }
    })
    st.commit({ ...st.station, modules: [...st.station.modules, ...final] })
    if (blockedCells.length > 0) {
      st.setNotice(msg('placed_value_line_pieces_value_blockedvalue', final.length, mods.length - final.length, why ? `（${why}）` : ''))
    }
  }


  /**
   * The anchor pitch of a fence / court-divider run: one 1 m panel per cell, or
   * one every `间隔 + 1` cells. A 球场分隔网 spans two cells, so its own pitch
   * starts at two and adds the same empty blocks after it.
   */
  private fenceLineStep(type: string): number {
    return (type === 'court-divider' ? 2 : 1) + useStore.getState().lineSpacing
  }

  private runModuleAt(mod: Module, x: number, y: number, z: number): boolean {
    if (useStore.getState().moduleType !== 'court-divider') return mod.type === 'fence' && mod.x === x && mod.y === y && mod.z === z
    return mod.type === 'court' && mod.cfg.variant === 'divider' && mod.z === z && moduleFootprint(mod).some(([mx, my]) => mx === x && my === y)
  }

  private fenceRunRotation(line: Array<[number, number, number]>): number {
    const st = useStore.getState()
    const axis = fenceRotForLine(line)
    if (axis === null) return st.moduleRot
    // An offset barrier has two distinct sides along the same run axis. Keep
    // the R-selected half-turn while the drag chooses the run's axis (§5.4).
    return axis + (st.moduleType.startsWith('noise-barrier') && st.moduleRot >= 2 ? 2 : 0)
  }

  private fenceRunPreview(line: Array<[number, number, number]>, rot: number): { mods: Module[]; blockedCells: Array<[number, number, number]>; colliderIds: string[] } {
    const st = useStore.getState()
    const mods: Module[] = []
    const blockedCells: Array<[number, number, number]> = []
    const colliderIds: string[] = []
    const seen = new Set<string>()
    for (const [x, y, z] of line) {
      const k = cellKey(x, y, z)
      if (seen.has(k)) continue
      seen.add(k)
      const mod = createModule(st.moduleType, x, y, z, 'preview', rot)
      if (!mod) continue
      // Use the release verdict for each panel, so only skipped cells are red.
      const check = checkModulePlacements(st.station, [{ id: mod.id, module: mod }])
      if (check.refused.size > 0) {
        blockedCells.push([x, y, z])
        for (const id of check.colliderIds) if (!colliderIds.includes(id)) colliderIds.push(id)
        continue
      }
      mods.push(mod)
    }
    return { mods, blockedCells, colliderIds }
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
    if (type === 'escalator' || isStairType(type)) return st.escalatorSpan === 'triple' ? st.tripleRampLength : st.escalatorSpan === 'double' ? st.doubleRampLength : st.rampLength
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
      : stairLengthSpec(length, st.escalatorSpan)
  }

  /**
   * Build the module a pointer at `cell` would place. A straight stair or
   * escalator dropped inside an exit head-house snaps into a bay: its upper
   * landing on the street in the column under the pointer, its base the chosen
   * rise down toward the mouth, so
   * the pointer positions the run on the top floor the exit opens onto rather
   * than the floor it climbs from. Everywhere else the cell is the base.
   */
  private buildPlacementModule(type: string, cell: [number, number, number], id: string, targetRamp?: Module, psdCoverSupport?: Module, rot?: number): Module | null {
    const st = useStore.getState()
    // A line drag asks for the piece at its own run rotation; a click keeps the
    // R setting. Nothing else in the build reads this instead of `st.moduleRot`.
    const placementRot = rot ?? st.moduleRot
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
        placementRot,
        st.escalatorDir,
        id,
        st.escalatorWidth,
        st.walkwayLength,
      )
    } else if (this.isStraightRamp(type)) {
      const width = type === 'escalator' ? st.escalatorWidth : st.stairWidth
      // The piece's own length decides both the bay snap's descent and the run
      // that is built, so a 超短 / 短 / 中 / 长 / 超长 piece snaps to the floor its
      // own rise reaches instead of always to the storey below. Both a 楼梯 and a
      // 单层 扶梯 take the shared 超长 6 m rung.
      const length = this.rampLengthFor(type)
      const spec = this.rampSnapSpec(type)
      const snap = exitRunSnap(st.station.modules, cell[0], cell[1], cell[2], spec.run, spec.rise)
      mod = type === 'escalator'
        ? escalatorModule(snap ? snap.base : { x: cell[0], y: cell[1], z: cell[2] }, snap ? snap.rot : placementRot, st.escalatorDir, id, st.escalatorWidth, length, st.station.storeyHeight, st.escalatorSpan)
        : snap
          ? createModule(type, snap.base.x, snap.base.y, snap.base.z, id, snap.rot, width, st.escalatorDir, 'lane', [], undefined, { rampLength: length, storeyHeight: st.station.storeyHeight, escalatorSpan: st.escalatorSpan })
          : createModule(type, cell[0], cell[1], cell[2], id, placementRot, width, st.escalatorDir, 'lane', [], undefined, { rampLength: length, storeyHeight: st.station.storeyHeight, escalatorSpan: st.escalatorSpan })
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
        placementRot,
        isCounterType(type) ? st.counterLength : type === 'curtain-wall' ? st.curtainWidth : type === 'hanger-roof' || type === 'hanger-post' ? st.hangerLength : st.stairWidth,
        st.escalatorDir,
        st.gateDoor,
        st.station,
        st.currentBoards,
        {
          curtainHeight: st.curtainHeight,
          storeyHeight: st.station.storeyHeight,
          levelBase: st.station.levelBase,
          rampLength: this.rampLengthFor(type),
          escalatorSpan: st.escalatorSpan,
          liftInterval: st.liftInterval,
          liftSize: st.liftSize,
        },
      )
    }
    if (mod?.type === 'calligraphy') mod.cfg.showEnglish = st.calligraphyEnglish && !!st.station.nameEn?.trim()
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
      mod.cfg.name = st.station.cityStyle === 'shanghai' ? nextExitName(st.station.modules, 'shanghai') : mod.cfg.style === 'virtual'
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
  private buildPlacementModules(type: string, cell: [number, number, number], id: string, targetRamp?: Module, rot?: number): Module[] {
    if (type === 'tv-double') {
      const first = this.buildPlacementModule('tv-double', cell, id, targetRamp, undefined, rot)
      if (first?.type !== 'tv') return []
      const secondId = nextModuleId([...useStore.getState().station.modules, first], 'tv-double')
      const second = this.buildPlacementModule('tv-double', cell, secondId, targetRamp, undefined, rot)
      if (second?.type !== 'tv') return []
      second.rot = ((first.rot ?? 0) + 2) % 4
      return [first, second]
    }
    const one = this.buildPlacementModule(type, cell, id, targetRamp, undefined, rot)
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
    near?: readonly [number, number, number?],
    targetId?: string | null,
    type: string = useStore.getState().moduleType,
    rot?: number,
  ): Module | null {
    const st = useStore.getState()
    const groundExit = type.startsWith('exit-doorway-')
    // A 玻璃板 is cladding from its base, so it **hangs over the course the pointer is
    // on** rather than always at the storey floor (`wallMountFollowsCourse`): aim at a
    // wall's third course and the window covers the third course.
    const at = moduleAim(st.station, type, { cell, place, solid: true, point: near ? [...near] : undefined })
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
      type,
      at[0],
      at[1],
      at[2],
      id,
      snappedRot ?? rot ?? st.moduleRot,
      st.stairWidth,
      st.escalatorDir,
      st.gateDoor,
      st.station,
      st.currentBoards,
    )
    if (!draft) return null
    if (draft.type === 'calligraphy') draft.cfg.showEnglish = st.calligraphyEnglish && !!st.station.nameEn?.trim()
    const pillarMounted = calligraphyOnPillar(draft, st.station.modules.find(m => m.id === targetId), near)
    if (pillarMounted) return pillarMounted
    if (groundExit && hitBlock && draft.type === 'exit') draft.cfg.mountZ = cell[2]
    if (draft.type === 'billboard' && draft.cfg.poster === undefined) {
      draft.cfg.poster = randomAdSlug(draft)
    }
    // A wall 指示牌 whose board is open in the editor draws the board being arranged.
    const printed = signModuleWithPreview(draft, st.signPreview)
    let snapped = printed.type === 'sign' && near
      ? snapSignToBooth(st.station.modules, printed, [near[0], near[1]], cell[2], this.signBoothId ?? undefined)
      : printed
    // Resolve the final configured panel, including custom station lettering and
    // live sign boards, before applying its wall-cell alignment policy.
    if (near?.[2] !== undefined && (cell[0] !== place[0] || cell[1] !== place[1])
      && isWallMounted(snapped) && !groundExit && snapped.type !== 'urinal' && !(snapped.type === 'sign' && snapped.cfg.boothId)) {
      snapped = { ...snapped, z: wallDecorAnchorZ(snapped, cell[2]) }
    }
    // The wall the panel hangs on is the one the camera is looking at
    // (`autofaceWallMount`) — except for a 地面出入口, which is a shallow sign on the
    // **block face the pointer clicked** (`snappedRot`, and its `cfg.mountZ` names that
    // course): the view can see the block, but it cannot know which one was aimed at,
    // and a floor cell beside the piece backs a panel just as well.
    const mod = autofaceWallMount(
      st.station.cells,
      snapped,
      near ? [near[0], near[1]] : undefined,
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
    type: string = useStore.getState().moduleType,
    rot?: number,
  ): Module[] {
    const st = useStore.getState()
    const at = moduleAim(st.station, type, { cell, place, solid: true })
    return this.buildPlacementModules(type, at, id, undefined, rot)
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
    const activeLine = this.ctx.drag.current
    if (activeLine?.decorLine) {
      const target = activeLine.lineTarget ?? activeLine.anchor
      if (activeLine.mode === 'remove') {
        this.drawLineRemove(target, activeLine.lineDrag === true)
        return
      }
      if (activeLine.lineDrag) {
        this.drawLineAdd(target, true)
        return
      }
      // Before the line starts, the piece's own hover ghost is the preview; the
      // ordinary hover path below draws it from the press's real aim.
    }
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
        h.moduleId,
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
    near?: [number, number, number?],
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
      const mod = this.wallMountPlacement(cell, place, nextModuleId(st.station.modules, type), near, directTarget?.id, type)
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
      const mods = this.ceilingPlacement(cell, place, nextModuleId(st.station.modules, type), type)
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
