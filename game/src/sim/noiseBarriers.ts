import { bridgeBarrierTop } from './structures.ts'
import type { Module } from './types.ts'
import { PSD_WALL_OFFSET } from './constants.ts'
import { rotateLocal } from './track.ts'

export type NoiseBarrierVariant = 'bridge-railing' | 'sound-barrier-half' | 'sound-barrier'

/** Same edge of a floor tile as a screen door facing local -y. R selects its side. */
export function noiseBarrierOffset(rot: number | undefined): [number, number] {
  return rotateLocal(rot, 0, -PSD_WALL_OFFSET)
}

export function noiseBarrierVariant(mod: Extract<Module, { type: 'fence' }>): NoiseBarrierVariant | null {
  const variant = mod.cfg.variant
  return variant === 'bridge-railing' || variant === 'sound-barrier-half' || variant === 'sound-barrier' ? variant : null
}

export function noiseBarrierHeight(variant: NoiseBarrierVariant): number {
  return variant === 'bridge-railing' ? 0.74 : bridgeBarrierTop(variant) - 0.5
}
