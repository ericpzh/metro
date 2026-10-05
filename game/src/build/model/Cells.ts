// Build model: cells — the sparse cell list primitives (§4.1).
// Leaf module: only sim/ imports plus a type-only StationState.

import { LEVEL_STEPS } from '../../sim/constants.ts';
import { isTrackCell, reservedOpening } from '../../sim/placement.ts';
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
export function nearestLevel(z: number): number {
  let best = LEVEL_STEPS[0];
  for (const l of LEVEL_STEPS) if (Math.abs(l - z) < Math.abs(best - z)) best = l;
  return best;
}

/**
 * The z of the at-grade (street) level — h = 0 m. A surface exit head-house is
 * rooted here and nowhere else: its opening and canopy belong at the ground, not
 * on a concourse or platform slab. There are no named levels any more; the
 * street is simply z = 0.
 */
export const GROUND_Z = 0;

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
 * Add solid cells, ignoring ones that are already solid and refusing any that
 * would cover a reserved opening — a ramp's carved corridor or an exit's floor
 * (`reservedOpening`). Without this guard the block brush could fill an
 * auto-generated hole and seal a stair, escalator or exit in. Returns the cells
 * added and how many were refused.
 */
export function addCells(
  cells: Cell[],
  add: Array<[number, number, number]>,
  modules: readonly Module[] = [],
): { cells: Cell[]; changed: number; blocked: number } {
  const have = new Set(cells.map((c) => cellKey(c.x, c.y, c.z)));
  const out = cells.slice();
  let changed = 0;
  let blocked = 0;
  for (const [x, y, z] of add) {
    const k = cellKey(x, y, z);
    if (have.has(k)) continue;
    if (reservedOpening(modules, x, y, z)) {
      blocked++;
      continue;
    }
    // A placed rail's bed is already covered ground: the 地基 merge must not
    // pour a block into the trench (and the live ghost drops the same cells).
    if (isTrackCell(cells, modules, x, y, z)) continue;
    have.add(k);
    out.push({ x, y, z, fill: 'solid' });
    changed++;
  }
  return { cells: out, changed, blocked };
}

/** Remove solid cells and any modules hosted on them. */
export function removeCells(state: StationState, remove: Array<[number, number, number]>): StationState {
  const kill = new Set(remove.map(([x, y, z]) => cellKey(x, y, z)));
  const cells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)));
  const modules = state.modules.filter((m) => !kill.has(cellKey(m.x, m.y, m.z)));
  return { ...state, cells, modules };
}
