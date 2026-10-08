// Build model: cells — the sparse cell list primitives (§4.1).
// Leaf module: only sim/ imports plus a type-only StationState.

import { levelSteps } from '../../sim/constants.ts';
import { groundHoleAt, virtualSolidAt } from '../../sim/ground.ts';
import { blockedCellsByLevel } from '../../sim/placement.ts';
import { blockReason } from '../validation.ts';
import type { Cell, Module } from '../../sim/types.ts';
import type { StationState } from './State.ts';

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * Snap an arbitrary z to the nearest fixed storey. The storey grid itself lives
 * in `sim/constants.ts` (`LEVEL_STEPS`); Q/E steps through it and the depth rail
 * lists exactly it, so the work plane is always on the 4-unit grid the reference
 * station is built on (G = 0, B1 = -4, B2 = -8) instead of jumping between
 * whatever z values happen to have walkable cells.
 */
export function nearestLevel(z: number, base = 0): number {
  const levels = levelSteps(base);
  let best = levels[0];
  for (const l of levels) if (Math.abs(l - z) < Math.abs(best - z)) best = l;
  return best;
}

/**
 * The z of the at-grade (street) level — h = 0 m. A surface exit head-house is
 * rooted here and nowhere else: its opening and canopy belong at the ground, not
 * on a concourse or platform slab. There are no named levels any more; the
 * street is simply z = 0 — and there is **one** definition of it, owned by
 * `sim/ground.ts`, because that is the module the plane is stored inverted in.
 */
export { GROUND_Z } from '../../sim/ground.ts';

export function cloneCell(c: Cell): Cell {
  return c.finish ? { ...c, finish: { ...c.finish } } : { ...c };
}

export function hasTag(c: { tags?: string[] }, tag: string): boolean {
  return c.tags?.includes(tag) === true;
}

/** The four in-plane neighbours, for the zone-area flood the labels ride on. */
export const NEIGH4: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function isSolid(cells: Cell[], x: number, y: number, z: number): boolean {
  for (const c of cells) if (c.x === x && c.y === y && c.z === z && c.fill === 'solid') return true;
  return false;
}

/**
 * Add solid cells, ignoring ones that are already solid and refusing any the one
 * placement rule set rejects (`blockReason`, `sim/placement.ts`): a reserved opening
 * — a ramp's carved corridor or an exit's floor — a cell a piece of equipment
 * already stands in, or a rail's dug bed. Without the first guard the block brush
 * could fill an auto-generated hole and seal a stair, escalator or exit in; without
 * the second it could pour a block into a 闸机, a 售票机, a 座椅 or a 房间 and leave
 * the piece buried in the new floor; without the third it would fill the trench.
 * Every one of them is counted, so the number here and the red boxes the preview
 * draws are the same number. Returns the cells added and how many were refused.
 */
export function addCells(
  cells: Cell[],
  add: Array<[number, number, number]>,
  modules: readonly Module[] = [],
): { cells: Cell[]; changed: number; blocked: number } {
  // "Already there" means already **solid**. A `void` record is the street's own
  // hole (`sim/ground.ts`) and the one thing a drag may legitimately fill back —
  // `checkBlockCells` offers exactly that cell, so a `have` set built from every
  // record instead of every block made the ghost promise a block the release
  // dropped (`addCells(cells, [[x, y, 0]])` on a dug hole returned `changed: 0`).
  const have = new Set(cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)));
  // Where each record sits, so a hole is **replaced** rather than shadowed: the
  // document holds one record per coordinate, and appending a second block beside
  // a `void` would leave which one wins to iteration order.
  const at = new Map<string, number>();
  cells.forEach((c, i) => at.set(cellKey(c.x, c.y, c.z), i));
  const out = cells.slice();
  let changed = 0;
  let blocked = 0;
  // One set per level, built once for the whole rectangle: equipment is sparse, so
  // this is the same handful of modules every time a drag asks about another cell.
  const level = blockedCellsByLevel(modules);
  for (const [x, y, z] of add) {
    // The street is already solid: laying a block into virtual ground is a
    // no-op, not a duplicate record — the document stays the delta from the
    // plane, so saves never carry the horizon.
    if (have.has(cellKey(x, y, z)) || virtualSolidAt(cells, modules, x, y, z)) continue;
    if (!blockReason(cells, modules, x, y, z, level).ok) {
      blocked++;
      continue;
    }
    const k = cellKey(x, y, z);
    have.add(k);
    const hole = at.get(k);
    if (hole === undefined) out.push({ x, y, z, fill: 'solid' });
    else out[hole] = { x, y, z, fill: 'solid' };
    changed++;
  }
  return { cells: out, changed, blocked };
}

/** Remove solid cells and any modules hosted on them. */
export function removeCells(state: StationState, remove: Array<[number, number, number]>): StationState {
  const kill = new Set(remove.map(([x, y, z]) => cellKey(x, y, z)));
  const cells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)));
  // Digging the street leaves a hole record: without it the virtual plane
  // would pave the dig back over on the next read. Coordinates that are holes
  // either way (a ramp corridor, an exit floor) need no record.
  for (const [x, y, z] of remove) {
    if (z !== 0) continue;
    if (cells.some((c) => c.x === x && c.y === y && c.z === z)) continue;
    if (groundHoleAt(cells, state.modules, x, y)) continue;
    cells.push({ x, y, z, fill: 'void' });
  }
  const modules = state.modules.filter((m) => !kill.has(cellKey(m.x, m.y, m.z)));
  return { ...state, cells, modules };
}
