import type { Module } from '../../../sim/types.ts'
import { moduleFootprint } from '../../../sim/placement.ts'
import { signBoardsOf, signBoardsPanel } from '../../../sim/sign.ts'
import { TV_MODEL_WIDTH } from '../../../sim/tvs.ts'
import { rotateLocal } from '../../../sim/track.ts'

// The pure half of a line placement (§5.4 decor / equipment): which axis the
// drag follows, which way a piece wider than one tile turns to run with it, and
// the pitch the 间隔 setting becomes.
//
// The pitch is measured the way the player reads the tile: **empty blocks
// between pieces**, not the distance between anchors. A 3 m counter at 超短
// therefore repeats every 3 cells with no gap, and at 间隔 1 every 4 cells with
// exactly one empty cell between two counters — no overlap at 0, and no
// footprint-sized arithmetic for the player to do.

/** A cell coordinate, as the scene and drag tools spell it. */
export type LineCell = [number, number, number]
/** Which world axis a drag follows: 0 = x (east–west), 1 = y (north–south). */
export type LineAxis = 0 | 1

/**
 * The drag's axis, snapped to the dominant one; ties go east–west, matching
 * `straightLineCells` (the wall and fence runs' own rule).
 */
export function lineAxis(a: readonly [number, number, number], b: readonly [number, number, number]): LineAxis {
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1
}

/**
 * How many whole cells a set of built modules covers along `axis` — the size of
 * the footprint, not the distance between anchors.
 *
 * A **指示牌** and a **电视** are the pieces whose models are wider than their
 * saved footprint (a sign's board grows with its print; a TV's screen and bezel
 * are 1.56 m wide on a one-cell anchor). Their printed/drawn width is taken from
 * the same table the renderer uses, and only when that width axis really lies
 * along the drag — a screen seen edge-on still occupies one cell across.
 */
export function lineSpan(modules: readonly Module[], axis: LineAxis): number {
  let min = Infinity
  let max = -Infinity
  const add = (value: number): void => {
    if (value < min) min = value
    if (value > max) max = value
  }
  for (const module of modules) {
    for (const [x, y] of moduleFootprint(module)) add(axis === 0 ? x : y)
    const width = module.type === 'sign'
      ? signBoardsPanel(signBoardsOf(module.cfg)).w
      : module.type === 'tv' ? TV_MODEL_WIDTH : 0
    if (!(width > 1)) continue
    const [dx, dy] = rotateLocal(module.rot, 1, 0)
    const along = axis === 0 ? dx : dy
    if (!along) continue
    const origin = axis === 0 ? module.x : module.y
    add(origin)
    add(origin + Math.ceil(width - 1e-6) - 1)
  }
  if (!Number.isFinite(min)) return 1
  return max - min + 1
}

/**
 * Turn a piece whose footprint is not square so its **long axis runs with the
 * drag** — the "thing > 1 m tile follows the drag direction" rule. A square
 * piece (a 1 m tile, a 2 × 2 fixture) keeps the R rotation.
 *
 * The swap preserves the player's half-turn: rot 0 / 2 (the two faces along x)
 * become 1 / 3, and 1 / 3 become 0 / 2. Refusing to flip keeps a bench's back
 * on the side the player chose with R while the row still joins end to end.
 */
export function lineRunRotation(baseRot: number, axis: LineAxis, spanX: number, spanY: number): number {
  if (spanX === spanY) return baseRot
  const longAxis: LineAxis = spanX > spanY ? 0 : 1
  if (longAxis === axis) return baseRot
  const rot = ((baseRot % 4) + 4) % 4
  return (rot + (rot % 2 === 0 ? 1 : 3)) % 4
}

/**
 * The anchor pitch of a run: the piece's own footprint along the drag plus the
 * 间隔, in whole cells. Zero spacing on a 3 m piece is 3; on a 1 m tile, 1.
 */
export function lineStep(modules: readonly Module[], axis: LineAxis, spacing: number): number {
  return Math.max(1, Math.round(lineSpan(modules, axis) + Math.max(0, Math.round(spacing))))
}

/** How many anchors a directional run lays, without allocating them. */
export function lineAnchorCount(anchor: LineCell, target: LineCell, step: number): number {
  const pitch = Math.max(1, Math.round(step))
  const axis = lineAxis(anchor, target)
  return Math.floor(Math.abs(target[axis] - anchor[axis]) / pitch) + 1
}

/**
 * The anchors of a directional run, from the press cell toward the pointer:
 * one every `step` cells, the press cell first. It never sorts the span, so the
 * pressed piece is always the one under the pointer, and dragging west / north
 * keeps that same order (the fence run learned this the hard way).
 */
export function lineAnchors(anchor: LineCell, target: LineCell, step: number): LineCell[] {
  const pitch = Math.max(1, Math.round(step))
  const axis = lineAxis(anchor, target)
  const delta = target[axis] - anchor[axis]
  const direction = delta < 0 ? -1 : 1
  const count = Math.floor(Math.abs(delta) / pitch) + 1
  const out: LineCell[] = []
  for (let i = 0; i < count; i++) {
    const at = anchor[axis] + direction * i * pitch
    out.push(axis === 0 ? [at, anchor[1], anchor[2]] : [anchor[0], at, anchor[2]])
  }
  return out
}
