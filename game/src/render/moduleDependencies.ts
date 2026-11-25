import { trackModelInputs, pillarModelInputs, hangerModelInputs, ceilingModelInputs, surfaceModelInputs, nearbyOpening, roadModelInputs, rampCellModelInputs } from './structuralModelInputs.ts'
import type { Cell, Module, StationData } from '../sim/types.ts'
import { isEdgeDecor, edgeDecorCurtainShare, curtainCornerJoin, curtainDoorShare, moduleEnvelope, moduleFootprint, outdoorSurfaceLift, isOutdoorSurface, isCeilingHung } from '../sim/placement.ts'
import { hangerSupports } from '../sim/hangers.ts'
import { isSimInertDecorModule } from '../sim/decorInert.ts'
import { stairFlights } from '../sim/stairs.ts'
import { trackCellAt, trackHeadroom } from '../sim/track.ts'
import { groundWindow } from '../sim/ground.ts'
import { fenceConnectionIndex } from '../sim/fences.ts'
import { localCellEdit } from './localCellEdit.ts'
import { changedCellRecords } from './cellChanges.ts'
import { exitLandingHeight } from '../sim/exitLanding.ts'
import { registerDocumentCache } from '../sim/documentCaches.ts'

// These pieces change equipment geometry and possibly pedestrian routing, but
// never carve floors or derive chunk walls. Keep this separate from sim-inert.
const EQUIPMENT_ONLY = new Set<Module['type']>([
  'bench', 'tvm', 'vending', 'gate', 'fence', 'court', 'ac-unit', 'electrical-cabinet', 'pillar', 'hanger', 'roof', 'booth', 'road', 'psd-end', 'walkway',
  'door', 'shelf', 'cubicle', 'sink', 'urinal', 'checkout',
])
const STANDALONE = new Set<Module['type']>([
  'bench', 'tvm', 'vending', 'bin', 'extinguisher', 'shelf', 'desk', 'checkout', 'sink', 'urinal',
  'court', 'ac-unit', 'electrical-cabinet', 'booth', 'roof', 'door', 'calligraphy', 'linemap',
  'billboard', 'busstop', 'floor-mark', 'traffic-light', 'rail-signal', 'shop', 'tree',
])
const RAMPS = new Set<Module['type']>(['stair', 'escalator', 'walkway'])
const OPENINGS = new Set<Module['type']>(['stair', 'escalator', 'exit', 'track'])
const isOpening=(m:Module):boolean=>OPENINGS.has(m.type)&&!(m.type==='stair'&&m.cfg.block)
const isRamp=(m:Module):boolean=>RAMPS.has(m.type)&&!(m.type==='stair'&&m.cfg.block)

function equal(a: unknown, b: unknown): boolean { return a === b || JSON.stringify(a) === JSON.stringify(b) }
function sameStationFields(before: StationData, after: StationData): boolean {
  const { cells: _bc, modules: _bm, ...a } = before
  const { cells: _ac, modules: _am, ...b } = after
  return equal(a, b)
}
const moduleChanges = new WeakMap<readonly Module[], WeakMap<readonly Module[], Module[]>>()
export function changedModules(before: StationData, after: StationData): readonly Module[] {
  if (before.modules === after.modules) return []
  let documents = moduleChanges.get(before.modules)
  if (!documents) moduleChanges.set(before.modules, documents = new WeakMap())
  const cached = documents.get(after.modules)
  if (cached) return cached
  const a = before.modules, b = after.modules
  const common = Math.min(a.length, b.length)
  let prefix = 0, suffix = 0
  while (prefix < common && a[prefix] === b[prefix]) prefix++
  while (suffix < common - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const aEnd = a.length - suffix, bEnd = b.length - suffix
  const changed: Module[] = []
  if (aEnd === prefix) {
    for (let j = prefix; j < bEnd; j++) changed.push(b[j])
  } else if (bEnd === prefix) {
    for (let i = prefix; i < aEnd; i++) changed.push(a[i])
  } else {
    const previous = new Map<string, Module>()
    for (let i = prefix; i < aEnd; i++) previous.set(a[i].id, a[i])
    for (let j = prefix; j < bEnd; j++) {
      const mod = b[j]
      const old = previous.get(mod.id)
      if (!equal(old, mod)) { if (old) changed.push(old); changed.push(mod) }
      previous.delete(mod.id)
    }
    for (const old of previous.values()) changed.push(old)
  }
  documents.set(after.modules, changed)
  return changed
}

/** Chunk-only classification. Functional equipment must still reach the worker. */
export function isEquipmentContentEdit(before: StationData, after: StationData): boolean {
  if (!sameStationFields(before, after) || before.cells.length !== after.cells.length) return false
  const changed = changedModules(before, after)
  if (!changed.length || changed.some(m => !isSimInertDecorModule(m) && !EQUIPMENT_ONLY.has(m.type) && !(m.type==='stair'&&m.cfg.block))) return false
  return before.cells === after.cells || before.cells.every((cell, i) => equal(cell, after.cells[i]))
}

export function isEquipmentModelEdit(before: StationData, after: StationData): boolean {
  return isEquipmentContentEdit(before, after) && equal(groundWindow(before.cells, before.modules), groundWindow(after.cells, after.modules))
}

/** A bridge deck and its supports affect rail/model occupancy, never block
 * cuts. Inside the same street window the prepared cell geometry survives. */
export function isBridgeModelEdit(before: StationData, after: StationData): boolean {
  if (before.cells !== after.cells || !sameStationFields(before, after)) return false
  const changes = changedModules(before, after)
  return changes.some(m => m.type === 'track') &&
    changes.every(m => m.type === 'pillar' || m.type === 'track' && m.cfg.bridge === true) &&
    equal(groundWindow(before.cells, before.modules), groundWindow(after.cells, after.modules))
}

/** A guidepost's geometry and ink are local to its root. Moving it must not
 * allocate and upload its unchanged canvases again. Unknown model kinds keep
 * their rebuild path; a changed label, binding or station field rebuilds too. */
export function movedGuidepostIds(before: StationData, after: StationData): Set<string> {
  const ids = new Set<string>()
  if (!sameStationFields(before, after)) return ids
  if(!changedModules(before,after).some(m=>m.type==='guidepost'))return ids
  const previous = new Map(before.modules.map(m => [m.id, m]))
  for (const mod of after.modules) {
    const old = previous.get(mod.id)
    if (mod.type !== 'guidepost' || old?.type !== 'guidepost' || old === mod) continue
    const { x: _ox, y: _oy, z: _oz, rot: _or, ...a } = old
    const { x: _nx, y: _ny, z: _nz, rot: _nr, ...b } = mod
    if (!equal(a, b)) continue
    const exit = (modules: readonly Module[]) => modules.find(m => m.id === mod.cfg.exitId && m.type === 'exit')
    const was = exit(before.modules), now = exit(after.modules)
    if (!!was !== !!now || was?.type === 'exit' && now?.type === 'exit' && was.cfg.name !== now.cfg.name) continue
    ids.add(mod.id)
  }
  return ids
}

/** Flat belts have no cell-dependent side walls or ramp seam infill. A pure
 * translation keeps their complete local geometry and running band phase when
 * both endpoint landing heights and the surface lift remain identical. */
export function translatedWalkwayIds(before:StationData,after:StationData):Set<string>{
  const ids=new Set<string>()
  if(before.cells!==after.cells||!sameStationFields(before,after))return ids
  if(!changedModules(before,after).some(m=>m.type==='walkway'))return ids
  if(before.modules.length!==after.modules.length||before.modules.some((m,i)=>m.id!==after.modules[i].id))return ids
  const previous=new Map(before.modules.map(m=>[m.id,m])),exitsBefore=before.modules.filter(m=>m.type==='exit'),exitsAfter=after.modules.filter(m=>m.type==='exit')
  for(const mod of after.modules){
    const old=previous.get(mod.id)
    if(mod.type!=='walkway'||old?.type!=='walkway'||mod===old)continue
    const {x:_x,y:_y,z:_z,from:_f,to:_t,...a}=old,{x:_nx,y:_ny,z:_nz,from:_nf,to:_nt,...b}=mod
    if(!equal(a,b))continue
    const dx=mod.x-old.x,dy=mod.y-old.y,dz=mod.z-old.z
    if(!(['from','to'] as const).every(end=>mod[end].x-old[end].x===dx&&mod[end].y-old[end].y===dy&&mod[end].z-old[end].z===dz&&
      exitLandingHeight(exitsBefore,old[end])===exitLandingHeight(exitsAfter,mod[end])))continue
    if(outdoorSurfaceLift(before.modules,old)!==outdoorSurfaceLift(after.modules,mod))continue
    ids.add(mod.id)
  }
  return ids
}

// These builders read module/metadata only. Changes to either fail closed below.
const CELL_INDEPENDENT = new Set<Module['type']>([
  'sidewalk', 'lawn', 'tree', 'road', 'traffic-light', 'bench', 'fence', 'light', 'vent', 'bin', 'extinguisher', 'shelf', 'desk',
  'cubicle', 'sink', 'urinal', 'checkout', 'booth', 'gate', 'platform-edge', 'billboard', 'tvm', 'vending',
  'door', 'glass', 'calligraphy', 'linemap', 'tactile', 'floor-mark',
  'court', 'ac-unit', 'electrical-cabinet', 'pillar', 'roof', 'exit', 'guidepost', 'busstop', 'psd-end', 'rail-signal',
])

const changedColumns = new WeakMap<readonly Cell[], Map<string, Cell[]>>()
/** Large tunnel edits must not cross every changed cell with every fixture. */
function changedInBox(cells: readonly Cell[], x0: number, x1: number, y0: number, y1: number,
  accepts: (cell: Cell) => boolean = () => true): boolean {
  const inside = (c: Cell): boolean => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1 && accepts(c)
  if (cells.length < 64 || ![x0,x1,y0,y1].every(Number.isFinite)) return cells.some(inside)
  let columns = changedColumns.get(cells)
  if (!columns) {
    changedColumns.set(cells,columns=new Map())
    for (const c of cells) {
      const key=`${Math.floor(c.x/16)},${Math.floor(c.y/16)}`, bucket=columns.get(key)
      if (bucket) bucket.push(c); else columns.set(key,[c])
    }
  }
  const a=Math.floor(x0/16), b=Math.floor(x1/16), c=Math.floor(y0/16), d=Math.floor(y1/16)
  if ((b-a+1)*(d-c+1)>columns.size) return cells.some(inside)
  for(let x=a;x<=b;x++)for(let y=c;y<=d;y++)if(columns.get(`${x},${y}`)?.some(inside))return true
  return false
}

/** The columns a cell-dependent builder reads. Height is intentionally unbounded:
 * hangers seek a slab, lifts discover stops, ramps inspect adjacent wall courses. */
function dependsOnCells(mod: Module, cells: readonly Cell[]): boolean {
  if (!cells.length) return false
  if (isOutdoorSurface(mod)) return changedInBox(cells,mod.x,mod.x,mod.y,mod.y,cell=>cell.z===mod.z)
  if (mod.type === 'track') {
    if(mod.cfg.power!=='catenary')return false
    const box=moduleEnvelope(mod)
    return !box || changedInBox(cells,box.x0,box.x1,box.y0,box.y1,cell=>
      cell.z > mod.z + 1 && cell.z <= mod.z + trackHeadroom(mod) + 1 && trackCellAt(mod,cell.x,cell.y,mod.z))
  }
  if (CELL_INDEPENDENT.has(mod.type)) return false
  if (mod.type === 'shop') return changedInBox(cells,mod.x-1,mod.x+mod.w,mod.y-1,mod.y+mod.h)
  if (mod.type === 'stair' || mod.type === 'escalator' || mod.type === 'walkway' || mod.type === 'lift') {
    const box = moduleEnvelope(mod)
    if (!box || ![box.x0, box.x1, box.y0, box.y1].every(Number.isFinite)) return true
    let x0 = box.x0, x1 = box.x1, y0 = box.y0, y1 = box.y1
    if (mod.type === 'stair') for (const f of stairFlights(mod)) {
      x0 = Math.min(x0, f.from.x, f.to.x); x1 = Math.max(x1, f.from.x, f.to.x)
      y0 = Math.min(y0, f.from.y, f.to.y); y1 = Math.max(y1, f.from.y, f.to.y)
    }
    return changedInBox(cells,x0-3,x1+3,y0-3,y1+3)
  }
  if (['sign', 'tv', 'clock', 'cctv', 'hanger', 'monitor'].includes(mod.type)) {
    const footprint = moduleFootprint(mod)
    return footprint.some(([x,y])=>changedInBox(cells,x-1,x+1,y-1,y+1))
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
    if (onlyAddedStairBlocks(before, after) && !before.modules.some(m => m.type === 'escalator' && changedModules(before, after).some(c => nearbyOpening(m, c)))) {
      for (const mod of before.modules) retained.add(mod.id)
    } else {
      for (const id of equipmentRetainedIds(before, after)) retained.add(id)
    }
    return retained
  }
  const local = localCellEdit(before, after)
  if (local) {
    const changed = [...local.removed, ...local.added]
    const aW = groundWindow(before.cells, before.modules), bW = groundWindow(after.cells, after.modules)
    const sameWindow = aW.x0 === bW.x0 && aW.x1 === bW.x1 && aW.y0 === bW.y0 && aW.y1 === bW.y1
    const unchangedRamp = (mod: Module): boolean => {
      if (!sameWindow || (mod.type !== 'stair' && mod.type !== 'escalator')) return false
      const box = moduleEnvelope(mod)
      return !!box && [box.x0, box.x1, box.y0, box.y1, box.z0, box.z1].every(Number.isFinite) &&
        equal(rampCellModelInputs(before, mod), rampCellModelInputs(after, mod))
    }
    for (const mod of after.modules) if (!dependsOnCells(mod, changed) ||
      unchangedRamp(mod)) retained.add(mod.id)
    return retained
  }
  const changed = changedCellRecords(before.cells, after.cells)
  for (const mod of after.modules) if (!dependsOnCells(mod, changed)) retained.add(mod.id)
  return retained
}

function onlyAddedStairBlocks(before: StationData, after: StationData): boolean {
  const added=after.modules.length-before.modules.length
  if(added<=0)return false
  const changes=changedModules(before,after)
  // Replacements contribute both old and new records; removals also make the
  // change count larger than the net addition count.
  if(changes.length!==added||changes.some(mod=>mod.type!=='stair'||!mod.cfg.block))return false
  if (before.cells.length !== after.cells.length) return false
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old !== next && JSON.stringify(old) !== JSON.stringify(next)) return false
  }
  const { cells: _beforeCells, modules: _beforeModules, ...beforeMetadata } = before
  const { cells: _afterCells, modules: _afterModules, ...afterMetadata } = after
  if (JSON.stringify(beforeMetadata) !== JSON.stringify(afterMetadata)) return false
  return true
}

/**
 * Rendering dependencies are independent of simulation routing. A machine can
 * change the walk graph while only its own model changes. Coupled models declare
 * their neighbours below; unknown builders and changed station fields fail closed.
 */
function equipmentRetainedIds(before: StationData, after: StationData): Set<string> {
  const retained = new Set<string>()
  if (!sameStationFields(before, after)) return retained
  const beforeById = new Map(before.modules.map((mod) => [mod.id, mod]))
  const changes = changedModules(before, after)
  const types = new Set(changes.map(m => m.type))
  // A future module may introduce another dependency: declare it before reuse.
  const known = (m: Module): boolean => CELL_INDEPENDENT.has(m.type) || STANDALONE.has(m.type)
    || ['track', 'stair', 'escalator', 'walkway', 'lift', 'hanger', 'clock', 'cctv', 'monitor', 'sign', 'tv'].includes(m.type)
  if (changes.some(m => !known(m))) return retained
  const cellChanges = changedCellRecords(before.cells, after.cells)
  // Flat belts change fence connections and exit run openings, but carve no
  // cells and supply no wall, ceiling, surface, rail or furniture input.
  const flatBeltsOnly=!cellChanges.length&&changes.every(m=>m.type==='walkway')
  const adjacent = (a: Module, b: Module): boolean => a.z === b.z && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1
  const openingChanged = changes.some(isOpening)
  const surfaces = changes.filter(isOutdoorSurface)
  const openings = changes.filter(m=>['stair','escalator','lift','exit'].includes(m.type))
  const rampChanged = changes.some(isRamp)
  const boxes = new Map<Module, ReturnType<typeof moduleEnvelope>>()
  const boxOf = (m: Module) => {
    if (!boxes.has(m)) boxes.set(m,moduleEnvelope(m))
    return boxes.get(m)!
  }
  const nearby = (a: Module,b: Module): boolean => {
    const aa=boxOf(a),bb=boxOf(b)
    return !aa || !bb || ![aa.x0,aa.x1,aa.y0,aa.y1,bb.x0,bb.x1,bb.y0,bb.y1].every(Number.isFinite) ||
      aa.x0<=bb.x1+3&&aa.x1>=bb.x0-3&&aa.y0<=bb.y1+3&&aa.y1>=bb.y0-3
  }
  const fenceBefore = rampChanged ? fenceConnectionIndex(before.modules) : null
  const fenceAfter = rampChanged ? fenceConnectionIndex(after.modules) : null
  const openingBoxes = changes.filter(m => isOpening(m) &&
    (m.type !== 'track' || m.z === 0 && !m.cfg.bridge && !m.cfg.tunnel)).map(m => {
    const box = boxOf(m)
    return box && [box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) ? box : null
  })
  for (const mod of after.modules) {
    if (!equal(beforeById.get(mod.id), mod)) continue
    if (!known(mod) || dependsOnCells(mod, cellChanges)) continue
    if (isOutdoorSurface(mod)) {
      // Paving is a one-cell instance. Test the changed openings against
      // that tile directly, without constructing envelopes for the city.
      if (openingBoxes.some(box => !box || !Number.isFinite(mod.x) || !Number.isFinite(mod.y) ||
        mod.x <= box.x1 + 3 && mod.x + 1 >= box.x0 - 3 &&
        mod.y <= box.y1 + 3 && mod.y + 1 >= box.y0 - 3) &&
        !equal(surfaceModelInputs(before, mod), surfaceModelInputs(after, mod))) continue
      retained.add(mod.id)
      continue
    }
    if (mod.type === 'escalator' && changes.some(m => nearby(mod, m))) continue
    if(flatBeltsOnly&&!['fence','exit','guidepost','platform-edge','psd-end'].includes(mod.type)){
      retained.add(mod.id);continue
    }
    // Only a finish under this model or an opening intersecting its footprint
    // can change its raised surface. Remote ramp edits leave that input intact.
    if ((surfaces.some(m=>nearby(mod,m)) || openings.some(m=>nearby(mod,m))) &&
      outdoorSurfaceLift(before.modules, mod) !== outdoorSurfaceLift(after.modules, mod)) continue
    // An edge-decor piece backed against a curtain draws shifted towards its tile
    // centre, so adding/lifting a curtain rebuilds the furniture leaning on it.
    if (isEdgeDecor(mod) && changes.some(c => c.type === 'glass' && edgeDecorCurtainShare(c, mod))) continue
    if (changes.some(h => h.type === 'hanger' && hangerSupports(h, mod))) continue
    if (isCeilingHung(mod) && openingChanged && changes.some(m=>isOpening(m)&&nearby(mod,m)) && !equal(ceilingModelInputs(before, mod), ceilingModelInputs(after, mod))) continue
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
    if ((RAMPS.has(mod.type) || mod.type === 'lift') && openingChanged && changes.some(m => isOpening(m) && nearbyOpening(mod, m))) continue
    if (mod.type === 'exit' && changes.some(m => isRamp(m) && nearbyOpening(mod, m))) continue
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
  if (before.cells.length !== after.cells.length || before.modules.length !== after.modules.length) return null
  // Lines included: a shield prints its line's colour and number, so a line
  // edit reprints every board and is not a boards-only change.
  if (!sameStationFields(before, after)) return null
  const changes = changedModules(before, after)
  if (changes.length !== 2) return null
  const [old, mod] = changes
  // Exactly one sign, with its mount and identity intact.
  if (old.type !== 'sign' || mod.type !== 'sign') return null
  const { cfg: nextCfg, ...nextRest } = mod
  const { cfg: oldCfg, ...oldRest } = old
  if (!equal(nextRest, oldRest)) return null
  const { front: _nf, back: _nb, ...nextMount } = nextCfg
  const { front: _of, back: _ob, ...oldMount } = oldCfg
  if (!equal(nextMount, oldMount)) return null
  return before.cells === after.cells || before.cells.every((cell, i) => equal(cell, after.cells[i])) ? mod.id : null
}

const KNOWN_MODULE_EXTRA = new Set<Module['type']>([
  'track', 'stair', 'escalator', 'walkway', 'lift', 'hanger', 'clock', 'cctv', 'monitor', 'sign', 'tv',
])
const CELL_DEPENDENT_TYPES: readonly Module['type'][] = [
  'track', 'shop', 'stair', 'escalator', 'walkway', 'lift', 'sign', 'tv', 'clock', 'cctv', 'hanger', 'monitor',
]
function isKnownModuleType(type: Module['type']): boolean {
  return CELL_INDEPENDENT.has(type) || STANDALONE.has(type) || KNOWN_MODULE_EXTRA.has(type)
}

export interface ModuleEditDelta {
  /** Ids removed from the document or whose model must be replaced. */
  goneIds: Set<string>
  /** Modules from `after` whose models must be built (added, modified, or coupled neighbours). */
  rebuild: Module[]
  /** True when the edit is a pure append of new modules with zero invalidated neighbours. */
  appendOnly: boolean
}

/** Delta equivalent of `equipmentRetainedIds` for same-cells edits: computes
 * only removed/rebuilt modules and coupled neighbours via type-indexed lookups,
 * avoiding a 76k-module scan and 76k-entry `retained` Set on Tianhe Park. */
export function moduleEditDelta(
  before: StationData,
  after: StationData,
  byType: ReadonlyMap<Module['type'], readonly Module[]>,
  nonSurface: readonly Module[],
  surfaceAt?: (x: number, y: number) => readonly Module[] | undefined,
): ModuleEditDelta | null {
  if (before.cells !== after.cells || !sameStationFields(before, after)) return null
  for (const type of byType.keys()) if (!isKnownModuleType(type)) return null
  const a = before.modules, b = after.modules
  const common = Math.min(a.length, b.length)
  let prefix = 0, suffix = 0
  while (prefix < common && a[prefix] === b[prefix]) prefix++
  while (suffix < common - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const aEnd = a.length - suffix, bEnd = b.length - suffix
  const goneIds = new Set<string>()
  const changedAfter: Module[] = []
  const changes: Module[] = []
  if (aEnd === prefix) {
    for (let j = prefix; j < bEnd; j++) {
      changedAfter.push(b[j])
      changes.push(b[j])
    }
  } else if (bEnd === prefix) {
    for (let i = prefix; i < aEnd; i++) {
      goneIds.add(a[i].id)
      changes.push(a[i])
    }
  } else {
    const previous = new Map<string, Module>()
    for (let i = prefix; i < aEnd; i++) previous.set(a[i].id, a[i])
    for (let j = prefix; j < bEnd; j++) {
      const mod = b[j]
      const old = previous.get(mod.id)
      if (!equal(old, mod)) {
        if (old) { goneIds.add(old.id); changes.push(old) }
        changedAfter.push(mod)
        changes.push(mod)
      }
      previous.delete(mod.id)
    }
    for (const old of previous.values()) {
      goneIds.add(old.id)
      changes.push(old)
    }
  }
  if (!changes.length) return { goneIds, rebuild: [], appendOnly: false }
  if (changes.some(m => !isKnownModuleType(m.type))) return null

  const rebuildIds = new Set<string>()
  const rebuild: Module[] = []
  const markRebuild = (mod: Module): void => {
    if (rebuildIds.has(mod.id)) return
    rebuildIds.add(mod.id)
    goneIds.add(mod.id)
    rebuild.push(mod)
  }
  for (const mod of changedAfter) {
    rebuildIds.add(mod.id)
    rebuild.push(mod)
  }
  const changedIds = new Set<string>(changes.map(m => m.id))

  // Pure stair-block addition: only nearby escalators are invalidated.
  const pureAddedStairBlocks = goneIds.size === 0 && changedAfter.length === changes.length &&
    changes.every(m => m.type === 'stair' && m.cfg.block)
  if (pureAddedStairBlocks) {
    for (const mod of byType.get('escalator') ?? []) {
      if (changedIds.has(mod.id)) continue
      if (changes.some(c => nearbyOpening(mod, c))) markRebuild(mod)
    }
    return { goneIds, rebuild, appendOnly: goneIds.size === 0 && rebuild.length > 0 }
  }

  const types = new Set(changes.map(m => m.type))
  const flatBeltsOnly = changes.every(m => m.type === 'walkway')
  const adjacent = (x: Module, y: Module): boolean => x.z === y.z && Math.abs(x.x - y.x) + Math.abs(x.y - y.y) <= 1
  const openingChanged = changes.some(isOpening)
  const surfaces = changes.filter(isOutdoorSurface)
  const openings = changes.filter(m => m.type === 'stair' || m.type === 'escalator' || m.type === 'lift' || m.type === 'exit')
  const rampChanged = changes.some(isRamp)
  const boxes = new Map<Module, ReturnType<typeof moduleEnvelope>>()
  const boxOf = (m: Module) => {
    if (!boxes.has(m)) boxes.set(m, moduleEnvelope(m))
    return boxes.get(m)!
  }
  const nearby = (x: Module, y: Module): boolean => {
    const aa = boxOf(x), bb = boxOf(y)
    return !aa || !bb || ![aa.x0, aa.x1, aa.y0, aa.y1, bb.x0, bb.x1, bb.y0, bb.y1].every(Number.isFinite) ||
      aa.x0 <= bb.x1 + 3 && aa.x1 >= bb.x0 - 3 && aa.y0 <= bb.y1 + 3 && aa.y1 >= bb.y0 - 3
  }

  // Outdoor surfaces only care about changed openings overlapping their tile ± 3.
  const openingBoxes = changes.filter(m => isOpening(m) &&
    (m.type !== 'track' || m.z === 0 && !m.cfg.bridge && !m.cfg.tunnel)).map(m => {
    const box = boxOf(m)
    return box && [box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) ? box : null
  })
  if (openingBoxes.length > 0) {
    if (!surfaceAt || openingBoxes.some(box => !box || (Math.ceil(box.x1 + 3) - Math.floor(box.x0 - 3) + 1) * (Math.ceil(box.y1 + 3) - Math.floor(box.y0 - 3) + 1) > 4096)) {
      return null
    }
    for (const box of openingBoxes) {
      const x0 = Math.floor(box!.x0 - 3), x1 = Math.ceil(box!.x1 + 3)
      const y0 = Math.floor(box!.y0 - 3), y1 = Math.ceil(box!.y1 + 3)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const list = surfaceAt(x, y)
          if (!list) continue
          for (const mod of list) {
            if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
            if (!equal(surfaceModelInputs(before, mod), surfaceModelInputs(after, mod))) markRebuild(mod)
          }
        }
      }
    }
  }

  // Escalators always check nearby changes.
  for (const mod of byType.get('escalator') ?? []) {
    if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
    if (changes.some(m => nearby(mod, m))) markRebuild(mod)
  }

  const fenceBefore = rampChanged ? fenceConnectionIndex(before.modules) : null
  const fenceAfter = rampChanged ? fenceConnectionIndex(after.modules) : null

  if (!flatBeltsOnly) {
    // Raised outdoor-surface lift changes only when a surface or opening changed.
    if (surfaces.length > 0 || openings.length > 0) {
      for (const mod of nonSurface) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if ((surfaces.some(m => nearby(mod, m)) || openings.some(m => nearby(mod, m))) &&
          outdoorSurfaceLift(before.modules, mod) !== outdoorSurfaceLift(after.modules, mod)) {
          markRebuild(mod)
        }
      }
    }
    // Glass curtain edits affect leaning edge-decor and corner-joined glass.
    if (types.has('glass')) {
      for (const mod of nonSurface) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (isEdgeDecor(mod) && changes.some(c => c.type === 'glass' && edgeDecorCurtainShare(c, mod))) markRebuild(mod)
      }
      for (const mod of byType.get('glass') ?? []) {
        if (mod.type !== 'glass' || changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (changes.some(c => c.type === 'glass' && curtainCornerJoin(mod, c).length > 0)) markRebuild(mod)
      }
    }
    if (types.has('door')) {
      for (const mod of byType.get('glass') ?? []) {
        if (mod.type !== 'glass' || changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (changes.some(c => c.type === 'door' && curtainDoorShare(mod, c))) markRebuild(mod)
      }
    }
    if (types.has('hanger')) {
      for (const mod of nonSurface) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (changes.some(h => h.type === 'hanger' && hangerSupports(h, mod))) markRebuild(mod)
      }
    }
    if (openingChanged) {
      for (const mod of nonSurface) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (isCeilingHung(mod) && changes.some(m => isOpening(m) && nearby(mod, m)) &&
          !equal(ceilingModelInputs(before, mod), ceilingModelInputs(after, mod))) {
          markRebuild(mod)
        }
      }
      for (const t of ['stair', 'escalator', 'walkway', 'lift'] as const) {
        for (const mod of byType.get(t) ?? []) {
          if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
          if (changes.some(m => isOpening(m) && nearbyOpening(mod, m))) markRebuild(mod)
        }
      }
    }
    if (types.has('tactile')) {
      for (const mod of byType.get('tactile') ?? []) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (changes.some(m => m.type === 'tactile' && adjacent(m, mod))) markRebuild(mod)
      }
    }
    if (types.has('fence') || types.has('gate')) {
      for (const t of ['fence', 'gate'] as const) {
        for (const mod of byType.get(t) ?? []) {
          if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
          if (changes.some(m => (m.type === 'fence' || m.type === 'gate') && adjacent(m, mod))) markRebuild(mod)
        }
      }
    }
    if (types.has('cubicle')) {
      for (const mod of byType.get('cubicle') ?? []) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (changes.some(m => m.type === 'cubicle' && adjacent(m, mod))) markRebuild(mod)
      }
    }
    if (types.has('tv')) {
      for (const mod of byType.get('tv') ?? []) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (changes.some(m => m.type === 'tv' && m.x === mod.x && m.y === mod.y && m.z === mod.z)) markRebuild(mod)
      }
    }
    if (types.has('road')) {
      for (const mod of byType.get('road') ?? []) {
        if (mod.type !== 'road' || changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (!equal(roadModelInputs(before, mod), roadModelInputs(after, mod))) markRebuild(mod)
      }
    }
    if (types.has('track') || types.has('platform-edge')) {
      for (const mod of byType.get('track') ?? []) {
        if (mod.type !== 'track' || changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (!equal(trackModelInputs(before, mod), trackModelInputs(after, mod))) markRebuild(mod)
      }
    }
    if (types.has('track')) {
      for (const mod of byType.get('pillar') ?? []) {
        if (mod.type !== 'pillar' || changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (!equal(pillarModelInputs(before, mod), pillarModelInputs(after, mod))) markRebuild(mod)
      }
    }
    if (types.has('roof')) {
      for (const mod of byType.get('hanger') ?? []) {
        if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
        if (mod.type === 'hanger' && mod.cfg.mount === 'roof' &&
          !equal(hangerModelInputs(before, mod), hangerModelInputs(after, mod))) markRebuild(mod)
      }
    }
  }

  // Shared by both ordinary and flat-belt-only edits:
  if (fenceBefore && fenceAfter) {
    for (const mod of byType.get('fence') ?? []) {
      if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
        fenceBefore.connects(mod.x + dx, mod.y + dy, mod.z, -dx, -dy) !== fenceAfter.connects(mod.x + dx, mod.y + dy, mod.z, -dx, -dy))) {
        markRebuild(mod)
      }
    }
  }
  if (rampChanged) {
    for (const mod of byType.get('exit') ?? []) {
      if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
      if (changes.some(m => isRamp(m) && nearbyOpening(mod, m))) markRebuild(mod)
    }
  }
  if (types.has('exit')) {
    for (const mod of byType.get('guidepost') ?? []) {
      if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
      if (mod.type === 'guidepost' && mod.cfg.exitId && changedIds.has(mod.cfg.exitId)) markRebuild(mod)
    }
  }
  if (types.has('track')) {
    for (const mod of byType.get('platform-edge') ?? []) {
      if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
      if (mod.type === 'platform-edge' && mod.cfg.from && changedIds.has(mod.cfg.from)) markRebuild(mod)
    }
  }
  for (const mod of byType.get('psd-end') ?? []) {
    if (changedIds.has(mod.id) || rebuildIds.has(mod.id)) continue
    if (mod.type === 'psd-end' && ((mod.cfg.corner && changedIds.has(mod.cfg.corner)) || (mod.cfg.support && changedIds.has(mod.cfg.support)))) {
      markRebuild(mod)
    }
  }

  return { goneIds, rebuild, appendOnly: goneIds.size === 0 && rebuild.length > 0 }
}

/** Delta equivalent of `retainedModuleIds` for a bounded cell-only edit
 * (`before.modules === after.modules`): checks only cell-dependent module types
 * and surface tiles directly sitting on edited cell coordinates. */
export function cellEditInvalidatedModules(
  before: StationData,
  after: StationData,
  byType: ReadonlyMap<Module['type'], readonly Module[]>,
  surfaceAt: (x: number, y: number) => readonly Module[] | undefined,
): Module[] | null {
  if (!sameModuleMetadata(before, after)) return null
  const local = localCellEdit(before, after)
  if (!local) return null
  const changed = [...local.removed, ...local.added]
  if (!changed.length) return []
  const invalidated: Module[] = []
  const seen = new Set<string>()
  const add = (mod: Module): void => {
    if (seen.has(mod.id)) return
    seen.add(mod.id)
    invalidated.push(mod)
  }
  // Surface tiles depend only on a cell at their exact (x, y, z).
  for (const c of changed) {
    const list = surfaceAt(c.x, c.y)
    if (!list) continue
    for (const mod of list) {
      if (mod.z === c.z) add(mod)
    }
  }
  // Check any non-CELL_INDEPENDENT module type.
  const aW = groundWindow(before.cells, before.modules), bW = groundWindow(after.cells, after.modules)
  const sameWindow = aW.x0 === bW.x0 && aW.x1 === bW.x1 && aW.y0 === bW.y0 && aW.y1 === bW.y1
  const unchangedRamp = (mod: Module): boolean => {
    if (!sameWindow || (mod.type !== 'stair' && mod.type !== 'escalator')) return false
    const box = moduleEnvelope(mod)
    return !!box && [box.x0, box.x1, box.y0, box.y1, box.z0, box.z1].every(Number.isFinite) &&
      equal(rampCellModelInputs(before, mod), rampCellModelInputs(after, mod))
  }
  for (const type of byType.keys()) {
    if (CELL_INDEPENDENT.has(type)) continue
    const list = byType.get(type)
    if (!list) continue
    if (!CELL_DEPENDENT_TYPES.includes(type)) {
      for (const mod of list) add(mod)
      continue
    }
    for (const mod of list) {
      if (dependsOnCells(mod, changed) && !unchangedRamp(mod)) add(mod)
    }
  }
  return invalidated
}

registerDocumentCache((cells, modules, liveCells, liveModules) => {
  if (modules !== liveModules) moduleChanges.delete(modules)
  if (cells !== liveCells) changedColumns.delete(cells)
})
