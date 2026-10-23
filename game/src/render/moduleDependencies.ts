import { trackModelInputs, pillarModelInputs, hangerModelInputs, ceilingModelInputs, surfaceModelInputs, nearbyOpening, roadModelInputs } from './structuralModelInputs.ts'
import type { Cell, Module, StationData } from '../sim/types.ts'
import { isEdgeDecor, edgeDecorCurtainShare, curtainCornerJoin, curtainDoorShare, moduleEnvelope, moduleFootprint, outdoorSurfaceLift, isOutdoorSurface, isCeilingHung } from '../sim/placement.ts'
import { hangerSupports } from '../sim/hangers.ts'
import { isSimInertDecorModule } from '../sim/decorInert.ts'
import { stairFlights } from '../sim/stairs.ts'
import { trackCellAt, trackHeadroom } from '../sim/track.ts'
import { groundWindow } from '../sim/ground.ts'
import { fenceConnectionIndex } from '../sim/fences.ts'

// These pieces change equipment geometry and possibly pedestrian routing, but
// never carve floors or derive chunk walls. Keep this separate from sim-inert.
const EQUIPMENT_ONLY = new Set<Module['type']>([
  'bench', 'tvm', 'vending', 'gate', 'fence', 'ac-unit', 'electrical-cabinet', 'pillar', 'hanger', 'roof', 'booth', 'road', 'psd-end', 'walkway',
])
const STANDALONE = new Set<Module['type']>([
  'bench', 'tvm', 'vending', 'bin', 'extinguisher', 'shelf', 'desk', 'checkout', 'sink',
  'ac-unit', 'electrical-cabinet', 'booth', 'roof', 'door', 'calligraphy', 'linemap',
  'billboard', 'busstop', 'floor-mark', 'traffic-light', 'rail-signal', 'shop', 'tree',
])
const RAMPS = new Set<Module['type']>(['stair', 'escalator', 'walkway'])
const OPENINGS = new Set<Module['type']>(['stair', 'escalator', 'walkway', 'exit', 'track'])

function equal(a: unknown, b: unknown): boolean { return a === b || JSON.stringify(a) === JSON.stringify(b) }
function sameStationFields(before: StationData, after: StationData): boolean {
  const { cells: _bc, modules: _bm, ...a } = before
  const { cells: _ac, modules: _am, ...b } = after
  return equal(a, b)
}
function changedModules(before: StationData, after: StationData): Module[] {
  const previous = new Map(before.modules.map(m => [m.id, m]))
  const changed: Module[] = []
  for (const mod of after.modules) {
    const old = previous.get(mod.id)
    if (!equal(old, mod)) { if (old) changed.push(old); changed.push(mod) }
    previous.delete(mod.id)
  }
  changed.push(...previous.values())
  return changed
}

/** Chunk-only classification. Functional equipment must still reach the worker. */
export function isEquipmentContentEdit(before: StationData, after: StationData): boolean {
  if (!sameStationFields(before, after) || !equal(before.cells, after.cells)) return false
  const changed = changedModules(before, after)
  if (!changed.length || changed.some(m => !isSimInertDecorModule(m) && !EQUIPMENT_ONLY.has(m.type))) return false
  return true
}

export function isEquipmentModelEdit(before: StationData, after: StationData): boolean {
  return isEquipmentContentEdit(before, after) && equal(groundWindow(before.cells, before.modules), groundWindow(after.cells, after.modules))
}

// These builders read module/metadata only. Changes to either fail closed below.
const CELL_INDEPENDENT = new Set<Module['type']>([
  'sidewalk', 'lawn', 'tree', 'road', 'traffic-light', 'bench', 'fence', 'light', 'vent', 'bin', 'extinguisher', 'shelf', 'desk',
  'cubicle', 'sink', 'gate', 'platform-edge', 'billboard', 'tvm', 'vending',
  'door', 'glass', 'calligraphy', 'linemap', 'tactile', 'floor-mark',
  'ac-unit', 'electrical-cabinet', 'pillar', 'roof', 'exit', 'guidepost', 'busstop', 'psd-end',
])

/** The columns a cell-dependent builder reads. Height is intentionally unbounded:
 * hangers seek a slab, lifts discover stops, ramps inspect adjacent wall courses. */
function dependsOnCell(mod: Module, cell: Cell): boolean {
  if (isOutdoorSurface(mod)) return cell.x === mod.x && cell.y === mod.y && cell.z === mod.z
  if (mod.type === 'track') return mod.cfg.power === 'catenary' &&
    cell.z > mod.z + 1 && cell.z <= mod.z + trackHeadroom(mod) + 1 &&
    trackCellAt(mod, cell.x, cell.y, mod.z)
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
 * invalidation is handled by the caller. Module edits keep every unchanged model
 * whose declared cell and neighbour inputs remain intact. */
export function retainedModuleIds(before: StationData, after: StationData): Set<string> {
  const retained = new Set<string>()
  if (!sameModuleMetadata(before, after)) {
    // A stair-block addition only contributes its own stepped tile. It does not
    // change neighbouring module geometry, so keep every existing model and
    // build the new tile alone. This avoids rebuilding a large station's full
    // equipment catalogue for each block in a dragged stair-block patch.
    if (onlyAddedStairBlocks(before, after)) {
      for (const mod of before.modules) retained.add(mod.id)
    } else {
      for (const id of equipmentRetainedIds(before, after)) retained.add(id)
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
 * Rendering dependencies are independent of simulation routing. A machine can
 * change the walk graph while only its own model changes. Coupled models declare
 * their neighbours below; unknown builders and changed station fields fail closed.
 */
function equipmentRetainedIds(before: StationData, after: StationData): Set<string> {
  const retained = new Set<string>()
  if (!sameStationFields(before, after)) return retained
  const afterById = new Map(after.modules.map((mod) => [mod.id, mod]))
  const beforeById = new Map(before.modules.map((mod) => [mod.id, mod]))
  const changes = changedModules(before, after)
  const types = new Set(changes.map(m => m.type))
  // A future module may introduce another dependency: declare it before reuse.
  const known = (m: Module): boolean => CELL_INDEPENDENT.has(m.type) || STANDALONE.has(m.type)
    || ['track', 'stair', 'escalator', 'walkway', 'lift', 'hanger', 'clock', 'cctv', 'monitor', 'sign', 'tv'].includes(m.type)
  if (changes.some(m => !known(m))) return retained
  const cellChanges: Cell[] = []
  if (before.cells !== after.cells) {
    const cells = new Map(before.cells.map(c => [`${c.x},${c.y},${c.z}`, c]))
    for (const cell of after.cells) {
      const key = `${cell.x},${cell.y},${cell.z}`
      if (!equal(cells.get(key), cell)) cellChanges.push(cell)
      cells.delete(key)
    }
    cellChanges.push(...cells.values())
  }
  const adjacent = (a: Module, b: Module): boolean => a.z === b.z && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1
  const openingChanged = [...types].some(t => OPENINGS.has(t))
  const rampChanged = [...types].some(t => RAMPS.has(t))
  const fenceBefore = rampChanged ? fenceConnectionIndex(before.modules) : null
  const fenceAfter = rampChanged ? fenceConnectionIndex(after.modules) : null
  for (const mod of after.modules) {
    if (!equal(beforeById.get(mod.id), afterById.get(mod.id))) continue
    if (!known(mod) || cellChanges.some(cell => dependsOnCell(mod, cell))) continue
    if (outdoorSurfaceLift(before.modules, mod) !== outdoorSurfaceLift(after.modules, mod)) continue
    // An edge-decor piece backed against a curtain draws shifted towards its tile
    // centre, so adding/lifting a curtain rebuilds the furniture leaning on it.
    if (isEdgeDecor(mod) && changes.some(c => c.type === 'glass' && edgeDecorCurtainShare(c, mod))) continue
    if (changes.some(h => h.type === 'hanger' && hangerSupports(h, mod))) continue
    if (isCeilingHung(mod) && openingChanged && !equal(ceilingModelInputs(before, mod), ceilingModelInputs(after, mod))) continue
    if (STANDALONE.has(mod.type)) { retained.add(mod.id); continue }
    if (mod.type === 'tactile' && changes.some(m => m.type === 'tactile' && adjacent(m, mod))) continue
    if ((mod.type === 'fence' || mod.type === 'gate') && changes.some(m => (m.type === 'fence' || m.type === 'gate') && adjacent(m, mod))) continue
    if (mod.type === 'fence' && fenceBefore && fenceAfter && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      fenceBefore.connects(mod.x + dx, mod.y + dy, mod.z, -dx, -dy) !== fenceAfter.connects(mod.x + dx, mod.y + dy, mod.z, -dx, -dy))) continue
    if (mod.type === 'cubicle' && changes.some(m => m.type === 'cubicle' && adjacent(m, mod))) continue
    if (mod.type === 'tv' && changes.some(m => m.type === 'tv' && m.x === mod.x && m.y === mod.y && m.z === mod.z)) continue
    if (mod.type === 'glass' && changes.some(m => (m.type === 'glass' && curtainCornerJoin(mod, m).length > 0)
      || (m.type === 'door' && curtainDoorShare(mod, m)))) continue
    if (mod.type === 'road' && types.has('road') && !equal(roadModelInputs(before, mod), roadModelInputs(after, mod))) continue
    if (mod.type === 'track' && (types.has('track') || types.has('platform-edge')) && !equal(trackModelInputs(before, mod), trackModelInputs(after, mod))) continue
    if (mod.type === 'platform-edge' && changes.some(m => m.id === mod.cfg.from)) continue
    if (mod.type === 'psd-end' && changes.some(m => m.id === mod.cfg.corner || m.id === mod.cfg.support)) continue
    if (mod.type === 'pillar' && types.has('track') && !equal(pillarModelInputs(before, mod), pillarModelInputs(after, mod))) continue
    if (mod.type === 'hanger' && mod.cfg.mount === 'roof' && types.has('roof') && !equal(hangerModelInputs(before, mod), hangerModelInputs(after, mod))) continue
    if ((RAMPS.has(mod.type) || mod.type === 'lift') && openingChanged && changes.some(m => OPENINGS.has(m.type) && nearbyOpening(mod, m))) continue
    if (isOutdoorSurface(mod) && openingChanged && !equal(surfaceModelInputs(before, mod), surfaceModelInputs(after, mod))) continue
    if (mod.type === 'exit' && changes.some(m => RAMPS.has(m.type) && nearbyOpening(mod, m))) continue
    if (mod.type === 'guidepost' && changes.some(m => m.id === mod.cfg.exitId)) continue
    retained.add(mod.id)
  }
  return retained
}

export function sameModuleMetadata(before: StationData, after: StationData): boolean {
  // Local edits preserve all unchanged module records. Check those identities
  // before serializing a whole demo's equipment on every placement.
  return sameStationFields(before, after) && (before.modules === after.modules ||
    (before.modules.length === after.modules.length && before.modules.every((mod, i) => equal(mod, after.modules[i]))))
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
