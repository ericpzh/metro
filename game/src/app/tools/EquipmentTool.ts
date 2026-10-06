// The 设备 (equipment) tool: press to place the chosen module — fence runs drag
// out like walls, lifts extend in-column, stairs lay lane by lane, billboards
// autoface their wall. Moved verbatim from app/Viewport.tsx (GAME-SPEC §5–§6).

import {
  addEquipment,
  cellKey,
  createModule,
  extendLift,
  facilityAt,
  fenceRotForLine,
  GROUND_Z,
  nextExitName,
  nextModuleId,
  removeModule,
} from '../../build/model.ts'
import { railModuleAt } from '../../build/rail.ts'
import { ESCALATOR_BAND } from '../../sim/constants.ts'
import { exitFloorAt, exitRunSnap } from '../../sim/exits.ts'
import { liftExtendedDown, liftExtendedUp, type LiftModule } from '../../sim/lifts.ts'
import {
  autofaceWallMount,
  equipmentReason,
  equipmentRefusalNotice,
  moduleAt,
  placementBlocked,
  placementOnTrack,
  wallMountMissing,
  wallMountStandCell,
} from '../../sim/placement.ts'
import { checkModulePlacements } from '../../build/validation.ts'
import { planStairLanes, stairLanes } from '../../sim/stairs.ts'
import type { Module, Vec3i } from '../../sim/types.ts'
import { isDecorType, isExitType, isFenceType, isWallMountedType, signModuleWithPreview, useStore } from '../store.ts'
import { straightLineCells } from './geometry/cells.ts'
import { isMoved, LONG_PRESS_MS } from './geometry/pointer.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

export class EquipmentTool extends ToolController {
  readonly tool = 'module' as const

  onDown(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // A fence (围栏) drags out a run like the 墙 tool: press to anchor, drag
    // for a straight 90° line whose panels follow the drag direction, release
    // to lay one panel per cell. A quick tap stays a single panel with the R
    // rotation. Right-drag lifts the run back out, one panel at a time.
    if (isFenceType(st.moduleType)) {
      const mode: 'add' | 'remove' = info.button === 2 ? 'remove' : 'add'
      if (mode === 'add' && !hit.solid) return
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
      const shaft = moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2])
      if ((shaft && shaft.type === 'lift') || hit.solid) this.placeLift(hit)
      return
    }
    // Equipment rides on a floor block; bare void has nothing to stand on.
    if (!hit.solid) return
    if (info.button === 2) {
      // A 装饰 right-click lifts a placed piece — including every shelf unit
      // of a store, which are modules of their own since stocking. Pointing
      // at the room itself (or bare floor) has nothing to lift.
      if (isDecorType(st.moduleType)) {
        const rail = railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
        if (rail) {
          this.bulldoze(hit.cell, hit.place, this.facing())
          return
        }
        const pointed = moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2])
        if (pointed && pointed.type !== 'shop' && pointed.type !== 'booth' && pointed.type !== 'retail') {
          this.bulldoze(hit.cell, hit.place, this.facing())
          return
        }
        const room = facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
        st.setNotice(room ? '货架要一个一个拆：点中货架再右键' : '这里没有可拆的装饰')
        return
      }
      this.bulldoze(hit.cell, hit.place, this.facing())
      return
    }
    this.placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1]])
  }

  onMove(info: PointerInfo): void {
    const scene = this.ctx.scene()
    const hit = info.hit
    if (!scene || !hit) return
    const st = useStore.getState()
    // An in-progress fence drag previews the straight run the release would
    // lay — one panel per cell, snapped to the dominant axis like the wall —
    // as real translucent fence models, with the existing runs rebuilt so an
    // end you drag up to loses its cap live.
    const d = this.ctx.drag.current
    if (d?.active && d.fence) {
      const target: [number, number, number] = [hit.cell[0], hit.cell[1], d.z]
      // Only a deliberate press becomes a run; a quick press stays one panel.
      const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, info)
      const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
      if (d.mode === 'add') {
        const rot = fenceRotForLine(line) ?? st.moduleRot
        const { mods, blocked, colliderIds } = this.fenceRunPreview(line, rot)
        scene.setGhost([], 'add')
        scene.setModulePreview(null)
        scene.setFencePreview(mods, blocked)
        scene.setCollisionHighlight(blocked ? colliderIds : null)
        scene.setCursor(dragging ? line[line.length - 1] : d.anchor, !blocked)
      } else {
        // Preview exactly the fence panels the release would lift.
        const seen = new Set<string>()
        const cells: Array<[number, number, number]> = []
        for (const [x, y, z] of line) {
          const mod = moduleAt(st.station.modules, x, y, z)
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
    this.ctx.hover.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
    this.refreshHover()
  }

  onUp(info: PointerInfo): void {
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
    const line = rect ? straightLineCells(d.anchor, lineTarget, d.z) : [d.anchor]
    if (d.mode === 'add') {
      // The panel follows the run's own span. Using the run cells (not the
      // press cell against the sorted end) keeps a run laid toward −x/−y from
      // turning crosswise; a single cell keeps the R rotation.
      const rot = fenceRotForLine(line) ?? st.moduleRot
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
        const mod = createModule('fence', x, y, z, nextModuleId(next.modules, 'fence'), rot)
        if (!mod) continue
        // A fence stands on floor like any equipment, and is refused by the one
        // verdict every other piece answers to (`equipmentReason`), which already
        // says "no floor here" as `floor`.
        const refusal = equipmentReason(next.cells, next.modules, mod)
        if (refusal !== '') {
          blocked++
          why ||= equipmentRefusalNotice(refusal)
          continue
        }
        next = addEquipment(next, mod)
        placed++
      }
      if (placed > 0) st.commit(next)
      if (blocked > 0) {
        st.setNotice(
          placed > 0
            ? `围栏放下了 ${placed} 段，${blocked} 格被挡住了${why ? `（${why}）` : ''}`
            : `这儿放不下围栏：${why || '换个地方'}`,
        )
      }
    } else {
      const seen = new Set<string>()
      let next = st.station
      let removed = 0
      for (const [x, y, z] of line) {
        const mod = moduleAt(next.modules, x, y, z)
        if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
        seen.add(mod.id)
        next = removeModule(next, mod.id)
        removed++
      }
      if (removed > 0) {
        st.commit(next)
        st.select(null)
        st.setNotice(`已拆掉${removed}段围栏`)
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
      const mod = createModule('fence', x, y, z, 'preview', rot)
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
   */
  private liftHover(x: number, y: number, z: number): { mod: LiftModule } | null {
    const st = useStore.getState()
    // `moduleAt` finds the shaft from any cell its envelope covers, so hovering
    // the visible cabin/shaft (whose landing slab is now an opening) still works.
    const found = moduleAt(st.station.modules, x, y, z)
    if (!found || found.type !== 'lift') return null
    const shaft = found
    const lo = Math.min(shaft.from.z, shaft.to.z)
    const hi = Math.max(shaft.from.z, shaft.to.z)
    // The midpoint belongs to the upper half, so hovering the exact middle of a
    // two-storey shaft grows it up rather than down.
    const up = z >= (lo + hi) / 2
    return { mod: up ? liftExtendedUp(shaft) : liftExtendedDown(shaft) }
  }

  /**
   * A straight ramp type: the pieces an exit bay can hold. A turning stair is
   * excluded — its run does not end at the bay, so snapping it would not line
   * its landing up with the hole.
   */
  private isStraightRamp(type: string): boolean {
    return type === 'escalator' || type === 'stair' || type === 'stair-straight'
  }

  /**
   * Build the module a pointer at `cell` would place. A straight stair or
   * escalator dropped inside an exit head-house snaps into a bay: its upper
   * landing on the street in the column under the pointer, its base one storey
   * down toward the mouth, so
   * the pointer positions the run on the top floor the exit opens onto rather
   * than the floor it climbs from. Everywhere else the cell is the base.
   */
  private buildPlacementModule(type: string, cell: [number, number, number], id: string): Module | null {
    const st = useStore.getState()
    let mod: Module | null
    if (this.isStraightRamp(type)) {
      const snap = exitRunSnap(st.station.modules, cell[0], cell[1], cell[2])
      mod = snap
        ? createModule(type, snap.base.x, snap.base.y, snap.base.z, id, snap.rot, st.stairWidth, st.escalatorDir)
        : createModule(type, cell[0], cell[1], cell[2], id, st.moduleRot, st.stairWidth, st.escalatorDir)
    } else {
      // `st.gateDoor` rides along like the escalator direction: the 闸机's door
      // side is a tool setting, cycled with Tab, and lands in the piece's
      // `cfg.door` (every other type ignores it). The last two arguments are only
      // read by a 指示牌: the station's own lines, so a bare board still wears the
      // player's 1号线 shield, and the **current** boards, so the sign is hung with
      // the pair the editor is showing.
      mod = createModule(
        type,
        cell[0],
        cell[1],
        cell[2],
        id,
        st.moduleRot,
        st.stairWidth,
        st.escalatorDir,
        st.gateDoor,
        st.station,
        st.currentBoards,
      )
    }
    // A sign whose board is open in the editor draws the board being arranged.
    if (mod) mod = signModuleWithPreview(mod, st.signPreview)
    // A fresh exit letters itself A ~ Z rather than wearing the 未命名口
    // placeholder, so the card and the 3D header read like real signage.
    if (mod && mod.type === 'exit' && mod.cfg.name === '未命名口') mod.cfg.name = nextExitName(st.station.modules)
    return mod
  }

  /**
   * A straight-flight stair: the one shape the builder lays as **lanes**. A
   * turning stair is a single piece — its flights turn, so its landings cannot be
   * shared lane by lane.
   */
  private isStraightStair(type: string): boolean {
    return type === 'stair' || type === 'stair-straight'
  }

  /**
   * The lane pieces a stair tool would place. A wide stair is literally `lanes`
   * narrow flights side by side (`stairLanes(st.stairWidth)`, each exactly the
   * escalator's band), and every lane of the one action carries the same
   * `cfg.flight` token: that is what makes them **one staircase** — the rail
   * along the seam is dropped and the steps run together — while two stairs
   * dropped separately, even flush, keep their rails (`sim/stairs.ts`).
   * `planStairLanes` picks the arrangement: the hovered cell as the first lane,
   * or shifted back so the flight butts against a stair on its left or its right
   * instead of overlapping it. Inside a head-house the lanes follow the exit's
   * own column and climb direction.
   */
  private buildStairLanes(type: string, cell: [number, number, number], id: string): Module[] {
    const st = useStore.getState()
    const snap = exitRunSnap(st.station.modules, cell[0], cell[1], cell[2])
    const rot = snap ? snap.rot : st.moduleRot
    const base: Vec3i = snap ? { x: snap.base.x, y: snap.base.y, z: snap.base.z } : { x: cell[0], y: cell[1], z: cell[2] }
    const placeable = (p: Vec3i): boolean => {
      const floorHere =
        st.station.cells.some((c) => c.fill === 'solid' && c.x === p.x && c.y === p.y && c.z === p.z) ||
        exitFloorAt(st.station.modules, p.x, p.y, p.z)
      if (!floorHere) return false
      const lane = createModule(type, p.x, p.y, p.z, id, rot, ESCALATOR_BAND, st.escalatorDir)
      return !!lane && !placementBlocked(st.station.modules, lane) && !placementOnTrack(st.station.cells, lane, st.station.modules)
    }
    const plan = planStairLanes(base, rot, stairLanes(st.stairWidth), placeable)
    // Every lane needs its own id — a lane deleted on its own can leave a
    // suffixed id behind, so the free one is picked from what is already there.
    const taken = new Set(st.station.modules.map((m) => m.id))
    const laneId = (i: number): string => {
      let cand = i === 0 ? id : `${id}-${i + 1}`
      let n = i + 1
      while (taken.has(cand)) cand = `${id}-${++n}`
      taken.add(cand)
      return cand
    }
    // The flight token is the group's own id. A lane deleted on its own can leave
    // that token behind, so a token no piece is using is picked.
    const usedFlights = new Set(st.station.modules.flatMap((m) => (m.type === 'stair' && m.cfg.flight ? [m.cfg.flight] : [])))
    let flight = id
    for (let n = 1; usedFlights.has(flight); n++) flight = `${id}~${n}`
    return plan.lanes
      .map((p, i) => {
        const lane = createModule(type, p.x, p.y, p.z, laneId(i), rot, ESCALATOR_BAND, st.escalatorDir)
        if (lane && lane.type === 'stair') lane.cfg.flight = flight
        return lane
      })
      .filter((m): m is Module => m !== null)
  }

  /**
   * Every piece a placement would drop at `cell`: one module for most equipment,
   * and one lane per cell for a wide straight stair.
   */
  private buildPlacementModules(type: string, cell: [number, number, number], id: string): Module[] {
    if (this.isStraightStair(type) && stairLanes(useStore.getState().stairWidth) > 1) return this.buildStairLanes(type, cell, id)
    const one = this.buildPlacementModule(type, cell, id)
    return one ? [one] : []
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
   * has to press R to match the wall before the tool agrees. `noWall` reports the
   * separate, genuine failure — no wall within reach in any direction.
   */
  private wallMountPlacement(
    cell: [number, number, number],
    place: [number, number, number],
    id: string,
    near?: readonly [number, number],
  ): { mod: Module | null; noWall: boolean } {
    const st = useStore.getState()
    const at = wallMountStandCell(st.station.cells, cell, place)
    const draft = createModule(st.moduleType, at[0], at[1], at[2], id, st.moduleRot, st.stairWidth, st.escalatorDir)
    if (!draft) return { mod: null, noWall: true }
    const mod = autofaceWallMount(st.station.cells, draft, near)
    return { mod, noWall: wallMountMissing(st.station.cells, mod) }
  }

  /**
   * Rebuild the equipment hover ghost from the last hovered tile. Only the
   * equipment tool has one: the 方块 tool keeps the same hover ref for its own
   * ghost, and a Tab in *that* tool must not drop a piece into the station
   * (`placementPreviewKey` names the settings of both).
   */
  override refreshHover(): void {
    const scene = this.ctx.scene()
    const h = this.ctx.hover.current
    if (!scene || !h) return
    const st = useStore.getState()
    if (st.tool !== 'module') return
    const [x, y, z] = h.cell
    // An exit lays its own floor: cells it covers count even where a ramp
    // carved a hole, so stairs and escalators can land through an exit.
    const floorHere = h.solid || exitFloorAt(st.station.modules, x, y, z)
    // A surface exit is rooted at the street (h = 0 m): it may not be dropped on
    // a concourse or platform slab.
    const onGround = z === GROUND_Z
    // 广告牌 is wall-mounted and may hang over a track (there is no floor in front
    // of a station wall across the rails), so it is resolved from the wall alone.
    if (isWallMountedType(st.moduleType)) {
      const { mod: billboard, noWall } = this.wallMountPlacement(h.cell, h.place, 'preview', h.point)
      const check = billboard ? checkModulePlacements(st.station, [{ id: billboard.id, module: billboard }]) : null
      // No wall at all is a refusal of its own: a panel has nowhere to bolt.
      const blocked = noWall || check === null || check.refused.size > 0
      scene.setCursor(h.cell, !blocked)
      scene.setModulePreview(billboard, blocked)
      scene.setCollisionHighlight(check && check.colliderIds.length > 0 ? check.colliderIds : null)
      return
    }
    // 电梯: hovering any cell of an existing shaft previews its extension even
    // where that level has no floor; a fresh lift still needs floor under it.
    const liftExt = st.moduleType === 'lift' ? this.liftHover(x, y, z) : null
    // A ramp dropped inside an exit snaps into a bay and descends to the floor
    // below, so the exit's own floor is enough to stand its upper landing on.
    const snap = this.isStraightRamp(st.moduleType) ? exitRunSnap(st.station.modules, x, y, z) : null
    const placeable = (floorHere || !!liftExt || !!snap) && (!isExitType(st.moduleType) || onGround)
    let mods: Module[] = []
    if (st.moduleType === 'lift') {
      if (liftExt) {
        mods = [liftExt.mod]
      } else if (floorHere) {
        const lift = createModule('lift', x, y, z, 'preview', st.moduleRot, st.stairWidth, st.escalatorDir)
        if (lift) mods = [lift]
      }
    } else if (placeable) {
      mods = this.buildPlacementModules(st.moduleType, h.cell, 'preview')
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
  ): void {
    const st = useStore.getState()
    // A wall-mounted 广告牌 needs only a wall behind it — it may hang over a
    // track, so it goes through the same verdict as everything else and never
    // through the ground rules.
    if (isWallMountedType(type)) {
      // The panel turns itself to face whatever wall backs it, so the only
      // failure left is "there is no wall here at all".
      const { mod, noWall } = this.wallMountPlacement(cell, place, nextModuleId(st.station.modules, type), near)
      if (!mod || noWall) {
        st.setNotice(equipmentRefusalNotice('wall'))
        return
      }
      const refusal = equipmentReason(st.station.cells, st.station.modules, mod)
      if (refusal !== '') {
        st.setNotice(equipmentRefusalNotice(refusal))
        return
      }
      st.commit(addEquipment(st.station, mod))
      return
    }
    // Exit-covered holes count as floor, like the hover ghost above.
    const floorHere = solid || exitFloorAt(st.station.modules, cell[0], cell[1], cell[2])
    const at = floorHere ? cell : ([place[0], place[1], place[2]] as [number, number, number])
    // A surface exit — any of the six variants — stands at the street (h = 0 m)
    // and nowhere else.
    if (isExitType(type) && at[2] !== GROUND_Z) {
      st.setNotice(equipmentRefusalNotice('exit-on-slab'))
      return
    }
    const mods = this.buildPlacementModules(type, at, nextModuleId(st.station.modules, type))
    if (mods.length === 0) return
    // **One verdict, one refusal.** Every rule a module answers to lives in
    // `build/validation.ts` (which reads `equipmentReason`), so the piece the red
    // ghost refused is the piece this refuses, in the same words.
    for (const mod of mods) {
      const refusal = equipmentReason(st.station.cells, st.station.modules, mod, true)
      if (refusal !== '') {
        st.setNotice(equipmentRefusalNotice(refusal))
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
    const found = moduleAt(st.station.modules, x, y, z)
    const shaft = found && found.type === 'lift' ? found : undefined
    if (shaft) {
      const lo = Math.min(shaft.from.z, shaft.to.z)
      const hi = Math.max(shaft.from.z, shaft.to.z)
      const up = z >= (lo + hi) / 2
      const grown = up ? liftExtendedUp(shaft) : liftExtendedDown(shaft)
      if (placementBlocked(st.station.modules, grown)) {
        st.setNotice('这层有设备挡着，电梯伸不过去')
        return
      }
      st.commit(extendLift(st.station, shaft.id, up))
      st.setNotice(up ? '电梯向上加了一层' : '电梯向下加了一层')
      return
    }
    this.placeModule(hit.cell, hit.place, hit.solid, 'lift')
  }
}
