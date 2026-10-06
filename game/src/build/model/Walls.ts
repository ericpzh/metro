// Build model: walls — the 墙 tool, 半墙, and their tags (§5.1).
// Owns the WALL/AUTO_WALL/AUTO_WALL_H vocabulary; Floors.ts imports it.

import { storeyBand } from '../../sim/constants.ts';
import { thinWallCells } from '../../sim/openings.ts';
import { blockedCellsByLevel } from '../../sim/placement.ts';
import { blockReason } from '../validation.ts';
import { halfWallTag, shapeOf, TRI_SIDES, triangleTag, type CellShape, type TriangleKind, type TriSide, type WallSide } from '../../sim/types.ts';
import type { Cell, Module } from '../../sim/types.ts';
import { cellKey, hasTag } from './Cells.ts';
import type { StationState } from './State.ts';

/** Tag on an automatically raised wall block — never on a hand-placed one. */
export const AUTO_WALL = 'auto-wall';

/**
 * Height of a wall, in blocks: the player asked for a 4 m wall and one block is
 * one metre, so four courses stand above the floor.
 */
export const AUTO_WALL_H = 4;

/**
 * Tag on a wall block the 墙 tool laid. The tag is what lets the tool's
 * right-click find the whole column under the pointer — geometry alone cannot
 * tell a wall course from the floor it stands on. `AUTO_WALL` blocks answer the
 * same lookup, so a hand run and a generated ring can both be lifted in bulk.
 */
export const WALL = 'wall';

/**
 * The wall a 墙 tool drag lays: a full-height column on every cell of the run.
 * `cells` are the base cells the wall rises from (the hovered floor's top), so
 * the four courses are `z..z+3`.
 */
export function wallRun(cells: Array<[number, number, number]>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const [x, y, z] of cells) for (let dz = 0; dz < AUTO_WALL_H; dz++) out.push([x, y, z + dz]);
  return out;
}

/* ------------------------------------------------------- 墙-tool smart snapping */

/**
 * A horizontal direction, as a step in cell coordinates. `s` is `+y` because
 * `+y` is "north" in this codebase's plan (the axes note in the repo guide:
 * `n` is `+y`, `e` is `+x`). It is the same union a 半墙 stores as its panel side
 * (`sim/types.ts` `WallSide`), because both answer "which way does this wall
 * face".
 */
export type WallDir = WallSide;

/** The four directions, in the order the 墙 tool cycles them with **R**. */
export const WALL_DIRS: readonly WallDir[] = ['n', 'e', 's', 'w'];

const WALL_STEPS: Record<WallDir, readonly [number, number]> = {
  n: [0, 1],
  e: [1, 0],
  s: [0, -1],
  w: [-1, 0],
};

/** The 墙 tool's arrow id ↔ direction, the same quarter-turns `rot` uses. */
const WALL_ROT_DIR: readonly WallDir[] = ['s', 'w', 'n', 'e'];

/**
 * The direction a pointer offset points at, snapped to the nearer of the two
 * axes it spans. The 墙 tool works in whole cells, so "which edge is the pointer
 * beyond" is a quadrant test, not a distance: a purely diagonal offset resolves
 * to `dx >= dy` (east or west) by the tie rule below.
 */
export function wallPointerDir(dx: number, dy: number): WallDir {
  const ex = Math.abs(dx);
  const ey = Math.abs(dy);
  if (ex === 0 && ey === 0) return 's'; // dead centre: the tool's own default face
  if (ex >= ey) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 'n' : 's';
}

/**
 * The quarter-turn that faces `dir` — the *output* of a snap, never an input to
 * one. A snapped wall face is turned back into the placement rotation so the
 * rest of the tool (and anything mounted on the wall) reads one convention.
 */
export function wallDirRot(dir: WallDir): number {
  return WALL_ROT_DIR.indexOf(dir);
}

/** True when no wall course of either kind stands at `(x, y, z)`. */
function wallAbsent(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  return !cells.some((c) => c.x === x && c.y === y && c.z === z && isWallCell(c));
}

/** True when a solid floor block stands at `(x, y, z)`. */
function wallFloor(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  return cells.some((c) => c.x === x && c.y === y && c.z === z && c.fill === 'solid');
}

/**
 * The directions in which `(x, y, z)` faces open space — the edges the 墙 tool
 * walls, and the same edge the 方块 auto-wall ring picks (`syncAutoWalls`).
 *
 * An edge is open when the neighbour carries **no wall** and **no floor** on
 * this storey. The wall half is what stops the tool offering a side that already
 * carries a wall; the floor half is what makes "buried" mean anything — without
 * it a cell in the middle of a floor would read as open on all four sides,
 * because the cells around it are floor rather than wall, and it would never
 * step out to the edge that actually wants a wall.
 */
function wallVoidEdges(cells: readonly Cell[], x: number, y: number, z: number): WallDir[] {
  const out: WallDir[] = [];
  for (const d of WALL_DIRS) {
    const [dx, dy] = WALL_STEPS[d];
    const nx = x + dx;
    const ny = y + dy;
    if (wallAbsent(cells, nx, ny, z) && !wallFloor(cells, nx, ny, z)) out.push(d);
  }
  return out;
}

/**
 * Where the 墙 tool stands the next column, and which of its wall faces it
 * takes. This is the tool's smart snap (§5.1).
 *
 * A wall is a full-height 1 m course, so a snap cannot slide a block *within* a
 * cell the way a fence panel or a billboard slides. It picks the cell and the
 * face instead, by these rules:
 *
 *  1. **A clean edge wins.** A floor cell with exactly one open edge is walled
 *     where it stands, facing that edge — the ordinary case, and the whole outer
 *     ring of a drawn patch.
 *  2. **A corner is a choice, and R is that choice.** A cell open on two or more
 *     sides stays put, and the chosen direction decides which face the column
 *     takes. **R** steps through the candidates best-first, so at a corner it
 *     picks which wall the course continues.
 *  3. **Only a cell with no edge of its own moves.** A cell buried inside a
 *     floor is closed on every side, so the column steps to the nearest
 *     neighbour that does face open space, faced back toward the hovered cell.
 *
 * "Open" is `wallVoidEdges`: no wall **and** no floor in the neighbour.
 *
 * **Orientation is never an input.** The snap is a pure function of the geometry
 * around the hovered cell, so the column lands the same way whatever the player
 * last pressed R for. R only steps through the candidates the geometry already
 * produced — it can never change *where* the wall goes, only which of two equally
 * valid faces at a corner is taken. Treating a placement rotation as the
 * starting point (the way a fence panel or a billboard takes `rot`) is exactly
 * the trap: it makes the player turn the piece before the tool will agree with
 * them, instead of the tool reading the wall and turning the piece itself.
 *
 * `cells` is the station's cell list, `cell` the hovered base cell, `z` the
 * storey the wall rises from, and `pointer` the pointer's world `[x, y]` when
 * the caller has one — it only breaks a tie, so a rule still holds without it.
 * `cycle` is how many times **R** has stepped the candidate list; it wraps, so
 * the choice is always valid.
 */
export interface WallSnap {
  /** The base cell the column rises from. */
  x: number;
  y: number;
  z: number;
  /** The face the column shows to open space — the candidate `cycle` picked. */
  dir: WallDir;
  /** Every direction **R** may choose, best-first. */
  dirs: WallDir[];
}

export function wallSnap(
  cells: readonly Cell[],
  cell: readonly [number, number, number],
  pointer: readonly [number, number] | null = null,
  cycle = 0,
): WallSnap {
  const [ax, ay, az] = cell;
  const auto: WallDir | null = pointer === null ? null : wallPointerDir(pointer[0] - (ax + 0.5), pointer[1] - (ay + 0.5));
  const here = wallVoidEdges(cells, ax, ay, az);
  const pick = (dirs: WallDir[]): WallDir => dirs[((cycle % dirs.length) + dirs.length) % dirs.length];

  // Rules 1 and 2: the column stays where it is; only its face is in question.
  if (here.length > 0) {
    const dirs: WallDir[] = [];
    const offer = (d: WallDir | null): void => {
      if (d !== null && here.includes(d) && !dirs.includes(d)) dirs.push(d);
    };
    offer(auto);
    for (const d of WALL_DIRS) offer(d);
    return { x: ax, y: ay, z: az, dir: pick(dirs), dirs };
  }

  // Rule 3: no edge here, so step to the nearest neighbour that has one.
  let best: { x: number; y: number; dir: WallDir; dist: number } | null = null;
  for (let x = ax - 1; x <= ax + 1; x++) {
    for (let y = ay - 1; y <= ay + 1; y++) {
      if (x === ax && y === ay) continue;
      const edges = wallVoidEdges(cells, x, y, az);
      if (edges.length === 0) continue;
      const dist = Math.abs(x - ax) + Math.abs(y - ay);
      if (best !== null && dist >= best.dist) continue;
      // Face back at the hovered cell, so the wall still points at the aim.
      // (Also independent of orientation: the neighbour's first valid edge is
      // the fallback, not a remembered rotation.)
      const back = wallPointerDir(ax - x, ay - y);
      best = { x, y, dir: edges.includes(back) ? back : edges[0], dist };
    }
  }
  if (best !== null) return { x: best.x, y: best.y, z: az, dir: best.dir, dirs: [best.dir] };
  // Nowhere nearby has an edge either (a lone buried cell): stand it on the
  // tool's own default face and let `addWalls` report the reserved opening or
  // the missing floor.
  return { x: ax, y: ay, z: az, dir: 's', dirs: ['s'] };
}

/**
 * Lay a 墙-tool run: full-height wall columns, tagged `WALL` so a later
 * right-click can lift the whole column. Like `addCells`, a reserved opening is
 * refused. Returns the same state when every course already existed.
 *
 * `side` lays the run as **半墙** instead: the same column, tagged with the half of
 * the cell its panel hugs (`halfWallTag`) so the mesher draws it half a block
 * thick. It is one side for the whole run, because a run is one wall: its panels
 * line up and the cells between them join, which is what makes a dragged 半墙 read
 * as a wall rather than as a row of slots.
 *
 * `triangle` lays the run as **三角** instead: the same course, tagged with the side
 * of its cell the wedge hugs and which of the two cuts it is (`triangleTag`), so the
 * mesher draws the 45° wedge the player aimed at. It is the 方块 tool's third mode,
 * one block at a time like its 半墙 — a cut is a shape being placed, not a wall being
 * run.
 *
 * `height` is how many courses rise from each base cell. The 墙 tool always wants
 * the full 4 m column (`AUTO_WALL_H`); the 方块 tool's 半墙 / 三角 modes lay one
 * block at a time, so they pass 1 — a single tagged course per click that the
 * player stacks by hand.
 */
export function addWalls(
  state: StationState,
  baseCells: Array<[number, number, number]>,
  side: WallDir | null = null,
  height: number = AUTO_WALL_H,
  triangle: { kind: TriangleKind; side: TriSide } | null = null,
): { state: StationState; changed: number; blocked: number } {
  const have = new Set(state.cells.map((c) => cellKey(c.x, c.y, c.z)));
  const tags =
    triangle !== null ? [WALL, triangleTag(triangle.kind, triangle.side)] : side === null ? [WALL] : [WALL, halfWallTag(side)];
  const added: Cell[] = [];
  let blocked = 0;
  const run = height === AUTO_WALL_H ? wallRun(baseCells) : baseCells.flatMap(([x, y, z]) => Array.from({ length: height }, (_, dz) => [x, y, z + dz] as [number, number, number]));
  const level = blockedCellsByLevel(state.modules);
  for (const [x, y, z] of run) {
    const k = cellKey(x, y, z);
    if (have.has(k)) continue;
    // One rule set for every course, whatever laid it: a wall may no more fill a
    // reserved opening or a cell a piece of equipment holds than a block may.
    if (!blockReason(state.cells, state.modules, x, y, z, level).ok) {
      blocked++;
      continue;
    }
    have.add(k);
    added.push({ x, y, z, fill: 'solid', tags: [...tags] });
  }
  if (added.length === 0) return { state, changed: 0, blocked };
  return { state: { ...state, cells: [...state.cells, ...added] }, changed: added.length, blocked };
}

/**
 * True for a cell the 墙 tool owns: a course it laid (full, 半墙 or 三角), or an
 * auto-generated one. All of them are the same 4 m wall to the player, so the tool
 * must be able to lift an `AUTO_WALL` ring exactly like its own run.
 */
function isWallCell(c: Cell): boolean {
  return hasTag(c, WALL) || hasTag(c, AUTO_WALL) || shapeOf(c) !== null;
}

/* -------------------------------------------------------- 半墙 thickness (R) */

/**
 * The panel sides a 半墙 run may take, best-first, for the **R** cycle.
 *
 * A full wall has no thickness to choose, so **R** there only ever steps through
 * the faces the geometry already offers (`wallSnap`). A 半墙 does: a partition
 * standing in open floor has no edge to read, and the half of the tile it keeps is
 * the player's decision. So the candidates are the geometry's own faces first —
 * which is why laying a 半墙 along a patch edge hugs the edge with no key pressed,
 * exactly where a full wall would have stood — then the rest.
 *
 * A run is the one case the geometry has to constrain: the panels of a dragged
 * wall are perpendicular to it (a side *along* the run would leave a slot between
 * column and column), so a run offers only its two sides, the one facing open
 * space first. A single column has no axis, and offers all four.
 */
export function halfWallSideDirs(baseCells: Array<[number, number, number]>, open: readonly WallDir[]): WallDir[] {
  const alongX = baseCells.every((c) => c[1] === baseCells[0][1]);
  const alongY = baseCells.every((c) => c[0] === baseCells[0][0]);
  const pair: WallDir[] | null =
    baseCells.length > 1 && alongX !== alongY ? (alongX ? ['n', 's'] : ['e', 'w']) : null;
  if (pair === null) {
    const out = open.filter((d) => WALL_DIRS.includes(d));
    for (const d of WALL_DIRS) if (!out.includes(d)) out.push(d);
    return out;
  }
  return [...pair.filter((d) => open.includes(d)), ...pair.filter((d) => !open.includes(d))];
}

/** The side **R** has stepped to, wrapped, for the run of `baseCells`. */
export function halfWallRunSide(baseCells: Array<[number, number, number]>, open: readonly WallDir[], cycle: number): WallDir {
  const dirs = halfWallSideDirs(baseCells, open);
  return dirs[((cycle % dirs.length) + dirs.length) % dirs.length];
}

/* --------------------------------------------------------- 三角 side (R) */

/**
 * The sides a **三角** click may hug, best-first: the ones the block's own geometry
 * opens onto (`open`, the faces `wallSnap` read) before the rest.
 *
 * A wedge has no thickness to choose and no axis to be perpendicular to — the cell
 * is cut across it whichever way it is turned — so all four sides are always on
 * offer. The geometry only decides the order, so a 三角 dropped against an open edge
 * stands its full-height face there with no key pressed, exactly as a 半墙 dropped on
 * a patch edge hugs the edge: the piece hugs the wall rather than cutting its slope
 * into it. **R** then steps the rest — four presses, four sides, and round again.
 */
export function triangleSideDirs(open: readonly WallDir[]): TriSide[] {
  const rank = (d: WallDir): number => {
    const i = open.indexOf(d);
    return i < 0 ? open.length + WALL_DIRS.length : i;
  };
  return [...TRI_SIDES].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    // Equal ranks keep the clockwise order, so **R** still walks the cell.
    return ra === rb ? TRI_SIDES.indexOf(a) - TRI_SIDES.indexOf(b) : ra - rb;
  });
}

/** The side **R** has stepped to, wrapped, for a 三角 click. */
export function triangleRunSide(open: readonly WallDir[], cycle: number): TriSide {
  const dirs = triangleSideDirs(open);
  return dirs[((cycle % dirs.length) + dirs.length) % dirs.length];
}

/**
 * Every block of a station that draws as **less than a whole cell**, by cell key →
 * the shape it draws: a 半墙 the player laid, a **三角** wedge they laid, plus every
 * block a ramp kept beside its run (`sim/openings.ts` `thinWallCells`, the one list
 * the mesher also draws from). The app reads it to decide which faces a paint brush
 * may colour (`faceTargets`), and the builder applies the same rule to a flood fill
 * (`fillSurface`) — so a stair's own half wall is a surface the 材质 brush knows
 * about, not only the ones a player laid by hand.
 */
export function thinWallSideMap(cells: readonly Cell[], modules: readonly Module[] = []): Map<string, CellShape> {
  const out = new Map<string, CellShape>();
  for (const t of thinWallCells(cells, modules)) out.set(cellKey(t.x, t.y, t.z), t.shape);
  return out;
}

/**
 * The whole 墙-tool column through `(x, y, z)`, limited to the hit's own
 * storey: the contiguous run of wall cells above and below the hit that share
 * its `storeyBand`, whether the pointer landed on the base, the middle or the
 * top. A stacked column across two storeys therefore lifts one storey at a
 * time (at B1 that is `z..z+3`, e.g. -4..-1), and the top course that belongs
 * to the storey above — an auto-wall ring's `z+4` roof — is left alone. An
 * auto-generated wall answers too, so the tool can open a doorway in an
 * auto-wall ring. Empty when the cell is not a wall of either kind.
 */
export function wallColumnAt(state: StationState, x: number, y: number, z: number): Array<[number, number, number]> {
  const band = storeyBand(z);
  const tagged = new Set<number>();
  for (const c of state.cells) if (c.x === x && c.y === y && isWallCell(c)) tagged.add(c.z);
  if (!tagged.has(z)) return [];
  let a = z;
  while (tagged.has(a - 1) && storeyBand(a - 1) === band) a--;
  let b = z;
  while (tagged.has(b + 1) && storeyBand(b + 1) === band) b++;
  const out: Array<[number, number, number]> = [];
  for (let zz = a; zz <= b; zz++) out.push([x, y, zz]);
  return out;
}

/**
 * Every 墙-tool column through a set of cells — the right-drag's erase set. The
 * per-cell columns are de-duplicated, so a drag whose line touches the same
 * column twice never repeats a block.
 */
export function wallColumnsAt(
  state: StationState,
  cells: Array<[number, number, number]>,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  for (const [x, y, z] of cells) {
    for (const p of wallColumnAt(state, x, y, z)) {
      const k = cellKey(p[0], p[1], p[2]);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}
