import type { Module } from './types.ts'
import { rotateLocal } from './track.ts'

/** Mounting run shared by placement and the drawn panel (GAME-SPEC §5.7). */
export function monitorCells(m: Extract<Module, { type: 'monitor' }>): Array<[number, number, number]> {
  return Array.from({ length: m.cfg.mount === 'wall' ? 3 : 1 }, (_, i) => {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    return [m.x + dx, m.y + dy, m.z]
  })
}
