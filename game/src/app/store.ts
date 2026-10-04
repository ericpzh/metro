// App state. The station document lives here; the sim lives in the worker and
// is driven by the messages in sim/protocol.ts. Panels only — no sim logic.

import { create } from 'zustand'
import type { FromWorker, GraphInfo } from '../sim/protocol.ts'
import type { Metrics } from '../sim/world.ts'
import { DEFAULT_ZONE, type FinishId, type Module, type StationData, type Zone } from '../sim/types.ts'
import { finishDef } from '../sim/finishes.ts'
import { referenceStation, REFERENCE_BOOT } from '../data/reference-station.ts'
import { cloneState, initialStation, nearestLevel, nextEscalatorDir, removeModule, toData, toState, type StationState } from '../build/model.ts'
import { LEVEL_STEPS } from '../sim/constants.ts'
import { defaultLine, dropDerivedEdges, makeTrack, placeTrack, placeTunnel, regenerateRailEdges, removeLineAndTracks, resizeTrack, setLinePower, stripTunnelShell, trackBlockReason, trackPieceForLine } from '../build/rail.ts'
import { trackOriginForCentre } from '../sim/track.ts'
import { nextGateDoor } from '../sim/gates.ts'
import { parse as parseSave, serialize as serializeSave } from '../persistence/save.ts'
import { STAIR_WIDTH_NARROW, nextStairWidth } from '../sim/stairs.ts'
import {
  makeSignBoards,
  settleSignBoards,
  signBoardsOf,
  type SignBoards,
} from '../sim/sign.ts'
import type { GateDoor, LineDef, LineDirection } from '../sim/types.ts'
import type { SceneStats } from '../render/scene.ts'

export type Tool = 'select' | 'block' | 'wall' | 'delete' | 'module' | 'paint' | 'zone' | 'rail' | 'tunnel'
export type PaintMode = 'single' | 'surface' | 'pick'
/** The 材质 folder's own setting: the two modes `N` 单块 / `M` 整面 pick between. */
export type PaintBaseMode = 'single' | 'surface'

export interface ModuleOption {
  id: string
  label: string
  type: string
  w: number
  h: number
}

export const MODULE_OPTIONS: ModuleOption[] = [
  { id: 'gate', label: '闸机', type: 'gate', w: 1, h: 1 },
  { id: 'fence', label: '围栏', type: 'fence', w: 1, h: 1 },
  { id: 'tvm', label: '售票机', type: 'tvm', w: 1, h: 1 },
  { id: 'vending', label: '自动贩卖机', type: 'vending', w: 1, h: 1 },
  { id: 'bench-steel-1', label: '不锈钢 1m', type: 'bench', w: 1, h: 1 },
  { id: 'bench-steel-2', label: '不锈钢 2m', type: 'bench', w: 2, h: 1 },
  { id: 'bench-seat-1', label: '靠背 1m', type: 'bench', w: 1, h: 1 },
  { id: 'bench-seat-2', label: '连排 2m', type: 'bench', w: 2, h: 1 },
  { id: 'shelf', label: '货架', type: 'shelf', w: 1, h: 1 },
  { id: 'desk', label: '办公桌', type: 'desk', w: 1, h: 1 },
  { id: 'cubicle', label: '厕所隔间', type: 'cubicle', w: 1, h: 1 },
  { id: 'sink', label: '洗手池', type: 'sink', w: 1, h: 1 },
  { id: 'billboard-wide', label: '横版 16:9', type: 'billboard', w: 1, h: 1 },
  { id: 'billboard-standard', label: '标准 2.25:1', type: 'billboard', w: 2, h: 1 },
  { id: 'billboard-large', label: '大横版 16:9', type: 'billboard', w: 2, h: 1 },
  { id: 'billboard-panorama', label: '长幅 3.75:1', type: 'billboard', w: 3, h: 1 },
  { id: 'billboard-portrait', label: '竖版 0.7:1', type: 'billboard', w: 1, h: 1 },
  { id: 'billboard-square', label: '方形 1:1', type: 'billboard', w: 1, h: 1 },
  { id: 'tv', label: '电视', type: 'tv', w: 1, h: 1 },
  { id: 'sign', label: '指示牌', type: 'sign', w: 1, h: 1 },
  { id: 'exit-covered-1', label: '有盖 单向', type: 'exit', w: 1, h: 1 },
  { id: 'exit', label: '有盖 双向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-covered-3', label: '有盖 三向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-1', label: '无盖 单向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-2', label: '无盖 双向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-3', label: '无盖 三向', type: 'exit', w: 1, h: 1 },
  { id: 'escalator', label: '扶梯', type: 'escalator', w: 1, h: 1 },
  { id: 'lift', label: '电梯', type: 'lift', w: 1, h: 1 },
  { id: 'stair-straight', label: '单跑楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-left90', label: '左转角楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-right90', label: '右转角楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-right180', label: '双跑楼梯', type: 'stair', w: 1, h: 1 },
]

/** True for any of the four fixed staircase shapes in the palette. */
export function isStairType(type: string): boolean {
  return type === 'stair' || type.startsWith('stair-')
}

/**
 * True for any of the four billboard formats (装饰). The palette stores the
 * option id (`billboard-wide`, …) while a placed module's `type` is the bare
 * `billboard`, so both the id and the type read as a billboard here.
 */
export function isBillboardType(type: string): boolean {
  return type === 'billboard' || type.startsWith('billboard-')
}

/**
 * True for any of the four bench variants (装饰 座椅). The palette stores the
 * option id (`bench-steel-1`, …) while a placed module's `type` is the bare
 * `bench`, so both the id and the type read as a bench here.
 */
export function isBenchType(type: string): boolean {
  return type === 'bench' || type.startsWith('bench-')
}

/**
 * Decoration (装饰) pieces: seating, goods shelving, office desks, restroom
 * fixtures and advertising. They are placeable equipment like any
 * other, but the build rail files them under their own folder instead of 设备,
 * and the wall-mounted 广告牌 must be fixed to a wall (see `wallMountMissing` in
 * `sim/placement.ts`).
 */
export function isDecorType(type: string): boolean {
  return (
    isBenchType(type) ||
    type === 'shelf' ||
    type === 'desk' ||
    type === 'cubicle' ||
    type === 'sink' ||
    type === 'sign' ||
    isBillboardType(type) ||
    type === 'tv'
  )
}

/** True for a 装饰 piece that may only be placed against a wall block (广告牌). */
export function isWallMountedType(type: string): boolean {
  return isBillboardType(type)
}

/** True for the fence piece, which drags out a run like the wall tool. */
export function isFenceType(type: string): boolean {
  return type === 'fence'
}

/**
 * True for any of the six exit variants (出入口). The palette stores the option
 * id (`exit-covered-1`, `exit-uncovered-3`, …) while a placed module's `type` is
 * the bare `exit`, so both the id and the type read as an exit here. The build
 * rail files them under one 出入口 sub-menu.
 */
export function isExitType(type: string): boolean {
  return type === 'exit' || type.startsWith('exit-')
}

/** True for the fixed escalator piece, whose Tab cycle is up/down instead. */
export function isEscalatorType(type: string): boolean {
  return type === 'escalator'
}

/**
 * True for the fare gate (闸机), whose Tab cycle picks the side its door — and so
 * its lane — is on (§4.5).
 */
export function isGateType(type: string): boolean {
  return type === 'gate'
}

/**
 * Equipment that is moulded at one angle and cannot be turned by the player.
 * Every piece in the current catalogue rotates, so this is empty; it is the one
 * place to list a future fixed-angle module (a wall-mounted sign, a one-way
 * gate body). The rail's 旋转 button and the R key both read `isRotatableType`,
 * so adding a type here removes the control for it automatically.
 */
const FIXED_ANGLE_TYPES: ReadonlySet<string> = new Set<string>([])

/** True when the player may turn this equipment before placing it (R / 旋转). */
export function isRotatableType(type: string): boolean {
  return !FIXED_ANGLE_TYPES.has(type)
}

/** Facility rooms built by dragging a rectangle in the zone tool. */
export type FacilityBrush = 'shop' | 'toilet' | 'office' | 'booth'
export type ZoneBrush = Zone | FacilityBrush

export const FACILITY_OPTIONS: Array<{ id: FacilityBrush; label: string; colour: number }> = [
  { id: 'shop', label: '商店', colour: 0xb07cc6 },
  { id: 'toilet', label: '厕所', colour: 0x5fb7a6 },
  { id: 'office', label: '办公室', colour: 0xd9a24b },
  { id: 'booth', label: '售票亭', colour: 0x42a5c4 },
]

export function isFacilityBrush(b: ZoneBrush): b is FacilityBrush {
  return b === 'shop' || b === 'toilet' || b === 'office' || b === 'booth'
}

/** Friendly name for a module type, for the inspector and the bulldoze notice. */
const MODULE_LABELS: Record<string, string> = {
  gate: '闸机',
  fence: '围栏',
  tvm: '售票机',
  vending: '自动贩卖机',
  bench: '座椅',
  shelf: '货架',
  desk: '办公桌',
  cubicle: '厕所隔间',
  sink: '洗手池',
  billboard: '广告牌',
  tv: '电视',
  sign: '指示牌',
  exit: '出入口',
  escalator: '扶梯',
  stair: '楼梯',
  lift: '电梯',
  retail: '商铺',
  shop: '商店',
  booth: '售票亭',
  'platform-edge': '站台门',
  track: '轨道',
}

/** Friendly names for a walled room's fit-out, keyed by `shop.cfg.kind`. */
const ROOM_KIND_LABELS: Record<string, string> = {
  store: '商店',
  toilet: '厕所',
  office: '办公室',
}

export function moduleLabel(type: string, roomKind?: string): string {
  if (type === 'shop') return ROOM_KIND_LABELS[roomKind ?? 'store'] ?? MODULE_LABELS.shop
  return MODULE_LABELS[type] ?? MODULE_OPTIONS.find((m) => m.type === type)?.label ?? type
}

export interface AppState {
  station: StationState
  version: number
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
   * cell — so it is a plain counter, reset when the tool changes.
   */
  wallSnapCycle: number
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
  /** Active fare-zone brush, or a facility room (§5.7) built by rectangle. */
  zoneBrush: ZoneBrush
  zoneOverlayOn: boolean
  /** Rail tool: the line/direction a freshly laid bed binds to. Power is a
   *  line option (edited in the RHS 线路 panel), so it is not stored here. */
  railLineId: string
  railDir: LineDirection
  /** Quarter-turn applied to the rail piece being placed (R): 0..3. */
  railRot: number
  /** Tunnel tool: how far the auto-extended run reaches, in metres. */
  tunnelLength: number
  /** Transient toast line (save/load results). */
  notice: string | null
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
  playing: boolean
  speed: number
  metrics: Metrics | null
  stats: SceneStats | null
  graph: GraphInfo | null
  selected: { kind: 'cell' | 'module'; key: string; label: string } | null
  past: StationState[]
  future: StationState[]
  lab: boolean

  setTool: (t: Tool) => void
  /** Grow (or not) the 地基 patch's auto-wall ring on a drag. */
  setAutoWalls: (on: boolean) => void
  setModuleType: (t: string) => void
  /** Turn the placement ghost 90° clockwise (R). */
  rotateModule: () => void
  /**
   * Step the 墙 tool to its next snap candidate (**R**): which wall face the
   * column takes where a cell faces open space on more than one side.
   */
  rotateWallSnap: () => void
  /** Cycle the stair width one → two → three lanes (Tab). */
  cycleStairWidth: () => void
  /** Flip the escalator travel direction up ↔ down (Tab). */
  cycleEscalatorDir: () => void
  /** Toggle the 闸机 between a working lane and the doorless fence machine (Tab). */
  cycleGateDoor: () => void
  setPaintMode: (m: PaintMode) => void
  /** Hand the brush back after 取色 (`I`), in whichever of `N`/`M` it was entered with. */
  resumePaintMode: () => void
  /**
   * The 材质 tile's click: point the brush at a finish and switch to the paint
   * tool, keeping the folder's `N`/`M` setting — a texture is not a mode.
   */
  selectPaintFinish: (id: FinishId) => void
  setPaintFinish: (id: FinishId) => void
  /** Remember the 搪瓷板 picker's colour for the next enamel paint. */
  setEnamelColour: (colour: number) => void
  setZoneBrush: (z: ZoneBrush) => void
  setZoneOverlay: (on: boolean) => void
  setRailLine: (id: string) => void
  setRailDir: (dir: LineDirection) => void
  /** Turn the rail piece being placed 90° (R). */
  rotateRail: () => void
  /** Toggle the platform run's 上行/下行 (Tab): edits a selected platform, else the tool default. */
  cycleRailDir: () => void
  /** Place the fixed track piece for the bound line at a cell (dig + doors). */
  layTrack: (at: [number, number, number]) => void
  /** Set the tunnel run length in metres. */
  setTunnelLength: (metres: number) => void
  /** Extend an existing rail with a tunnel run (dig + track module, no doors). */
  layTunnel: (sourceId: string, at?: readonly [number, number, number]) => void
  /** Re-derive a rail's screen doors after the platform floor changed. */
  regenRail: (trackId: string) => void
  /** Re-derive the selected rail's doors, or every rail's when none is selected. */
  refreshRailDoors: () => void
  /** Remove a rail and the screen doors derived from it. */
  removeRail: (trackId: string) => void
  /** Edit a rail's line/direction and re-derive its screen doors. */
  updateRail: (trackId: string, patch: { line?: string; dir?: LineDirection }) => void
  /** Edit a line's shared parameters (stock, cars, headway, colour). */
  updateLine: (lineId: string, patch: Partial<LineDef>) => void
  /**
   * Rewrite one 指示牌's printed **boards** (§5.8). Both faces are replaced, so
   * every edit — a drag, a stamp, a delete — is one `commit` and therefore one
   * `Ctrl+Z`. Each face is settled on the way in (`settleSignBoards`), so the two
   * boards, the shared panel and their content can never disagree.
   */
  setSignBoards: (moduleId: string, boards: SignBoards) => void
  /**
   * **The current boards**: the 指示牌 the player is working on, and the one every
   * new sign is hung with.
   *
   * There is one current pair, and it is the whole of the signage model:
   *
   *  - the editor (the rail's 自定义 tile, or the boards a placed sign holds) edits
   *    **this** pair, and ✓ makes it current;
   *  - a sign placed afterwards carries **a copy of it**, so the player composes
   *    once and hangs as many as they like;
   *  - a sign already hanging is untouched by any of it: it keeps the boards it was
   *    placed with (`cfg.front` / `cfg.back`), which is what makes an old sign an
   *    old sign.
   *
   * Neither face is ever missing: a station with no signage yet starts from
   * `defaultSignLayout` on the front and an empty back, and `toState` backfills an
   * old save the same way.
   */
  currentBoards: SignBoards
  /** Which module the board editor is editing: null when it is the current boards alone. */
  signEditorFor: string | null
  /**
   * True while the editor is open on the **current boards** alone — no module
   * behind it (the rail's 自定义 tile).
   *
   * The editor is open on `signEditorFor` (a placed sign) or on this. The boards
   * themselves are deliberately *not* the flag: the current pair outlives the
   * modal, so an open test of "is a board set" would leave the editor up with no
   * way to close it.
   */
  signComposing: boolean
  /**
   * The boards the open editor is showing on a **placed** sign, before they are
   * kept.
   *
   * The editor is a modal over the station, so the sign it is editing has to show
   * the boards being arranged — but boards that are still being arranged are not an
   * edit: they must not land in the document (✕ would have nothing to put back) and
   * they must not land on the undo stack, once per keystroke. So the live pair
   * lives here and the model draws it in place of the module's own
   * (`signModuleWithPreview`); ✓ writes it to the module as one commit, and ✕ drops
   * it.
   */
  signPreview: { moduleId: string; boards: SignBoards } | null
  /** Open the board editor on the current boards (no module behind it). */
  openSignComposer: () => void
  /** Open the board editor on one placed sign, whose boards become the current ones. */
  openSignEditor: (moduleId: string) => void
  /**
   * Close the board editor: it is no longer open on a placed sign or on the current
   * boards. The boards themselves stay current for the next open and the next sign.
   */
  closeSignEditor: () => void
  /**
   * Show boards that have **not** been committed — the editor's live pair.
   *
   * The editor owns its own lists and writes them here as the player works: a
   * placed sign shows them in place of its own boards (`signPreview`), and
   * `currentBoards` follows so the next sign placed carries what is on screen. It
   * is not an edit: nothing lands in a module and nothing lands on the undo stack,
   * however much the player drags, until ✓ (`commitSignLayout`).
   */
  previewSignLayout: (boards: SignBoards) => void
  /** Make the arranged boards the current ones — and, on a placed sign, that sign's. */
  commitSignLayout: (boards: SignBoards) => void
  /** Throw the edit away, putting the current boards back as they were (the editor's ✕). */
  restoreSignLayout: (boards: SignBoards) => void
  /** Add a new line and make it the rail tool's target. */
  addLine: () => void
  /** Delete a line and every track bound to it (undoable). */
  removeLine: (lineId: string) => void
  setNotice: (n: string | null) => void
  saveToFile: () => void
  loadFromText: (text: string) => void
  setActiveZ: (z: number) => void
  stepLevel: (dir: number) => void
  setOverlay: (on: boolean) => void
  setGhostOther: (on: boolean) => void
  setAutoCeiling: (on: boolean) => void
  setCutaway: (on: boolean) => void
  setHideWalls: (on: boolean) => void
  setOrtho: (on: boolean) => void
  setPlaying: (on: boolean) => void
  setSpeed: (s: number) => void
  /** Clear every agent, train and queue, keeping the built station. */
  restartSim: () => void
  setMetrics: (m: Metrics) => void
  setStats: (s: SceneStats) => void
  setGraph: (g: GraphInfo) => void
  select: (sel: AppState['selected']) => void
  /** Rename the station (top-bar title). Blank names are ignored. */
  renameStation: (name: string) => void
  commit: (next: StationState) => void
  undo: () => void
  redo: () => void
  newStation: () => void
  loadReference: () => void
}

function sendControl(playing: boolean, speed: number): void {
  client?.postMessage({ type: 'control', playing, speed })
}

let client: Worker | null = null
let frameCb:
  | ((
      count: number,
      agents: Float32Array,
      density: Float32Array,
      trains: Float32Array,
      lifts: Float32Array,
      intervalMs: number,
      /** Sim seconds since midnight, for the in-world clocks (a 电视 plate). */
      simTime: number,
    ) => void)
  | null = null

/** Viewport registers here to receive the agent frame without re-rendering React. */
export function setFrameHandler(
  fn:
    | ((
        count: number,
        agents: Float32Array,
        density: Float32Array,
        trains: Float32Array,
        lifts: Float32Array,
        intervalMs: number,
        /** Sim seconds since midnight, for the in-world clocks (a 电视 plate). */
        simTime: number,
      ) => void)
    | null,
): void {
  frameCb = fn
}

/** Open the worker once and wire its messages. A station switch reuses it. */
function ensureClient(): Worker {
  if (client) return client
  client = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })
  client.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'ready') {
      useStore.getState().setGraph(msg)
      // Open on the deepest built level so the platform crowd is what you see.
      if (msg.levelsZ.length > 0) useStore.getState().setActiveZ(msg.levelsZ[0])
    } else if (msg.type === 'state') {
      useStore.getState().setMetrics(msg.metrics)
      frameCb?.(msg.count, msg.agents, msg.density, msg.trains, msg.lifts, msg.intervalMs, msg.metrics.simTime)
    }
  }
  return client
}

/** Boots the worker on the demo. Called once from boot.tsx. */
export function initSim(data: StationData, seed: number, opts: { startSeconds?: number; warmup?: number } = {}): void {
  ensureClient().postMessage({ type: 'init', data, seed, playing: true, speed: 1, ...opts })
}

export function rebuildSim(data: StationData): void {
  client?.postMessage({ type: 'build', data })
}

/**
 * Load a station into the running worker. `init` is a full reset — every agent,
 * train, queue and the clock start over — so a switch never leaves the old
 * crowd walking the new document. Live edits use `rebuildSim`, which keeps it.
 */
function loadSim(data: StationData, opts: { startSeconds?: number; warmup?: number } = {}): void {
  const st = useStore.getState()
  ensureClient().postMessage({ type: 'init', data, seed: data.seed, playing: st.playing, speed: st.speed, ...opts })
}

/**
 * Everything the equipment hover ghost is drawn from: the piece being placed,
 * its rotation, and every Tab cycle — the stair width, the escalator direction
 * and the 闸机's lane or fence. The viewport subscribes to this one key, so anything
 * that changes what the ghost looks like rebuilds it under the pointer at once
 * instead of waiting for the next pointer move; a new Tab cycle only has to join
 * this list, in one place, to be redrawn live.
 */
export function placementPreviewKey(
  s: Pick<AppState, 'moduleType' | 'moduleRot' | 'stairWidth' | 'escalatorDir' | 'gateDoor'>,
): string {
  return `${s.moduleType}|${s.moduleRot}|${s.stairWidth}|${s.escalatorDir}|${s.gateDoor}`
}

/**
 * One module as it should be **drawn**: a 指示牌 whose boards are open in the
 * editor shows the boards being arranged rather than the ones on disk, so the
 * player arranges them against the station the sign hangs in.
 *
 * The preview is read here, at the last moment, instead of being written into the
 * document: it is not an edit until ✓ says so, and boards that committed themselves
 * per keystroke would fill `Ctrl+Z` with frames of a half-arranged sign.
 */
export function signModuleWithPreview(mod: Module, preview: AppState['signPreview']): Module {
  if (!preview || mod.type !== 'sign' || mod.id !== preview.moduleId) return mod
  return { ...mod, cfg: { front: preview.boards.front, back: preview.boards.back } }
}

export const useStore = create<AppState>((set, get) => ({
  station: initialStation(),
  version: 0,
  tool: 'select',
  autoWalls: true,
  moduleType: 'gate',
  moduleRot: 0,
  wallSnapCycle: 0,
  stairWidth: STAIR_WIDTH_NARROW,
  escalatorDir: 'up',
  gateDoor: 'lane',
  paintMode: 'single',
  paintBaseMode: 'single',
  paintFinish: 'floor.granite',
  enamelColour: finishDef('wall.enamel').tint,
  zoneBrush: DEFAULT_ZONE,
  zoneOverlayOn: false,
  railLineId: '',
  railDir: 'up',
  railRot: 0,
  tunnelLength: 30,
  notice: null,
  activeZ: -8,
  ghostOtherLevels: true,
  autoCeiling: true,
  cutaway: false,
  hideWalls: false,
  ortho: false,
  overlayOn: false,
  playing: true,
  speed: 1,
  metrics: null,
  stats: null,
  graph: null,
  selected: null,
  past: [],
  future: [],
  lab: false,
  // The boards every new 指示牌 is hung with, and the ones the editor edits. The
  // front starts as the default board for the station the app opens on, so the first
  // sign placed is already readable; the back starts **empty**, which is the whole
  // point of a second face — it is black until the player puts something on it.
  currentBoards: makeSignBoards(undefined, initialStation()),
  signEditorFor: null,
  signComposing: false,
  signPreview: null,

  setTool: (t) => set({ tool: t, wallSnapCycle: 0 }),
  setAutoWalls: (on) => set({ autoWalls: on }),
  setModuleType: (t) => set({ moduleType: t }),
  // Clockwise on screen: the world turns +x toward −y in the isometric view.
  // A fixed-angle piece simply ignores the turn, so the guard lives here as well
  // as on the rail button.
  rotateModule: () =>
    set((s) => (isRotatableType(s.moduleType) ? { moduleRot: (s.moduleRot + 3) % 4 } : {})),
  rotateWallSnap: () => set((s) => ({ wallSnapCycle: s.wallSnapCycle + 1 })),
  cycleStairWidth: () => set((s) => ({ stairWidth: nextStairWidth(s.stairWidth) })),
  cycleEscalatorDir: () => set((s) => ({ escalatorDir: nextEscalatorDir(s.escalatorDir) })),
  cycleGateDoor: () => set((s) => ({ gateDoor: nextGateDoor(s.gateDoor) })),
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
  setZoneBrush: (z) => set({ zoneBrush: z }),
  setZoneOverlay: (on) => set({ zoneOverlayOn: on }),
  setRailLine: (id) => set({ railLineId: id }),
  setRailDir: (dir) => set({ railDir: dir }),
  rotateRail: () => set((s) => ({ railRot: (s.railRot + 3) % 4 })),
  cycleRailDir: () => {
    const st = get()
    const sel = st.selected
    const track = sel?.kind === 'module' ? st.station.modules.find((m) => m.id === sel.key) : undefined
    if (track && track.type === 'track' && !track.cfg.tunnel) {
      get().updateRail(track.id, { dir: (track.cfg.dir ?? 'up') === 'up' ? 'down' : 'up' })
      return
    }
    set({ railDir: st.railDir === 'up' ? 'down' : 'up' })
  },
  layTrack: (at) => {
    const st = get()
    let station = st.station
    let lineId = st.railLineId
    if (!station.lines.some((l) => l.id === lineId)) {
      // First rail on a fresh station: create the line it binds to, so placement
      // never stalls on an empty line list.
      if (station.lines.length === 0) {
        const line = defaultLine('1', st.railDir, 'third-rail')
        station = { ...station, lines: [line] }
        lineId = line.id
      } else {
        lineId = station.lines[0].id
      }
      set({ railLineId: lineId })
    }
    const line = station.lines.find((l) => l.id === lineId)
    if (!line) return
    // The piece is sized from the line's consist before it is placed: a
    // car-width bed and a run the length of the whole train. Power is a line
    // option, so the track inherits the bound line's power.
    const { w, d } = trackPieceForLine(line)
    const [ox, oy] = trackOriginForCentre(st.railRot, at[0], at[1], w, d)
    // Eligibility: nothing may share the space, a platform must lie on solid
    // floor (the bed is a full three cells wide) and may not cross a wall.
    const candidate = makeTrack({ id: 'probe', lineId, dir: st.railDir, power: line.power, rot: st.railRot, x: ox, y: oy, z: at[2], w, d })
    const block = trackBlockReason(station, candidate)
    if (block) {
      set({
        notice:
          block === 'interference'
            ? '这儿有设备、房间、站台或别的轨道挡着，放不下'
            : block === 'wall'
              ? '轨道中间有墙，站台放不下；这里可以用隧道穿过'
              : '站台轨道要铺在整片地面上（至少三格宽）',
      })
      return
    }
    const next = placeTrack(station, { lineId, dir: st.railDir, power: line.power, rot: st.railRot, x: ox, y: oy, z: at[2], w, d })
    if (next === station) {
      set({ notice: '这里已经有轨道了' })
      return
    }
    get().commit(next)
    const track = [...next.modules].reverse().find((m) => m.type === 'track')
    const derived = track ? next.modules.filter((m) => m.type === 'platform-edge' && m.cfg.from === track.id).length : 0
    set({ notice: derived > 0 ? `轨道已铺设（${w} m），自动生成 ${derived} 段站台门` : `轨道已铺设（${w} m）；旁边没有站台，站台门暂未生成` })
  },
  setTunnelLength: (metres) => set({ tunnelLength: Math.max(1, Math.min(400, Math.round(metres))) }),
  layTunnel: (sourceId, at) => {
    const st = get()
    const next = placeTunnel(st.station, sourceId, st.tunnelLength, at)
    if (next === st.station) {
      set({ notice: '隧道接不上去：这里被设备、房间、站台或别的轨道挡住了' })
      return
    }
    get().commit(next)
    set({ notice: `隧道已接通（${st.tunnelLength} m）` })
  },
  regenRail: (trackId) => {
    const next = regenerateRailEdges(get().station, trackId)
    get().commit(next)
    set({ notice: '站台门已按当前站台重新生成' })
  },
  refreshRailDoors: () => {
    const st = get()
    const sel = st.selected
    if (sel?.kind === 'module' && st.station.modules.some((m) => m.id === sel.key && m.type === 'track')) {
      get().commit(regenerateRailEdges(st.station, sel.key))
      set({ notice: '已刷新所选轨道的站台门' })
      return
    }
    // Snapshot the ids first: regeneration grows `modules` as it goes.
    const ids = st.station.modules.filter((m) => m.type === 'track').map((m) => m.id)
    if (ids.length === 0) {
      set({ notice: '还没有轨道' })
      return
    }
    let next = st.station
    for (const id of ids) next = regenerateRailEdges(next, id)
    get().commit(next)
    set({ notice: `已按当前站台刷新 ${ids.length} 条轨道的站台门` })
  },
  removeRail: (trackId) => {
    const cleaned = dropDerivedEdges(get().station, trackId)
    // A tunnel takes the shell it raised with it; a platform has none.
    const without = stripTunnelShell(removeModule(cleaned, trackId), trackId)
    get().commit(without)
    set({ notice: '轨道已拆除' })
  },
  updateRail: (trackId, patch) => {
    const st = get()
    const modules = st.station.modules.map((m) =>
      m.id === trackId && m.type === 'track' ? { ...m, cfg: { ...m.cfg, ...patch } } : m,
    )
    const edited = { ...st.station, modules }
    get().commit(regenerateRailEdges(edited, trackId))
  },
  updateLine: (lineId, patch) => {
    const st = get()
    const prev = st.station.lines.find((l) => l.id === lineId)
    // Consist is 1–8 cars for every stock class; clamp so a bad save or a stale
    // caller cannot produce a zero-length train.
    let fixed = patch.cars !== undefined ? { ...patch, cars: Math.max(1, Math.min(8, Math.round(patch.cars))) } : patch
    // The load slider is per car, so a 编组 change keeps that per-car value and
    // scales the stored whole-train total with the new car count. A patch that
    // sets the total itself (the slider) is left alone.
    if (patch.cars !== undefined && patch.alightPerTrain === undefined && prev) {
      const cars = Math.max(1, Math.min(8, Math.round(patch.cars)))
      fixed = { ...fixed, alightPerTrain: Math.round((prev.alightPerTrain / prev.cars) * cars) }
    }
    const lines = st.station.lines.map((l) => (l.id === lineId ? { ...l, ...fixed } : l))
    let station = { ...st.station, lines }
    // Power is a line option, so carry it to every track bound to the line —
    // platform rails and tunnel runs both — and their models re-cut on rebuild.
    if (patch.power !== undefined) station = setLinePower(station, lineId, patch.power)
    // A 屏蔽门 全高/半高 switch reads off each derived edge's own `cfg.psd`, so
    // re-derive every rail on the line to move its screens with the line.
    if (patch.psd !== undefined) {
      const ids = station.modules.filter((m) => m.type === 'track' && m.cfg.line === lineId).map((m) => m.id)
      for (const id of ids) station = regenerateRailEdges(station, id)
    }
    // A platform rail is sized from its line's consist, so a stock/cars edit
    // re-cuts each of that line's platform tracks to the new run length (and
    // re-derives its screen doors). A tunnel is hand-sized, so it is left alone.
    if (patch.stock !== undefined || patch.cars !== undefined) {
      const line = lines.find((l) => l.id === lineId)
      if (line) {
        const { w } = trackPieceForLine(line)
        const ids = station.modules.filter((m) => m.type === 'track' && m.cfg.line === lineId && !m.cfg.tunnel).map((m) => m.id)
        for (const id of ids) {
          const track = station.modules.find((m) => m.id === id)
          if (track && track.type === 'track') station = resizeTrack(station, track, w)
        }
      }
    }
    get().commit(station)
  },
  addLine: () => {
    const st = get()
    const used = new Set(st.station.lines.map((l) => l.id))
    let n = st.station.lines.length + 1
    while (used.has(String(n))) n++
    const id = String(n)
    const line = defaultLine(id, st.railDir, 'third-rail')
    get().commit({ ...st.station, lines: [...st.station.lines, line] })
    set({ railLineId: id, notice: `已新建 ${line.name}，铺轨时自动绑定` })
  },
  removeLine: (lineId) => {
    const st = get()
    const line = st.station.lines.find((l) => l.id === lineId)
    if (!line) return
    // A line owns its rolling stock, so the pure edit drops every track bound to
    // it along with those tracks' derived screen doors and tunnel shell.
    const trackIds = st.station.modules.filter((m) => m.type === 'track' && m.cfg.line === lineId).map((m) => m.id)
    const station = removeLineAndTracks(st.station, lineId)
    const lines = station.lines
    // A line owns the rail tool's target and any selection of one of its tracks,
    // so repoint both at whatever line survives.
    const railLineId = st.railLineId === lineId ? (lines[0]?.id ?? '') : st.railLineId
    const selected = st.selected?.kind === 'module' && trackIds.includes(st.selected.key) ? null : st.selected
    get().commit(station)
    set({
      railLineId,
      selected,
      notice: `已删除线路 ${line.name}${trackIds.length > 0 ? `，连同 ${trackIds.length} 段轨道` : ''}`,
    })
  },
  setNotice: (n) => set({ notice: n }),
  setSignBoards: (moduleId, boards) => {
    const st = get()
    const mod = st.station.modules.find((m) => m.id === moduleId)
    if (!mod || mod.type !== 'sign') return
    const next = settleSignBoards(boards, st.station)
    const modules = st.station.modules.map((m) => (m.id === moduleId && m.type === 'sign' ? { ...m, cfg: { front: next.front, back: next.back } } : m))
    get().commit({ ...st.station, modules })
  },
  // There is one **current pair of boards**, and the editor edits it. A session on a
  // placed sign also carries that sign's id, so ✓ writes the boards back to it; a
  // session with no id is the rail's 自定义 tile, and ✓ simply makes the boards
  // current.
  openSignComposer: () => set({ signEditorFor: null, signComposing: true, signPreview: null }),
  openSignEditor: (moduleId) => {
    const mod = get().station.modules.find((m) => m.id === moduleId)
    if (!mod || mod.type !== 'sign') return
    // Editing a placed sign opens **its** boards as the current ones, so the editor,
    // the next sign placed and the sign on screen are all the same boards while it is
    // open. ✕ puts the current boards back (`restoreSignLayout`), and the module —
    // which was never touched — is exactly as it was.
    const boards = signBoardsOf(mod.cfg, get().station)
    set({
      signEditorFor: moduleId,
      signComposing: false,
      currentBoards: boards,
      signPreview: { moduleId, boards },
    })
  },
  /**
   * Close the board editor: it is no longer open on a placed sign or on the current
   * boards. The boards stay current — they are what the next sign will hang — and a
   * placed sign's ✕/✓ have already dealt with the module through
   * `commitSignLayout`/`restoreSignLayout`.
   */
  closeSignEditor: () => set({ signEditorFor: null, signComposing: false, signPreview: null }),
  previewSignLayout: (boards) => {
    const st = get()
    const next = settleSignBoards(boards, st.station)
    // The live boards: current for the next sign, and drawn on the sign being edited
    // (the module itself is not written until ✓, so ✕ has something to put back and
    // the undo stack does not collect a frame per dragged bin).
    const patch: Partial<AppState> = { currentBoards: next, version: st.version + 1 }
    if (st.signEditorFor !== null) patch.signPreview = { moduleId: st.signEditorFor, boards: next }
    set(patch)
  },
  commitSignLayout: (boards) => {
    const st = get()
    const next = settleSignBoards(boards, st.station)
    // ✓ is what makes boards the current ones: they are what the next sign will hang.
    set({ currentBoards: next, signPreview: null })
    if (st.signEditorFor === null) return
    // And on a placed sign they are also that sign's boards — one commit, so one undo.
    const mod = st.station.modules.find((m) => m.id === st.signEditorFor)
    if (!mod || mod.type !== 'sign') return
    get().setSignBoards(st.signEditorFor, next)
  },
  restoreSignLayout: (boards) => {
    const st = get()
    const next = settleSignBoards(boards, st.station)
    // ✕ puts the current boards back to what the editor opened on, and drops the
    // preview that stood in for them. Nothing is undone, because nothing was done: a
    // placed sign was never written to.
    set({ currentBoards: next, signPreview: null, version: st.version + 1 })
  },
  saveToFile: () => {
    const s = get().station
    const text = serializeSave(s)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.name || 'station'}.metro.json`
    a.click()
    URL.revokeObjectURL(url)
    set({ notice: '已保存' })
  },
  loadFromText: (text) => {
    const r = parseSave(text)
    if (!r.ok) {
      set({ notice: r.error })
      return
    }
    const s = r.state
    set({ station: s, past: [...get().past, cloneState(get().station)].slice(-40), future: [], version: get().version + 1, selected: null })
    loadSim(toData(s))
    set({ notice: `已打开（存档 v${r.version}）` })
  },
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
  setPlaying: (on) => {
    sendControl(on, get().speed)
    set({ playing: on })
  },
  setSpeed: (s) => {
    sendControl(get().playing, s)
    set({ speed: s })
  },
  restartSim: () => {
    client?.postMessage({ type: 'restart' })
    set({ notice: '已清空所有行人' })
  },
  setMetrics: (m) => set({ metrics: m }),
  setStats: (s) => set({ stats: s }),
  setGraph: (g) => set({ graph: g }),
  select: (sel) => set({ selected: sel }),

  renameStation: (name) => {
    const s = get().station
    const trimmed = name.trim()
    if (!trimmed || trimmed === s.name) return
    get().commit({ ...s, name: trimmed })
  },

  commit: (next) => {
    const cur = get().station
    set({ station: next, version: get().version + 1, past: [...get().past, cloneState(cur)].slice(-40), future: [] })
    rebuildSim(toData(next))
  },
  undo: () => {
    const { past, station, future } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    set({ station: prev, past: past.slice(0, -1), future: [...future, cloneState(station)], version: get().version + 1 })
    rebuildSim(toData(prev))
  },
  redo: () => {
    const { future, station, past } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    set({ station: next, future: future.slice(0, -1), past: [...past, cloneState(station)], version: get().version + 1 })
    rebuildSim(toData(next))
  },
  newStation: () => {
    const s = toState({ name: '未命名车站', seed: 7654321, cells: [], modules: [], lines: [] })
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: 0, selected: null })
    loadSim(toData(s))
  },
  loadReference: () => {
    const s = toState(referenceStation())
    set({ station: s, past: [...get().past, cloneState(get().station)], future: [], version: get().version + 1, activeZ: -8, selected: null })
    loadSim(toData(s), REFERENCE_BOOT)
  },
}))
