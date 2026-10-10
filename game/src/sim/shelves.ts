// Store fixtures (GAME-SPEC §5.7). One height for drawing and placement clearance.
export type ShelfVariant = 'dark-tall' | 'white-tall' | 'white-short' | 'wire' | 'cooler' | 'cooler-dark'

export const SHELF_SPECS = {
  'dark-tall': { label: '深色高架', height: 1.9, depth: 0.5, levels: [0.18, 0.5, 0.82, 1.14, 1.46] },
  'white-tall': { label: '白色高架', height: 1.9, depth: 0.5, levels: [0.18, 0.5, 0.82, 1.14, 1.46] },
  'white-short': { label: '白色矮架', height: 1.25, depth: 0.5, levels: [0.18, 0.5, 0.82] },
  wire: { label: '移动网篮架', height: 1.6, depth: 0.5, levels: [0.16, 0.46, 0.76, 1.06] },
  cooler: { label: '白色冷柜', height: 2.05, depth: 0.66, levels: [0.25, 0.51, 0.8, 1.09, 1.38, 1.62] },
  'cooler-dark': { label: '深色冷柜', height: 2.05, depth: 0.66, levels: [0.25, 0.51, 0.8, 1.09, 1.38, 1.62] },
} as const

export const SHELF_VARIANTS = Object.keys(SHELF_SPECS) as ShelfVariant[]

/** Old stores and saves retain the original tall dark gondola. */
export function shelfVariant(value?: string): ShelfVariant {
  return value && Object.hasOwn(SHELF_SPECS, value) ? value as ShelfVariant : 'dark-tall'
}

export function shelfSpec(value?: string) {
  return SHELF_SPECS[shelfVariant(value)]
}
