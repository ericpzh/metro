// The viewport: owns the SceneRenderer lifecycle and turns pointer input into
// build commands. Panels stay in React; only this file touches three directly.

import { useEffect, useRef } from 'react'
import { SceneRenderer } from '../render/scene.ts'
import { addCells, cellKey, eraseFaces, faceFinish, fillSurface, paintFaces, paintZone, removeCells, toData } from '../build/model.ts'
import { finishDef } from '../sim/finishes.ts'
import { zoneIndex } from '../sim/zones.ts'
import { setFrameHandler, useStore, moduleLabel, type Tool } from './store.ts'
import type { Face, FinishId, Module } from '../sim/types.ts'
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

  const version = useStore((s) => s.version)
  const station = useStore((s) => s.station)
  const tool = useStore((s) => s.tool)
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
    const cells = useStore.getState().station.cells
    const solid = new Set(cells.map((c) => cellKey(c.x, c.y, c.z)))
    const exposed = cells.filter((c) => c.fill === 'solid' && !solid.has(cellKey(c.x, c.y, c.z + 1)))
    const quads = new Float32Array(exposed.length * 3)
    const zones = new Uint8Array(exposed.length)
    exposed.forEach((c, i) => {
      quads[i * 3] = c.x + 0.5
      quads[i * 3 + 1] = c.y + 0.5
      quads[i * 3 + 2] = c.z + 1.02
      zones[i] = zoneIndex(c.zone)
    })
    scene.setZoneOverlay(quads, zones, useStore.getState().zoneOverlayOn)
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

  // A ghost belongs to the block tool; leaving it must not strand a preview.
  useEffect(() => {
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setCursor(null)
  }, [tool])

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
      if (hit.solid) {
        const mod = st.station.modules.find((m) => m.x === hit.cell[0] && m.y === hit.cell[1] && m.z === hit.cell[2])
        st.select(mod ? { kind: 'module', key: mod.id, label: moduleLabel(mod.type) } : { kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
      } else {
        st.select({ kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
      }
      scene.setGhost([], 'add')
      return
    }
    if (tool === 'module') {
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
      if (!hit.solid) return
      const next = paintZone(st.station, hit.cell[0], hit.cell[1], hit.cell[2], st.zoneBrush)
      if (next !== st.station) st.commit(next)
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
      scene.setCursor(null)
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
    const c = hit.solid ? hit.place : hit.cell
    scene.setCursor(c, true)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
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

  const placeModule = (cell: [number, number, number], place: [number, number, number], solid: boolean, type: string): void => {
    const st = useStore.getState()
    const at = solid ? cell : [place[0], place[1], place[2]] as [number, number, number]
    const id = `${type}-${st.station.modules.length + 1}`
    let mod: Module
    if (type === 'gate') mod = { id, type: 'gate', x: at[0], y: at[1], z: at[2], cfg: { dir: 'both' } }
    else if (type === 'tvm') mod = { id, type: 'tvm', x: at[0], y: at[1], z: at[2], cfg: {} }
    else if (type === 'bench') mod = { id, type: 'bench', x: at[0], y: at[1], z: at[2], cfg: {} }
    else mod = { id, type: 'exit', x: at[0], y: at[1], z: at[2], cfg: { name: '未命名口', inRate: 900, open: true } }
    st.commit({ ...st.station, modules: [...st.station.modules, mod] })
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
        onPointerLeave={() => sceneRef.current?.setCursor(null)}
      />
      <ViewCube sceneRef={sceneRef} />
    </>
  )
}
