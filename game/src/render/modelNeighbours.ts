import { packKey, type Cell, type Module } from '../sim/types.ts'

const cellIndexes = new WeakMap<readonly Cell[], Map<number, Cell>>()

/** Tile previews share the floor-finish lookup instead of scanning each course. */
export function modelCellAt(cells: readonly Cell[], x: number, y: number, z: number): Cell | undefined {
  let index = cellIndexes.get(cells)
  if (!index) {
    index = new Map()
    for (const cell of cells) {
      const key = packKey(cell.x, cell.y, cell.z)
      if (!index.has(key)) index.set(key, cell)
    }
    cellIndexes.set(cells, index)
  }
  return index.get(packKey(x, y, z))
}

interface NeighbourIndex {
  ids: Set<string>
  byType: Map<Module['type'], Module[]>
  order: Map<Module, number>
  queries: Map<string, readonly Module[]>
}
const indexes = new WeakMap<readonly Module[], NeighbourIndex>()
const overlays = new WeakMap<readonly Module[], WeakMap<readonly Module[], Map<string, readonly Module[]>>>()
const EMPTY_MODULES: readonly Module[] = []

/** Geometry neighbours share the immutable station index; proposed pieces are
 * a small overlay, never a new station array that invalidates support caches. */
export function modelNeighbours(
  context: { data?: { modules: readonly Module[] }; previewCandidates?: readonly Module[] },
  ...types: Module['type'][]
): readonly Module[] {
  const modules = context.data?.modules ?? EMPTY_MODULES
  let index = indexes.get(modules)
  if (!index) {
    index = { ids: new Set(), byType: new Map(), order: new Map(), queries: new Map() }
    for (const module of modules) {
      index.ids.add(module.id); index.order.set(module, index.order.size)
      const list = index.byType.get(module.type) ?? []
      list.push(module); index.byType.set(module.type, list)
    }
    indexes.set(modules, index)
  }
  const key = types.join('|')
  let placed = index.queries.get(key)
  if (!placed) {
    placed = types.flatMap(type => index.byType.get(type) ?? []).sort((a, b) => index.order.get(a)! - index.order.get(b)!)
    index.queries.set(key, placed)
  }
  const proposed = context.previewCandidates
  if (!proposed?.length) return placed
  let documents = overlays.get(proposed)
  if (!documents) { documents = new WeakMap(); overlays.set(proposed, documents) }
  let queries = documents.get(modules)
  if (!queries) { queries = new Map(); documents.set(modules, queries) }
  const cached = queries.get(key)
  if (cached) return cached
  const candidates = proposed.filter(module => types.includes(module.type) && !index.ids.has(module.id))
  const result = candidates.length ? [...placed, ...candidates] : placed
  queries.set(key, result)
  return result
}
