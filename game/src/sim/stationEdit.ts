import type { Cell, Module, StationData } from './types.ts'

interface ArraySplice<T> {
  start: number
  remove: number
  insert: T[]
}

type ArrayEdit<T> = ArraySplice<T> | { ops: ArraySplice<T>[] }

export interface StationEdit {
  fields: Omit<StationData, 'cells' | 'modules'>
  cells: ArrayEdit<Cell> | null
  modules: ArrayEdit<Module> | null
}

const MAX_EDIT_RECORDS = 4096

/** A bounded splice or sparse patch between immutable snapshots. Large or
 * scattered edits use the ordinary complete message rather than cloning most
 * of an array twice. */
function arrayEdit<T>(before: readonly T[], after: readonly T[]): ArrayEdit<T> | null | undefined {
  if (before === after) return null
  const common = Math.min(before.length, after.length)
  let start = 0, suffix = 0
  while (start < common && before[start] === after[start]) start++
  while (suffix < common - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const remove = before.length - start - suffix
  const insert = after.length - start - suffix
  if (remove + insert <= MAX_EDIT_RECORDS) {
    return remove || insert ? { start, remove, insert: after.slice(start, start + insert) } : null
  }
  if (Math.abs(before.length - after.length) > MAX_EDIT_RECORDS) return undefined
  // Sparse in-place replacements (e.g., clearContactFinishes mid-array) plus
  // small insertions/deletions or a tail append/remove.
  const bEnd = before.length - suffix
  const aEnd = after.length - suffix
  const ops: ArraySplice<T>[] = []
  let i = start, j = start, budget = 0
  const pushOp = (opStart: number, opRemove: number, item?: T): boolean => {
    budget += opRemove + (item !== undefined ? 1 : 0)
    if (budget > MAX_EDIT_RECORDS) return false
    const last = ops.length > 0 ? ops[ops.length - 1] : undefined
    if (last && last.start + last.remove === opStart) {
      last.remove += opRemove
      if (item !== undefined) last.insert.push(item)
    } else {
      ops.push({ start: opStart, remove: opRemove, insert: item !== undefined ? [item] : [] })
    }
    return true
  }
  while (i < bEnd && j < aEnd) {
    if (before[i] === after[j]) { i++; j++; continue }
    if (i + 1 < bEnd && before[i + 1] === after[j]) {
      if (!pushOp(i, 1)) return undefined
      i++
    } else if (j + 1 < aEnd && before[i] === after[j + 1]) {
      if (!pushOp(i, 0, after[j])) return undefined
      j++
    } else {
      if (!pushOp(i, 1, after[j])) return undefined
      i++; j++
    }
  }
  if (i < bEnd) {
    const rem = bEnd - i
    budget += rem
    if (budget > MAX_EDIT_RECORDS) return undefined
    const last = ops.length > 0 ? ops[ops.length - 1] : undefined
    if (last && last.start + last.remove === i) last.remove += rem
    else ops.push({ start: i, remove: rem, insert: [] })
  }
  if (j < aEnd) {
    const ins = aEnd - j
    budget += ins
    if (budget > MAX_EDIT_RECORDS) return undefined
    const tail = after.slice(j, aEnd)
    const last = ops.length > 0 ? ops[ops.length - 1] : undefined
    if (last && last.start + last.remove === i) last.insert.push(...tail)
    else ops.push({ start: i, remove: 0, insert: tail })
  }
  if (ops.length === 0) return null
  return ops.length === 1 ? ops[0] : { ops }
}

export function stationEdit(before: StationData, after: StationData): StationEdit | null {
  const cells = arrayEdit(before.cells, after.cells)
  if (cells === undefined) return null
  const modules = arrayEdit(before.modules, after.modules)
  if (modules === undefined) return null
  const { cells: _cells, modules: _modules, ...fields } = after
  return { fields, cells, modules }
}

function applyArrayEdit<T>(records: T[], edit: ArrayEdit<T> | null): T[] {
  if (!edit) return records
  if (!('ops' in edit)) {
    return records.slice(0, edit.start).concat(edit.insert, records.slice(edit.start + edit.remove))
  }
  let delta = 0
  let inPlaceOnly = true
  for (const op of edit.ops) {
    delta += op.insert.length - op.remove
    if (op.remove !== op.insert.length && !(op.start === records.length && op.remove === 0)) {
      inPlaceOnly = false
    }
  }
  if (inPlaceOnly) {
    const out = records.slice()
    for (const op of edit.ops) {
      if (op.start === records.length && op.remove === 0) {
        for (let k = 0; k < op.insert.length; k++) out.push(op.insert[k])
      } else {
        for (let k = 0; k < op.insert.length; k++) out[op.start + k] = op.insert[k]
      }
    }
    return out
  }
  const out = new Array<T>(records.length + delta)
  let cursor = 0, write = 0
  for (const op of edit.ops) {
    for (let k = cursor; k < op.start; k++) out[write++] = records[k]
    for (let k = 0; k < op.insert.length; k++) out[write++] = op.insert[k]
    cursor = op.start + op.remove
  }
  for (let k = cursor; k < records.length; k++) out[write++] = records[k]
  return out
}

export function applyStationEdit(before: StationData, edit: StationEdit): StationData {
  return { ...edit.fields, cells: applyArrayEdit(before.cells, edit.cells), modules: applyArrayEdit(before.modules, edit.modules) }
}
