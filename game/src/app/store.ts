// App state. The station document lives here; the sim lives in the worker and
// is driven by the messages in sim/protocol.ts. Panels only — no sim logic.

import { create } from 'zustand'
import type { FromWorker, GraphInfo } from '../sim/protocol.ts'
import type { Metrics } from '../sim/world.ts'
import { DEFAULT_ZONE, type FinishId, type StationData, type Zone } from '../sim/types.ts'
import { referenceStation } from '../data/reference-station.ts'
import { cloneState, initialStation, LEVEL_STEPS, nearestLevel, nextEscalatorDir, removeModule, toData, toState, type StationState } from '../build/model.ts'
import { defaultLine, dropDerivedEdges, placeRail, regenerateRailEdges, type RailRect } from '../build/rail.ts'
import { parse as parseSave, serialize as serializeSave } from '../persistence/save.ts'
import { STAIR_WIDTH_NORMAL, nextStairWidth } from '../sim/stairs.ts'
import type { LineDef, LineDirection } from '../sim/types.ts'
import type { SceneStats } from '../render/scene.ts'

export type Tool = 'select' | 'block' | 'module' | 'paint' | 'zone' | 'rail'
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
export type FacilityBrush = 'shop' | 'toilet' | 'office' | 'booth'
export type ZoneBrush = Zone | FacilityBrush

export const FACILITY_OPTIONS: Array<{ id: FacilityBrush; label: string; colour: number }> = [
  { id: 'shop', label: '商店', colour: 0xb07cc6 },
  { id: 'toilet', label: '厕所', colour: 0x5fb7a6 },
  { id: 'office', label: '办公室', colour: 0xd9a24b },
  { id: 'booth', label: '售票亭', colour: 0x42a5c4 },
]

export function isFacilityBrush(b: ZoneBrush): b is FacilityBrush {
  return b === 'shop' || b === 'toilet' || b === 'office' || b === 'booth'
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

/** Friendly names for a walled room's fit-out, keyed by `shop.cfg.kind`. */
const ROOM_KIND_LABELS: Record<string, string> = {
  store: '商店',
  toilet: '厕所',
  office: '办公室',
}

export function moduleLabel(type: string, roomKind?: string): string {
  if (type === 'shop') return ROOM_KIND_LABELS[roomKind ?? 'store'] ?? MODULE_LABELS.shop
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
  /** Rail tool: the line/direction/power a freshly laid bed binds to. */
  railLineId: string
  railDir: LineDirection
  railPower: 'third-rail' | 'catenary'
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
  setRailLine: (id: string) => void
  setRailDir: (dir: LineDirection) => void
  setRailPower: (p: 'third-rail' | 'catenary') => void
  /** Lay a rail bed (dig + track module + derived screen doors) and commit it. */
  layRail: (rect: RailRect) => void
  /** Re-derive a rail's screen doors after the platform floor changed. */
  regenRail: (trackId: string) => void
  /** Re-derive the selected rail's doors, or every rail's when none is selected. */
  refreshRailDoors: () => void
  /** Remove a rail and the screen doors derived from it. */
  removeRail: (trackId: string) => void
  /** Edit a rail's line/direction and re-derive its screen doors. */
  updateRail: (trackId: string, patch: { line?: string; dir?: LineDirection; power?: 'third-rail' | 'catenary' }) => void
  /** Edit a line's shared parameters (stock, cars, headway, colour). */
  updateLine: (lineId: string, patch: Partial<LineDef>) => void
  /** Add a new line and make it the rail tool's target. */
  addLine: () => void
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
  railLineId: '',
  railDir: 'up',
  railPower: 'third-rail',
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
  setRailLine: (id) => set({ railLineId: id }),
  setRailDir: (dir) => set({ railDir: dir }),
  setRailPower: (p) => set({ railPower: p }),
  layRail: (rect) => {
    const st = get()
    let station = st.station
    let lineId = st.railLineId
    if (!station.lines.some((l) => l.id === lineId)) {
      // First rail on a fresh station: create the line it binds to, so placement
      // never stalls on an empty line list.
      if (station.lines.length === 0) {
        const line = defaultLine('1', st.railDir, st.railPower)
        station = { ...station, lines: [line] }
        lineId = line.id
      } else {
        lineId = station.lines[0].id
      }
      set({ railLineId: lineId })
    }
    const next = placeRail(station, rect, { lineId, dir: st.railDir, power: st.railPower })
    if (next === station) {
      set({ notice: '这里已经有轨道了' })
      return
    }
    get().commit(next)
    const track = [...next.modules].reverse().find((m) => m.type === 'track')
    const derived = track ? next.modules.filter((m) => m.type === 'platform-edge' && m.cfg.from === track.id).length : 0
    set({ notice: derived > 0 ? `轨道已铺设，自动生成 ${derived} 段站台门` : '轨道已铺设；旁边没有站台，站台门暂未生成' })
  },
  regenRail: (trackId) => {
    const next = regenerateRailEdges(get().station, trackId)
    get().commit(next)
    set({ notice: '站台门已按当前站台重新生成' })
  },
  refreshRailDoors: () => {
    const st = get()
    const sel = st.selected
    if (sel?.kind === 'module' && st.station.modules.some((m) => m.id === sel.key && m.type === 'track')) {
      get().commit(regenerateRailEdges(st.station, sel.key))
      set({ notice: '已刷新所选轨道的站台门' })
      return
    }
    // Snapshot the ids first: regeneration grows `modules` as it goes.
    const ids = st.station.modules.filter((m) => m.type === 'track').map((m) => m.id)
    if (ids.length === 0) {
      set({ notice: '还没有轨道' })
      return
    }
    let next = st.station
    for (const id of ids) next = regenerateRailEdges(next, id)
    get().commit(next)
    set({ notice: `已按当前站台刷新 ${ids.length} 条轨道的站台门` })
  },
  removeRail: (trackId) => {
    const cleaned = dropDerivedEdges(get().station, trackId)
    get().commit(removeModule(cleaned, trackId))
    set({ notice: '轨道已拆除' })
  },
  updateRail: (trackId, patch) => {
    const st = get()
    const modules = st.station.modules.map((m) =>
      m.id === trackId && m.type === 'track' ? { ...m, cfg: { ...m.cfg, ...patch } } : m,
    )
    const edited = { ...st.station, modules }
    get().commit(regenerateRailEdges(edited, trackId))
  },
  updateLine: (lineId, patch) => {
    const st = get()
    // Consist is 1–8 cars for every stock class; clamp so a bad save or a stale
    // caller cannot produce a zero-length train.
    const fixed = patch.cars !== undefined ? { ...patch, cars: Math.max(1, Math.min(8, Math.round(patch.cars))) } : patch
    const lines = st.station.lines.map((l) => (l.id === lineId ? { ...l, ...fixed } : l))
    get().commit({ ...st.station, lines })
  },
  addLine: () => {
    const st = get()
    const used = new Set(st.station.lines.map((l) => l.id))
    let n = st.station.lines.length + 1
    while (used.has(String(n))) n++
    const id = String(n)
    const line = defaultLine(id, st.railDir, st.railPower)
    get().commit({ ...st.station, lines: [...st.station.lines, line] })
    set({ railLineId: id, notice: `已新建 ${line.name}，铺轨时自动绑定` })
  },
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
