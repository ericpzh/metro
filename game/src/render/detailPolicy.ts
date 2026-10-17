import { levelSide } from './levelSlicing.ts'

export type GraphicsQuality = 'high' | 'low'
/** Hide UI is the presentation mode: visible geometry is always complete. */
export function detailHeight(levels: number[] | undefined, activeZ: number, hideUI: boolean, quality: GraphicsQuality, height: number): number {
  if (hideUI) return Infinity
  if (quality === 'low' || levelSide(levels, activeZ) !== 'active') return 0
  return height
}
