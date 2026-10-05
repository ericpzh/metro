// The view slice: which storey is edited and how the others draw around it
// (level slicing in `render/levelSlicing.ts`), plus the camera and overlay
// toggles.

import type { StateCreator } from 'zustand'
import { nearestLevel } from '../../../build/model.ts'
import { LEVEL_STEPS } from '../../../sim/constants.ts'
import type { AppState } from '../Store.ts'

export interface ViewSlice {
  activeZ: number
  /**
   * 显示其他层, on by default: off it draws the edited storey alone at every
   * camera angle, on it ghosts the other storeys where they do not block that
   * storey (`render/levelSlicing.ts`).
   */
  ghostOtherLevels: boolean
  /**
   * 隐藏天花板: hide the slab a storey up (the active room's ceiling) so a
   * top-down camera looks into the room instead of onto its roof. Only a storey
   * *above* the active one is affected, and only while 显示其他层 is on.
   */
  autoCeiling: boolean
  cutaway: boolean
  /** 隐藏墙壁: draw every wall and platform screen door translucent. */
  hideWalls: boolean
  ortho: boolean
  overlayOn: boolean

  setActiveZ: (z: number) => void
  stepLevel: (dir: number) => void
  setOverlay: (on: boolean) => void
  setGhostOther: (on: boolean) => void
  setAutoCeiling: (on: boolean) => void
  setCutaway: (on: boolean) => void
  setHideWalls: (on: boolean) => void
  setOrtho: (on: boolean) => void
}

export const createViewSlice: StateCreator<AppState, [], [], ViewSlice> = (set, get) => ({
  activeZ: -8,
  ghostOtherLevels: true,
  autoCeiling: true,
  cutaway: false,
  hideWalls: false,
  ortho: false,
  overlayOn: false,

  setActiveZ: (z) => set({ activeZ: nearestLevel(z) }),
  stepLevel: (dir) => {
    const cur = nearestLevel(get().activeZ)
    const idx = LEVEL_STEPS.indexOf(cur)
    const ni = Math.max(0, Math.min(LEVEL_STEPS.length - 1, idx + dir))
    set({ activeZ: LEVEL_STEPS[ni] })
  },
  setOverlay: (on) => set({ overlayOn: on }),
  setGhostOther: (on) => set({ ghostOtherLevels: on }),
  setAutoCeiling: (on) => set({ autoCeiling: on }),
  setCutaway: (on) => set({ cutaway: on }),
  setHideWalls: (on) => set({ hideWalls: on }),
  setOrtho: (on) => set({ ortho: on }),
})
