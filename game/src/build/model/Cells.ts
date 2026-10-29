// Build model: cells — the sparse cell list primitives (§4.1).
// Leaf module: only sim/ imports plus a type-only StationState.

import { levelSteps, STOREY_HEIGHT, storeyBand } from '../../sim/constants.ts';
import { GROUND_Z, groundHoleAt, virtualSolidAt } from '../../sim/ground.ts';
import { blockIndex } from '../../sim/blockIndex.ts';
import { blockReason } from '../validation.ts';
import type { Cell, Module } from '../../sim/types.ts';
import type { StationState } from './State.ts';

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * True when two cell lists hold the same records — same coordinates with the
 * same fill. Length alone cannot tell: digging a block at grade (`z = 0`)
 * swaps a `solid` for the street's `void` hole record, so the list is the same
 * length but the station changed. The delete tools gate their commit on this
 * rather than on length, or a block laid into a dug hole can never be dug back
 * out (GAME-SPEC §4.1: the plane is stored inverted).
 */
export function sameCells(a: readonly Cell[], b: readonly Cell[]): boolean {
  if (a.length !== b.length) return false;
  const fills = new Map<string, string>();
  for (const c of a) fills.set(cellKey(c.x, c.y, c.z), c.fill);
  for (const c of b) if (fills.get(cellKey(c.x, c.y, c.z)) !== c.fill) return false;
  return true;
}

/**
 * Snap an arbitrary z to the nearest fixed storey. The storey grid itself lives
 * in `sim/constants.ts` (`LEVEL_STEPS`); Q/E steps through it and the depth rail
 * lists exactly it, so the work plane follows the five-metre grid and its base
 * offset instead of jumping between
 * whatever z values happen to have walkable cells.
 */
export function nearestLevel(z: number, base = 0, height = STOREY_HEIGHT): number {
  const levels = levelSteps(base, height);
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

/** G erases only the story containing the selected block (§4.4). */
export function storeyColumnsAt(
  state: StationState,
  columns: Array<[number, number, number]>,
): Array<[number, number, number]> {
  const bands = new Map<string, Set<number>>();
  for (const [x, y, z] of columns) {
    const key = `${x},${y}`;
    const selected = bands.get(key) ?? new Set<number>();
    selected.add(storeyBand(z, state.levelBase, state.storeyHeight));
    bands.set(key, selected);
  }
  const out = new Map<string, [number, number, number]>();
  for (const c of state.cells) {
    if (c.fill !== 'solid' || !bands.get(`${c.x},${c.y}`)?.has(storeyBand(c.z, state.levelBase, state.storeyHeight))) continue;
    out.set(cellKey(c.x, c.y, c.z), [c.x, c.y, c.z]);
  }
  // The street is an implicit block too; deleting it must record its hole (§4.1).
  for (const [x, y] of columns) {
    if (bands.get(`${x},${y}`)?.has(storeyBand(0, state.levelBase, state.storeyHeight)) && virtualSolidAt(state.cells, state.modules, x, y, 0)) {
      out.set(cellKey(x, y, 0), [x, y, 0]);
    }
  }
  return [...out.values()];
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
  // Preview already prepared this immutable occupancy. Keep new keys separate:
  // mutating level.solid would corrupt the old document and its next preview.
  const level = blockIndex(cells, modules);
  const addedKeys = new Set<string>();
  // Where each record sits, so a hole is **replaced** rather than shadowed: the
  // document holds one record per coordinate, and appending a second block beside
  // a `void` would leave which one wins to iteration order.
  const at = new Map<string, number>();
  cells.forEach((c, i) => { if(c.fill !== 'solid') at.set(cellKey(c.x, c.y, c.z), i) });
  const out = cells.slice();
  const filledGroundHoles = new Set<string>();
  let changed = 0;
  let blocked = 0;
  for (const [x, y, z] of add) {
    // The street is already solid: laying a block into virtual ground is a
    // no-op, not a duplicate record — the document stays the delta from the
    // plane, so saves never carry the horizon.
    if (level.solid.has(cellKey(x, y, z)) || addedKeys.has(cellKey(x, y, z)) || level.ground(x, y, z)) continue;
    if (!blockReason(cells, modules, x, y, z, level).ok) {
      blocked++;
      continue;
    }
    const k = cellKey(x, y, z);
    addedKeys.add(k);
    const hole = at.get(k);
    // At grade, a plain block is the implicit street, not authored content.
    // Remove the hole record and let absence mean ground again; otherwise a
    // delete/re-add cycle leaves a redundant solid in the save. A later finish
    // or zone edit can materialise this coordinate with its authored data.
    if (z === GROUND_Z) {
      if (hole !== undefined) filledGroundHoles.add(k);
    } else if (hole === undefined) out.push({ x, y, z, fill: 'solid' });
    else out[hole] = { x, y, z, fill: 'solid' };
    changed++;
  }
  return {
    cells: filledGroundHoles.size === 0 ? out : out.filter((c) => !filledGroundHoles.has(cellKey(c.x, c.y, c.z))),
    changed,
    blocked,
  };
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
  return { ...state, cells, modules: modules.length === state.modules.length ? state.modules : modules };
}
