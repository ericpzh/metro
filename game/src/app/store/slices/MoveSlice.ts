// The 移动 slice: lifting a placed 设备 / 装饰 / 出入口 / 楼梯 / 扶梯 piece, aiming it and
// dropping it (§9.5). A lift is deliberately *not* a document edit — the piece stays in
// the station and only stops being drawn — so cancelling restores nothing and
// confirming is the one and only commit.

import type { StateCreator } from 'zustand'
import { moveEquipment } from '../../../build/model.ts'
import { isMovableModule, moveDropReason, movedModule } from '../../../sim/placement.ts'
import type { Module, Vec3i } from '../../../sim/types.ts'
import { isRotatableType, moduleLabel } from '../catalog.ts'
import type { AppState } from '../Store.ts'

/**
 * A placed 设备 / 装饰 / 出入口 / 楼梯 / 扶梯 piece the 信息 card's **移动** has picked up (§9.5).
 *
 * The piece is **not** removed from the document while it is in the air. It keeps
 * its id and its whole `cfg` — a 指示牌's printed boards, a 闸机's lane, a 广告牌's
 * frozen poster, a 楼梯's size and painted surface — and only stops being drawn, so
 * the translucent ghost under the pointer is the only copy on screen and putting the
 * piece back has nothing to restore. Confirming the drop is one `commit` (so one
 * `Ctrl+Z` undoes the move whole) — a **run** (a 楼梯 / 扶梯) through
 * `moveEquipment`, which is the tear-down and rebuild the piece owns cells for —
 * and cancelling is not an edit at all.
 */
export interface MoveDraft {
  /** The piece as it was placed. Its own cell and rotation are the way home. */
  module: Module
  /** The rotation it is carried at: **R** turns it in the air. */
  rot: number
  /** The cell the drop would use — the ghost's own cell — or null when there is no aim. */
  at: Vec3i | null
  /**
   * The exact piece the drop would place (`moveCandidate` in `sim/placement.ts`),
   * or null when there is no aim. This is what lands, verbatim: the ghost, the ✓
   * on the 信息 card and the commit all read this one module.
   */
  candidate: Module | null
  /** Why that cell refuses the piece — `''` when the drop is legal. */
  reason: string
}

export interface MoveSlice {
  /**
   * The 设备 / 装饰 / 出入口 piece lifted for 移动, if any (§9.5), whether from the 移动 tool
   * or the inspector card (`liftModule`). This is the whole state of the lift — the
   * piece, its carried rotation, where it is aimed, the exact module the drop would
   * place and whether that cell will take it. Everything that draws or applies the
   * move reads it here, so the ghost, the 信息 card and the commit cannot disagree.
   */
  moveDraft: MoveDraft | null

  /**
   * Lift a placed 设备 / 装饰 / 出入口 / 楼梯 / 扶梯 piece for 移动 (§9.5) — what the 移动 tool
   * and 信息 card's 移动 button do, and where the 确认 / 取消 that drop it live too. Not an
   * edit: nothing is committed and nothing leaves the document, the piece only stops
   * being drawn until it is put down. A run is rebuilt where it lands rather than
   * translated (`moveEquipment`); a 电梯, a room, track and platform doors are refused
   * with a toast pointing at 删除; an exit head-house can move with its footprint.
   */
  liftModule: (moduleId: string) => void
  /**
   * Aim the lifted piece: the cell under the pointer, the exact module it would
   * become there and why that cell refuses it (`''` when it does not). Called by
   * the viewport on every hover, so the card and the 确认 always describe the ghost on
   * screen. Passing a null cell parks nothing and disables the drop.
   */
  aimMove: (at: Vec3i | null, candidate: Module | null, reason: string) => void
  /** Turn the carried piece a quarter clockwise (**R**). */
  rotateMove: () => void
  /**
   * Put a lifted piece back where it came from. A lift was never an edit, so this
   * is not an undo — the piece has been standing there all along.
   */
  cancelMove: (announce?: boolean) => void
  /**
   * Drop the lifted piece where it is aimed — one `commit`, so one `Ctrl+Z` puts
   * it back. A refused cell (or one that would change nothing) leaves the piece in
   * the air and says why.
   */
  confirmMove: () => void
}

export const createMoveSlice: StateCreator<AppState, [], [], MoveSlice> = (set, get) => ({
  moveDraft: null,

  // 移动 (§9.5). A lift is deliberately *not* a document edit: the piece stays in
  // the station — same id, same cfg — and the renderer simply leaves it out while
  // it is in the air (`Viewport`, `moveId`). So 取消 has nothing to restore, and
  // 确认 is the one and only commit.
  liftModule: (moduleId) => {
    const st = get()
    const mod = st.station.modules.find((m) => m.id === moduleId)
    if (!mod) return
    const label = moduleLabel(mod.type, mod.type === 'shop' ? mod.cfg.kind : undefined)
    if (!isMovableModule(mod)) {
      set({ notice: `${label}不能移动：用删除 (B) 拆掉再放` })
      return
    }
    set({
      moveDraft: { module: mod, rot: mod.rot ?? 0, at: null, candidate: null, reason: '' },
      selected: { kind: 'module', key: mod.id, label },
      notice: `已拿起${label}：在要放的位置点击，或在信息栏点「确认」；点「取消」放回原位`,
    })
  },
  aimMove: (at, candidate, reason) => {
    const d = get().moveDraft
    if (!d) return
    const sameAt = d.at?.x === at?.x && d.at?.y === at?.y && d.at?.z === at?.z
    // Re-aiming at the same cell with the same piece and the same verdict changes
    // nothing the player can see, so the card is not re-rendered for it.
    if (sameAt && d.reason === reason && (d.candidate?.rot ?? 0) === (candidate?.rot ?? 0)) return
    set({ moveDraft: { ...d, at, candidate, reason } })
  },
  rotateMove: () => {
    const d = get().moveDraft
    if (!d || !isRotatableType(d.module.type)) return
    set({ moveDraft: { ...d, rot: (d.rot + 3) % 4 } })
  },
  cancelMove: (announce = true) => {
    if (!get().moveDraft) return
    set(announce ? { moveDraft: null, notice: '已放回原位' } : { moveDraft: null })
  },
  confirmMove: () => {
    const st = get()
    const d = st.moveDraft
    if (!d) return
    if (!d.at || !d.candidate) {
      set({ notice: d.reason || '先把指针移到要放的位置，再点「确认」' })
      return
    }
    // The piece must still be there: an undo, or a load, under a lift would
    // otherwise drop a copy of something that no longer exists.
    const from = st.station.modules.find((m) => m.id === d.module.id)
    if (!from) {
      set({ moveDraft: null, notice: '刚才拿起的东西已经不在了' })
      return
    }
    // What lands is the piece as the document holds it **now** — today's boards,
    // today's poster, today's lane — put at the cell and rotation the ghost showed.
    // Only the aim is the draft's; the state is never a lift-time snapshot, so an
    // edit (or an undo) taken while the piece was in the air survives the move.
    const to = movedModule(from, d.at, d.candidate.rot ?? 0)
    // Ask the drop rules again of that exact piece, so a station that changed under
    // the lift cannot commit a stale aim.
    const reason = moveDropReason(st.station.cells, st.station.modules, to)
    if (reason) {
      set({ notice: reason })
      return
    }
    if (to.x === from.x && to.y === from.y && to.z === from.z && (to.rot ?? 0) === (from.rot ?? 0)) {
      set({ moveDraft: null, notice: '位置没变' })
      return
    }
    const label = moduleLabel(from.type, from.type === 'shop' ? from.cfg.kind : undefined)
    set({ moveDraft: null })
    get().commit(moveEquipment(st.station, to))
    set({ notice: `${label}已移到 (${to.x}, ${to.y}, ${to.z})` })
  },
})
