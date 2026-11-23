// WebGL player autosave (plan 37 §6.3, plan 39 §3 & §4, plan 40 §2, plan 41 §1).
//
// Shares `AUTOSAVE_KEY` (`metro-game.autosave.v1`) and `AUTOSAVE_INTERVAL_MS`
// (5 minutes) with the Three.js shell (`app/autosave.ts`), while respecting
// the Unity bridge's authoritative session, revision and `stationEpoch` lifecycle:
// - Disabled on desktop WebView2 overlays (which keep `StationDesktopUiPresenter`
//   native autosave) and on `/benchmark` routes.
// - Maintains an independent, lossless raw-JSON v1 autosave envelope seeded from
//   the complete host `documentText` and updated sequentially from raw host commit
//   deltas (`changedCellsJson`, `changedCellIndices`, `changedModulesJson`,
//   `changedModuleIndices`, `linesJson`, plus editable header fields):
//   - Never passes untouched root metadata or raw cell/module/line bodies through
//     JavaScript `JSON.parse` / `Number`, preserving arbitrary-precision integer
//     tokens (e.g. > `Number.MAX_SAFE_INTEGER`) and own `__proto__` properties
//     verbatim.
//   - Preserves exact host array ordering across in-place updates, deletions,
//     forward appends, and undo/redo restores via host-supplied target indices.
// - Keeps whole-station scanning, indexing, and encoding strictly outside
//   `noteCommit` (commit adoption stays O(1)): full host envelopes are reused
//   directly, delta folding + encoding coalesces outside input handling, and
//   `pagehide` / `visibilitychange(hidden)` / `beforeunload` / interval triggers
//   retain a synchronous unload-safe `flush()` with zero bridge round trips.
// - Enforces `(sessionId, stationEpoch, baseRevision)` sequence coherence and
//   target-index bounds: if a delta arrives out of order, malformed, or without a
//   base envelope, marks the sequence broken, refuses to write an incoherent
//   revision, and invokes `onSequenceBroken` to recover via `station.resync`.
// - Tracks explicit startup/open/new/demo/restore/resync commands by correlated
//   command ID. Any accepted replacement that supersedes a stored autosave
//   invalidates `AUTOSAVE_KEY` BEFORE attempting the replacement write, and keeps
//   the new revision dirty if storage rejects it (e.g. quota).

import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_KEY } from '../app/autosave.ts'
import { parse } from '../persistence/save.ts'
import type { StationCommitDelta } from './stationBridge.ts'

export type AutosaveStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export type AutosaveCommandKind = 'replace' | 'restore' | 'resync'

export interface AutosaveCommitInput {
  sessionId?: string
  revision: number
  stationEpoch: number
  sourceId: string | null
  commandId?: string | null
  documentText: string | null
  delta?: StationCommitDelta | null
}

export interface WebGlAutosaveController {
  /** Correlate an outgoing station-load command ID with its lifecycle intent. */
  trackCommand(commandId: string, kind: AutosaveCommandKind): void
  /** Clear a tracked command when the host refuses it (leaving the last save untouched). */
  noteReject(commandId: string): void
  /** Record a freshly committed station revision in O(1) without parsing or encoding. */
  noteCommit(input: AutosaveCommitInput): void
  /** Synchronously flush the latest coherent dirty revision (encoding on demand if needed). */
  flush(): boolean
  /** Tear down interval, deferred encode handle, and lifecycle listeners. */
  dispose(): void
}

export interface StartupRouteInput {
  isBenchmark: boolean
  desktopOverlay: boolean
  demoId: string | null
  storage: AutosaveStorage | null
}

export type StartupAction =
  | { kind: 'benchmark' }
  | { kind: 'openDemo'; id: string }
  | { kind: 'openAutosave'; document: string }
  | { kind: 'resync' }

/** Read and validate a persisted v1 autosave envelope; returns null if missing or corrupt. */
export function readValidAutosaveText(storage: AutosaveStorage | null | undefined): string | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const parsed = parse(raw)
    return parsed.ok ? raw : null
  } catch {
    return null
  }
}

/**
 * Decide the initial Unity startup command in strict precedence order:
 * benchmark -> demo route -> valid WebGL autosave -> host resync.
 */
export function resolveWebGlStartupAction(input: StartupRouteInput): StartupAction {
  if (input.isBenchmark && !input.desktopOverlay) return { kind: 'benchmark' }
  if (input.demoId) return { kind: 'openDemo', id: input.demoId }
  if (!input.desktopOverlay && !input.isBenchmark) {
    const saved = readValidAutosaveText(input.storage)
    if (saved) return { kind: 'openAutosave', document: saved }
  }
  return { kind: 'resync' }
}

export interface CreateWebGlAutosaveOptions {
  enabled: boolean
  storage: AutosaveStorage | null
  intervalMs?: number
  encodeDelayMs?: number
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
  documentTarget?: (Pick<Document, 'addEventListener' | 'removeEventListener'> & { readonly visibilityState: string }) | null
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
  scheduleEncodeFn?: (fn: () => void) => unknown
  cancelEncodeFn?: (handle: unknown) => void
  /** Invoked when a delta sequence gap or corrupt base requires a host `station.resync`. */
  onSequenceBroken?: () => void
  /** Optional observer/hook invoked whenever a delta envelope is materialized into JSON text. */
  encodeEnvelopeFn?: (encodedText: string) => string
}

interface RevisionKey {
  sessionId: string
  stationEpoch: number
  revision: number
}

interface EncodedSnapshot extends RevisionKey {
  text: string
}

type RecordKey = number | string

interface OrderedRawRecordList {
  keys: RecordKey[]
  raws: string[]
  indexByKey: Map<RecordKey, number>
  indexDirty: boolean
}

interface RawAutosaveEnvelope {
  header: Map<string, string>
  staticExtras: Map<string, string>
  cells: OrderedRawRecordList
  modules: OrderedRawRecordList
  lines: string[]
}

function sameKey(a: RevisionKey | null, b: RevisionKey | null): boolean {
  return a !== null && b !== null &&
    a.sessionId === b.sessionId &&
    a.stationEpoch === b.stationEpoch &&
    a.revision === b.revision
}

const COORD_BIAS = 32768
const COORD_SPAN = 65536
const COORD_SPAN2 = 4294967296

function cellCoordKey(x: number, y: number, z: number): RecordKey {
  if (
    Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
    x >= -COORD_BIAS && x < COORD_BIAS &&
    y >= -COORD_BIAS && y < COORD_BIAS &&
    z >= -COORD_BIAS && z < COORD_BIAS
  ) {
    return (x + COORD_BIAS) * COORD_SPAN2 + (y + COORD_BIAS) * COORD_SPAN + (z + COORD_BIAS)
  }
  return `${x},${y},${z}`
}

// ------------------------------------------------------------------ raw JSON scanner

function skipWs(src: string, pos: number, end: number): number {
  while (pos < end) {
    const c = src.charCodeAt(pos)
    if (c === 32 || c === 9 || c === 10 || c === 13) pos++
    else break
  }
  return pos
}

let lastStringHadEscape = false

function scanJsonStringEnd(src: string, pos: number, end: number): number {
  let i = pos + 1
  let escaped = false
  while (i < end) {
    const c = src.charCodeAt(i)
    if (c === 34) {
      lastStringHadEscape = escaped
      return i + 1
    }
    if (c === 92) {
      escaped = true
      i += 2
      continue
    }
    if (c < 0x20) return -1
    i++
  }
  return -1
}

function decodeJsonString(src: string, start: number, end: number, hadEscape: boolean): string | null {
  if (!hadEscape) return src.slice(start + 1, end - 1)
  try {
    const val = JSON.parse(src.slice(start, end))
    return typeof val === 'string' ? val : null
  } catch {
    return null
  }
}

function scanJsonValueEnd(src: string, pos: number, end: number): number {
  if (pos >= end) return -1
  const c = src.charCodeAt(pos)
  if (c === 34) return scanJsonStringEnd(src, pos, end)
  if (c === 123 || c === 91) {
    let depth = 1
    let i = pos + 1
    while (i < end && depth > 0) {
      const ch = src.charCodeAt(i)
      if (ch === 34) {
        i = scanJsonStringEnd(src, i, end)
        if (i < 0) return -1
        continue
      }
      if (ch === 123 || ch === 91) depth++
      else if (ch === 125 || ch === 93) depth--
      i++
    }
    return depth === 0 ? i : -1
  }
  let i = pos
  while (i < end) {
    const ch = src.charCodeAt(i)
    if (ch === 44 || ch === 125 || ch === 93 || ch === 32 || ch === 9 || ch === 10 || ch === 13) break
    i++
  }
  return i > pos ? i : -1
}

function parseJsonNumberFast(src: string, start: number, end: number): number {
  if (start >= end) return Number.NaN
  let i = start
  let neg = false
  let ch = src.charCodeAt(i)
  if (ch === 45) {
    neg = true
    i++
    if (i >= end) return Number.NaN
    ch = src.charCodeAt(i)
  }
  if (ch < 48 || ch > 57) return Number.NaN
  let acc = 0
  while (i < end) {
    ch = src.charCodeAt(i)
    if (ch >= 48 && ch <= 57) {
      acc = acc * 10 + (ch - 48)
      i++
    } else {
      // Float or exponent token: fall back to Number() on slice.
      const n = Number(src.slice(start, end))
      return Number.isFinite(n) ? n : Number.NaN
    }
  }
  return neg ? (acc === 0 ? 0 : -acc) : acc
}

let lastScannedCellKey: RecordKey | null = null

function scanCellObject(src: string, start: number, end: number): number {
  lastScannedCellKey = null
  if (start >= end || src.charCodeAt(start) !== 123) return -1
  let pos = skipWs(src, start + 1, end)
  let hasX = false
  let hasY = false
  let hasZ = false
  let x = 0
  let y = 0
  let z = 0

  if (pos < end && src.charCodeAt(pos) === 125) {
    return pos + 1
  }

  while (pos < end) {
    if (src.charCodeAt(pos) !== 34) return -1
    const keyStart = pos
    const keyEnd = scanJsonStringEnd(src, keyStart, end)
    if (keyEnd < 0) return -1
    const keyEscaped = lastStringHadEscape
    pos = skipWs(src, keyEnd, end)
    if (pos >= end || src.charCodeAt(pos) !== 58) return -1
    pos = skipWs(src, pos + 1, end)
    const valStart = pos
    const valEnd = scanJsonValueEnd(src, valStart, end)
    if (valEnd < 0) return -1

    const keyLen = keyEnd - keyStart
    if (keyLen === 3 && !keyEscaped) {
      const kCh = src.charCodeAt(keyStart + 1)
      if (kCh === 120) {
        const n = parseJsonNumberFast(src, valStart, valEnd)
        if (Number.isFinite(n)) { x = n; hasX = true }
      } else if (kCh === 121) {
        const n = parseJsonNumberFast(src, valStart, valEnd)
        if (Number.isFinite(n)) { y = n; hasY = true }
      } else if (kCh === 122) {
        const n = parseJsonNumberFast(src, valStart, valEnd)
        if (Number.isFinite(n)) { z = n; hasZ = true }
      }
    } else if (keyEscaped) {
      const decoded = decodeJsonString(src, keyStart, keyEnd, true)
      if (decoded === 'x') {
        const n = parseJsonNumberFast(src, valStart, valEnd)
        if (Number.isFinite(n)) { x = n; hasX = true }
      } else if (decoded === 'y') {
        const n = parseJsonNumberFast(src, valStart, valEnd)
        if (Number.isFinite(n)) { y = n; hasY = true }
      } else if (decoded === 'z') {
        const n = parseJsonNumberFast(src, valStart, valEnd)
        if (Number.isFinite(n)) { z = n; hasZ = true }
      }
    }

    pos = skipWs(src, valEnd, end)
    if (pos >= end) return -1
    const sep = src.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(src, pos + 1, end)
      continue
    }
    if (sep === 125) {
      if (hasX && hasY && hasZ) lastScannedCellKey = cellCoordKey(x, y, z)
      return pos + 1
    }
    return -1
  }
  return -1
}

let lastScannedModuleId: string | null = null

function scanModuleObject(src: string, start: number, end: number): number {
  lastScannedModuleId = null
  if (start >= end || src.charCodeAt(start) !== 123) return -1
  let pos = skipWs(src, start + 1, end)
  let id: string | null = null

  if (pos < end && src.charCodeAt(pos) === 125) {
    return pos + 1
  }

  while (pos < end) {
    if (src.charCodeAt(pos) !== 34) return -1
    const keyStart = pos
    const keyEnd = scanJsonStringEnd(src, keyStart, end)
    if (keyEnd < 0) return -1
    const keyEscaped = lastStringHadEscape
    pos = skipWs(src, keyEnd, end)
    if (pos >= end || src.charCodeAt(pos) !== 58) return -1
    pos = skipWs(src, pos + 1, end)
    const valStart = pos
    const valEnd = scanJsonValueEnd(src, valStart, end)
    if (valEnd < 0) return -1
    const valEscaped = lastStringHadEscape

    const keyLen = keyEnd - keyStart
    let isIdKey = false
    if (keyLen === 4 && !keyEscaped && src.charCodeAt(keyStart + 1) === 105 && src.charCodeAt(keyStart + 2) === 100) {
      isIdKey = true
    } else if (keyEscaped && decodeJsonString(src, keyStart, keyEnd, true) === 'id') {
      isIdKey = true
    }
    if (isIdKey && src.charCodeAt(valStart) === 34) {
      const decoded = decodeJsonString(src, valStart, valEnd, valEscaped)
      if (decoded && decoded.length > 0) id = decoded
    }

    pos = skipWs(src, valEnd, end)
    if (pos >= end) return -1
    const sep = src.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(src, pos + 1, end)
      continue
    }
    if (sep === 125) {
      lastScannedModuleId = id
      return pos + 1
    }
    return -1
  }
  return -1
}

function extractCellKeyFromRawJson(raw: string): RecordKey | null {
  const start = skipWs(raw, 0, raw.length)
  const nextPos = scanCellObject(raw, start, raw.length)
  if (nextPos < 0 || lastScannedCellKey === null) return null
  return skipWs(raw, nextPos, raw.length) === raw.length ? lastScannedCellKey : null
}

function extractModuleIdFromRawJson(raw: string): string | null {
  const start = skipWs(raw, 0, raw.length)
  const nextPos = scanModuleObject(raw, start, raw.length)
  if (nextPos < 0 || !lastScannedModuleId) return null
  return skipWs(raw, nextPos, raw.length) === raw.length ? lastScannedModuleId : null
}

function createEmptyRecordList(): OrderedRawRecordList {
  return { keys: [], raws: [], indexByKey: new Map(), indexDirty: false }
}

function ensureListIndex(list: OrderedRawRecordList): void {
  if (!list.indexDirty) return
  list.indexByKey.clear()
  for (let i = 0; i < list.keys.length; i++) {
    list.indexByKey.set(list.keys[i], i)
  }
  list.indexDirty = false
}

function parseCellsArray(src: string, start: number, end: number, out: OrderedRawRecordList): number {
  if (start >= end || src.charCodeAt(start) !== 91) return -1
  let pos = skipWs(src, start + 1, end)
  if (pos < end && src.charCodeAt(pos) === 93) return pos + 1

  const keys = out.keys
  const raws = out.raws
  const indexByKey = out.indexByKey
  while (pos < end) {
    const elemStart = pos
    if (src.charCodeAt(elemStart) === 123) {
      const nextPos = scanCellObject(src, elemStart, end)
      if (nextPos < 0) return -1
      const key = lastScannedCellKey
      if (key !== null) {
        const idx = raws.length
        keys.push(key)
        raws.push(src.slice(elemStart, nextPos))
        indexByKey.set(key, idx)
      }
      pos = skipWs(src, nextPos, end)
    } else {
      const elemEnd = scanJsonValueEnd(src, elemStart, end)
      if (elemEnd < 0) return -1
      pos = skipWs(src, elemEnd, end)
    }
    if (pos >= end) return -1
    const sep = src.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(src, pos + 1, end)
      continue
    }
    if (sep === 93) return pos + 1
    return -1
  }
  return -1
}

function parseModulesArray(src: string, start: number, end: number, out: OrderedRawRecordList): number {
  if (start >= end || src.charCodeAt(start) !== 91) return -1
  let pos = skipWs(src, start + 1, end)
  if (pos < end && src.charCodeAt(pos) === 93) return pos + 1

  const keys = out.keys
  const raws = out.raws
  const indexByKey = out.indexByKey
  while (pos < end) {
    const elemStart = pos
    if (src.charCodeAt(elemStart) === 123) {
      const nextPos = scanModuleObject(src, elemStart, end)
      if (nextPos < 0) return -1
      const id = lastScannedModuleId
      if (id !== null) {
        const idx = raws.length
        keys.push(id)
        raws.push(src.slice(elemStart, nextPos))
        indexByKey.set(id, idx)
      }
      pos = skipWs(src, nextPos, end)
    } else {
      const elemEnd = scanJsonValueEnd(src, elemStart, end)
      if (elemEnd < 0) return -1
      pos = skipWs(src, elemEnd, end)
    }
    if (pos >= end) return -1
    const sep = src.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(src, pos + 1, end)
      continue
    }
    if (sep === 93) return pos + 1
    return -1
  }
  return -1
}

function parseLinesArray(src: string, start: number, end: number, out: string[]): number {
  if (start >= end || src.charCodeAt(start) !== 91) return -1
  let pos = skipWs(src, start + 1, end)
  if (pos < end && src.charCodeAt(pos) === 93) return pos + 1

  while (pos < end) {
    const elemStart = pos
    const elemEnd = scanJsonValueEnd(src, elemStart, end)
    if (elemEnd < 0) return -1
    if (src.charCodeAt(elemStart) === 123) {
      out.push(src.slice(elemStart, elemEnd))
    }
    pos = skipWs(src, elemEnd, end)
    if (pos >= end) return -1
    const sep = src.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(src, pos + 1, end)
      continue
    }
    if (sep === 93) return pos + 1
    return -1
  }
  return -1
}

function parseStaticObject(
  src: string,
  start: number,
  end: number,
  staticExtras: Map<string, string>,
  cells: OrderedRawRecordList,
  modules: OrderedRawRecordList,
  lines: string[],
): { nextPos: number; hasCells: boolean } | null {
  if (start >= end || src.charCodeAt(start) !== 123) return null
  let pos = skipWs(src, start + 1, end)
  let hasCells = false
  if (pos < end && src.charCodeAt(pos) === 125) return { nextPos: pos + 1, hasCells: false }

  while (pos < end) {
    if (src.charCodeAt(pos) !== 34) return null
    const keyStart = pos
    const keyEnd = scanJsonStringEnd(src, keyStart, end)
    if (keyEnd < 0) return null
    const key = decodeJsonString(src, keyStart, keyEnd, lastStringHadEscape)
    if (key === null) return null
    pos = skipWs(src, keyEnd, end)
    if (pos >= end || src.charCodeAt(pos) !== 58) return null
    pos = skipWs(src, pos + 1, end)

    let valEnd: number
    if (key === 'cells') {
      if (src.charCodeAt(pos) !== 91) return null
      cells.keys.length = 0
      cells.raws.length = 0
      cells.indexByKey.clear()
      cells.indexDirty = false
      valEnd = parseCellsArray(src, pos, end, cells)
      if (valEnd < 0) return null
      hasCells = true
    } else if (key === 'modules') {
      if (src.charCodeAt(pos) === 91) {
        modules.keys.length = 0
        modules.raws.length = 0
        modules.indexByKey.clear()
        modules.indexDirty = false
        valEnd = parseModulesArray(src, pos, end, modules)
        if (valEnd < 0) return null
      } else {
        valEnd = scanJsonValueEnd(src, pos, end)
        if (valEnd < 0) return null
      }
    } else if (key === 'lines') {
      if (src.charCodeAt(pos) === 91) {
        lines.length = 0
        valEnd = parseLinesArray(src, pos, end, lines)
        if (valEnd < 0) return null
      } else {
        valEnd = scanJsonValueEnd(src, pos, end)
        if (valEnd < 0) return null
      }
    } else {
      valEnd = scanJsonValueEnd(src, pos, end)
      if (valEnd < 0) return null
      staticExtras.set(key, src.slice(pos, valEnd))
    }

    pos = skipWs(src, valEnd, end)
    if (pos >= end) return null
    const sep = src.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(src, pos + 1, end)
      continue
    }
    if (sep === 125) return { nextPos: pos + 1, hasCells }
    return null
  }
  return null
}

function parseRawAutosaveEnvelope(raw: string): RawAutosaveEnvelope | null {
  const end = raw.length
  let pos = skipWs(raw, 0, end)
  if (pos >= end || raw.charCodeAt(pos) !== 123) return null
  pos = skipWs(raw, pos + 1, end)
  if (pos >= end || raw.charCodeAt(pos) === 125) return null

  const header = new Map<string, string>()
  const staticExtras = new Map<string, string>()
  const cells = createEmptyRecordList()
  const modules = createEmptyRecordList()
  const lines: string[] = []
  let hasStaticCells = false

  while (pos < end) {
    if (raw.charCodeAt(pos) !== 34) return null
    const keyStart = pos
    const keyEnd = scanJsonStringEnd(raw, keyStart, end)
    if (keyEnd < 0) return null
    const key = decodeJsonString(raw, keyStart, keyEnd, lastStringHadEscape)
    if (key === null) return null
    pos = skipWs(raw, keyEnd, end)
    if (pos >= end || raw.charCodeAt(pos) !== 58) return null
    pos = skipWs(raw, pos + 1, end)

    let valEnd: number
    if (key === 'static') {
      const parsedStatic = parseStaticObject(raw, pos, end, staticExtras, cells, modules, lines)
      if (!parsedStatic) return null
      valEnd = parsedStatic.nextPos
      hasStaticCells = parsedStatic.hasCells
    } else {
      valEnd = scanJsonValueEnd(raw, pos, end)
      if (valEnd < 0) return null
      header.set(key, raw.slice(pos, valEnd))
    }

    pos = skipWs(raw, valEnd, end)
    if (pos >= end) return null
    const sep = raw.charCodeAt(pos)
    if (sep === 44) {
      pos = skipWs(raw, pos + 1, end)
      continue
    }
    if (sep === 125) {
      pos = skipWs(raw, pos + 1, end)
      if (pos !== end || !hasStaticCells) return null
      return { header, staticExtras, cells, modules, lines }
    }
    return null
  }
  return null
}

interface RecordChange {
  key: RecordKey
  raw: string
  targetIndex: number
}

interface ExistingPositionCheck {
  oldIdx: number
  targetIndex: number
}

function applyOrderedRecordDelta(
  list: OrderedRawRecordList,
  removedKeys: readonly RecordKey[],
  changes: readonly RecordChange[],
): boolean {
  if (removedKeys.length === 1) {
    ensureListIndex(list)
    const key = removedKeys[0]
    const idx = list.indexByKey.get(key)
    if (idx !== undefined) {
      if (idx === list.raws.length - 1) {
        list.keys.pop()
        list.raws.pop()
        list.indexByKey.delete(key)
      } else {
        list.keys.splice(idx, 1)
        list.raws.splice(idx, 1)
        list.indexDirty = true
      }
    }
  } else if (removedKeys.length > 1) {
    ensureListIndex(list)
    if (removedKeys.length <= 8) {
      const indices: number[] = []
      for (let i = 0; i < removedKeys.length; i++) {
        const idx = list.indexByKey.get(removedKeys[i])
        if (idx !== undefined) indices.push(idx)
      }
      if (indices.length > 0) {
        indices.sort((a, b) => b - a)
        let prev = -1
        for (let i = 0; i < indices.length; i++) {
          const idx = indices[i]
          if (idx === prev) continue
          prev = idx
          if (idx === list.raws.length - 1) {
            const poppedKey = list.keys.pop()!
            list.raws.pop()
            if (!list.indexDirty) list.indexByKey.delete(poppedKey)
          } else {
            list.keys.splice(idx, 1)
            list.raws.splice(idx, 1)
            list.indexDirty = true
          }
        }
      }
    } else {
      const removeSet = new Set<RecordKey>(removedKeys)
      let write = 0
      for (let read = 0; read < list.keys.length; read++) {
        const k = list.keys[read]
        if (removeSet.has(k)) continue
        if (write !== read) {
          list.keys[write] = k
          list.raws[write] = list.raws[read]
        }
        write++
      }
      if (write !== list.keys.length) {
        list.keys.length = write
        list.raws.length = write
        list.indexDirty = true
      }
    }
  }

  if (changes.length === 0) return true

  ensureListIndex(list)

  // Fast path for the common single-record edit: validate final index with zero allocations.
  if (changes.length === 1) {
    const change = changes[0]
    const existingIdx = list.indexByKey.get(change.key)
    if (existingIdx !== undefined) {
      if (change.targetIndex >= 0 && change.targetIndex !== existingIdx) return false
      list.raws[existingIdx] = change.raw
      return true
    }
    if (change.targetIndex >= 0) {
      if (change.targetIndex > list.raws.length) return false
      if (change.targetIndex === list.raws.length) {
        const at = list.raws.length
        list.keys.push(change.key)
        list.raws.push(change.raw)
        if (!list.indexDirty) list.indexByKey.set(change.key, at)
      } else {
        list.keys.splice(change.targetIndex, 0, change.key)
        list.raws.splice(change.targetIndex, 0, change.raw)
        list.indexDirty = true
      }
      return true
    }
    const at = list.raws.length
    list.keys.push(change.key)
    list.raws.push(change.raw)
    if (!list.indexDirty) list.indexByKey.set(change.key, at)
    return true
  }

  // Reject duplicate keys or conflicting declared target positions within the same delta.
  const seenKeys = new Set<RecordKey>()
  let seenTargetIndices: Set<number> | null = null
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (seenKeys.has(change.key)) return false
    seenKeys.add(change.key)
    if (change.targetIndex >= 0) {
      if (!seenTargetIndices) seenTargetIndices = new Set<number>()
      if (seenTargetIndices.has(change.targetIndex)) return false
      seenTargetIndices.add(change.targetIndex)
    }
  }

  const survivingCount = list.raws.length
  let existingChecks: ExistingPositionCheck[] | null = null
  let positionedInserts: RecordChange[] | null = null
  let appendedInserts: RecordChange[] | null = null

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const existingIdx = list.indexByKey.get(change.key)
    if (existingIdx !== undefined) {
      list.raws[existingIdx] = change.raw
      if (change.targetIndex >= 0) {
        if (!existingChecks) existingChecks = []
        existingChecks.push({ oldIdx: existingIdx, targetIndex: change.targetIndex })
      }
    } else if (change.targetIndex >= 0) {
      if (!positionedInserts) positionedInserts = []
      positionedInserts.push(change)
    } else {
      if (!appendedInserts) appendedInserts = []
      appendedInserts.push(change)
    }
  }

  if (positionedInserts) {
    if (positionedInserts.length > 1) {
      positionedInserts.sort((a, b) => a.targetIndex - b.targetIndex)
    }
    for (let i = 0; i < positionedInserts.length; i++) {
      if (positionedInserts[i].targetIndex > survivingCount + i) return false
    }
  }

  // Validate every existing changed record against its final index after removals and insertions (plan 42 §3).
  if (existingChecks) {
    const insertCount = positionedInserts ? positionedInserts.length : 0
    for (let i = 0; i < existingChecks.length; i++) {
      const check = existingChecks[i]
      let shift = 0
      if (positionedInserts && insertCount > 0) {
        let lo = 0
        let hi = insertCount
        while (lo < hi) {
          const mid = (lo + hi) >>> 1
          if (positionedInserts[mid].targetIndex - mid <= check.oldIdx) lo = mid + 1
          else hi = mid
        }
        shift = lo
      }
      if (check.oldIdx + shift !== check.targetIndex) return false
    }
  }

  if (positionedInserts) {
    for (let i = 0; i < positionedInserts.length; i++) {
      const ins = positionedInserts[i]
      if (ins.targetIndex === list.raws.length) {
        const at = list.raws.length
        list.keys.push(ins.key)
        list.raws.push(ins.raw)
        if (!list.indexDirty) list.indexByKey.set(ins.key, at)
      } else {
        list.keys.splice(ins.targetIndex, 0, ins.key)
        list.raws.splice(ins.targetIndex, 0, ins.raw)
        list.indexDirty = true
      }
    }
  }

  if (appendedInserts) {
    for (let i = 0; i < appendedInserts.length; i++) {
      const ins = appendedInserts[i]
      const at = list.raws.length
      list.keys.push(ins.key)
      list.raws.push(ins.raw)
      if (!list.indexDirty) list.indexByKey.set(ins.key, at)
    }
  }

  return true
}

function isValidTargetIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function applyDeltaToRawEnvelope(doc: RawAutosaveEnvelope, delta: StationCommitDelta): boolean {
  if (typeof delta.savedAt === 'string' && delta.savedAt.length > 0) {
    doc.header.set('savedAt', JSON.stringify(delta.savedAt))
  }
  if (typeof delta.name === 'string') {
    doc.header.set('name', JSON.stringify(delta.name))
  }
  if (typeof delta.nameEn === 'string') {
    doc.header.set('nameEn', JSON.stringify(delta.nameEn))
  }
  if (typeof delta.city === 'string' && delta.city.length > 0) {
    doc.header.set('city', JSON.stringify(delta.city))
    doc.header.delete('cityStyle')
  }
  if (typeof delta.levelBase === 'number' && Number.isFinite(delta.levelBase)) {
    doc.header.set('levelBase', JSON.stringify(delta.levelBase))
  }
  if (typeof delta.storeyHeight === 'number' && Number.isFinite(delta.storeyHeight)) {
    doc.header.set('storeyHeight', JSON.stringify(delta.storeyHeight))
  }

  // Cells: prefer verbatim host JSON records + required target indices; accept legacy parsed objects in unit tests.
  const removedCellKeys: RecordKey[] = []
  for (let i = 0; i < delta.removedCells.length; i++) {
    const coords = delta.removedCells[i]
    if (!Array.isArray(coords) || coords.length < 3) continue
    removedCellKeys.push(cellCoordKey(coords[0], coords[1], coords[2]))
  }
  const cellChanges: RecordChange[] = []
  const cellIndices = delta.changedCellIndices
  if (Array.isArray(delta.changedCellsJson)) {
    if (delta.changedCellsJson.length > 0) {
      if (!Array.isArray(cellIndices) || cellIndices.length !== delta.changedCellsJson.length) return false
    } else if (cellIndices !== undefined && (!Array.isArray(cellIndices) || cellIndices.length !== 0)) {
      return false
    }
    for (let i = 0; i < delta.changedCellsJson.length; i++) {
      const raw = delta.changedCellsJson[i]
      const key = typeof raw === 'string' ? extractCellKeyFromRawJson(raw) : null
      if (key === null) return false
      const targetIndex = cellIndices![i]
      if (!isValidTargetIndex(targetIndex)) return false
      cellChanges.push({ key, raw, targetIndex })
    }
  } else {
    if (cellIndices !== undefined && (!Array.isArray(cellIndices) || cellIndices.length !== delta.changedCells.length)) {
      return false
    }
    for (let i = 0; i < delta.changedCells.length; i++) {
      const rec = delta.changedCells[i]
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false
      if (typeof rec.x !== 'number' || typeof rec.y !== 'number' || typeof rec.z !== 'number') return false
      let targetIndex = -1
      if (cellIndices !== undefined) {
        if (!isValidTargetIndex(cellIndices[i])) return false
        targetIndex = cellIndices[i]
      }
      cellChanges.push({ key: cellCoordKey(rec.x, rec.y, rec.z), raw: JSON.stringify(rec), targetIndex })
    }
  }
  if (!applyOrderedRecordDelta(doc.cells, removedCellKeys, cellChanges)) return false

  // Modules: prefer verbatim host JSON records + required target indices; accept legacy parsed objects in unit tests.
  const removedModKeys: RecordKey[] = []
  for (let i = 0; i < delta.removedModules.length; i++) {
    const id = delta.removedModules[i]
    if (typeof id === 'string' && id.length > 0) removedModKeys.push(id)
  }
  const modChanges: RecordChange[] = []
  const modIndices = delta.changedModuleIndices
  if (Array.isArray(delta.changedModulesJson)) {
    if (delta.changedModulesJson.length > 0) {
      if (!Array.isArray(modIndices) || modIndices.length !== delta.changedModulesJson.length) return false
    } else if (modIndices !== undefined && (!Array.isArray(modIndices) || modIndices.length !== 0)) {
      return false
    }
    for (let i = 0; i < delta.changedModulesJson.length; i++) {
      const raw = delta.changedModulesJson[i]
      const id = typeof raw === 'string' ? extractModuleIdFromRawJson(raw) : null
      if (!id) return false
      const targetIndex = modIndices![i]
      if (!isValidTargetIndex(targetIndex)) return false
      modChanges.push({ key: id, raw, targetIndex })
    }
  } else {
    if (modIndices !== undefined && (!Array.isArray(modIndices) || modIndices.length !== delta.changedModules.length)) {
      return false
    }
    for (let i = 0; i < delta.changedModules.length; i++) {
      const rec = delta.changedModules[i]
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false
      if (typeof rec.id !== 'string' || rec.id.length === 0) return false
      let targetIndex = -1
      if (modIndices !== undefined) {
        if (!isValidTargetIndex(modIndices[i])) return false
        targetIndex = modIndices[i]
      }
      modChanges.push({ key: rec.id, raw: JSON.stringify(rec), targetIndex })
    }
  }
  if (!applyOrderedRecordDelta(doc.modules, removedModKeys, modChanges)) return false

  // Lines: complete host order, preferring verbatim host JSON records.
  if (Array.isArray(delta.linesJson)) {
    doc.lines = delta.linesJson.slice()
  } else if (Array.isArray(delta.lines)) {
    doc.lines = delta.lines.map(line => JSON.stringify(line))
  }

  return true
}

function serializeRawAutosaveEnvelope(doc: RawAutosaveEnvelope): string {
  const parts: string[] = ['{']
  let firstRoot = true
  for (const [k, rawVal] of doc.header) {
    if (!firstRoot) parts.push(',')
    firstRoot = false
    parts.push(JSON.stringify(k), ':', rawVal)
  }
  if (!firstRoot) parts.push(',')
  parts.push('"static":{')
  let firstStatic = true
  for (const [k, rawVal] of doc.staticExtras) {
    if (!firstStatic) parts.push(',')
    firstStatic = false
    parts.push(JSON.stringify(k), ':', rawVal)
  }
  if (!firstStatic) parts.push(',')
  parts.push(
    '"cells":[',
    doc.cells.raws.join(','),
    '],"modules":[',
    doc.modules.raws.join(','),
    '],"lines":[',
    doc.lines.join(','),
    ']}}',
  )
  return parts.join('')
}

function defaultScheduleEncode(delayMs: number): {
  schedule: (fn: () => void) => unknown
  cancel: (handle: unknown) => void
} {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number
    cancelIdleCallback?: (id: number) => void
    setTimeout?: typeof setTimeout
    clearTimeout?: typeof clearTimeout
  }
  if (typeof g.requestIdleCallback === 'function' && typeof g.cancelIdleCallback === 'function') {
    const req = g.requestIdleCallback.bind(globalThis)
    const cancel = g.cancelIdleCallback.bind(globalThis)
    return {
      schedule: fn => req(fn, { timeout: Math.max(250, delayMs * 4) }),
      cancel: handle => { cancel(handle as number) },
    }
  }
  return {
    schedule: fn => setTimeout(fn, delayMs),
    cancel: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
  }
}

export function createWebGlAutosave(options: CreateWebGlAutosaveOptions): WebGlAutosaveController {
  const {
    enabled,
    storage,
    intervalMs = AUTOSAVE_INTERVAL_MS,
    encodeDelayMs = 150,
    windowTarget = typeof window !== 'undefined' ? window : null,
    documentTarget = typeof document !== 'undefined' ? document : null,
    setIntervalFn = typeof globalThis.setInterval === 'function'
      ? (fn: () => void, ms: number) => globalThis.setInterval(fn, ms)
      : undefined,
    clearIntervalFn = typeof globalThis.clearInterval === 'function'
      ? (handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
      : undefined,
    onSequenceBroken,
    encodeEnvelopeFn,
  } = options

  if (!enabled || !storage) {
    return {
      trackCommand() {},
      noteReject() {},
      noteCommit() {},
      flush() { return false },
      dispose() {},
    }
  }

  const defaultEncode = defaultScheduleEncode(encodeDelayMs)
  const scheduleEncodeFn = options.scheduleEncodeFn ?? defaultEncode.schedule
  const cancelEncodeFn = options.cancelEncodeFn ?? defaultEncode.cancel

  const pendingCommands = new Map<string, AutosaveCommandKind>()
  let hasStoredSlot = false
  try {
    const initial = storage.getItem(AUTOSAVE_KEY)
    hasStoredSlot = typeof initial === 'string' && initial.length > 0
  } catch {
    hasStoredSlot = false
  }

  let docKey: RevisionKey | null = null
  let baseDocumentText: string | null = null
  let parsedDoc: RawAutosaveEnvelope | null = null
  let pendingDeltas: StationCommitDelta[] = []
  let coherent = false

  let encoded: EncodedSnapshot | null = null
  let saved: RevisionKey | null = null
  let dirty = false
  let hasAdoptedCommit = false
  let lastSessionId = ''
  let lastEpoch: number | null = null
  let encodeHandle: unknown = null
  let disposed = false

  const cancelScheduledEncode = (): void => {
    if (encodeHandle !== null) {
      cancelEncodeFn(encodeHandle)
      encodeHandle = null
    }
  }

  const markSequenceBroken = (): void => {
    coherent = false
    cancelScheduledEncode()
    encoded = null
    pendingDeltas = []
    dirty = true
    onSequenceBroken?.()
  }

  const materializeEncoded = (target: RevisionKey): string | null => {
    if (disposed || !coherent || !docKey || !sameKey(docKey, target)) return null
    if (sameKey(encoded, target) && encoded) return encoded.text
    if (pendingDeltas.length === 0 && typeof baseDocumentText === 'string' && baseDocumentText.length > 0) {
      encoded = { ...target, text: baseDocumentText }
      return baseDocumentText
    }
    if (!parsedDoc) {
      if (typeof baseDocumentText !== 'string' || baseDocumentText.length === 0) {
        markSequenceBroken()
        return null
      }
      const parsed = parseRawAutosaveEnvelope(baseDocumentText)
      if (!parsed) {
        markSequenceBroken()
        return null
      }
      parsedDoc = parsed
      baseDocumentText = null
    }
    if (pendingDeltas.length > 0) {
      for (let i = 0; i < pendingDeltas.length; i++) {
        if (!applyDeltaToRawEnvelope(parsedDoc, pendingDeltas[i])) {
          parsedDoc = null
          markSequenceBroken()
          return null
        }
      }
      pendingDeltas = []
    }
    try {
      const rawText = serializeRawAutosaveEnvelope(parsedDoc)
      const text = encodeEnvelopeFn ? encodeEnvelopeFn(rawText) : rawText
      if (!disposed && coherent && docKey && sameKey(docKey, target) && text.length > 0) {
        encoded = { ...target, text }
        return text
      }
      return null
    } catch {
      return null
    }
  }

  const scheduleEncodeForLatest = (): void => {
    cancelScheduledEncode()
    if (disposed || !coherent || !docKey) return
    const target: RevisionKey = { ...docKey }
    encodeHandle = scheduleEncodeFn(() => {
      encodeHandle = null
      if (disposed || !coherent || !docKey || !sameKey(docKey, target)) return
      if (sameKey(encoded, target)) return
      materializeEncoded(target)
    })
  }

  const trackCommand: WebGlAutosaveController['trackCommand'] = (commandId, kind) => {
    if (disposed || !commandId) return
    pendingCommands.set(commandId, kind)
  }

  const noteReject: WebGlAutosaveController['noteReject'] = (commandId) => {
    if (!commandId) return
    pendingCommands.delete(commandId)
  }

  const flush = (): boolean => {
    if (disposed || !dirty || !coherent || !docKey) return false
    const target: RevisionKey = { ...docKey }
    if (sameKey(saved, target)) {
      dirty = false
      return false
    }
    const text = materializeEncoded(target)
    if (!text) return false
    cancelScheduledEncode()
    try {
      storage.setItem(AUTOSAVE_KEY, text)
      if (!disposed && coherent && docKey && sameKey(docKey, target)) {
        saved = target
        dirty = false
        hasStoredSlot = true
      }
      return true
    } catch {
      // Tolerate quota/security errors silently; keep dirty for a later retry.
      return false
    }
  }

  const noteCommit: WebGlAutosaveController['noteCommit'] = ({
    sessionId = '',
    revision,
    stationEpoch,
    sourceId,
    commandId,
    documentText,
    delta = null,
  }) => {
    if (disposed || revision < 0) return
    const hasDoc = typeof documentText === 'string' && documentText.length > 0
    if (!hasDoc && !delta) return

    const commandKind = commandId ? pendingCommands.get(commandId) : undefined
    if (commandId) pendingCommands.delete(commandId)

    const key: RevisionKey = { sessionId, stationEpoch, revision }
    const sessionChanged = hasAdoptedCommit && sessionId !== lastSessionId
    const epochChanged = hasAdoptedCommit && (sessionChanged || stationEpoch !== lastEpoch)
    const isWarmResync = commandKind === 'resync' && hasAdoptedCommit && !epochChanged
    const isColdResync = commandKind === 'resync' && !hasAdoptedCommit
    const isRestore = commandKind === 'restore' ||
      (!commandKind && !hasAdoptedCommit && sourceId === 'autosave')
    const isReplacement = !isRestore && (
      commandKind === 'replace' ||
      epochChanged ||
      (!hasAdoptedCommit && !isColdResync && hasStoredSlot)
    )

    if (hasDoc) {
      // Seed or re-seed from the complete authoritative host v1 envelope in O(1):
      // never scan synchronously during commit adoption, and reuse the raw string directly.
      cancelScheduledEncode()
      baseDocumentText = documentText!
      parsedDoc = null
      pendingDeltas = []
      docKey = key
      coherent = true
      encoded = { ...key, text: documentText! }
      hasAdoptedCommit = true
      lastSessionId = sessionId
      lastEpoch = stationEpoch

      if (isRestore) {
        saved = key
        dirty = false
        hasStoredSlot = true
        return
      }

      if (isWarmResync) {
        if (sameKey(saved, key)) dirty = false
        else if (saved !== null || dirty) dirty = true
        return
      }

      if (isColdResync) {
        if (hasStoredSlot) {
          try { storage.removeItem(AUTOSAVE_KEY) } catch { /* Storage may be blocked. */ }
          hasStoredSlot = false
        }
        saved = key
        dirty = false
        return
      }

      if (isReplacement) {
        // Invalidate the old slot BEFORE attempting to write the replacement so a quota
        // failure can never leave the superseded station behind on reload.
        try { storage.removeItem(AUTOSAVE_KEY) } catch { /* Storage may be blocked. */ }
        hasStoredSlot = false
        saved = null
        dirty = true
        flush()
        return
      }

      // Full-envelope edit fallback on the current station (e.g. rail regen, track line removal).
      dirty = !sameKey(saved, key)
      return
    }

    // Sequential delta commit path: require exact session, stationEpoch, and baseRevision match.
    if (coherent && sameKey(docKey, key)) return

    const matchesSequence =
      coherent &&
      docKey !== null &&
      !isReplacement &&
      docKey.sessionId === sessionId &&
      docKey.stationEpoch === stationEpoch &&
      delta!.revision === revision &&
      delta!.baseRevision === docKey.revision

    if (!matchesSequence) {
      markSequenceBroken()
      return
    }

    // Append raw host delta in O(1) — zero scanning or encoding during commit adoption.
    pendingDeltas.push(delta!)
    docKey = key
    encoded = null
    hasAdoptedCommit = true
    lastSessionId = sessionId
    lastEpoch = stationEpoch
    dirty = !sameKey(saved, key)
    scheduleEncodeForLatest()
  }

  const onVisibilityChange = (): void => {
    if (documentTarget && documentTarget.visibilityState === 'hidden') {
      flush()
    }
  }

  const onPageHide = (): void => {
    flush()
  }

  const onBeforeUnload = (): void => {
    flush()
  }

  let timerHandle: unknown = null
  if (setIntervalFn && intervalMs > 0) {
    timerHandle = setIntervalFn(() => { flush() }, intervalMs)
  }
  documentTarget?.addEventListener('visibilitychange', onVisibilityChange)
  windowTarget?.addEventListener('pagehide', onPageHide)
  windowTarget?.addEventListener('beforeunload', onBeforeUnload)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    cancelScheduledEncode()
    pendingCommands.clear()
    pendingDeltas = []
    parsedDoc = null
    baseDocumentText = null
    if (timerHandle !== null && clearIntervalFn) {
      clearIntervalFn(timerHandle)
      timerHandle = null
    }
    documentTarget?.removeEventListener('visibilitychange', onVisibilityChange)
    windowTarget?.removeEventListener('pagehide', onPageHide)
    windowTarget?.removeEventListener('beforeunload', onBeforeUnload)
  }

  return { trackCommand, noteReject, noteCommit, flush, dispose }
}
