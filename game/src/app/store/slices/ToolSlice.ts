// The pointer-tool slice: the active tool, the equipment tool's piece and its
// rotation, the 地基 tool's wall modes, the Tab cycles (stair width, escalator
// direction, 闸机 door) and the zone tool's brush (§4.5, §5.7).

import type { StateCreator } from 'zustand'
import { nextEscalatorDir } from '../../../build/model.ts'
import { nextGateDoor } from '../../../sim/gates.ts'
import { DEFAULT_ZONE, type GateDoor, type TriangleKind } from '../../../sim/types.ts'
import { STAIR_WIDTH_NARROW, nextStairWidth } from '../../../sim/stairs.ts'
import { isRotatableType, type ZoneBrush } from '../catalog.ts'
import type { AppState } from '../Store.ts'

export type Tool = 'select' | 'block' | 'wall' | 'delete' | 'module' | 'paint' | 'zone' | 'rail' | 'tunnel'

export interface ToolSlice {
  tool: Tool
  /**
   * The 地基 tool: a dragged floor patch raises its 4 m auto-wall ring. **Off when
   * the game opens.** The ring is the one thing the tool does that the player did
   * not draw — it stands a wall around a surface they only laid the floor of — so
   * the tool no longer assumes it: a fresh station grows bare floor, and the ring is
   * asked for on its own tile. Its **Tab** shortcut is gone with the default; Tab
   * now steps the cut modes, which is the choice a 地基 click makes far more often.
   */
  autoWalls: boolean
  moduleType: string
  /** Quarter-turn applied to the equipment being placed: 0..3. */
  moduleRot: number
  /**
   * The 墙 tool's picked wall face at a corner, as a step through the snap
   * candidates **R** offers (`build/model.ts` `wallSnap`). It only encodes the
   * player's choice — the candidate list itself is recomputed from the hovered
   * cell — so it is a plain counter, reset when the tool changes. In the 地基 tool's
   * **半墙** mode the same counter steps the panel's thickness side, past the
   * geometry's own faces to the ones only the player can pick (`halfWallSideDirs`).
   */
  wallSnapCycle: number
  /**
   * The 地基 tool's third mode, on its own tile (click-only, no shortcut): instead of blocks it lays a single
   * **半墙** block — a half-block-thick wall course, the wall a facility room's own walls
   * and the panel beside a wide run are already made of — where the click lands,
   * one per click. It stands in for the wall a patch would otherwise grow, so
   * turning it on turns 自动生成墙壁 off and that toggle is refused while it is on;
   * and it is one at a time because a *run* of walls is the 墙 tool's job. Which
   * half of each tile the panel keeps is **R**'s business, and the piece itself is
   * `addWalls`'s `side` (`build/model.ts`).
   */
  halfWall: boolean
  /**
   * The 地基 tool's fourth and fifth modes, on the same tile as 半墙: instead of a
   * whole block it lays a single **三角** — the cell cut on a 45° plane in
   * *elevation*, so the piece is a wedge with one flat 1 m square in the X-Y plane,
   * one full-height square, the slope across the cell and two triangular ends. Two
   * shapes, both cut from a cell: `upper` (三角上) puts that flat square on the floor
   * and `lower` (三角下) hangs it from the ceiling, and **R** picks which of the four
   * sides of the cell the full-height face stands on. The tile cycles 半墙 → 三角上 →
   * 三角下 → off, so the three cut pieces share one button and one key (**R**),
   * because they are one question: what shape does this click lay?
   */
  triangles: boolean
  triKind: TriangleKind
  /**
   * Stair width, cycled with Tab: one, two or three **lanes**, each exactly the
   * escalator's step band, so a straight flight is laid as that many tile-sized
   * pieces and every lane stands flush against an escalator or another stair
   * (`sim/stairs.ts`).
   */
  stairWidth: number
  /** Escalator travel direction, cycled with Tab (up/down). */
  escalatorDir: 'up' | 'down'
  /**
   * The 闸机 tool's piece (§4.5), toggled with Tab: `lane` (the default) is the
   * working turnstile — machine body on one half of the block, lane with its leaf
   * on the other — and `fence` is the doorless machine that carries a 围栏 run
   * through its own cell. Which hand the lane is on is not a setting: **R** turns
   * the piece. Carried into `cfg.door` on the piece placed.
   */
  gateDoor: GateDoor
  /** Active fare-zone brush, or a facility room (§5.7) built by rectangle. */
  zoneBrush: ZoneBrush
  zoneOverlayOn: boolean

  setTool: (t: Tool) => void
  /**
   * Grow (or not) the 地基 patch's auto-wall ring on a drag. Refused while the
   * 半墙 mode owns the tool: the half wall is what the patch grows instead, and the
   * rail's tile is disabled there for the same reason.
   */
  setAutoWalls: (on: boolean) => void
  setModuleType: (t: string) => void
  /** Turn the placement ghost 90° clockwise (R). */
  rotateModule: () => void
  /**
   * Step to the next wall orientation (**R**): in the 墙 tool, which of a corner
   * cell's faces the column takes; in the 地基 tool's **半墙** mode, which half of
   * the tile the panel keeps (`halfWallSideDirs`). One counter, because it is the
   * same question — the wall's orientation — and only one of the two tools is ever
   * asking it.
   */
  rotateWallSnap: () => void
  /**
   * Turn the 地基 tool's **半墙** mode on or off. On, it lays half-block walls one
   * click at a time and holds 自动生成墙壁 off (refused while it is on); off, the click
   * is a plain 地基 again with the ring wherever the player left it. The wall-face
   * cycle is reset with it, since the cycle means something different in each mode.
   *
   * `triangles` and its `kind` are the other half of that mode: `triangles` false
   * with `halfWall` false is a plain 地基, and the two cut modes are exclusive.
   */
  setHalfWall: (on: boolean) => void
  /** Flip the 半墙 mode — the rail's tile. */
  toggleHalfWall: () => void
  /**
   * Turn the 地基 tool's **三角** mode on (and 半墙 off), or off to leave the click a
   * plain 地基 again. `kind` picks which of the two cuts — 三角上 or 三角下 — it is.
   */
  setTriangles: (on: boolean, kind?: TriangleKind) => void
  /** Flip the 三角 mode on/off without changing its shape — **R**'s neighbour. */
  toggleTriangles: () => void
  /** Pick 三角上 or 三角下 while 三角 mode is on. */
  setTriKind: (kind: TriangleKind) => void
  /**
   * Step the 地基 tool's cut modes from the rail tile and from **Tab**, which is the
   * key that used to toggle the auto-wall ring: 半墙 → 三角上 → 三角下 → off → 半墙.
   * One button for the three pieces, because they are one question — what shape does
   * a click lay — and the key went with them because that question is the one a 地基
   * click answers; the ring, which is off when the game opens, is asked for on its
   * own tile instead.
   */
  cycleCutMode: () => void
  /** Cycle the stair width one → two → three lanes (Tab). */
  cycleStairWidth: () => void
  /** Flip the escalator travel direction up ↔ down (Tab). */
  cycleEscalatorDir: () => void
  /** Toggle the 闸机 between a working lane and the doorless fence machine (Tab). */
  cycleGateDoor: () => void
  setZoneBrush: (z: ZoneBrush) => void
  setZoneOverlay: (on: boolean) => void
}

export const createToolSlice: StateCreator<AppState, [], [], ToolSlice> = (set, get) => ({
  tool: 'select',
  // Off when the game opens: a 地基 drag lays bare floor unless the player asks for
  // the ring on its own tile.
  autoWalls: false,
  moduleType: 'gate',
  moduleRot: 0,
  wallSnapCycle: 0,
  halfWall: false,
  triangles: false,
  triKind: 'upper',
  stairWidth: STAIR_WIDTH_NARROW,
  escalatorDir: 'up',
  gateDoor: 'lane',
  zoneBrush: DEFAULT_ZONE,
  zoneOverlayOn: false,

  setTool: (t) => set({ tool: t, wallSnapCycle: 0 }),
  // The cut modes of the 地基 tool are exclusive with the generated ring: a 半墙 or a
  // 三角 is what the patch grows instead of the ring, so either one refuses the
  // toggle while it owns the tool.
  setAutoWalls: (on) => set((s) => (s.halfWall || s.triangles ? {} : { autoWalls: on })),
  setModuleType: (t) => set({ moduleType: t }),
  // Clockwise on screen: the world turns +x toward −y in the isometric view.
  // A fixed-angle piece simply ignores the turn, so the guard lives here as well
  // as on the rail button.
  rotateModule: () =>
    set((s) => (isRotatableType(s.moduleType) ? { moduleRot: (s.moduleRot + 3) % 4 } : {})),
  rotateWallSnap: () => set((s) => ({ wallSnapCycle: s.wallSnapCycle + 1 })),
  setHalfWall: (on) => set({ halfWall: on, triangles: false, autoWalls: false, wallSnapCycle: 0 }),
  toggleHalfWall: () => get().setHalfWall(!get().halfWall),
  setTriangles: (on, kind) => set({ triangles: on, halfWall: false, autoWalls: false, wallSnapCycle: 0, ...(kind ? { triKind: kind } : {}) }),
  toggleTriangles: () => get().setTriangles(!get().triangles),
  setTriKind: (kind) => set({ triKind: kind }),
  // 半墙 → 三角上 → 三角下 → off, the cycle **Tab** steps. Every step leaves the ring
  // off — it is off by default, and the three cut modes are what a 地基 click lays
  // instead of it — so the toggle that raises it is the tile's own, never a side
  // effect of leaving the cycle.
  cycleCutMode: () =>
    set((s) => {
      if (!s.halfWall && !s.triangles) return { halfWall: true, triangles: false, autoWalls: false, wallSnapCycle: 0 }
      if (s.halfWall) return { halfWall: false, triangles: true, triKind: 'upper' as TriangleKind, autoWalls: false, wallSnapCycle: 0 }
      if (s.triKind === 'upper') return { triKind: 'lower' as TriangleKind, wallSnapCycle: 0 }
      return { halfWall: false, triangles: false, autoWalls: false, wallSnapCycle: 0 }
    }),
  cycleStairWidth: () => set((s) => ({ stairWidth: nextStairWidth(s.stairWidth) })),
  cycleEscalatorDir: () => set((s) => ({ escalatorDir: nextEscalatorDir(s.escalatorDir) })),
  cycleGateDoor: () => set((s) => ({ gateDoor: nextGateDoor(s.gateDoor) })),
  setZoneBrush: (z) => set({ zoneBrush: z }),
  setZoneOverlay: (on) => set({ zoneOverlayOn: on }),
})
