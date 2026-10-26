import { cellKey, thinWallSideMap, zoneFloorKeys } from '../build/model.ts'
import { populationEdit } from '../sim/populationEdit.ts'
import { withGround } from '../sim/ground.ts'
import { packKey, type StationData } from '../sim/types.ts'
import { thinWallCells } from '../sim/openings.ts'
import { isEquipmentContentEdit, isEquipmentModelEdit, signBoardsOnlyChange } from '../render/moduleDependencies.ts'
import { localCellEdit } from '../render/localCellEdit.ts'
import { changedCellRecords } from '../render/cellChanges.ts'
import type { Cell } from '../sim/types.ts'

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

  /** Ground is still derived in full. Update occupancy and exposed-floor keys
   * from its exact membership delta and all changed authored records, including
   * duplicates, rather than reclassifying the entire street on every ramp edit. */
  private updateGeometry(data: StationData, thins: ReturnType<typeof thinWallSideMap>) {
    const ground=withGround(data.cells,data.modules)
    const candidates=new Map<number,Cell>()
    const add=(c:Cell)=>{
      for(let dz=-1;dz<=1;dz++)candidates.set(packKey(c.x,c.y,c.z+dz),{...c,z:c.z+dz})
    }
    for(const c of changedCellRecords(this.data!.cells,data.cells))add(c)
    // withGround emits generated pavement in ascending x/y order. Merge those
    // tails directly; a second full street map would cost more than the diff.
    const old=this.geometry!.ground
    let i=this.data!.cells.length,j=data.cells.length
    while(i<old.length||j<ground.length){
      const a=old[i],b=ground[j]
      if(!a){add(b);j++;continue}
      if(!b){add(a);i++;continue}
      if(a.x===b.x&&a.y===b.y){i++;j++;continue}
      if(a.x<b.x||a.x===b.x&&a.y<b.y){add(a);i++}
      else {add(b);j++}
    }
    const {solids,floors}=this.geometry!
    const affected:Cell[]=[]
    for(const c of candidates.values()){
      const key=cellKey(c.x,c.y,c.z);solids.delete(key);floors.delete(key)
    }
    for(const c of ground)if(candidates.has(packKey(c.x,c.y,c.z)))affected.push(c)
    for(const c of affected)if(c.fill==='solid')solids.add(cellKey(c.x,c.y,c.z))
    for(const key of zoneFloorKeys(affected,solids))floors.add(key)
    return {ground,solids,floors,thins}
  }

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
      const preparedThins=thins??thinWallSideMap(data.cells,data.modules)
      if(this.geometry&&this.data)this.geometry=this.updateGeometry(data,preparedThins)
      else {
        this.geometry=geometryOf(data,preparedThins)
      }
    }
    this.data = data
    return this.geometry
  }
}
