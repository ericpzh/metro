import { msg } from '../../sim/i18n.ts'
// The build-rail catalogue: every placeable piece option, type predicate and
// label the rail, the viewport ghost and the inspector share. Pure data and
// predicates — no store wiring — so slices and components import it directly
// instead of reaching into a slice.

import type { AppState } from './Store.ts'
import type { Module, RoomKind, TriangleKind, Zone } from '../../sim/types.ts'
import { SHELF_VARIANTS, shelfSpec } from '../../sim/shelves.ts'
import { SIGN_MOUNTS, signMountSpec } from '../../sim/sign.ts'

export interface ModuleOption {
  id: string
  label: string
  type: string
  w: number
  h: number
}

/** The four sections inside 装饰. */
export type DecorCategory = 'ceiling' | 'wall' | 'floor' | 'outside'

/** Palette ids grouped by where the player mounts or places the decor. */
const DECOR_CATEGORY_IDS: Record<DecorCategory, ReadonlySet<string>> = {
  ceiling: new Set([
    'hanger-roof', 'monitor-ceiling', 'tv', 'clock', 'cctv', 'cctv-ptz', 'cctv-dome',
    'light-circular', 'light-rectangular', 'vent', 'sign-ceiling',
  ]),
  wall: new Set([
    'monitor-wall', 'billboard-wide', 'billboard-standard', 'billboard-large', 'billboard-panorama',
    'billboard-portrait', 'billboard-square', 'glass-1x1', 'glass-2x1', 'glass-3x1',
    'glass-1x2', 'glass-2x2', 'glass-3x2', 'calligraphy-kai-h', 'calligraphy-kai-v',
    'calligraphy-xing-h', 'calligraphy-xing-v', 'calligraphy-li-h', 'calligraphy-li-v',
    'calligraphy-wei-h', 'calligraphy-wei-v', 'calligraphy-hei-h', 'calligraphy-hei-v',
    'calligraphy-song-h', 'calligraphy-song-v', 'linemap-wall', 'sign-wall',
  ]),
  floor: new Set([
    'tvm', 'vending', 'hanger-post', 'electrical-cabinet', 'tactile-guide', 'tactile-warning',
    'floor-mark-boarding', 'floor-mark-waiting', 'floor-mark-direction', 'bench-steel-1', 'bench-seat-1',
    'desk', 'checkout', 'cubicle', 'sink', 'bin', 'extinguisher', 'extinguisher-compact', 'extinguisher-glass', 'curtain-wall', 'psd-end', 'rail-signal',
    'linemap-stand', 'door-steel-1', 'door-wood-1', 'door-glass-1', 'noise-barrier', 'noise-barrier-half', 'noise-barrier-railing',
  ]),
  outside: new Set(['cctv-post', 'sidewalk', 'lawn', 'tree', 'traffic-light', 'road', 'ac-unit', 'guidepost', 'busstop-short', 'busstop-long']),
}

export function decorCategoryHasId(category: DecorCategory, id: string): boolean {
  if (category === 'floor' && (id.startsWith('shelf-') || id.startsWith('extinguisher-'))) return true
  return DECOR_CATEGORY_IDS[category].has(id)
}

export function decorCategoryForId(id: string): DecorCategory | null {
  return (['ceiling', 'wall', 'floor', 'outside'] as const).find((category) => decorCategoryHasId(category, id)) ?? null
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
  ...(['sidewalk', 'lawn', 'tree'] as const).map(id => ({ id, label: msg(id), type: id, w: 1, h: 1 })),
  { id: 'road', label: msg('road'), type: 'road', w: 6, h: 12 },
  { id: 'hanger-roof', label: msg('roof_hanger'), type: 'hanger', w: 4, h: 1 },
  { id: 'hanger-post', label: msg('post_hanger'), type: 'hanger', w: 4, h: 1 },
  { id: 'ac-unit', label: msg('air_conditioner'), type: 'ac-unit', w: 3, h: 2 },
  { id: 'electrical-cabinet', label: msg('equipment_cabinet'), type: 'electrical-cabinet', w: 3, h: 1 },
  { id: 'tactile-guide', label: msg('tactile_guide'), type: 'tactile', w: 1, h: 1 },
  { id: 'tactile-warning', label: msg('tactile_warning'), type: 'tactile', w: 1, h: 1 },
  { id: 'floor-mark-boarding', label: msg('door_arrows'), type: 'floor-mark', w: 3, h: 1 },
  { id: 'floor-mark-waiting', label: msg('queue_lines'), type: 'floor-mark', w: 3, h: 2 },
  { id: 'floor-mark-direction', label: msg('direction_guide'), type: 'floor-mark', w: 1, h: 2 },
  { id: 'pillar-slim', label: msg('slim_pillar'), type: 'pillar', w: 1, h: 1 },
  { id: 'pillar-thick', label: msg('thick_pillar'), type: 'pillar', w: 1, h: 1 },
  { id: 'roof', label: msg('slab'), type: 'roof', w: 1, h: 1 },
  { id: 'roof-shell', label: msg('no_truss'), type: 'roof', w: 4, h: 4 },
  { id: 'roof-truss', label: msg('truss'), type: 'roof', w: 4, h: 4 },
  { id: 'roof-tapered', label: msg('tapered_truss'), type: 'roof', w: 4, h: 4 },
  { id: 'roof-canopy', label: msg('column_canopy'), type: 'roof', w: 4, h: 4 },
  { id: 'bridge', label: msg('railway_bridge'), type: 'track', w: 12, h: 3 },
  { id: 'gate', label: msg('old'), type: 'gate', w: 1, h: 1 },
  { id: 'gate-new', label: msg('new'), type: 'gate', w: 1, h: 1 },
  { id: 'psd-end', label: msg('screen_end_door'), type: 'psd-end', w: 1, h: 1 },
  { id: 'fence', label: msg('glass_fence'), type: 'fence', w: 1, h: 1 },
  { id: 'fence-gate', label: msg('door'), type: 'fence', w: 1, h: 1 },
  { id: 'fence-iron', label: msg('iron_fence'), type: 'fence', w: 1, h: 1 },
  { id: 'noise-barrier', label: msg('full_height_noise_barrier'), type: 'fence', w: 1, h: 3 },
  { id: 'noise-barrier-half', label: msg('half_height_noise_barrier'), type: 'fence', w: 1, h: 1.5 },
  { id: 'noise-barrier-railing', label: msg('railing'), type: 'fence', w: 1, h: 0.74 },
  { id: 'tvm', label: msg('ticket_machine'), type: 'tvm', w: 1, h: 1 },
  { id: 'vending', label: msg('vending_machine'), type: 'vending', w: 1, h: 1 },
  { id: 'bench-steel-1', label: msg('stainless_steel'), type: 'bench', w: 1, h: 1 },
  { id: 'bench-seat-1', label: msg('backed_seats'), type: 'bench', w: 1, h: 1 },
  ...SHELF_VARIANTS.map((variant) => ({ id: `shelf-${variant}`, label: shelfSpec(variant).label, type: 'shelf', w: 1, h: 1 })),
  { id: 'desk', label: msg('desk'), type: 'desk', w: 1, h: 1 },
  { id: 'checkout', label: msg('checkout'), type: 'checkout', w: 1, h: 1 },
  { id: 'cubicle', label: msg('toilet_cubicle'), type: 'cubicle', w: 1, h: 1 },
  { id: 'sink', label: msg('sink'), type: 'sink', w: 1, h: 1 },
  { id: 'guidepost', label: msg('wayfinding_post'), type: 'guidepost', w: 1, h: 1 },
  { id: 'busstop-short', label: msg('short'), type: 'busstop', w: 4, h: 2 },
  { id: 'busstop-long', label: msg('long'), type: 'busstop', w: 8, h: 2 },
  { id: 'bin', label: msg('bin'), type: 'bin', w: 1, h: 1 },
  { id: 'extinguisher', label: msg('fire_cabinet_medium'), type: 'extinguisher', w: 1, h: 1 },
  { id: 'extinguisher-compact', label: msg('fire_cabinet_small'), type: 'extinguisher', w: 1, h: 1 },
  { id: 'extinguisher-glass', label: msg('fire_cabinet_large'), type: 'extinguisher', w: 2, h: 1 },
  { id: 'vent', label: msg('vent'), type: 'vent', w: 1, h: 1 },
  { id: 'light-circular', label: msg('round'), type: 'light', w: 1, h: 1 },
  { id: 'light-rectangular', label: msg('strip'), type: 'light', w: 1, h: 1 },
  { id: 'clock', label: msg('clock'), type: 'clock', w: 1, h: 1 },
  { id: 'cctv', label: msg('bullet_camera'), type: 'cctv', w: 1, h: 1 },
  { id: 'cctv-ptz', label: msg('ptz_camera'), type: 'cctv', w: 1, h: 1 },
  { id: 'cctv-post', label: msg('post_camera'), type: 'cctv', w: 1, h: 1 },
  { id: 'cctv-dome', label: msg('dome_camera'), type: 'cctv', w: 1, h: 1 },
  { id: 'billboard-wide', label: msg('landscape_16_9'), type: 'billboard', w: 1, h: 1 },
  { id: 'billboard-standard', label: msg('standard_2_25_1'), type: 'billboard', w: 2, h: 1 },
  { id: 'billboard-large', label: msg('large_landscape_16_9'), type: 'billboard', w: 2, h: 1 },
  { id: 'billboard-panorama', label: msg('wide_3_75_1'), type: 'billboard', w: 3, h: 1 },
  { id: 'billboard-portrait', label: msg('portrait_0_7_1'), type: 'billboard', w: 1, h: 1 },
  { id: 'billboard-square', label: msg('square_1_1'), type: 'billboard', w: 1, h: 1 },
  { id: 'monitor-ceiling', label: msg('monitor_ceiling'), type: 'monitor', w: 1, h: 1 },
  { id: 'monitor-wall', label: msg('monitor_wall'), type: 'monitor', w: 3, h: 1 },
  { id: 'traffic-light', label: msg('traffic_light'), type: 'traffic-light', w: 1, h: 1 },
  { id: 'rail-signal', label: msg('rail_signal'), type: 'rail-signal', w: 1, h: 1 },
  { id: 'tv', label: msg('tv'), type: 'tv', w: 1, h: 1 },
  // The 指示牌's two mounts (§5.8): the overhead board hung from the ceiling and read
  // from both sides, and the same board bolted flat to a wall. Two tiles, one piece —
  // the 线网图's wall/stand pair read the other way round (`sim/sign.ts`) — and the tiles
  // are **built from that table** (`SIGN_MOUNTS` / `signMountSpec`), so a mount's label
  // and its palette id cannot drift apart.
  ...SIGN_MOUNTS.map((mount) => ({ id: `sign-${mount}`, label: signMountSpec(mount).label, type: 'sign', w: 1, h: 1 })),
  // The 装饰 panels (§5.7): six wall-mounted glass sizes plus three floor-standing 4 m
  // edge panels, the station-name
  // inscription in six hands × two axes, the network map as a wall board or a
  // free-standing totem, and the 指示牌 on its wall mount (its hanging sibling above is
  // the ceiling's). A run's length is the piece's own (`sim/glassPanels.ts`,
  // `sim/calligraphy.ts`, `sim/linemaps.ts`), so the cell counts here name the
  // smallest piece of each family.
  { id: 'curtain-wall', label: msg('curtain_wall'), type: 'glass', w: 2, h: 1 },
  { id: 'glass-1x1', label: msg('glass_panel_1_1'), type: 'glass', w: 1, h: 1 },
  { id: 'glass-2x1', label: msg('glass_panel_2_1'), type: 'glass', w: 2, h: 1 },
  { id: 'glass-3x1', label: msg('glass_panel_3_1'), type: 'glass', w: 3, h: 1 },
  { id: 'glass-1x2', label: msg('glass_panel_1_2'), type: 'glass', w: 1, h: 1 },
  { id: 'glass-2x2', label: msg('glass_panel_2_2'), type: 'glass', w: 2, h: 1 },
  { id: 'glass-3x2', label: msg('glass_panel_3_2'), type: 'glass', w: 3, h: 1 },
  // Door material is chosen in the family menu; 窄/宽 is the action-row setting.
  { id: 'door-steel-1', label: msg('stainless_steel'), type: 'door', w: 1, h: 1 },
  { id: 'door-wood-1', label: msg('wood'), type: 'door', w: 1, h: 1 },
  { id: 'door-glass-1', label: msg('glass'), type: 'door', w: 1, h: 1 },
  { id: 'calligraphy-kai-h', label: msg('regular_script_horizontal'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-kai-v', label: msg('regular_script_vertical'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-xing-h', label: msg('running_script_horizontal'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-xing-v', label: msg('running_script_vertical'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-li-h', label: msg('clerical_script_horizontal'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-li-v', label: msg('clerical_script_vertical'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-wei-h', label: msg('wei_stele_horizontal'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-wei-v', label: msg('wei_stele_vertical'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-hei-h', label: msg('sans_serif_horizontal'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-hei-v', label: msg('sans_serif_vertical'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-song-h', label: msg('song_serif_horizontal'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'calligraphy-song-v', label: msg('song_serif_vertical'), type: 'calligraphy', w: 1, h: 1 },
  { id: 'linemap-wall', label: msg('wall_network_map'), type: 'linemap', w: 2, h: 1 },
  { id: 'linemap-stand', label: msg('standing_network_map'), type: 'linemap', w: 1, h: 1 },
  { id: 'exit-covered-1', label: msg('covered_one_way'), type: 'exit', w: 1, h: 1 },
  { id: 'exit', label: msg('covered_two_ways'), type: 'exit', w: 1, h: 1 },
  { id: 'exit-covered-3', label: msg('covered_three_ways'), type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-1', label: msg('uncovered_one_way'), type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-2', label: msg('uncovered_two_ways'), type: 'exit', w: 1, h: 1 },
  { id: 'exit-uncovered-3', label: msg('uncovered_three_ways'), type: 'exit', w: 1, h: 1 },
  { id: 'exit-doorway-1', label: msg('ground_one_way'), type: 'exit', w: 3, h: 1 },
  { id: 'exit-doorway-2', label: msg('ground_two_ways'), type: 'exit', w: 4, h: 1 },
  { id: 'exit-doorway-3', label: msg('ground_three_ways'), type: 'exit', w: 5, h: 1 },
  { id: 'exit-doorway-4', label: msg('ground_four_ways'), type: 'exit', w: 6, h: 1 },
  { id: 'exit-virtual', label: msg('virtual_exit'), type: 'exit', w: 1, h: 1 },
  { id: 'escalator', label: msg('escalator'), type: 'escalator', w: 1, h: 1 },
  { id: 'walkway', label: msg('walkway'), type: 'walkway', w: 1, h: 1 },
  { id: 'lift', label: msg('lift'), type: 'lift', w: 1, h: 1 },
  { id: 'stair-straight', label: msg('straight_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-block', label: msg('stair_block'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-leftForward', label: msg('left_forward_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-centerForward', label: msg('center_forward_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-rightForward', label: msg('right_forward_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-left90', label: msg('left_quarter_turn_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-right90', label: msg('right_quarter_turn_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-left180', label: msg('left_switchback_stairs'), type: 'stair', w: 1, h: 1 },
  { id: 'stair-right180', label: msg('right_switchback_stairs'), type: 'stair', w: 1, h: 1 },
]

/** True for any fixed staircase shape in the palette. */
export function isStairType(type: string): boolean {
  return type === 'stair' || type.startsWith('stair-')
}

/**
 * True for the **single-run** staircase — 单跑楼梯, the palette's 直跑楼梯 tile and the
 * bare `stair` the room builder places. Every staircase but the 1 × 1 楼梯块 climbs a
 * chosen run length now (`sim/rampLengths.ts`), but only a straight run can end in an
 * exit bay, so this predicate still gates the bay snap. A turning stair turns inside
 * its own footprint; a 楼梯块 is a half-height building piece with no run at all.
 */
export function isStraightStairType(type: string): boolean {
  return type === 'stair' || type === 'stair-straight'
}

/**
 * True for any of the four billboard formats (装饰). The palette stores the
 * option id (`billboard-wide`, …) while a placed module's `type` is the bare
 * `billboard`, so both the id and the type read as a billboard here.
 */
export function isBillboardType(type: string): boolean {
  return type === 'billboard' || type.startsWith('billboard-')
}

export function isShelfType(type: string): boolean {
  return type === 'shelf' || type.startsWith('shelf-')
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
    isNoiseBarrierType(type) ||
    type === 'tvm' || type === 'vending' ||
    type === 'hanger' || type.startsWith('hanger-') ||
    type === 'tactile' || type.startsWith('tactile-') || type === 'floor-mark' || type.startsWith('floor-mark-') ||
    type === 'ac-unit' || type === 'electrical-cabinet' ||
    isBenchType(type) ||
    type === 'curtain-wall' || type === 'psd-end' ||
    isShelfType(type) ||
    type === 'desk' ||
    type === 'checkout' ||
    type === 'cubicle' ||
    type === 'sink' ||
    type === 'sidewalk' || type === 'lawn' || type === 'tree' || type === 'traffic-light' || type === 'road' || type === 'guidepost' || type === 'busstop' || type.startsWith('busstop-') ||
    type === 'bin' ||
    type === 'extinguisher' || type.startsWith('extinguisher-') ||
    (type === 'light' || type.startsWith('light-')) ||
    type === 'vent' ||
    type === 'clock' ||
    (type === 'cctv' || type.startsWith('cctv-')) ||
    isSignType(type) ||
    isBillboardType(type) ||
    isGlassType(type) ||
    isDoorType(type) ||
    isCalligraphyType(type) ||
    isLineMapType(type) ||
    type === 'tv' || type === 'monitor' || type.startsWith('monitor-') || type === 'rail-signal'
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
  return type === 'monitor-wall' || isBillboardType(type) || isGlassType(type) || isCalligraphyType(type) || type === 'sign-wall' || type.startsWith('exit-doorway-') || (isLineMapType(type) && type !== 'linemap-stand')
}

/** True for the fence piece, which drags out a run like the wall tool. */
export function isFenceType(type: string): boolean {
  return type === 'fence' || type === 'fence-gate' || type === 'fence-iron' || isNoiseBarrierType(type)
}

export function isNoiseBarrierType(type: string): boolean {
  return type === 'noise-barrier' || type === 'noise-barrier-half' || type === 'noise-barrier-railing'
}

function isStandardFenceType(type: string): boolean {
  return isFenceType(type) && !isNoiseBarrierType(type)
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
 * True for the 自动步道 — the level twin of the escalator. Its Tab cycle is its
 * own length plus the shared up/down direction and 窄/宽 width.
 */
export function isWalkwayType(type: string): boolean {
  return type === 'walkway'
}

/**
 * True for the fare gate (闸机), whose Tab cycle picks a working lane or
 * a fence-only machine (§4.5); both housing styles share the choice.
 */
export function isGateType(type: string): boolean {
  return type === 'gate' || type === 'gate-new'
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
export type ModuleFamilyKey = 'monitor' | 'gate' | 'fence' | 'noise-barrier' | 'hanger' | 'cctv' | 'tactile' | 'floor-mark' | 'busstop' | 'light' | 'roof' | 'pillar' | 'stair' | 'exit' | 'bench' | 'shelf' | 'extinguisher' | 'billboard' | 'glass' | 'door' | 'calligraphy' | 'linemap' | 'sign'

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
  { key: 'monitor', owns: (id) => id === 'monitor' || id.startsWith('monitor-') },
  { key: 'extinguisher', owns: (id) => id === 'extinguisher' || id.startsWith('extinguisher-') },
  { key: 'gate', owns: isGateType },
  { key: 'fence', owns: isStandardFenceType },
  { key: 'noise-barrier', owns: isNoiseBarrierType },
  { key: 'hanger', owns: (id) => id === 'hanger' || id === 'hanger-roof' || id === 'hanger-post' },
  { key: 'cctv', owns: (id) => id === 'cctv' || id.startsWith('cctv-') },
  { key: 'tactile', owns: (id) => id === 'tactile' || id.startsWith('tactile-') },
  { key: 'floor-mark', owns: (id) => id === 'floor-mark' || id.startsWith('floor-mark-') },
  { key: 'roof', owns: (id) => id === 'roof' || id === 'roof-shell' || id === 'roof-truss' || id === 'roof-tapered' || id === 'roof-canopy' },
  { key: 'pillar', owns: (id) => id === 'pillar' || id.startsWith('pillar-') },
  { key: 'stair', owns: isStairType },
  { key: 'exit', owns: isExitType },
  { key: 'busstop', owns: (id) => id === 'busstop' || id.startsWith('busstop-') },
  { key: 'light', owns: (id) => id === 'light' || id.startsWith('light-') },
  { key: 'bench', owns: isBenchType },
  { key: 'shelf', owns: isShelfType },
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
  { key: 'monitor', label: msg('monitor'), folder: 'decor', owns: (id) => id === 'monitor' || id.startsWith('monitor-') },
  { key: 'gate', label: msg('fare_gate'), folder: 'equipment', owns: isGateType },
  { key: 'fence', label: msg('fence'), folder: 'equipment', owns: isStandardFenceType },
  { key: 'hanger', label: msg('hanger'), folder: 'decor', owns: (id) => id === 'hanger' || id === 'hanger-roof' || id === 'hanger-post' },
  { key: 'cctv', label: msg('cctv'), folder: 'decor', owns: (id) => id === 'cctv' || id.startsWith('cctv-') },
  { key: 'tactile', label: msg('tactile_paving'), folder: 'decor', owns: (id) => id === 'tactile' || id.startsWith('tactile-') },
  { key: 'floor-mark', label: msg('floor_markings'), folder: 'decor', owns: (id) => id === 'floor-mark' || id.startsWith('floor-mark-') },
  { key: 'roof', label: msg('roof'), folder: 'rail', owns: (id) => id === 'roof' || id === 'roof-shell' || id === 'roof-truss' || id === 'roof-tapered' || id === 'roof-canopy' },
  { key: 'pillar', label: msg('pillar'), folder: 'rail', owns: (id) => id === 'pillar' || id.startsWith('pillar-') },
  { key: 'stair', label: msg('stairs'), folder: 'equipment', owns: isStairType },
  { key: 'exit', label: msg('entrances'), folder: 'equipment', owns: isExitType },
  { key: 'busstop', label: msg('bus_stop'), folder: 'decor', owns: (id) => id === 'busstop' || id.startsWith('busstop-') },
  { key: 'light', label: msg('light'), folder: 'decor', owns: (id) => id === 'light' || id.startsWith('light-') },
  { key: 'bench', label: msg('bench'), folder: 'decor', owns: isBenchType },
  { key: 'shelf', label: msg('shelf'), folder: 'decor', owns: isShelfType },
  { key: 'extinguisher', label: msg('extinguisher'), folder: 'decor', owns: (id) => id === 'extinguisher' || id.startsWith('extinguisher-') },
  { key: 'billboard', label: msg('billboard'), folder: 'decor', owns: isBillboardType },
  {
    key: 'glass',
    label: msg('glass_panel'),
    folder: 'decor',
    owns: isGlassType,
    // The tiles sit inside the 玻璃板 list, so the family name is not repeated on every
    // one of them — the way 座椅's own variants read 不锈钢 1 m, not 座椅 不锈钢 1 m.
    tileLabel: (m) => m.label.replace(msg('glass_panel_265'), ''),
  },
  {
    key: 'door',
    label: msg('door'),
    folder: 'decor',
    owns: isDoorType,
    // The two variants choose only the door's finish; its width has a separate Tab tile.
    tileLabel: (m) => m.label,
  },
  {
    key: 'calligraphy',
    label: msg('station_name'),
    folder: 'decor',
    owns: isCalligraphyType,
  },
  {
    key: 'linemap',
    label: msg('network_map'),
    folder: 'decor',
    owns: isLineMapType,
  },
  {
    key: 'sign',
    label: msg('sign'),
    folder: 'decor',
    owns: isSignType,
  },
  { key: 'noise-barrier', label: msg('noise_barrier'), folder: 'decor', owns: isNoiseBarrierType },
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
  // A category decides whether a family appears there; once present, keep its full
  // variant menu together so mount/size alternatives are not hidden by the section.
  return MODULE_OPTIONS.filter((m) => family.owns(m.id))
}

/** The families a folder shows, in the family table's own order (the grid's is `RAIL_ORDER`). */
export function familiesIn(folder: ModuleFolder, category?: DecorCategory): ModuleFamily[] {
  return MODULE_FAMILIES.filter((f) => f.folder === folder && (!category || MODULE_OPTIONS.some((m) => f.owns(m.id) && decorCategoryHasId(category, m.id))))
}

/** True for the gear tiles the 设备 folder owns (everything that is not decor, a run or an exit). */
function isGearTile(option: ModuleOption): boolean {
  return option.type !== 'roof' && option.type !== 'pillar' && option.type !== 'track' && !isDecorType(option.id) && !isStairType(option.type) && !isExitType(option.id)
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
 * 设备：闸机 围栏 / 扶梯 自动步道 / 电梯 楼梯 / 出入口
 * 装饰：指示牌 广告牌 / 座椅 站名 / 线网图 电视 / 垃圾桶 灭火器 / 时钟 监控 /
 * 货架 收银台 / 玻璃板 门 / 厕所隔间 洗手池 / 灯具 通风口 / 挂架 办公桌 / 导向柱 公交站
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
  equipment: [familyAnchor('gate'), familyAnchor('fence'), 'escalator', 'walkway', 'lift', familyAnchor('stair'), familyAnchor('exit')],
  decor: [
    familyAnchor('sign'),
    familyAnchor('billboard'),
    familyAnchor('bench'),
    familyAnchor('calligraphy'),
    familyAnchor('tactile'), familyAnchor('floor-mark'),
    familyAnchor('linemap'),
    'tv',
    familyAnchor('monitor'),
    'rail-signal',
    'psd-end',
    'curtain-wall',
    'bin',
    familyAnchor('extinguisher'),
    'clock',
    familyAnchor('cctv'),
    familyAnchor('shelf'),
    'checkout',
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
    familyAnchor('hanger'),
    'desk',
    'sidewalk', 'lawn', 'tree',
    'road',
    'traffic-light',
    'guidepost',
    familyAnchor('busstop'),
    'ac-unit', 'electrical-cabinet',
    'tvm', 'vending', familyAnchor('noise-barrier'),
  ],
}

/** Category-specific reading order where the all-decor order cannot serve both lists. */
const DECOR_CATEGORY_ORDER: Partial<Record<DecorCategory, readonly string[]>> = {
  wall: [
    familyAnchor('sign'), familyAnchor('billboard'), familyAnchor('monitor'), familyAnchor('glass'),
    familyAnchor('calligraphy'), familyAnchor('linemap'),
  ],
  floor: [
    'tvm', 'vending', familyAnchor('bench'), familyAnchor('door'), 'curtain-wall', 'psd-end',
    familyAnchor('extinguisher'), 'bin', familyAnchor('shelf'), 'checkout', familyAnchor('linemap'), 'desk',
    familyAnchor('tactile'), familyAnchor('floor-mark'), 'electrical-cabinet', 'rail-signal', 'cubicle', 'sink', familyAnchor('hanger'), familyAnchor('noise-barrier'),
  ],
}

/**
 * Everything a folder's grid draws, in rail order: its plain tiles and one parent tile per
 * family, interleaved the way `RAIL_ORDER` lays them out. This is the grid's own list
 * (`TileGrid` renders it and the folder header counts it), so a tile cannot be drawn twice,
 * drawn in the wrong row, or missing from the count.
 */
export function folderTiles(folder: ModuleFolder, category?: DecorCategory): FolderTile[] {
  const families = familiesIn(folder, category)
  const options = MODULE_OPTIONS.filter((m) => (folder === 'rail' ? m.type === 'roof' || m.type === 'pillar' : folder === 'decor' ? isDecorType(m.id) && (!category || decorCategoryHasId(category, m.id)) : isGearTile(m)))
  const order = folder === 'decor' && category ? DECOR_CATEGORY_ORDER[category] ?? RAIL_ORDER.decor : RAIL_ORDER[folder]
  return order.flatMap((anchor): FolderTile[] => {
    const family = families.find((f) => familyAnchor(f.key) === anchor)
    if (family) return [{ kind: 'family', anchor, family }]
    const option = options.find((m) => m.id === anchor)
    // A family's variants are its sub-menu's tiles, never the grid's: an anchor that names
    // one is skipped rather than drawn twice (the 座椅's "不锈钢 1 m" is under 座椅).
    return option && !isFamilyOption(option.id) ? [{ kind: 'option', anchor, option }] : []
  })
}

/**
 * The **plain tiles** of a folder — every tile of the grid that is not a family's parent —
 * in rail order. This is what keeps a variant from appearing twice, once in the grid and
 * once in its family's list.
 */
export function folderOptions(folder: ModuleFolder, category?: DecorCategory): ModuleOption[] {
  return folderTiles(folder, category).flatMap((t) => (t.kind === 'option' ? [t.option] : []))
}

/**
 * True when the piece being placed owns at least one action tile (旋转, and whatever a
 * family adds beside it). Read by the shared grid, which is what decides whether an
 * action row exists at all.
 */
export function hasModuleActions(moduleType: string): boolean {
  return (
    isRotatableType(moduleType) ||
    moduleType === 'hanger-roof' || moduleType === 'hanger-post' ||
    isSignType(moduleType) ||
    isStairType(moduleType) ||
    isDoorType(moduleType) ||
    isEscalatorType(moduleType) ||
    isWalkwayType(moduleType) ||
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
  { id: 'half', label: msg('half_wall'), icon: 'halfwall' },
  { id: 'upper', label: msg('upper_wedge'), icon: 'triUpper' },
  { id: 'lower', label: msg('lower_wedge'), icon: 'triLower' },
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
 * Counter modules built by dragging a rectangle in the zone tool. The ids match
 * `FacilityKind`'s buildable counter values; store/toilet/office are room-purpose
 * paint labels and do not create modules.
 */
export type FacilityBrush = 'ticket' | 'info'

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

export type ZoneBrush = Zone | RoomKind | FacilityBrush

/**
 * The brush the 分区 folder opens on, and the one a fresh station is armed with:
 * **非付费区**, the concourse most stations are mostly made of. Never 无分区 —
 * that brush is the eraser (`isEraseBrush`), and a station's first click should
 * paint something.
 */
export const DEFAULT_ZONE_BRUSH: ZoneBrush = 'unpaid'

/**
 * Counter brushes use an icon; `colour` tints their drag preview.
 */
export const FACILITY_OPTIONS: Array<{ id: FacilityBrush; label: string; colour: number; icon: string }> = [
  { id: 'ticket', label: msg('ticket_booth'), colour: 0x42a5c4, icon: 'roomTicket' },
  { id: 'info', label: msg('information_desk'), colour: 0x42a5c4, icon: 'roomInfo' },
]

export function isFacilityBrush(b: ZoneBrush): b is FacilityBrush {
  return b === 'ticket' || b === 'info'
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
  hanger: msg('hanger'),
  pillar: msg('support_pillar'),
  roof: msg('station_roof'),
  gate: msg('fare_gate'),
  'psd-end': msg('screen_end_door'),
  fence: msg('glass_fence'),
  tvm: msg('ticket_machine'),
  vending: msg('vending_machine'),
  bench: msg('bench'),
  shelf: msg('shelf'),
  desk: msg('desk'),
  checkout: msg('checkout'),
  cubicle: msg('toilet_cubicle'),
  sink: msg('sink'),
  guidepost: msg('wayfinding_post'),
  sidewalk: msg('sidewalk'), lawn: msg('lawn'), tree: msg('tree'),
  road: msg('road'),
  busstop: msg('bus_stop'),
  bin: msg('bin'),
  extinguisher: msg('extinguisher'),
  'ac-unit': msg('air_conditioner'),
  'electrical-cabinet': msg('equipment_cabinet'),
  tactile: msg('tactile_paving'),
  'floor-mark': msg('floor_markings'),
  vent: msg('vent'),
  light: msg('light'),
  clock: msg('clock'),
  cctv: msg('cctv'),
  billboard: msg('billboard'),
  glass: msg('glass_panel'),
  door: msg('door'),
  calligraphy: msg('station_name'),
  linemap: msg('network_map'),
  tv: msg('tv'),
  monitor: msg('monitor'),
  'traffic-light': msg('traffic_light'),
  'rail-signal': msg('rail_signal'),
  sign: msg('sign'),
  exit: msg('entrances'),
  escalator: msg('escalator'),
  walkway: msg('walkway'),
  stair: msg('stairs'),
  lift: msg('lift'),
  retail: msg('shop'),
  shop: msg('store'),
  booth: msg('ticket_booth'),
  'platform-edge': msg('platform_doors'),
  track: msg('track'),
}

/** Friendly names for a walled room's fit-out, keyed by `shop.cfg.kind`. */
const ROOM_KIND_LABELS: Record<string, string> = {
  store: msg('store'),
  toilet: msg('restroom'),
  office: msg('office'),
}

export function moduleLabel(type: string | Module, roomKind?: string): string {
  if (typeof type !== 'string') {
    if (type.type === 'fence') return type.cfg.variant === 'sound-barrier' ? msg('full_height_noise_barrier') : type.cfg.variant === 'sound-barrier-half' ? msg('half_height_noise_barrier') : type.cfg.variant === 'bridge-railing' ? msg('railing') : type.cfg.variant === 'gate' ? msg('door') : type.cfg.variant === 'iron' ? msg('iron_fence') : msg('glass_fence')
    return moduleLabel(type.type, type.type === 'shop' || type.type === 'booth' ? type.cfg.kind : undefined)
  }
  if (type === 'shop') return ROOM_KIND_LABELS[roomKind ?? 'store'] ?? MODULE_LABELS.shop
  if (type === 'booth' && roomKind === 'info') return msg('information_desk')
  if (type.startsWith('cctv-')) return MODULE_OPTIONS.find((m) => m.id === type)?.label ?? MODULE_LABELS.cctv
  if (type.startsWith('monitor-')) return MODULE_OPTIONS.find((m) => m.id === type)?.label ?? MODULE_LABELS.monitor
  return MODULE_LABELS[type] ?? MODULE_OPTIONS.find((m) => m.type === type)?.label ?? type
}

/**
 * Everything a hover ghost is drawn from: the piece being placed, its rotation,
 * and every Tab cycle — the stair and roof widths, the **run length** a 扶梯 or a
 * 单跑楼梯 is built at, the escalator direction, the 闸机's lane
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
    'roadWidth' | 'roadDirection' | 'railLineId' | 'railCatenaryStyle' | 'hangerLength' | 'curtainWidth' | 'curtainHeight' | 'psdEndHeight' | 'guideExitId' | 'bridgeLength' | 'bridgeRailing' | 'moduleType' | 'moduleRot' | 'lightPosition' | 'stairWidth' | 'stairBlockHeight' | 'pillarLength' | 'roofWidth' | 'roofPlateSnap' | 'escalatorDir' | 'escalatorWide' | 'rampLength' | 'escalatorSpan' | 'doubleRampLength' | 'liftInterval' | 'walkwayLength' | 'liftStyle' | 'gateDoor' | 'doorWide' | 'suspendedCeiling' | 'halfWall' | 'triangles' | 'triKind' | 'wallSnapCycle'
  >,
): string {
  return `${s.roadWidth}|${s.roadDirection}|${s.railLineId}|${s.railCatenaryStyle}|${s.hangerLength}|${s.curtainWidth}|${s.curtainHeight}|${s.psdEndHeight}|${s.guideExitId ?? ''}|${s.bridgeLength}|${s.bridgeRailing}|${s.moduleType}|${s.moduleRot}|${s.lightPosition}|${s.stairWidth}|${s.stairBlockHeight}|${s.pillarLength}|${s.roofWidth}|${s.roofPlateSnap}|${s.escalatorDir}|${s.escalatorWide}|${s.rampLength}|${s.escalatorSpan}|${s.doubleRampLength}|${s.liftInterval}|${s.walkwayLength}|${s.liftStyle}|${s.gateDoor}|${s.doorWide}|${s.suspendedCeiling}|${s.halfWall}|${s.triangles}|${s.triKind}|${s.wallSnapCycle}`
}
