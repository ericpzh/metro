import { msg } from './i18n.ts'
import { rotateLocal } from './track.ts'
import type { Module } from './types.ts'

// Floor-standing fire cabinets (§5.7). Drawing and clearance share these sizes.
export const EXTINGUISHER_SPECS = {
  standard: { label: msg('fire_cabinet_medium'), width: 0.743, depth: 0.534, height: 1.1, cells: 1 },
  compact: { label: msg('fire_cabinet_small'), width: 0.5, depth: 0.35, height: 0.5, cells: 1 },
  glass: { label: msg('fire_cabinet_large'), width: 1.5, depth: 0.5, height: 2, cells: 2 },
} as const

export type ExtinguisherVariant = keyof typeof EXTINGUISHER_SPECS

/** Cabinets in older saves retain the original steel housing. */
export function extinguisherVariant(value?: string): ExtinguisherVariant {
  return value && Object.hasOwn(EXTINGUISHER_SPECS, value) ? value as ExtinguisherVariant : 'standard'
}

export function extinguisherSpec(value?: string) {
  return EXTINGUISHER_SPECS[extinguisherVariant(value)]
}

export function extinguisherCells(mod: Extract<Module, { type: 'extinguisher' }>): Array<[number, number, number]> {
  return Array.from({ length: extinguisherSpec(mod.cfg.variant).cells }, (_, i) => {
    const [dx, dy] = rotateLocal(mod.rot, i, 0)
    return [mod.x + dx, mod.y + dy, mod.z]
  })
}
