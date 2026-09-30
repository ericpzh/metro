// The viewport: owns the SceneRenderer lifecycle and turns pointer input into
// build commands. Panels stay in React; only this file touches three directly.

import { useEffect, useRef } from 'react'
import { SceneRenderer } from '../render/scene.ts'
import { addCells, cellKey, removeCells, toData } from '../build/model.ts'
import { setFrameHandler, useStore, type Tool } from './store.ts'
import type { Module } from '../sim/types.ts'

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
  const drag = useRef<{
    active: boolean
    button: number
    mode: 'add' | 'remove'
    anchor: [number, number, number]
    z: number
    shift: boolean
    moved: boolean
  } | null>(null)

  const version = useStore((s) => s.version)
  const station = useStore((s) => s.station)
  const activeZ = useStore((s) => s.activeZ)
  const ghostOther = useStore((s) => s.ghostOtherLevels)
  const cutaway = useStore((s) => s.cutaway)
  const ortho = useStore((s) => s.ortho)
  const overlayOn = useStore((s) => s.overlayOn)
  const graph = useStore((s) => s.graph)

  useEffect(() => {
    overlayRef.current = overlayOn
    sceneRef.current?.setOverlayVisible(overlayOn)
  }, [overlayOn])

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
    setFrameHandler((count, agents, density) => {
      scene.setAgents(agents, count)
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
    window.addEventListener('metro:preset', onPreset)
    window.addEventListener('metro:frame', onFrame)
    window.addEventListener('metro:delete', onDelete)
    return () => {
      setFrameHandler(null)
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
        st.select(mod ? { kind: 'module', key: mod.id, label: mod.type } : { kind: 'cell', key: cellKey(...hit.cell), label: `(${hit.cell.join(', ')})` })
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
    // block tool
    e.preventDefault()
    const mode: 'add' | 'remove' = e.button === 2 ? 'remove' : 'add'
    const anchor = mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
    drag.current = { active: true, button: e.button, mode, anchor, z: anchor[2], shift: e.shiftKey, moved: false }
    scene.setGhost([anchor], mode)
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
        const cells = rectCells(d.anchor, target, d.z, e.shiftKey)
        d.moved = true
        scene.setGhost(cells, d.mode)
        scene.setCursor(target, d.mode === 'add')
        return
      }
      const c = hit.solid ? hit.place : hit.cell
      scene.setGhost([c], 'add')
      scene.setCursor(c, true)
      return
    }
    const c = hit.solid ? hit.place : hit.cell
    scene.setCursor(c, true)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    const d = drag.current
    drag.current = null
    if (!scene || !d?.active) return
    const hit = pickAt(e)
    scene.setGhost([], 'add')
    if (!hit) return
    const target = d.mode === 'add' ? (hit.solid ? hit.place : hit.cell) : hit.cell
    const cells = rectCells(d.anchor, target, d.z, d.shift)
    const st = useStore.getState()
    if (d.mode === 'add') {
      const { cells: next, changed } = addCells(st.station.cells, cells)
      if (changed > 0) st.commit({ ...st.station, cells: next })
    } else {
      // Never delete the last 4 cells (the seed's integrity, §4.1).
      if (st.station.cells.length - cells.length < 4) return
      const next = removeCells(st.station, cells)
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
    else mod = { id, type: 'exit', x: at[0], y: at[1], z: at[2], cfg: { name: '未命名口', inRate: 600, outRate: 600, open: true } }
    st.commit({ ...st.station, modules: [...st.station.modules, mod] })
  }

  return (
    <canvas
      ref={canvasRef}
      className="viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      onPointerLeave={() => sceneRef.current?.setCursor(null)}
    />
  )
}
