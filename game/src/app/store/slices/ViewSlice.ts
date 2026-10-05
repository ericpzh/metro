// The view slice: which storey is edited and how the others draw around it
// (level slicing in `render/levelSlicing.ts`), plus the camera and overlay
// toggles, the 沉浸 eye and the 剖切 surface.

import type { StateCreator } from 'zustand'
import { nearestLevel } from '../../../build/model.ts'
import { LEVEL_STEPS } from '../../../sim/constants.ts'
import { DEFAULT_SECTION_AZIMUTH, DEFAULT_SECTION_ELEVATION } from '../../../render/section.ts'
import type { Section, Vec3 } from '../../../render/section.ts'
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
  /** 剖切: clip the station at the placed section surface. */
  cutaway: boolean
  /** 隐藏墙壁: draw every wall and platform screen door translucent. */
  hideWalls: boolean
  /**
   * 隐藏UI: take the drawing furniture off the picture — the 1 m editing lattice
   * and its cell cursor (`render/scene/systems/GridSystem.ts`). It hides nothing
   * of the station and nothing of the interface, so the rail, the panels and the
   * tools all stay exactly where they are.
   */
  hideUI: boolean
  ortho: boolean
  overlayOn: boolean
  /**
   * 沉浸 (§9.7): the whole interface is put away and the camera becomes an eye
   * inside the station, standing a person's height above the floor of the
   * storey being edited, with every storey drawn crisp so what is seen is what
   * the geometry really hides.
   */
  immersion: boolean
  /**
   * The 剖切 surface: where it was anchored, how it is turned and how far it has
   * slid (`render/section.ts`). The rail's location box, its rotation controls
   * and the 3D drag all write this one record, so the plane, the highlighted
   * surface and the pointer can never disagree about where the cut is.
   */
  section: Section

  setActiveZ: (z: number) => void
  stepLevel: (dir: number) => void
  setOverlay: (on: boolean) => void
  setGhostOther: (on: boolean) => void
  setAutoCeiling: (on: boolean) => void
  setCutaway: (on: boolean) => void
  setHideWalls: (on: boolean) => void
  setHideUI: (on: boolean) => void
  setOrtho: (on: boolean) => void
  setImmersion: (on: boolean) => void
  /** Re-place the cut at `anchor` on the storey being edited (a fresh 剖切). */
  placeSection: (anchor: Vec3) => void
  /** Slide the cut along its normal, in metres. */
  setSectionOffset: (offset: number) => void
  /** Turn the cut: `azimuth` degrees, or `elevation` when `tilt` is set. */
  rotateSection: (delta: number, tilt?: boolean) => void
  /** A whole new orientation, from the rail's own controls. */
  setSectionOrientation: (azimuth: number, elevation: number) => void
}

export const createViewSlice: StateCreator<AppState, [], [], ViewSlice> = (set, get) => ({
  activeZ: -8,
  ghostOtherLevels: true,
  autoCeiling: true,
  cutaway: false,
  hideWalls: false,
  hideUI: false,
  ortho: false,
  overlayOn: false,
  immersion: false,
  section: { anchor: [0, 0, -8], orientation: { azimuth: DEFAULT_SECTION_AZIMUTH, elevation: DEFAULT_SECTION_ELEVATION }, offset: 0 },

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
  setHideUI: (on) => set({ hideUI: on }),
  setOrtho: (on) => set({ ortho: on }),
  setImmersion: (on) => set({ immersion: on }),
  placeSection: (anchor) =>
    set((s) => ({
      section: { ...s.section, anchor: [anchor[0], anchor[1], anchor[2]], offset: 0 },
    })),
  setSectionOffset: (offset) => set((s) => ({ section: { ...s.section, offset } })),
  rotateSection: (delta, tilt = false) =>
    set((s) => {
      const o = s.section.orientation
      const next = tilt
        ? { ...o, elevation: Math.max(-90, Math.min(90, o.elevation + delta)) }
        : { ...o, azimuth: ((o.azimuth + delta + 540) % 360) - 180 }
      return { section: { ...s.section, orientation: next } }
    }),
  setSectionOrientation: (azimuth, elevation) =>
    set((s) => ({
      section: {
        ...s.section,
        orientation: {
          azimuth: ((azimuth + 540) % 360) - 180,
          elevation: Math.max(-90, Math.min(90, elevation)),
        },
      },
    })),
})
