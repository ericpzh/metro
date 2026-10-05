// Wall-snap math shared by the 墙 tool and the 地基 tool's 半墙 mode, moved
// verbatim from app/Viewport.tsx. Snapping is a pure function of the surrounding
// geometry — the player's rotation is never an input, it is an *output* — so R
// can never leave the tool in a state where it refuses to snap.

import { halfWallRunSide, wallDirRot, wallSnap, type WallDir } from '../../../build/model.ts'
import type { Cell, WallSide } from '../../../sim/types.ts'
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
 */
export function halfWallSideFor(line: Array<[number, number, number]>, open: readonly WallDir[], st: { halfWall: boolean; wallSnapCycle: number }): WallDir | null {
  return st.halfWall ? halfWallRunSide(line, open, st.wallSnapCycle) : null
}

/**
 * The pending cells as the ghost's mesher wants them: a **半墙** run is meshed half
 * a block thick, so the preview shows the wall the release will lay and not a full
 * one. Undefined for a full wall, which the mesher already draws as a block.
 */
export function thinGhost(cells: Array<[number, number, number]>, side: WallDir | null): Map<number, WallSide> | undefined {
  if (side === null) return undefined
  const out = new Map<number, WallSide>()
  for (const [x, y, z] of cells) out.set(packKey(x, y, z), side)
  return out
}
