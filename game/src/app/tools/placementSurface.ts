import { isCeilingHung, isOutdoorSurface } from '../../sim/placement.ts'
import type { Module, StationData } from '../../sim/types.ts'
import type { PickResult } from '../../render/scene.ts'

/** Preserve the visible surface's column instead of the terrain behind it.
 * A hanger's attachment anchor is its base, not the air cell inside its beam,
 * and a street finish is a tile 0.1 m thick whose drawn top face steps one
 * cell above its own anchor — a decor aimed at the pavement stands in the
 * tile's column, not on the air cell over it. Support, rod alignment and
 * collision remain the equipment validator's job. */
export function placementSurface(
  station: Pick<StationData, 'modules'>,
  piece: Module | string,
  hit: PickResult | null,
): PickResult | null {
  if (!hit?.moduleId) return hit
  const host = station.modules.find(m => m.id === hit.moduleId)
  if (!host) return hit
  // Only the top face steps a cell above the tile; a side hit keeps the usual
  // neighbour placement so pushing a finish against a wall still works.
  if (isOutdoorSurface(host) && hit.normal?.[2] === 1) {
    const cell: [number, number, number] = [hit.cell[0], hit.cell[1], host.z]
    return { ...hit, cell, place: cell }
  }
  const type = typeof piece === 'string' ? piece : piece.type
  if (host.type !== 'hanger' || !isCeilingHung(typeof piece === 'string' ? { type } : piece)
    || !['tv', 'clock', 'clock-digital', 'cctv', 'cctv-ptz', 'cctv-dome', 'sign', 'sign-ceiling'].includes(type)) return hit
  const cell: [number, number, number] = [Math.floor(hit.point[0]), Math.floor(hit.point[1]), host.z]
  return { ...hit, cell, place: [cell[0], cell[1], cell[2] + 1] }
}
