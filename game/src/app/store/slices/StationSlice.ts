import { normalizeCityStyle, type CityStyle } from '../../../sim/cityStyles.ts'
import { msg } from '../../../sim/i18n.ts'
import { populationEdit } from '../../../sim/populationEdit.ts'
import { clearContactFinishes } from '../../../sim/contactFinishes.ts'
// The station-document slice: the document itself, the undo stack, the
// selection, the transient toast, and opening/saving/renaming/reference
// stations. Every mutation goes through `commit` so the worker (`rebuildSim`)
// and the undo stack see the same document.

import type { StateCreator } from 'zustand'
import { emptyStation, REFERENCE_BOOT, referenceStation } from '../../../data/reference-station.ts'
import type { ExampleStationId } from '../../../data/reference-station.ts'
import {
  nearestLevel,
  toData,
  toState,
  toStateRepairing,
  syncBridgePillars,
  type StationState,
} from '../../../build/model.ts'
import { parse as parseSave, serialize as serializeSave } from '../../../persistence/save.ts'
import { forgetDocumentCaches } from '../../../sim/documentCaches.ts'
import { normalizePeaks, normalizeService } from '../../../sim/clock.ts'
import { normalizeDayDemand, type DayDemand, type DemandKnobs } from '../../../sim/demand.ts'
import type { PeakWindows } from '../../../sim/constants.ts'
import type { AppState } from '../Store.ts'
import { loadSim, rebuildSim } from './SimSlice.ts'
import { openingLevel } from '../../openingLevel.ts'

/** Most undo frames. */
const UNDO_MAX_FRAMES = 40

/**
 * Push a snapshot onto the undo stack, dropping the oldest frame past the depth
 * limit.
 *
 * Documents are immutable: `commit` retains the previous document rather than
 * cloning it, so neighbouring frames share every untouched cell, module and line
 * record. A frame costs its own wrapper plus the records an edit replaced, not a
 * copy of the station — which is why a 14 000-cell demo keeps the same forty frames
 * as a 2 × 2 slab. Charging each frame a full document here (the old
 * `cells + 4 x modules` budget) dropped history on a large station until only one
 * Ctrl+Z was left.
 */
function pushPast(past: readonly StationState[], snap: StationState): StationState[] {
  const next = [...past, snap]
  if (next.length > UNDO_MAX_FRAMES) next.splice(0, next.length - UNDO_MAX_FRAMES)
  return next
}

export interface StationSlice {
  station: StationState
  version: number
  /** Structural document revision; invisible settings never dirty view effects. */
  geometryVersion: number
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
  /** Undo/redo frames for edits to the current station. A station switch clears both. */
  past: StationState[]
  future: StationState[]
  lab: boolean

  setNotice: (n: string | null) => void
  saveToFile: () => void
  loadFromText: (text: string) => void
  select: (sel: AppState['selected']) => void
  /** Rename the station (top-bar title). Blank names are ignored. */
  renameStation: (name: string, nameEn?: string) => void
  setCityStyle: (city: CityStyle) => void
  /**
   * Set the station's operating hours (§9.6C 营业时间), in seconds since midnight. The
   * pair is repaired by `normalizeService` before it lands, so an inverted or
   * out-of-day window bends into range rather than being stored as written.
   */
  setServiceWindow: (from: number, to: number) => void
  /** Set one of the two peak windows (§9.6C 高峰时段): 0 早高峰, 1 晚高峰. */
  setPeakWindow: (index: number, from: number, to: number) => void
  /** Set the 客流曲线 knobs (§9.6C) of one of the two saved curves: any subset, repaired into its written range. */
  setDemandKnobs: (kind: keyof DayDemand, patch: Partial<DemandKnobs>) => void
  commit: (next: StationState) => void
  undo: () => void
  redo: () => void
  newStation: () => void
  loadReference: (id?: ExampleStationId) => void
}

export const createStationSlice: StateCreator<AppState, [], [], StationSlice> = (set, get) => ({
  station: toState(emptyStation()),
  version: 0,
  geometryVersion: 0,
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
    set({ notice: msg('saved') })
  },
  loadFromText: (text) => {
    const r = parseSave(text)
    if (!r.ok) {
      set({ notice: r.error })
      return
    }
    // Opening a file starts a new document, not an edit to the one that was open:
    // its history does not survive the switch, so Ctrl+Z cannot bring back the
    // previous station and there is no redo branch into this one.
    const previous = get().station
    const s = r.state
    set({ station: s, past: [], future: [], version: get().version + 1, geometryVersion: get().geometryVersion + 1, stationEpoch: get().stationEpoch + 1, activeZ: openingLevel(s), selected: null, moveDraft: null })
    loadSim(toData(s))
    // The retired document is not on the new station's history, so release the
    // station-sized derived indexes rather than keeping them alive with it.
    forgetDocumentCaches(previous.cells, previous.modules, s.cells, s.modules)
    // A save that carried blocks off the 1 m grid (nothing in the game can mint one,
    // so they came from outside) is repaired by `toState` rather than refused — say
    // so, because those blocks are gone and no tool could ever have removed them.
    const repaired = r.droppedCells + r.droppedModules
    set({
      notice: repaired > 0
        ? msg('opened_save_vvalue_repair_removed_value_blocks_outside_the_grid', r.version, repaired)
        : msg('opened_save_vvalue', r.version),
    })
  },
  select: (sel) => {
    const current = get().selected
    if (current?.kind === sel?.kind && current?.key === sel?.key && current?.label === sel?.label) return
    set({ selected: sel })
  },

  setCityStyle: (value) => {
    const s = get().station, cityStyle = normalizeCityStyle(value)
    if (s.cityStyle === cityStyle) return
    get().commit({ ...s, cityStyle })
  },

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

  setDemandKnobs: (kind, patch) => {
    const s = get().station
    const next = normalizeDayDemand({ ...s.demand, [kind]: { ...s.demand[kind], ...patch } })
    if (
      next.workday.amPeak === s.demand.workday.amPeak && next.workday.pmPeak === s.demand.workday.pmPeak &&
      next.workday.sharpness === s.demand.workday.sharpness && next.offday.amPeak === s.demand.offday.amPeak &&
      next.offday.pmPeak === s.demand.offday.pmPeak && next.offday.sharpness === s.demand.offday.sharpness
    ) return
    get().commit({ ...s, demand: next })
  },

  commit: (next) => {
    const cur = get().station
    if (next === cur) return
    const settingsOnly = populationEdit(cur, next)
    if (!settingsOnly) next = syncBridgePillars(next)
    if (next.cells !== cur.cells) {
      const cells = clearContactFinishes(next.cells)
      if (cells !== next.cells) next = { ...next, cells }
    }
    // Documents are immutable (the renderer and placement caches rely on this).
    // Keep that same ownership contract through structural history as well:
    // cloning every module/cell adds work and discards reusable derived indexes.
    set({ station: next, version: get().version + 1, geometryVersion: get().geometryVersion + (settingsOnly ? 0 : 1), past: pushPast(get().past, cur), future: [] })
    rebuildSim(toData(next), toData(cur))
    // The frame just retired keeps its immutable records, not the station-sized
    // placement/collision/ground indexes the hover built against it.
    forgetDocumentCaches(cur.cells, cur.modules, next.cells, next.modules)
  },
  undo: () => {
    const { past, station, future } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    const settingsOnly = populationEdit(station, prev)
    set({ station: prev, past: past.slice(0, -1), future: [...future, station], version: get().version + 1, geometryVersion: get().geometryVersion + (settingsOnly ? 0 : 1), activeZ: nearestLevel(get().activeZ - station.levelBase + prev.levelBase, prev.levelBase, prev.storeyHeight) })
    rebuildSim(toData(prev), toData(station))
    forgetDocumentCaches(station.cells, station.modules, prev.cells, prev.modules)
  },
  redo: () => {
    const { future, station, past } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    const settingsOnly = populationEdit(station, next)
    set({ station: next, future: future.slice(0, -1), past: pushPast(past, station), version: get().version + 1, geometryVersion: get().geometryVersion + (settingsOnly ? 0 : 1), activeZ: nearestLevel(get().activeZ - station.levelBase + next.levelBase, next.levelBase, next.storeyHeight) })
    rebuildSim(toData(next), toData(station))
    forgetDocumentCaches(station.cells, station.modules, next.cells, next.modules)
  },
  newStation: () => {
    const previous = get().station
    const s = toState(emptyStation())
    set({ station: s, past: [], future: [], version: get().version + 1, geometryVersion: get().geometryVersion + 1, stationEpoch: get().stationEpoch + 1, activeZ: s.levelBase, selected: null, moveDraft: null })
    loadSim(toData(s))
    forgetDocumentCaches(previous.cells, previous.modules, s.cells, s.modules)
  },
  loadReference: (id = 'zoo') => {
    // The demo file is guarded clean by `demo.test.mjs`, but the same repair runs
    // here: an off-grid block would be dropped rather than loaded, not refused.
    const repaired = toStateRepairing(referenceStation(id))
    const previous = get().station
    const s = repaired.state
    set({ station: s, past: [], future: [], version: get().version + 1, geometryVersion: get().geometryVersion + 1, stationEpoch: get().stationEpoch + 1, activeZ: openingLevel(s), selected: null, moveDraft: null })
    loadSim(toData(s), REFERENCE_BOOT)
    forgetDocumentCaches(previous.cells, previous.modules, s.cells, s.modules)
    if (repaired.droppedCells + repaired.droppedModules > 0) {
      set({ notice: msg('example_station_repair_removed_value_blocks_outside_the_grid', repaired.droppedCells + repaired.droppedModules) })
    }
  },
})
