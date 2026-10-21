import { levelSide } from './levelSlicing.ts'

export type GraphicsQuality = 'high' | 'low'
/** Low quality keeps reduced geometry in every view; Hide UI only disables storey-based reduction. */
export function detailHeight(levels: number[] | undefined, activeZ: number, hideUI: boolean, quality: GraphicsQuality, height: number): number {
  if (quality === 'low') return 0
  if (hideUI) return Infinity
  if (levelSide(levels, activeZ) !== 'active') return 0
  return height
}
