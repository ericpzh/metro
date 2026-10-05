// The view cube: a small, stylised orientation widget in the corner of the
// stage. A face click snaps the camera to that projection, a corner click drops
// into an isometric from that corner, and dragging the cube orbits. It only ever
// moves the camera: the level slicing (显示其他层 / 隐藏天花板) is the player's
// own setting, so a face or corner click leaves it exactly as it was. The
// vertical depth rail beside it mirrors the Q/E layer step and names the level
// you are standing on.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SceneRenderer } from '../render/scene.ts'
import { useStore } from './store.ts'
import { LEVEL_STEPS } from '../sim/constants.ts'

/** Cube half-extent in world units; the cube spans -HALF..HALF on each axis. */
const HALF = 0.5
/** Screen pixels per world unit of the projected cube. */
const SCALE = 54
/** Half the SVG view box — big enough for the corner/edge handles to stick out. */
const VIEW = 72
const GIZMO = { x: -54, y: 52, len: 17 }

type Axis = 'x' | 'y' | 'z'
interface FaceDef {
  key: string
  axis: Axis
  sgn: number
  dir: [number, number, number]
  label: string
}

const FACES: FaceDef[] = [
  { key: 'top', axis: 'z', sgn: 1, dir: [0, 0, 1], label: '顶' },
  { key: 'bottom', axis: 'z', sgn: -1, dir: [0, 0, -1], label: '底' },
  { key: 'e', axis: 'x', sgn: 1, dir: [1, 0, 0], label: '东' },
  { key: 'w', axis: 'x', sgn: -1, dir: [-1, 0, 0], label: '西' },
  { key: 'n', axis: 'y', sgn: 1, dir: [0, 1, 0], label: '北' },
  { key: 's', axis: 'y', sgn: -1, dir: [0, -1, 0], label: '南' },
]

const AXIS_OF: Record<Axis, number> = { x: 0, y: 1, z: 2 }
/** Face key for an axis index and sign: x → e/w, y → n/s, z → top/bottom. */
const AXIS_FACE: Array<[string, string]> = [
  ['w', 'e'],
  ['s', 'n'],
  ['bottom', 'top'],
]

function faceKeyFor(axisIndex: number, sgn: number): string {
  return AXIS_FACE[axisIndex][sgn > 0 ? 1 : 0]
}

const VERTICES: Array<[number, number, number]> = []
for (let i = 0; i < 8; i++) {
  VERTICES.push([(i & 1 ? 1 : -1) * HALF, (i & 2 ? 1 : -1) * HALF, (i & 4 ? 1 : -1) * HALF])
}

/** The twelve edges: vertex pairs that differ on exactly one axis. */
const EDGES: Array<[number, number]> = []
for (let i = 0; i < 8; i++) {
  for (let j = i + 1; j < 8; j++) {
    const a = VERTICES[i]
    const b = VERTICES[j]
    const diff = (a[0] !== b[0] ? 1 : 0) + (a[1] !== b[1] ? 1 : 0) + (a[2] !== b[2] ? 1 : 0)
    if (diff === 1) EDGES.push([i, j])
  }
}

/** Which edges meet at each corner, by edge index. */
const CORNER_EDGES: number[][] = Array.from({ length: 8 }, () => [])
EDGES.forEach(([a, b], i) => {
  CORNER_EDGES[a].push(i)
  CORNER_EDGES[b].push(i)
})

/**
 * The handles are a wireframe of a larger, concentric box (the "shell"), of
 * which only the middle of each edge and short stubs at each corner are drawn.
 * Because the shell shares the box's topology, its edges are exactly parallel
 * to the solid's and its corners sit exactly outside the solid's corners.
 */
const SHELL_SCALE = 1.2
/**
 * Fractions of each shell edge. The bar takes the middle, a stub hugs each
 * corner, and the two never meet: the gap on each side is
 * (1 - EDGE_BAR_FRAC)/2 - CORNER_STUB_FRAC = 0.16 of the edge.
 */
const EDGE_BAR_FRAC = 0.4
const CORNER_STUB_FRAC = 0.14

function faceCorners(axis: Axis, sgn: number): THREE.Vector3[] {
  const a = AXIS_OF[axis]
  const [o1, o2] = [0, 1, 2].filter((k) => k !== a)
  const pts: THREE.Vector3[] = []
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      const c = [0, 0, 0]
      c[a] = sgn * HALF
      c[o1] = s1 * HALF
      c[o2] = s2 * HALF
      pts.push(new THREE.Vector3(c[0], c[1], c[2]))
    }
  }
  // Sequential ring: (-,-), (-,+), (+,+), (+,-).
  return [pts[0], pts[1], pts[3], pts[2]]
}

function cornerFaces(v: [number, number, number]): string[] {
  return [faceKeyFor(0, v[0]), faceKeyFor(1, v[1]), faceKeyFor(2, v[2])]
}

function edgeFaces(a: [number, number, number], b: [number, number, number]): string[] {
  const out: string[] = []
  for (let k = 0; k < 3; k++) if (a[k] === b[k]) out.push(faceKeyFor(k, a[k]))
  return out
}

interface CubeGeometry {
  faces: Array<{ key: string; label: string; points: string; lx: number; ly: number }>
  edges: Array<{ key: string; a: number; b: number; x1: number; y1: number; x2: number; y2: number; bx1: number; by1: number; bx2: number; by2: number; visible: boolean }>
  corners: Array<{ i: number; x: number; y: number; stubs: Array<{ x1: number; y1: number; x2: number; y2: number }> }>
  axes: Array<{ key: string; color: string; x: number; y: number; lx: number; ly: number }>
}

/** Project the cube through the main camera's orientation into SVG space. */
function buildCube(qt: [number, number, number, number]): CubeGeometry {
  const q = new THREE.Quaternion(qt[0], qt[1], qt[2], qt[3])
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
  const px = (v: THREE.Vector3): number => v.dot(right) * SCALE
  const py = (v: THREE.Vector3): number => -v.dot(up) * SCALE

  const visible = new Map<string, boolean>()
  const dirs = new Map<string, THREE.Vector3>()
  for (const f of FACES) {
    const d = new THREE.Vector3(f.dir[0], f.dir[1], f.dir[2])
    dirs.set(f.key, d)
    // 0.02 hides the slivers a face-on view produces (the top/bottom roll is a
    // hair off-axis so `lookAt` stays defined) and keeps only the real faces.
    visible.set(f.key, d.dot(back) > 0.02)
  }

  const faces = FACES.filter((f) => visible.get(f.key)).map((f) => {
    const pts = faceCorners(f.axis, f.sgn).map((p) => [px(p), py(p)] as const)
    const c = dirs.get(f.key)!.clone().multiplyScalar(HALF)
    return {
      key: f.key,
      label: f.label,
      points: pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
      lx: px(c),
      ly: py(c),
    }
  })

  const rawCorners = VERTICES.map((v, i) => {
    const p = new THREE.Vector3(v[0], v[1], v[2])
    const count = cornerFaces(v).filter((k) => visible.get(k)).length
    // Shell corner: the same vertex of the larger concentric box.
    return { i, x: px(p) * SHELL_SCALE, y: py(p) * SHELL_SCALE, count }
  })
  const shellOf = new Map(rawCorners.map((c) => [c.i, c]))

  const edges = EDGES.map(([a, b]) => {
    const va = new THREE.Vector3(...VERTICES[a])
    const vb = new THREE.Vector3(...VERTICES[b])
    const x1 = px(va)
    const y1 = py(va)
    const x2 = px(vb)
    const y2 = py(vb)
    const shown = edgeFaces(VERTICES[a], VERTICES[b]).some((k) => visible.get(k))
    // Middle slice of the matching shell edge, so it stays parallel to the solid.
    const A = shellOf.get(a)!
    const B = shellOf.get(b)!
    const dx = B.x - A.x
    const dy = B.y - A.y
    const el = Math.hypot(dx, dy) || 1
    const ux = dx / el
    const uy = dy / el
    const half = (el * EDGE_BAR_FRAC) / 2
    const cx = (A.x + B.x) / 2
    const cy = (A.y + B.y) / 2
    return {
      key: `${a}:${b}`,
      a,
      b,
      x1,
      y1,
      x2,
      y2,
      bx1: cx - ux * half,
      by1: cy - uy * half,
      bx2: cx + ux * half,
      by2: cy + uy * half,
      visible: shown,
    }
  })

  // Corner stubs: a short run from the shell corner along each of its visible
  // shell edges — the corner of the shell, not a new glyph.
  const most = Math.max(0, ...rawCorners.map((c) => c.count))
  const need = most >= 2 ? 2 : 1
  const corners = rawCorners
    .filter((c) => c.count >= need)
    .map((c) => {
      const q = shellOf.get(c.i)!
      const stubs: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
      for (const ei of CORNER_EDGES[c.i]) {
        if (!edges[ei].visible) continue
        const [a, b] = EDGES[ei]
        const other = shellOf.get(a === c.i ? b : a)!
        const ex = other.x - q.x
        const ey = other.y - q.y
        const el = Math.hypot(ex, ey) || 1
        const len = el * CORNER_STUB_FRAC
        stubs.push({ x1: q.x, y1: q.y, x2: q.x + (ex / el) * len, y2: q.y + (ey / el) * len })
      }
      return { i: c.i, x: q.x, y: q.y, stubs }
    })

  const colors = ['#ff6b6b', '#7fe08a', '#6ea8ff']
  const axisVectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const axes = axisVectors.map((v, i) => {
    const d = new THREE.Vector3(v[0], v[1], v[2])
    const ex = d.dot(right)
    const ey = -d.dot(up)
    return {
      key: ['X', 'Y', 'Z'][i],
      color: colors[i],
      x: GIZMO.x + ex * GIZMO.len,
      y: GIZMO.y + ey * GIZMO.len,
      lx: GIZMO.x + ex * (GIZMO.len + 5),
      ly: GIZMO.y + ey * (GIZMO.len + 5),
    }
  })

  return { faces, edges, corners, axes }
}

export function ViewCube({ sceneRef }: { sceneRef: React.RefObject<SceneRenderer | null> }): React.ReactElement {
  const [qt, setQt] = useState<[number, number, number, number]>([0, 0, 0, 1])
  const [hover, setHover] = useState<string | null>(null)
  const press = useRef<{ x: number; y: number; moved: boolean; action: string | null } | null>(null)

  // Track the main camera's orientation; only re-render the widget when it
  // actually turns, so an idle orbit does not churn React.
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const q = sceneRef.current?.camera.quaternion
      if (!q) return
      const key = `${q.x.toFixed(5)},${q.y.toFixed(5)},${q.z.toFixed(5)},${q.w.toFixed(5)}`
      if (key === last) return
      last = key
      setQt([q.x, q.y, q.z, q.w])
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sceneRef])

  const geo = useMemo(() => buildCube(qt), [qt])

  /** Pull the current camera orientation into the widget without waiting a frame. */
  const syncNow = (): void => {
    const q = sceneRef.current?.camera.quaternion
    if (q) setQt([q.x, q.y, q.z, q.w])
  }

  const apply = (action: string): void => {
    const scene = sceneRef.current
    if (!scene) return
    const st = useStore.getState()
    if (action.startsWith('face:')) {
      const def = FACES.find((f) => f.key === action.slice(5))
      if (!def) return
      // A face click is only a camera move. It never touches 显示其他层: the
      // level slicing is the player's setting, and a view that quietly flipped
      // it is what made the button read as broken.
      scene.setViewDirection(new THREE.Vector3(def.dir[0], def.dir[1], def.dir[2]), true)
      st.setOrtho(true)
    } else if (action.startsWith('corner:')) {
      const v = VERTICES[Number(action.slice(7))]
      if (!v) return
      scene.setViewDirection(new THREE.Vector3(v[0], v[1], v[2]).normalize(), false)
      st.setOrtho(false)
    } else if (action.startsWith('edge:')) {
      const parts = action.split(':')
      const va = new THREE.Vector3(...VERTICES[Number(parts[1])])
      const vb = new THREE.Vector3(...VERTICES[Number(parts[2])])
      const dir = va.add(vb)
      if (dir.lengthSq() < 1e-6) return
      scene.setViewDirection(dir.normalize(), true)
      st.setOrtho(true)
    }
    syncNow()
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    const el = (e.target as Element).closest('[data-action]') as SVGElement | null
    press.current = { x: e.clientX, y: e.clientY, moved: false, action: el?.dataset.action ?? null }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* A capture we cannot take still leaves the click/drag working. */
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.moved && Math.hypot(dx, dy) < 4) return
    p.moved = true
    p.x = e.clientX
    p.y = e.clientY
    setHover(null)
    sceneRef.current?.orbitBy(dx, dy)
  }

  const onUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    const p = press.current
    press.current = null
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (p && !p.moved && p.action) apply(p.action)
  }

  const hoverOn = (id: string): void => setHover(id)
  const hoverOff = (id: string): void => setHover((h) => (h === id ? null : h))

  /**
   * The default build view: the isometric preset in perspective. The camera
   * only — 显示其他层 and 隐藏天花板 are the player's own settings and stay put.
   */
  const goHome = (): void => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setPreset('iso')
    const st = useStore.getState()
    st.setOrtho(false)
    // A preset is a way out of 沉浸 as much as out of any other view: the camera
    // has already left it (`setPreset`), so the mode's own state — the storey drawn
    // crisp, the hidden grid — has to follow, or the rail would show a mode that is
    // no longer on screen.
    if (st.immersion) st.setImmersion(false)
    syncNow()
  }

  return (
    <div className="viewNav">
      <DepthRail />
      <div className="viewCube" title="拖动旋转 · 点面看正投影 · 点角看立体图">
        <svg
          viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="cubeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(78,168,255,0.30)" />
              <stop offset="100%" stopColor="rgba(78,168,255,0.05)" />
            </linearGradient>
            <linearGradient id="cubeGradHot" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(110,231,255,0.55)" />
              <stop offset="100%" stopColor="rgba(78,168,255,0.18)" />
            </linearGradient>
          </defs>

          {geo.edges
            .filter((e) => !e.visible)
            .map((e) => (
              <line key={'h' + e.key} className="cubeEdgeHidden" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
            ))}

          {geo.faces.map((f) => {
            const id = 'face:' + f.key
            const on = hover === id
            return (
              <polygon
                key={f.key}
                className="cubeFacePoly"
                data-action={id}
                points={f.points}
                fill={on ? 'url(#cubeGradHot)' : 'url(#cubeGrad)'}
                stroke={on ? '#9ad8ff' : 'rgba(150,180,220,0.35)'}
                strokeWidth={1}
                onPointerEnter={() => hoverOn(id)}
                onPointerLeave={() => hoverOff(id)}
              />
            )
          })}

          {geo.edges
            .filter((e) => e.visible)
            .map((e) => {
              const id = `edge:${e.a}:${e.b}`
              const on = hover === id
              return (
                <g
                  key={e.key}
                  className="cubeEdgeHandle"
                  data-action={id}
                  onPointerEnter={() => hoverOn(id)}
                  onPointerLeave={() => hoverOff(id)}
                >
                  <line className="cubeEdge" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
                  <line className="cubeEdgeHit" x1={e.bx1} y1={e.by1} x2={e.bx2} y2={e.by2} />
                  <line className={on ? 'cubeEdgeBar on' : 'cubeEdgeBar'} x1={e.bx1} y1={e.by1} x2={e.bx2} y2={e.by2} />
                </g>
              )
            })}

          {geo.faces.map((f) => (
            <text key={'t' + f.key} className="cubeLabel" x={f.lx} y={f.ly} textAnchor="middle" dominantBaseline="central">
              {f.label}
            </text>
          ))}

          {geo.corners.map((c) => {
            const id = 'corner:' + c.i
            const on = hover === id
            return (
              <g
                key={c.i}
                className="cubeCorner"
                data-action={id}
                onPointerEnter={() => hoverOn(id)}
                onPointerLeave={() => hoverOff(id)}
                transform={on ? `translate(${c.x} ${c.y}) scale(1.18) translate(${-c.x} ${-c.y})` : undefined}
              >
                <circle cx={c.x} cy={c.y} r={15} fill="rgba(0,0,0,0)" />
                {c.stubs.map((s, k) => (
                  <line key={'h' + k} className="cubeCornerHit" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                ))}
                {c.stubs.map((s, k) => (
                  <line key={'a' + k} className={on ? 'cubeCornerAngle on' : 'cubeCornerAngle'} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                ))}
              </g>
            )
          })}

          <g className="cubeAxis">
            {geo.axes.map((a) => (
              <g key={a.key}>
                <line x1={GIZMO.x} y1={GIZMO.y} x2={a.x} y2={a.y} stroke={a.color} strokeWidth={1.6} />
                <circle cx={a.x} cy={a.y} r={1.8} fill={a.color} />
                <text x={a.lx} y={a.ly} fill={a.color} textAnchor="middle" dominantBaseline="central">
                  {a.key}
                </text>
              </g>
            ))}
          </g>
        </svg>
        <button type="button" className="viewHomeBtn" onClick={goHome} title="回到默认视角 (1)" aria-label="回到默认视角">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
            <path d="M9 21v-6h6v6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * The depth rail: a vertical elevator beside the cube. Its track is the range of
 * built levels, the lit dot is the level you are editing, and dragging the track
 * (or the Q/E keys) steps it. A chip names the current level and its z.
 */
function DepthRail(): React.ReactElement {
  const activeZ = useStore((s) => s.activeZ)
  const setActiveZ = useStore((s) => s.setActiveZ)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // Fixed storeys (see `LEVEL_STEPS`): the rail always lists 12 down to -32
  // in steps of 4, so every stop is a real work plane.
  const levels = LEVEL_STEPS

  const min = levels[0]
  const max = levels[levels.length - 1]
  const span = Math.max(1, max - min)
  const frac = (z: number): number => (max === min ? 0.5 : (max - z) / span)

  const pick = (clientY: number): void => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    const z = max - t * span
    let best = levels[0]
    for (const l of levels) if (Math.abs(l - z) < Math.abs(best - z)) best = l
    setActiveZ(best)
  }

  return (
    <div className="depthRail" title="高度：Q 下一层 / E 上一层">
      <div
        className="depthTrack"
        ref={trackRef}
        onPointerDown={(e) => {
          dragging.current = true
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
          pick(e.clientY)
        }}
        onPointerMove={(e) => {
          if (dragging.current) pick(e.clientY)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      >
        <div className="depthLine" />
        {levels.map((z) => (
          <div key={z} className={z === activeZ ? 'depthDot on' : 'depthDot'} style={{ top: `${frac(z) * 100}%` }}>
            <i />
          </div>
        ))}
        <div className="depthChip" style={{ top: `${frac(activeZ) * 100}%` }}>
          <b>{activeZ}m</b>
        </div>
      </div>
      <div className="depthTag">高度</div>
    </div>
  )
}
