import { exitFloorAt } from '../../sim/exits.ts'
import { hangerCells } from '../../sim/hangers.ts'
import { ceilingMountStandCell, hungCeilingAim, isCeilingHung, isWallMounted, wallMountFollowsCourse, wallMountStandCell } from '../../sim/placement.ts'
import type { Module, StationData } from '../../sim/types.ts'
import { isWallMountedType } from '../store/catalog.ts'
import type { HoverTile } from './ToolContext.ts'

/** The same surface anchor for a fresh palette piece and a carried module.
 * This only resolves aim; equipmentReason owns the support/refusal verdict. */
export function moduleAim(
  station: Pick<StationData, 'cells' | 'modules' | 'levelBase' | 'storeyHeight'>,
  piece: Module | string,
  hit: Pick<HoverTile, 'cell' | 'place' | 'solid'>,
): [number, number, number] {
  const type = typeof piece === 'string' ? piece : piece.type
  const mount = typeof piece === 'string' ? { type } : piece
  const wall = typeof piece === 'string' ? isWallMountedType(type) : isWallMounted(piece)
  if (wall) {
    const doorway = typeof piece === 'string' ? type.startsWith('exit-doorway-') : piece.type === 'exit' && piece.cfg.style === 'doorway'
    return wallMountStandCell(station.cells, hit.cell, hit.place, doorway,
      station.levelBase, wallMountFollowsCourse(mount), station.storeyHeight, station.modules)
  }
  if (isCeilingHung(mount)) {
    const stand = ceilingMountStandCell(hit.cell, hit.place, station.levelBase, station.cells, station.storeyHeight, station.modules)
    // A beam uses the actual floor anchor, which may sit between storey grid
    // lines. Resolve it before the general slab/empty-column ceiling aim;
    // equipmentReason still checks rod alignment and support at this anchor.
    const hangerProp = ['tv', 'tv-double', 'clock', 'cctv', 'cctv-ptz', 'cctv-dome', 'sign', 'sign-ceiling'].includes(type)
    if (hangerProp && station.modules.some(m => m.type === 'hanger' && m.z === stand[2]
      && hangerCells(m).some(([x, y]) => x === stand[0] && y === stand[1]))) return stand
    return type.startsWith('hanger')
      ? stand
      : hungCeilingAim(hit.cell, hit.place, station.levelBase, station.cells, station.modules, station.storeyHeight)
  }
  return hit.solid || exitFloorAt(station.modules, ...hit.cell) ? hit.cell : hit.place
}
