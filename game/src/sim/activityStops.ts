import type { Module } from './types.ts'
import { rotateLocal } from './track.ts'
import { benchSpec } from './benches.ts'
import { shelfSpec } from './shelves.ts'
import { edgeDecorCurtainOffset } from './placement.ts'

export interface ActivityStop {
  id: string
  moduleId?: string
  node: number
  kind: 'tvm' | 'vending' | 'bench' | 'retail' | 'shop' | 'booth' | 'shelf' | 'cubicle' | 'sink'
  /** Body root on the walk surface; yaw turns crowd local +x forward. */
  x?: number
  y?: number
  yaw?: number
  activity?: number
  duration?: number
  server?: number
  /** Explicit room trips remain valid, but offices/restroom shells are not shops. */
  publicShop?: boolean
}

/** Same local origins as PieceBuilder.placeLocal[AtEdge] and BenchModel. */
export function activityStopPlaces(mod: Module, modules: readonly Module[]): Omit<ActivityStop, 'node'>[] {
  let kind: ActivityStop['kind'], activity: number, duration: number, y: number, facing = -Math.PI / 2, slots = 1
  switch (mod.type) {
    case 'tvm': kind = mod.type; activity = 3; duration = 24; y = .2 - .75; facing = Math.PI / 2; break
    case 'vending': kind = mod.type; activity = 4; duration = 12; y = .15 - .75; facing = Math.PI / 2; break
    case 'shelf': kind = mod.type; activity = 2; duration = 18; y = .5 - shelfSpec(mod.cfg.variant).depth / 2 - .8; facing = Math.PI / 2; break
    case 'bench': kind = mod.type; activity = 1; duration = 45; y = .075 + .13; facing = Math.PI / 2; slots = benchSpec(mod.cfg.variant).w; break
    case 'cubicle': kind = mod.type; activity = 9; duration = 55; y = -.03; break
    case 'sink': kind = mod.type; activity = 10; duration = 16; y = .38; break
    default: return []
  }
  const [cx, cy] = ['tvm', 'vending', 'shelf'].includes(mod.type) ? edgeDecorCurtainOffset(modules, mod) : [0, 0]
  return Array.from({ length: slots }, (_, slot) => {
    const [dx, dy] = rotateLocal(mod.rot, slot, y)
    return { id: slot ? `${mod.id}:seat${slot}` : mod.id, moduleId: mod.id, kind, activity, duration,
      x: mod.x + .5 + dx + cx, y: mod.y + .5 + dy + cy, yaw: facing + (mod.rot ?? 0) * Math.PI / 2 }
  })
}
