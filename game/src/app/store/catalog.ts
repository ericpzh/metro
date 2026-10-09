// The build-rail catalogue: every placeable piece option, type predicate and
// label the rail, the viewport ghost and the inspector share. Pure data and
// predicates — no store wiring — so slices and components import it directly
// instead of reaching into a slice.

import type { AppState } from './Store.ts'
import type { TriangleKind, Zone } from '../../sim/types.ts'
import { SIGN_MOUNTS, signMountSpec } from '../../sim/sign.ts'

export interface ModuleOption {
  id: string
  label: string
  type: string
  w: number
  h: number
}

/**
 * Every placeable piece's palette row: the id the tool arms, the tile's label and the
 * footprint the smallest piece of its family covers.
 *
 * The **order** here groups a family's variants together, which is what a sub-menu
 * (`familyOptions`) and the parent tile's icon (its first variant) read. The **grid**
 * order — where a family's parent tile sits among the plain tiles, and so what shares a
 * row with what — is `RAIL_ORDER` below, because a 2-column grid cannot read it out of
 * a list that also has to keep each family's variants adjacent.
 */
export const MODULE_OPTIONS: ModuleOption[] = [
  { id: 'pillar-slim', label: '细支柱', type: 'pillar', w: 1, h: 1 },
  { id: 'pillar-thick', label: '粗支柱', type: 'pillar', w: 1, h: 1 },
  { id: 'roof', label: '薄板', type: 'roof', w: 1, h: 1 },
  { id: 'roof-shell', label: '无桁架', type: 'roof', w: 4, h: 4 },
  { id: 'roof-truss', label: '桁架', type: 'roof', w: 4, h: 4 },
  { id: 'roof-tapered', label: '收束桁架', type: 'roof', w: 4, h: 4 },
  { id: 'bridge', label: '轨道桥', type: 'track', w: 12, h: 3 },
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
  { id: 'guidepost', label: '导向柱', type: 'guidepost', w: 1, h: 1 },
  { id: 'busstop-short', label: '短', type: 'busstop', w: 4, h: 2 },
  { id: 'busstop-long', label: '长', type: 'busstop', w: 8, h: 2 },
  { id: 'bin', label: '垃圾桶', type: 'bin', w: 1, h: 1 },
  { id: 'extinguisher', label: '灭火器', type: 'extinguisher', w: 1, h: 1 },
  { id: 'vent', label: '通风口', type: 'vent', w: 1, h: 1 },
  { id: 'light-circular', label: '圆形', type: 'light', w: 1, h: 1 },
  { id: 'light-rectangular', label: '直条', type: 'light', w: 1, h: 1 },
  { id: 'clock', label: '时钟', type: 'clock', w: 1, h: 1 },
  { id: 'cctv', label: '监控', type: 'cctv', w: 1, h: 1 },
  { id: 'billboard-wide', label: '横版 16:9', type: 'billboard', w: 1, h: 1 },
  { id: 'billboard-standard', label: '标准 2.25:1', type: 'billboard', w: 2, h: 1 },
  { id: 'billboard-large', label: '大横版 16:9', type: 'billboard', w: 2, h: 1 },
  { id: 'billboard-panorama', label: '长幅 3.75:1', type: 'billboard', w: 3, h: 1 },
  { id: 'billboard-portrait', label: '竖版 0.7:1', type: 'billboard', w: 1, h: 1 },
  { id: 'billboard-square', label: '方形 1:1', type: 'billboard', w: 1, h: 1 },
  { id: 'tv', label: '电视', type: 'tv', w: 1, h: 1 },
  // The 指示牌's two mounts (§5.8): the overhead board hung from the ceiling and read
  // from both sides, and the same board bolted flat to a wall. Two tiles, one piece —
  // the 线网图's wall/stand pair read the other way round (`sim/sign.ts`) — and the tiles
  // are **built from that table** (`SIGN_MOUNTS` / `signMountSpec`), so a mount's label
  // and its palette id cannot drift apart.
  ...SIGN_MOUNTS.map((mount) => ({ id: `sign-${mount}`, label: signMountSpec(mount).label, type: 'sign', w: 1, h: 1 })),
  // The wall-mounted 装饰 pieces (§5.7): glass panels in six sizes, the station-name
  // inscription in six hands × two axes, the network map as a wall board or a
  // free-standing totem, and the 指示牌 on its wall mount (its hanging sibling above is
  // the ceiling's). A run's length is the piece's own (`sim/glassPanels.ts`,
  // `sim/calligraphy.ts`, `sim/linemaps.ts`), so the cell counts here name the
  // smallest piece of each family.
  { id: 'glass-1x1', label: '玻璃板 1×1', type: 'glass', w: 1, h: 1 },
  { id: 'glass-2x1', label: '玻璃板 2×1', type: 'glass', w: 2, h: 1 },
  { id: 'glass-3x1', label: '玻璃板 3×1', type: 'glass', w: 3, h: 1 },
  { id: 'glass-1x2', label: '玻璃板 1×2', type: 'glass', w: 1, h: 1 },
  { id: 'glass-2x2', label: '玻璃板 2×2', type: 'glass', w: 2, h: 1 },
  { id: 'glass-3x2', label: '玻璃板 3×2', type: 'glass', w: 3, h: 1 },
  // The 门 (装饰 §5.7): the free-standing doorway — threshold, posts, head and the
  // leaves between them — in the four pieces 单开 / 双开 × 不锈钢 / 木 (`sim/doors.ts`).
  // A single door is one cell wide and a double one two — the run a 双开 wants is the
  // same choice as its leaf count — so the cell counts here are the piece's own.
  { id: 'door-steel-1', label: '门 单开 不锈钢', type: 'door', w: 1, h: 1 },
  { id: 'door-steel-2', label: '门 双开 不锈钢', type: 'door', w: 2, h: 1 },
  { id: 'door-wood-1', label: '门 单开 木', type: 'door', w: 1, h: 1 },
  { id: 'door-wood-2', label: '门 双开 木', type: 'door', w: 2, h: 1 },
  { id: 'calligraphy-kai-h', label: '楷书 横排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-kai-v', label: '楷书 竖排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-xing-h', label: '行书 横排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-xing-v', label: '行书 竖排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-li-h', label: '隶书 横排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-li-v', label: '隶书 竖排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-wei-h', label: '魏碑 横排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-wei-v', label: '魏碑 竖排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-hei-h', label: '黑体 横排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-hei-v', label: '黑体 竖排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-song-h', label: '宋体 横排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-song-v', label: '宋体 竖排', type: 'calligraphy', w: 1, h: 1 },
  { id: 'linemap-wall', label: '墙面线网图', type: 'linemap', w: 2, h: 1 },
  { id: 'linemap-stand', label: '立式线网图', type: 'linemap', w: 1, h: 1 },
  { id: 'exit-covered-1', label: '有盖 单向', type: 'exit', w: 1, h: 1 },
  { id: 'exit', label: '有盖 双向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-covered-3', label: '有盖 三向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-1', label: '无盖 单向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-2', label: '无盖 双向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-3', label: '无盖 三向', type: 'exit', w: 1, h: 1 },
  { id: 'exit-doorway-1', label: '地面 单向', type: 'exit', w: 3, h: 1 },
  { id: 'exit-doorway-2', label: '地面 双向', type: 'exit', w: 4, h: 1 },
  { id: 'exit-doorway-3', label: '地面 三向', type: 'exit', w: 5, h: 1 },
  { id: 'escalator', label: '扶梯', type: 'escalator', w: 1, h: 1 },
  { id: 'lift', label: '电梯', type: 'lift', w: 1, h: 1 },
  { id: 'stair-straight', label: '单跑楼梯', type: 'stair', w: 1, h: 1 },
  { id: 'stair-block', label: '楼梯块', type: 'stair', w: 1, h: 1 },
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
 * fixtures, the bin and the 灭火器箱, the ceiling-hung 时钟 and 监控, advertising,
 * and the wall pieces — glass panels, the 门 the office closes itself with, the
 * station-name inscription, the network map and the **wall** 指示牌 (with the hanging
 * board beside it). They are placeable
 * equipment like any
 * other, but the build rail files them under their own folder instead of 设备,
 * and the wall-mounted pieces must be fixed to a wall (see `wallMountMissing` in
 * `sim/placement.ts`).
 *
 * **Every id a piece is armed by has to answer here as its type does**: this is the
 * predicate the rail folds its folder open by (`LeftRail`) and the one the 装饰
 * right-click guard asks (`EquipmentTool`), and both hold a **palette id**, not a
 * module — so a family added as prefixed ids (`sign-ceiling`) has to be named by its
 * family predicate (`isSignType`), not by its bare type alone.
 */
export function isDecorType(type: string): boolean {
  return (
    isBenchType(type) ||
    type === 'shelf' ||
    type === 'desk' ||
    type === 'cubicle' ||
    type === 'sink' ||
    type === 'guidepost' || type === 'busstop' || type.startsWith('busstop-') ||
    type === 'bin' ||
    type === 'extinguisher' ||
    (type === 'light' || type.startsWith('light-')) ||
    type === 'vent' ||
    type === 'clock' ||
    type === 'cctv' ||
    isSignType(type) ||
    isBillboardType(type) ||
    isGlassType(type) ||
    isDoorType(type) ||
    isCalligraphyType(type) ||
    isLineMapType(type) ||
    type === 'tv'
  )
}

/**
 * True for any of the six 玻璃板 sizes (装饰). The palette id names the size
 * (`glass-2x1`) while a placed module's `type` is the bare `glass`, so both read as
 * a glass panel here — the same split `isBillboardType` makes.
 */
export function isGlassType(type: string): boolean {
  return type === 'glass' || type.startsWith('glass-')
}

/**
 * True for any of the four 门 variants (装饰). The palette id names the piece
 * (`door-steel-2`) while a placed module's `type` is the bare `door`, so both read
 * as a door here — the same split `isBillboardType` and `isGlassType` make.
 */
export function isDoorType(type: string): boolean {
  return type === 'door' || type.startsWith('door-')
}

/**
 * True for any of the twelve 站名 options (装饰): six hands (`kai` … `song`) on
 * two axes (`h` 横排 / `v` 竖排), spelled `calligraphy-<style>-<axis>` in the palette
 * and `calligraphy` on a placed module.
 */
export function isCalligraphyType(type: string): boolean {
  return type === 'calligraphy' || type.startsWith('calligraphy-')
}

/**
 * True for either 线网图 (装饰): the wall board and the free-standing totem. The
 * palette spells them `linemap-wall` / `linemap-stand` and a placed module is the
 * bare `linemap` with its `cfg.mount`, which is what tells the two apart.
 */
export function isLineMapType(type: string): boolean {
  return type === 'linemap' || type.startsWith('linemap-')
}

/**
 * True for either 指示牌 (装饰): the overhead board hung from the ceiling and the
 * board bolted flat to a wall. The palette spells them `sign-ceiling` / `sign-wall`
 * and a placed module is the bare `sign` with its `cfg.mount`, exactly as the
 * 线网图's two mounts read.
 */
export function isSignType(type: string): boolean {
  return type === 'sign' || type.startsWith('sign-')
}

/**
 * True for a 装饰 piece that may only be placed against a wall block: the 广告牌, the
 * 玻璃板, the 站名, the **wall** 线网图 — not the totem, which stands on the floor — and
 * the **wall** 指示牌, whose hanging sibling is fixed to the ceiling instead. The
 * palette ids are what the tool holds, so those two exceptions are named here;
 * `sim/placement.ts`'s `isWallMounted` makes the same call on a placed module, from
 * its `cfg.mount`.
 *
 * A **门 is not here**: it is a doorway of its own — threshold, posts and head — so it
 * stands on a floor tile like a 货架 and the tool resolves it from the ground.
 */
export function isWallMountedType(type: string): boolean {
  return isBillboardType(type) || isGlassType(type) || isCalligraphyType(type) || type === 'sign-wall' || (isLineMapType(type) && type !== 'linemap-stand')
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
const FIXED_ANGLE_TYPES: ReadonlySet<string> = new Set<string>(['light-circular'])

/** True when the player may turn this equipment before placing it (R / 旋转). */
export function isRotatableType(type: string): boolean {
  return !FIXED_ANGLE_TYPES.has(type)
}

/* ------------------------------------------------------- the variant families */

/**
 * The rail's **variant families**: one row per nested sub-menu — 楼梯, 出入口, 座椅,
 * 广告牌, 玻璃板, 门, 站名, 线网图, 指示牌 (its two mounts) — and the single table every
 * part of that UI reads.
 *
 * A family in this rail is four things that have to agree: the parent **tile** (its
 * label and the variant its icon shows), the **list** of variants it folds out, the
 * **sub-menu slot** the rail keeps open, and the **anchor** the contextual action row
 * (旋转 / 自定义 / …) folds out under. Those used to be written out once per family —
 * nine near-identical menu components, a hand-written parent tile in each folder, and
 * a third list mapping a piece to its anchor — so a family could be half-wired: a
 * variant that folds its own list away when picked, or a piece whose 旋转 tile folds
 * out under a tile that does not exist. This table is the one place that says what a
 * family is, and `familyAnchor` / `familyOptions` / `familyFor` / `subMenuForModule` /
 * `actionsAnchorFor` below are the only readers, so **a new family is one row here**
 * (`app/rail/shared/TileGrid.tsx` renders it and `app/rail/actions/ActionRow.tsx`
 * anchors to it with no further edits).
 *
 * Pure data and predicates — no React, no DOM — so `test/rail-families.test.mjs` can
 * prove the four halves agree for every family, in Node.
 */
export type ModuleFamilyKey = 'busstop' | 'light' | 'roof' | 'pillar' | 'stair' | 'exit' | 'bench' | 'billboard' | 'glass' | 'door' | 'calligraphy' | 'linemap' | 'sign'

/** Which folder a family's parent tile and its variants live in. */
/** `rail` is the internal key of the player-facing 结构 folder. */
export type ModuleFolder = 'rail' | 'equipment' | 'decor'

export interface ModuleFamily {
  key: ModuleFamilyKey
  /** The parent tile's label (`Block`'s `label`). */
  label: string
  /** The folder whose grid shows this family. */
  folder: ModuleFolder
  /**
   * True for every **palette id** of this family (the tile ids in `MODULE_OPTIONS`,
   * and the bare module type they build). Read from the id alone, so the grid, the
   * open slot, the piece's own tile and the action anchor cannot disagree.
   */
  owns: (id: string) => boolean
  /**
   * The label one variant's tile wears. Defaults to the palette label; a family whose
   * labels repeat the family name (玻璃板 1×1) drops it, the way 座椅's own labels do.
   */
  tileLabel?: (option: ModuleOption) => string
}

/** The family a palette id belongs to, or null for a piece that is its own tile. */
const FAMILY_OWNERS: ReadonlyArray<{ key: ModuleFamilyKey; owns: (id: string) => boolean }> = [
  { key: 'roof', owns: (id) => id === 'roof' || id === 'roof-shell' || id === 'roof-truss' || id === 'roof-tapered' },
  { key: 'pillar', owns: (id) => id === 'pillar' || id.startsWith('pillar-') },
  { key: 'stair', owns: isStairType },
  { key: 'exit', owns: isExitType },
  { key: 'busstop', owns: (id) => id === 'busstop' || id.startsWith('busstop-') },
  { key: 'light', owns: (id) => id === 'light' || id.startsWith('light-') },
  { key: 'bench', owns: isBenchType },
  { key: 'billboard', owns: isBillboardType },
  { key: 'glass', owns: isGlassType },
  { key: 'door', owns: isDoorType },
  { key: 'calligraphy', owns: isCalligraphyType },
  { key: 'linemap', owns: isLineMapType },
  { key: 'sign', owns: isSignType },
]

/**
 * The families, grouped by folder: the 设备 folder's two first, then the 装饰 folder's
 * seven. This is the family **table**'s order (what `familiesIn` reports); where each
 * family's parent tile actually sits in a folder's grid is `RAIL_ORDER` below.
 */
export const MODULE_FAMILIES: readonly ModuleFamily[] = [
  { key: 'roof', label: '屋顶', folder: 'rail', owns: (id) => id === 'roof' || id === 'roof-shell' || id === 'roof-truss' || id === 'roof-tapered' },
  { key: 'pillar', label: '柱', folder: 'rail', owns: (id) => id === 'pillar' || id.startsWith('pillar-') },
  { key: 'stair', label: '楼梯', folder: 'equipment', owns: isStairType },
  { key: 'exit', label: '出入口', folder: 'equipment', owns: isExitType },
  { key: 'busstop', label: '公交站', folder: 'decor', owns: (id) => id === 'busstop' || id.startsWith('busstop-') },
  { key: 'light', label: '灯具', folder: 'decor', owns: (id) => id === 'light' || id.startsWith('light-') },
  { key: 'bench', label: '座椅', folder: 'decor', owns: isBenchType },
  { key: 'billboard', label: '广告牌', folder: 'decor', owns: isBillboardType },
  {
    key: 'glass',
    label: '玻璃板',
    folder: 'decor',
    owns: isGlassType,
    // The tiles sit inside the 玻璃板 list, so the family name is not repeated on every
    // one of them — the way 座椅's own variants read 不锈钢 1m, not 座椅 不锈钢 1m.
    tileLabel: (m) => m.label.replace('玻璃板 ', ''),
  },
  {
    key: 'door',
    label: '门',
    folder: 'decor',
    owns: isDoorType,
    // The tiles sit inside the 门 list, so the family's own name is dropped and the
    // piece reads as what it is — 单开 不锈钢, 双开 木 — the way the 玻璃板 list reads
    // 1×1 / 3×2 and the 座椅 list reads 不锈钢 1m.
    tileLabel: (m) => m.label.replace('门 ', ''),
  },
  {
    key: 'calligraphy',
    label: '站名',
    folder: 'decor',
    owns: isCalligraphyType,
  },
  {
    key: 'linemap',
    label: '线网图',
    folder: 'decor',
    owns: isLineMapType,
  },
  {
    key: 'sign',
    label: '指示牌',
    folder: 'decor',
    owns: isSignType,
  },
]

/** The anchor id of a family's parent tile in the grid. */
export function familyAnchor(key: ModuleFamilyKey | string): string {
  return `__${key}`
}

/** The family a palette id — or a placed module's type — belongs to, or null. */
export function familyFor(idOrType: string): ModuleFamily | null {
  const owner = FAMILY_OWNERS.find((f) => f.owns(idOrType))
  return owner ? (MODULE_FAMILIES.find((f) => f.key === owner.key) ?? null) : null
}

/** True for a palette id that belongs to a family (and so is not a tile of its own). */
export function isFamilyOption(id: string): boolean {
  return familyFor(id) !== null
}

/** Every variant of a family, in palette order. */
export function familyOptions(family: ModuleFamily): ModuleOption[] {
  return MODULE_OPTIONS.filter((m) => family.owns(m.id))
}

/** The families a folder shows, in the family table's own order (the grid's is `RAIL_ORDER`). */
export function familiesIn(folder: ModuleFolder): ModuleFamily[] {
  return MODULE_FAMILIES.filter((f) => f.folder === folder)
}

/** True for the gear tiles the 设备 folder owns (everything that is not decor, a run or an exit). */
function isGearTile(option: ModuleOption): boolean {
  return option.type !== 'roof' && option.type !== 'pillar' && option.type !== 'track' && !isDecorType(option.type) && !isStairType(option.type) && !isExitType(option.id)
}

/* -------------------------------------------------- the grid's tile order */

/**
 * One tile of a folder's grid: a **plain tile** — a palette option that is not a variant
 * of a family, and so is a tile of its own — or a **family tile**, the parent whose
 * variant list folds out under it.
 *
 * The two kinds sit in **one** list (`folderTiles`) rather than "the plain tiles, then the
 * families", because where a family sits among the plain tiles is layout, not a property
 * of the family: the 装饰 grid opens on 指示牌 beside 广告牌, a row below 座椅 beside 站名.
 */
export type FolderTile =
  | { kind: 'option'; anchor: string; option: ModuleOption }
  | { kind: 'family'; anchor: string; family: ModuleFamily }

/**
 * The grid order of each folder's tiles — **read two at a time by the 2-column grid**
 * (`rail/shared/InlinePanel.tsx` `interleaveRows`), so a line here is a row of the palette:
 *
 * 设备：闸机 围栏 / 售票机 自动贩卖机 / 扶梯 电梯 / 楼梯 出入口
 * 装饰：指示牌 广告牌 / 座椅 站名 / 线网图 电视 / 垃圾桶 灭火器 / 时钟 监控 /
 * 货架 办公桌 / 玻璃板 门 / 厕所隔间 洗手池 / 灯具 通风口 / 导向柱 公交站
 *
 * The anchors are palette ids and `familyAnchor` keys — the very names the grid hangs its
 * tiles, its sub-menus and its action rows on — so this one list says both what a row holds
 * and where a family's list folds out. It is deliberately explicit: a tile's place in the
 * rail is a decision about the palette, and it must not be inferred from `MODULE_OPTIONS`'s
 * grouping (which is what the sub-menus read) or from a family's own order in the table.
 *
 * `folderTiles` is the only reader, and `folderOptions` is derived from it, so the grid and
 * the folder header's count cannot drift from this list — and `test/rail-families.test.mjs`
 * pins the order itself, plus that each folder draws every plain tile and every family
 * exactly once.
 */
const RAIL_ORDER: Record<ModuleFolder, readonly string[]> = {
  rail: [familyAnchor('roof'), familyAnchor('pillar')],
  equipment: ['gate', 'fence', 'tvm', 'vending', 'escalator', 'lift', familyAnchor('stair'), familyAnchor('exit')],
  decor: [
    familyAnchor('sign'),
    familyAnchor('billboard'),
    familyAnchor('bench'),
    familyAnchor('calligraphy'),
    familyAnchor('linemap'),
    'tv',
    'bin',
    'extinguisher',
    'clock',
    'cctv',
    'shelf',
    'desk',
    // 玻璃板 and 门 share a palette row — the window and the doorway of the same vocabulary —
    // though only the 玻璃板 is wall-mounted: the 门 is a free-standing doorway.
    familyAnchor('glass'),
    familyAnchor('door'),
    // 厕所's own fit-out comes **before** the ceiling and street pairs — a cubicle and a
    // basin are room furniture like the shelf and the desk, and they used to close the folder.
    'cubicle',
    'sink',
    // The ceiling pair sits just above the street pair: 灯具 and 通风口 hang overhead,
    // while 导向柱 and 公交站 stand outside the station.
    familyAnchor('light'),
    'vent',
    'guidepost',
    familyAnchor('busstop'),
  ],
}

/**
 * Everything a folder's grid draws, in rail order: its plain tiles and one parent tile per
 * family, interleaved the way `RAIL_ORDER` lays them out. This is the grid's own list
 * (`TileGrid` renders it and the folder header counts it), so a tile cannot be drawn twice,
 * drawn in the wrong row, or missing from the count.
 */
export function folderTiles(folder: ModuleFolder): FolderTile[] {
  const families = familiesIn(folder)
  const options = MODULE_OPTIONS.filter((m) => (folder === 'rail' ? m.type === 'roof' || m.type === 'pillar' : folder === 'decor' ? isDecorType(m.type) : isGearTile(m)))
  return RAIL_ORDER[folder].flatMap((anchor): FolderTile[] => {
    const family = families.find((f) => familyAnchor(f.key) === anchor)
    if (family) return [{ kind: 'family', anchor, family }]
    const option = options.find((m) => m.id === anchor)
    // A family's variants are its sub-menu's tiles, never the grid's: an anchor that names
    // one is skipped rather than drawn twice (the 座椅's "不锈钢 1m" is under 座椅).
    return option && !isFamilyOption(option.id) ? [{ kind: 'option', anchor, option }] : []
  })
}

/**
 * The **plain tiles** of a folder — every tile of the grid that is not a family's parent —
 * in rail order. This is what keeps a variant from appearing twice, once in the grid and
 * once in its family's list.
 */
export function folderOptions(folder: ModuleFolder): ModuleOption[] {
  return folderTiles(folder).flatMap((t) => (t.kind === 'option' ? [t.option] : []))
}

/**
 * True when the piece being placed owns at least one action tile (旋转, and whatever a
 * family adds beside it). Read by the shared grid, which is what decides whether an
 * action row exists at all.
 */
export function hasModuleActions(moduleType: string): boolean {
  return (
    isRotatableType(moduleType) ||
    isSignType(moduleType) ||
    isStairType(moduleType) ||
    isEscalatorType(moduleType) ||
    isGateType(moduleType)
  )
}

/**
 * The tile an action row folds out under: the **family tile** when the piece is one of
 * a family's variants, and the piece's own tile otherwise. The one rule both the grid
 * (which renders the tiles) and the action row (which folds out under one of them)
 * read, so a piece can never anchor to a tile the folder does not draw.
 */
export function actionsAnchorFor(moduleType: string): string {
  const family = familyFor(moduleType)
  return family ? familyAnchor(family.key) : moduleType
}

/**
 * Whether an action row anchored at `anchor` should be **open** right now.
 *
 * `anchor` is a tile in the grid, `pieceAnchor` is what the piece being placed asks for
 * (`actionsAnchorFor`, or null when it has no row to show) and `openFamily` is the
 * variant list the player is looking at, if any.
 *
 * Two tiles can share a grid row — 座椅 sits beside 站名, 指示牌 beside 广告牌 — and a
 * full-width row can only be inserted *after* that pair, so an open action row lands
 * between a family's tile and whatever the other family of the pair folds out next. Left
 * at that, picking a 座椅 variant and then opening 站名's list drew the bench piece's 旋转
 * tile **directly above 站名's variants**, reading as part of 站名 (and rotating a
 * piece the player had stopped looking at). So a row is open only when it is the piece's
 * **and** the piece's own family is the one in focus: while another family's list is
 * open, the piece's row is parked — the row comes back the moment that family is picked
 * from, and it is never ambiguous which tile it belongs to.
 *
 * The rule is here, in the family table, rather than in the grid, so the row and the
 * tiles cannot drift apart and `test/rail-families.test.mjs` can pin it in Node.
 */
export function actionRowOpen(anchor: string, pieceAnchor: string | null, openFamily: ModuleFamilyKey | null): boolean {
  if (pieceAnchor === null || pieceAnchor !== anchor) return false
  if (openFamily === null) return true
  return familyAnchor(openFamily) === anchor
}

/* ------------------------------------------------- the 方块 tool's cut pieces */

/**
 * The three pieces one 方块 click can lay: a **半墙** — the same 1 m course at half a
 * block thick, the wall a facility room's own walls and the panel beside a wide run
 * are made of — and the two ways a cell is sawn on its 45° plane, **三角上** and
 * **三角下**.
 *
 * They are **not palette options**: no tool "places a 半墙" as a piece of its own, the
 * 方块 tool lays one instead of a block, so there is no `MODULE_OPTIONS` row to read
 * one from. The table lives here anyway, beside the families, because it is the same
 * kind of thing — a list of what the rail offers, read by every half that has to agree:
 * the 结构 folder's tiles (`CUT_MODES`), the store that arms the mode
 * (`setCutMode`) and the anchor each piece's action row folds out
 * under (`cutAnchor`).
 *
 * The order is the order the tiles are drawn in. Each piece is armed on its own tile —
 * the row the player clicks — and no key walks the list: **Tab** is the 生成墙壁 ring's.
 */
export type CutMode = 'half' | 'upper' | 'lower'

export interface CutModeSpec {
  id: CutMode
  /** The tile's label (`Block`'s `label`) and the name the notice uses. */
  label: string
  icon: string
}

export const CUT_MODES: readonly CutModeSpec[] = [
  { id: 'half', label: '半墙', icon: 'halfwall' },
  { id: 'upper', label: '上三角块', icon: 'triUpper' },
  { id: 'lower', label: '下三角块', icon: 'triLower' },
]

/** One cut piece's row, defaulting to 半墙 for an id the table does not carry. */
export function cutSpec(cut: CutMode): CutModeSpec {
  return CUT_MODES.find((c) => c.id === cut) ?? CUT_MODES[0]
}

/**
 * Which cut piece owns the 方块 tool right now, or null for a plain 方块. The store
 * keeps the mode as the two fields the click reads (`halfWall` / `triangles` +
 * `triKind`); this is the one place they are read as the single thing they mean.
 */
export function cutModeOf(halfWall: boolean, triangles: boolean, triKind: TriangleKind): CutMode | null {
  return halfWall ? 'half' : triangles ? triKind : null
}

/**
 * The tile id of one cut piece — what the 工具 folder draws it as, and the **anchor**
 * its action row folds out under, exactly as `familyAnchor` is for a family's parent
 * tile and `actionsAnchorFor` is for a piece's.
 */
export function cutAnchor(cut: CutMode): string {
  return `__cut-${cut}`
}

/**
 * Facility rooms built by dragging a rectangle in the zone tool. The ids name the
 * pieces the brushes build — a walled room of a fit-out, or the ticket booth —
 * exactly as `build/model.ts`'s `FacilityKind` spells them, so the brush the rail
 * hands the drag and the module the drag places cannot drift apart.
 */
export type FacilityBrush = 'store' | 'toilet' | 'office' | 'ticket'

/**
 * The 分区 folder's **无分区** brush: the tile that takes a label off the floor
 * instead of putting one on, so a cell goes back to reading `none` — 无分区 —
 * which is the state an unpainted cell is in (`zoneOf`, `sim/zones.ts`). A zone is
 * a label over that state, and before this brush there was no way back to it: a
 * mis-painted patch could only be painted over with another zone.
 *
 * It is the zone id itself — the brush is *named* for the state it produces, and
 * `isEraseBrush` is what tells the tool and the card that this one brush removes
 * a label rather than writing one (the model refuses to *write* `none`: a reading
 * is not a record).
 */
export type ZoneEraser = 'none'

export type ZoneBrush = Zone | FacilityBrush

/**
 * The brush the 分区 folder opens on, and the one a fresh station is armed with:
 * **非付费区**, the concourse most stations are mostly made of. Never 无分区 —
 * that brush is the eraser (`isEraseBrush`), and a station's first click should
 * paint something.
 */
export const DEFAULT_ZONE_BRUSH: ZoneBrush = 'unpaid'

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

/**
 * Is this the 分区 folder's **无分区** brush — the one that **removes** a label
 * rather than setting one? Every reader asks this instead of comparing the id, so
 * the brush, the tile that arms it and the command that runs are one thing named
 * once. `ZoneBrush` is still just zones and rooms: 无分区 is a zone id like any
 * other, and this predicate is what says that arming it means "take the label off".
 */
export function isEraseBrush(b: ZoneBrush): b is ZoneEraser {
  return b === 'none'
}

/** Friendly name for a module type, for the inspector and the bulldoze notice. */
const MODULE_LABELS: Record<string, string> = {
  pillar: '支柱',
  roof: '车站屋顶',
  gate: '闸机',
  fence: '围栏',
  tvm: '售票机',
  vending: '自动贩卖机',
  bench: '座椅',
  shelf: '货架',
  desk: '办公桌',
  cubicle: '厕所隔间',
  sink: '洗手池',
  guidepost: '导向柱',
  busstop: '公交站',
  bin: '垃圾桶',
  extinguisher: '灭火器',
  vent: '通风口',
  light: '灯具',
  clock: '时钟',
  cctv: '监控',
  billboard: '广告牌',
  glass: '玻璃板',
  door: '门',
  calligraphy: '站名',
  linemap: '线网图',
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
 * and every Tab cycle — the stair and roof widths, the escalator direction, the 闸机's lane
 * or fence, and the 方块 tool's cut modes (**半墙** / **三角上** / **三角下**) with the
 * wall-face cycle they share. The viewport subscribes to this one key, so anything
 * that changes what a ghost looks like rebuilds it under the pointer at once
 * instead of waiting for the next pointer move; a new Tab cycle only has to join
 * this list, in one place, to be redrawn live. (It is what keeps a cut piece
 * honest too: R turns a 半墙 to another half of the tile, or a 三角 to another
 * corner, without moving the pending cells at all, so nothing else would redraw
 * it.)
 */
export function placementPreviewKey(
  s: Pick<
    AppState,
    'guideExitId' | 'bridgeLength' | 'bridgeRailing' | 'moduleType' | 'moduleRot' | 'lightPosition' | 'stairWidth' | 'stairBlockHeight' | 'roofWidth' | 'escalatorDir' | 'escalatorWide' | 'escalatorLong' | 'liftStyle' | 'gateDoor' | 'halfWall' | 'triangles' | 'triKind' | 'wallSnapCycle'
  >,
): string {
  return `${s.guideExitId ?? ''}|${s.bridgeLength}|${s.bridgeRailing}|${s.moduleType}|${s.moduleRot}|${s.lightPosition}|${s.stairWidth}|${s.stairBlockHeight}|${s.roofWidth}|${s.escalatorDir}|${s.escalatorWide}|${s.escalatorLong}|${s.liftStyle}|${s.gateDoor}|${s.halfWall}|${s.triangles}|${s.triKind}|${s.wallSnapCycle}`
}
