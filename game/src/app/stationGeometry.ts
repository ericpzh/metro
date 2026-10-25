import { cellKey, thinWallSideMap, zoneFloorKeys } from '../build/model.ts'
import { populationEdit } from '../sim/populationEdit.ts'
import { withGround } from '../sim/ground.ts'
import { packKey, type StationData } from '../sim/types.ts'
import { thinWallCells } from '../sim/openings.ts'
import { isEquipmentContentEdit, isEquipmentModelEdit, signBoardsOnlyChange } from '../render/moduleDependencies.ts'
import { localCellEdit } from '../render/localCellEdit.ts'

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
    const edit=this.data && this.geometry && localCellEdit(this.data,data)
    if(edit && this.geometry && this.data){
      // Generated pavement is unchanged. Keep its records and update only the
      // edited courses and the exposed floor immediately below them.
      const ground=data.cells.concat(this.geometry.ground.slice(this.data.cells.length))
      // These are the viewport's live derived indexes, never document records.
      // Updating them avoids copying the entire virtual street for one block.
      const solids=this.geometry.solids,floors=this.geometry.floors
      for(const c of edit.removed)solids.delete(cellKey(c.x,c.y,c.z))
      for(const c of edit.added)if(c.fill==='solid')solids.add(cellKey(c.x,c.y,c.z))
      const candidates=new Set([...edit.removed,...edit.added].flatMap(c=>[cellKey(c.x,c.y,c.z),cellKey(c.x,c.y,c.z-1)]))
      const numericCandidates=new Set([...edit.removed,...edit.added].flatMap(c=>[packKey(c.x,c.y,c.z),packKey(c.x,c.y,c.z-1)]))
      for(const k of candidates)floors.delete(k)
      const affected=data.cells.filter(c=>numericCandidates.has(packKey(c.x,c.y,c.z)))
      for(const c of [...edit.removed,...edit.added])if(c.z===1&&solids.has(cellKey(c.x,c.y,0))&&!affected.some(a=>a.x===c.x&&a.y===c.y&&a.z===0))
        affected.push({x:c.x,y:c.y,z:0,fill:'solid',zone:'outside'})
      for(const k of zoneFloorKeys(affected,solids))floors.add(k)
      const thins=this.geometry.thins
      for(const c of edit.removed)thins.delete(cellKey(c.x,c.y,c.z))
      for(const c of thinWallCells(edit.added,data.modules))thins.set(cellKey(c.x,c.y,c.z),c.shape)
      this.geometry={ground,solids,floors,thins}
      this.data=data
      return this.geometry
    }
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
