// Pointer-to-module resolution shared by equipment right-click teardown and the
// 删除 (B) tool: one rule, so a right-click and a B press cannot disagree about
// which piece is under the pointer.
//
// A drawn model wins over the grid cell behind it, which matters for wall and
// ceiling fixtures and for equipment above a rail trench — but only while that
// model really stands in the pointed cell. A ray can also land on a piece that
// belongs *elsewhere*: a 树木's alpha-tested canopy overhangs the paving beside
// it, and a raised 人行道 plate is hit a cell away from the block under the
// pointer, because the block pick reports the block and the plate stands 0.1 m
// above it. In both cases the player is pointing at the cell's own piece, which
// is exactly what the tile tools' right-click resolves (`pieceAt`), so a ray hit
// from another cell never steals the delete.
import { moduleAt } from '../../sim/placement.ts'
import type { Module } from '../../sim/types.ts'

export function deletionTarget(
  modules: readonly Module[],
  pickedId: string | null,
  cell: [number, number, number],
  facing?: readonly [number, number],
): Module | undefined {
  const drawn = modules.find((module) => module.id === pickedId)
  // A roof surface can be a storey above the terrain pick (Tanwei D's thin
  // plates at z=9 above the road). The visible slab owns the click, even when
  // the terrain cell behind it contains another module. Keep the cell-based
  // exception for overhanging trees and raised paving below.
  if (drawn?.type === 'roof') return drawn
  // The common case, and O(1): the model the ray drew occupies the pointed cell
  // itself, so it is the piece the player means — a wall panel or a hung fitting
  // included, because its own stand cell is the one the pointer is over.
  if (drawn && moduleAt([drawn], cell[0], cell[1], cell[2], facing)) return drawn
  // Otherwise the cell decides: the piece standing there is what the pointer is
  // on, and a ray that crossed a canopy or a neighbour's raised plate on the way
  // does not get to delete it. With the cell empty (`moduleAt` misses), a drawn
  // model is still the answer — it hangs above, or stands past, the cell.
  return moduleAt(modules, cell[0], cell[1], cell[2], facing) ?? drawn
}
