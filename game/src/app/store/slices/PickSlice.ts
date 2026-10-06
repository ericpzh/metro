// The 吸取 (picker) slice: what a pick changed, and the one way back out of it.
//
// A pick is not an edit — nothing in the document moves, so there is nothing for
// the undo stack to hold — but it does re-arm the rail under the player: the
// piece's own variant becomes the one being placed, its rotation / direction /
// 闸机 door come with it, a 指示牌's printed boards become the ones the next sign
// hangs with, and a room or a face finish hands the tool over. **Esc is the way
// out of the gesture** (§9.5), so the state the pick stood on is remembered here
// and put back in one go — the same "the thing you are in the middle of" the
// viewport's own Escape already ends for a drag and for 移动.

import type { StateCreator } from 'zustand'
import type { GateDoor, FinishId } from '../../../sim/types.ts'
import type { SignBoards } from '../../../sim/sign.ts'
import type { ZoneBrush } from '../catalog.ts'
import type { PaintMode } from './PaintSlice.ts'
import type { Tool } from './ToolSlice.ts'
import type { AppState } from '../Store.ts'

/**
 * Everything a 吸取 writes while it arms the placement: the tool and its piece,
 * the settings that travel with a piece (a turn, a direction, a door), the room
 * brush and the paint brush, and the current 指示牌 boards — which a picked sign
 * is copied into, so Esc has to be able to hand the old pair back.
 *
 * `wallSnapCycle` is here because the pick reaches the rail through `setTool`, which
 * zeroes the 方块 tool's wall-face cycle with every tool change: a player who had
 * stepped a 半墙 onto its side and then picked a bench would come back from Esc with
 * the cycle at 0 — the piece armed, its side silently reset.
 */
export interface PickDraft {
  tool: Tool
  moduleType: string
  moduleRot: number
  escalatorDir: 'up' | 'down'
  gateDoor: GateDoor
  zoneBrush: ZoneBrush
  paintMode: PaintMode
  paintFinish: FinishId
  wallSnapCycle: number
  boards: SignBoards
}

export interface PickSlice {
  /** What the 吸取 in flight is standing on, or null when nothing has been picked. */
  pickDraft: PickDraft | null
  /**
   * Note the state a pick is about to stand on. Called by the picker **before** it
   * writes anything, so the draft is the pre-pick rail and Esc is a plain restore.
   * A second pick replaces the first, because the thing to cancel is always the
   * one in hand.
   */
  beginPick: () => void
  /**
   * Esc: put the picked piece back — the tool, the piece, its settings and the
   * boards all as they were — and forget the pick. Returns false when there was
   * nothing picked, so the caller can fall through to whatever Escape means next.
   */
  cancelPick: () => boolean
}

export const createPickSlice: StateCreator<AppState, [], [], PickSlice> = (set, get) => ({
  pickDraft: null,

  beginPick: () =>
    set((s) => ({
      pickDraft: {
        tool: s.tool,
        moduleType: s.moduleType,
        moduleRot: s.moduleRot,
        escalatorDir: s.escalatorDir,
        gateDoor: s.gateDoor,
        zoneBrush: s.zoneBrush,
        paintMode: s.paintMode,
        paintFinish: s.paintFinish,
        wallSnapCycle: s.wallSnapCycle,
        boards: s.currentBoards,
      },
    })),

  cancelPick: () => {
    const d = get().pickDraft
    if (!d) return false
    set({
      pickDraft: null,
      moduleType: d.moduleType,
      moduleRot: d.moduleRot,
      escalatorDir: d.escalatorDir,
      gateDoor: d.gateDoor,
      zoneBrush: d.zoneBrush,
      paintMode: d.paintMode,
      paintFinish: d.paintFinish,
      currentBoards: d.boards,
    })
    // The tool through its own setter: it resets the wall-face cycle with the
    // switch, the way every other tool change does — so the cycle the pick stood on
    // is written back after it, not with the rest of the fields above.
    get().setTool(d.tool)
    set({ wallSnapCycle: d.wallSnapCycle })
    get().setNotice('已取消吸取')
    return true
  },
})
