import { cellKey, thinWallSideMap, zoneFloorKeys } from '../build/model.ts'
import { populationEdit } from '../sim/populationEdit.ts'
import { withGround } from '../sim/ground.ts'
import type { StationData } from '../sim/types.ts'
import { isEquipmentModelEdit, signBoardsOnlyChange } from '../render/moduleDependencies.ts'

function geometryOf(data: StationData) {
  const ground = withGround(data.cells, data.modules)
  return {
    ground,
    solids: new Set(ground.filter(c => c.fill === 'solid').map(c => cellKey(c.x, c.y, c.z))),
    floors: zoneFloorKeys(ground),
    thins: thinWallSideMap(data.cells, data.modules),
  }
}

/** Tool occupancy and chunk geometry share the same invalidation contract (§9.5).
 * Machines, props and sign previews cannot change these sets inside an unchanged
 * street window. Keep them prepared until a structural or cell edit arrives. */
export class StationGeometry {
  private data: StationData | null = null
  private geometry: ReturnType<typeof geometryOf> | null = null

  resolve(data: StationData): ReturnType<typeof geometryOf> {
    if (!this.geometry || !this.data || (this.data !== data &&
      !(this.data.cells === data.cells && this.data.modules === data.modules) &&
      !populationEdit(this.data, data) &&
      !isEquipmentModelEdit(this.data, data) && signBoardsOnlyChange(this.data, data) === null)) {
      this.geometry = geometryOf(data)
    }
    this.data = data
    return this.geometry
  }
}
