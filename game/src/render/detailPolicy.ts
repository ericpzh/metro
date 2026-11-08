import { levelSide } from './levelSlicing.ts'

export type GraphicsQuality = 'high' | 'low'

/**
 * Above this many modules, 显示其他层 ghosts only the storeys next to the active
 * one. The ghost slice had no bound on document size at all, so a five-storey,
 * 76k-module station drew four extra storeys of structure and furniture by
 * default. The distant storeys keep nothing in the edit view; 隐藏UI still shows
 * the station whole.
 */
export const DENSE_STATION_MODULES = 20_000

/** True when the document is large enough to bound its distant ghost fixtures. */
export function isDenseStation(moduleCount: number): boolean {
  return moduleCount >= DENSE_STATION_MODULES
}

/** Low quality keeps reduced geometry in every view; Hide UI only disables storey-based reduction. */
export function detailHeight(levels: number[] | undefined, activeZ: number, hideUI: boolean, quality: GraphicsQuality, height: number): number {
  if (quality === 'low') return 0
  if (hideUI) return Infinity
  if (levelSide(levels, activeZ) !== 'active') return 0
  return height
}
