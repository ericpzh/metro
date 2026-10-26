import type { Cell } from '../sim/types.ts'
const comparisons = new WeakMap<readonly Cell[], WeakMap<readonly Cell[], readonly Cell[]>>()

/** Keep duplicate imported records in order: readers may use the first record,
 * the last, or the last explicit finish at a coordinate. Never normalize a save
 * while establishing whether its geometry inputs changed. */
export function changedCellRecords(before: readonly Cell[], after: readonly Cell[]): readonly Cell[] {
  if (before === after) return []
  let nextDocuments=comparisons.get(before)
  if(!nextDocuments)comparisons.set(before,nextDocuments=new WeakMap())
  const cached=nextDocuments.get(after)
  if(cached)return cached
  const bucket = (cells: readonly Cell[]): Map<string, Cell[]> => {
    const result = new Map<string, Cell[]>()
    for (const c of cells) {
      const key=`${c.x},${c.y},${c.z}`,list=result.get(key)
      if(list)list.push(c);else result.set(key,[c])
    }
    return result
  }
  const old=bucket(before),next=bucket(after),changed:Cell[]=[]
  const equal = (a: Cell, b: Cell): boolean => {
    if(a===b)return true
    const keys=Object.keys(a)
    if(keys.length!==Object.keys(b).length)return false
    const left=a as unknown as Record<string,unknown>,right=b as unknown as Record<string,unknown>
    // Ramp edits shallow-clone every cell and its optional finish. Most fields
    // retain primitive/reference equality; serialize only changed nested data.
    return keys.every(key=>left[key]===right[key] || JSON.stringify(left[key])===JSON.stringify(right[key]))
  }
  for(const [key,records] of old){
    const current=next.get(key)
    if(!current || records.length!==current.length || records.some((c,i)=>!equal(c,current[i]))) {
      changed.push(...records,...(current??[]))
    }
    next.delete(key)
  }
  for(const records of next.values())changed.push(...records)
  nextDocuments.set(after,changed)
  return changed
}
