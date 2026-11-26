// Virtual street ground — GAME-SPEC §4.1, the inverted half.
//
// The street is an infinite 1 m plane at z = 0. Storing it as blocks would
// grow every save by the horizon, so the document stores it the other way
// round from every other storey:
//
//   * z != 0 — stored blocks, exactly as before;
//   * z == 0 — stored *holes*: a `{ fill: 'void' }` record where the player dug
//     through the street, and nothing anywhere else. Absence at z = 0 is solid
//     ground, through a horizon no save ever holds.
//
// A hole the game cut itself — a ramp's carved corridor, an exit's floor —
// needs no record: `rampOpeningAt` / `exitFloorAt` derive it from the modules,
// so the demo's 130 surface openings survive with its JSON untouched.
//
// Nothing here is infinite in memory: `withGround` materialises one bounded
// window (the station's content plus `GROUND_MARGIN`) for the two consumers
// that walk every cell — the walk graph and the chunk mesher — while every
// point query (`solidAt`) and every membership skip (`virtualSolidAt`) answers
// in O(1) without generating a cell. Pure data, no DOM, no three.
import { exitFloorAt, exitFootprintCells, isExitHeadHouse } from './exits.ts'
// Function-level cycle with `openings.ts` (it reads `virtualSolidAt` for the
// escalator landings): both sides only call across at runtime, never at module
// evaluation, so the bindings are settled by the first call.
import { rampOpeningAt, rampOpeningsInWindow } from './openings.ts'
import { trackCellAt, trackCells, type TrackModule } from './track.ts'
import type { Cell, Module } from './types.ts'
import { registerDocumentCache } from './documentCaches.ts'

/** The street storey: the one plane the document stores inverted. */
export const GROUND_Z = 0
/** A surface track cuts its anchor course, and an open run also cuts the course below it. */
export function trackCutsGround(track: TrackModule): boolean {
  return !track.cfg.tunnel && (track.z === GROUND_Z || (track.cfg.bridge === true && track.z === GROUND_Z + 1))
}
/** A finish stored on existing pavement, rather than newly built ground. */
export const PAINTED_GROUND = 'painted-ground'

export function isPaintedGround(cell: Cell): boolean {
  return cell.z === GROUND_Z && cell.fill === 'solid' && cell.tags?.includes(PAINTED_GROUND) === true
}

/**
 * How far past the station's content the materialised window reaches, metres.
 * Past the fog's near plane the edge is never read as geometry — and a drag
 * that grows the station grows the window with it, so the horizon follows the
 * build rather than bounding it.
 */
export const GROUND_MARGIN = 16
export type GroundBounds = { x0: number; x1: number; y0: number; y1: number }
type CellGroundBounds = { content: GroundBounds; painted: GroundBounds }
const cellBoundsCache = new WeakMap<readonly Cell[], CellGroundBounds>()
const moduleBoundsCache = new WeakMap<readonly Module[], GroundBounds>()
let lastCellBounds: { cells: readonly Cell[]; bounds: CellGroundBounds } | null = null
let lastModuleBounds: { modules: readonly Module[]; bounds: GroundBounds } | null = null

function emptyBounds(): GroundBounds {
  return { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
}

function eatPoint(b: GroundBounds, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  if (x < b.x0) b.x0 = x
  if (y < b.y0) b.y0 = y
  if (x > b.x1) b.x1 = x
  if (y > b.y1) b.y1 = y
}

function eatModuleBounds(b: GroundBounds, m: Module): void {
  eatPoint(b, m.x, m.y)
  if (m.type === 'road') eatPoint(b, m.x + m.w - 1, m.y + m.d - 1)
  if (m.type === 'track') for (const [x, y] of trackCells(m)) eatPoint(b, x, y)
  const run = m as { from?: { x: number; y: number }; to?: { x: number; y: number } }
  if (run.from) eatPoint(b, run.from.x, run.from.y)
  if (run.to) eatPoint(b, run.to.x, run.to.y)
}

function strictlyInside(outer: GroundBounds, x0: number, x1: number, y0: number, y1: number): boolean {
  return Number.isFinite(outer.x0) && x0 > outer.x0 && x1 < outer.x1 && y0 > outer.y0 && y1 < outer.y1
}

function cellBoundsOf(cells: readonly Cell[]): CellGroundBounds {
  const cached = cellBoundsCache.get(cells)
  if (cached) return cached
  if (lastCellBounds && Number.isFinite(lastCellBounds.bounds.content.x0) &&
    Math.abs(cells.length - lastCellBounds.cells.length) <= 256) {
    const prev = lastCellBounds.cells
    const pb = lastCellBounds.bounds
    const common = Math.min(prev.length, cells.length)
    let prefix = 0, suffix = 0
    while (prefix < common && prev[prefix] === cells[prefix]) prefix++
    while (suffix < common - prefix && prev[prev.length - 1 - suffix] === cells[cells.length - 1 - suffix]) suffix++
    const pEnd = prev.length - suffix, nEnd = cells.length - suffix
    const removed: Cell[] = [], added: Cell[] = []
    let ok = true
    if (pEnd - prefix + (nEnd - prefix) <= 256) {
      for (let i = prefix; i < pEnd; i++) removed.push(prev[i])
      for (let j = prefix; j < nEnd; j++) added.push(cells[j])
    } else {
      let i = prefix, j = prefix
      while (i < pEnd && j < nEnd) {
        const a = prev[i], b = cells[j]
        if (a === b) { i++; j++; continue }
        if (a.x === b.x && a.y === b.y && a.z === b.z) { removed.push(a); added.push(b); i++; j++ }
        else if (i + 1 < pEnd && prev[i + 1] === b) { removed.push(a); i++ }
        else if (j + 1 < nEnd && a === cells[j + 1]) { added.push(b); j++ }
        else { ok = false; break }
        if (removed.length + added.length > 256) { ok = false; break }
      }
      if (ok) {
        for (; i < pEnd; i++) removed.push(prev[i])
        for (; j < nEnd; j++) added.push(cells[j])
        if (removed.length + added.length > 256) ok = false
      }
    }
    if (ok) {
      let canReuse = true
      for (const c of removed) {
        const box = isPaintedGround(c) ? pb.painted : pb.content
        if (!strictlyInside(box, c.x, c.x, c.y, c.y)) { canReuse = false; break }
      }
      if (canReuse) {
        const content = { ...pb.content }
        const painted = { ...pb.painted }
        for (const c of added) {
          if (isPaintedGround(c)) eatPoint(painted, c.x, c.y)
          else eatPoint(content, c.x, c.y)
        }
        const result = { content, painted }
        cellBoundsCache.set(cells, result)
        lastCellBounds = { cells, bounds: result }
        return result
      }
    }
  }
  const content = emptyBounds()
  const painted = emptyBounds()
  for (const c of cells) {
    if (isPaintedGround(c)) eatPoint(painted, c.x, c.y)
    else eatPoint(content, c.x, c.y)
  }
  const result = { content, painted }
  cellBoundsCache.set(cells, result)
  lastCellBounds = { cells, bounds: result }
  return result
}

function moduleBoundsOf(modules: readonly Module[]): GroundBounds {
  const cached = moduleBoundsCache.get(modules)
  if (cached) return cached
  if (lastModuleBounds && Number.isFinite(lastModuleBounds.bounds.x0) &&
    Math.abs(modules.length - lastModuleBounds.modules.length) <= 64) {
    const prev = lastModuleBounds.modules
    const pb = lastModuleBounds.bounds
    const common = Math.min(prev.length, modules.length)
    let prefix = 0, suffix = 0
    while (prefix < common && prev[prefix] === modules[prefix]) prefix++
    while (suffix < common - prefix && prev[prev.length - 1 - suffix] === modules[modules.length - 1 - suffix]) suffix++
    const pEnd = prev.length - suffix, nEnd = modules.length - suffix
    if (pEnd - prefix + (nEnd - prefix) <= 64) {
      let canReuse = true
      for (let i = prefix; i < pEnd; i++) {
        const mb = emptyBounds()
        eatModuleBounds(mb, prev[i])
        if (Number.isFinite(mb.x0) && !strictlyInside(pb, mb.x0, mb.x1, mb.y0, mb.y1)) { canReuse = false; break }
      }
      if (canReuse) {
        const next = { ...pb }
        for (let j = prefix; j < nEnd; j++) eatModuleBounds(next, modules[j])
        moduleBoundsCache.set(modules, next)
        lastModuleBounds = { modules, bounds: next }
        return next
      }
    }
  }
  const bounds = emptyBounds()
  for (const m of modules) eatModuleBounds(bounds, m)
  moduleBoundsCache.set(modules, bounds)
  lastModuleBounds = { modules, bounds }
  return bounds
}

function paddedGroundBounds(content: GroundBounds, painted: GroundBounds, margin: number): GroundBounds {
  return {
    x0: Math.min(content.x0 - margin, painted.x0),
    x1: Math.max(content.x1 + margin, painted.x1),
    y0: Math.min(content.y0 - margin, painted.y0),
    y1: Math.max(content.y1 + margin, painted.y1),
  }
}

interface GroundInputs { next:WeakMap<Module,GroundInputs>; windows:Map<string,Cell[]> }
const groundInputs=new WeakMap<readonly Cell[],GroundInputs>()
const groundStructuralTypes=new Set(['stair','escalator','lift','exit','track'])
const windowKey=(w:ReturnType<typeof groundWindow>)=>`${w.x0},${w.x1},${w.y0},${w.y1}`
function preparedGround(cells:readonly Cell[],modules:readonly Module[]):GroundInputs{
  let inputs:GroundInputs=groundInputs.get(cells)??{next:new WeakMap(),windows:new Map()}
  groundInputs.set(cells,inputs)
  for(const mod of modules){
    if(!groundStructuralTypes.has(mod.type))continue
    let next:GroundInputs|undefined=inputs.next.get(mod)
    if(!next)inputs.next.set(mod,next={next:new WeakMap(),windows:new Map()})
    inputs=next
  }
  return inputs
}
function rememberGround(inputs:GroundInputs,w:ReturnType<typeof groundWindow>,cells:Cell[]):void{
  const key=windowKey(w);inputs.windows.delete(key);inputs.windows.set(key,cells)
  if(inputs.windows.size>4)inputs.windows.delete(inputs.windows.keys().next().value!)
}

/** The plan rect the window covers: explicit cells and module anchors, plus margin. */
export function groundWindow(
  cells: readonly Cell[],
  modules: readonly Module[],
  margin = GROUND_MARGIN,
): { x0: number; x1: number; y0: number; y1: number } {
  const cb = cellBoundsOf(cells)
  const mb = moduleBoundsOf(modules)
  let minX = Math.min(cb.content.x0, mb.x0)
  let minY = Math.min(cb.content.y0, mb.y0)
  let maxX = Math.max(cb.content.x1, mb.x1)
  let maxY = Math.max(cb.content.y1, mb.y1)
  if (!Number.isFinite(minX)) {
    // A station with nothing in it yet: the window is the origin the new
    // ground is built from, not an empty set no tool can address.
    minX = minY = maxX = maxY = 0
  }
  return paddedGroundBounds({ x0: minX, x1: maxX, y0: minY, y1: maxY }, cb.painted, margin)
}

/**
 * True when the plane is open at `(x, y)`: a dug void the document holds, or
 * an opening the modules derive (a ramp corridor, an exit floor). Everything
 * else at z = 0 is ground.
 */
export function groundHoleAt(cells: readonly Cell[], modules: readonly Module[], x: number, y: number): boolean {
  for (const c of cells) {
    if (c.x === x && c.y === y && c.z === GROUND_Z && c.fill !== 'solid') return true
  }
  return modules.some((m) => m.type === 'track' && trackCutsGround(m) && trackCellAt(m, x, y, m.z)) || rampOpeningAt(modules, x, y, GROUND_Z) || exitFloorAt(modules, x, y, GROUND_Z)
}

const groundHoleReaders = new WeakMap<readonly Cell[], WeakMap<readonly Module[], (x: number, y: number) => boolean>>()
const moduleGroundHoleReaders = new WeakMap<readonly Module[], (x: number, y: number) => boolean>()

function moduleGroundHoleReader(modules: readonly Module[]): (x: number, y: number) => boolean {
  const cached = moduleGroundHoleReaders.get(modules)
  if (cached) return cached
  const tracks = modules.filter((m): m is TrackModule => m.type === 'track' && trackCutsGround(m))
  const read = (x: number, y: number): boolean =>
    tracks.some(m => trackCellAt(m, x, y, m.z)) ||
    rampOpeningAt(modules, x, y, GROUND_Z) ||
    exitFloorAt(modules, x, y, GROUND_Z)
  moduleGroundHoleReaders.set(modules, read)
  return read
}

/** Prepare the same point rule for a multi-cell footprint on immutable input. */
export function groundHoleReader(cells: readonly Cell[], modules: readonly Module[]): (x: number, y: number) => boolean {
  let readers = groundHoleReaders.get(cells)
  if (!readers) groundHoleReaders.set(cells, readers = new WeakMap())
  const cached = readers.get(modules)
  if (cached) return cached
  const explicit = new Set<string>()
  for (const c of cells) if (c.z === GROUND_Z && c.fill !== 'solid') explicit.add(`${c.x},${c.y}`)
  const moduleHole = moduleGroundHoleReader(modules)
  const read = (x: number, y: number): boolean => explicit.has(`${x},${y}`) || moduleHole(x, y)
  readers.set(modules, read)
  return read
}

/** True for a generated ground cell: z = 0 with neither a record nor a hole. */
export function virtualSolidAt(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, z: number): boolean {
  return z === GROUND_Z && !groundHoleAt(cells, modules, x, y)
}

/**
 * True when a block stands at `(x, y, z)`: an explicit solid, or the virtual
 * street. The modules ride along because a hole is a property of the runs and
 * head-houses, not of the cell list.
 */
export function solidAt(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, z: number): boolean {
  for (const c of cells) {
    if (c.x === x && c.y === y && c.z === z && c.fill === 'solid') return true
  }
  return virtualSolidAt(cells, modules, x, y, z)
}

/**
 * The effective cell list: the document's own records plus the window's
 * street, skipping every coordinate the document speaks for (a solid *or* a
 * void — a dug hole must not be paved back over) and every module opening.
 * Stored cells are already carved at edit time; generated ones are filtered
 * here, so the two never disagree about a stairwell.
 */
export function withGround(
  cells: readonly Cell[],
  modules: readonly Module[],
  margin = GROUND_MARGIN,
): Cell[] {
  const w = groundWindow(cells, modules, margin)
  return cells.concat(generatedGround(cells,modules,w))
}

/** Reuse unchanged pavement when only non-carving equipment changes the street bounds.
 * The caller must prove identical authored cells and unchanged ground openings.
 * Newly exposed strips still derive every authored hole and module opening. */
export function resizeGround(cells: readonly Cell[], modules: readonly Module[], previous: readonly Cell[], previousWindow: ReturnType<typeof groundWindow>): Cell[] {
  const w=groundWindow(cells,modules)
  const inputs=preparedGround(cells,modules),cached=inputs.windows.get(windowKey(w))
  if(cached)return cells.concat(cached)
  if(!Number.isInteger(w.x0-previousWindow.x0)||!Number.isInteger(w.y0-previousWindow.y0))return withGround(cells,modules)
  const kept=previous.slice(cells.length).filter(c=>c.x>=w.x0&&c.x<=w.x1&&c.y>=w.y0&&c.y<=w.y1)
  const added=generatedGround(cells,modules,w,previousWindow),out=cells.slice() as Cell[]
  let i=0,j=0
  while(i<kept.length||j<added.length){
    const a=kept[i],b=added[j]
    if(!b||a&&(a.x<b.x||a.x===b.x&&a.y<b.y)){out.push(a);i++}
    else {out.push(b);j++}
  }
  rememberGround(inputs,w,out.slice(cells.length))
  return out
}

function mergeSortedGround(a: readonly Cell[], b: readonly Cell[]): Cell[] {
  if (a.length === 0) return b.slice()
  if (b.length === 0) return a.slice()
  const out: Cell[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    const ca = a[i], cb = b[j]
    if (ca.x < cb.x || (ca.x === cb.x && ca.y < cb.y)) { out.push(ca); i++ }
    else { out.push(cb); j++ }
  }
  while (i < a.length) out.push(a[i++])
  while (j < b.length) out.push(b[j++])
  return out
}

function diffSortedGround(oldTail: readonly Cell[], oldStart: number, newTail: readonly Cell[]): { removedGround: Cell[]; addedGround: Cell[] } {
  const removedGround: Cell[] = []
  const addedGround: Cell[] = []
  let i = oldStart, j = 0
  while (i < oldTail.length && j < newTail.length) {
    const a = oldTail[i], b = newTail[j]
    if (a.x === b.x && a.y === b.y) { i++; j++ }
    else if (a.x < b.x || (a.x === b.x && a.y < b.y)) { removedGround.push(a); i++ }
    else { addedGround.push(b); j++ }
  }
  while (i < oldTail.length) removedGround.push(oldTail[i++])
  while (j < newTail.length) addedGround.push(newTail[j++])
  return { removedGround, addedGround }
}

/** Incrementally update generated street pavement for a bounded cell-only edit.
 * Caller guarantees identical modules; supports z === 0 authored transitions and
 * bounded window growth/shrink while preserving exact `withGround` ordering. */
export function patchGround(
  cells: readonly Cell[],
  modules: readonly Module[],
  previous: readonly Cell[],
  prevAuthoredCount: number,
  prevW: GroundBounds,
  removed: readonly Cell[],
  added: readonly Cell[],
): { ground: Cell[]; removedGround: Cell[]; addedGround: Cell[] } {
  const w = groundWindow(cells, modules)
  const inputs = preparedGround(cells, modules)
  const cached = inputs.windows.get(windowKey(w))
  if (cached) {
    const { removedGround, addedGround } = diffSortedGround(previous, prevAuthoredCount, cached)
    return { ground: cells.concat(cached), removedGround, addedGround }
  }
  if (
    !Number.isInteger(w.x0 - prevW.x0) || !Number.isInteger(w.x1 - prevW.x1) ||
    !Number.isInteger(w.y0 - prevW.y0) || !Number.isInteger(w.y1 - prevW.y1)
  ) {
    const tail = generatedGround(cells, modules, w)
    const { removedGround, addedGround } = diffSortedGround(previous, prevAuthoredCount, tail)
    return { ground: cells.concat(tail), removedGround, addedGround }
  }
  const removedZ0 = new Map<string, [number, number]>()
  for (const c of removed) if (c.z === GROUND_Z) removedZ0.set(`${c.x},${c.y}`, [c.x, c.y])
  const newlyAuthoredZ0 = new Set<string>()
  for (const c of added) {
    if (c.z !== GROUND_Z) continue
    const k = `${c.x},${c.y}`
    if (!removedZ0.delete(k)) newlyAuthoredZ0.add(k)
  }
  const extraAdded: Cell[] = []
  if (removedZ0.size > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of removedZ0.values()) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (const c of cells) {
      if (c.z !== GROUND_Z || c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue
      removedZ0.delete(`${c.x},${c.y}`)
      if (removedZ0.size === 0) break
    }
    if (removedZ0.size > 0) {
      const moduleHole = moduleGroundHoleReader(modules)
      for (const [x, y] of removedZ0.values()) {
        // Coordinates outside prevW are handled by the border-strip pass below.
        if (x < w.x0 || x > w.x1 || y < w.y0 || y > w.y1) continue
        if (x < prevW.x0 || x > prevW.x1 || y < prevW.y0 || y > prevW.y1) continue
        if (moduleHole(x, y)) continue
        extraAdded.push({ x, y, z: GROUND_Z, fill: 'solid', zone: 'outside' })
      }
      if (extraAdded.length > 1) extraAdded.sort((a, b) => a.x - b.x || a.y - b.y)
    }
  }
  const sameWindow = w.x0 === prevW.x0 && w.x1 === prevW.x1 && w.y0 === prevW.y0 && w.y1 === prevW.y1
  if (sameWindow && newlyAuthoredZ0.size === 0 && extraAdded.length === 0) {
    const tail = previous.slice(prevAuthoredCount)
    rememberGround(inputs, w, tail)
    return { ground: cells.concat(tail), removedGround: [], addedGround: [] }
  }
  const kept: Cell[] = []
  const removedGround: Cell[] = []
  const hasNewAuthored = newlyAuthoredZ0.size > 0
  for (let i = prevAuthoredCount; i < previous.length; i++) {
    const c = previous[i]
    if (
      c.x < w.x0 || c.x > w.x1 || c.y < w.y0 || c.y > w.y1 ||
      (hasNewAuthored && newlyAuthoredZ0.has(`${c.x},${c.y}`))
    ) {
      removedGround.push(c)
    } else {
      kept.push(c)
    }
  }
  const expanded = w.x0 < prevW.x0 || w.x1 > prevW.x1 || w.y0 < prevW.y0 || w.y1 > prevW.y1
  const stripAdded = expanded ? generatedGround(cells, modules, w, prevW) : []
  const addedGround = mergeSortedGround(stripAdded, extraAdded)
  const tail = mergeSortedGround(kept, addedGround)
  rememberGround(inputs, w, tail)
  return { ground: cells.concat(tail), removedGround, addedGround }
}

/** Speculative derived data only: an accepted non-carving move can prepare its
 * next street window without mutating the document or live occupancy indexes. */
export function primeGroundResize(cells:readonly Cell[],before:readonly Module[],after:readonly Module[]):void{
  const old=groundWindow(cells,before),next=groundWindow(cells,after)
  if(windowKey(old)===windowKey(next))return
  resizeGround(cells,after,withGround(cells,before),old)
}

function generatedGround(cells: readonly Cell[],modules: readonly Module[],w: ReturnType<typeof groundWindow>,exclude?: ReturnType<typeof groundWindow>): Cell[] {
  const inputs=preparedGround(cells,modules),cached=inputs.windows.get(windowKey(w))
  if(cached)return exclude?cached.filter(c=>c.x<exclude.x0||c.x>exclude.x1||c.y<exclude.y0||c.y>exclude.y1):cached
  const holes = new Map<number, Set<number>>()
  const omit = (x: number, y: number): void => {
    if (x < w.x0 || x > w.x1 || y < w.y0 || y > w.y1) return
    if (exclude && x >= exclude.x0 && x <= exclude.x1 && y >= exclude.y0 && y <= exclude.y1) return
    let row = holes.get(x)
    if (!row) holes.set(x, row = new Set())
    row.add(y)
  }
  // Only authored records at grade can suppress generated pavement.
  for (const c of cells) if (c.z === GROUND_Z) omit(c.x, c.y)
  // The street's derived holes, enumerated by run and by head-house instead of
  // asked per street cell: `rampOpeningAt` rebuilds the run list per call, so a
  // window-wide loop over it was O(window × runs) — most of this function's
  // cost on a large station, paid on every commit (`prepareStation`,
  // `buildGraph`, the viewport's live sets). Same predicates, asked once each:
  // `rampOpeningsInWindow` scans each run's own bounding box with `intrudes`,
  // and an exit's footprint is exactly the cells `exitCoversCell` names.
  for (const opening of rampOpeningsInWindow(modules, GROUND_Z, w)) {
    const [x, y] = opening.split(',').map(Number)
    omit(x, y)
  }
  for (const m of modules) {
    if (m.type === 'track' && trackCutsGround(m)) {
      for (const [x, y] of trackCells(m)) omit(x, y)
      continue
    }
    if (m.type !== 'exit' || !isExitHeadHouse(m) || m.z !== GROUND_Z) continue
    for (const [x, y] of exitFootprintCells(m)) omit(x, y)
  }
  const out: Cell[] = []
  for (let x = w.x0; x <= w.x1; x++) {
    const omitted = holes.get(x)
    for (let y = w.y0; y <= w.y1; y++) {
      if(exclude&&x>=exclude.x0&&x<=exclude.x1&&y>=exclude.y0&&y<=exclude.y1){y=exclude.y1;continue}
      if (omitted?.has(y)) continue
      // The street is the **outside** zone, not `unpaid`: `outside`↔`unpaid` is
      // not a fare crossing (`crossingDir`), so the plane never invents an
      // ungated fare line around an unpaid concourse — while a painted `paid`
      // patch still needs a gate to reach the open street, as it should. The
      // label is written here rather than left to a default, because a generated
      // cell is data and the plane really is 站外: a coordinate with no record at
      // all is only 站外 for the same reason (`withGround` is what makes it one).
      out.push({ x, y, z: GROUND_Z, fill: 'solid', zone: 'outside' })
    }
  }
  if(!exclude)rememberGround(inputs,w,out)
  return out
}

registerDocumentCache((cells, modules, liveCells, liveModules) => {
  if (cells !== liveCells) {
    cellBoundsCache.delete(cells)
    if (lastCellBounds?.cells === cells) lastCellBounds = null
    groundInputs.delete(cells)
    groundHoleReaders.delete(cells)
  }
  if (modules !== liveModules) {
    moduleBoundsCache.delete(modules)
    if (lastModuleBounds?.modules === modules) lastModuleBounds = null
    moduleGroundHoleReaders.delete(modules)
    groundHoleReaders.get(cells)?.delete(modules)
  }
})
