import type { StationState } from '../build/model.ts'

/** Open at the lowest authored editing metre, starting at the station's basis. */
export function openingLevel(station: StationState): number {
  let z = station.levelBase
  for (const cell of station.cells) if (cell.z < z) z = cell.z
  // Wall artwork can have fractional internal anchors. The height control edits
  // whole metres, so those anchors must not become a fractional editing height.
  for (const module of station.modules) z = Math.min(z, Math.round(module.z))
  return z
}
