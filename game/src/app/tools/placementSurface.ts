import { isCeilingHung } from '../../sim/placement.ts'
import type { Module, StationData } from '../../sim/types.ts'
import type { PickResult } from '../../render/scene.ts'

/** Preserve the visible surface's column instead of the terrain behind it.
 * A hanger's attachment anchor is its base, not the air cell inside its beam.
 * Support, rod alignment and collision remain the equipment validator's job. */
export function placementSurface(
  station: Pick<StationData, 'modules'>,
  piece: Module | string,
  hit: PickResult | null,
): PickResult | null {
  if (!hit?.moduleId) return hit
  const host = station.modules.find(m => m.id === hit.moduleId)
  const type = typeof piece === 'string' ? piece : piece.type
  if (host?.type !== 'hanger' || !isCeilingHung(typeof piece === 'string' ? { type } : piece)
    || !['tv', 'clock', 'cctv', 'cctv-ptz', 'cctv-dome', 'sign', 'sign-ceiling'].includes(type)) return hit
  const cell: [number, number, number] = [Math.floor(hit.point[0]), Math.floor(hit.point[1]), host.z]
  return { ...hit, cell, place: [cell[0], cell[1], cell[2] + 1] }
}
