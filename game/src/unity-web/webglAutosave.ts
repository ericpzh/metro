// WebGL player autosave (plan 37 §6.3).
//
// Shares `AUTOSAVE_KEY` (`metro-game.autosave.v1`) and `AUTOSAVE_INTERVAL_MS`
// (5 minutes) with the Three.js shell (`app/autosave.ts`), while respecting
// the Unity bridge's authoritative revision and `stationEpoch` lifecycle:
// - Disabled on desktop WebView2 overlays (which keep `StationDesktopUiPresenter`
//   native autosave) and on `/benchmark` routes.
// - Synchronously caches exportable v1 JSON text on every committed revision
//   (including delta commits and undo/redo) so `visibilitychange` (`hidden`) and
//   `pagehide` flush with zero async host round-trip.
// - On station replacement (`stationEpoch` change), clears `AUTOSAVE_KEY` before
//   writing the new station so a quota error never leaves an older station behind.
// - On startup, a demo route or explicit open always wins over autosave restore;
//   invalid/corrupt autosave text falls back cleanly to `station.resync`.

import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_KEY } from '../app/autosave.ts'
import { parse, serialize } from '../persistence/save.ts'
import type { StationState } from '../build/model.ts'

export type AutosaveStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface WebGlAutosaveController {
  /** Record a freshly committed station revision with an exportable v1 snapshot. */
  noteCommit(input: {
    revision: number
    stationEpoch: number
    sourceId: string | null
    documentText: string | null
    station?: StationState | null
  }): void
  /** Synchronously flush the latest cached snapshot if dirty. */
  flush(): boolean
  /** Tear down interval and window/document listeners. */
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
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
  documentTarget?: (Pick<Document, 'addEventListener' | 'removeEventListener'> & { readonly visibilityState: string }) | null
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
}

export function createWebGlAutosave(options: CreateWebGlAutosaveOptions): WebGlAutosaveController {
  const {
    enabled,
    storage,
    intervalMs = AUTOSAVE_INTERVAL_MS,
    windowTarget = typeof window !== 'undefined' ? window : null,
    documentTarget = typeof document !== 'undefined' ? document : null,
    setIntervalFn = typeof globalThis.setInterval === 'function'
      ? (fn: () => void, ms: number) => globalThis.setInterval(fn, ms)
      : undefined,
    clearIntervalFn = typeof globalThis.clearInterval === 'function'
      ? (handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
      : undefined,
  } = options

  if (!enabled || !storage) {
    return {
      noteCommit() {},
      flush() { return false },
      dispose() {},
    }
  }

  let cachedText: string | null = null
  let cachedRevision = -1
  let savedRevision = -1
  let lastEpoch: number | null = null
  let disposed = false

  const flush = (): boolean => {
    if (disposed || cachedText === null || cachedRevision < 0 || cachedRevision === savedRevision) {
      return false
    }
    try {
      storage.setItem(AUTOSAVE_KEY, cachedText)
      savedRevision = cachedRevision
      return true
    } catch {
      // Tolerate quota/security errors silently; keep dirty for a later retry.
      return false
    }
  }

  const noteCommit: WebGlAutosaveController['noteCommit'] = ({
    revision,
    stationEpoch,
    sourceId,
    documentText,
    station,
  }) => {
    if (disposed || revision < 0) return
    const nextText = typeof documentText === 'string' && documentText.length > 0
      ? documentText
      : station
        ? serialize(station)
        : null
    if (!nextText) return

    const isFirstCommit = lastEpoch === null
    const epochChanged = !isFirstCommit && stationEpoch !== lastEpoch
    lastEpoch = stationEpoch
    cachedText = nextText
    cachedRevision = revision

    // If this very first commit is restoring the autosave itself, mark it already clean
    // so we don't redundantly re-write the exact bytes we just read.
    if (isFirstCommit && sourceId === 'autosave') {
      savedRevision = revision
      return
    }

    if (epochChanged) {
      // Clear before write: if the replacement station exceeds quota, never leave the
      // previous station behind under `AUTOSAVE_KEY`.
      try { storage.removeItem(AUTOSAVE_KEY) } catch { /* Storage may be blocked. */ }
      savedRevision = -1
      flush()
    }
  }

  const onVisibilityChange = (): void => {
    if (documentTarget && documentTarget.visibilityState === 'hidden') {
      flush()
    }
  }

  const onPageHide = (): void => {
    flush()
  }

  let timerHandle: unknown = null
  if (setIntervalFn && intervalMs > 0) {
    timerHandle = setIntervalFn(() => { flush() }, intervalMs)
  }
  documentTarget?.addEventListener('visibilitychange', onVisibilityChange)
  windowTarget?.addEventListener('pagehide', onPageHide)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (timerHandle !== null && clearIntervalFn) {
      clearIntervalFn(timerHandle)
      timerHandle = null
    }
    documentTarget?.removeEventListener('visibilitychange', onVisibilityChange)
    windowTarget?.removeEventListener('pagehide', onPageHide)
  }

  return { noteCommit, flush, dispose }
}
