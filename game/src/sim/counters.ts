import { msg } from './i18n.ts'
import { CHECKOUT_HEIGHT } from './constants.ts'
import { rotateLocal } from './track.ts'
import type { Module } from './types.ts'

export const COUNTER_LENGTHS = [1, 2, 3, 4] as const
export type CounterLength = typeof COUNTER_LENGTHS[number]
export function counterLength(value?: number): CounterLength {
  return COUNTER_LENGTHS.includes(value as CounterLength) ? value as CounterLength : 1
}
export const nextCounterLength = (value: number): CounterLength => COUNTER_LENGTHS[(COUNTER_LENGTHS.indexOf(counterLength(value)) + 1) % COUNTER_LENGTHS.length]!
export function counterLengthLabel(value: number): string {
  return msg((['short', 'medium', 'long', 'ultra_long'] as const)[counterLength(value) - 1]!)
}
export function counterCells(mod: Extract<Module, { type: 'checkout' }>): Array<[number, number, number]> {
  return Array.from({ length: counterLength(mod.w) }, (_, i) => {
    const [dx, dy] = rotateLocal(mod.rot, i, 0)
    return [mod.x + dx, mod.y + dy, mod.z]
  })
}

export const COUNTER_SPECS = {
  checkout: { label: msg('checkout'), height: CHECKOUT_HEIGHT },
  generic: { label: msg('store_counter'), height: 1.4 },
  cafe: { label: msg('cafe_counter'), height: 1.5 },
  'cafe-pastry': { label: msg('cafe_pastry_counter'), height: 1.5 },
} as const
export type CounterVariant = keyof typeof COUNTER_SPECS
export const COUNTER_VARIANTS = Object.keys(COUNTER_SPECS) as CounterVariant[]
export function counterVariant(value?: string): CounterVariant {
  return value && Object.hasOwn(COUNTER_SPECS, value) ? value as CounterVariant : 'checkout'
}
export const counterPaletteId = (value?: string): string => counterVariant(value) === 'checkout' ? 'checkout' : `checkout-${counterVariant(value)}`
export const counterSpec = (value?: string) => COUNTER_SPECS[counterVariant(value)]
