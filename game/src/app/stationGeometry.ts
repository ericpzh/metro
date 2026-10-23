import { cellKey, thinWallSideMap, zoneFloorKeys } from '../build/model.ts'
import { populationEdit } from '../sim/populationEdit.ts'
import { withGround } from '../sim/ground.ts'
import type { StationData } from '../sim/types.ts'
import { isEquipmentContentEdit, isEquipmentModelEdit, signBoardsOnlyChange } from '../render/moduleDependencies.ts'

function geometryOf(data: StationData, thins = thinWallSideMap(data.cells, data.modules)) {
  const ground = withGround(data.cells, data.modules)
  const solids = new Set(ground.filter(c => c.fill === 'solid').map(c => cellKey(c.x, c.y, c.z)))
  return {
    ground,
    solids,
    floors: zoneFloorKeys(ground, solids),
    thins,
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
      const thins = this.geometry && this.data && this.data.cells === data.cells && isEquipmentContentEdit(this.data, data)
        ? this.geometry.thins : undefined
      this.geometry = geometryOf(data, thins)
    }
    this.data = data
    return this.geometry
  }
}
