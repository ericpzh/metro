// Station-owned custom material colors for the 材质 palette. The finish id is
// the save format, so rebuilding this list from the document also restores it
// after opening a saved station without maintaining a second color history.

import { finishBaseId, finishDef, finishTint } from '../../sim/finishes.ts'
import type { FinishId } from '../../sim/types.ts'
import type { StationState } from '../../build/model.ts'

export function customPaintColoursInStation(
  station: Pick<StationState, 'cells' | 'modules'>,
  base: FinishId,
): number[] {
  const found = new Set<number>()
  const stockTint = finishDef(base).tint
  const defaultEnamelTint = finishDef('wall.enamel').tint
  const add = (finish: FinishId | undefined): void => {
    if (!finish || finishBaseId(finish) !== base) return
    const tint = finishTint(finish)
    if (tint !== null && tint !== stockTint && tint !== defaultEnamelTint) found.add(tint)
  }

  for (const cell of station.cells) {
    for (const finish of Object.values(cell.finish ?? {})) add(finish)
  }
  for (const module of station.modules) {
    if ('finish' in module.cfg) add(module.cfg.finish)
    if ('bridgeFinish' in module.cfg) add(module.cfg.bridgeFinish)
  }
  return [...found].sort((a, b) => a - b)
}
