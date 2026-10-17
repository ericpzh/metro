import { parse, serialize } from '../persistence/save.ts'
import type { StationState } from '../build/model.ts'

export const AUTOSAVE_KEY = 'metro-game.autosave.v1'
export const AUTOSAVE_INTERVAL_MS = 300_000

interface DocumentState {
  station: StationState
  version: number
  stationEpoch: number
}

interface AutosaveStore {
  getState: () => DocumentState
  subscribe: (listener: (state: DocumentState, previous: DocumentState) => void) => () => void
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readAutosave(storage: Storage): StationState | null {
  try {
    const text = storage.getItem(AUTOSAVE_KEY)
    if (!text) return null
    const result = parse(text)
    return result.ok ? result.state : null
  } catch { return null }
}

/** Watch committed documents only; previews and simulation frames never dirty a save. */
export function watchAutosave(store: AutosaveStore, storage: Storage) {
  let savedVersion = store.getState().version
  const flush = () => {
    const state = store.getState()
    if (state.version === savedVersion) return
    try {
      storage.setItem(AUTOSAVE_KEY, serialize(state.station))
      savedVersion = state.version
    } catch { /* Keep dirty so the next interval retries unavailable/full storage. */ }
  }
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.stationEpoch === previous.stationEpoch) return
    // Invalidate first: if the new station exceeds quota, never restore the old one.
    try { storage.removeItem(AUTOSAVE_KEY) } catch { /* Storage may be blocked. */ }
    flush()
  })
  return { flush, unsubscribe }
}
