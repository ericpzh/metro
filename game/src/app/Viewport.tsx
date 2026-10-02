// The viewport: owns the SceneRenderer lifecycle and turns pointer input into
// build commands. Panels stay in React; only this file touches three directly.

import { useEffect, useRef } from 'react'
import { SceneRenderer } from '../render/scene.ts'
import {
  addCells,
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
  fillSurface,
  groundLevelZ,
  nextModuleId,
  paintFaces,
  paintZoneCells,
  placeFacility,
  zoneMapFloors,
  zoneRegionLabels,
  addEquipment,
  carveFacilityOpenings,
  removeCells,
  removeFacility,
  removeModule,
  SHOP_WALL_H,
  toData,
  type FacilityKind,
} from '../build/model.ts'
import { finishDef } from '../sim/finishes.ts'
import { exitFloorAt } from '../sim/exits.ts'
import { moduleAt, isTrackCell, placementBlocked, placementOnTrack } from '../sim/placement.ts'
import { escalatorBasesSolid } from '../sim/openings.ts'
import { ZONE_LIST, zoneIndex } from '../sim/zones.ts'
import { FACILITY_OPTIONS, setFrameHandler, useStore, isFacilityBrush, moduleLabel, type Tool, type ZoneBrush } from './store.ts'
import type { Face, FinishId } from '../sim/types.ts'
import { railModuleAt, railRect } from '../build/rail.ts'
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
 * highlight reads as exactly "what this release will do".
 */
function pendingCells(
  cells: Array<[number, number, number]>,
  mode: 'add' | 'remove',
  solid: Set<string>,
): Array<[number, number, number]> {
  return cells.filter(([x, y, z]) => (mode === 'remove' ? solid.has(cellKey(x, y, z)) : !solid.has(cellKey(x, y, z))))
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

/** Rail bed preview tint, matching the track finish. */
const RAIL_PREVIEW = 0x3d4a5c

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

export function Viewport(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SceneRenderer | null>(null)
  const overlayRef = useRef(false)
  const graphNodesRef = useRef<Float32Array>(new Float32Array(0))
  /** Solid cell keys, refreshed with the station, so a drag can tell blocks from void. */
  const solidRef = useRef<Set<string>>(new Set())
  /** The tile under the pointer for the equipment tool, so R can rebuild the ghost. */
  const hoverRef = useRef<{ cell: [number, number, number]; solid: boolean } | null>(null)
  const drag = useRef<{
    active: boolean
    button: number
    mode: 'add' | 'remove'
    anchor: [number, number, number]
    z: number
    shift: boolean
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

  /** The rail tool's rectangle drag: press a floor cell, drag out the bed. */
  const railDrag = useRef<{
    active: boolean
    anchor: [number, number, number]
    z: number
    sx: number
    sy: number
    downTime: number
  } | null>(null)

  const version = useStore((s) => s.version)
  const station = useStore((s) => s.station)
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const moduleRot = useStore((s) => s.moduleRot)
  const stairWidth = useStore((s) => s.stairWidth)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const activeZ = useStore((s) => s.activeZ)
  const ghostOther = useStore((s) => s.ghostOtherLevels)
  const cutaway = useStore((s) => s.cutaway)
  const ortho = useStore((s) => s.ortho)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const graph = useStore((s) => s.graph)

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
    sceneRef.current?.setOrtho(ortho)
  }, [ortho])

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
    const onGround = z === groundLevelZ(st.station.levels)
    const placeable = floorHere && (st.moduleType !== 'exit' || onGround)
    const mod = placeable ? createModule(st.moduleType, x, y, z, 'preview', st.moduleRot, st.stairWidth, st.escalatorDir) : null
    // An escalator may run through walls/ceilings — only its two landings must
    // be solid floor (or exit floor). Anything in between is carved on placement.
    const basesMissing = !!mod && mod.type === 'escalator' && !escalatorBasesSolid(st.station.cells, st.station.modules, mod)
    const blocked = !!mod && (placementBlocked(st.station.modules, mod) || basesMissing || placementOnTrack(st.station.cells, mod, st.station.modules))
    scene.setCursor(h.cell, placeable && !blocked)
    scene.setModulePreview(mod, blocked)
  }

  // A ghost belongs to a tool; leaving one must not strand a preview.
  useEffect(() => {
    hoverRef.current = null
    zoneDrag.current = null
    facilityDrag.current = null
    railDrag.current = null
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.setGhost([], 'remove')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setCursor(null)
    sceneRef.current?.setModulePreview(null)
  }, [tool])

  // Rotating (R), switching the equipment, or cycling its width/direction (Tab)
  // rebuilds the ghost at the hovered tile at once, instead of waiting for the
  // pointer to move again.
  useEffect(() => {
    refreshModulePreview()
  }, [moduleRot, moduleType, stairWidth, escalatorDir])

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
    setFrameHandler((count, agents, density, trains, intervalMs) => {
      scene.setAgents(agents, count, intervalMs)
      scene.setTrains(trains)
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
      const next = removeCells(st.station, [[x, y, z]])
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
  }, [version, station])

  const pickAt = (e: React.PointerEvent): ReturnType<SceneRenderer['pick']> => {
    const scene = sceneRef.current
    if (!scene) return null
    return scene.pick(e.clientX, e.clientY, activeZ)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene || e.button === 1) return
    const st = useStore.getState()
    const tool: Tool = st.tool
    const hit = pickAt(e)
    if (!hit) return
    if (tool === 'select') {
      // Right-click bulldozes the equipment under the pointer.
      if (e.button === 2) {
        bulldoze(hit.cell, hit.place)
        return
      }
      // A rail's bed is dug, so the ray lands on the block below or the work
      // plane; look for the track module at both the hit and the cell above.
      const rail =
        railModuleAt(st.station, hit.cell[0], hit.cell[1], hit.cell[2]) ??
        railModuleAt(st.station, hit.place[0], hit.place[1], hit.place[2])
      const mod = rail ?? (hit.solid ? moduleAt(st.station.modules, hit.cell[0], hit.cell[1], hit.cell[2]) : undefined)
      const label = mod ? moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined) : ''
      st.select(mod ? { kind: 'module', key: mod.id, label } : { kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
      scene.setGhost([], 'add')
      return
    }
    if (tool === 'module') {
      // Equipment rides on a floor block; bare void has nothing to stand on.
      if (!hit.solid) return
      if (e.button === 2) {
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
      // A rail bed is a rectangle drag on the active level: press a floor cell,
      // drag out the run (and bed width), release to dig and lay it.
      e.preventDefault()
      const z = st.activeZ
      const anchor: [number, number, number] = [hit.cell[0], hit.cell[1], z]
      railDrag.current = { active: true, anchor, z, sx: e.clientX, sy: e.clientY, downTime: performance.now() }
      scene.setFaceGhost([anchor], 'top', RAIL_PREVIEW)
      scene.setCursor(anchor, true)
      return
    }
    // block tool: a click is one block, a long press + drag is a rectangle on
    // the pressed plane (the depth you are on, stepped with Q/E).
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
    scene.setGhost(pendingCells([anchor], mode, solidRef.current), mode)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene) return
    const hit = pickAt(e)
    if (!hit) {
      hoverRef.current = null
      scene.setCursor(null)
      scene.setModulePreview(null)
      return
    }
    const st = useStore.getState()
    if (st.tool === 'block') {
      const d = drag.current
      if (d?.active) {
        d.shift = e.shiftKey
        const target = d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
        // Only a deliberate press becomes a rectangle; a quick press stays one
        // block even if the pointer jitters.
        const dragging = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
        const preview = dragging ? rectCells(d.anchor, target, d.z, e.shiftKey) : [d.anchor]
        scene.setGhost(pendingCells(preview, d.mode, solidRef.current), d.mode)
        scene.setCursor(dragging ? target : d.anchor, d.mode === 'add')
        return
      }
      const c = hit.solid ? hit.place : hit.cell
      scene.setGhost([c], 'add')
      scene.setCursor(c, true)
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
      // Equipment stands on the floor block under the pointer, so the highlight
      // snaps to that tile instead of floating a metre above it, and a
      // translucent copy of the module shows exactly what the click will place.
      // Bare void and a clash with existing equipment both flag red.
      hoverRef.current = { cell: hit.cell, solid: hit.solid }
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
      const rd = railDrag.current
      if (rd?.active) {
        const target: [number, number, number] = [hit.cell[0], hit.cell[1], rd.z]
        const r = railRect(rd.anchor, target, rd.z)
        const cells = rectCells([r.x0, r.y0, r.z], [r.x1, r.y1, r.z], rd.z, false)
        scene.setGhost([], 'remove')
        scene.setFaceGhost(cells, 'top', RAIL_PREVIEW)
        scene.setCursor(target, true)
        return
      }
      scene.setGhost([], 'remove')
      if (hit.solid) scene.setFaceGhost([hit.cell], 'top', RAIL_PREVIEW)
      else scene.clearFaceGhost()
      scene.setCursor(hit.cell, hit.solid)
      return
    }
    const c = hit.solid ? hit.place : hit.cell
    scene.setCursor(c, true)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
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
    const rd = railDrag.current
    railDrag.current = null
    if (rd?.active) {
      scene?.clearFaceGhost()
      const st = useStore.getState()
      const hit = pickAt(e)
      const target: [number, number, number] = hit ? [hit.cell[0], hit.cell[1], rd.z] : rd.anchor
      const wasRect = performance.now() - rd.downTime >= LONG_PRESS_MS && isMoved(rd, e)
      const r = railRect(rd.anchor, wasRect ? target : rd.anchor, rd.z)
      st.layRail(r)
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
    const rect = performance.now() - d.downTime >= LONG_PRESS_MS && isMoved(d, e)
    const target = hit ? (d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell) : d.anchor
    const cells = rect ? rectCells(d.anchor, target, d.z, d.shift) : [d.anchor]
    const st = useStore.getState()
    if (d.mode === 'add') {
      const { cells: next, changed } = addCells(st.station.cells, cells)
      if (changed > 0) st.commit({ ...st.station, cells: next })
    } else {
      // Only real blocks count against the seed's integrity (§4.1); a rectangle
      // drawn across void would otherwise trip the guard for nothing.
      const remove = pendingCells(cells, 'remove', solidRef.current)
      if (st.station.cells.length - remove.length < 4) return
      const next = removeCells(st.station, remove)
      if (next.cells.length !== st.station.cells.length) st.commit(next)
    }
  }

  const onContextMenu = (e: React.MouseEvent): void => e.preventDefault()

  /** Right-click: remove the equipment standing on a cell, leaving the block. */
  const bulldoze = (cell: [number, number, number], place?: [number, number, number]): void => {
    const st = useStore.getState()
    // A rail's bed is dug, so the module is found from the hit or the cell above.
    const rail =
      railModuleAt(st.station, cell[0], cell[1], cell[2]) ??
      (place ? railModuleAt(st.station, place[0], place[1], place[2]) : undefined)
    if (rail) {
      st.removeRail(rail.id)
      st.select(null)
      sceneRef.current?.setModulePreview(null)
      return
    }
    const mod = moduleAt(st.station.modules, cell[0], cell[1], cell[2])
    if (!mod) return
    // Facility rooms take their auto walls with them; the floor stays.
    st.commit(mod.type === 'shop' || mod.type === 'booth' || mod.type === 'retail' ? removeFacility(st.station, mod.id) : removeModule(st.station, mod.id))
    st.select(null)
    sceneRef.current?.setModulePreview(null)
    st.setNotice(`已拆掉${moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined)}`)
  }

  const placeModule = (cell: [number, number, number], place: [number, number, number], solid: boolean, type: string): void => {
    const st = useStore.getState()
    // Exit-covered holes count as floor, like the hover ghost above.
    const floorHere = solid || exitFloorAt(st.station.modules, cell[0], cell[1], cell[2])
    const at = floorHere ? cell : ([place[0], place[1], place[2]] as [number, number, number])
    // A surface exit stands at the street (h = 0 m) and nowhere else.
    if (type === 'exit' && at[2] !== groundLevelZ(st.station.levels)) {
      st.setNotice('出入口只能放在地面')
      return
    }
    const mod = createModule(type, at[0], at[1], at[2], nextModuleId(st.station.modules, type), st.moduleRot, st.stairWidth, st.escalatorDir)
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
    // An escalator punches through walls/ceilings on its own: allow it whenever
    // both landings stand on solid floor or exit floor, and refuse it otherwise.
    if (mod.type === 'escalator' && !escalatorBasesSolid(st.station.cells, st.station.modules, mod)) {
      st.setNotice('扶梯两端都得有实心地板')
      return
    }
    st.commit(addEquipment(st.station, mod))
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
          sceneRef.current?.setCursor(null)
          sceneRef.current?.setModulePreview(null)
          sceneRef.current?.setGhost([], 'remove')
          sceneRef.current?.clearFaceGhost()
        }}
      />
      <ViewCube sceneRef={sceneRef} />
    </>
  )
}
