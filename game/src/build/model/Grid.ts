// Build model: grid repair — what "damaged" means for the grid (§4.1).
// Leaf module: sim types only, so State.ts can import it without a cycle.

import type { Cell, Module, StationData } from '../../sim/types.ts';

/**
 * True when a cell sits on the 1 m editing grid, with a coordinate a double can
 * represent at all (`NaN`/`Infinity` stringify to `null`).
 *
 * Every build command takes its coordinates from a pick — which floors the ray
 * hit (`scene.pick`) — or from whole-cell arithmetic, so **the game cannot mint a
 * cell off the grid**; a save is the only place one can appear, and one that did
 * (the author's own station carried 19) is invisible to every tool: a pick snaps
 * to integers, `removeCells` matches an exact coordinate, the graph gives it a
 * degree-0 node and the mesher draws it as a block offset from its neighbours.
 */
export function isGridCell(c: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z) &&
    Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.z);
}

/**
 * True when a module stands on the grid — its anchor **and** every endpoint it
 * stores, because a run's `from`/`to` and a switchback's flights are what the
 * builder lays floor and carves openings from. A module whose endpoints are off the
 * grid would leave a flight landing on a cell that does not exist.
 */
export function isGridModule(m: Module): boolean {
  const points: Array<{ x: number; y: number; z: number }> = [m];
  const run = m as { from?: { x: number; y: number; z: number }; to?: { x: number; y: number; z: number } };
  if (run.from) points.push(run.from);
  if (run.to) points.push(run.to);
  if (m.type === 'stair') for (const f of m.cfg.flights ?? []) points.push(f.from, f.to);
  return points.every(isGridCell);
}

/**
 * The cells and modules a document can keep, and how many of each it had to drop.
 *
 * One place decides what "damaged" means for the grid, so the two boundaries that
 * repair a document cannot disagree: `toState` drops them on the way **in** (a save
 * is the only way one can arrive) and `serialize` drops them on the way **out**, so
 * a file this game writes can never carry a block no tool can address.
 */
export function repairGrid(data: StationData): {
  cells: Cell[];
  modules: Module[];
  droppedCells: number;
  droppedModules: number;
} {
  const cells = data.cells.filter(isGridCell);
  const modules = data.modules.filter(isGridModule);
  return {
    cells,
    modules,
    droppedCells: data.cells.length - cells.length,
    droppedModules: data.modules.length - modules.length,
  };
}
