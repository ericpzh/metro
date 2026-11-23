// WebGL player autosave (plan 37 §6.3, plan 39 §3 & §4).
//
// Shares `AUTOSAVE_KEY` (`metro-game.autosave.v1`) and `AUTOSAVE_INTERVAL_MS`
// (5 minutes) with the Three.js shell (`app/autosave.ts`), while respecting
// the Unity bridge's authoritative session, revision and `stationEpoch` lifecycle:
// - Disabled on desktop WebView2 overlays (which keep `StationDesktopUiPresenter`
//   native autosave) and on `/benchmark` routes.
// - Never runs `serialize(station)` synchronously inside `noteCommit` (commit
//   adoption stays O(1)). Reuses a complete host `documentText` envelope when
//   present and coalesces delta-derived encoding outside input handling.
// - Keeps an unload-safe synchronous `flush()` on interval, `visibilitychange`
//   (`hidden`), `pagehide`, and `beforeunload` that encodes the newest dirty
//   revision on demand without waiting for any bridge response.
// - Tracks explicit startup/open/new/demo/restore/resync commands by correlated
//   command ID. Any accepted replacement that supersedes a stored autosave
//   (including the very first accepted commit on a demo route) invalidates
//   `AUTOSAVE_KEY` BEFORE attempting the replacement write, and keeps the new
//   revision dirty if storage rejects it (e.g. quota).

import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_KEY } from '../app/autosave.ts'
import { parse, serialize } from '../persistence/save.ts'
import type { StationState } from '../build/model.ts'

export type AutosaveStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export type AutosaveCommandKind = 'replace' | 'restore' | 'resync'

export interface AutosaveCommitInput {
  sessionId?: string
  revision: number
  stationEpoch: number
  sourceId: string | null
  commandId?: string | null
  documentText: string | null
  station?: StationState | null
}

export interface WebGlAutosaveController {
  /** Correlate an outgoing station-load command ID with its lifecycle intent. */
  trackCommand(commandId: string, kind: AutosaveCommandKind): void
  /** Clear a tracked command when the host refuses it (leaving the last save untouched). */
  noteReject(commandId: string): void
  /** Record a freshly committed station revision in O(1) without encoding delta snapshots. */
  noteCommit(input: AutosaveCommitInput): void
  /** Synchronously flush the latest dirty revision (encoding on demand if needed). */
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
  serializeFn?: (station: StationState) => string
}

interface RevisionKey {
  sessionId: string
  stationEpoch: number
  revision: number
}

interface LatestSnapshot extends RevisionKey {
  documentText: string | null
  station: StationState | null
}

interface EncodedSnapshot extends RevisionKey {
  text: string
}

function sameKey(a: RevisionKey | null, b: RevisionKey | null): boolean {
  return a !== null && b !== null &&
    a.sessionId === b.sessionId &&
    a.stationEpoch === b.stationEpoch &&
    a.revision === b.revision
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
    serializeFn = serialize,
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

  let latest: LatestSnapshot | null = null
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

  const scheduleEncodeForLatest = (): void => {
    cancelScheduledEncode()
    if (disposed || !latest || !latest.station) return
    const target: RevisionKey = {
      sessionId: latest.sessionId,
      stationEpoch: latest.stationEpoch,
      revision: latest.revision,
    }
    encodeHandle = scheduleEncodeFn(() => {
      encodeHandle = null
      if (disposed || !latest || !sameKey(latest, target)) return
      if (sameKey(encoded, target)) return
      if (!latest.station) return
      try {
        const text = serializeFn(latest.station)
        if (!disposed && latest && sameKey(latest, target) && text.length > 0) {
          encoded = { ...target, text }
        }
      } catch {
        // Keep latest dirty so a later retry or synchronous flush can attempt again.
      }
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
    if (disposed || !dirty || !latest) return false
    const target: RevisionKey = {
      sessionId: latest.sessionId,
      stationEpoch: latest.stationEpoch,
      revision: latest.revision,
    }
    if (sameKey(saved, target)) {
      dirty = false
      return false
    }
    let text: string | null = null
    if (sameKey(encoded, target) && encoded) {
      text = encoded.text
    } else if (typeof latest.documentText === 'string' && latest.documentText.length > 0) {
      text = latest.documentText
      encoded = { ...target, text }
    } else if (latest.station) {
      try {
        text = serializeFn(latest.station)
        if (text.length > 0) encoded = { ...target, text }
      } catch {
        return false
      }
    }
    if (!text) return false
    cancelScheduledEncode()
    try {
      storage.setItem(AUTOSAVE_KEY, text)
      if (!disposed && latest && sameKey(latest, target)) {
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
    station = null,
  }) => {
    if (disposed || revision < 0) return
    const hasDoc = typeof documentText === 'string' && documentText.length > 0
    if (!hasDoc && !station) return

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

    // Record the latest authoritative snapshot in O(1) — zero delta serialization here.
    latest = { ...key, documentText: hasDoc ? documentText : null, station: station ?? null }
    hasAdoptedCommit = true
    lastSessionId = sessionId
    lastEpoch = stationEpoch

    if (hasDoc) {
      cancelScheduledEncode()
      encoded = { ...key, text: documentText! }
    } else {
      encoded = null
      scheduleEncodeForLatest()
    }

    if (isRestore) {
      saved = key
      dirty = false
      hasStoredSlot = true
      return
    }

    if (isWarmResync) {
      // A warm resync republishes the current station without wiping a saved slot
      // or clearing pending dirty state; its full envelope is now cached in `encoded`.
      if (sameKey(saved, key)) dirty = false
      return
    }

    if (isColdResync) {
      // A cold resync opens the host's fresh default station when no autosave was restored.
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

    // Ordinary local edit, undo, or redo on the current station.
    dirty = !sameKey(saved, key)
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
