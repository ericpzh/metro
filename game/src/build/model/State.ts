// Build model: state — the station document and its load path.
// Owns toStateFrom (grid repair entry, poster backfill, termini defaults) plus
// toStateRepairing, so Grid.ts stays a leaf and no State↔Grid cycle forms (C4).

import type { Cell, Module, StationData } from '../../sim/types.ts';
import { cloneCell } from './Cells.ts';
import { assignAdPosters, ensureSignLayouts } from './Equipment.ts';
import { ensureRoomFurniture } from './Facilities.ts';
import { repairGrid } from './Grid.ts';

export interface StationState {
  name: string;
  seed: number;
  cells: Cell[];
  modules: Module[];
  lines: StationData['lines'];
}

/**
 * `toState`, plus what the grid repair had to drop, so a caller that can say so
 * (`parse` → the 打开 notice) reports the repair instead of performing it in
 * silence.
 */
export function toStateRepairing(data: StationData): {
  state: StationState;
  droppedCells: number;
  droppedModules: number;
} {
  const repaired = repairGrid(data);
  return { state: toStateFrom(data, repaired), droppedCells: repaired.droppedCells, droppedModules: repaired.droppedModules };
}

export function toState(data: StationData): StationState {
  return toStateFrom(data, repairGrid(data));
}

/** The one load path: a document already through `repairGrid` becomes a `StationState`. */
function toStateFrom(data: StationData, repaired: ReturnType<typeof repairGrid>): StationState {
  const state: StationState = {
    name: data.name,
    seed: data.seed,
    // Off-grid cells are dropped here, where every load path passes: they are
    // unreachable junk no tool can address, so a station that keeps them can never
    // be cleaned from inside the game (`repairGrid`).
    cells: repaired.cells.map(cloneCell),
    // A save written before ad screens carried a poster (or the demo) gets one
    // printed now, so a loaded station shows the same campaign on every frame
    // instead of re-rolling it at draw time.
    modules: ensureSignLayouts(assignAdPosters(repaired.modules), data).map((m) => ({ ...m })),
    // Older saves predate the per-line direction termini; default them to ''
    // so the screen header falls back to the direction word instead of undefined.
    lines: data.lines.map((l) => ({ ...l, upTerminus: l.upTerminus ?? '', downTerminus: l.downTerminus ?? '' })),
  };
  // Rooms drawn before furniture became modules carry no shelf/desk pieces
  // yet — materialise them here so every load path (open, demo, new) agrees.
  return ensureRoomFurniture(state);
}

export function toData(s: StationState): StationData {
  return { name: s.name, seed: s.seed, cells: s.cells, modules: s.modules, lines: s.lines };
}

export function cloneState(s: StationState): StationState {
  return {
    name: s.name,
    seed: s.seed,
    cells: s.cells.map(cloneCell),
    modules: s.modules.map((m) => JSON.parse(JSON.stringify(m)) as Module),
    lines: s.lines.map((l) => JSON.parse(JSON.stringify(l))),
  };
}
