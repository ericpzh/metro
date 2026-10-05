// The build-rail catalogue: every placeable piece option, type predicate and
// label the rail, the viewport ghost and the inspector share. Pure data and
// predicates — no store wiring — so slices and components import it directly
// instead of reaching into a slice.

import type { AppState } from './Store.ts'
import type { Zone } from '../../sim/types.ts'

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
  { id: 'bin', label: '垃圾桶', type: 'bin', w: 1, h: 1 },
  { id: 'extinguisher', label: '灭火器', type: 'extinguisher', w: 1, h: 1 },
  { id: 'clock', label: '时钟', type: 'clock', w: 1, h: 1 },
  { id: 'cctv', label: '监控', type: 'cctv', w: 1, h: 1 },
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
  { id: 'stair-left180', label: '左双跑楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-right180', label: '右双跑楼梯', type: 'stair', w: 1, h: 1 },
]

/** True for any of the five fixed staircase shapes in the palette. */
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
 * fixtures, the bin and the 灭火器箱, the ceiling-hung 时钟 and 监控, and
 * advertising. They are placeable
 * equipment like any
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
    type === 'bin' ||
    type === 'extinguisher' ||
    type === 'clock' ||
    type === 'cctv' ||
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

/**
 * Facility rooms built by dragging a rectangle in the zone tool. The ids name the
 * pieces the brushes build — a walled room of a fit-out, or the ticket booth —
 * exactly as `build/model.ts`'s `FacilityKind` spells them, so the brush the rail
 * hands the drag and the module the drag places cannot drift apart.
 */
export type FacilityBrush = 'store' | 'toilet' | 'office' | 'ticket'
export type ZoneBrush = Zone | FacilityBrush

/**
 * The 房间 folder's tiles. Each wears a **line icon of what the room is for**
 * (`LeftRail`'s `roomStore` / `roomTicket` / `roomOffice` / `roomRestroom`) rather
 * than a colour field: four rooms are told apart by their use, and a tint could
 * never say "tickets" or "washroom". The `colour` is what the drag preview and the
 * place ghost paint the footprint with, so it stays.
 */
export const FACILITY_OPTIONS: Array<{ id: FacilityBrush; label: string; colour: number; icon: string }> = [
  { id: 'store', label: '商店', colour: 0xb07cc6, icon: 'roomStore' },
  { id: 'toilet', label: '厕所', colour: 0x5fb7a6, icon: 'roomRestroom' },
  { id: 'office', label: '办公室', colour: 0xd9a24b, icon: 'roomOffice' },
  { id: 'ticket', label: '售票亭', colour: 0x42a5c4, icon: 'roomTicket' },
]

export function isFacilityBrush(b: ZoneBrush): b is FacilityBrush {
  return b === 'store' || b === 'toilet' || b === 'office' || b === 'ticket'
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
  bin: '垃圾桶',
  extinguisher: '灭火器',
  clock: '时钟',
  cctv: '监控',
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

/**
 * Everything a hover ghost is drawn from: the piece being placed, its rotation,
 * and every Tab cycle — the stair width, the escalator direction, the 闸机's lane
 * or fence, and the 地基 tool's **半墙** mode and wall-face cycle. The viewport
 * subscribes to this one key, so anything that changes what a ghost looks like
 * rebuilds it under the pointer at once instead of waiting for the next pointer
 * move; a new Tab cycle only has to join this list, in one place, to be redrawn
 * live. (It is what keeps a 半墙 honest too: R turns the panel to another half of
 * the tile without moving the pending cells at all, so nothing else would redraw
 * it.)
 */
export function placementPreviewKey(
  s: Pick<AppState, 'moduleType' | 'moduleRot' | 'stairWidth' | 'escalatorDir' | 'gateDoor' | 'halfWall' | 'wallSnapCycle'>,
): string {
  return `${s.moduleType}|${s.moduleRot}|${s.stairWidth}|${s.escalatorDir}|${s.gateDoor}|${s.halfWall}|${s.wallSnapCycle}`
}
