// The pointer-tool slice: the active tool, the equipment tool's piece and its
// rotation, the 方块 tool's cut modes and 生成墙壁 ring, the Tab cycles (stair and roof width,
// escalator direction, 闸机 door) and the zone tool's brush (§4.5, §5.7).

import type { StateCreator } from 'zustand'
import { nextEscalatorDir } from '../../../build/model.ts'
import { nextGateDoor } from '../../../sim/gates.ts'
import type { BridgeRailing, GateDoor, TriangleKind } from '../../../sim/types.ts'
import { STAIR_WIDTH_NARROW, nextStairWidth } from '../../../sim/stairs.ts'
import { nextTrackRunLength, supportedTrackRunLength } from '../../../sim/track.ts'
import { nextRoofWidth, supportedRoofWidth } from '../../../sim/structures.ts'
import { DEFAULT_ZONE_BRUSH, isBenchType, isRotatableType, type CutMode, type ZoneBrush } from '../catalog.ts'
import type { AppState } from '../Store.ts'

export type Tool = 'select' | 'pick' | 'move' | 'block' | 'wall' | 'delete' | 'module' | 'paint' | 'zone' | 'rail' | 'tunnel'

export interface ToolSlice {
  tool: Tool
  /** Tool active immediately before the current one; used by toggle shortcuts. */
  previousTool: Tool
  /**
   * The 方块 tool: a dragged floor patch raises its 4 m auto-wall ring. **Off when
   * the game opens.** The ring is the one thing the tool does that the player did
   * not draw — it stands a wall around a surface they only laid the floor of — so
   * the tool does not assume it: a fresh station grows bare floor, and the ring is
   * asked for on its own tile or with **Tab**, which is that tile's key. A cut mode
   * (半墙 / 三角) refuses the toggle, tile and key alike: the piece *is* the wall the
   * patch would otherwise grow.
   */
  autoWalls: boolean
  moduleType: string
  /** Quarter-turn applied to the equipment being placed: 0..3. */
  moduleRot: number
  guideExitId: string | null
  setGuideExitId: (id: string | null) => void
  lightPosition: number
  setLightPosition: (position: number) => void
  cycleLightPosition: () => void
  /**
   * The 墙 tool's picked wall face at a corner, as a step through the snap
   * candidates **R** offers (`build/model.ts` `wallSnap`). It only encodes the
   * player's choice — the candidate list itself is recomputed from the hovered
   * cell — so it is a plain counter, reset when the tool changes. In the 方块 tool's
   * **半墙** mode the same counter steps the panel's thickness side, past the
   * geometry's own faces to the ones only the player can pick (`halfWallSideDirs`).
   */
  wallSnapCycle: number
  /**
   * The 方块 tool's third mode, on its own tile (click-only, no shortcut): instead of blocks it lays a single
   * **半墙** block — a half-block-thick wall course, the wall a facility room's own walls
   * and the panel beside a wide run are already made of — where the click lands,
   * one per click. It stands in for the wall a patch would otherwise grow, so
   * turning it on turns 生成墙壁 off and that toggle is refused while it is on;
   * and it is one at a time because a *run* of walls is the 墙 tool's job. Which
   * half of each tile the panel keeps is **R**'s business, and the piece itself is
   * `addWalls`'s `side` (`build/model.ts`).
   */
  halfWall: boolean
  /**
   * The 方块 tool's 三角 mode: instead of a whole block it lays a single **三角** — the
   * cell cut on a 45° plane in *elevation*, so the piece is a wedge with one flat 1 m
   * square in the X-Y plane, one full-height square, the slope across the cell and two
   * triangular ends. Two shapes, both cut from a cell: `upper` (三角上) puts that flat
   * square on the floor and `lower` (三角下) hangs it from the ceiling, and **R** picks
   * which of the four sides of the cell the full-height face stands on. Each of the
   * three cut pieces has its **own tile** (半墙 / 上三角块 / 下三角块), armed through the one
   * `setCutMode` call, because they are three answers to one question — what shape does
   * this click lay? — and Tab is the 生成墙壁 ring's key now, not a cut cycle.
   */
  triangles: boolean
  triKind: TriangleKind
  /**
   * The stair's size, cycled with Tab and named **窄 / 中 / 宽** on the action tile
   * (`sim/stairs.ts`). The first two are one and two **lanes**, each exactly the
   * escalator's step band, so a straight flight is laid as that many tile-sized
   * pieces and every lane stands flush against an escalator or another stair; the
   * 宽 size lays 2.5 m of treads a side, which is what a 双跑楼梯's flush pair needs
   * to claim exactly six blocks across.
   */
  stairWidth: number
  /** Width of a newly placed swing door, cycled 窄/宽 like the stair width. */
  doorWide: boolean
  stairBlockHeight: 0.5 | 1
  /** New pillar section length, toggled between 2 m and 4 m with Tab. */
  pillarLength: 2 | 4
  /** Width across a truss roof, cycled 窄 4 m → 中 8 m → 宽 12 m with Tab. */
  roofWidth: number
  /** Escalator travel direction, cycled with Tab (up/down). */
  escalatorDir: 'up' | 'down'
  /** Whether a newly placed escalator spans two blocks. */
  escalatorWide: boolean
  /** Whether a newly placed escalator rises 8 m (长) instead of 4 m (短). */
  escalatorLong: boolean
  /**
   * The 闸机 tool's piece (§4.5), toggled with Tab: `lane` (the default) is the
   * working turnstile — machine body on one half of the block, lane with its leaf
   * on the other — and `fence` is the doorless machine that carries a 围栏 run
   * through its own cell. Which hand the lane is on is not a setting: **R** turns
   * the piece. Carried into `cfg.door` on the piece placed.
   */
  bridgeLength: number
  bridgeRailing: BridgeRailing
  setStructureOptions: (patch: Partial<Pick<ToolSlice, 'bridgeLength' | 'bridgeRailing'>>) => void
  cycleBridgeLength: () => void
  liftStyle: 'glass' | 'steel'
  hangerLength: 4 | 6 | 8
  cycleHangerLength: () => void
  curtainWidth: 1 | 2 | 3 | 4
  cycleCurtainWidth: () => void
  psdEndHeight: 'half' | 'full'
  cyclePsdEndHeight: () => void
  gateDoor: GateDoor
  /** Active fare-zone brush, or a facility room (§5.7) built by rectangle. */
  zoneBrush: ZoneBrush
  zoneOverlayOn: boolean

  setTool: (t: Tool) => void
  /**
   * Grow (or not) the 方块 patch's auto-wall ring on a drag. Refused while a cut piece
   * owns the tool: the half wall or the 三角 is what the patch would grow into instead,
   * and the ring's tile is **not drawn at all** there for the same reason
   * (`rail/helpers.ts` `showsAutoWalls`).
   */
  setAutoWalls: (on: boolean) => void
  setModuleType: (t: string) => void
  /** Turn the placement ghost 90° clockwise (R). */
  rotateModule: () => void
  /**
   * Step to the next wall orientation (**R**): in the 墙 tool, which of a corner
   * cell's faces the column takes; in the 方块 tool's **半墙** mode, which half of
   * the tile the panel keeps (`halfWallSideDirs`). One counter, because it is the
   * same question — the wall's orientation — and only one of the two tools is ever
   * asking it.
   */
  rotateWallSnap: () => void
  /**
   * Turn the 方块 tool's **半墙** mode on or off. On, it lays half-block walls one
   * click at a time and holds 生成墙壁 off (refused while it is on); off, the click
   * is a plain 方块 again with the ring wherever the player left it. The wall-face
   * cycle is reset with it, since the cycle means something different in each mode.
   *
   * `triangles` and its `kind` are the other half of that mode: `triangles` false
   * with `halfWall` false is a plain 方块, and the two cut modes are exclusive.
   */
  setHalfWall: (on: boolean) => void
  /** Flip the 半墙 mode — the rail's tile. */
  toggleHalfWall: () => void
  /**
   * Turn the 方块 tool's **三角** mode on (and 半墙 off), or off to leave the click a
   * plain 方块 again. `kind` picks which of the two cuts — 三角上 or 三角下 — it is.
   */
  setTriangles: (on: boolean, kind?: TriangleKind) => void
  /**
   * **Arm one cut piece, or none** — the one call the 工具 folder's cut tiles make, so
   * the three shapes arm through one path instead of a setter each and the tile can be
   * drawn straight from `CUT_MODES` (`app/store/catalog.ts`). `null` is a plain 方块
   * again. Arming a cut holds the generated ring off, as it always did: a 半墙 or a
   * 三角 *is* the wall a patch would otherwise grow.
   */
  setCutMode: (cut: CutMode | null) => void
  /** Flip the 三角 mode on/off without changing its shape — **R**'s neighbour. */
  toggleTriangles: () => void
  /** Pick 三角上 or 三角下 while 三角 mode is on. */
  setTriKind: (kind: TriangleKind) => void
  /** Cycle the stair width one → two → three lanes (Tab). */
  cycleStairWidth: () => void
  toggleDoorWidth: () => void
  setDoorWidth: (wide: boolean) => void
  cycleBenchWidth: () => void
  setStairBlockHeight: (height: 0.5 | 1) => void
  togglePillarLength: () => void
  cycleRoofWidth: () => void
  setRoofWidth: (width: number) => void
  /** Flip the escalator travel direction up ↔ down (Tab). */
  cycleEscalatorDir: () => void
  /** Toggle a narrow or two-block-wide escalator from its rail tile. */
  toggleEscalatorWidth: () => void
  toggleEscalatorLength: () => void
  /** Toggle the 闸机 between a working lane and the doorless fence machine (Tab). */
  cycleLiftStyle: () => void
  setLiftStyle: (style: 'glass' | 'steel') => void
  cycleGateDoor: () => void
  setZoneBrush: (z: ZoneBrush) => void
  setZoneOverlay: (on: boolean) => void
  /**
   * Point the placement ghost at an absolute rotation (0..3). The rail's 旋转
   * button and R step it relatively (`rotateModule`); the 吸取 tool sets it
   * absolutely so the next piece lands the way the picked one stood.
   */
  setModuleRot: (rot: number) => void
  /** Point the 扶梯 direction at an absolute value (the 吸取 tool copies it). */
  setEscalatorDir: (dir: 'up' | 'down') => void
  /** Point the 闸机 door at an absolute value (the 吸取 tool copies it). */
  setGateDoor: (door: GateDoor) => void
}

export const createToolSlice: StateCreator<AppState, [], [], ToolSlice> = (set, get) => ({
  tool: 'select',
  previousTool: 'select',
  // Off when the game opens: a 方块 drag lays bare floor unless the player asks for
  // the ring on its own tile.
  autoWalls: false,
  moduleType: 'gate',
  moduleRot: 0,
  guideExitId: null,
  setGuideExitId: (id) => set({ guideExitId: id }),
  lightPosition: 0,
  setLightPosition: (position) => set({ lightPosition: ((position % 9) + 9) % 9 }),
  cycleLightPosition: () => set((s) => ({ lightPosition: (s.lightPosition + 1) % 9 })),
  wallSnapCycle: 0,
  halfWall: false,
  triangles: false,
  triKind: 'upper',
  stairWidth: STAIR_WIDTH_NARROW,
  doorWide: false,
  stairBlockHeight: 1,
  pillarLength: 4,
  roofWidth: 4,
  escalatorDir: 'up',
  escalatorWide: false,
  escalatorLong: false,
  bridgeLength: 32,
  bridgeRailing: 'railing',
  setStructureOptions: (patch) => set({
    ...(patch.bridgeLength === undefined ? {} : { bridgeLength: supportedTrackRunLength(patch.bridgeLength) }),
    ...(patch.bridgeRailing === undefined ? {} : { bridgeRailing: patch.bridgeRailing }),
  }),
  cycleBridgeLength: () => set((s) => ({ bridgeLength: nextTrackRunLength(s.bridgeLength) })),
  liftStyle: 'glass',
  hangerLength: 4,
  cycleHangerLength: () => set((s) => ({ hangerLength: s.hangerLength === 4 ? 6 : s.hangerLength === 6 ? 8 : 4 })),
  curtainWidth: 2,
  cycleCurtainWidth: () => set((s) => ({ curtainWidth: s.curtainWidth === 1 ? 2 : s.curtainWidth === 2 ? 3 : s.curtainWidth === 3 ? 4 : 1 })),
  psdEndHeight: 'half',
  cyclePsdEndHeight: () => set((s) => ({ psdEndHeight: s.psdEndHeight === 'half' ? 'full' : 'half' })),
  gateDoor: 'lane',
  zoneBrush: DEFAULT_ZONE_BRUSH,
  zoneOverlayOn: false,

  setTool: (t) => set((s) => ({
    tool: t,
    previousTool: t === s.tool ? s.previousTool : s.tool,
    wallSnapCycle: 0,
  })),
  // The cut modes of the 方块 tool are exclusive with the generated ring: a 半墙 or a
  // 三角 is what the patch grows instead of the ring, so either one refuses the
  // toggle while it owns the tool.
  setAutoWalls: (on) => set((s) => (s.halfWall || s.triangles ? {} : { autoWalls: on })),
  setModuleType: (t) => set({ moduleType: t }),
  // Clockwise on screen: the world turns +x toward −y in the isometric view.
  // A fixed-angle piece simply ignores the turn, so the guard lives here as well
  // as on the rail button.
  rotateModule: () =>
    set((s) => (isRotatableType(s.moduleType) ? { moduleRot: (s.moduleType.startsWith('pillar-slim') ? (s.moduleRot + 1) % 9 : s.moduleType === 'light-rectangular' ? (s.moduleRot + 1) % 2 : (s.moduleRot + 3) % 4) } : {})),
  rotateWallSnap: () => set((s) => ({ wallSnapCycle: s.wallSnapCycle + 1 })),
  setHalfWall: (on) => set({ halfWall: on, triangles: false, autoWalls: false, wallSnapCycle: 0 }),
  toggleHalfWall: () => get().setHalfWall(!get().halfWall),
  setTriangles: (on, kind) => set({ triangles: on, halfWall: false, autoWalls: false, wallSnapCycle: 0, ...(kind ? { triKind: kind } : {}) }),
  // One cut piece, one call. `halfWall` / `triangles` stay the fields the click reads
  // (and the ones the older setters above write); this is the rail's own way in, so
  // the 工具 folder's tiles carry no per-piece branching.
  setCutMode: (cut) =>
    set({
      halfWall: cut === 'half',
      triangles: cut === 'upper' || cut === 'lower',
      ...(cut === 'upper' || cut === 'lower' ? { triKind: cut } : {}),
      autoWalls: false,
      wallSnapCycle: 0,
    }),
  toggleTriangles: () => get().setTriangles(!get().triangles),
  setTriKind: (kind) => set({ triKind: kind }),
  cycleStairWidth: () => set((s) => s.moduleType === 'stair-block'
    ? { stairBlockHeight: s.stairBlockHeight === 1 ? 0.5 : 1 }
    : { stairWidth: nextStairWidth(s.stairWidth) }),
  toggleDoorWidth: () => set((s) => ({ doorWide: !s.doorWide })),
  setDoorWidth: (doorWide) => set({ doorWide }),
  setStairBlockHeight: (stairBlockHeight) => set({ stairBlockHeight }),
  togglePillarLength: () => set((s) => ({ pillarLength: s.pillarLength === 4 ? 2 : 4 })),
  cycleBenchWidth: () => set((s) => isBenchType(s.moduleType)
    ? { moduleType: s.moduleType === 'bench' ? 'bench-steel-2' : s.moduleType.replace(/-[12]$/, s.moduleType.endsWith('-2') ? '-1' : '-2') }
    : {}),
  cycleRoofWidth: () => set((s) => ({ roofWidth: nextRoofWidth(s.roofWidth) })),
  setRoofWidth: (width) => set({ roofWidth: supportedRoofWidth(width) }),
  cycleEscalatorDir: () => set((s) => ({ escalatorDir: nextEscalatorDir(s.escalatorDir) })),
  toggleEscalatorWidth: () => set((s) => ({ escalatorWide: !s.escalatorWide })),
  toggleEscalatorLength: () => set((s) => ({ escalatorLong: !s.escalatorLong })),
  cycleLiftStyle: () => set((s) => ({ liftStyle: s.liftStyle === 'glass' ? 'steel' : 'glass' })),
  setLiftStyle: (style) => set({ liftStyle: style }),
  cycleGateDoor: () => set((s) => ({ gateDoor: nextGateDoor(s.gateDoor) })),
  setZoneBrush: (z) => set({ zoneBrush: z }),
  setZoneOverlay: (on) => set({ zoneOverlayOn: on }),
  setModuleRot: (rot) => set((s) => {
    const count = s.moduleType.startsWith('pillar-slim') ? 9 : s.moduleType === 'light-rectangular' ? 2 : 4
    return { moduleRot: ((rot % count) + count) % count }
  }),
  setEscalatorDir: (dir) => set({ escalatorDir: dir }),
  setGateDoor: (door) => set({ gateDoor: door }),
})
