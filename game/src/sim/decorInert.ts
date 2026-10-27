// Sim-inert decor (§4.3, §5.7–5.8): modules that change neither the walk graph
// nor the street window, so a placement can skip routing rebuilds, chunk
// remeshes and station-wide plate repaints.
//
// `buildGraph` (sim/station.ts) only reads gates, booths, pillars, hanger posts,
// stair blocks, AC/cabinet bodies, fences, lifts, exits, machines, benches,
// shops, ramps, platform edges and tracks. Everything else here draws without
// walking: floor stickers, wall panels, hanging fittings, wayfinding furniture
// and street props, a 树木 included — planting is not structure, so the crowd
// walks through its tile rather than around a trunk the graph can only express
// by deleting the whole cell. TVM/vending/bench cabinets stay out — machines are
// trip stops and cabinet bodies are barriers — as do posts, pillars, screen ends
// and every non-decor type. Unknown future types fail closed.
import { groundWindow } from './ground.ts'
import type { Module, StationData } from './types.ts'

const INERT_TYPES: ReadonlySet<Module['type']> = new Set([
  'urinal', 'tactile', 'floor-mark', 'billboard', 'glass', 'calligraphy', 'linemap',
  'sign', 'tv', 'monitor', 'clock', 'cctv', 'light', 'vent', 'traffic-light', 'rail-signal',
  'guidepost', 'busstop', 'desk', 'checkout', 'bin',
  'extinguisher', 'sidewalk', 'lawn', 'tree',
])

/** True when this placed module never reaches the walk graph or street holes. */
export function isSimInertDecorModule(mod: Module): boolean {
  if (mod.type === 'hanger') return mod.cfg.mount === 'roof'
  return INERT_TYPES.has(mod.type)
}

/**
 * True when `after` differs from `before` only by inert decor modules: cells
 * byte-identical, station fields/lines untouched, every added/removed/changed
 * module inert on both sides, and the street window unmoved (a far-flung prop
 * that widens the generated plane still needs its ground and graph).
 */
export function isSimInertDecorEdit(before: StationData, after: StationData): boolean {
  if (before.cells.length !== after.cells.length) return false
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old !== next && JSON.stringify(old) !== JSON.stringify(next)) return false
  }
  const { cells: _bc, modules: _bm, ...beforeMeta } = before
  const { cells: _ac, modules: _am, ...afterMeta } = after
  if (JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta)) return false
  const afterById = new Map(after.modules.map((mod) => [mod.id, mod]))
  let changed = false
  for (const old of before.modules) {
    const next = afterById.get(old.id)
    if (!next) {
      if (!isSimInertDecorModule(old)) return false
      changed = true
      continue
    }
    afterById.delete(next.id)
    if (old === next || JSON.stringify(old) === JSON.stringify(next)) continue
    if (!isSimInertDecorModule(old) || !isSimInertDecorModule(next)) return false
    changed = true
  }
  for (const added of afterById.values()) {
    if (!isSimInertDecorModule(added)) return false
    changed = true
  }
  if (!changed) return false
  const beforeWindow = groundWindow(before.cells, before.modules)
  const afterWindow = groundWindow(after.cells, after.modules)
  return beforeWindow.x0 === afterWindow.x0 && beforeWindow.x1 === afterWindow.x1
    && beforeWindow.y0 === afterWindow.y0 && beforeWindow.y1 === afterWindow.y1
}
