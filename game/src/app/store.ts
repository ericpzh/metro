// App state. The station document lives here; the sim lives in the worker and
// is driven by the messages in sim/protocol.ts. Panels only — no sim logic.

import { create } from 'zustand'
import type { FromWorker, GraphInfo } from '../sim/protocol.ts'
import type { Metrics } from '../sim/world.ts'
import type { StationData } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'
import { cloneState, initialStation, setUpEscalators, toData, toState, type StationState } from '../build/model.ts'
import type { SceneStats } from '../render/scene.ts'

export type Tool = 'select' | 'block' | 'module'

export interface ModuleOption {
  id: string
  label: string
  type: string
  w: number
  h: number
}

export const MODULE_OPTIONS: ModuleOption[] = [
  { id: 'gate', label: '闸机', type: 'gate', w: 1, h: 1 },
  { id: 'tvm', label: '售票机', type: 'tvm', w: 1, h: 1 },
  { id: 'bench', label: '座椅', type: 'bench', w: 1, h: 1 },
  { id: 'exit', label: '出入口', type: 'exit', w: 1, h: 1 },
]

export interface AppState {
  station: StationState
  version: number
  tool: Tool
  moduleType: string
  activeZ: number
  ghostOtherLevels: boolean
  cutaway: boolean
  ortho: boolean
  overlayOn: boolean
  playing: boolean
  speed: number
  metrics: Metrics | null
  stats: SceneStats | null
  graph: GraphInfo | null
  selected: { kind: 'cell' | 'module'; key: string; label: string } | null
  past: StationState[]
  future: StationState[]
  lab: boolean

  setTool: (t: Tool) => void
  setModuleType: (t: string) => void
  setActiveZ: (z: number) => void
  stepLevel: (dir: number) => void
  setOverlay: (on: boolean) => void
  setGhostOther: (on: boolean) => void
  setCutaway: (on: boolean) => void
  setOrtho: (on: boolean) => void
  setPlaying: (on: boolean) => void
  setSpeed: (s: number) => void
  setMetrics: (m: Metrics) => void
  setStats: (s: SceneStats) => void
  setGraph: (g: GraphInfo) => void
  select: (sel: AppState['selected']) => void
  commit: (next: StationState) => void
  undo: () => void
  redo: () => void
  newStation: () => void
  loadReference: () => void
  setUpEscalators: (n: number) => void
}

function sendControl(playing: boolean, speed: number): void {
  client?.postMessage({ type: 'control', playing, speed })
}

let client: Worker | null = null
let frameCb: ((count: number, agents: Float32Array, density: Float32Array) => void) | null = null

/** Viewport registers here to receive the 5 Hz agent frame without re-rendering React. */
export function setFrameHandler(fn: ((count: number, agents: Float32Array, density: Float32Array) => void) | null): void {
  frameCb = fn
}

/** Boots the worker. Called once from main.tsx. */
export function initSim(data: StationData, seed: number, opts: { startSeconds?: number; warmup?: number } = {}): void {
  client = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })
  client.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'ready') {
      useStore.getState().setGraph(msg)
      // Open on the deepest built level so the platform crowd is what you see.
      if (msg.levelsZ.length > 0) useStore.getState().setActiveZ(msg.levelsZ[0])
    } else if (msg.type === 'state') {
      useStore.getState().setMetrics(msg.metrics)
      frameCb?.(msg.count, msg.agents, msg.density)
    }
  }
  client.postMessage({ type: 'init', data, seed, playing: true, speed: 1, ...opts })
}

export function rebuildSim(data: StationData): void {
  client?.postMessage({ type: 'build', data })
}

export const useStore = create<AppState>((set, get) => ({
  station: initialStation(),
  version: 0,
  tool: 'select',
  moduleType: 'gate',
  activeZ: 0,
  ghostOtherLevels: true,
  cutaway: false,
  ortho: false,
  overlayOn: false,
  playing: true,
  speed: 1,
  metrics: null,
  stats: null,
  graph: null,
  selected: null,
  past: [],
  future: [],
  lab: false,

  setTool: (t) => set({ tool: t }),
  setModuleType: (t) => set({ moduleType: t }),
  setActiveZ: (z) => set({ activeZ: z }),
  stepLevel: (dir) => {
    const g = get().graph
    const cur = get().activeZ
    if (!g || g.levelsZ.length === 0) {
      set({ activeZ: cur + dir })
      return
    }
    const levels = g.levelsZ
    let idx = 0
    let best = Infinity
    levels.forEach((z, i) => {
      const d = Math.abs(z - cur)
      if (d < best) {
        best = d
        idx = i
      }
    })
    const ni = Math.max(0, Math.min(levels.length - 1, idx + dir))
    set({ activeZ: levels[ni] })
  },
  setOverlay: (on) => set({ overlayOn: on }),
  setGhostOther: (on) => set({ ghostOtherLevels: on }),
  setCutaway: (on) => set({ cutaway: on }),
  setOrtho: (on) => set({ ortho: on }),
  setPlaying: (on) => {
    sendControl(on, get().speed)
    set({ playing: on })
  },
  setSpeed: (s) => {
    sendControl(get().playing, s)
    set({ speed: s })
  },
  setMetrics: (m) => set({ metrics: m }),
  setStats: (s) => set({ stats: s }),
  setGraph: (g) => set({ graph: g }),
  select: (sel) => set({ selected: sel }),

  commit: (next) => {
    const cur = get().station
    set({ station: next, version: get().version + 1, past: [...get().past, cloneState(cur)].slice(-40), future: [] })
    rebuildSim(toData(next))
  },
  undo: () => {
    const { past, station, future } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    set({ station: prev, past: past.slice(0, -1), future: [...future, cloneState(station)], version: get().version + 1 })
    rebuildSim(toData(prev))
  },
  redo: () => {
    const { future, station, past } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    set({ station: next, future: future.slice(0, -1), past: [...past, cloneState(station)], version: get().version + 1 })
    rebuildSim(toData(next))
  },
  newStation: () => {
    const s = toState({ name: '未命名车站', seed: 7654321, levels: [{ id: 'G', z: 0, kind: 'at-grade', height: 4.5 }], cells: [{ x: 0, y: 0, z: 0, fill: 'solid' }, { x: 1, y: 0, z: 0, fill: 'solid' }, { x: 0, y: 1, z: 0, fill: 'solid' }, { x: 1, y: 1, z: 0, fill: 'solid' }], modules: [], lines: [] })
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: 0 })
    rebuildSim(toData(s))
  },
  loadReference: () => {
    const s = toState(referenceStation())
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: -4 })
    rebuildSim(toData(s))
  },
  setUpEscalators: (n) => {
    const next = setUpEscalators(get().station, n)
    get().commit(next)
  },
}))
