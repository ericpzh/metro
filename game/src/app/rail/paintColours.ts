// Station-owned custom material colors for the 材质 palette. The finish id is
// the save format, so rebuilding this list from the document also restores it
// after opening a saved station without maintaining a second color history.

import { finishBaseId, finishDef, finishTint } from '../../sim/finishes.ts'
import type { FinishId } from '../../sim/types.ts'
import type { StationState } from '../../build/model.ts'

export function customPaintColoursInStation(
  station: Pick<StationState, 'cells' | 'modules'> | null | undefined,
  base: FinishId,
): number[] {
  if (!station) return []
  const found = new Set<number>()
  const stockTint = finishDef(base).tint
  const defaultEnamelTint = finishDef('wall.enamel').tint
  const add = (finish: FinishId | undefined): void => {
    if (!finish || finishBaseId(finish) !== base) return
    const tint = finishTint(finish)
    if (tint !== null && tint !== stockTint && tint !== defaultEnamelTint) found.add(tint)
  }

  for (const cell of station.cells) {
    const finishes = cell.finish
    if (!finishes) continue
    for (const side in finishes) add(finishes[side as keyof typeof finishes])
  }
  for (const module of station.modules) {
    if ('finish' in module.cfg) add(module.cfg.finish)
    if ('bridgeFinish' in module.cfg) add(module.cfg.bridgeFinish)
    if ('surfaceFinishes' in module.cfg && module.cfg.surfaceFinishes) {
      const sf = module.cfg.surfaceFinishes
      for (const key in sf) add(sf[key as keyof typeof sf])
    }
  }
  return [...found].sort((a, b) => a - b)
}
