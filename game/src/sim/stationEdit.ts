import type { Cell, Module, StationData } from './types.ts'

interface ArrayEdit<T> {
  start: number
  remove: number
  insert: T[]
}

export interface StationEdit {
  fields: Omit<StationData, 'cells' | 'modules'>
  cells: ArrayEdit<Cell> | null
  modules: ArrayEdit<Module> | null
}

const MAX_EDIT_RECORDS = 4096

/** A bounded splice between immutable snapshots. Large or scattered edits use
 * the ordinary complete message rather than cloning most of an array twice. */
function arrayEdit<T>(before: readonly T[], after: readonly T[]): ArrayEdit<T> | null | undefined {
  if (before === after) return null
  const common = Math.min(before.length, after.length)
  let start = 0, suffix = 0
  while (start < common && before[start] === after[start]) start++
  while (suffix < common - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const remove = before.length - start - suffix
  const insert = after.length - start - suffix
  if (remove + insert > MAX_EDIT_RECORDS) return undefined
  return remove || insert ? { start, remove, insert: after.slice(start, start + insert) } : null
}

export function stationEdit(before: StationData, after: StationData): StationEdit | null {
  const cells = arrayEdit(before.cells, after.cells)
  if (cells === undefined) return null
  const modules = arrayEdit(before.modules, after.modules)
  if (modules === undefined) return null
  const { cells: _cells, modules: _modules, ...fields } = after
  return { fields, cells, modules }
}

export function applyStationEdit(before: StationData, edit: StationEdit): StationData {
  const apply = <T,>(records: T[], splice: ArrayEdit<T> | null): T[] =>
    splice ? records.slice(0, splice.start).concat(splice.insert, records.slice(splice.start + splice.remove)) : records
  return { ...edit.fields, cells: apply(before.cells, edit.cells), modules: apply(before.modules, edit.modules) }
}
