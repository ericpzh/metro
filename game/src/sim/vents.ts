import { storeyBand } from './constants.ts'
import type { Module } from './types.ts'

export type VentModule = Extract<Module, { type: 'vent' }>
export const VENT_WIDTH = 0.7
export const VENT_DEPTH = 0.06
export function ventCeilingZ(m: VentModule): number {
  if (m.ceilingAnchored) return m.z + 1
  return storeyBand(m.z,0,m.storeyHeight??5)+(m.storeyHeight??5)
}
