// Wall snapping follows surrounding geometry; cut tiles use absolute directions.

import { halfWallRunSide, wallDirRot, wallSnap, type WallDir } from '../../../build/model.ts'
import type { Cell, CellShape, TriangleKind, WallSide } from '../../../sim/types.ts'
import { packKey } from '../../../sim/types.ts'

/**
 * Where the 墙 tool stands its next column for a pick, and which wall face it
 * takes there. The tool snaps by cell rather than by sub-cell geometry, so this
 * decides *where* the block goes and *which* edge it presents.
 */
export function wallSnapAt(
  hit: { cell: [number, number, number]; place: [number, number, number]; solid: boolean; point: readonly number[] },
  cells: readonly Cell[],
  cycle: number,
): { base: [number, number, number]; rot: number; dirs: WallDir[] } {
  const anchor = hit.solid ? hit.place : hit.cell
  const snap = wallSnap(cells, anchor, [hit.point[0], hit.point[1]], cycle)
  return { base: [snap.x, snap.y, snap.z], rot: wallDirRot(snap.dir), dirs: snap.dirs }
}

/**
 * The **半墙** side a run of wall columns takes: what **R** has stepped to, given
 * the faces the anchor's own geometry offers (`halfWallRunSide`). Null while the 墙
 * tool is laying full-block walls, which have no thickness to choose.
 *
 * This is the **墙** tool's reading, where `halfWall` is that tool's own mode. The
 * 方块 tool asks its own question — one piece, and a 三角 mode is not a 半墙 — through
 * `cutShapeFor` below.
 */
export function halfWallSideFor(line: Array<[number, number, number]>, open: readonly WallDir[], st: { halfWall: boolean; wallSnapCycle: number }): WallDir | null {
  return st.halfWall ? halfWallRunSide(line, open, st.wallSnapCycle) : null
}

/** What the 方块 tool's cut modes hold: which piece a click lays, and its shape. */
export interface CutMode {
  halfWall: boolean
  triangles: boolean
  triKind: TriangleKind
  wallSnapCycle: number
}

/**
 * The shape a **方块** click lays in a cut mode, or null when the tool is laying
 * whole blocks. One answer for the whole tool — the press, the drag, the rebuilt
 * hover ghost and the release all read it — so the piece that lands is the piece
 * the ghost drew.
 *
 * All cut pieces use absolute clockwise sides A=N, B=E, C=S, D=W.
 * Neighbours and pointer position never change the selected direction.
 */
export function cutShapeFor(_line: Array<[number, number, number]>, _open: readonly WallDir[], st: CutMode): CellShape | null {
  const side = (['n', 'e', 's', 'w'] as const)[((st.wallSnapCycle % 4) + 4) % 4]
  if (st.halfWall) return { kind: 'half', side }
  if (st.triangles) return { kind: 'triangle', triangle: st.triKind, side }
  return null
}

/**
 * The pending cells as the ghost's mesher wants them: a **半墙** is meshed half a
 * block thick and a **三角** as the wedge it tags, so the preview shows the piece
 * the release will lay and not a whole block. Undefined for a full wall, which the
 * mesher already draws as a block.
 */
export function thinGhost(cells: Array<[number, number, number]>, shape: CellShape | null): Map<number, CellShape> | undefined {
  if (shape === null) return undefined
  const out = new Map<number, CellShape>()
  for (const [x, y, z] of cells) out.set(packKey(x, y, z), shape)
  return out
}

/** The wall side a shape keeps, or null when it is not a 半墙. */
export function shapeWallSide(shape: CellShape | null): WallSide | null {
  return shape?.kind === 'half' ? shape.side : null
}
