import type { StateCreator } from 'zustand'
import { readShareStats, saveShareStats } from '../../statsSettings.ts'
import type { AppState } from '../Store.ts'

/**
 * The anonymous-stats preference. It is deliberately its own slice: it is a
 * player-level consent setting, not a view or a station edit, and toggling it
 * must not dirty the document or the undo stack.
 */
export interface StatsSlice {
  shareStats: boolean
  setShareStats: (on: boolean) => void
}

export const createStatsSlice: StateCreator<AppState, [], [], StatsSlice> = (set) => ({
  shareStats: readShareStats(),
  setShareStats: (on) => {
    saveShareStats(on)
    set({ shareStats: on })
  },
})
