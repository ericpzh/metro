import type { Module } from '../sim/types.ts'

/** Explicit art dimensions leave the catalogue's placement defaults alone. */
export function captureRamp(module: Module, dimensions?: {rise: number; run: number}): Module {
  if (!dimensions || (module.type !== 'escalator' && module.type !== 'stair')) return module
  const {rise, run} = dimensions
  if (!(rise > 0 && run > 0 && Number.isFinite(rise) && Number.isFinite(run))) throw new Error('Invalid capture ramp dimensions')
  const from = module.from, dx = module.to.x - from.x, dy = module.to.y - from.y
  const length = Math.hypot(dx, dy)
  if (!(length > 0)) throw new Error('Invalid capture ramp direction')
  const to = {...from, x: from.x + dx / length * run, y: from.y + dy / length * run, z: from.z + rise}
  if (module.type === 'stair') return {...module, to, cfg: {...module.cfg, flights: [{from, to}]}}
  return {...module, to}
}
