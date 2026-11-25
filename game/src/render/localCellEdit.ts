import { groundWindow, type GroundBounds } from '../sim/ground.ts'
import { packKey, type Cell, type Module, type StationData } from '../sim/types.ts'
import { registerDocumentCache } from '../sim/documentCaches.ts'

export interface LocalCellEdit { removed: Cell[]; added: Cell[] }
const MAX_LOCAL_CELL_CHANGES = 256
const MAX_GROUND_DELTA_CELLS = 16_384
const cache = new WeakMap<readonly Module[], WeakMap<readonly Cell[], WeakMap<readonly Cell[], LocalCellEdit | null>>>()

function groundWindowDeltaArea(a: GroundBounds, b: GroundBounds): number {
  if (a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1) return 0
  if (
    !Number.isInteger(b.x0 - a.x0) || !Number.isInteger(b.x1 - a.x1) ||
    !Number.isInteger(b.y0 - a.y0) || !Number.isInteger(b.y1 - a.y1)
  ) return Infinity
  const areaA = Math.max(0, a.x1 - a.x0 + 1) * Math.max(0, a.y1 - a.y0 + 1)
  const areaB = Math.max(0, b.x1 - b.x0 + 1) * Math.max(0, b.y1 - b.y0 + 1)
  const ix0 = Math.max(a.x0, b.x0), ix1 = Math.min(a.x1, b.x1)
  const iy0 = Math.max(a.y0, b.y0), iy1 = Math.min(a.y1, b.y1)
  const inter = ix0 <= ix1 && iy0 <= iy1 ? (ix1 - ix0 + 1) * (iy1 - iy0 + 1) : 0
  return areaA + areaB - 2 * inter
}

/** Bounded cell-only edit, including z === 0 transitions and bounded street
 * window expansions/contractions. Unknown structural changes deliberately use
 * the ordinary preparation path. Shared by tool and renderer caches, so
 * comparing the immutable documents is done once. */
export function localCellEdit(before: StationData, after: StationData): LocalCellEdit | null {
  if (before.modules !== after.modules || before.levelBase !== after.levelBase ||
    before.storeyHeight !== after.storeyHeight || before.cells === after.cells) return null
  let documents = cache.get(before.modules)
  if (!documents) cache.set(before.modules, documents = new WeakMap())
  let entries = documents.get(before.cells)
  if (entries?.has(after.cells)) return entries.get(after.cells)!
  if (!entries) documents.set(before.cells, entries = new WeakMap())
  const compute = (): LocalCellEdit | null => {
    if (Math.abs(before.cells.length - after.cells.length) > MAX_LOCAL_CELL_CHANGES) return null
    const a = groundWindow(before.cells, before.modules), b = groundWindow(after.cells, after.modules)
    if (groundWindowDeltaArea(a, b) > MAX_GROUND_DELTA_CELLS) return null
    // Build, delete and paint retain the surrounding records. Recognise the
    // changed span without allocating a station-wide coordinate map.
    let prefix = 0, suffix = 0
    const common = Math.min(before.cells.length, after.cells.length)
    while (prefix < common && before.cells[prefix] === after.cells[prefix]) prefix++
    while (suffix < common - prefix && before.cells[before.cells.length - 1 - suffix] === after.cells[after.cells.length - 1 - suffix]) suffix++
    const pEnd = before.cells.length - suffix, nEnd = after.cells.length - suffix
    if (pEnd - prefix + (nEnd - prefix) <= MAX_LOCAL_CELL_CHANGES) {
      const removed = before.cells.slice(prefix, pEnd), added = after.cells.slice(prefix, nEnd)
      return { removed, added }
    }
    // Sparse in-place replacements (e.g. clearContactFinishes stripping a
    // covered face mid-array) plus a small tail append/remove avoid a 151k Map.
    {
      const removed: Cell[] = [], added: Cell[] = []
      let i = prefix, j = prefix, ok = true
      while (i < pEnd && j < nEnd) {
        const prev = before.cells[i], next = after.cells[j]
        if (prev === next) { i++; j++; continue }
        if (prev.x === next.x && prev.y === next.y && prev.z === next.z) {
          if (JSON.stringify(prev) !== JSON.stringify(next)) { removed.push(prev); added.push(next) }
          i++; j++
        } else if (i + 1 < pEnd && before.cells[i + 1] === next) {
          removed.push(prev); i++
        } else if (j + 1 < nEnd && prev === after.cells[j + 1]) {
          added.push(next); j++
        } else {
          ok = false; break
        }
        if (removed.length + added.length > MAX_LOCAL_CELL_CHANGES) { ok = false; break }
      }
      if (ok && pEnd - i + (nEnd - j) + removed.length + added.length <= MAX_LOCAL_CELL_CHANGES) {
        for (; i < pEnd; i++) removed.push(before.cells[i])
        for (; j < nEnd; j++) added.push(after.cells[j])
        return { removed, added }
      }
    }
    const old = new Map(before.cells.map(c => [packKey(c.x, c.y, c.z), c]))
    const removed: Cell[] = [], added: Cell[] = []
    for (const c of after.cells) {
      const k = packKey(c.x, c.y, c.z), previous = old.get(k)
      if (previous !== c && JSON.stringify(previous) !== JSON.stringify(c)) {
        if (previous) removed.push(previous)
        added.push(c)
      }
      old.delete(k)
    }
    removed.push(...old.values())
    if (removed.length + added.length > MAX_LOCAL_CELL_CHANGES) return null
    return { removed, added }
  }
  const result = compute(); entries.set(after.cells, result); return result
}

registerDocumentCache((_cells, modules, _liveCells, liveModules) => {
  if (modules !== liveModules) cache.delete(modules)
})
