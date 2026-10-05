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
  facePresent,
  fenceRotForLine,
  fillSurface,
  GROUND_Z,
  halfWallRunSide,
  thinWallSideMap,
  nextExitName,
  nextModuleId,
  paintFaces,
  paintStairSurface,
  paintZoneCells,
  placeFacility,
  plannedAutoWalls,
  removeCells,
  removeFloor,
  wallColumnAt,
  wallColumnsAt,
  wallDirRot,
  wallRun,
  wallSnap,
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
  type WallDir,
} from '../build/model.ts'
import { finishDef } from '../sim/finishes.ts'
import { exitFloorAt, exitRunSnap } from '../sim/exits.ts'
import { liftExtendedDown, liftExtendedUp, liftFootprintCells, type LiftModule } from '../sim/lifts.ts'
import { ESCALATOR_BAND } from '../sim/constants.ts'
import { planStairLanes, stairLanes } from '../sim/stairs.ts'
import { moduleAt, isTrackCell, moveCandidate, trackAt, placementBlocked, placementColliders, placementOnTrack, reservedOpening, ceilingMountMissing, wallMountMissing, wallMountStandCell, autofaceWallMount } from '../sim/placement.ts'
import { escalatorBasesSolid } from '../sim/openings.ts'
import { ZONE_LIST, zoneIndex } from '../sim/zones.ts'
import { FACILITY_OPTIONS, placementPreviewKey, setFrameHandler, signModuleWithPreview, useStore, isDecorType, isExitType, isFacilityBrush, isFenceType, isWallMountedType, moduleLabel, type Tool, type ZoneBrush } from './store.ts'
import type { Cell, Face, FinishId, Module, Vec3i, WallSide } from '../sim/types.ts'
import { packKey } from '../sim/types.ts'
import { defaultLine, freeTunnelEnd, makeTrack, makeTunnel, railModuleAt, trackBlockReason, trackColliders, trackPieceForLine } from '../build/rail.ts'
import { trackOriginForCentre } from '../sim/track.ts'
import { removeSweptModules, sweepFamily, sweepThrough } from './sweep.ts'
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

/**
 * The id a carried piece (移动) wears as a ghost. A translated piece must not mint
 * into the caches keyed by a *placed* module's id — a 指示牌's printed plate and a
 * 电视's station plate are looked up by id, and a preview owns only what it made
 * itself (`SceneRenderer.setModulePreview`).
 */
const MOVE_GHOST_ID = 'move-preview'

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

/**
 * Where the 墙 tool stands its next column for a pick, and which wall face it
 * takes there. The tool snaps by cell rather than by sub-cell geometry, so this
 * decides *where* the block goes and *which* edge it presents. The answer is a
 * pure function of the surrounding geometry — the player's rotation is never an
 * input, it is an *output* (`snap.dir`) — so R can never leave the tool in a
 * state where it refuses to snap. R only steps the candidate faces at a corner.
 */
function wallSnapAt(
  hit: { cell: [number, number, number]; place: [number, number, number]; solid: boolean; point: readonly number[] },
  cells: readonly Cell[],
  cycle: number,
): { base: [number, number, number]; rot: number; dirs: WallDir[] } {
  const anchor = hit.solid ? hit.place : hit.cell
  const snap = wallSnap(cells, anchor, [hit.point[0], hit.point[1]], cycle)
  return { base: [snap.x, snap.y, snap.z], rot: wallDirRot(snap.dir), dirs: snap.dirs }
}

/**
 * The **半墙** side a run of wall columns takes: what **R** has stepped to, given
 * the faces the anchor's own geometry offers (`halfWallRunSide`). Null while the 墙
 * tool is laying full-block walls, which have no thickness to choose.
 */
function halfWallSideFor(line: Array<[number, number, number]>, open: readonly WallDir[], st: { halfWall: boolean; wallSnapCycle: number }): WallDir | null {
  return st.halfWall ? halfWallRunSide(line, open, st.wallSnapCycle) : null
}

/**
 * The pending cells as the ghost's mesher wants them: a **半墙** run is meshed half
 * a block thick, so the preview shows the wall the release will lay and not a full
 * one. Undefined for a full wall, which the mesher already draws as a block.
 */
function thinGhost(cells: Array<[number, number, number]>, side: WallDir | null): Map<number, WallSide> | undefined {
  if (side === null) return undefined
  const out = new Map<number, WallSide>()
  for (const [x, y, z] of cells) out.set(packKey(x, y, z), side)
  return out
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

/**
 * The cells of a rectangle that actually present the face: the same rule the 整面
 * flood fills by (`facePresent`), so a dragged rectangle and an `M` click offer one
 * surface. It is also what knows a 半墙's panel is half a block thick and that its
 * inner face sits inside its own cell rather than on the cell's boundary.
 */
function faceTargets(
  cells: Array<[number, number, number]>,
  face: Face,
  solid: Set<string>,
  thin: Map<string, WallSide> = new Map(),
): Array<[number, number, number]> {
  return cells.filter(([x, y, z]) => facePresent(solid, thin, x, y, z, face))
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
  /**
   * Every cell of the station that draws **half a block thick** — a 半墙 the player
   * laid and every block a ramp kept beside its run — by cell key → the side the
   * panel hugs, refreshed with the station. A paint brush reads it to offer the
   * panel's own inner face, which is a surface inside its cell rather than on the
   * cell's boundary (`faceTargets`); without the derived ones a stair's own half
   * wall was a surface the brush would not colour.
   */
  const thinRef = useRef<Map<string, WallSide>>(new Map())
  /** True once the first station build has framed the home view (refresh only, not edits). */
  const framedRef = useRef(false)
  /**
   * The tile under the pointer for the equipment and 地基 tools, so R and Tab can
   * rebuild the ghost already under it (`refreshModulePreview`,
   * `refreshFoundationPreview`).
   */
  const hoverRef = useRef<{ cell: [number, number, number]; place: [number, number, number]; solid: boolean; point?: [number, number] } | null>(null)
  const drag = useRef<{
    active: boolean
    button: number
    mode: 'add' | 'remove'
    anchor: [number, number, number]
    z: number
    shift: boolean
    /** True for the 墙 tool's drag, whose cells are full-height wall columns. */
    wall?: boolean
    /**
     * A wall drag that never becomes a run: the 地基 tool's **半墙** mode lays one
     * block per click, so the release takes the press's own cell whatever the
     * pointer did in between.
     */
    single?: boolean
    /**
     * The faces the pressed column's own geometry opens onto (`wallSnap`'s
     * candidates), kept so a 半墙 can re-derive its thickness side as **R** steps it.
     * A single column has no run to be perpendicular to, so all four sides are on
     * offer, the geometry's own first (`halfWallSideDirs`).
     */
    wallDirs?: WallDir[]
    /** True for the 围栏 tool's drag, which lays one fence panel per cell. */
    fence?: boolean
    /**
     * The delete tool's module drag: the ids it has collected, the pressed piece
     * first. A single id is the plain "remove this whole piece" press; a longer
     * list is a same-type sweep (§9.5), bulldozed in one commit on release.
     */
    modules?: string[]
    /**
     * The sweep identity every collected module shares (`sweepFamily`). Unset
     * for a piece that may not be swept — a room, a rail, an exit, a 楼梯 — so
     * its drag stays the single piece it pressed.
     */
    family?: string
    /** Last pointer position, so a fast drag samples the path between events. */
    lx?: number
    ly?: number
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
  // A 指示牌 whose board the editor has open draws the board being arranged, not the
  // one committed (`signModuleWithPreview`). Subscribing to the id rather than to the
  // whole preview keeps this from re-rendering the viewport on every dragged bin —
  // the `version` bump the editor raises alongside it is what redraws the meshes.
  const signPreviewId = useStore((s) => s.signPreview?.moduleId ?? null)
  // The piece in the air (移动), by id: the station is drawn without it, so the
  // translucent ghost under the pointer is the only copy on screen. Subscribing to
  // the id — rather than to the whole draft — keeps a pointer move from rebuilding
  // the station's meshes.
  const moveId = useStore((s) => s.moveDraft?.module.id ?? null)
  // The carried piece and its rotation: the two things an R or a fresh lift change
  // about the ghost, so they are all the ghost effect has to watch.
  const moveKey = useStore((s) => (s.moveDraft ? `${s.moveDraft.module.id}|${s.moveDraft.rot}` : ''))
  const tool = useStore((s) => s.tool)
  // Everything the equipment ghost is drawn from, as one key: the piece, its
  // rotation and each Tab cycle. Subscribing to the key — rather than to the
  // fields — is what lets R and Tab redraw a ghost that is already under the
  // pointer, and it keeps the list in one place (`placementPreviewKey`).
  const placementKey = useStore(placementPreviewKey)
  const railRot = useStore((s) => s.railRot)
  const railLineId = useStore((s) => s.railLineId)
  const railDir = useStore((s) => s.railDir)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const activeZ = useStore((s) => s.activeZ)
  const ghostOther = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
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

  // 隐藏天花板 is a slice setting like the level itself: it is applied on mount
  // (the renderer's own default matches the store's) and on every change.
  useEffect(() => {
    sceneRef.current?.setAutoCeiling(autoCeiling)
  }, [autoCeiling])

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
   * run was refused, so the whole ghost flags red, and `colliderIds` names the
   * placed modules the refused panels hit.
   */
  const fenceRunPreview = (line: Array<[number, number, number]>, rot: number): { mods: Module[]; blocked: boolean; colliderIds: string[] } => {
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
      const floorHere = st.station.cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === z) || exitFloorAt(st.station.modules, x, y, z)
      if (!floorHere || placementOnTrack(st.station.cells, mod, st.station.modules)) {
        blocked = true
        continue
      }
      const hit = placementColliders(st.station.modules, mod)
      if (hit.length > 0) {
        blocked = true
        for (const m of hit) if (!colliderIds.includes(m.id)) colliderIds.push(m.id)
        continue
      }
      mods.push(mod)
    }
    return { mods, blocked, colliderIds }
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
   * escalator dropped inside an exit head-house snaps into a bay: its upper
   * landing on the street in the column under the pointer, its base one storey
   * down toward the mouth, so
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
  const isStraightStair = (type: string): boolean => type === 'stair' || type === 'stair-straight'

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
  const buildStairLanes = (type: string, cell: [number, number, number], id: string): Module[] => {
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
  const buildPlacementModules = (type: string, cell: [number, number, number], id: string): Module[] => {
    if (isStraightStair(type) && stairLanes(useStore.getState().stairWidth) > 1) return buildStairLanes(type, cell, id)
    const one = buildPlacementModule(type, cell, id)
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
  const wallMountPlacement = (
    cell: [number, number, number],
    place: [number, number, number],
    id: string,
    near?: readonly [number, number],
  ): { mod: Module | null; noWall: boolean } => {
    const st = useStore.getState()
    const at = wallMountStandCell(st.station.cells, cell, place)
    const draft = createModule(st.moduleType, at[0], at[1], at[2], id, st.moduleRot, st.stairWidth, st.escalatorDir)
    if (!draft) return { mod: null, noWall: true }
    const mod = autofaceWallMount(st.station.cells, draft, near)
    return { mod, noWall: wallMountMissing(st.station.cells, mod) }
  }

  /**
   * Rebuild the equipment hover ghost from the last hovered tile. Only the
   * equipment tool has one: the 地基 tool keeps the same hover ref for its own
   * ghost, and a Tab in *that* tool must not drop a piece into the station
   * (`placementPreviewKey` names the settings of both).
   */
  const refreshModulePreview = (): void => {
    const scene = sceneRef.current
    const h = hoverRef.current
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
      const { mod: billboard, noWall } = wallMountPlacement(h.cell, h.place, 'preview', h.point)
      const blocked = noWall || !billboard || placementBlocked(st.station.modules, billboard)
      const colliderIds = billboard && !noWall ? placementColliders(st.station.modules, billboard).map((m) => m.id) : []
      scene.setCursor(h.cell, !blocked)
      scene.setModulePreview(billboard, blocked)
      scene.setCollisionHighlight(blocked ? colliderIds : null)
      return
    }
    // 电梯: hovering any cell of an existing shaft previews its extension even
    // where that level has no floor; a fresh lift still needs floor under it.
    const liftExt = st.moduleType === 'lift' ? liftHover(x, y, z) : null
    // A ramp dropped inside an exit snaps into a bay and descends to the floor
    // below, so the exit's own floor is enough to stand its upper landing on.
    const snap = isStraightRamp(st.moduleType) ? exitRunSnap(st.station.modules, x, y, z) : null
    const placeable = (floorHere || !!liftExt || !!snap) && (!isExitType(st.moduleType) || onGround)
    let mods: Module[] = []
    let liftFloorMissing = false
    if (st.moduleType === 'lift') {
      if (liftExt) {
        mods = [liftExt.mod]
      } else if (floorHere) {
        const lift = createModule('lift', x, y, z, 'preview', st.moduleRot, st.stairWidth, st.escalatorDir)
        if (lift) mods = [lift]
        liftFloorMissing = !liftFootprintFloorOk(x, y, z)
      }
    } else if (placeable) {
      mods = buildPlacementModules(st.moduleType, h.cell, 'preview')
    }
    // An escalator may run through walls/ceilings — only its two landings must
    // be solid floor (or exit floor). Anything in between is carved on placement.
    const blocked =
      mods.some(
        (mod) =>
          placementBlocked(st.station.modules, mod) ||
          (mod.type === 'escalator' && !escalatorBasesSolid(st.station.cells, st.station.modules, mod)) ||
          placementOnTrack(st.station.cells, mod, st.station.modules) ||
          wallMountMissing(st.station.cells, mod) ||
          ceilingMountMissing(st.station.cells, mod),
      ) || liftFloorMissing
    const colliderIds: string[] = []
    for (const mod of mods) {
      for (const m of placementColliders(st.station.modules, mod)) {
        if (!colliderIds.includes(m.id)) colliderIds.push(m.id)
      }
    }
    scene.setCursor(h.cell, placeable && !blocked)
    scene.setModulePreview(mods.length > 0 ? mods : null, blocked)
    scene.setCollisionHighlight(blocked ? colliderIds : null)
  }

  /**
   * Draw the **半墙** ghost for one block: a single half-thick course, on the side
   * **R** has stepped to, so the preview is the piece — the half thickness *is* the
   * wall (`thinGhost`). `open` is the cell's own geometry (`wallSnap`'s candidate
   * faces), which the side rule orders the player's choice behind.
   */
  const drawHalfWallGhost = (base: [number, number, number], open: readonly WallDir[]): void => {
    const scene = sceneRef.current
    if (!scene) return
    const st = useStore.getState()
    const cells = pendingCells([base], 'add', solidRef.current, st.station.modules)
    scene.setGhost(cells, 'add', undefined, thinGhost(cells, halfWallSideFor([base], open, st)))
  }

  /**
   * Rebuild the 地基 tool's hover ghost from the last tile it was over: the patch or
   * the single **半墙** block (Tab), and for a 半墙 the side **R** has stepped to. Shared by
   * the pointer move and the Tab / R effect, because a ghost is only redrawn when
   * its key changes — nothing else would rebuild it under a still pointer
   * (`placementPreviewKey`, `scene.setGhost`).
   */
  const refreshFoundationPreview = (): void => {
    const scene = sceneRef.current
    const h = hoverRef.current
    if (!scene || !h) return
    const st = useStore.getState()
    if (st.tool !== 'block') return
    const base: [number, number, number] = h.solid ? h.place : h.cell
    if (st.halfWall) {
      drawHalfWallGhost(base, wallSnap(st.station.cells, base, h.point ?? null, 0).dirs)
    } else {
      scene.setGhost([base], 'add')
    }
    scene.setCursor(base, true)
    // The patch's own size badge belongs to the block brush; it comes back on the
    // next pointer move if that is the mode the player is in.
    setBuildMeasure(null)
  }

  /**
   * The cell a carried piece is aimed at: the floor block under the pointer, or —
   * for a 广告牌, which bolts to a wall and may hang over the track where there is
   * no floor in front of it — the cell in front of that wall, exactly as a fresh
   * placement resolves the same hover (`wallMountStandCell`).
   */
  const moveAnchorAt = (h: { cell: [number, number, number]; place: [number, number, number]; solid: boolean }): Vec3i => {
    const st = useStore.getState()
    const d = st.moveDraft
    if (d && isWallMountedType(d.module.type)) {
      const [x, y, z] = wallMountStandCell(st.station.cells, h.cell, h.place)
      return { x, y, z }
    }
    const [x, y, z] = h.solid || exitFloorAt(st.station.modules, h.cell[0], h.cell[1], h.cell[2]) ? h.cell : h.place
    return { x, y, z }
  }

  /** Drop the lift's ghost, cursor and highlight. The piece itself is untouched. */
  const clearMovePreview = (): void => {
    sceneRef.current?.setModulePreview(null)
    sceneRef.current?.setCollisionHighlight(null)
    sceneRef.current?.setCursor(null)
  }

  /**
   * Rebuild a carried piece's ghost where it is aimed. The piece is *not* in the
   * drawn station while it is in the air (`moveId`), so this translucent copy —
   * the same one a fresh placement shows — is the whole read of "in the hand".
   *
   * With no hover (the pointer is off the canvas, or on the 信息 card reaching for
   * 确认) the piece stays parked where it was last aimed, so the card still has
   * something to drop. Everything the ghost shows is pushed back into the draft
   * (`aimMove`), including the exact module it would place, so the 确认 and the commit
   * cannot disagree with what is on screen.
   */
  const refreshMovePreview = (): void => {
    const scene = sceneRef.current
    const st = useStore.getState()
    const d = st.moveDraft
    if (!scene || !d) return
    const h = hoverRef.current
    const at = h ? moveAnchorAt(h) : d.at
    if (!at) {
      clearMovePreview()
      st.aimMove(null, null, '')
      return
    }
    // The piece is rebuilt from the **document's** copy every time, so a board
    // edited, or an undo taken, while it is in the air shows up under the pointer
    // instead of a lift-time snapshot — its `cfg` is the live one; only the cell
    // and the rotation are the player's aim.
    const current = st.station.modules.find((m) => m.id === d.module.id) ?? d.module
    const { module: candidate, reason } = moveCandidate(st.station.cells, st.station.modules, current, at, d.rot)
    // A ghost carries a private id: a 指示牌's printed plate and a 电视's station
    // plate are cached per module id, and a preview must never mint into the copy a
    // placed piece owns (`setModulePreview` disposes what its ghost created).
    scene.setCursor([at.x, at.y, at.z], reason === '')
    scene.setModulePreview({ ...candidate, id: MOVE_GHOST_ID }, reason !== '')
    scene.setCollisionHighlight(reason === '' ? null : placementColliders(st.station.modules, candidate).map((m) => m.id))
    st.aimMove(at, candidate, reason)
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
    const colliderIds = mod && mod.type === 'track' && blocked ? trackColliders(st.station, mod).map((m) => m.id) : []
    scene.setCursor(h.cell, h.solid && !blocked)
    scene.setModulePreview(mod, blocked)
    scene.setCollisionHighlight(blocked ? colliderIds : null)
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
      scene.setCollisionHighlight(null)
      return
    }
    const mod = makeTunnel(src, freeTunnelEnd(st.station, src, h.cell), st.tunnelLength, 'preview')
    const blocked = trackBlockReason(st.station, mod) !== null
    const colliderIds = blocked ? trackColliders(st.station, mod).map((m) => m.id) : []
    scene.setCursor(h.cell, !blocked)
    scene.setModulePreview(mod, blocked)
    scene.setCollisionHighlight(blocked ? colliderIds : null)
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
    sceneRef.current?.setCollisionHighlight(null)
    return true
  }

  // ESC cancels any in-progress drag even when the pointer never moves again, and
  // Enter / ESC are the keyboard halves of 移动's 确认 / 取消 — which live in the 信息
  // card, so the keys are what makes the drop reachable without leaving the canvas.
  useEffect(() => {
    const onCancelKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Enter') {
        if (!useStore.getState().moveDraft) return
        e.preventDefault()
        useStore.getState().confirmMove()
        if (!useStore.getState().moveDraft) clearMovePreview()
        return
      }
      if (e.key !== 'Escape') return
      if (cancelActiveDrag()) return
      const st = useStore.getState()
      if (st.signEditorFor !== null || st.signComposing) return
      if (!st.moveDraft) return
      st.cancelMove()
      clearMovePreview()
    }
    window.addEventListener('keydown', onCancelKey)
    return () => window.removeEventListener('keydown', onCancelKey)
  }, [])

  // A ghost belongs to a tool; leaving one must not strand a preview — and a piece
  // in the air is put back where it came from, because a lift is not an edit and
  // switching tools is not a way to lose one.
  useEffect(() => {
    hoverRef.current = null
    drag.current = null
    paint.current = null
    zoneDrag.current = null
    facilityDrag.current = null
    setBuildMeasure(null)
    useStore.getState().cancelMove(false)
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.setGhost([], 'remove')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setCursor(null)
    sceneRef.current?.setModulePreview(null)
    sceneRef.current?.setFencePreview(null)
    sceneRef.current?.setCollisionHighlight(null)
  }, [tool])

  // Rotating (R), switching the equipment, or cycling its width, direction,
  // 闸机's lane or fence, and the 地基 tool's 半墙 mode or the side R stepped it to
  // (Tab / R) rebuild the ghost at the hovered tile at once, instead of waiting for
  // the pointer to move again.
  useEffect(() => {
    refreshModulePreview()
    refreshFoundationPreview()
  }, [placementKey])

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
    // The renderer on `window`, for the same reason the store is there (`boot.tsx`):
    // a browser-driven check can aim the camera at a corner and photograph it. Only
    // the live renderer, no copy, so a probe and the game cannot disagree.
    window.__scene = scene
    scene.onStats = (s) => useStore.getState().setStats(s)
    const resize = (): void => scene.resize(canvas.clientWidth, canvas.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    setFrameHandler((count, agents, density, trains, lifts, intervalMs, simTime) => {
      scene.setAgents(agents, count, intervalMs)
      scene.setTrains(trains)
      scene.setLifts(lifts)
      // The 电视 station plate prints the station clock, so it follows the sim.
      scene.setSimClock(simTime)
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
    thinRef.current = thinWallSideMap(station.cells, station.modules)
    // The board the editor is arranging, drawn where the sign it belongs to hangs —
    // and, for a piece 移动 has picked up, nothing at all: it is in the air,
    // so the translucent ghost under the pointer is the only copy drawn.
    const lifted = st.moveDraft?.module.id
    const modules = station.modules
      .filter((m) => m.id !== lifted)
      .map((m) => signModuleWithPreview(m, st.signPreview))
    scene.setStation(toData({ ...station, modules }))
    scene.setAutoCeiling(st.autoCeiling)
    scene.setLevel(st.activeZ, st.ghostOtherLevels)
    scene.setCutaway(st.cutaway)
    // On a fresh page load the demo station must open on the home view; the
    // constructor's preset ran before the station existed, so frame it now. A
    // later edit rebuilds the station but must not yank the camera.
    if (!framedRef.current) {
      framedRef.current = true
      scene.setPreset('iso')
    }
  }, [version, station, signPreviewId, moveId])

  // A lifted piece (移动) is drawn from its own ghost, so a fresh lift or an R while
  // it is in the air rebuilds that ghost at once instead of waiting for the next
  // pointer move. When the lift ends the ghost goes with it — and a cancel is not a
  // commit, so nothing else has rebuilt the station to drop it: that is this effect's
  // job, which is what makes the card's 取消 clear the piece on screen. `version` is in
  // the list because a commit clears the ghost with the station (`setStation`), so an
  // edit made while a piece is in the air — an undo, say — puts it back on screen.
  useEffect(() => {
    if (useStore.getState().moveDraft) refreshMovePreview()
    else clearMovePreview()
  }, [moveKey, version])

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
    // 移动 (§9.5): a piece in the air owns the pointer, whichever tool was active
    // when the 信息 card lifted it. A left press drops it at the pointer — aimed
    // from the press itself, so a touch that never saw a pointer move still lands
    // where it was tapped — and a right press puts it back where it came from.
    // Both are the card's 确认 and 取消.
    if (st.moveDraft) {
      if (e.button === 2) {
        e.preventDefault()
        st.cancelMove()
        clearMovePreview()
        return
      }
      const liftHit = pickAt(e)
      if (liftHit) {
        hoverRef.current = {
          cell: liftHit.cell,
          place: liftHit.place,
          solid: liftHit.solid,
          point: [liftHit.point[0], liftHit.point[1]],
        }
        refreshMovePreview()
      }
      e.preventDefault()
      st.confirmMove()
      if (!useStore.getState().moveDraft) clearMovePreview()
      return
    }
    const hit = pickAt(e)
    // A stair's walking surface is the **piece**, not the floor it stands on: the
    // pointer lands on treads, which no cell owns (and the flights run over a
    // carved well), so the brush resolves the stair before anything that needs the
    // cell the ray hit — its treads, risers and half-landing are one material.
    if (tool === 'paint') {
      const pickedId = scene.pickModule(e.clientX, e.clientY)
      const stair = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
      if (stair && stair.type === 'stair') {
        if (st.paintMode === 'pick') {
          st.setPaintFinish(stair.cfg.finish ?? faceFinish(st.station.cells, stair.from.x, stair.from.y, stair.from.z, 'top'))
          // 取色 is momentary, exactly as it is over a floor cell.
          st.resumePaintMode()
          return
        }
        // One press is the whole gesture: a stair has one walking surface, so
        // nothing is held open for a drag. Right-click hands it back to the floor.
        e.preventDefault()
        const next = paintStairSurface(st.station, stair.id, e.button === 2 ? null : st.paintFinish)
        if (next !== st.station) st.commit(next)
        return
      }
    }
    if (!hit) return
    if (tool === 'select') {
      // Right-click bulldozes the equipment under the pointer.
      if (e.button === 2) {
        const pickedId = scene.pickModule(e.clientX, e.clientY)
        const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
        if (picked) removePlacedModule(picked)
        else bulldoze(hit.cell, hit.place, pickFacing())
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
          const { mods, blocked, colliderIds } = fenceRunPreview([hit.cell], st.moduleRot)
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
        if (e.button === 2) {
          bulldoze(hit.cell, hit.place, pickFacing())
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
            bulldoze(hit.cell, hit.place, pickFacing())
            return
          }
          const pointed = moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2])
          if (pointed && pointed.type !== 'shop' && pointed.type !== 'booth' && pointed.type !== 'retail') {
            bulldoze(hit.cell, hit.place, pickFacing())
            return
          }
          const room = facilityAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2])
          st.setNotice(room ? '货架要一个一个拆：点中货架再右键' : '这里没有可拆的装饰')
          return
        }
        bulldoze(hit.cell, hit.place, pickFacing())
        return
      }
      placeModule(hit.cell, hit.place, hit.solid, st.moduleType, [hit.point[0], hit.point[1]])
      return
    }
    if (tool === 'paint') {
      if (!hit.solid) return
      const face = dominantFace(hit.normal)
      if (st.paintMode === 'pick') {
        st.setPaintFinish(faceFinish(st.station.cells, hit.cell[0], hit.cell[1], hit.cell[2], face))
        // 取色 is momentary: hand the brush back in the `N`/`M` mode it was entered
        // with, so eyedropping a whole-surface brush does not drop it to 单块.
        st.resumePaintMode()
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
      scene.setFaceGhost(faceTargets([hit.cell], face, solidRef.current, thinRef.current), face, paintColour(e.button, st.paintFinish))
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
        if (hit.solid) bulldoze(hit.cell, hit.place, pickFacing())
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
      // The add path snaps the column to the cell that faces open space and to
      // the R-selected wall face; the remove path lifts exactly what the pointer
      // is on, a whole tagged column at a time.
      const anchor = mode === 'add' ? wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base : hit.cell
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
      // whole piece goes, not the floor block beneath it — except a 围栏 panel,
      // which drags out a line of its own like the 围栏 tool (see below).
      const pickedId = scene.pickModule(e.clientX, e.clientY)
      const picked = pickedId ? st.station.modules.find((m) => m.id === pickedId) : undefined
      if (picked) {
        e.preventDefault()
        // A fence panel is one cell of a run, so the delete tool drags it like
        // the 围栏 tool: press anchors, a drag draws a straight line, and the
        // release lifts every panel on it. Any other module is removed whole —
        // and an equipment (设备) or 装饰 piece starts a same-type sweep: hold
        // the button and drag across matching pieces, and each one the pointer
        // passes through is highlighted and joins the pending list (§9.5).
        const fence = picked.type === 'fence'
        const family = fence ? null : sweepFamily(picked)
        drag.current = {
          active: true,
          button: e.button,
          mode: 'remove',
          anchor: [picked.x, picked.y, picked.z],
          z: picked.z,
          shift: true,
          fence: fence || undefined,
          // A piece that may not be swept still rides the same list, so the
          // release has one path: a one-id sweep is the plain bulldoze.
          modules: fence ? undefined : [picked.id],
          family: family ?? undefined,
          lx: e.clientX,
          ly: e.clientY,
          sx: e.clientX,
          sy: e.clientY,
          downTime: performance.now(),
        }
        scene.setModulePreview(fence ? null : picked, true)
        scene.setCollisionHighlight(null)
        scene.setGhost(fence ? [[picked.x, picked.y, picked.z]] : [], 'remove')
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
      scene.setCollisionHighlight(null)
      scene.setCursor(hit.cell, true)
      return
    }
    // 地基: a click is one block, a long press + drag is a rectangle on the
    // pressed plane (the depth you are on, stepped with Q/E). With 自动生成墙壁
    // on (the default) the patch grows an auto-wall ring; off, it is plain blocks.
    // With **半墙** on (Tab) it is neither: the click lays one half-block wall
    // block where it lands — the 半墙 mode is one piece at a time, and it is what
    // the patch grows instead of the ring, so there is no patch and no auto wall
    // (`store.ts` keeps the two modes exclusive).
    e.preventDefault()
    const mode: 'add' | 'remove' = e.button === 2 ? 'remove' : 'add'
    const anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
    // A right-press on a tagged wall lifts the whole column, exactly as the 墙 tool's
    // own right-drag does — what the mode builds, it takes back in one action rather
    // than a course at a time. Anywhere else the 地基 tool's ordinary dig stands, so
    // a misplaced floor block is still dug without leaving the mode.
    if (mode === 'remove') {
      const column = wallColumnAt(st.station, anchor[0], anchor[1], anchor[2])
      if (column.length > 0) {
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
        scene.setGhost(column, 'remove')
        scene.setCursor(anchor, true)
        return
      }
    }
    if (mode === 'add' && st.halfWall) {
      // The side follows the wall tool's own rule — the cell's geometry first, then
      // whatever **R** has stepped to (`halfWallRunSide`) — but the block stands
      // exactly where the click landed: a 半墙 is placed like a block, not snapped
      // to an edge like the 墙 tool's course.
      const open = wallSnap(st.station.cells, anchor, [hit.point[0], hit.point[1]], 0).dirs
      drag.current = {
        active: true,
        button: e.button,
        mode,
        anchor,
        z: anchor[2],
        shift: false,
        wall: true,
        single: true,
        wallDirs: open,
        sx: e.clientX,
        sy: e.clientY,
        downTime: performance.now(),
      }
      drawHalfWallGhost(anchor, open)
      scene.setCursor(anchor, true)
      return
    }
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
      // A carried piece (移动) keeps its parked ghost: only where it is aimed, not
      // whether it exists, depends on the pointer.
      if (!useStore.getState().moveDraft) {
        scene.setCursor(null)
        scene.setModulePreview(null)
        scene.setCollisionHighlight(null)
      }
      return
    }
    const st = useStore.getState()
    // 移动 again: while a piece is in the air every move only aims it. Nothing else
    // the pointer could do — selecting, building, painting — happens until it is
    // dropped or put back.
    if (st.moveDraft) {
      hoverRef.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
      refreshMovePreview()
      return
    }
    if (st.tool === 'wall') {
      const d = drag.current
      if (d?.active) {
        const target = d.mode === 'add' ? wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base : hit.cell
        // Only a deliberate press becomes a run; a quick press stays one column.
        // The run snaps to the dominant axis — straight 90° lines only. The
        // anchor was already snapped at the press, so a drag extends that line
        // instead of re-snapping every cell it crosses.
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
      const c = wallSnapAt(hit, st.station.cells, st.wallSnapCycle).base
      scene.setGhost(pendingCells(wallRun([c]), 'add', solidRef.current, st.station.modules), 'add')
      scene.setCursor(c, true)
      return
    }
    if (st.tool === 'delete') {
      const d = drag.current
      if (d?.active) {
        if (d.fence) {
          // Drag a straight, axis-aligned line across the 围栏 run: highlight
          // exactly the panels the release will lift, one red cell each. A quick
          // tap stays one panel even if the pointer jitters.
          const target: [number, number, number] = [hit.cell[0], hit.cell[1], d.z]
          const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
          const line = dragging ? straightLineCells(d.anchor, target, d.z) : [d.anchor]
          const seen = new Set<string>()
          const cells: Array<[number, number, number]> = []
          for (const [x, y, z] of line) {
            const mod = moduleAt(st.station.modules, x, y, z)
            if (!mod || mod.type !== 'fence' || seen.has(mod.id)) continue
            seen.add(mod.id)
            cells.push([mod.x, mod.y, mod.z])
          }
          scene.setModulePreview(null)
          scene.setCollisionHighlight(null)
          scene.setGhost(cells, 'remove')
          scene.setCursor(dragging ? line[line.length - 1] : d.anchor, true)
          return
        }
        if (d.modules) {
          // A module delete: the pressed piece stays pending while the button
          // holds, and — for a piece that may be swept — every *matching* piece
          // the pointer passes over joins the list, so the highlight reads as
          // exactly "what this release will bulldoze". A sweep never shrinks: a
          // piece crossed once stays pending even if the pointer leaves it.
          const ids = d.modules
          if (d.family && isMoved(d, e)) {
            sweepThrough(
              ids,
              d.family,
              { x: d.lx ?? d.sx, y: d.ly ?? d.sy },
              { x: e.clientX, y: e.clientY },
              (x, y) => scene.pickModule(x, y),
              st.station.modules,
            )
          }
          d.lx = e.clientX
          d.ly = e.clientY
          const mods = ids
            .map((id) => st.station.modules.find((m) => m.id === id))
            .filter((m): m is Module => m !== undefined)
          scene.setGhost([], 'remove')
          scene.setCollisionHighlight(null)
          scene.setModulePreview(mods, true)
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
        scene.setCollisionHighlight(null)
        scene.setModulePreview(picked, true)
        scene.setCursor([picked.x, picked.y, picked.z], true)
      } else {
        scene.setModulePreview(null)
        scene.setCollisionHighlight(null)
        scene.setGhost(pendingCells([hit.cell], 'remove', solidRef.current), 'remove')
        scene.setCursor(hit.cell, hit.solid)
      }
      return
    }
    if (st.tool === 'block') {
      // The tile under the pointer, so Tab (半墙) and R (its side) rebuild the
      // ghost in place instead of waiting for the next move.
      hoverRef.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
      const d = drag.current
      // A wall remove drag — the right-press that landed on a 半墙 or any other
      // tagged column — previews the columns the release lifts, exactly as the 墙
      // tool's own right-drag does.
      if (d?.active && d.wall === true && d.mode === 'remove') {
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
        const line = dragging ? straightLineCells(d.anchor, hit.cell, d.z) : [d.anchor]
        scene.setGhost(wallColumnsAt(st.station, line), 'remove')
        scene.setCursor(dragging ? hit.cell : d.anchor, true)
        setBuildMeasure(null)
        return
      }
      // 半墙 mode, add path: one wall block, never a patch and never a run, so
      // there is no rectangle to preview and no patch size to report.
      if (st.halfWall && d?.mode !== 'remove') {
        const base: [number, number, number] = hit.solid ? hit.place : hit.cell
        const open = d?.wallDirs ?? wallSnap(st.station.cells, base, [hit.point[0], hit.point[1]], 0).dirs
        drawHalfWallGhost(d?.active && d.wall ? d.anchor : base, open)
        scene.setCursor(d?.active && d.wall ? d.anchor : base, true)
        setBuildMeasure(null)
        return
      }
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
      // Over a stair the brush finishes the **piece**, not the floor the ray found
      // under its treads: the stair itself is ghosted as the target, and no cell
      // face is previewed (that would point at the wrong thing).
      const stairId = scene.pickModule(e.clientX, e.clientY)
      const stair = stairId ? st.station.modules.find((m) => m.id === stairId) : undefined
      if (stair && stair.type === 'stair') {
        scene.clearFaceGhost()
        scene.setModulePreview(stair, false)
        scene.setCursor([stair.x, stair.y, stair.z], true)
        return
      }
      scene.setModulePreview(null)
      const p = paint.current
      if (p?.active) {
        // The rectangle runs to the cell under the pointer, on the anchor plane.
        const cells = planeCells(p.anchor, hit.cell, p.face)
        scene.setFaceGhost(faceTargets(cells, p.face, solidRef.current, thinRef.current), p.face, paintColour(p.button, st.paintFinish))
      } else if (st.paintMode !== 'pick' && hit.solid) {
        const face = dominantFace(hit.normal)
        scene.setFaceGhost(faceTargets([hit.cell], face, solidRef.current, thinRef.current), face, paintColour(0, st.paintFinish))
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
          const { mods, blocked, colliderIds } = fenceRunPreview(line, rot)
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
      hoverRef.current = { cell: hit.cell, place: hit.place, solid: hit.solid, point: [hit.point[0], hit.point[1]] }
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
        scene.setCollisionHighlight(null)
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
          : zd.brush === 'ticket'
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
      const targets = faceTargets(cells, p.face, solidRef.current, thinRef.current)
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
    scene.setCollisionHighlight(null)
    const rect = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
    const target = hit ? (d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell) : d.anchor
    const st = useStore.getState()
    if (d.modules) {
      // A delete-tool press on a module removes that whole piece, wherever the
      // pointer was released. A sweep that crossed same-type pieces takes them
      // all in one commit, so a single undo puts the run back together.
      const swept = d.modules
        .map((id) => st.station.modules.find((m) => m.id === id))
        .filter((m): m is Module => m !== undefined)
      if (swept.length === 0) return
      if (swept.length === 1) {
        removePlacedModule(swept[0])
        return
      }
      st.commit(removeSweptModules(st.station, swept.map((m) => m.id)))
      st.select(null)
      const head = swept[0]
      const label = moduleLabel(head.type, head.type === 'shop' ? head.cfg.kind : undefined)
      st.setNotice(`已拆掉 ${swept.length} 件${label}`)
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
          // A fence stands on floor like any equipment; bare void holds none.
          const floorHere = next.cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === z) || exitFloorAt(next.modules, x, y, z)
          if (!floorHere) {
            blocked++
            why ||= '这格没有地板'
            continue
          }
          if (placementOnTrack(next.cells, mod, next.modules)) {
            blocked++
            why ||= '轨道上不能放围栏'
            continue
          }
          if (placementBlocked(next.modules, mod)) {
            blocked++
            if (!why) {
              const hit = moduleAt(next.modules, x, y, z)
              why = hit ? `这格和${moduleLabel(hit.type, hit.type === 'shop' ? hit.cfg.kind : undefined)}重叠` : '这格放不下'
            }
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
      return
    }
    if (d.wall) {
      // A 墙 drag lays a straight axis-aligned run of full-height columns; a
      // quick press is one. The right drag lifts the same run, a whole tagged
      // column at a time. A **半墙** (`d.single`, the 地基 tool's mode) is always
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
        const { state: next, changed, blocked } = addWalls(st.station, line, side, d.single === true ? 1 : undefined)
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
      sceneRef.current?.setCollisionHighlight(null)
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
    sceneRef.current?.setCollisionHighlight(null)
    st.setNotice(`已拆掉${moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined)}`)
  }

  /**
   * Right-click: remove the equipment standing on a cell, leaving the block.
   *
   * The camera's own look direction is handed to `moduleAt`, because the one cell
   * that can hold two pieces — a back-to-back 电视 pair — is a single object seen
   * from two sides: without the direction the pick would fall back to the document's
   * order, and a right-click would bulldoze whichever of the two happened to be
   * listed first rather than the face under the pointer.
   */
  const bulldoze = (cell: [number, number, number], place?: [number, number, number], facing?: readonly [number, number]): void => {
    const st = useStore.getState()
    // A rail's bed is dug, so the module is found from the hit or the cell above.
    const rail =
      railModuleAt(st.station, cell[0], cell[1], cell[2]) ??
      (place ? railModuleAt(st.station, place[0], place[1], place[2]) : undefined)
    if (rail) {
      removePlacedModule(rail)
      return
    }
    const mod = moduleAt(st.station.modules, cell[0], cell[1], cell[2], facing)
    if (mod) removePlacedModule(mod)
  }

  /** The camera's look direction, for the cell-based picks that need it. */
  const pickFacing = (): [number, number] | undefined => sceneRef.current?.pickFacing()

  const placeModule = (
    cell: [number, number, number],
    place: [number, number, number],
    solid: boolean,
    type: string,
    near?: [number, number],
  ): void => {
    const st = useStore.getState()
    // A wall-mounted 广告牌 needs only a wall behind it — it may hang over a
    // track, so it never goes through the floor/track rules below.
    if (isWallMountedType(type)) {
      // The panel turns itself to face whatever wall backs it, so the only
      // failure left is "there is no wall here at all".
      const { mod, noWall } = wallMountPlacement(cell, place, nextModuleId(st.station.modules, type), near)
      if (!mod || noWall) {
        st.setNotice('广告牌要贴在墙上：先砌一堵墙')
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
    const mods = buildPlacementModules(type, at, nextModuleId(st.station.modules, type))
    if (mods.length === 0) return
    for (const mod of mods) {
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
      // 广告牌 is wall-mounted: it needs a solid wall block behind it. The
      // orientation is not the player's problem — `autofaceWallMount` already
      // turned the panel — so this is only the "no wall here at all" branch.
      if (wallMountMissing(st.station.cells, mod)) {
        st.setNotice('广告牌要贴在墙上：先砌一堵墙')
        return
      }
      // 指示牌 / 电视 / 时钟 / 监控 hang from the ceiling: they need a solid slab one
      // storey up.
      if (ceilingMountMissing(st.station.cells, mod)) {
        st.setNotice('指示牌、电视、时钟和监控要吊在天花板下：上面得有一层楼板（四米高）')
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
          // A piece in the air outlives the pointer: its ghost stays parked where it
          // was aimed, so going to the 信息 card for 确认 does not take the aim away.
          if (useStore.getState().moveDraft) return
          sceneRef.current?.setCursor(null)
          sceneRef.current?.setModulePreview(null)
          sceneRef.current?.setCollisionHighlight(null)
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
