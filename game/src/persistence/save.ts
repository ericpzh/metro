// Save / load — GAME-SPEC.md §9.4, §10.5; PLAN.md §6.
//
// One save is one UTF-8 JSON document. B1 ships `formatVersion: 1`: the
// envelope plus the *static* station. The dynamic movement block (§10.5
// `rng / agents / trains / queues / spawns`) is `formatVersion: 2`, which lands
// in B5 together with the full snapshot. Freezing the cell schema now is the
// point — every later milestone migrates instead of rewriting.
//
// Nothing here touches the DOM: the download and the file picker live in the
// app layer. This module is pure and runs in Node.

import { repairGrid, toData, toStateRepairing, type StationState } from '../build/model.ts'
import type { PeakWindows, TimeSpan } from '../sim/constants.ts'
import type { DemandKnobs } from '../sim/demand.ts'
import type { SimCalendar } from '../sim/clock.ts'
import type { Cell, LineDef, Module, StationData } from '../sim/types.ts'

export const SAVE_FORMAT = 'metro-save' as const
export const SAVE_VERSION = 1
export const GAME_VERSION = '0.2.0'

export interface SaveFileV1 {
  format: typeof SAVE_FORMAT
  formatVersion: number
  gameVersion: string
  savedAt: string
  name: string
  seed: number
  /**
   * The station's authored day (§9.6C 时刻): its operating hours, its two peak windows and
   * the demand curve's knobs, beside the name and the seed because they are station-level
   * config rather than part of the built station. **All optional, and not a version
   * bump**: a v1 file written before them loads on the defaults, a v1 reader that predates
   * them ignores them, and each is repaired into range on the way in — the cell schema,
   * which is what `formatVersion` freezes, has not moved.
   */
  service?: TimeSpan
  peaks?: PeakWindows
  demand?: Partial<DemandKnobs>
  /** The station's calendar (§9.6C 日期类型): day 0's date and the two date lists. */
  calendar?: SimCalendar
  static: {
    cells: Cell[]
    modules: Module[]
    lines: LineDef[]
  }
}

export type ParseResult =
  | { ok: true; state: StationState; version: number; droppedCells: number; droppedModules: number }
  | { ok: false; error: string }

export function serialize(state: StationState, now: Date = new Date()): string {
  // Anything the grid cannot hold is **dropped here**, not refused: the station the
  // player is looking at is the truth, and a block no tool can address is not worth
  // a failed save. `repairGrid` is the same rule `toState` applies on the way in, so
  // a file this game writes cannot carry one and cannot disagree with the loader
  // about what one is.
  const repaired = repairGrid(toData(state))
  const doc: SaveFileV1 = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_VERSION,
    gameVersion: GAME_VERSION,
    savedAt: now.toISOString(),
    name: state.name,
    seed: state.seed,
    service: state.service,
    peaks: state.peaks,
    demand: state.demand,
    calendar: state.calendar,
    static: {
      cells: repaired.cells,
      modules: repaired.modules,
      lines: state.lines,
    },
  }
  return JSON.stringify(doc)
}

/**
 * Validate and parse an envelope. Never partially loads: any failure returns a
 * named Chinese reason and no state, so the open station is untouched (§9.4).
 */
export function parse(text: string): ParseResult {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件损坏' }
  }
  if (typeof doc !== 'object' || doc === null) return { ok: false, error: '文件损坏' }
  const d = doc as Partial<SaveFileV1>
  if (d.format !== SAVE_FORMAT) return { ok: false, error: '不是地铁车站存档' }
  const version = typeof d.formatVersion === 'number' ? d.formatVersion : 0
  if (version > SAVE_VERSION) return { ok: false, error: '存档太新了，先更新游戏' }
  if (!d.static || !Array.isArray(d.static.cells)) return { ok: false, error: '缺少车站数据' }
  const data: StationData = {
    name: typeof d.name === 'string' ? d.name : '未命名车站',
    seed: typeof d.seed === 'number' ? d.seed : 1234567,
    cells: d.static.cells,
    modules: d.static.modules ?? [],
    lines: d.static.lines ?? [],
    // Left off the document entirely when the file carries none of them: `toState`
    // supplies the defaults, so "absent" and "the default" stay one code path rather than
    // two. Only the *shape* is checked here — a window the day cannot hold, a knob past
    // its slider, a peak list of one, are all `normalize*`'s business, not a refusal.
    ...(isRecord(d.service) ? { service: d.service as TimeSpan } : {}),
    ...(Array.isArray(d.peaks) ? { peaks: d.peaks as PeakWindows } : {}),
    ...(isRecord(d.demand) ? { demand: d.demand as Partial<DemandKnobs> } : {}),
    ...(isRecord(d.calendar) ? { calendar: d.calendar as SimCalendar } : {}),
  }
  // A structurally valid station with damaged content still opens: the envelope is
  // what earns a refusal (`文件损坏` and friends), and the grid repair drops what it
  // must. The counts travel out so the 打开 notice can say the station was repaired
  // rather than letting the player find out by counting blocks.
  const repaired = toStateRepairing(migrate(data, version))
  return { ok: true, state: repaired.state, version, droppedCells: repaired.droppedCells, droppedModules: repaired.droppedModules }
}

/**
 * Forward migrators. v1 is the oldest shipped format, so today this is a
 * pass-through; the shape exists so a bump to v2 (B5) is a one-line change
 * rather than a rewrite.
 */
function migrate(data: StationData, version: number): StationData {
  void version
  return data
}

/**
 * Whether an untrusted field is a JSON object at all. The *values* are not judged here:
 * the `normalize*` functions bend whatever arrives into the day it can hold, so a save
 * with an inverted window or a fractional knob still opens.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
