import type { Cell } from './types.ts'
import { registerDocumentCache } from './documentCaches.ts'

interface Bounds { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
const SIZE = 16
const indexes = new WeakMap<readonly Cell[], Map<string, Cell[]>>()

function indexOf(cells: readonly Cell[]): Map<string, Cell[]> {
  let index = indexes.get(cells)
  if (!index) {
    index = new Map()
    for (const cell of cells) {
      const key = `${Math.floor(cell.x / SIZE)},${Math.floor(cell.y / SIZE)},${cell.z}`
      let bucket = index.get(key)
      if (!bucket) index.set(key, bucket = [])
      bucket.push(cell)
    }
    indexes.set(cells, index)
  }
  return index
}

/** First authored record at a coordinate, even when a legacy duplicate follows. */
export function firstAuthoredCell(cells: readonly Cell[], x: number, y: number, z: number): Cell | undefined {
  const matches = (c: Cell): boolean => c.x === x && c.y === y && c.z === z
  if (cells.length < 512) return cells.find(matches)
  return indexOf(cells).get(`${Math.floor(x / SIZE)},${Math.floor(y / SIZE)},${z}`)?.find(matches)
}

/** Exact authored occupancy, including fractional legacy probe positions. */
export function hasAuthoredSolid(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  const matches = (c: Cell): boolean => c.x === x && c.y === y && c.z === z
  if (cells.length < 512) return cells.some(c => c.fill === 'solid' && matches(c))
  return indexOf(cells).get(`${Math.floor(x / SIZE)},${Math.floor(y / SIZE)},${z}`)?.some(c => c.fill === 'solid' && matches(c)) ?? false
}

/** Immutable cells own a horizontal bucket index per metre of height (§4.3).
 * Roof slabs query only courses they intersect, rather than every floor below. */
export function* solidCellsInBounds(cells: readonly Cell[], box: Bounds): Iterable<Cell> {
  const index = indexOf(cells)
  const x0 = Math.floor(box.x0 / SIZE), x1 = Math.ceil(box.x1 / SIZE) - 1
  const y0 = Math.floor(box.y0 / SIZE), y1 = Math.ceil(box.y1 / SIZE) - 1
  const z0 = Math.floor(box.z0), z1 = Math.ceil(box.z1) - 1
  // Broad imported slabs should not enumerate a huge empty coordinate range.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > cells.length) {
    for (const cell of cells) if (cell.fill === 'solid') yield cell
    return
  }
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const bucket = index.get(`${x},${y},${z}`)
    if (bucket) for (const cell of bucket) if (cell.fill === 'solid') yield cell
  }
}

registerDocumentCache((cells, _modules, liveCells) => {
  if (cells !== liveCells) indexes.delete(cells)
})
