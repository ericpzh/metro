// The pointer-tool slice: the active tool, the equipment tool's piece and its
// rotation, the 地基 tool's wall modes, the Tab cycles (stair width, escalator
// direction, 闸机 door) and the zone tool's brush (§4.5, §5.7).

import type { StateCreator } from 'zustand'
import { nextEscalatorDir } from '../../../build/model.ts'
import { nextGateDoor } from '../../../sim/gates.ts'
import { DEFAULT_ZONE, type GateDoor } from '../../../sim/types.ts'
import { STAIR_WIDTH_NARROW, nextStairWidth } from '../../../sim/stairs.ts'
import { isRotatableType, type ZoneBrush } from '../catalog.ts'
import type { AppState } from '../Store.ts'

export type Tool = 'select' | 'block' | 'wall' | 'delete' | 'module' | 'paint' | 'zone' | 'rail' | 'tunnel'

export interface ToolSlice {
  tool: Tool
  /** The 地基 tool: a dragged floor patch raises its 4 m auto-wall ring. */
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
   * click at a time and switches 自动生成墙壁 off (refused while it is on); off, it
   * hands the patch back its generated wall ring. The wall-face cycle is reset with
   * it, since the cycle means something different in each mode.
   */
  setHalfWall: (on: boolean) => void
  /** Flip the 半墙 mode — the rail's tile. */
  toggleHalfWall: () => void
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
  autoWalls: true,
  moduleType: 'gate',
  moduleRot: 0,
  wallSnapCycle: 0,
  halfWall: false,
  stairWidth: STAIR_WIDTH_NARROW,
  escalatorDir: 'up',
  gateDoor: 'lane',
  zoneBrush: DEFAULT_ZONE,
  zoneOverlayOn: false,

  setTool: (t) => set({ tool: t, wallSnapCycle: 0 }),
  // The two wall modes of the 地基 tool are exclusive: a 半墙 is the wall the patch
  // grows instead of the generated ring, so turning either on turns the other off.
  setAutoWalls: (on) => set((s) => (s.halfWall ? {} : { autoWalls: on })),
  setModuleType: (t) => set({ moduleType: t }),
  // Clockwise on screen: the world turns +x toward −y in the isometric view.
  // A fixed-angle piece simply ignores the turn, so the guard lives here as well
  // as on the rail button.
  rotateModule: () =>
    set((s) => (isRotatableType(s.moduleType) ? { moduleRot: (s.moduleRot + 3) % 4 } : {})),
  rotateWallSnap: () => set((s) => ({ wallSnapCycle: s.wallSnapCycle + 1 })),
  setHalfWall: (on) => set({ halfWall: on, autoWalls: !on, wallSnapCycle: 0 }),
  toggleHalfWall: () => get().setHalfWall(!get().halfWall),
  cycleStairWidth: () => set((s) => ({ stairWidth: nextStairWidth(s.stairWidth) })),
  cycleEscalatorDir: () => set((s) => ({ escalatorDir: nextEscalatorDir(s.escalatorDir) })),
  cycleGateDoor: () => set((s) => ({ gateDoor: nextGateDoor(s.gateDoor) })),
  setZoneBrush: (z) => set({ zoneBrush: z }),
  setZoneOverlay: (on) => set({ zoneOverlayOn: on }),
})
