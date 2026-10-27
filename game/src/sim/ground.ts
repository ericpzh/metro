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
import { trackCellAt, trackCells } from './track.ts'
import type { Cell, Module } from './types.ts'

/** The street storey: the one plane the document stores inverted. */
export const GROUND_Z = 0
/**
 * How far past the station's content the materialised window reaches, metres.
 * Past the fog's near plane the edge is never read as geometry — and a drag
 * that grows the station grows the window with it, so the horizon follows the
 * build rather than bounding it.
 */
export const GROUND_MARGIN = 16
type GroundBounds={x0:number;x1:number;y0:number;y1:number}
const groundBounds=new WeakMap<readonly Cell[],WeakMap<readonly Module[],GroundBounds>>()

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

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/** The plan rect the window covers: explicit cells and module anchors, plus margin. */
export function groundWindow(
  cells: readonly Cell[],
  modules: readonly Module[],
  margin = GROUND_MARGIN,
): { x0: number; x1: number; y0: number; y1: number } {
  let byModules=groundBounds.get(cells)
  if(!byModules)groundBounds.set(cells,byModules=new WeakMap())
  const cached=byModules.get(modules)
  if(cached)return {x0:cached.x0-margin,x1:cached.x1+margin,y0:cached.y0-margin,y1:cached.y1+margin}
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const eat = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const c of cells) eat(c.x, c.y)
  for (const m of modules) {
    eat(m.x, m.y)
    if (m.type === 'road') eat(m.x + m.w - 1, m.y + m.d - 1)
    if (m.type === 'track') for (const [x, y] of trackCells(m)) eat(x, y)
    const run = m as { from?: { x: number; y: number }; to?: { x: number; y: number } }
    if (run.from) eat(run.from.x, run.from.y)
    if (run.to) eat(run.to.x, run.to.y)
  }
  if (!Number.isFinite(minX)) {
    // A station with nothing in it yet: the window is the origin the new
    // ground is built from, not an empty set no tool can address.
    minX=minY=maxX=maxY=0
  }
  byModules.set(modules,{x0:minX,x1:maxX,y0:minY,y1:maxY})
  return { x0: minX - margin, x1: maxX + margin, y0: minY - margin, y1: maxY + margin }
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
  return modules.some((m) => m.type === 'track' && !m.cfg.tunnel && !m.cfg.bridge && trackCellAt(m, x, y, GROUND_Z)) || rampOpeningAt(modules, x, y, GROUND_Z) || exitFloorAt(modules, x, y, GROUND_Z)
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
  const explicit = new Set<string>()
  // Only authored records at grade can suppress generated pavement.
  for (const c of cells) if(c.z===GROUND_Z)explicit.add(key(c.x, c.y, c.z))
  // The street's derived holes, enumerated by run and by head-house instead of
  // asked per street cell: `rampOpeningAt` rebuilds the run list per call, so a
  // window-wide loop over it was O(window × runs) — most of this function's
  // cost on a large station, paid on every commit (`prepareStation`,
  // `buildGraph`, the viewport's live sets). Same predicates, asked once each:
  // `rampOpeningsInWindow` scans each run's own bounding box with `intrudes`,
  // and an exit's footprint is exactly the cells `exitCoversCell` names.
  const openings = rampOpeningsInWindow(modules, GROUND_Z, w)
  for (const m of modules) {
    if (m.type === 'track' && m.z === GROUND_Z && !m.cfg.tunnel && !m.cfg.bridge) {
      for (const [x, y] of trackCells(m)) {
        if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1) openings.add(`${x},${y}`)
      }
      continue
    }
    if (m.type !== 'exit' || !isExitHeadHouse(m) || m.z !== GROUND_Z) continue
    for (const [x, y] of exitFootprintCells(m)) {
      if (x < w.x0 || x > w.x1 || y < w.y0 || y > w.y1) continue
      openings.add(`${x},${y}`)
    }
  }
  const out: Cell[] = []
  for (let x = w.x0; x <= w.x1; x++) {
    for (let y = w.y0; y <= w.y1; y++) {
      if(exclude&&x>=exclude.x0&&x<=exclude.x1&&y>=exclude.y0&&y<=exclude.y1){y=exclude.y1;continue}
      if (explicit.has(key(x, y, GROUND_Z))) continue
      if (openings.has(`${x},${y}`)) continue
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
