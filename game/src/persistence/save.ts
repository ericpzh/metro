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

import { toState, type StationState } from '../build/model.ts'
import type { Cell, LineDef, LevelDef, Module, StationData } from '../sim/types.ts'

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
  static: {
    levels: LevelDef[]
    cells: Cell[]
    modules: Module[]
    lines: LineDef[]
  }
}

export type ParseResult =
  | { ok: true; state: StationState; version: number }
  | { ok: false; error: string }

export function serialize(state: StationState, now: Date = new Date()): string {
  const doc: SaveFileV1 = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_VERSION,
    gameVersion: GAME_VERSION,
    savedAt: now.toISOString(),
    name: state.name,
    seed: state.seed,
    static: {
      levels: state.levels,
      cells: state.cells,
      modules: state.modules,
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
  if (version > SAVE_VERSION) return { ok: false, error: '存档版本过新，请更新游戏' }
  if (!d.static || !Array.isArray(d.static.cells)) return { ok: false, error: '缺少车站数据' }
  const data: StationData = {
    name: typeof d.name === 'string' ? d.name : '未命名车站',
    seed: typeof d.seed === 'number' ? d.seed : 1234567,
    levels: d.static.levels ?? [{ id: 'G', z: 0, kind: 'at-grade', height: 4.5 }],
    cells: d.static.cells,
    modules: d.static.modules ?? [],
    lines: d.static.lines ?? [],
  }
  const state = toState(migrate(data, version))
  return { ok: true, state, version }
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
