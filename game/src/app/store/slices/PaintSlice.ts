// The 材质 slice: the paint brush's mode and finish (§4.3). `N` 单块 / `M` 整面
// is the folder's own setting; the `pick` overlay survives from when 取色 (`I`)
// lived here — eyedropping moved to the 工具 folder's 吸取 (`P`), which lifts
// equipment as well as finishes, and `I` now aliases that tool.

import type { StateCreator } from 'zustand'
import { finishDef } from '../../../sim/finishes.ts'
import type { FinishId } from '../../../sim/types.ts'
import type { AppState } from '../Store.ts'

export type PaintMode = 'single' | 'surface' | 'pick'
/** The 材质 folder's own setting: the two modes `N` 单块 / `M` 整面 pick between. */
export type PaintBaseMode = 'single' | 'surface'

export interface PaintSlice {
  paintMode: PaintMode
  /**
   * The `N` 单块 / `M` 整面 half of `paintMode`, held separately because 取色
   * (`I`) is a momentary overlay on one of the two brushes rather than a third
   * one (§4.3). The mode is a setting of the 材质 folder, not of a tile or a
   * face: choosing a finish (or a fresh 搪瓷板 colour) and eyedropping a face
   * both hand the brush back in this mode instead of resetting it to 单块, so the
   * player's last choice survives a detour through another folder.
   */
  paintBaseMode: PaintBaseMode
  /** Active finish brush — the face's family decides which ones apply. */
  paintFinish: FinishId
  /**
   * The custom colour the 搪瓷板 wall finish paints with (§4.3). The brush's
   * finish id carries the colour (`customFinishId`), so each painted cell stores
   * its own colour; this is just the current picker setting.
   */
  enamelColour: number

  setPaintMode: (m: PaintMode) => void
  /** Hand the brush back after its own `pick` overlay, in whichever of `N`/`M` it was entered with. */
  resumePaintMode: () => void
  /**
   * The 材质 tile's click: point the brush at a finish and switch to the paint
   * tool, keeping the folder's `N`/`M` setting — a texture is not a mode.
   */
  selectPaintFinish: (id: FinishId) => void
  setPaintFinish: (id: FinishId) => void
  /** Remember the 搪瓷板 picker's colour for the next enamel paint. */
  setEnamelColour: (colour: number) => void
}

export const createPaintSlice: StateCreator<AppState, [], [], PaintSlice> = (set, get) => ({
  paintMode: 'single',
  paintBaseMode: 'single',
  paintFinish: 'floor.granite',
  enamelColour: finishDef('wall.enamel').tint,

  // 取色 is a mode the player leaves the moment they pick a face, so it never
  // becomes the brush's setting; only 单块 / 整面 replace what `resumePaintMode`
  // hands back.
  setPaintMode: (m) => set(m === 'pick' ? { paintMode: m } : { paintMode: m, paintBaseMode: m }),
  resumePaintMode: () => set((s) => ({ paintMode: s.paintBaseMode })),
  selectPaintFinish: (id) => {
    // The 材质 tile's whole click: pick the brush's finish and, in the same move,
    // put the brush back in the folder's `N`/`M` setting. A texture is not a mode.
    get().setTool('paint')
    set((s) => ({ paintFinish: id, paintMode: s.paintBaseMode }))
  },
  setPaintFinish: (id) => set({ paintFinish: id }),
  setEnamelColour: (colour) => set({ enamelColour: colour }),
})
