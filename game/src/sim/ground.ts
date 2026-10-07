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
import { exitFloorAt } from './exits.ts'
// Function-level cycle with `openings.ts` (it reads `virtualSolidAt` for the
// escalator landings): both sides only call across at runtime, never at module
// evaluation, so the bindings are settled by the first call.
import { rampOpeningAt } from './openings.ts'
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

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/** The plan rect the window covers: explicit cells and module anchors, plus margin. */
export function groundWindow(
  cells: readonly Cell[],
  modules: readonly Module[],
  margin = GROUND_MARGIN,
): { x0: number; x1: number; y0: number; y1: number } {
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
    const run = m as { from?: { x: number; y: number }; to?: { x: number; y: number } }
    if (run.from) eat(run.from.x, run.from.y)
    if (run.to) eat(run.to.x, run.to.y)
  }
  if (!Number.isFinite(minX)) {
    // A station with nothing in it yet: the window is the origin the new
    // ground is built from, not an empty set no tool can address.
    return { x0: -margin, x1: margin, y0: -margin, y1: margin }
  }
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
  return rampOpeningAt(modules, x, y, GROUND_Z) || exitFloorAt(modules, x, y, GROUND_Z)
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
  const explicit = new Set<string>()
  for (const c of cells) explicit.add(key(c.x, c.y, c.z))
  const out = cells.slice() as Cell[]
  for (let x = w.x0; x <= w.x1; x++) {
    for (let y = w.y0; y <= w.y1; y++) {
      if (explicit.has(key(x, y, GROUND_Z))) continue
      if (rampOpeningAt(modules, x, y, GROUND_Z) || exitFloorAt(modules, x, y, GROUND_Z)) continue
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
  return out
}
