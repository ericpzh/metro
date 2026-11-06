import { rotateLocal } from './track.ts'
import type { Module } from './types.ts'
import { msg } from './i18n.ts'
// Store fixtures (GAME-SPEC §5.7). One height for drawing and placement clearance.
export type ShelfVariant = keyof typeof SHELF_SPECS

export const SHELF_SPECS = {
  'dark-tall': { label: msg('dark_tall_shelf'), height: 1.9, depth: 0.5, levels: [0.18, 0.5, 0.82, 1.14, 1.46] },
  'white-tall': { label: msg('white_tall_shelf'), height: 1.9, depth: 0.5, levels: [0.18, 0.5, 0.82, 1.14, 1.46] },
  'white-short': { label: msg('white_low_shelf'), height: 1.25, depth: 0.5, levels: [0.18, 0.5, 0.82] },
  wire: { label: msg('mobile_wire_basket'), height: 1.6, depth: 0.5, levels: [0.16, 0.46, 0.76, 1.06] },
  cooler: { label: msg('white_cooler'), height: 2.05, depth: 0.66, levels: [0.25, 0.51, 0.8, 1.09, 1.38, 1.62] },
  'cooler-dark': { label: msg('dark_cooler'), height: 2.05, depth: 0.66, levels: [0.25, 0.51, 0.8, 1.09, 1.38, 1.62] },
  'clothing-rail': { label: msg('clothing_rail'), height: 1.65, depth: 0.6, levels: [] },
  'clothing-wall': { label: msg('clothing_wall'), height: 1.95, depth: 0.5, levels: [] },
  'clothing-table': { label: msg('clothing_table'), height: 1.05, depth: 0.8, levels: [] },
  'clothing-shoes': { label: msg('clothing_shoes'), height: 1.35, depth: 0.55, levels: [] },
  'food-snacks': { label: msg('food_snacks'), height: 1.65, depth: 0.55, levels: [] },
  'food-bakery': { label: msg('food_bakery'), height: 1.55, depth: 0.65, levels: [] },
  'ice-cream': { label: msg('ice_cream_freezer'), height: 0.98, depth: 0.8, levels: [] },
  'fruit-island': { label: msg('fruit_island'), height: 1.05, depth: 0.9, levels: [] },
  'fruit-tiered': { label: msg('fruit_tiered'), height: 1.5, depth: 0.65, levels: [] },
  'cafe-backbar': { label: msg('cafe_backbar_shelf'), height: 2.15, depth: 0.6, levels: [] },
  'cafe-backbar-2': { label: msg('cafe_backbar_medium'), height: 2.15, depth: 0.6, levels: [] },
  'cafe-backbar-4': { label: msg('cafe_backbar_extra_long'), height: 2.15, depth: 0.6, levels: [] },
  books: { label: msg('book_shelves'), height: 2.05, depth: .4, levels: [] },
  bags: { label: msg('bag_shelves'), height: 2.05, depth: .4, levels: [] },
} as const

export const SHELF_VARIANTS = Object.keys(SHELF_SPECS) as ShelfVariant[]

/** Old stores and saves retain the original tall dark gondola. */
export function shelfVariant(value?: string): ShelfVariant {
  return value && Object.hasOwn(SHELF_SPECS, value) ? value as ShelfVariant : 'dark-tall'
}

export function shelfSpec(value?: string) {
  return SHELF_SPECS[shelfVariant(value)]
}

export const shelfWidth = (variant?: string): number => variant === 'books' || variant === 'bags' || variant === 'cafe-backbar-2' ? 2 : variant === 'cafe-backbar-4' ? 4 : 1
export function shelfCells(m: Extract<Module, {type:'shelf'}>): Array<[number,number,number]> {
  return Array.from({length:shelfWidth(m.cfg.variant)}, (_,i) => {const [dx,dy]=rotateLocal(m.rot,i,0);return [m.x+dx,m.y+dy,m.z]})
}
