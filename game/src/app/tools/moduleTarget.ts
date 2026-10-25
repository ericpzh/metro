import { isCeilingHung, moduleAt } from '../../sim/placement.ts'
import { STOREY_HEIGHT } from '../../sim/constants.ts'
import type { Module } from '../../sim/types.ts'

/** Hung fittings and a ramp's storey envelope include empty air above blocks.
 * Only a hit on the drawn surface may target these pieces for inspection or editing. */
function needsSurfaceHit(module: Module): boolean {
  return isCeilingHung(module) || (module.type === 'stair' && !module.cfg.block)
    || module.type === 'escalator' || module.type === 'walkway'
    || module.type === 'platform-edge' || module.type === 'psd-end'
}

/** Shared pointer target for selection, copying and teardown. Geometry hits
 * already respect occlusion; a coarse cell fallback must not resurrect a ramp or ceiling fitting
 * hidden by the block under the pointer. Outdoor tile/canopy priority is retained. */
export function moduleTarget(
  modules: readonly Module[],
  pickedId: string | null,
  cell: [number, number, number],
  facing?: readonly [number, number],
  levelBase = 0,
  storeyHeight = STOREY_HEIGHT,
): Module | undefined {
  const drawn = modules.find(module => module.id === pickedId)
  if (drawn && (drawn.type === 'roof' || needsSurfaceHit(drawn))) return drawn
  if (drawn && moduleAt([drawn], ...cell, facing, levelBase, storeyHeight)) return drawn
  return moduleAt(modules, ...cell, facing, levelBase, storeyHeight, module => !needsSurfaceHit(module)) ?? drawn
}
