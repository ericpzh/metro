import { PSD_BASE_DEPTH, PSD_WALL_OFFSET } from '../sim/constants.ts'
import { edgeCells, rotateLocal } from '../sim/track.ts'
import { packKey, type Module } from '../sim/types.ts'

export interface BlockInset { x0: number; x1: number; y0: number; y1: number }

/** §5.9: the PSD base owns the track-facing strip through the whole floor block. */
export function platformBlockInsets(modules: readonly Module[]): Map<number, BlockInset> {
  const result = new Map<number, BlockInset>()
  const edge = 0.5 + PSD_WALL_OFFSET - PSD_BASE_DEPTH / 2
  for (const mod of modules) {
    if (mod.type !== 'platform-edge' || mod.cfg.psd === 'none') continue
    const [dx, dy] = rotateLocal(mod.rot, 0, mod.cfg.side === 'right' ? 1 : -1)
    for (const [x, y, z] of edgeCells(mod)) {
      const key = packKey(x, y, z)
      const inset = result.get(key) ?? { x0: 0, x1: 1, y0: 0, y1: 1 }
      if (dx > 0) inset.x1 = Math.min(inset.x1, edge)
      if (dx < 0) inset.x0 = Math.max(inset.x0, 1 - edge)
      if (dy > 0) inset.y1 = Math.min(inset.y1, edge)
      if (dy < 0) inset.y0 = Math.max(inset.y0, 1 - edge)
      result.set(key, inset)
    }
  }
  return result
}
