// The viewport: owns the SceneRenderer lifecycle and turns pointer input into
// build commands. Panels stay in React; only this file touches three directly.

import { useEffect, useRef, useState } from 'react'
import { SceneRenderer } from '../render/scene.ts'
import {
  addCells,
  addFloor,
  addWalls,
  cellKey,
  createModule,
  eraseFaces,
  faceFinish,
  FACILITY_MIN,
  facilityAt,
  facilityCovers,
  facilityFloorCells,
  facilityOpeningCells,
  facilityPlan,
  facilityRect,
  facilityWallCells,
  fenceRotForLine,
  fillSurface,
  GROUND_Z,
  nextExitName,
  nextModuleId,
  paintFaces,
  paintZoneCells,
  placeFacility,
  plannedAutoWalls,
  removeCells,
  removeFloor,
  wallColumnAt,
  wallColumnsAt,
  wallRun,
  zoneMapFloors,
  zoneRegionLabels,
  addEquipment,
  carveFacilityOpenings,
  extendLift,
  removeFacility,
  removeModule,
  SHOP_WALL_H,
  toData,
  type FacilityKind,
} from '../build/model.ts'
import { finishDef } from '../sim/finishes.ts'
import { exitFloorAt, exitRunSnap } from '../sim/exits.ts'
import { liftExtendedDown, liftExtendedUp, liftFootprintCells, type LiftModule } from '../sim/lifts.ts'
import { moduleAt, isTrackCell, trackAt, placementBlocked, placementOnTrack, reservedOpening, ceilingMountMissing, wallMountMissing, wallMountStandCell } from '../sim/placement.ts'
import { escalatorBasesSolid } from '../sim/openings.ts'
import { ZONE_LIST, zoneIndex } from '../sim/zones.ts'
import { FACILITY_OPTIONS, setFrameHandler, useStore, isDecorType, isExitType, isFacilityBrush, isFenceType, isWallMountedType, moduleLabel, type Tool, type ZoneBrush } from './store.ts'
import type { Face, FinishId, Module } from '../sim/types.ts'
import { defaultLine, freeTunnelEnd, makeTrack, makeTunnel, railModuleAt, trackBlockReason, trackPieceForLine } from '../build/rail.ts'
import { trackOriginForCentre } from '../sim/track.ts'
import { ViewCube } from './ViewCube.tsx'

/** The face a picked normal belongs to; rounded corners snap to the dominant axis. */
function dominantFace(n: [number, number, number]): Face {
  const [nx, ny, nz] = n
  if (Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny)) return nz >= 0 ? 'top' : 'bottom'
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'e' : 'w'
  return ny >= 0 ? 'n' : 's'
}

/** Hold this long (and move) before a press becomes a rectangle drag, not a click. */
const LONG_PRESS_MS = 160
/** Pointer travel in pixels that counts as a drag. */
const DRAG_PX = 4

function isMoved(d: { sx: number; sy: number }, e: { clientX: number; clientY: number }): boolean {
  return Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_PX
}

/**
 * Narrow a drag rectangle to the cells it would actually change: the solid
 * blocks a remove drag is pending-delete, the empty cells a build drag is
 * pending-build. Cells already in the desired state are left out, so the
 * highlight reads as exactly "what this release will do". A build drag also
 * drops reserved openings — the corridors ramps carve and the floor exits cover
 * — so the ghost never promises a block the release will refuse.
 */
function pendingCells(
  cells: Array<[number, number, number]>,
  mode: 'add' | 'remove',
  solid: Set<string>,
  modules: readonly Module[] = [],
): Array<[number, number, number]> {
  return cells.filter(([x, y, z]) => {
    const k = cellKey(x, y, z)
    if (mode === 'remove') return solid.has(k)
    // A placed rail's dug bed is covered ground: the ghost drops it so the
    // preview matches the release, which skips the platform/tunnel area.
    return !solid.has(k) && !reservedOpening(modules, x, y, z) && !trackAt(modules, x, y, z)
  })
}

/** Outward normal of each face: the paint plane's axis and the quad orientation. */
const FACE_NORMAL: Record<Face, [number, number, number]> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
}

/**
 * The cells a paint drag covers: the rectangle between the pressed cell and the
 * pointer, on the pressed face's plane. Only the two in-plane axes change; the
 * plane's own coordinate is pinned to the anchor.
 */
function planeCells(a: [number, number, number], b: [number, number, number], face: Face): Array<[number, number, number]> {
  const [nx, , nz] = FACE_NORMAL[face]
  const out: Array<[number, number, number]> = []
  if (nz !== 0) {
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) out.push([x, y, a[2]])
  } else if (nx !== 0) {
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) out.push([a[0], y, z])
  } else {
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) out.push([x, a[1], z])
  }
  return out
}

/** The cells of a rectangle that actually present the face: solid, face unblocked. */
function faceTargets(cells: Array<[number, number, number]>, face: Face, solid: Set<string>): Array<[number, number, number]> {
  const [nx, ny, nz] = FACE_NORMAL[face]
  return cells.filter(
    ([x, y, z]) => solid.has(cellKey(x, y, z)) && !solid.has(cellKey(x + nx, y + ny, z + nz)),
  )
}

/** Preview colour: the brush's own tint, or a warning red when erasing. */
function paintColour(button: number, finish: FinishId): number {
  return button === 2 ? 0xff7a7a : finishDef(finish).tint
}

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

/** The 地基 (block) tool's live patch size, shown beside the pointer in metres. */
interface BuildMeasure {
  left: number
  top: number
  text: string
}

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

function rectCells(a: [number, number, number], b: [number, number, number], z: number, line: boolean): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  if (line) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n
      out.push([Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), z])
    }
    return out
  }
  const x0 = Math.min(a[0], b[0])
  const x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1])
  const y1 = Math.max(a[1], b[1])
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, z])
  return out
}

/**
 * The 墙 tool's run: a straight axis-aligned line, never a diagonal. The drag
 * snaps to the dominant axis (ties go east–west), so a wall always slides
 * through a single 90° row or column.
 */
function straightLineCells(a: [number, number, number], b: [number, number, number], z: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
    const x0 = Math.min(a[0], b[0])
    const x1 = Math.max(a[0], b[0])
    for (let x = x0; x <= x1; x++) out.push([x, a[1], z])
  } else {
    const y0 = Math.min(a[1], b[1])
    const y1 = Math.max(a[1], b[1])
    for (let y = y0; y <= y1; y++) out.push([a[0], y, z])
  }
  return out
}

export function Viewport(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SceneRenderer | null>(null)
  const overlayRef = useRef(false)
  const graphNodesRef = useRef<Float32Array>(new Float32Array(0))
  /** Solid cell keys, refreshed with the station, so a drag can tell blocks from void. */
  const solidRef = useRef<Set<string>>(new Set())
  /** True once the first station build has framed the home view (refresh only, not edits). */
  const framedRef = useRef(false)
  /** The tile under the pointer for the equipment tool, so R can rebuild the ghost. */
  const hoverRef = useRef<{ cell: [number, number, number]; place: [number, number, number]; solid: boolean } | null>(null)
  const drag = useRef<{
    active: boolean
    button: number
    mode: 'add' | 'remove'
    anchor: [number, number, number]
    z: number
    shift: boolean
    /** True for the 墙 tool's drag, whose cells are full-height wall columns. */
    wall?: boolean
    /** True for the 围栏 tool's drag, which lays one fence panel per cell. */
    fence?: boolean
    /** The id a delete-tool press is about to remove, when it points at a module. */
    module?: string
    /** Screen position and time of the press, to tell a click from a drag. */
    sx: number
    sy: number
    downTime: number
  } | null>(null)

  /** The paint tool's own drag: press a face, drag a rectangle on its plane. */
  const paint = useRef<{
    active: boolean
    button: number
    face: Face
    anchor: [number, number, number]
    sx: number
    sy: number
    downTime: number
  } | null>(null)

  /** The zone tool's rectangle drag: a fare-zone patch or a facility room. */
  const zoneDrag = useRef<{
    active: boolean
    /** The active brush when the press began: a fare zone or a room kind. */
    brush: ZoneBrush
    anchor: [number, number, number]
    z: number
    sx: number
    sy: number
    downTime: number
  } | null>(null)

  /**
   * The shop right-click drag: the press holds a shop, the rectangle previews
   * either the wall openings to cut (cyan) or the whole store to delete (red),
   * and the release applies it.
   */
  const facilityDrag = useRef<{
    active: boolean
    id: string
    anchor: [number, number, number]
    z: number
    sx: number
    sy: number
    downTime: number
  } | null>(null)

  /** The 地基 tool's pending patch size, pinned to the pointer while previewing. */
  const [buildMeasure, setBuildMeasure] = useState<BuildMeasure | null>(null)

  const version = useStore((s) => s.version)
  const station = useStore((s) => s.station)
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const moduleRot = useStore((s) => s.moduleRot)
  const stairWidth = useStore((s) => s.stairWidth)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const railRot = useStore((s) => s.railRot)
  const railLineId = useStore((s) => s.railLineId)
  const railDir = useStore((s) => s.railDir)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const activeZ = useStore((s) => s.activeZ)
  const ghostOther = useStore((s) => s.ghostOtherLevels)
  const cutaway = useStore((s) => s.cutaway)
  const hideWalls = useStore((s) => s.hideWalls)
  const ortho = useStore((s) => s.ortho)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const graph = useStore((s) => s.graph)
  const selected = useStore((s) => s.selected)

  useEffect(() => {
    overlayRef.current = overlayOn
    sceneRef.current?.setOverlayVisible(overlayOn)
  }, [overlayOn])

  const buildZoneOverlay = (): void => {
    const scene = sceneRef.current
    if (!scene) return
    const station = useStore.getState().station
    const floors = zoneMapFloors(station.cells, station.modules)
    const quads = new Float32Array(floors.length * 3)
    const zones = new Uint8Array(floors.length)
    floors.forEach((c, i) => {
      quads[i * 3] = c.x + 0.5
      quads[i * 3 + 1] = c.y + 0.5
      quads[i * 3 + 2] = c.z + 1.02
      zones[i] = zoneIndex(c.zone)
    })
    scene.setZoneOverlay(quads, zones, zoneRegionLabels(floors), useStore.getState().zoneOverlayOn)
  }

  useEffect(() => {
    buildZoneOverlay()
  }, [zoneOverlayOn, version])

  useEffect(() => {
    if (!graph) return
    graphNodesRef.current = graph.nodes
    sceneRef.current?.setDensity(graph.nodes, new Float32Array(graph.nodeCount), overlayRef.current)
  }, [graph])

  useEffect(() => {
    sceneRef.current?.setLevel(activeZ, ghostOther)
  }, [activeZ, ghostOther])

  useEffect(() => {
    sceneRef.current?.setCutaway(cutaway)
  }, [cutaway])

  useEffect(() => {
    sceneRef.current?.setHideWalls(hideWalls)
  }, [hideWalls])

  useEffect(() => {
    sceneRef.current?.setOrtho(ortho)
  }, [ortho])

  /**
   * The fence panels a drag run would place: one 1 m panel per cell, all at the
   * run's rotation, skipping cells that are not floor or already occupied. The
   * result drives the live fence preview; `blocked` is true when any cell of the
   * run was refused, so the whole ghost flags red.
   */
  const fenceRunPreview = (line: Array<[number, number, number]>, rot: number): { mods: Module[]; blocked: boolean } => {
    const st = useStore.getState()
    const mods: Module[] = []
    let blocked = false
    const seen = new Set<string>()
    for (const [x, y, z] of line) {
      const k = cellKey(x, y, z)
      if (seen.has(k)) continue
      seen.add(k)
      const mod = createModule('fence', x, y, z, 'preview', rot)
      if (!mod) continue
      const floorHere = st.station.cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === z) || exitFloorAt(st.station.modules, x, y, z)
      if (!floorHere || placementBlocked(st.station.modules, mod) || placementOnTrack(st.station.cells, mod, st.station.modules)) {
        blocked = true
        continue
      }
      mods.push(mod)
    }
    return { mods, blocked }
  }

  /**
   * True when all four floor cells of a 2 × 2 lift assembly at `(x, y, z)` are
   * solid floor (or an exit's floor). A lift stands on its whole footprint, so a
   * corner over void means it cannot be placed (or extended to) that level.
   */
  const liftFootprintFloorOk = (x: number, y: number, z: number): boolean => {
    const st = useStore.getState()
    return liftFootprintCells({ x, y }).every(
      ([fx, fy]) =>
        st.station.cells.some((c) => c.fill === 'solid' && c.x === fx && c.y === fy && c.z === z) ||
        exitFloorAt(st.station.modules, fx, fy, z),
    )
  }

  /**
   * The shaft a 电梯 hover would extend. A hover in the same column as a placed
   * shaft grows it a storey — upper half up, lower half down — instead of
   * dropping a second piece. Extending never checks for floor: a shaft may run
   * past a level that has no slab (it just has no landing there).
   */
  const liftHover = (x: number, y: number, z: number): { mod: LiftModule } | null => {
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
  const isStraightRamp = (type: string): boolean =>
    type === 'escalator' || type === 'stair' || type === 'stair-straight'

  /**
   * Build the module a pointer at `cell` would place. A straight stair or
   * escalator dropped inside an exit head-house snaps into the nearest bay: its
   * upper landing on the street, its base one storey down toward the mouth, so
   * the pointer positions the run on the top floor the exit opens onto rather
   * than the floor it climbs from. Everywhere else the cell is the base.
   */
  const buildPlacementModule = (type: string, cell: [number, number, number], id: string): Module | null => {
    const st = useStore.getState()
    let mod: Module | null
    if (isStraightRamp(type)) {
      const snap = exitRunSnap(st.station.modules, cell[0], cell[1], cell[2])
      mod = snap
        ? createModule(type, snap.base.x, snap.base.y, snap.base.z, id, snap.rot, st.stairWidth, st.escalatorDir)
        : createModule(type, cell[0], cell[1], cell[2], id, st.moduleRot, st.stairWidth, st.escalatorDir)
    } else {
      mod = createModule(type, cell[0], cell[1], cell[2], id, st.moduleRot, st.stairWidth, st.escalatorDir)
    }
    // A fresh exit letters itself A ~ Z rather than wearing the 未命名口
    // placeholder, so the card and the 3D header read like real signage.
    if (mod && mod.type === 'exit' && mod.cfg.name === '未命名口') mod.cfg.name = nextExitName(st.station.modules)
    return mod
  }

  /**
   * The billboard a wall-mounted hover would place. Normally it stands on the
   * hovered floor cell; a hover on a wall itself (e.g. the station wall across
   * the track, behind the screen doors) stands the panel in the face-adjacent
   * `place` cell instead — so an ad can be fixed to a wall that has no walkable
   * floor in front of it. Returns null when no solid wall backs the panel.
   */
  const wallMountPlacement = (cell: [number, number, number], place: [number, number, number], id: string): Module | null => {
    const st = useStore.getState()
    const at = wallMountStandCell(st.station.cells, cell, place)
    const mod = createModule(st.moduleType, at[0], at[1], at[2], id, st.moduleRot, st.stairWidth, st.escalatorDir)
    if (!mod || wallMountMissing(st.station.cells, mod)) return null
    return mod
  }

  /** Rebuild the equipment hover ghost from the last hovered tile. */
  const refreshModulePreview = (): void => {
    const scene = sceneRef.current
    const h = hoverRef.current
    if (!scene || !h) return
    const st = useStore.getState()
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
      const billboard = wallMountPlacement(h.cell, h.place, 'preview')
      const blocked = !billboard || placementBlocked(st.station.modules, billboard)
      scene.setCursor(h.cell, !blocked)
      scene.setModulePreview(billboard, blocked)
      return
    }
    // 电梯: hovering any cell of an existing shaft previews its extension even
    // where that level has no floor; a fresh lift still needs floor under it.
    const liftExt = st.moduleType === 'lift' ? liftHover(x, y, z) : null
    // A ramp dropped inside an exit snaps into a bay and descends to the floor
    // below, so the exit's own floor is enough to stand its upper landing on.
    const snap = isStraightRamp(st.moduleType) ? exitRunSnap(st.station.modules, x, y, z) : null
    const placeable = (floorHere || !!liftExt || !!snap) && (!isExitType(st.moduleType) || onGround)
    let mod: Module | null = null
    let liftFloorMissing = false
    if (st.moduleType === 'lift') {
      if (liftExt) {
        mod = liftExt.mod
      } else if (floorHere) {
        mod = createModule('lift', x, y, z, 'preview', st.moduleRot, st.stairWidth, st.escalatorDir)
        liftFloorMissing = !liftFootprintFloorOk(x, y, z)
      }
    } else if (placeable) {
      mod = buildPlacementModule(st.moduleType, h.cell, 'preview')
    }
    // An escalator may run through walls/ceilings — only its two landings must
    // be solid floor (or exit floor). Anything in between is carved on placement.
    const basesMissing = !!mod && mod.type === 'escalator' && !escalatorBasesSolid(st.station.cells, st.station.modules, mod)
    const blocked =
      !!mod &&
      (placementBlocked(st.station.modules, mod) ||
        basesMissing ||
        liftFloorMissing ||
        placementOnTrack(st.station.cells, mod, st.station.modules) ||
        wallMountMissing(st.station.cells, mod) ||
        ceilingMountMissing(st.station.cells, mod))
    scene.setCursor(h.cell, placeable && !blocked)
    scene.setModulePreview(mod, blocked)
  }

  /**
   * The fixed track piece the rail tool would drop at the hovered cell. It is
   * sized from the bound line's consist (or a default line on a fresh station),
   * so the ghost is the exact module the click would place — rotation and all.
   */
  const railPiece = (): Module | null => {
    const st = useStore.getState()
    const h = hoverRef.current
    if (!h) return null
    const line = st.station.lines.find((l) => l.id === st.railLineId) ?? st.station.lines[0] ?? defaultLine(st.railLineId || '1', st.railDir, 'third-rail')
    const { w, d } = trackPieceForLine(line)
    // Centre the long run on the highlighted tile, so it grows evenly both ways.
    const [ox, oy] = trackOriginForCentre(st.railRot, h.cell[0], h.cell[1], w, d)
    return makeTrack({ id: 'preview', lineId: line.id, dir: st.railDir, power: line.power, rot: st.railRot, x: ox, y: oy, z: h.cell[2], w, d })
  }

  /** Rebuild the rail hover ghost from the last hovered tile. */
  const refreshRailPreview = (): void => {
    const scene = sceneRef.current
    const h = hoverRef.current
    if (!scene || !h) return
    const st = useStore.getState()
    // A piece only ever stands on floor, so a non-floor centre cell shows no
    // ghost at all (and no blue highlight) — the equipment tool's rule.
    const mod = h.solid ? railPiece() : null
    const blocked = !!mod && (mod.type !== 'track' || trackBlockReason(st.station, mod) !== null)
    scene.setCursor(h.cell, h.solid && !blocked)
    scene.setModulePreview(mod, blocked)
  }

  /**
   * The tunnel run the tunnel tool would add: a fixed-length extension off the
   * end of the hovered rail, along that rail's own axis. It is only valid on an
   * existing track bed and is refused where it would collide with another.
   */
  const refreshTunnelPreview = (): void => {
    const scene = sceneRef.current
    const h = hoverRef.current
    if (!scene || !h) return
    const st = useStore.getState()
    const src = railModuleAt(st.station, h.cell[0], h.cell[1], h.cell[2])
    if (!src) {
      scene.setCursor(null)
      scene.setModulePreview(null)
      return
    }
    const mod = makeTunnel(src, freeTunnelEnd(st.station, src, h.cell), st.tunnelLength, 'preview')
    const blocked = trackBlockReason(st.station, mod) !== null
    scene.setCursor(h.cell, !blocked)
    scene.setModulePreview(mod, blocked)
  }

  /** Pin the 地基 patch-size badge to the pointer, in canvas-relative pixels. */
  const showBuildMeasure = (e: React.PointerEvent, text: string): void => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setBuildMeasure({ left: e.clientX - rect.left, top: e.clientY - rect.top, text })
  }

  /**
   * Drop any in-progress area drag without applying it (§9.5): a right-click or
   * ESC while previewing a foundation, paint, zone or room rectangle just clears
   * the ghost. Returns true when a drag was cancelled.
   */
  const cancelActiveDrag = (): boolean => {
    const anyActive =
      drag.current?.active === true ||
      paint.current?.active === true ||
      zoneDrag.current?.active === true ||
      facilityDrag.current?.active === true
    if (!anyActive) return false
    drag.current = null
    paint.current = null
    zoneDrag.current = null
    facilityDrag.current = null
    setBuildMeasure(null)
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.setGhost([], 'remove')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setModulePreview(null)
    sceneRef.current?.setFencePreview(null)
    return true
  }

  // ESC cancels any in-progress drag even when the pointer never moves again.
  useEffect(() => {
    const onCancelKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      cancelActiveDrag()
    }
    window.addEventListener('keydown', onCancelKey)
    return () => window.removeEventListener('keydown', onCancelKey)
  }, [])

  // A ghost belongs to a tool; leaving one must not strand a preview.
  useEffect(() => {
    hoverRef.current = null
    drag.current = null
    paint.current = null
    zoneDrag.current = null
    facilityDrag.current = null
    setBuildMeasure(null)
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.setGhost([], 'remove')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setCursor(null)
    sceneRef.current?.setModulePreview(null)
    sceneRef.current?.setFencePreview(null)
  }, [tool])

  // Rotating (R), switching the equipment, or cycling its width/direction (Tab)
  // rebuilds the ghost at the hovered tile at once, instead of waiting for the
  // pointer to move again.
  useEffect(() => {
    refreshModulePreview()
  }, [moduleRot, moduleType, stairWidth, escalatorDir])

  // The same for the rail piece: R, the bound line and the direction all change
  // the pre-rendered ghost, so rebuild it in place.
  useEffect(() => {
    refreshRailPreview()
  }, [railRot, railLineId, railDir])

  // The tunnel's length changes its ghost; the hovered rail does not.
  useEffect(() => {
    refreshTunnelPreview()
  }, [tunnelLength])

  // Boot the renderer.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new SceneRenderer(canvas)
    sceneRef.current = scene
    scene.onStats = (s) => useStore.getState().setStats(s)
    const resize = (): void => scene.resize(canvas.clientWidth, canvas.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    setFrameHandler((count, agents, density, trains, lifts, intervalMs) => {
      scene.setAgents(agents, count, intervalMs)
      scene.setTrains(trains)
      scene.setLifts(lifts)
      if (overlayRef.current && graphNodesRef.current.length === density.length * 3) {
        scene.setDensity(graphNodesRef.current, density, true)
      }
    })
    const onPreset = (e: Event): void => {
      const k = (e as CustomEvent).detail as string
      scene.setPreset(k === '1' ? 'iso' : k === '2' ? 'plan' : k === '4' ? 'front' : k === '5' ? 'side' : 'custom')
      useStore.getState().setOrtho(k === '2' || k === '4' || k === '5')
    }
    const onFrame = (): void => scene.frame()
    const onDelete = (): void => {
      const st = useStore.getState()
      const sel = st.selected
      if (!sel || sel.kind !== 'cell') return
      const [x, y, z] = sel.key.split(',').map(Number)
      // A build-tool floor brings its auto-wall ring with it; a hand-built or
      // auto-wall block is just removed.
      const next = removeFloor(st.station, [[x, y, z]])
      st.commit(next)
      st.select(null)
    }
    // WASD pan (Shift = faster). Q/E layer stepping stays in the app.
    const panKeys = new Set(['w', 'a', 's', 'd', 'shift'])
    const onKeyDown = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (panKeys.has(k)) scene.keys.add(k)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      scene.keys.delete(e.key.toLowerCase())
    }
    const onBlur = (): void => scene.keys.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('metro:preset', onPreset)
    window.addEventListener('metro:frame', onFrame)
    window.addEventListener('metro:delete', onDelete)
    return () => {
      setFrameHandler(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('metro:preset', onPreset)
      window.removeEventListener('metro:frame', onFrame)
      window.removeEventListener('metro:delete', onDelete)
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
      framedRef.current = false
    }
  }, [])

  // Rebuild the static meshes only when the station itself changes.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const st = useStore.getState()
    solidRef.current = new Set(station.cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)))
    scene.setStation(toData(station))
    scene.setLevel(st.activeZ, st.ghostOtherLevels)
    scene.setCutaway(st.cutaway)
    // On a fresh page load the demo station must open on the home view; the
    // constructor's preset ran before the station existed, so frame it now. A
    // later edit rebuilds the station but must not yank the camera.
    if (!framedRef.current) {
      framedRef.current = true
      scene.setPreset('iso')
    }
  }, [version, station])

  // Keep the 3D selection box in step with the inspector's selection. A rebuild
  // re-applies it inside setStation, so this only has to run on the id itself.
  useEffect(() => {
    sceneRef.current?.setSelection(selected?.kind === 'module' ? selected.key : null)
  }, [selected])

  const pickAt = (e: React.PointerEvent): ReturnType<SceneRenderer['pick']> => {
    const scene = sceneRef.current
    if (!scene) return null
    return scene.pick(e.clientX, e.clientY, activeZ)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene || e.button === 1) return
    // A second press while an area drag is previewing cancels it instead of
    // starting a second drag, so the release commits nothing. In practice this
    // is a right-click during a left drag (or the reverse); ESC is handled
    // separately below for drags that never see another press.
    if (cancelActiveDrag()) {
      e.preventDefault()
      return
    }
    const st = useStore.getState()
    const tool: Tool = st.tool
    const hit = pickAt(e)
    if (!hit) return
    if (tool === 'select') {
      // Right-click bulldozes the equipment under the pointer.
      if (e.button === 2) {
        const pickedId = scene.pickModule(e.clientX, e.clientY)
        const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
        if (picked) removePlacedModule(picked)
        else bulldoze(hit.cell, hit.place)
        return
      }
      // A rail's bed is dug, so the ray lands on the block below or the work
      // plane; look for the track module at both the hit and the cell above.
      const rail =
        railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
        railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
      // The drawn mesh wins: a large exit is drawn far past its collision box,
      // so the visible model is what a click should select.
      const pickedId = scene.pickModule(e.clientX, e.clientY)
      const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
      const mod = picked ?? rail ?? (hit.solid ? moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined)
      const label = mod ? moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined) : ''
      st.select(mod ? { kind: 'module', key: mod.id, label } : { kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
      scene.setGhost([], 'add')
      return
    }
    if (tool === 'module') {
      // A fence (围栏) drags out a run like the 墙 tool: press to anchor, drag
      // for a straight 90° line whose panels follow the drag direction, release
      // to lay one panel per cell. A quick tap stays a single panel with the R
      // rotation. Right-drag lifts the run back out, one panel at a time.
      if (isFenceType(st.moduleType)) {
        const mode: 'add' | 'remove' = e.button === 2 ? 'remove' : 'add'
        if (mode === 'add' && !hit.solid) return
        e.preventDefault()
        drag.current = {
          active: true,
          button: e.button,
          mode,
          anchor: hit.cell,
          z: hit.cell[2],
          shift: false,
          fence: true,
          sx: e.clientX,
          sy: e.clientY,
          downTime: performance.now(),
        }
        if (mode === 'add') {
          const { mods, blocked } = fenceRunPreview([hit.cell], st.moduleRot)
          scene.setGhost([], 'add')
          scene.setModulePreview(null)
          scene.setFencePreview(mods, blocked)
          scene.setCursor(hit.cell, !blocked)
        } else {
          scene.setFencePreview(null)
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
        if (e.button === 2) {
          bulldoze(hit.cell, hit.place)
          return
        }
        const shaft = moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2])
        if ((shaft && shaft.type === 'lift') || hit.solid) placeLift(hit)
        return
      }
      // Equipment rides on a floor block; bare void has nothing to stand on.
      if (!hit.solid) return
      if (e.button === 2) {
        // A 装饰 right-click lifts a placed piece — including every shelf unit
        // of a store, which are modules of their own since stocking. Pointing
        // at the room itself (or bare floor) has nothing to lift.
        if (isDecorType(st.moduleType)) {
          const rail = railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
          if (rail) {
            bulldoze(hit.cell, hit.place)
            return
          }
          const pointed = moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2])
          if (pointed && pointed.type !== 'shop' && pointed.type !== 'booth' && pointed.type !== 'retail') {
            bulldoze(hit.cell, hit.place)
            return
          }
          const room = facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
          st.setNotice(room ? '货架要一个一个拆：点中货架再右键' : '这里没有可拆的装饰')
          return
        }
        bulldoze(hit.cell, hit.place)
        return
      }
      placeModule(hit.cell, hit.place, hit.solid, st.moduleType)
      return
    }
    if (tool === 'paint') {
      if (!hit.solid) return
      const face = dominantFace(hit.normal)
      if (st.paintMode === 'pick') {
        st.setPaintFinish(faceFinish(st.station.cells, hit.cell[0], hit.cell[1], hit.cell[2], face))
        st.setPaintMode('single')
        return
      }
      // Press holds the anchor face; release paints it, or the dragged rectangle.
      e.preventDefault()
      paint.current = {
        active: true,
        button: e.button,
        face,
        anchor: hit.cell,
        sx: e.clientX,
        sy: e.clientY,
        downTime: performance.now(),
      }
      scene.setFaceGhost(faceTargets([hit.cell], face, solidRef.current), face, paintColour(e.button, st.paintFinish))
      return
    }
    if (tool === 'zone') {
      // Right-click edits a walled room: drag over its walls to cut openings, or
      // drag across the whole room to delete it. Booths have no opening, so a
      // right-click deletes them outright.
      if (e.button === 2) {
        const fac = hit.solid ? facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined
        if (fac && fac.type === 'shop') {
          e.preventDefault()
          const anchor: [number, number, number] = [hit.cell[0], hit.cell[1], fac.z]
          facilityDrag.current = { active: true, id: fac.id, anchor, z: fac.z, sx: e.clientX, sy: e.clientY, downTime: performance.now() }
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
        if (hit.solid) bulldoze(hit.cell, hit.place)
        return
      }
      // Both brushes are a long-press drag: the press holds the anchor, the
      // rectangle previews live, and the release applies it — a room when a
      // shop/booth is chosen, a painted zone patch when a fare zone is.
      e.preventDefault()
      const brush = st.zoneBrush
      const z = isFacilityBrush(brush) ? st.activeZ : hit.cell[2]
      const anchor: [number, number, number] = [hit.cell[0], hit.cell[1], z]
      zoneDrag.current = {
        active: true,
        brush,
        anchor,
        z,
        sx: e.clientX,
        sy: e.clientY,
        downTime: performance.now(),
      }
      scene.setFaceGhost([anchor], 'top', brushColour(brush))
      scene.setCursor(anchor, true)
      return
    }
    if (tool === 'rail') {
      // Right-click bulldozes a rail under the pointer.
      if (e.button === 2) {
        const rail =
          railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
          railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
        if (rail) {
          st.removeRail(rail.id)
          st.select(null)
        }
        return
      }
      // A track piece sits on floor like equipment: a click drops the whole
      // pre-sized module (R turns it), a right-click removes one.
      if (!hit.solid) return
      e.preventDefault()
      st.layTrack(hit.cell)
      return
    }
    if (tool === 'tunnel') {
      // A tunnel can only be hung off an existing rail, continuing it from one
      // end. It never touches the platform track's own cells — the run starts
      // where that rail stops.
      const src =
        railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
        railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
      if (!src) return
      if (e.button === 2) {
        st.removeRail(src.id)
        st.select(null)
        return
      }
      e.preventDefault()
      st.layTunnel(src.id, hit.cell)
      return
    }
    if (tool === 'wall') {
      // The 墙 tool drags out a run of full-height wall; right-click drags the
      // same run back out again, a whole column at a time.
      e.preventDefault()
      const mode: 'add' | 'remove' = e.button === 2 ? 'remove' : 'add'
      const anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
      drag.current = {
        active: true,
        button: e.button,
        mode,
        anchor,
        z: anchor[2],
        shift: false,
        wall: true,
        sx: e.clientX,
        sy: e.clientY,
        downTime: performance.now(),
      }
      scene.setGhost(
        mode === 'add'
          ? pendingCells(wallRun([anchor]), 'add', solidRef.current, st.station.modules)
          : wallColumnAt(st.station, anchor[0], anchor[1], anchor[2]),
        mode,
      )
      scene.setCursor(anchor, mode === 'add')
      return
    }
    if (tool === 'delete') {
      // The delete tool is button-agnostic: press a block and tap (one block) or
      // drag a line (a run of blocks). It reuses the `drag` ref in remove mode
      // with `shift` pinned, so the release takes the block tool's line path.
      // A drawn module under the pointer is the pending delete instead — the
      // whole piece goes, not the floor block beneath it.
      const pickedId = scene.pickModule(e.clientX, e.clientY)
      const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
      if (picked) {
        e.preventDefault()
        drag.current = {
          active: true,
          button: e.button,
          mode: 'remove',
          anchor: [picked.x, picked.y, picked.z],
          z: picked.z,
          shift: true,
          module: picked.id,
          sx: e.clientX,
          sy: e.clientY,
          downTime: performance.now(),
        }
        scene.setGhost([], 'remove')
        scene.setModulePreview(picked, true)
        scene.setCursor([picked.x, picked.y, picked.z], true)
        return
      }
      if (!hit.solid) return
      e.preventDefault()
      drag.current = {
        active: true,
        button: e.button,
        mode: 'remove',
        anchor: hit.cell,
        z: hit.cell[2],
        shift: true,
        sx: e.clientX,
        sy: e.clientY,
        downTime: performance.now(),
      }
      scene.setGhost(pendingCells([hit.cell], 'remove', solidRef.current), 'remove')
      scene.setCursor(hit.cell, true)
      return
    }
    // 地基: a click is one block, a long press + drag is a rectangle on the
    // pressed plane (the depth you are on, stepped with Q/E). With 自动生成墙壁
    // on (the default) the patch grows an auto-wall ring; off, it is plain blocks.
    e.preventDefault()
    const mode: 'add' | 'remove' = e.button === 2 ? 'remove' : 'add'
    const anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
    drag.current = {
      active: true,
      button: e.button,
      mode,
      anchor,
      z: anchor[2],
      shift: e.shiftKey,
      sx: e.clientX,
      sy: e.clientY,
      downTime: performance.now(),
    }
    scene.setGhost(pendingCells([anchor], mode, solidRef.current, st.station.modules), mode)
    showBuildMeasure(e, '长 1 m × 宽 1 m')
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene) return
    // Right-click cancel while the left button is still held: the second
    // pointerdown is unreliable (one mouse pointer, button already down), but
    // the buttons bitmask on the move is not — a left drag that gains the
    // right bit, or the reverse, drops the drag at once.
    {
      const activeButton =
        drag.current?.active === true
          ? drag.current.button
          : paint.current?.active === true
            ? paint.current.button
            : zoneDrag.current?.active === true
              ? 0
              : facilityDrag.current?.active === true
                ? 2
                : null
      if (activeButton !== null) {
        const otherHeld = activeButton === 2 ? (e.buttons & 1) !== 0 : (e.buttons & 2) !== 0
        if (otherHeld) {
          cancelActiveDrag()
          return
        }
      }
    }
    const hit = pickAt(e)
    if (!hit) {
      hoverRef.current = null
      setBuildMeasure(null)
      scene.setCursor(null)
      scene.setModulePreview(null)
      return
    }
    const st = useStore.getState()
    if (st.tool === 'wall') {
      const d = drag.current
      if (d?.active) {
        const target = d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
        // Only a deliberate press becomes a run; a quick press stays one column.
        // The run snaps to the dominant axis — straight 90° lines only.
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
        const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
        scene.setGhost(
          d.mode === 'add'
            ? pendingCells(wallRun(line), 'add', solidRef.current, st.station.modules)
            : wallColumnsAt(st.station, line),
          d.mode,
        )
        scene.setCursor(dragging ? line[line.length - 1] : d.anchor, d.mode === 'add')
        return
      }
      const c = hit.solid ? hit.place : hit.cell
      scene.setGhost(pendingCells(wallRun([c]), 'add', solidRef.current, st.station.modules), 'add')
      scene.setCursor(c, true)
      return
    }
    if (st.tool === 'delete') {
      const d = drag.current
      if (d?.active) {
        if (d.module) {
          // A module delete is one piece; keep it highlighted while the press
          // holds, and never grow it into a block line.
          const mod = st.station.modules.find((m) => m.id === d.module)
          scene.setGhost([], 'remove')
          scene.setModulePreview(mod ?? null, true)
          return
        }
        // A deliberate press draws the line of blocks the release will remove;
        // a quick tap stays one block even if the pointer jitters.
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
        const line = dragging ? rectCells(d.anchor, hit.cell, d.z, true) : [d.anchor]
        scene.setGhost(pendingCells(line, 'remove', solidRef.current), 'remove')
        scene.setCursor(dragging ? hit.cell : d.anchor, true)
        return
      }
      // Hover: a drawn module under the pointer is the pending delete, shown as
      // a red ghost of the piece itself; otherwise the block under it.
      const pickedId = scene.pickModule(e.clientX, e.clientY)
      const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
      if (picked) {
        scene.setGhost([], 'remove')
        scene.setModulePreview(picked, true)
        scene.setCursor([picked.x, picked.y, picked.z], true)
      } else {
        scene.setModulePreview(null)
        scene.setGhost(pendingCells([hit.cell], 'remove', solidRef.current), 'remove')
        scene.setCursor(hit.cell, hit.solid)
      }
      return
    }
    if (st.tool === 'block') {
      const d = drag.current
      if (d?.active) {
        d.shift = e.shiftKey
        const target = d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
        // Only a deliberate press becomes a rectangle; a quick press stays one
        // block even if the pointer jitters.
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
        const preview = dragging ? rectCells(d.anchor, target, d.z, e.shiftKey) : [d.anchor]
        // A deliberate 地基 drag with 自动生成墙壁 on draws a walled surface:
        // show the auto wall ring the release would raise, so the shell is not a
        // surprise. With the toggle off, it is the same drag with plain blocks.
        const cells = pendingCells(preview, d.mode, solidRef.current, st.station.modules)
        if (d.mode === 'add' && dragging && st.autoWalls)
          cells.push(...plannedAutoWalls(solidRef.current, preview, st.station.modules))
        scene.setGhost(cells, d.mode)
        scene.setCursor(dragging ? target : d.anchor, d.mode === 'add')
        // The patch's own footprint, in metres (1 cell = 1 m), pinned to the
        // pointer so the player can size a foundation before releasing.
        const dx = dragging ? Math.abs(target[0] - d.anchor[0]) + 1 : 1
        const dy = dragging ? Math.abs(target[1] - d.anchor[1]) + 1 : 1
        showBuildMeasure(e, `长 ${dx} m × 宽 ${dy} m`)
        return
      }
      const c = hit.solid ? hit.place : hit.cell
      scene.setGhost([c], 'add')
      scene.setCursor(c, true)
      showBuildMeasure(e, '长 1 m × 宽 1 m')
      return
    }
    if (st.tool === 'paint') {
      const p = paint.current
      if (p?.active) {
        // The rectangle runs to the cell under the pointer, on the anchor plane.
        const cells = planeCells(p.anchor, hit.cell, p.face)
        scene.setFaceGhost(faceTargets(cells, p.face, solidRef.current), p.face, paintColour(p.button, st.paintFinish))
      } else if (st.paintMode !== 'pick' && hit.solid) {
        const face = dominantFace(hit.normal)
        scene.setFaceGhost(faceTargets([hit.cell], face, solidRef.current), face, paintColour(0, st.paintFinish))
      } else {
        scene.clearFaceGhost()
      }
      scene.setCursor(hit.cell, true)
      return
    }
    if (st.tool === 'module') {
      // An in-progress fence drag previews the straight run the release would
      // lay — one panel per cell, snapped to the dominant axis like the wall —
      // as real translucent fence models, with the existing runs rebuilt so an
      // end you drag up to loses its cap live.
      const d = drag.current
      if (d?.active && d.fence) {
        const target: [number, number, number] = [hit.cell[0], hit.cell[1], d.z]
        // Only a deliberate press becomes a run; a quick press stays one panel.
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
        const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
        if (d.mode === 'add') {
          const rot = fenceRotForLine(line) ?? st.moduleRot
          const { mods, blocked } = fenceRunPreview(line, rot)
          scene.setGhost([], 'add')
          scene.setModulePreview(null)
          scene.setFencePreview(mods, blocked)
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
      hoverRef.current = { cell: hit.cell, place: hit.place, solid: hit.solid }
      refreshModulePreview()
      return
    }
    if (st.tool === 'zone') {
      const fd = facilityDrag.current
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
      const zd = zoneDrag.current
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
        const floor = cells.filter(([x, y, z]) => solidRef.current.has(cellKey(x, y, z)))
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
      return
    }
    if (st.tool === 'rail') {
      // The pre-rendered piece follows the pointer exactly as equipment does.
      hoverRef.current = { cell: hit.cell, place: hit.place, solid: hit.solid }
      refreshRailPreview()
      return
    }
    if (st.tool === 'tunnel') {
      // The extension hangs off the rail under the pointer; no rail, no ghost.
      const src = railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
      if (!src) {
        hoverRef.current = null
        scene.setCursor(null)
        scene.setModulePreview(null)
        return
      }
      hoverRef.current = { cell: hit.cell, place: hit.place, solid: true }
      refreshTunnelPreview()
      return
    }
    const c = hit.solid ? hit.place : hit.cell
    scene.setCursor(c, true)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    setBuildMeasure(null)
    // Releasing the other button while a drag is held cancels it: the classic
    // case is right-up during a left drag, whose own pointerdown never fired
    // while the left button was down — committing here would apply the very
    // rectangle the player tried to cancel. The still-held button's later
    // release then finds no active drag and commits nothing.
    {
      const activeButton =
        drag.current?.active === true
          ? drag.current.button
          : paint.current?.active === true
            ? paint.current.button
            : zoneDrag.current?.active === true
              ? 0
              : facilityDrag.current?.active === true
                ? 2
                : null
      if (activeButton !== null && (e.button === 0 || e.button === 2) && e.button !== activeButton) {
        cancelActiveDrag()
        return
      }
      if (e.button === 1) return
    }
    const fd = facilityDrag.current
    facilityDrag.current = null
    if (fd?.active) {
      scene?.setGhost([], 'remove')
      const st = useStore.getState()
      const mod = st.station.modules.find((m) => m.id === fd.id)
      if (!mod) return
      const hit = pickAt(e)
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
    const zd = zoneDrag.current
    zoneDrag.current = null
    if (zd?.active) {
      scene?.clearFaceGhost()
      const st = useStore.getState()
      const hit = pickAt(e)
      const target: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], zd.z] : zd.anchor
      // A deliberate press becomes a rectangle; a quick tap stays one cell.
      const wasRect = performance.now() - zd.downTime >= LONG_PRESS_MS && isMoved(zd, e)
      if (!isFacilityBrush(zd.brush)) {
        // A fare-zone patch: a quick tap tints one cell, a deliberate drag a
        // rectangle of the chosen zone across the floor it covers.
        const rect = rectCells(zd.anchor, wasRect ? target : zd.anchor, zd.z, false)
        const floor = rect.filter(([x, y, z]) => solidRef.current.has(cellKey(x, y, z)))
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
          : zd.brush === 'booth'
            ? `${built}建好了，四周是柜台，从外面服务`
            : `${built}建好了，在墙上右键拖拽开门`,
      )
      return
    }
    const p = paint.current
    paint.current = null
    if (p?.active) {
      scene?.clearFaceGhost()
      const rect = performance.now() - p.downTime >= LONG_PRESS_MS && isMoved(p, e)
      const hit = pickAt(e)
      const cells = rect ? planeCells(p.anchor, hit ? hit.cell : p.anchor, p.face) : [p.anchor]
      const targets = faceTargets(cells, p.face, solidRef.current)
      if (targets.length === 0) return
      const st = useStore.getState()
      const next =
        p.button === 2
          ? eraseFaces(st.station, targets, p.face)
          : !rect && st.paintMode === 'surface'
            ? fillSurface(st.station, p.anchor[0], p.anchor[1], p.anchor[2], p.face, st.paintFinish)
            : paintFaces(st.station, targets, p.face, st.paintFinish)
      if (next !== st.station) st.commit(next)
      return
    }
    const d = drag.current
    drag.current = null
    if (!scene || !d?.active) return
    const hit = pickAt(e)
    scene.setGhost([], 'add')
    scene.setModulePreview(null)
    scene.setFencePreview(null)
    const rect = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
    const target = hit ? (d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell) : d.anchor
    const st = useStore.getState()
    if (d.module) {
      // A delete-tool press on a module removes that whole piece, wherever the
      // pointer was released.
      const mod = st.station.modules.find((m) => m.id === d.module)
      if (mod) removePlacedModule(mod)
      return
    }
    if (d.fence) {
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
        const seen = new Set<string>()
        for (const [x, y, z] of line) {
          const k = cellKey(x, y, z)
          if (seen.has(k)) continue
          seen.add(k)
          const mod = createModule('fence', x, y, z, nextModuleId(next.modules, 'fence'), rot)
          if (!mod) continue
          // A fence stands on floor like any equipment; bare void holds none.
          const floorHere = next.cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === z) || exitFloorAt(next.modules, x, y, z)
          if (!floorHere) {
            blocked++
            continue
          }
          if (placementBlocked(next.modules, mod) || placementOnTrack(next.cells, mod, next.modules)) {
            blocked++
            continue
          }
          next = addEquipment(next, mod)
          placed++
        }
        if (placed > 0) st.commit(next)
        if (blocked > 0) st.setNotice(placed > 0 ? `围栏放下了 ${placed} 段，${blocked} 格被挡住了` : '这儿放不下围栏，换个地方')
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
      return
    }
    if (d.wall) {
      // A 墙 drag lays a straight axis-aligned run of full-height columns; a
      // quick press is one. The right drag lifts the same run, a whole tagged
      // column at a time.
      const line = rect ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
      if (d.mode === 'add') {
        const { state: next, changed, blocked } = addWalls(st.station, line)
        if (changed > 0) st.commit(next)
        if (blocked > 0) st.setNotice('预留开口要留空：楼梯、扶梯和出入口的地板不能用方块盖住')
      } else {
        const remove = wallColumnsAt(st.station, line)
        if (remove.length === 0) return
        st.commit(removeCells(st.station, remove))
      }
      return
    }
    const cells = rect ? rectCells(d.anchor, target, d.z, d.shift) : [d.anchor]
    if (d.mode === 'add') {
      if (rect && st.autoWalls) {
        // A deliberate 地基 drag with 自动生成墙壁 on draws a walled floor patch:
        // union it with earlier patches and rebuild the auto wall ring around
        // the new edge. With the toggle off it takes the plain-block path below
        // even for a drag — no tags, no walls.
        const next = addFloor(st.station, cells)
        if (next !== st.station) st.commit(next)
      } else {
        const { cells: next, changed, blocked } = addCells(st.station.cells, cells, st.station.modules)
        if (changed > 0) st.commit({ ...st.station, cells: next })
        if (blocked > 0) st.setNotice('预留开口要留空：楼梯、扶梯和出入口的地板不能用方块盖住')
      }
    } else {
      // Only real blocks count against the seed's integrity (§4.1); a rectangle
      // drawn across void would otherwise trip the guard for nothing.
      const remove = pendingCells(cells, 'remove', solidRef.current)
      if (st.station.cells.length - remove.length < 4) return
      // A dug auto-floor brings its wall ring along; a hand-placed block is
      // just removed.
      const next = removeFloor(st.station, remove)
      if (next.cells.length !== st.station.cells.length) st.commit(next)
    }
  }

  // A right-click also fires contextmenu while another button is held, even when
  // its own pointerdown never arrived — so it cancels any previewing drag too.
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    cancelActiveDrag()
  }

  /** Remove one placed module, routing rails and rooms through their own teardown. */
  const removePlacedModule = (mod: Module): void => {
    const st = useStore.getState()
    if (mod.type === 'track') {
      st.removeRail(mod.id)
      st.select(null)
      sceneRef.current?.setModulePreview(null)
      return
    }
    // Facility rooms take their auto walls with them; the floor stays.
    st.commit(
      mod.type === 'shop' || mod.type === 'booth' || mod.type === 'retail'
        ? removeFacility(st.station, mod.id)
        : removeModule(st.station, mod.id),
    )
    st.select(null)
    sceneRef.current?.setModulePreview(null)
    st.setNotice(`已拆掉${moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined)}`)
  }

  /** Right-click: remove the equipment standing on a cell, leaving the block. */
  const bulldoze = (cell: [number, number, number], place?: [number, number, number]): void => {
    const st = useStore.getState()
    // A rail's bed is dug, so the module is found from the hit or the cell above.
    const rail =
      railModuleAt(st.station, cell[0], cell[1], cell[2]) ??
      (place ? railModuleAt(st.station, place[0], place[1], place[2]) : undefined)
    if (rail) {
      removePlacedModule(rail)
      return
    }
    const mod = moduleAt(st.station.modules, cell[0], cell[1], cell[2])
    if (mod) removePlacedModule(mod)
  }

  const placeModule = (cell: [number, number, number], place: [number, number, number], solid: boolean, type: string): void => {
    const st = useStore.getState()
    // A wall-mounted 广告牌 needs only a wall behind it — it may hang over a
    // track, so it never goes through the floor/track rules below.
    if (isWallMountedType(type)) {
      const mod = wallMountPlacement(cell, place, nextModuleId(st.station.modules, type))
      if (!mod) {
        st.setNotice('广告牌要贴在墙上：先砌一堵墙，用 R 转方向让背面朝墙')
        return
      }
      if (placementBlocked(st.station.modules, mod)) {
        st.setNotice('这儿已经有设备了，换个地方')
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
      st.setNotice('出入口只能放在地面')
      return
    }
    const mod = buildPlacementModule(type, at, nextModuleId(st.station.modules, type))
    if (!mod) return
    // Equipment has a collision box: two may not share space.
    if (placementBlocked(st.station.modules, mod)) {
      st.setNotice('这儿已经有设备了，换个地方')
      return
    }
    // The rails sit on a track bed, not on passenger floor: no equipment there.
    if (placementOnTrack(st.station.cells, mod, st.station.modules)) {
      st.setNotice('轨道上不能放设备')
      return
    }
    // 广告牌 is wall-mounted: it needs a solid wall block behind it.
    if (wallMountMissing(st.station.cells, mod)) {
      st.setNotice('广告牌要贴在墙上：先砌一堵墙，用 R 转方向让背面朝墙')
      return
    }
    // 指示牌 / 电视 hang from the ceiling: they need a solid slab one storey up.
    if (ceilingMountMissing(st.station.cells, mod)) {
      st.setNotice('指示牌和电视要吊在天花板下：上面得有一层楼板（四米高）')
      return
    }
    // An escalator punches through walls/ceilings on its own: allow it whenever
    // both landings stand on solid floor or exit floor, and refuse it otherwise.
    if (mod.type === 'escalator' && !escalatorBasesSolid(st.station.cells, st.station.modules, mod)) {
      st.setNotice('扶梯两端都得有实心地板')
      return
    }
    // A lift stands on a 2 × 2 m footprint: all four cells must be floor.
    if (mod.type === 'lift' && !liftFootprintFloorOk(at[0], at[1], at[2])) {
      st.setNotice('电梯占地 2×2 米：四个格子都要有地板')
      return
    }
    st.commit(addEquipment(st.station, mod))
  }

  /**
   * Place or extend an elevator. A hover in the same column as an existing shaft
   * grows it one storey — up if the hover is in the shaft's upper half, down if
   * below — with no floor check, so a shaft can run past a level that has no
   * slab. Otherwise a fresh two-storey shaft is dropped on the hovered floor.
   */
  const placeLift = (hit: { cell: [number, number, number]; place: [number, number, number]; solid: boolean }): void => {
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
    placeModule(hit.cell, hit.place, hit.solid, 'lift')
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          hoverRef.current = null
          setBuildMeasure(null)
          sceneRef.current?.setCursor(null)
          sceneRef.current?.setModulePreview(null)
          sceneRef.current?.setGhost([], 'remove')
          sceneRef.current?.clearFaceGhost()
        }}
      />
      {buildMeasure && (
        <div className="buildMeasure" style={{ left: buildMeasure.left + 14, top: buildMeasure.top + 14 }}>
          {buildMeasure.text}
        </div>
      )}
      <ViewCube sceneRef={sceneRef} />
    </>
  )
}
