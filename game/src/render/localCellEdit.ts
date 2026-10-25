import { groundWindow } from '../sim/ground.ts'
import { packKey, type Cell, type Module, type StationData } from '../sim/types.ts'

export interface LocalCellEdit { removed: Cell[]; added: Cell[] }
const cache = new WeakMap<readonly Module[], WeakMap<readonly Cell[], WeakMap<readonly Cell[], LocalCellEdit | null>>>()

/** Bounded cell-only edit inside the existing street window. Unknown structural
 * changes deliberately use the ordinary preparation path. Shared by tool and
 * renderer caches, so comparing the immutable documents is done once. */
export function localCellEdit(before: StationData, after: StationData): LocalCellEdit | null {
  if (before.modules !== after.modules || before.levelBase !== after.levelBase ||
    before.storeyHeight !== after.storeyHeight || before.cells === after.cells) return null
  let documents=cache.get(before.modules)
  if(!documents)cache.set(before.modules,documents=new WeakMap())
  let entries = documents.get(before.cells)
  if (entries?.has(after.cells)) return entries.get(after.cells)!
  if (!entries) documents.set(before.cells, entries = new WeakMap())
  const compute = (): LocalCellEdit | null => {
    if (Math.abs(before.cells.length-after.cells.length)>256) return null
    const a=groundWindow(before.cells,before.modules),b=groundWindow(after.cells,after.modules)
    if(a.x0!==b.x0||a.x1!==b.x1||a.y0!==b.y0||a.y1!==b.y1)return null
    // Build, delete and paint retain the surrounding records. Recognise the
    // changed span without allocating a station-wide coordinate map.
    let prefix=0,suffix=0
    const common=Math.min(before.cells.length,after.cells.length)
    while(prefix<common&&before.cells[prefix]===after.cells[prefix])prefix++
    while(suffix<common-prefix&&before.cells[before.cells.length-1-suffix]===after.cells[after.cells.length-1-suffix])suffix++
    if(before.cells.length+after.cells.length-2*(prefix+suffix)<=256){
      const removed=before.cells.slice(prefix,before.cells.length-suffix),added=after.cells.slice(prefix,after.cells.length-suffix)
      return [...removed,...added].some(c=>c.z===0)?null:{removed,added}
    }
    const old=new Map(before.cells.map(c=>[packKey(c.x,c.y,c.z),c]))
    const removed: Cell[]=[],added: Cell[]=[]
    for(const c of after.cells){
      const k=packKey(c.x,c.y,c.z),previous=old.get(k)
      if(previous!==c&&JSON.stringify(previous)!==JSON.stringify(c)){
        if(previous)removed.push(previous)
        added.push(c)
      }
      old.delete(k)
    }
    removed.push(...old.values())
    if(removed.length+added.length>256||[...removed,...added].some(c=>c.z===0))return null
    return {removed,added}
  }
  const result=compute();entries.set(after.cells,result);return result
}
