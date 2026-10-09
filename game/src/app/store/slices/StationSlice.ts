// The station-document slice: the document itself, the undo stack, the
// selection, the transient toast, and opening/saving/renaming/reference
// stations. Every mutation goes through `commit` so the worker (`rebuildSim`)
// and the undo stack see the same document.

import type { StateCreator } from 'zustand'
import { REFERENCE_BOOT, referenceStation } from '../../../data/reference-station.ts'
import {
  cloneState,
  initialStation,
  nearestLevel,
  toData,
  toState,
  toStateRepairing,
  syncBridgePillars,
  type StationState,
} from '../../../build/model.ts'
import { parse as parseSave, serialize as serializeSave } from '../../../persistence/save.ts'
import { normalizePeaks, normalizeService } from '../../../sim/clock.ts'
import { normalizeDemand, type DemandKnobs } from '../../../sim/demand.ts'
import type { PeakWindows } from '../../../sim/constants.ts'
import type { AppState } from '../Store.ts'
import { loadSim, rebuildSim } from './SimSlice.ts'

/** Most undo frames, and the most document they may hold between them. */
const UNDO_MAX_FRAMES = 40
const UNDO_BUDGET = 120_000

/**
 * Roughly what one snapshot costs to keep: a cell is a small record, a module is a
 * whole piece with its own config (`cells + 4 x modules` is the shipped demo's
 * 11 627 + 1 576 ≈ 13 203, near enough to its ~2 MB in the heap — so the demo holds
 * **nine** frames of history, where a fresh 2 × 2 station holds all forty).
 */
function snapshotCost(s: StationState): number {
  return s.cells.length + s.modules.length * 4
}

/**
 * Push a snapshot onto the undo stack, dropping the oldest frames until the stack
 * fits both its depth limit and its memory budget.
 *
 * A depth cap alone says nothing about a large station: forty snapshots of an
 * 11 000-cell build is tens of megabytes held for the session, and the clone is paid
 * on every commit. A small station still gets all forty frames; a large one trades
 * depth for a ceiling.
 */
function pushPast(past: readonly StationState[], snap: StationState): StationState[] {
  const next = [...past, snap]
  let held = next.reduce((n, s) => n + snapshotCost(s), 0)
  while (next.length > 1 && (next.length > UNDO_MAX_FRAMES || held > UNDO_BUDGET)) {
    held -= snapshotCost(next[0])
    next.shift()
  }
  return next
}

export interface StationSlice {
  station: StationState
  version: number
  /**
   * Counts station switches (打开存档 / 示例车站 / 新建), never edits: the
   * viewport resets the camera home when this moves, after the fresh bounds
   * exist, while commits and undo leave the view alone.
   */
  stationEpoch: number
  /** Transient toast line (save/load results). */
  notice: string | null
  /**
   * What the 信息 card is describing: a block, a placed module, or — from the 选择
   * tool's click on a person (§9.5) — one agent of the crowd, whose remaining walk
   * the 3D view draws as a light-blue line on the floor.
   */
  selected: { kind: 'cell' | 'module' | 'agent'; key: string; label: string } | null
  past: StationState[]
  future: StationState[]
  lab: boolean

  setNotice: (n: string | null) => void
  saveToFile: () => void
  loadFromText: (text: string) => void
  select: (sel: AppState['selected']) => void
  /** Rename the station (top-bar title). Blank names are ignored. */
  renameStation: (name: string, nameEn?: string) => void
  /**
   * Set the station's operating hours (§9.6C 营业时间), in seconds since midnight. The
   * pair is repaired by `normalizeService` before it lands, so an inverted or
   * out-of-day window bends into range rather than being stored as written.
   */
  setServiceWindow: (from: number, to: number) => void
  /** Set one of the two peak windows (§9.6C 高峰时段): 0 早高峰, 1 晚高峰. */
  setPeakWindow: (index: number, from: number, to: number) => void
  /** Set the 客流曲线 knobs (§9.6C): any subset, repaired into its written range. */
  setDemandKnobs: (patch: Partial<DemandKnobs>) => void
  commit: (next: StationState) => void
  undo: () => void
  redo: () => void
  newStation: () => void
  loadReference: () => void
}

export const createStationSlice: StateCreator<AppState, [], [], StationSlice> = (set, get) => ({
  station: initialStation(),
  version: 0,
  stationEpoch: 0,
  notice: null,
  selected: null,
  past: [],
  future: [],
  lab: false,

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
    set({ station: s, past: pushPast(get().past, cloneState(get().station)), future: [], version: get().version + 1, stationEpoch: get().stationEpoch + 1, activeZ: s.levelBase, selected: null, moveDraft: null })
    loadSim(toData(s))
    // A save that carried blocks off the 1 m grid (nothing in the game can mint one,
    // so they came from outside) is repaired by `toState` rather than refused — say
    // so, because those blocks are gone and no tool could ever have removed them.
    const repaired = r.droppedCells + r.droppedModules
    set({
      notice: repaired > 0
        ? `已打开（存档 v${r.version}）：修复时删掉了 ${repaired} 个网格外的方块`
        : `已打开（存档 v${r.version}）`,
    })
  },
  select: (sel) => set({ selected: sel }),

  renameStation: (name, nameEn) => {
    const s = get().station
    const trimmed = name.trim()
    const english = nameEn === undefined ? (s.nameEn ?? '') : nameEn.trim()
    if (!trimmed || (trimmed === s.name && english === (s.nameEn ?? ''))) return
    get().commit({ ...s, name: trimmed, nameEn: english })
  },

  setServiceWindow: (from, to) => {
    const s = get().station
    const next = normalizeService({ from, to })
    // A keystroke that repairs to what is already stored is not an edit: it must not
    // push an undo frame or rebuild the worker's graph.
    if (next.from === s.service.from && next.to === s.service.to) return
    get().commit({ ...s, service: next })
  },

  setPeakWindow: (index, from, to) => {
    const s = get().station
    // The other end of the pair is read out of the document, so a peak edit can never
    // write a `peaks` array of the wrong length or lose the window beside it.
    const pair = s.peaks.map((p, i) => (i === index ? { from, to } : { ...p })) as PeakWindows
    const next = normalizePeaks(pair)
    if (next[0].from === s.peaks[0].from && next[0].to === s.peaks[0].to && next[1].from === s.peaks[1].from && next[1].to === s.peaks[1].to) return
    get().commit({ ...s, peaks: next })
  },

  setDemandKnobs: (patch) => {
    const s = get().station
    const next = normalizeDemand({ ...s.demand, ...patch })
    if (next.amPeak === s.demand.amPeak && next.pmPeak === s.demand.pmPeak && next.sharpness === s.demand.sharpness) return
    get().commit({ ...s, demand: next })
  },

  commit: (next) => {
    next = syncBridgePillars(next)
    const cur = get().station
    set({ station: next, version: get().version + 1, past: pushPast(get().past, cloneState(cur)), future: [] })
    rebuildSim(toData(next))
  },
  undo: () => {
    const { past, station, future } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    set({ station: prev, past: past.slice(0, -1), future: [...future, cloneState(station)], version: get().version + 1, activeZ: nearestLevel(get().activeZ - station.levelBase + prev.levelBase, prev.levelBase) })
    rebuildSim(toData(prev))
  },
  redo: () => {
    const { future, station, past } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    set({ station: next, future: future.slice(0, -1), past: pushPast(past, cloneState(station)), version: get().version + 1, activeZ: nearestLevel(get().activeZ - station.levelBase + next.levelBase, next.levelBase) })
    rebuildSim(toData(next))
  },
  newStation: () => {
    const s = toState({ name: '未命名车站', seed: 7654321, cells: [], modules: [], lines: [] })
    set({ station: s, past: pushPast(get().past, cloneState(get().station)), future: [], version: get().version + 1, stationEpoch: get().stationEpoch + 1, activeZ: s.levelBase, selected: null, moveDraft: null })
    loadSim(toData(s))
  },
  loadReference: () => {
    // The demo file is guarded clean by `demo.test.mjs`, but the same repair runs
    // here: an off-grid block would be dropped rather than loaded, not refused.
    const repaired = toStateRepairing(referenceStation())
    const s = repaired.state
    set({ station: s, past: pushPast(get().past, cloneState(get().station)), future: [], version: get().version + 1, stationEpoch: get().stationEpoch + 1, activeZ: -8 + s.levelBase, selected: null, moveDraft: null })
    loadSim(toData(s), REFERENCE_BOOT)
    if (repaired.droppedCells + repaired.droppedModules > 0) {
      set({ notice: `示例车站修复时删掉了 ${repaired.droppedCells + repaired.droppedModules} 个网格外的方块` })
    }
  },
})
