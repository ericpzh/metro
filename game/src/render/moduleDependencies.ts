import { roadsOnlyChange } from '../sim/roads.ts'
import type { Cell, Module, StationData } from '../sim/types.ts'
import { isEdgeDecor, edgeDecorCurtainShare, moduleEnvelope, moduleFootprint } from '../sim/placement.ts'
import { hangerSupports } from '../sim/hangers.ts'
import { isSimInertDecorModule } from '../sim/decorInert.ts'
import { stairFlights } from '../sim/stairs.ts'

// These builders read module/metadata only. Changes to either fail closed below.
const CELL_INDEPENDENT = new Set<Module['type']>([
  'road', 'traffic-light', 'bench', 'fence', 'light', 'vent', 'bin', 'extinguisher', 'shelf', 'desk',
  'cubicle', 'sink', 'gate', 'platform-edge', 'billboard', 'tvm', 'vending',
  'door', 'glass', 'calligraphy', 'linemap', 'tactile', 'floor-mark',
  'ac-unit', 'electrical-cabinet', 'pillar', 'roof', 'track', 'exit', 'guidepost', 'busstop', 'psd-end',
])

/** The columns a cell-dependent builder reads. Height is intentionally unbounded:
 * hangers seek a slab, lifts discover stops, ramps inspect adjacent wall courses. */
function dependsOnCell(mod: Module, cell: Cell): boolean {
  if (CELL_INDEPENDENT.has(mod.type)) return false
  if (mod.type === 'shop') return cell.x >= mod.x - 1 && cell.x <= mod.x + mod.w
    && cell.y >= mod.y - 1 && cell.y <= mod.y + mod.h
  if (mod.type === 'stair' || mod.type === 'escalator' || mod.type === 'walkway' || mod.type === 'lift') {
    const box = moduleEnvelope(mod)
    if (!box || ![box.x0, box.x1, box.y0, box.y1].every(Number.isFinite)) return true
    let x0 = box.x0, x1 = box.x1, y0 = box.y0, y1 = box.y1
    if (mod.type === 'stair') for (const f of stairFlights(mod)) {
      x0 = Math.min(x0, f.from.x, f.to.x); x1 = Math.max(x1, f.from.x, f.to.x)
      y0 = Math.min(y0, f.from.y, f.to.y); y1 = Math.max(y1, f.from.y, f.to.y)
    }
    return cell.x >= x0 - 3 && cell.x <= x1 + 3 && cell.y >= y0 - 3 && cell.y <= y1 + 3
  }
  if (['sign', 'tv', 'clock', 'cctv', 'hanger'].includes(mod.type)) {
    return moduleFootprint(mod).some(([x, y]) => Math.abs(cell.x - x) <= 1 && Math.abs(cell.y - y) <= 1)
  }
  return true // A future builder must declare its dependencies before reuse.
}

/** §4.3/§5: retain only models whose inputs did not change. Artwork/language
 * invalidation is handled by the caller; module/neighbour edits take a full build
 * except for the road-only, stair-block-only and inert-decor-only edits below. */
export function retainedModuleIds(before: StationData, after: StationData): Set<string> {
  const retained = new Set<string>()
  if (!sameModuleMetadata(before, after)) {
    // A road changes road ink, never other equipment geometry. Keep routing
    // invalidation separate: roads still cut the pedestrian graph.
    // A stair-block addition only contributes its own stepped tile. It does not
    // change neighbouring module geometry, so keep every existing model and
    // build the new tile alone. This avoids rebuilding a large station's full
    // equipment catalogue for each block in a dragged stair-block patch.
    if (roadsOnlyChange(before, after)) {
      for (const mod of before.modules) if (mod.type !== 'road') retained.add(mod.id)
    } else if (onlyAddedStairBlocks(before, after)) {
      for (const mod of before.modules) retained.add(mod.id)
    } else {
      // Sim-inert decor (tactile stickers, wall panels, hanging fittings) draws
      // without walking: keep every untouched model and rebuild only the
      // changed tiles plus the neighbours that read them (tactile arms, hanger
      // suspensions). Functional pieces still fail closed above.
      for (const id of inertDecorRetainedIds(before, after)) retained.add(id)
    }
    return retained
  }
  const previous = new Map(before.cells.map(c => [`${c.x},${c.y},${c.z}`, c]))
  const changed: Cell[] = []
  for (const cell of after.cells) {
    const key = `${cell.x},${cell.y},${cell.z}`, old = previous.get(key)
    if (old !== cell && JSON.stringify(old) !== JSON.stringify(cell)) changed.push(cell)
    previous.delete(key)
  }
  changed.push(...previous.values())
  for (const mod of after.modules) if (!changed.some(cell => dependsOnCell(mod, cell))) retained.add(mod.id)
  return retained
}

function onlyAddedStairBlocks(before: StationData, after: StationData): boolean {
  if (before.cells.length !== after.cells.length) return false
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old !== next && JSON.stringify(old) !== JSON.stringify(next)) return false
  }
  const { cells: _beforeCells, modules: _beforeModules, ...beforeMetadata } = before
  const { cells: _afterCells, modules: _afterModules, ...afterMetadata } = after
  if (JSON.stringify(beforeMetadata) !== JSON.stringify(afterMetadata)) return false
  const afterById = new Map(after.modules.map((mod) => [mod.id, mod]))
  for (const mod of before.modules) {
    const next = afterById.get(mod.id)
    if (!next || (mod !== next && JSON.stringify(mod) !== JSON.stringify(next))) return false
    afterById.delete(mod.id)
  }
  const added = [...afterById.values()]
  return added.length > 0 && added.every((mod) => mod.type === 'stair' && mod.cfg.block === true)
}

/**
 * Retained models for a sim-inert decor-only module edit: every untouched
 * module except the neighbours that read the changed tiles. A tactile tile
 * extends arms into its four neighbours (`tactileArms`), and a roof hanger
 * lifts the fittings hung from its bar (`hangerSupports`); anything else draws
 * alone. Cells, lines and station fields must be identical — this answers only
 * the module diff, so the chunk skip is decided beside it. Empty when the edit
 * touches anything functional or moves a cell.
 */
function inertDecorRetainedIds(before: StationData, after: StationData): Set<string> {
  const retained = new Set<string>()
  if (before.cells.length !== after.cells.length) return retained
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old !== next && JSON.stringify(old) !== JSON.stringify(next)) return new Set<string>()
  }
  const { cells: _bc, modules: _bm, ...beforeMeta } = before
  const { cells: _ac, modules: _am, ...afterMeta } = after
  if (JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta)) return new Set<string>()
  const afterById = new Map(after.modules.map((mod) => [mod.id, mod]))
  const beforeById = new Map(before.modules.map((mod) => [mod.id, mod]))
  const changedIds = new Set<string>()
  const tactileCells = new Set<string>()
  const curtainNeighbours: Module[] = []
  const hangers: Module[] = []
  let changed = false
  for (const old of before.modules) {
    const next = afterById.get(old.id)
    if (!next) {
      if (!isSimInertDecorModule(old)) return new Set<string>()
      changed = true
      if (old.type === 'tactile') tactileCells.add(`${old.x},${old.y},${old.z}`)
      if (old.type === 'hanger') hangers.push(old)
      if (old.type === 'glass') curtainNeighbours.push(old)
      continue
    }
    if (old === next || JSON.stringify(old) === JSON.stringify(next)) continue
    if (!isSimInertDecorModule(old) || !isSimInertDecorModule(next)) return new Set<string>()
    changed = true
    changedIds.add(old.id)
    if (old.type === 'tactile' || next.type === 'tactile') {
      tactileCells.add(`${old.x},${old.y},${old.z}`)
      tactileCells.add(`${next.x},${next.y},${next.z}`)
    }
    if (old.type === 'hanger' || next.type === 'hanger') hangers.push(old, next)
    if (old.type === 'glass' || next.type === 'glass') curtainNeighbours.push(old, next)
  }
  for (const added of afterById.values()) {
    if (beforeById.has(added.id)) continue
    if (!isSimInertDecorModule(added)) return new Set<string>()
    changed = true
    if (added.type === 'tactile') tactileCells.add(`${added.x},${added.y},${added.z}`)
    if (added.type === 'hanger') hangers.push(added)
    if (added.type === 'glass') curtainNeighbours.push(added)
  }
  if (!changed) return retained
  const rebuild = new Set<string>(changedIds)
  const tactileKeys = [...tactileCells].map((key) => key.split(',').map(Number) as [number, number, number])
  for (const mod of after.modules) {
    if (changedIds.has(mod.id)) continue
    if (mod.type === 'tactile' && tactileKeys.some(([x, y, z]) => z === mod.z && Math.abs(x - mod.x) + Math.abs(y - mod.y) <= 1)) {
      rebuild.add(mod.id)
      continue
    }
    // An edge-decor piece backed against a curtain draws shifted towards its tile
    // centre, so adding/lifting a curtain rebuilds the furniture leaning on it.
    if (isEdgeDecor(mod) && curtainNeighbours.some((c) => edgeDecorCurtainShare(c, mod))) {
      rebuild.add(mod.id)
      continue
    }
    if ((mod.type === 'tv' || mod.type === 'clock' || mod.type === 'cctv' || mod.type === 'sign')
      && hangers.some((h) => h.type === 'hanger' && h.z === mod.z && hangerSupports(h, mod))) {
      rebuild.add(mod.id)
    }
  }
  for (const mod of after.modules) {
    if (rebuild.has(mod.id)) continue
    if (!beforeById.has(mod.id)) continue
    retained.add(mod.id)
  }
  return retained
}

export function sameModuleMetadata(before: StationData, after: StationData): boolean {
  const { cells: _a, ...a } = before, { cells: _b, ...b } = after
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The one 指示牌 whose printed boards changed, or null.
 *
 * A board edit — a drag, a stamp, a delete — changes no cell and no other
 * module, but `sameModuleMetadata` still fails closed on it, so every preview
 * step used to rebuild all module models and remesh every chunk. The chunks do
 * not read signs (the mesher works off cells plus ramp/wall derivations), so a
 * boards-only change rebuilds that one sign's model and repaints its plates,
 * and nothing else. Anything else that moved — a cell, a line, the station's
 * own fields, another module, a sign's mount, two signs at once — answers null
 * and takes the full rebuild.
 */
export function signBoardsOnlyChange(before: StationData, after: StationData): string | null {
  if (before.cells.length !== after.cells.length) return null
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old !== next && JSON.stringify(old) !== JSON.stringify(next)) return null
  }
  if (before.modules.length !== after.modules.length) return null
  // Lines included: a shield prints its line's colour and number, so a line
  // edit reprints every board and is not a boards-only change.
  const { cells: _bc, modules: _bm, ...beforeMeta } = before
  const { cells: _ac, modules: _am, ...afterMeta } = after
  if (JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta)) return null
  const previous = new Map(before.modules.map((m) => [m.id, m]))
  let changed: string | null = null
  for (const mod of after.modules) {
    const old = previous.get(mod.id)
    if (!old) return null
    if (old === mod || JSON.stringify(old) === JSON.stringify(mod)) continue
    // Exactly one sign, and only its two boards: a mount or booth change moves
    // the steel, not the print, and takes the full path with it.
    if (changed !== null || mod.type !== 'sign' || old.type !== 'sign') return null
    const { cfg: nextCfg, ...nextRest } = mod
    const { cfg: oldCfg, ...oldRest } = old
    if (JSON.stringify(nextRest) !== JSON.stringify(oldRest)) return null
    const { front: _nf, back: _nb, ...nextMount } = nextCfg
    const { front: _of, back: _ob, ...oldMount } = oldCfg
    if (JSON.stringify(nextMount) !== JSON.stringify(oldMount)) return null
    changed = mod.id
  }
  return changed
}
