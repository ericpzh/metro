// Pointer-to-module resolution shared by equipment right-click teardown.
// A visible model wins over the grid cell behind it, which matters for wall and
// ceiling fixtures and for equipment above a rail trench.
import { moduleAt } from '../../sim/placement.ts'
import type { Module } from '../../sim/types.ts'

export function deletionTarget(
  modules: readonly Module[],
  pickedId: string | null,
  cell: [number, number, number],
  facing?: readonly [number, number],
): Module | undefined {
  return modules.find((module) => module.id === pickedId)
    ?? moduleAt(modules, cell[0], cell[1], cell[2], facing)
}
