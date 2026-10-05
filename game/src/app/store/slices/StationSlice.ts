// The station-document slice: the document itself, the undo stack, the
// selection, the transient toast, and opening/saving/renaming/reference
// stations. Every mutation goes through `commit` so the worker (`rebuildSim`)
// and the undo stack see the same document.

import type { StateCreator } from 'zustand'
import { REFERENCE_BOOT, referenceStation } from '../../../data/reference-station.ts'
import {
  cloneState,
  initialStation,
  toData,
  toState,
  toStateRepairing,
  type StationState,
} from '../../../build/model.ts'
import { parse as parseSave, serialize as serializeSave } from '../../../persistence/save.ts'
import type { AppState } from '../Store.ts'
import { loadSim, rebuildSim } from './SimSlice.ts'

export interface StationSlice {
  station: StationState
  version: number
  /** Transient toast line (save/load results). */
  notice: string | null
  selected: { kind: 'cell' | 'module'; key: string; label: string } | null
  past: StationState[]
  future: StationState[]
  lab: boolean

  setNotice: (n: string | null) => void
  saveToFile: () => void
  loadFromText: (text: string) => void
  select: (sel: AppState['selected']) => void
  /** Rename the station (top-bar title). Blank names are ignored. */
  renameStation: (name: string) => void
  commit: (next: StationState) => void
  undo: () => void
  redo: () => void
  newStation: () => void
  loadReference: () => void
}

export const createStationSlice: StateCreator<AppState, [], [], StationSlice> = (set, get) => ({
  station: initialStation(),
  version: 0,
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
    set({ station: s, past: [...get().past, cloneState(get().station)].slice(-40), future: [], version: get().version + 1, selected: null, moveDraft: null })
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
    const s = toState({ name: '未命名车站', seed: 7654321, cells: [], modules: [], lines: [] })
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: 0, selected: null, moveDraft: null })
    loadSim(toData(s))
  },
  loadReference: () => {
    // The demo file is guarded clean by `demo.test.mjs`, but the same repair runs
    // here: an off-grid block would be dropped rather than loaded, not refused.
    const repaired = toStateRepairing(referenceStation())
    const s = repaired.state
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: -8, selected: null, moveDraft: null })
    loadSim(toData(s), REFERENCE_BOOT)
    if (repaired.droppedCells + repaired.droppedModules > 0) {
      set({ notice: `示例车站修复时删掉了 ${repaired.droppedCells + repaired.droppedModules} 个网格外的方块` })
    }
  },
})
