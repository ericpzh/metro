// Render-only height of a head-house landing; graph nodes remain on their storey.
import { exitCoversCell } from '../../../sim/exits.ts'
import type { Module, Vec3i } from '../../../sim/types.ts'

export const EXIT_BASE_HEIGHT = 0.25

export function exitLandingHeight(modules: readonly Module[], p: Vec3i): number {
  return modules.some((m) => m.type === 'exit' && m.cfg.style !== 'doorway' && exitCoversCell(m, p.x, p.y, p.z)) ? EXIT_BASE_HEIGHT : 0
}
