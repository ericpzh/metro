import { LEVEL_STEPS } from './constants.ts'
import type { Module } from './types.ts'

export type VentModule = Extract<Module, { type: 'vent' }>
export const VENT_WIDTH = 0.7
export const VENT_DEPTH = 0.06
export function ventCeilingZ(m: VentModule): number {
  return LEVEL_STEPS.find((z) => z > m.z) ?? m.z + 4
}
