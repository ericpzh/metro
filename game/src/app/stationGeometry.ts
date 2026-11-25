import { cellKey, thinWallSideMap, zoneFloorKeys } from '../build/model.ts'
import { populationEdit } from '../sim/populationEdit.ts'
import { groundWindow, patchGround, resizeGround, withGround } from '../sim/ground.ts'
import { packKey, type StationData } from '../sim/types.ts'
import { thinWallCells } from '../sim/openings.ts'
import { isBridgeModelEdit, isEquipmentContentEdit, isEquipmentModelEdit, signBoardsOnlyChange } from '../render/moduleDependencies.ts'
import { localCellEdit } from '../render/localCellEdit.ts'
import { changedCellRecords } from '../render/cellChanges.ts'
import type { Cell } from '../sim/types.ts'

function geometryOf(data: StationData, thins = thinWallSideMap(data.cells, data.modules)) {
  const ground = withGround(data.cells, data.modules)
  const solids = new Set(ground.filter(c => c.fill === 'solid').map(c => cellKey(c.x, c.y, c.z)))
  return {
    ground,
    solids,
    floors: zoneFloorKeys(ground, solids, thins),
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
    const content=this.data!.cells===data.cells&&isEquipmentContentEdit(this.data!,data)
    const previousWindow=content?groundWindow(this.data!.cells,this.data!.modules):null
    const ground=previousWindow?resizeGround(data.cells,data.modules,this.geometry!.ground,previousWindow):withGround(data.cells,data.modules)
    if(previousWindow){
      const w=groundWindow(data.cells,data.modules)
      if(Number.isInteger(w.x0-previousWindow.x0)&&Number.isInteger(w.y0-previousWindow.y0)){
        // Resized street strips are beyond the old/new authored content plus
        // its margin. No authored floor above or below can change exposure here.
        const {solids,floors}=this.geometry!
        const outside=(c:Cell,b:typeof w)=>c.x<b.x0||c.x>b.x1||c.y<b.y0||c.y>b.y1
        for(let i=data.cells.length;i<this.geometry!.ground.length;i++){
          const c=this.geometry!.ground[i]
          if(outside(c,w)){const key=cellKey(c.x,c.y,c.z);solids.delete(key);floors.delete(key)}
        }
        for(let i=data.cells.length;i<ground.length;i++){
          const c=ground[i]
          if(outside(c,previousWindow)){const key=cellKey(c.x,c.y,c.z);solids.add(key);floors.add(key)}
        }
        return {ground,solids,floors,thins}
      }
    }
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
    for(const key of zoneFloorKeys(affected,solids,thins))floors.add(key)
    return {ground,solids,floors,thins}
  }

  resolve(data: StationData): ReturnType<typeof geometryOf> {
    const edit = this.data && this.geometry && localCellEdit(this.data, data)
    if (edit && this.geometry && this.data) {
      // Incrementally patch generated pavement for z === 0 authored transitions
      // and bounded ground-window changes instead of regenerating the street.
      const prevW = groundWindow(this.data.cells, this.data.modules)
      const { ground, removedGround, addedGround } = patchGround(
        data.cells,
        data.modules,
        this.geometry.ground,
        this.data.cells.length,
        prevW,
        edit.removed,
        edit.added,
      )
      // These are the viewport's live derived indexes, never document records.
      // Updating them avoids copying the entire virtual street for one block.
      const solids = this.geometry.solids, floors = this.geometry.floors, thins = this.geometry.thins
      for (const c of removedGround) {
        const k = cellKey(c.x, c.y, c.z)
        solids.delete(k)
        floors.delete(k)
      }
      for (const c of edit.removed) {
        const k = cellKey(c.x, c.y, c.z)
        solids.delete(k)
        thins.delete(k)
      }
      for (const c of addedGround) {
        const k = cellKey(c.x, c.y, c.z)
        solids.add(k)
        floors.add(k)
      }
      const editedKeys = new Set<number>()
      const numericCandidates = new Set<number>()
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      const addCandidate = (c: Cell): void => {
        editedKeys.add(packKey(c.x, c.y, c.z))
        numericCandidates.add(packKey(c.x, c.y, c.z))
        numericCandidates.add(packKey(c.x, c.y, c.z - 1))
        if (c.x < minX) minX = c.x
        if (c.x > maxX) maxX = c.x
        if (c.y < minY) minY = c.y
        if (c.y > maxY) maxY = c.y
        if (c.z - 1 < minZ) minZ = c.z - 1
        if (c.z > maxZ) maxZ = c.z
      }
      for (const c of edit.removed) addCandidate(c)
      for (const c of edit.added) addCandidate(c)
      for (const c of edit.removed) {
        floors.delete(cellKey(c.x, c.y, c.z))
        floors.delete(cellKey(c.x, c.y, c.z - 1))
      }
      for (const c of edit.added) {
        floors.delete(cellKey(c.x, c.y, c.z))
        floors.delete(cellKey(c.x, c.y, c.z - 1))
      }
      const affected: Cell[] = []
      const affectedEdited: Cell[] = []
      const affectedKeys = new Set<number>()
      if (numericCandidates.size > 0) {
        for (const c of data.cells) {
          if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY || c.z < minZ || c.z > maxZ) continue
          const pk = packKey(c.x, c.y, c.z)
          if (!numericCandidates.has(pk)) continue
          affected.push(c)
          affectedKeys.add(pk)
          if (editedKeys.has(pk)) {
            affectedEdited.push(c)
            if (c.fill === 'solid') solids.add(cellKey(c.x, c.y, c.z))
          }
        }
        const maybeAddVirtualGround = (c: Cell): void => {
          if (c.z !== 0 && c.z !== 1) return
          const pk0 = packKey(c.x, c.y, 0)
          if (affectedKeys.has(pk0) || !solids.has(cellKey(c.x, c.y, 0))) return
          affectedKeys.add(pk0)
          affected.push({ x: c.x, y: c.y, z: 0, fill: 'solid', zone: 'outside' })
        }
        for (const c of edit.removed) maybeAddVirtualGround(c)
        for (const c of edit.added) maybeAddVirtualGround(c)
      }
      for (const c of thinWallCells(affectedEdited, data.modules)) thins.set(cellKey(c.x, c.y, c.z), c.shape)
      for (const k of zoneFloorKeys(affected, solids, thins)) floors.add(k)
      this.geometry = { ground, solids, floors, thins }
      this.data = data
      return this.geometry
    }
    if (!this.geometry || !this.data || (this.data !== data &&
      !(this.data.cells === data.cells && this.data.modules === data.modules) &&
      !populationEdit(this.data, data) &&
      !isEquipmentModelEdit(this.data, data) && !isBridgeModelEdit(this.data, data) &&
      signBoardsOnlyChange(this.data, data) === null)) {
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
