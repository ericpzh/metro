// Bench variants — the 装饰 座椅 pieces, GAME-SPEC §5.7.
//
// A bench is a free-standing seat whose run is `w` cells along its local +x and
// whose look is one of two families: a plain stainless bench with no back (the
// platform bench) or an upholstered individual seat with a back and arm rests
// that chains into a row. This one table is shared by the builder (the module it
// creates), the placement/collision helpers, the renderer and the palette
// thumbnails, so a variant cannot describe itself differently in two places.
// Pure data — no three, no DOM.

import type { BenchVariant } from './types.ts'

export interface BenchSpec {
  variant: BenchVariant
  /** Palette label shown in the 装饰 sub-menu. */
  label: string
  /** Which family the model draws: a plain steel bench or a backed seat. */
  style: 'steel' | 'seat'
  /** Run length in cells along the module's local +x (1 m or 2 m). */
  w: number
}

export const BENCH_SPECS: Record<BenchVariant, BenchSpec> = {
  'steel-1': { variant: 'steel-1', label: '不锈钢 1m', style: 'steel', w: 1 },
  'steel-2': { variant: 'steel-2', label: '不锈钢 2m', style: 'steel', w: 2 },
  'seat-1': { variant: 'seat-1', label: '靠背 1m', style: 'seat', w: 1 },
  'seat-2': { variant: 'seat-2', label: '连排 2m', style: 'seat', w: 2 },
}

/** Every variant, in palette order. */
export const BENCH_VARIANTS: readonly BenchVariant[] = ['steel-1', 'steel-2', 'seat-1', 'seat-2']

/** The spec for a variant, defaulting to the 1 m steel bench for a legacy value. */
export function benchSpec(variant: BenchVariant | undefined): BenchSpec {
  return BENCH_SPECS[variant ?? 'steel-1'] ?? BENCH_SPECS['steel-1']
}
