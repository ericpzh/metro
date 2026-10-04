// Street exit head-house (出入口) geometry — the numbers shared by the sim and
// the renderer, so the crowd and the drawing agree on where the opening is.
//
// The sim uses them to place the exit's street-opening node and to make the
// head-house solid: the crowd crosses at the opening and never through the glass
// sides or the back wall (§5.6). Pure data — no three, no DOM.

import type { ExitBays, Module, Vec3i } from './types.ts'
import { ESCALATOR_BAND, ESCALATOR_RAIL_PROUD, STAIR_RAIL_PROUD } from './constants.ts'
import { LIFT_SIZE } from './lifts.ts'
import { STAIR_RISE, STAIR_RUN, STAIR_WIDTH_NARROW, stairRotFor } from './stairs.ts'

/**
 * Width of the reference 双向 head-house, metres: four blocks — two runs standing
 * side by side with one full block of floor each side (see `exitSpan`). `exitWidth`
 * scales it with the bay count, so this is the two-bay width and nothing else.
 */
export const EXIT_W = 4.0
/**
 * Half-width of the wellway one run opens in the head-house floor — its own
 * block. A run that is wider than a block (a 1.6 m public stair, a 2 × 2 lift)
 * opens wider, so its rails never surface through the floor beside it
 * (`exitRunHalf`).
 */
export const EXIT_BAY_HALF = 0.5
/** Length of the enclosed part: local y ∈ [−EXIT_L/2, +EXIT_L/2]. */
export const EXIT_L = 4.0
/** Canopy height above the walk, metres. */
export const EXIT_H = 3.2
/** How far the canopy reaches over the escalator run (−y), metres. */
export const EXIT_REACH = 5.6
/** Canopy overhang past the street doorway (+y), metres. */
export const EXIT_BACK = 2.3
/**
 * The street opening, in cells north of the module cell. The head-house is drawn
 * with its doorway at local +2, i.e. world y = module.y + 2.5 — the centre of the
 * cell two north of the module. That cell is the exit's graph node, so the crowd
 * walks in and out through the opening instead of teleporting under the canopy.
 */
export const EXIT_DOOR_Y = 2
/**
 * Back wall, local y. Lands on a cell boundary (world y = module.y − 5) so the
 * sim can drop the crossing row cleanly instead of sitting on a node.
 */
export const EXIT_BACK_Y = -5.5
/** Glass side planes, half-width from the head-house centre — just inside the frame. */
export const EXIT_SIDE = EXIT_W / 2 - 0.06
/** Glass sides, local y extent: the run's end up to just short of the doorway. */
export const EXIT_GLASS_Y0 = -5.5
export const EXIT_GLASS_Y1 = 1.8

export type ExitModule = Extract<Module, { type: 'exit' }>

/** The default bay count of an exit: the reference 双向 head-house. */
export const DEFAULT_EXIT_BAYS: ExitBays = 2

/** Normalise the bay count: only 1, 2 or 3 are valid; anything else reads 2. */
export function exitBays(m: ExitModule): ExitBays {
  return m.cfg.bays === 1 || m.cfg.bays === 3 ? m.cfg.bays : DEFAULT_EXIT_BAYS
}

/**
 * The local x columns an exit's runs stand in: **side by side**, one run per bay
 * — a 单向 at 0, a 双向 at 0 and 1, a 三向 at 0, 1 and 2. The player drops a stair
 * or escalator on each; the head-house is built around the group, with one full
 * block of floor at each end (`exitSpan`), so the three variants are 3, 4 and 5
 * blocks across.
 */
export function exitBayOffsets(bays: ExitBays): number[] {
  const out: number[] = []
  for (let i = 0; i < bays; i++) out.push(i)
  return out
}

/**
 * Width of the run group a head-house is built for, metres: one block per bay
 * plus a full block of floor each side — 3 / 4 / 5 blocks for the 单向 / 双向 /
 * 三向.
 */
export function exitWidth(bays: ExitBays): number {
  return bays + 2
}

/** The glass/railing side plane's half-width from the head-house centre, metres. */
export function exitSide(bays: ExitBays): number {
  return exitWidth(bays) / 2 - 0.06
}

/** The local x the runs of a flush bay group are centred on. */
export function exitCentre(bays: ExitBays): number {
  return (bays - 1) / 2
}

/**
 * The half-width of wellway one run needs in the head-house floor: its own
 * block, or its swept width if the run is wider than a block (a 1.6 m stair, a
 * 2 × 2 lift). A narrow stair and an escalator both reach under 0.5 m, so the
 * floor keeps a full block beside them.
 */
export function exitRunHalf(run: Module): number {
  const swept =
    run.type === 'escalator'
      ? ESCALATOR_BAND / 2 + ESCALATOR_RAIL_PROUD
      : run.type === 'stair'
        ? (run.cfg.width ?? STAIR_WIDTH_NARROW) / 2 + STAIR_RAIL_PROUD
        : run.type === 'lift'
          ? LIFT_SIZE / 2
          : 0
  return Math.max(EXIT_BAY_HALF, swept)
}

/** The plan a head-house covers: the local x of its centre, and its half-width. */
export interface ExitSpan {
  /** Local x the head-house is built around, metres. */
  centre: number
  /** Half-width of its floor plate, metres. */
  half: number
}

/** The upper (street) landing of a run — the end that stands under the exit. */
function runTop(run: Module): Vec3i | null {
  if (run.type !== 'escalator' && run.type !== 'stair' && run.type !== 'lift') return null
  return run.from.z >= run.to.z ? run.from : run.to
}

/**
 * The local x columns of the runs that belong to this head-house: their upper
 * landings on the exit's level, under its own length, inside a generous window
 * across it. A run saved under the old two-metre bay spacing is still found here,
 * so the house can widen to cover it rather than let it poke through the glass.
 */
function exitRunColumns(modules: readonly Module[], m: ExitModule): number[] {
  const bays = exitBays(m)
  const nominal = exitBayOffsets(bays)
  const lo = Math.min(...nominal) - bays
  const hi = Math.max(...nominal) + bays
  const out: number[] = []
  for (const run of modules) {
    const top = runTop(run)
    if (!top || top.z !== m.z) continue
    const [lx, ly] = exitLocal(top.x - m.x, top.y - m.y, m.rot)
    // Under the head-house's own length (mouth to street doorway) — never a run
    // elsewhere in the station that merely lines up across it.
    if (ly < EXIT_BACK_Y || ly > EXIT_BACK) continue
    if (lx < lo || lx > hi) continue
    if (!out.includes(lx)) out.push(lx)
  }
  return out
}

/**
 * The plan a head-house is drawn over and lays floor on: the columns its runs
 * stand in — the flush bay group, or wherever a saved station's runs really are
 * — with one full block of floor at each end. A 双向 with its runs side by side
 * is therefore four blocks across with a whole block of pad each side; a station
 * saved on the old two-metre bays widens to cover them instead of breaking.
 */export function exitSpan(m: ExitModule, modules: readonly Module[] = []): ExitSpan {
  const columns = [...exitBayOffsets(exitBays(m)), ...exitRunColumns(modules, m)]
  // Half a block for the outermost run's own cell, plus a whole block of pad.
  const margin = EXIT_BAY_HALF + 1
  const lo = Math.min(...columns) - margin
  const hi = Math.max(...columns) + margin
  return { centre: (lo + hi) / 2, half: (hi - lo) / 2 }
}

/** A thin barrier plane of a head-house, in world space (see `station.ts`). */
export interface ExitWall {
  axis: 'x' | 'y'
  at: number
  min: number
  max: number
}

/** A quarter-turn `rot` normalised to 0..3. */
function quarter(rot: number | undefined): number {
  return (((rot ?? 0) % 4) + 4) % 4
}

/**
 * Rotate a point in the exit's local plan (x across the bays, y along the run,
 * mouth at −y, street doorway at +y) into world offsets, by the placement
 * rotation. Matches the renderer's `group.rotation.z = rot·π/2`, so the drawing
 * and the sim geometry never drift apart.
 */
function exitRotate(lx: number, ly: number, rot: number | undefined): [number, number] {
  switch (quarter(rot)) {
    case 1:
      return [-ly, lx]
    case 2:
      return [-lx, -ly]
    case 3:
      return [ly, -lx]
    default:
      return [lx, ly]
  }
}

/** A world plan offset in the exit's own frame — the inverse of `exitRotate`. */
function exitLocal(wx: number, wy: number, rot: number | undefined): [number, number] {
  switch (quarter(rot)) {
    case 1:
      return [wy, -wx]
    case 2:
      return [-wx, -wy]
    case 3:
      return [-wy, wx]
    default:
      return [wx, wy]
  }
}

/**
 * The plan bounds an exit head-house lays floor over: the runs' group with one
 * full block of floor at each end (`exitSpan`), from the back wall to the canopy
 * overhang past the street doorway (see `buildExit` in `render/models.ts`). The
 * rectangle is turned by the placement rotation, so a rotated head-house covers
 * the ground it actually draws on. World-space, half-open: [x0,x1) × [y0,y1).
 */
export function exitFloorBounds(
  m: ExitModule,
  modules: readonly Module[] = [],
): { x0: number; y0: number; x1: number; y1: number } {
  const cx = m.x + 0.5
  const cy = m.y + 0.5
  const rot = quarter(m.rot)
  const { centre, half } = exitSpan(m, modules)
  const lo = centre - half
  const hi = centre + half
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [lx, ly] of [
    [lo, EXIT_BACK_Y],
    [hi, EXIT_BACK_Y],
    [lo, EXIT_BACK],
    [hi, EXIT_BACK],
  ] as Array<[number, number]>) {
    const [wx, wy] = exitRotate(lx, ly, rot)
    x0 = Math.min(x0, cx + wx)
    x1 = Math.max(x1, cx + wx)
    y0 = Math.min(y0, cy + wy)
    y1 = Math.max(y1, cy + wy)
  }
  return { x0, y0, x1, y1 }
}

/**
 * The exit's street-opening cell — the graph node the crowd walks in and out
 * through. Local +y is the doorway, so the rotation carries it round with the
 * drawn head-house. It sits on the head-house's own centre line, on the middle
 * cell of an even-width plan.
 */
export function exitDoorCell(m: ExitModule, modules: readonly Module[] = []): [number, number, number] {
  const { centre } = exitSpan(m, modules)
  const [dx, dy] = exitRotate(Math.round(centre), EXIT_DOOR_Y, m.rot)
  return [m.x + dx, m.y + dy, m.z]
}

/**
 * The world cell a run column lands on at the exit row (local x = `column`,
 * local y = 0), turned by the placement rotation. The renderer uses it to tell
 * which columns a run actually descends through, so the floor pad opens only
 * there.
 */
export function exitBayCell(m: ExitModule, column: number): [number, number, number] {
  const [dx, dy] = exitRotate(column, 0, m.rot)
  return [m.x + dx, m.y + dy, m.z]
}

/** One run's wellway in the head-house floor: the column it lands in, and its half-width. */
export interface ExitRunOpening {
  column: number
  half: number
}

/**
 * The runs whose upper landing sits under this exit — the wellways its floor pad
 * must open for, and the columns its interior dividers stand between. Derived
 * from the runs actually placed rather than from the bay list, so a station saved
 * on the old two-metre bays opens exactly the wellways it had.
 */
export function exitRunOpenings(modules: readonly Module[], m: ExitModule): ExitRunOpening[] {
  const out: ExitRunOpening[] = []
  const seen = new Set<number>()
  for (const run of modules) {
    const top = runTop(run)
    if (!top || top.z !== m.z) continue
    if (!exitCoversCell(m, modules, top.x, top.y, top.z)) continue
    const [lx] = exitLocal(top.x - m.x, top.y - m.y, m.rot)
    if (seen.has(lx)) continue
    seen.add(lx)
    out.push({ column: lx, half: exitRunHalf(run) })
  }
  return out.sort((a, b) => a.column - b.column)
}

/**
 * A ramp dropped into an exit head-house: its upper landing snapped to one of
 * the head-house's run columns and descending one storey toward the mouth, so its
 * lower landing sits on the concourse below. The pointer then controls the run's
 * position on the *street* floor, not the base it stands on — the special
 * placement the head-house's known holes allow. Null when `(x, y, z)` is not
 * under an exit.
 *
 * The runs are **side by side**: the column is the one under the pointer clamped
 * to the bay group (0 … bays − 1), and the along-run row is fixed — the run lands
 * on the exit's own row, so it descends through the wellway its floor pad opens.
 */
export interface ExitRunSnap {
  /** The head-house the pointer is inside. */
  exit: ExitModule
  /** Local x of the column the run lands in — the bay it occupies. */
  bay: number
  /** The run's upper landing: the bay cell at the exit's level. */
  top: Vec3i
  /** The run's lower landing, one storey below and toward the mouth. */
  base: Vec3i
  /** Placement rotation for a straight run climbing base → top. */
  rot: number
}

export function exitRunSnap(modules: readonly Module[], x: number, y: number, z: number): ExitRunSnap | null {
  const exit = modules.find((m): m is ExitModule => m.type === 'exit' && exitCoversCell(m, modules, x, y, z))
  if (!exit) return null
  const [lx] = exitLocal(x - exit.x, y - exit.y, exit.rot)
  const bays = exitBays(exit)
  const bay = Math.max(0, Math.min(bays - 1, lx))
  const [tx, ty, tz] = exitBayCell(exit, bay)
  // The run climbs from the mouth (local −y) up to the bay, so its base lies a
  // full run back along the head-house's own +y, one storey down.
  const [fx, fy] = exitRotate(0, 1, exit.rot)
  return {
    exit,
    bay,
    top: { x: tx, y: ty, z: tz },
    base: { x: tx - fx * STAIR_RUN, y: ty - fy * STAIR_RUN, z: tz - STAIR_RISE },
    rot: stairRotFor(fx, fy),
  }
}

/**
 * The head-house's solid planes — the two glass sides and the back wall — turned
 * by the placement rotation. Each is a thin axis-aligned plane, which is all a
 * quarter-turn of the local planes ever produces. The sides stand at the plan's
 * edges (`exitSpan`), so they always clear the runs the house holds.
 */
export function exitWallPlanes(m: ExitModule, modules: readonly Module[] = []): ExitWall[] {
  const cx = m.x + 0.5
  const cy = m.y + 0.5
  const rot = quarter(m.rot)
  const { centre, half } = exitSpan(m, modules)
  const side = half - 0.06
  const walls: ExitWall[] = []
  const seg = (lx0: number, ly0: number, lx1: number, ly1: number): void => {
    const [ax, ay] = exitRotate(lx0, ly0, rot)
    const [bx, by] = exitRotate(lx1, ly1, rot)
    if (Math.abs(ax - bx) < 1e-9) {
      walls.push({ axis: 'x', at: cx + ax, min: cy + Math.min(ay, by), max: cy + Math.max(ay, by) })
    } else {
      walls.push({ axis: 'y', at: cy + ay, min: cx + Math.min(ax, bx), max: cx + Math.max(ax, bx) })
    }
  }
  for (const s of [-1, 1]) seg(centre + s * side, EXIT_GLASS_Y0, centre + s * side, EXIT_GLASS_Y1)
  seg(centre - side, EXIT_BACK_Y, centre + side, EXIT_BACK_Y)
  return walls
}

/** True when cell `(x, y, z)` lies under an exit's floor, on the exit's level. */
export function exitCoversCell(m: ExitModule, modules: readonly Module[], x: number, y: number, z: number): boolean {
  if (z !== m.z) return false
  const b = exitFloorBounds(m, modules)
  return x + 1 > b.x0 && x < b.x1 && y + 1 > b.y0 && y < b.y1
}

/** Every floor cell an exit covers on its own level, holes included. */
export function exitFootprintCells(m: ExitModule, modules: readonly Module[] = []): Array<[number, number, number]> {
  const b = exitFloorBounds(m, modules)
  const out: Array<[number, number, number]> = []
  for (let x = Math.floor(b.x0); x < b.x1; x++) {
    for (let y = Math.floor(b.y0); y < b.y1; y++) {
      out.push([x, y, m.z])
    }
  }
  return out
}

/**
 * True when cell `(x, y, z)` counts as floor because an exit covers it — even
 * when a ramp carved a hole there. Placement treats exit-covered cells as
 * solid floor, so stairs and escalators can land through an exit.
 */
export function exitFloorAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  for (const m of modules) {
    if (m.type === 'exit' && exitCoversCell(m, modules, x, y, z)) return true
  }
  return false
}
