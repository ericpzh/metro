import type { StateCreator } from 'zustand'
import { liftWithDoorSide } from '../../../sim/lifts.ts'
import type { LiftDoorSide } from '../../../sim/types.ts'
import type { AppState } from '../Store.ts'

// The lift-door slice (§5.1): choosing which face of a shaft's cabin opens at
// one storey. Like every inspector control that edits a placed piece, this is
// one store action committing one station edit, so the worker, the undo stack
// and the selected document all see the same shaft.

export interface LiftSlice {
  /**
   * Set which cabin doors a shaft opens at the storey `z` — front (local −y,
   * the default), back (local +y) or both, the through-floor. One `commit`, so
   * one `Ctrl+Z` takes the whole choice back.
   */
  setLiftDoorSide: (moduleId: string, z: number, side: LiftDoorSide) => void
}

export const createLiftSlice: StateCreator<AppState, [], [], LiftSlice> = (_set, get) => ({
  setLiftDoorSide: (moduleId, z, side) => {
    const st = get()
    const modules = st.station.modules.map((m) =>
      m.id === moduleId && m.type === 'lift' ? liftWithDoorSide(m, z, side) : m,
    )
    if (modules.every((m, i) => m === st.station.modules[i])) return
    get().commit({ ...st.station, modules })
  },
})
