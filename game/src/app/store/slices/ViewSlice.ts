// The view slice: which storey is edited and how the others draw around it
// (level slicing in `render/levelSlicing.ts`), plus the camera and overlay
// toggles, 隐藏UI and the 剖切 surface.

import type { StateCreator } from 'zustand'
import { nearestLevel } from '../../../build/model.ts'
import { levelSteps } from '../../../sim/constants.ts'
import { DEFAULT_SECTION_AZIMUTH, nextAzimuth } from '../../../render/section.ts'
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
  /**
   * 隐藏剖切面: keep cutting, but take the section's own drawing away — the
   * translucent sheet, its border and grid, the grab handle and the direction
   * arrow. On by default, so the surface can be seen and grabbed; off gives the
   * cut the player asked for with none of the diagram over it.
   */
  hideSectionSurface: boolean
  /** 隐藏墙壁: draw every wall and platform screen door translucent. */
  hideWalls: boolean
  /**
   * 隐藏地面: take the street plane off the picture.
   *
   * It is the generated window (`sim/ground.ts`), which is the one surface the
   * document does not own and the one thing standing between a top-down camera
   * and an underground station. It is deliberately **not** 隐藏天花板's business:
   * that rule is about the ceilings a storey *holds*, and the street is nobody's
   * ceiling — it is one plane the whole station stands under, so it gets a
   * toggle of its own. Absolute like 隐藏墙壁 (it hides in every mode), and free
   * to press: the street is meshed as its own pass (`ChunkSystem.meshStation`),
   * so the toggle only writes a `visible` flag (`LevelSystem.applyLevel`).
   */
  hideGround: boolean
  hideRoof: boolean
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
   * The floating **时刻** window (§9.6C): the day's stats and time settings, opened by the
   * 信息栏's clock card. It is a view over the document rather than a build tool, so its
   * open state lives here with the other overlays.
   */
  timePanel: boolean
  /**
   * The 剖切 surface: where it was anchored, which quarter turn it looks in and
   * how far it has slid (`render/section.ts`). The 旋转 tile and the 3D drag are
   * two writes into this one record, so the plane, the highlighted surface and
   * the pointer can never disagree about where the cut is.
   */
  section: Section

  setActiveZ: (z: number) => void
  stepLevel: (dir: number) => void
  setLevelBase: (base: number) => void
  setOverlay: (on: boolean) => void
  setGhostOther: (on: boolean) => void
  setAutoCeiling: (on: boolean) => void
  setCutaway: (on: boolean) => void
  setHideSectionSurface: (on: boolean) => void
  setHideWalls: (on: boolean) => void
  /** 隐藏地面: draw the street plane, or take it away. */
  setHideGround: (on: boolean) => void
  setHideRoof: (on: boolean) => void
  setHideUI: (on: boolean) => void
  setOrtho: (on: boolean) => void
  /** Open or close the floating 时刻 window. */
  setTimePanel: (open: boolean) => void
  /** Re-place the cut at `anchor` on the storey being edited (a fresh 剖切). */
  placeSection: (anchor: Vec3) => void
  /** Slide the cut along its normal, in metres — what a drag writes. */
  setSectionOffset: (offset: number) => void
  /** 旋转: one quarter turn (90°), wrapping at 270°. */
  rotateSection: () => void
}

export const createViewSlice: StateCreator<AppState, [], [], ViewSlice> = (set, get) => ({
  activeZ: -8,
  ghostOtherLevels: true,
  autoCeiling: true,
  cutaway: false,
  hideSectionSurface: false,
  hideWalls: false,
  hideGround: false,
  hideRoof: false,
  hideUI: false,
  ortho: false,
  overlayOn: false,
  timePanel: false,
  section: { anchor: [0, 0, -8], orientation: { azimuth: DEFAULT_SECTION_AZIMUTH }, offset: 0 },

  setActiveZ: (z) => set({ activeZ: nearestLevel(z, get().station.levelBase) }),
  stepLevel: (dir) => {
    const levels = levelSteps(get().station.levelBase)
    const cur = nearestLevel(get().activeZ, get().station.levelBase)
    const idx = levels.indexOf(cur)
    const ni = Math.max(0, Math.min(levels.length - 1, idx + dir))
    set({ activeZ: levels[ni] })
  },
  setLevelBase: (base) => {
    const station = get().station
    const next = Math.max(0, Math.min(3, Math.round(base)))
    if (!Number.isFinite(next) || next === station.levelBase) return
    const activeZ = nearestLevel(get().activeZ - station.levelBase + next, next)
    get().commit({ ...station, levelBase: next })
    set({ activeZ })
  },
  setOverlay: (on) => set({ overlayOn: on }),
  setGhostOther: (on) => set({ ghostOtherLevels: on }),
  setAutoCeiling: (on) => set({ autoCeiling: on }),
  setCutaway: (on) => set({ cutaway: on }),
  setHideSectionSurface: (on) => set({ hideSectionSurface: on }),
  setHideWalls: (on) => set({ hideWalls: on }),
  setHideGround: (on) => set({ hideGround: on }),
  setHideRoof: (on) => set({ hideRoof: on }),
  setHideUI: (on) => set({ hideUI: on }),
  setOrtho: (on) => set({ ortho: on }),
  setTimePanel: (open) => set({ timePanel: open }),
  placeSection: (anchor) =>
    set((s) => ({
      section: { ...s.section, anchor: [anchor[0], anchor[1], anchor[2]], offset: 0 },
    })),
  setSectionOffset: (offset) => set((s) => ({ section: { ...s.section, offset } })),
  rotateSection: () => set((s) => ({ section: { ...s.section, orientation: { azimuth: nextAzimuth(s.section.orientation.azimuth) } } })),
})
