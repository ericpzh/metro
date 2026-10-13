// Drag-rectangle cell math, moved verbatim from app/Viewport.tsx.
// These are pure functions of the two pressed cells — no store, no scene — so
// every controller that previews or commits a rectangle shares them.

import { cellKey } from '../../../build/model/Cells.ts'
import { checkBlockCells } from '../../../build/validation.ts'
import type { PlacementDoc } from '../../../build/validation.ts'

/**
 * Narrow a drag rectangle to the cells it would actually **change**: the solid
 * blocks a remove drag is pending-delete, the empty cells a build drag is
 * pending-build. Cells already in the desired state are left out, so the
 * highlight reads as exactly "what this release will do".
 *
 * A build drag is narrowed by the one placement rule set (`checkBlockCells` →
 * `blockReason`), so a cell a 闸机 holds, a ramp's corridor or a rail's bed is not a
 * candidate at all — it is a **refusal** the preview draws in red, which is a
 * different question and is asked separately (`checkBlockCells` keeps both lists).
 *
 * The **station document** is what makes that judgement: at z = 0 the street is
 * implicit (`sim/ground.ts`), so an empty document would read every pothole in the
 * pavement as more pavement — a cell already the plane's is skipped, while a cell
 * the player dug is a candidate the release really will fill (`addCells`).
 */
export function pendingCells(
  cells: Array<[number, number, number]>,
  mode: 'add' | 'remove',
  solid: Set<string>,
  station: PlacementDoc = { cells: [], modules: [] },
): Array<[number, number, number]> {
  if (mode === 'remove') return cells.filter(([x, y, z]) => solid.has(cellKey(x, y, z)))
  return checkBlockCells(station, cells).acceptedCells
}

export function rectCells(a: [number, number, number], b: [number, number, number], z: number, line: boolean): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  if (line) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n
      out.push([Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), z])
    }
    return out
  }
  const x0 = Math.min(a[0], b[0])
  const x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1])
  const y1 = Math.max(a[1], b[1])
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, z])
  return out
}

/**
 * The 墙 tool's run: a straight axis-aligned line, never a diagonal. The drag
 * snaps to the dominant axis (ties go east–west), so a wall always slides
 * through a single 90° row or column.
 */
export function straightLineCells(a: [number, number, number], b: [number, number, number], z: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
    const x0 = Math.min(a[0], b[0])
    const x1 = Math.max(a[0], b[0])
    for (let x = x0; x <= x1; x++) out.push([x, a[1], z])
  } else {
    const y0 = Math.min(a[1], b[1])
    const y1 = Math.max(a[1], b[1])
    for (let y = y0; y <= y1; y++) out.push([a[0], y, z])
  }
  return out
}

export type TriSideAxis = 'x' | 'y'

/**
 * Which axis a 三角 run travels: its ridge — the axis the wedge is *not* cut
 * across — so a dragged line of them joins slope to slope as one smooth surface.
 * A wedge hugging e/w is cut across x, so its two triangular ends face s/n and
 * the run travels north–south (y); one hugging n/s travels east–west (x).
 */
export function triangleRidgeAxis(side: string): TriSideAxis {
  return side === 'e' || side === 'w' ? 'y' : 'x'
}

/**
 * A 三角 drag line: the straight run through `a` along the ridge of `side`,
 * extended toward `b`. Only the ridge axis is read off `b` — the other axis
 * stays on the anchor — so the drag can never turn the run across its own cut,
 * which is what would leave a step between slope and slope.
 */
export function triangleLineCells(
  a: [number, number, number],
  b: [number, number, number],
  z: number,
  side: string,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  if (triangleRidgeAxis(side) === 'x') {
    const x0 = Math.min(a[0], b[0])
    const x1 = Math.max(a[0], b[0])
    for (let x = x0; x <= x1; x++) out.push([x, a[1], z])
  } else {
    const y0 = Math.min(a[1], b[1])
    const y1 = Math.max(a[1], b[1])
    for (let y = y0; y <= y1; y++) out.push([a[0], y, z])
  }
  return out
}
