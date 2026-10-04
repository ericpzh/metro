// The delete tool's same-type drag sweep (GAME-SPEC §9.5).
//
// Pointing at one piece of 设备 / 装饰 and holding the button, then dragging
// across its neighbours, collects every *matching* piece the pointer passes
// through — each one highlighted as it is crossed — and the release bulldozes
// the whole run as one edit, so a single undo puts it all back. The picking
// itself needs the 3D scene and stays in `Viewport.tsx`; everything here is the
// pure part: which pieces may be swept together, where the pointer travelled
// between two move events, and the bulk teardown.
//
// Pure data + `build/model.ts` helpers — no three, no DOM.

import type { Module } from '../sim/types.ts'
import { benchSpec } from '../sim/benches.ts'
import { billboardSpec } from '../sim/billboards.ts'
import { removeModule, type StationState } from '../build/model.ts'

/**
 * The free-standing equipment (设备) and 装饰 pieces a sweep may collect.
 *
 * Anything absent keeps its own teardown, and sweeping it would be wrong or
 * surprising: a room (商店 / 售票亭 / 商铺) folds its auto walls and fit-out
 * away, a 轨道 goes through the line manager so its line and derived 站台门
 * follow, an 出入口 frees its letter for reuse, an 楼梯 / 扶梯 / 电梯 is one
 * multi-storey structure rather than a row of loose pieces, a 站台门 is derived
 * from a track, and a 围栏 already drags out a straight run of its own.
 */
const SWEEP_TYPES: ReadonlySet<string> = new Set<string>([
  // 设备
  'gate',
  'tvm',
  'vending',
  'escalator',
  'lift',
  // 装饰
  'bench',
  'shelf',
  'desk',
  'cubicle',
  'sink',
  'billboard',
  'tv',
  'sign',
])

/**
 * The identity a sweep matches on, or null when the piece may not be swept.
 *
 * The palette variant is part of it, so a dragged 2 m bench does not take the
 * 1 m ones with it and a 16:9 广告牌 does not collect the portrait panels; a
 * legacy module with no variant reads as the palette default it is drawn as.
 * Rotation is deliberately *not* part of it — a row of gates may face both ways
 * and is still one row. `cfg.auto` is not either: a room's own fit-out is the
 * same piece as a hand-placed one.
 */
export function sweepFamily(mod: Module): string | null {
  if (!SWEEP_TYPES.has(mod.type)) return null
  // The variant tables are the one place a variant's width and look are
  // described, so the family key is read from them rather than from the module.
  if (mod.type === 'bench') return `bench:${benchSpec(mod.cfg.variant).variant}`
  if (mod.type === 'billboard') return `billboard:${billboardSpec(mod.cfg.variant).variant}`
  return mod.type
}

/** True when two modules are the same sweep target. */
export function sameSweepFamily(a: Module, b: Module): boolean {
  const family = sweepFamily(a)
  return family !== null && family === sweepFamily(b)
}

/** Pixel spacing of the drag-path samples that make "passed through" exact. */
export const SWEEP_STEP_PX = 6

/** Cap on samples per pointer move, so one long jump cannot stall a frame. */
export const SWEEP_MAX_SAMPLES = 24

/**
 * The pointer positions to test between two move events.
 *
 * A fast drag jumps several cells between events, so testing only the event
 * positions would miss a piece the pointer visibly crossed. Sampling the
 * straight segment — both ends, evenly spaced — is what makes "the pointer
 * passed through this piece" true rather than "a frame happened to land on it".
 * A jump longer than the cap is still sampled end to end, just coarser.
 */
export function sweepSamples(
  from: { x: number; y: number },
  to: { x: number; y: number },
  step = SWEEP_STEP_PX,
  max = SWEEP_MAX_SAMPLES,
): Array<{ x: number; y: number }> {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const span = Math.hypot(dx, dy)
  if (span <= step) return [{ x: to.x, y: to.y }]
  const n = Math.max(1, Math.min(max, Math.ceil(span / step)))
  const out: Array<{ x: number; y: number }> = []
  for (let i = 1; i <= n; i++) out.push({ x: from.x + (dx * i) / n, y: from.y + (dy * i) / n })
  return out
}

/**
 * Grow a sweep with the pieces the pointer crossed between two move events.
 *
 * `ids` is the pending list, the pressed piece first; it is mutated in place and
 * the count of newly collected pieces is returned (0 when the drag crossed
 * nothing new). `pick` is the viewport's `scene.pickModule` — the one part of
 * this that needs the 3D scene — so the rule itself ("sample the path, take only
 * the matching type, never twice") is exercised here rather than in the browser.
 */
export function sweepThrough(
  ids: string[],
  family: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pick: (clientX: number, clientY: number) => string | null,
  modules: readonly Module[],
): number {
  const pending = new Set(ids)
  let added = 0
  for (const p of sweepSamples(from, to)) {
    const id = pick(p.x, p.y)
    if (!id || pending.has(id)) continue
    const mod = modules.find((m) => m.id === id)
    // Only the same type joins: a drag across the gate line must not sweep up
    // the TVM standing at its end.
    if (!mod || sweepFamily(mod) !== family) continue
    pending.add(id)
    ids.push(id)
    added++
  }
  return added
}

/**
 * Bulldoze a swept list in one shot. The caller has already checked that every
 * id is a sweepable piece, so plain module removal is the right teardown for
 * each; folding them into one state keeps the whole run on a single undo step.
 */
export function removeSweptModules(state: StationState, ids: readonly string[]): StationState {
  let next = state
  for (const id of ids) next = removeModule(next, id)
  return next
}
