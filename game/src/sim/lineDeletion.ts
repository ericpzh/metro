import type { Module } from './types.ts'

/**
 * Pieces a **right-drag line delete** may lift, one commit and one undo.
 *
 * It is deliberately narrower than `removeModule`: this sweep removes the loose
 * 装饰 / 设备 pieces a player can point at and delete one by one, so the bulk
 * gesture must not silently take a multi-storey structure (a 楼梯 / 扶梯 /
 * 电梯), a room (whose auto walls and fit-out fold with it), a rail or its
 * derived screen, an 出入口 (whose letter and floor pad are derived), or a
 * surface tile whose own tool owns the rectangle (`人行道` / `草坪` / `盲道` /
 * `道路`). A 屋顶 and a 球场 are structures too.
 *
 * A 支柱 and a 球场 **are** sweepable: the line can lay them, so the same line
 * lifts them. Pillars keep their `removeModule` teardown (bridge-pier ownership
 * and inscriptions) — `EquipmentTool` routes that case through the owning
 * teardown instead of the plain list filter.
 *
 * Everything else — benches, counters, gates, TVMs, trees, fences, signs,
 * lights, cameras, billboards, screens, pillars and courts — sweeps.
 */
export function isLineDeletable(mod: Module): boolean {
  return !LINE_DELETE_EXCLUDED.has(mod.type)
}

/** Types the line sweep leaves to their own teardown; see `isLineDeletable`. */
const LINE_DELETE_EXCLUDED: ReadonlySet<string> = new Set([
  'shop',
  'booth',
  'retail',
  'track',
  'platform-edge',
  'exit',
  'stair',
  'escalator',
  'walkway',
  'lift',
  'roof',
  'road',
  'tactile',
  'sidewalk',
  'lawn',
])
