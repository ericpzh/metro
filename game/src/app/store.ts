// App state. The station document lives here; the sim lives in the worker and
// is driven by the messages in sim/protocol.ts. Panels only — no sim logic.

import { create } from 'zustand'
import type { FromWorker, GraphInfo } from '../sim/protocol.ts'
import type { Metrics } from '../sim/world.ts'
import { DEFAULT_ZONE, type FinishId, type StationData, type Zone } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'
import { cloneState, initialStation, LEVEL_STEPS, nearestLevel, nextEscalatorDir, toData, toState, type StationState } from '../build/model.ts'
import { parse as parseSave, serialize as serializeSave } from '../persistence/save.ts'
import { STAIR_WIDTH_NORMAL, nextStairWidth } from '../sim/stairs.ts'
import type { SceneStats } from '../render/scene.ts'

export type Tool = 'select' | 'block' | 'module' | 'paint' | 'zone'
export type PaintMode = 'single' | 'surface' | 'pick'

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
  { id: 'escalator', label: '扶梯', type: 'escalator', w: 1, h: 1 },
  { id: 'stair-straight', label: '单跑楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-left90', label: '左转角楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-right90', label: '右转角楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-right180', label: '双跑楼梯', type: 'stair', w: 1, h: 1 },
]

/** True for any of the four fixed staircase shapes in the palette. */
export function isStairType(type: string): boolean {
  return type === 'stair' || type.startsWith('stair-')
}

/** True for the fixed escalator piece, whose Tab cycle is up/down instead. */
export function isEscalatorType(type: string): boolean {
  return type === 'escalator'
}

/**
 * Equipment that is moulded at one angle and cannot be turned by the player.
 * Every piece in the current catalogue rotates, so this is empty; it is the one
 * place to list a future fixed-angle module (a wall-mounted sign, a one-way
 * gate body). The rail's 旋转 button and the R key both read `isRotatableType`,
 * so adding a type here removes the control for it automatically.
 */
const FIXED_ANGLE_TYPES: ReadonlySet<string> = new Set<string>([])

/** True when the player may turn this equipment before placing it (R / 旋转). */
export function isRotatableType(type: string): boolean {
  return !FIXED_ANGLE_TYPES.has(type)
}

/** Facility rooms built by dragging a rectangle in the zone tool. */
export type FacilityBrush = 'shop' | 'booth'
export type ZoneBrush = Zone | FacilityBrush

export const FACILITY_OPTIONS: Array<{ id: FacilityBrush; label: string; colour: number }> = [
  { id: 'shop', label: '商店', colour: 0xb07cc6 },
  { id: 'booth', label: '售票亭', colour: 0x42a5c4 },
]

export function isFacilityBrush(b: ZoneBrush): b is FacilityBrush {
  return b === 'shop' || b === 'booth'
}

/** Friendly name for a module type, for the inspector and the bulldoze notice. */
const MODULE_LABELS: Record<string, string> = {
  gate: '闸机',
  tvm: '售票机',
  bench: '座椅',
  exit: '出入口',
  escalator: '扶梯',
  stair: '楼梯',
  lift: '电梯',
  retail: '商铺',
  shop: '商店',
  booth: '售票亭',
  'platform-edge': '站台门',
  track: '轨道',
}

export function moduleLabel(type: string): string {
  return MODULE_LABELS[type] ?? MODULE_OPTIONS.find((m) => m.type === type)?.label ?? type
}

export interface AppState {
  station: StationState
  version: number
  tool: Tool
  moduleType: string
  /** Quarter-turn applied to the equipment being placed: 0..3. */
  moduleRot: number
  /** Stair tread width, cycled with Tab (narrow = escalator bay). */
  stairWidth: number
  /** Escalator travel direction, cycled with Tab (up/down). */
  escalatorDir: 'up' | 'down'
  paintMode: PaintMode
  /** Active finish brush — the face's family decides which ones apply. */
  paintFinish: FinishId
  /** Active fare-zone brush, or a facility room (§5.7) built by rectangle. */
  zoneBrush: ZoneBrush
  zoneOverlayOn: boolean
  /** Transient toast line (save/load results). */
  notice: string | null
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
  /** Turn the placement ghost 90° clockwise (R). */
  rotateModule: () => void
  /** Cycle the stair width between narrow (escalator) and normal (Tab). */
  cycleStairWidth: () => void
  /** Flip the escalator travel direction up ↔ down (Tab). */
  cycleEscalatorDir: () => void
  setPaintMode: (m: PaintMode) => void
  setPaintFinish: (id: FinishId) => void
  setZoneBrush: (z: ZoneBrush) => void
  setZoneOverlay: (on: boolean) => void
  setNotice: (n: string | null) => void
  saveToFile: () => void
  loadFromText: (text: string) => void
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
  /** Rename the station (top-bar title). Blank names are ignored. */
  renameStation: (name: string) => void
  commit: (next: StationState) => void
  undo: () => void
  redo: () => void
  newStation: () => void
  loadReference: () => void
}

function sendControl(playing: boolean, speed: number): void {
  client?.postMessage({ type: 'control', playing, speed })
}

let client: Worker | null = null
let frameCb:
  | ((count: number, agents: Float32Array, density: Float32Array, trains: Float32Array, intervalMs: number) => void)
  | null = null

/** Viewport registers here to receive the agent frame without re-rendering React. */
export function setFrameHandler(
  fn:
    | ((count: number, agents: Float32Array, density: Float32Array, trains: Float32Array, intervalMs: number) => void)
    | null,
): void {
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
      frameCb?.(msg.count, msg.agents, msg.density, msg.trains, msg.intervalMs)
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
  moduleRot: 0,
  stairWidth: STAIR_WIDTH_NORMAL,
  escalatorDir: 'up',
  paintMode: 'single',
  paintFinish: 'floor.granite',
  zoneBrush: DEFAULT_ZONE,
  zoneOverlayOn: false,
  notice: null,
  activeZ: -8,
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
  // Clockwise on screen: the world turns +x toward −y in the isometric view.
  // A fixed-angle piece simply ignores the turn, so the guard lives here as well
  // as on the rail button.
  rotateModule: () =>
    set((s) => (isRotatableType(s.moduleType) ? { moduleRot: (s.moduleRot + 3) % 4 } : {})),
  cycleStairWidth: () => set((s) => ({ stairWidth: nextStairWidth(s.stairWidth) })),
  cycleEscalatorDir: () => set((s) => ({ escalatorDir: nextEscalatorDir(s.escalatorDir) })),
  setPaintMode: (m) => set({ paintMode: m }),
  setPaintFinish: (id) => set({ paintFinish: id }),
  setZoneBrush: (z) => set({ zoneBrush: z }),
  setZoneOverlay: (on) => set({ zoneOverlayOn: on }),
  setNotice: (n) => set({ notice: n }),
  saveToFile: () => {
    const s = get().station
    const text = serializeSave(s)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.name || 'station'}.metro.json`
    a.click()
    URL.revokeObjectURL(url)
    set({ notice: '已保存' })
  },
  loadFromText: (text) => {
    const r = parseSave(text)
    if (!r.ok) {
      set({ notice: r.error })
      return
    }
    const s = r.state
    set({ station: s, past: [...get().past, cloneState(get().station)].slice(-40), future: [], version: get().version + 1 })
    rebuildSim(toData(s))
    set({ notice: `已打开（存档 v${r.version}）` })
  },
  setActiveZ: (z) => set({ activeZ: nearestLevel(z) }),
  stepLevel: (dir) => {
    const cur = nearestLevel(get().activeZ)
    const idx = LEVEL_STEPS.indexOf(cur)
    const ni = Math.max(0, Math.min(LEVEL_STEPS.length - 1, idx + dir))
    set({ activeZ: LEVEL_STEPS[ni] })
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

  renameStation: (name) => {
    const s = get().station
    const trimmed = name.trim()
    if (!trimmed || trimmed === s.name) return
    get().commit({ ...s, name: trimmed })
  },

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
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: -8 })
    rebuildSim(toData(s))
  },
}))
