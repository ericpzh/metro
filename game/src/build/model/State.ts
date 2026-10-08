// Build model: state — the station document and its load path.
// Owns toStateFrom (grid repair entry, poster backfill, termini defaults) plus
// toStateRepairing, so Grid.ts stays a leaf and no State↔Grid cycle forms (C4).

import type { Cell, Module, StationData } from '../../sim/types.ts';
import { normalizeLevelBase, type PeakWindows, type TimeSpan } from '../../sim/constants.ts';
import { normalizeCalendar, normalizePeaks, normalizeService, type SimCalendar } from '../../sim/clock.ts';
import { normalizeDemand, type DemandKnobs } from '../../sim/demand.ts';
import { cloneCell } from './Cells.ts';
import { assignAdPosters, ensureSignLayouts } from './Equipment.ts';
import { ensureRoomFurniture } from './Facilities.ts';
import { repairGrid } from './Grid.ts';
import { syncBridgePillars } from './BridgePillars.ts';

export interface StationState {
  name: string;
  seed: number;
  levelBase: number;
  cells: Cell[];
  modules: Module[];
  lines: StationData['lines'];
  /**
   * The station's authored day (§9.6C 时刻): its operating hours, its two peak windows and
   * its demand curve's knobs. Always present here, where a save or a demo file that
   * predates them is given the defaults rather than carrying an absence through every
   * readout and every spawn that wants them.
   */
  service: TimeSpan;
  peaks: PeakWindows;
  demand: DemandKnobs;
  /** The station's calendar (§9.6C 日期类型): day 0's date and the 节假日 / 调休上班日 lists. */
  calendar: SimCalendar;
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
    levelBase: normalizeLevelBase(data.levelBase),
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
    // Same for the authored day (§9.6C): a file that never carried one opens on the
    // defaults, and one that carries a window the day cannot hold (an inverted pair, a
    // stray second, a knob past its slider) is bent into range here, where every load
    // path passes.
    service: normalizeService(data.service),
    peaks: normalizePeaks(data.peaks),
    demand: normalizeDemand(data.demand),
    // The calendar is repaired the same way: an epoch that is not a date falls back to the
    // shipped 2026-01-01, and a key that is not `YYYY-MM-DD` is dropped from its list.
    calendar: normalizeCalendar(data.calendar),
  };
  // Rooms drawn before furniture became modules carry no shelf/desk pieces
  // yet — materialise them here so every load path (open, demo, new) agrees.
  return syncBridgePillars(ensureRoomFurniture(state));
}

export function toData(s: StationState): StationData {
  return {
    name: s.name,
    seed: s.seed,
    levelBase: s.levelBase,
    cells: s.cells,
    modules: s.modules,
    lines: s.lines,
    service: s.service,
    peaks: s.peaks,
    demand: s.demand,
    calendar: s.calendar,
  };
}

/**
 * A deep copy of one plain-data document part (a module, a line).
 *
 * `structuredClone` where the engine has it — every browser this game targets does,
 * and Node has since 17 — and a JSON round-trip otherwise. The JSON path was the
 * only one, and it ran per **module**: 366 of them on the demo station, ~890 KB of
 * stringify and parse on the main thread for every single commit, for a snapshot the
 * player may never return to.
 */
function deepCopy<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

export function cloneState(s: StationState): StationState {
  return {
    name: s.name,
    seed: s.seed,
    levelBase: s.levelBase,
    cells: s.cells.map(cloneCell),
    modules: s.modules.map((m) => deepCopy(m)),
    lines: s.lines.map((l) => deepCopy(l)),
    service: { ...s.service },
    peaks: [{ ...s.peaks[0] }, { ...s.peaks[1] }],
    demand: { ...s.demand },
    calendar: { epoch: { ...s.calendar.epoch }, holidays: [...s.calendar.holidays], workdays: [...s.calendar.workdays] },
  };
}
