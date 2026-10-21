import type { Module } from './types.ts'
import { inCellOffset } from './inCellPositions.ts'
import { STOREY_HEIGHT, storeyBand } from './constants.ts'

export type LightModule = Extract<Module, { type: 'light' }>
export const LIGHT_DEPTH = 0.08
export function lightSpec(m: LightModule): { width: number; depth: number } {
  return m.cfg.variant === 'rectangular'
    ? (m.rot ?? 0) % 2 === 1 ? { width: 0.12, depth: 0.8 } : { width: 0.8, depth: 0.12 }
    : { width: 0.5, depth: 0.5 }
}
export function lightOffset(m: LightModule): { x: number; y: number } {
  const spec = lightSpec(m)
  return m.cfg.variant === 'rectangular' ? inCellOffset(m.cfg.position ?? 0, spec.width, spec.depth) : { x: 0, y: 0 }
}
export function lightCeilingZ(m: LightModule): number {
  if (m.ceilingAnchored) return m.z + 1
  return storeyBand(m.z, 0, STOREY_HEIGHT) + STOREY_HEIGHT
}
