// Plan 11 command channel: one revisioned envelope in, one snapshot out.
//
// The Unity player owns the committed document revision, the camera and the
// simulation; this module is transport plus a small reducer. It never invents a
// station: `state` replies replace what C# published, full `commit` replies carry
// the whole save on open/reconnect/resync, and local `commit` replies carry a
// versioned `delta` against `baseRevision` (plan 32 §F). A reply from an older
// session is dropped, so a station switch cannot be overwritten by a late answer
// from the station the player just left (`11-station-loader-and-zoo-repair.md`, A6).

export const SCHEMA_VERSION = 2
export const STATION_DELTA_SCHEMA_VERSION = 1

export interface Envelope {
  schemaVersion: number
  id: string
  sessionId: string
  type: string
  expectedRevision?: number
  payload?: unknown
}

export type ReplyKind = 'ack' | 'reject' | 'state' | 'commit' | 'camera'

export interface Reply {
  schemaVersion?: number
  kind?: ReplyKind
  id?: string
  sessionId?: string
  revision?: number
  accepted?: boolean
  code?: string
  payload?: Record<string, unknown> | null
}

export interface RejectRecord {
  id: string
  type: string
  code: string
  /** The host's own sentence for the refusal, when it sent one (`payload.reason`). */
  reason?: string
}

export interface StationCommitDelta {
  schemaVersion: number
  baseRevision: number
  revision: number
  savedAt?: string
  name?: string
  nameEn?: string
  city?: string
  levelBase?: number
  storeyHeight?: number
  removedCells: [number, number, number][]
  changedCells: Record<string, unknown>[]
  removedModules: string[]
  changedModules: Record<string, unknown>[]
  sourceHash?: string | null
  sourceHashRevision?: number
}

export interface StationSnapshot {
  ready: boolean
  sessionId: string
  revision: number
  sourceId: string | null
  sourceHash: string | null
  sourceHashRevision?: number
  /** The v1 save text from the latest full commit, or null when only a delta is held for `revision`. */
  document: string | null
  /** Revision whose full save text is in `document`; the store only re-parses when `documentRevision === revision`. */
  documentRevision: number
  /** Versioned local commit delta when `revision > documentRevision`, or null on full commits. */
  delta?: StationCommitDelta | null
  /** Latest revision adopted into the shared UI store (full document or sequential delta). */
  adoptedRevision?: number
  /** True when a delta commit arrived with a base gap or invalid schema and `station.resync` is pending. */
  resyncNeeded?: boolean
  /** Duration in ms of the latest `adopt` call for profiling. */
  lastAdoptMs?: number
  state: Record<string, unknown>
  capabilities: Record<string, boolean>
  rejects: RejectRecord[]
}

export interface UnityPlayer {
  SendMessage(object: string, method: string, value?: string): void
}

export interface RequestOptions {
  id?: string
  expectedRevision?: number
  timeoutMs?: number
}

export class BridgeRequestError extends Error {
  readonly code: string
  readonly commandType: string
  readonly commandId: string
  readonly reason?: string

  constructor(code: string, commandType: string, commandId: string, reason?: string) {
    super(reason && reason.length > 0 ? `${commandType} (${code}): ${reason}` : `${commandType} (${code})`)
    this.name = 'BridgeRequestError'
    this.code = code
    this.commandType = commandType
    this.commandId = commandId
    if (reason !== undefined && reason.length > 0) this.reason = reason
  }
}

interface PendingRequest {
  id: string
  type: string
  sessionId: string
  timer: ReturnType<typeof setTimeout> | null
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: BridgeRequestError) => void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000
const MAX_RETIRED_REQUEST_IDS = 512

const EMPTY: StationSnapshot = {
  ready: false,
  sessionId: '',
  revision: -1,
  sourceId: null,
  sourceHash: null,
  sourceHashRevision: -1,
  document: null,
  documentRevision: -1,
  delta: null,
  adoptedRevision: -1,
  resyncNeeded: false,
  lastAdoptMs: 0,
  state: {},
  capabilities: {},
  rejects: [],
}

let snapshot: StationSnapshot = EMPTY
let player: UnityPlayer | null = null
let objectName = 'StationGame'
let counter = 0
let resyncInFlight = false
const listeners = new Set<() => void>()
/**
 * The per-frame camera pose channel (plan 29 §5). It is deliberately **outside** the
 * snapshot: a pose arrives at camera cadence, and folding it into `state` would wake every
 * React subscriber sixty times a second. Its one consumer is `createStationCameraPort`.
 */
const cameraPoseListeners = new Set<(camera: Record<string, unknown>, sequence: number) => void>()
const pending = new Map<string, { type: string; at: number }>()
const pendingRequests = new Map<string, PendingRequest>()
const retiredRequestIds = new Set<string>()
const commitListeners = new Set<(snapshot: StationSnapshot) => void>()
// The shell mounts before Unity finishes booting, so the first demo open is sent
// into this queue and flushed once the player registers. Nothing is dropped and
// no command is replayed twice: the queue holds only commands, not documents.
const queue: { type: string; payload?: unknown; expectedRevision?: number }[] = []

function retireRequestId(id: string): void {
  retiredRequestIds.add(id)
  if (retiredRequestIds.size > MAX_RETIRED_REQUEST_IDS) {
    const oldest = retiredRequestIds.values().next().value
    if (oldest !== undefined) retiredRequestIds.delete(oldest)
  }
}

function cancelPendingRequests(code: string, reason: string): void {
  const entries = [...pendingRequests.values()]
  pendingRequests.clear()
  retiredRequestIds.clear()
  for (const entry of entries) {
    if (entry.timer !== null) clearTimeout(entry.timer)
    pending.delete(entry.id)
    entry.reject(new BridgeRequestError(code, entry.type, entry.id, reason))
  }
}

// A session id names one Unity player generation. `register` mints a new one, so
// every reply still in flight from the previous page or player is fenced out.
function newSessionId(): string {
  counter += 1
  return `s-${Date.now().toString(36)}-${counter}`
}

function parseCommitDelta(raw: unknown): StationCommitDelta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== STATION_DELTA_SCHEMA_VERSION) return null
  if (typeof r.baseRevision !== 'number' || !Number.isInteger(r.baseRevision)) return null
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision)) return null
  if (!Array.isArray(r.removedCells) || !Array.isArray(r.changedCells) ||
      !Array.isArray(r.removedModules) || !Array.isArray(r.changedModules)) {
    return null
  }
  return {
    schemaVersion: r.schemaVersion,
    baseRevision: r.baseRevision,
    revision: r.revision,
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : undefined,
    name: typeof r.name === 'string' ? r.name : undefined,
    nameEn: typeof r.nameEn === 'string' ? r.nameEn : undefined,
    city: typeof r.city === 'string' ? r.city : undefined,
    levelBase: typeof r.levelBase === 'number' && Number.isFinite(r.levelBase) ? r.levelBase : undefined,
    storeyHeight: typeof r.storeyHeight === 'number' && Number.isFinite(r.storeyHeight) ? r.storeyHeight : undefined,
    removedCells: r.removedCells as [number, number, number][],
    changedCells: r.changedCells as Record<string, unknown>[],
    removedModules: r.removedModules.filter((id): id is string => typeof id === 'string'),
    changedModules: r.changedModules as Record<string, unknown>[],
    sourceHash: typeof r.sourceHash === 'string' && r.sourceHash.length > 0 ? r.sourceHash : null,
    sourceHashRevision: typeof r.sourceHashRevision === 'number' && Number.isInteger(r.sourceHashRevision) ? r.sourceHashRevision : -1,
  }
}

export function envelope(type: string, payload?: unknown, options: { id?: string; sessionId?: string; expectedRevision?: number } = {}): Envelope {
  const id = options.id ?? `c-${++counter}`
  const sessionId = options.sessionId ?? snapshot.sessionId
  const result: Envelope = { schemaVersion: SCHEMA_VERSION, id, sessionId, type }
  if (options.expectedRevision !== undefined) result.expectedRevision = options.expectedRevision
  if (payload !== undefined) result.payload = payload
  return result
}

/** Reduce one C# reply into the snapshot. Exported for tests: it is pure apart from the store write. */
export function reduce(current: StationSnapshot, reply: Reply): StationSnapshot {
  const sessionId = typeof reply.sessionId === 'string' ? reply.sessionId : ''
  if (sessionId && sessionId !== current.sessionId) return current
  const kind: ReplyKind = reply.kind ?? 'state'
  const revision = typeof reply.revision === 'number' ? reply.revision : current.revision
  const payload = reply.payload ?? {}
  if (kind === 'commit') {
    const hasDocument = typeof payload.document === 'string'
    const hasDelta = !hasDocument && payload.delta !== undefined
    if (hasDocument) {
      if (revision < current.revision) return current
      const document = payload.document as string
      const rawHash = typeof payload.sourceHash === 'string' ? payload.sourceHash : null
      const sourceHash = rawHash !== null ? (rawHash.length > 0 ? rawHash : null) : current.sourceHash
      const sourceHashRevision = typeof payload.sourceHashRevision === 'number'
        ? payload.sourceHashRevision
        : (sourceHash !== null ? revision : (current.sourceHashRevision ?? -1))
      const { document: _doc, delta: _del, ...statePayload } = payload
      return {
        ...current,
        revision,
        document,
        documentRevision: revision,
        delta: null,
        resyncNeeded: false,
        sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : current.sourceId,
        sourceHash,
        sourceHashRevision,
        capabilities: payload.capabilities && typeof payload.capabilities === 'object'
          ? { ...current.capabilities, ...(payload.capabilities as Record<string, boolean>) } : current.capabilities,
        state: { ...current.state, ...statePayload },
      }
    }
    if (hasDelta) {
      // Reject duplicate or out-of-order delta commits.
      if (revision <= current.revision) return current
      const delta = parseCommitDelta(payload.delta)
      const hasBase = current.revision >= 0 &&
        (current.documentRevision === current.revision || current.adoptedRevision === current.revision || current.delta?.revision === current.revision)
      if (!delta || current.resyncNeeded === true || !hasBase || delta.revision !== revision || delta.baseRevision !== current.revision) {
        return current.resyncNeeded === true ? current : { ...current, resyncNeeded: true }
      }
      const rawHash = typeof payload.sourceHash === 'string' ? payload.sourceHash : null
      const sourceHash = rawHash !== null
        ? (rawHash.length > 0 ? rawHash : null)
        : (delta.sourceHash ?? null)
      const sourceHashRevision = typeof payload.sourceHashRevision === 'number'
        ? payload.sourceHashRevision
        : (sourceHash !== null ? revision : (current.sourceHashRevision ?? -1))
      const { document: _doc, delta: _del, ...statePayload } = payload
      return {
        ...current,
        revision,
        document: null,
        delta,
        resyncNeeded: false,
        sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : current.sourceId,
        sourceHash,
        sourceHashRevision,
        capabilities: payload.capabilities && typeof payload.capabilities === 'object'
          ? { ...current.capabilities, ...(payload.capabilities as Record<string, boolean>) } : current.capabilities,
        state: { ...current.state, ...statePayload },
      }
    }
    if (revision < current.revision) return current
    return {
      ...current,
      revision,
      sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : current.sourceId,
      sourceHash: typeof payload.sourceHash === 'string'
        ? (payload.sourceHash.length > 0 ? payload.sourceHash : null)
        : current.sourceHash,
      capabilities: payload.capabilities && typeof payload.capabilities === 'object'
        ? { ...current.capabilities, ...(payload.capabilities as Record<string, boolean>) } : current.capabilities,
      state: { ...current.state, ...payload },
    }
  }
  if (kind === 'ack' || kind === 'reject') {
    const nextRev = revision > current.revision ? revision : current.revision
    const code = reply.code ?? (kind === 'ack' ? 'ok' : 'rejected')
    const next: StationSnapshot = { ...current, revision: nextRev }
    // The camera and view a camera/view command just applied ride its ack, so the shell no
    // longer has to wait for the next 100 ms state interval to hear the result (plan 29 §5).
    const camera = payload.camera
    const view = payload.view
    if (kind === 'ack' && (camera !== undefined || view !== undefined)) {
      const state: Record<string, unknown> = { ...current.state }
      if (camera !== undefined) state.camera = camera
      if (view !== undefined) state.view = view
      if (typeof payload.level === 'number') state.level = payload.level
      next.state = state
    }
    if (kind === 'reject') {
      const id = reply.id ?? ''
      const type = id ? pending.get(id)?.type ?? '' : ''
      const reason = typeof payload.reason === 'string' && payload.reason.length > 0 ? payload.reason : ''
      const record: RejectRecord = { id, type, code }
      if (reason) record.reason = reason
      next.rejects = [...current.rejects, record].slice(-8)
    }
    return next
  }
  if (revision < current.revision) return current
  return { ...current, revision, state: { ...current.state, ...payload } }
}

function deliver(text: string): void {
  let reply: Reply
  try { reply = JSON.parse(text) as Reply } catch { return }
  if (!reply || typeof reply !== 'object') return

  // A frame-cadence camera pose (plan 29 §5): session-fenced, outside the reducer, and
  // delivered to the camera port only. Nothing here changes the revision or the state map.
  if (reply.kind === 'camera') {
    const replySession = typeof reply.sessionId === 'string' ? reply.sessionId : ''
    if (replySession && snapshot.sessionId && replySession !== snapshot.sessionId) return
    const payload = reply.payload && typeof reply.payload === 'object' ? reply.payload as Record<string, unknown> : null
    if (!payload) return
    const camera = payload.camera && typeof payload.camera === 'object'
      ? payload.camera as Record<string, unknown> : null
    if (!camera) return
    const sequence = typeof payload.sequence === 'number' && Number.isFinite(payload.sequence)
      ? payload.sequence
      : (typeof camera.sequence === 'number' && Number.isFinite(camera.sequence) ? camera.sequence : -1)
    for (const listener of cameraPoseListeners) listener(camera, sequence)
    return
  }

  const replyId = typeof reply.id === 'string' ? reply.id : ''
  const replySession = typeof reply.sessionId === 'string' ? reply.sessionId : ''
  if (replyId) {
    const req = pendingRequests.get(replyId)
    if (req) {
      if (replySession && replySession !== req.sessionId) return
      pendingRequests.delete(replyId)
      if (req.timer !== null) clearTimeout(req.timer)
      if (reply.kind !== 'commit') {
        pending.delete(replyId)
        const accepted = reply.accepted !== false && reply.kind !== 'reject'
        if (accepted) {
          req.resolve(reply.payload && typeof reply.payload === 'object' ? reply.payload : {})
        } else {
          const code = typeof reply.code === 'string' && reply.code.length > 0 ? reply.code : 'rejected'
          const reason = reply.payload && typeof reply.payload.reason === 'string' ? reply.payload.reason : undefined
          req.reject(new BridgeRequestError(code, req.type, req.id, reason))
        }
        return
      }
      req.resolve(reply.payload && typeof reply.payload === 'object' ? reply.payload : {})
    } else if (retiredRequestIds.has(replyId) && reply.kind !== 'commit') {
      if (!replySession || replySession === snapshot.sessionId) retiredRequestIds.delete(replyId)
      return
    }
  }

  const before = snapshot
  const next = reduce(before, reply)
  if (replyId) pending.delete(replyId)
  if (next !== before) {
    snapshot = next
    if (reply.kind === 'commit' && !next.resyncNeeded && typeof reply.payload?.document === 'string') {
      resyncInFlight = false
    }
    listeners.forEach(listener => listener())
  }
  if (reply.kind === 'commit') {
    if (next.resyncNeeded) {
      if (!resyncInFlight) {
        resyncInFlight = true
        stationBridge.resync()
      }
      return
    }
    if (next !== before) {
      commitListeners.forEach(listener => listener(next))
    }
  }
}

export const stationBridge = {
  capabilities: { tools: [] as readonly string[], speeds: [1, 4, 16, 64] as readonly number[] },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot(): StationSnapshot { return snapshot },
  /** Fires once per accepted commit, so the shell can adopt the document or delta and rewrite the URL. */
  onCommit(listener: (snapshot: StationSnapshot) => void): () => void {
    commitListeners.add(listener)
    return () => { commitListeners.delete(listener) }
  },
  /**
   * Subscribe to the frame-cadence camera pose channel (`kind: "camera"`). Returns the
   * unsubscribe function. The listener runs for every pose the host publishes, unfiltered
   * and unfenced by the snapshot, so the camera port can coalesce them per animation frame.
   */
  onCameraPose(listener: (camera: Record<string, unknown>, sequence: number) => void): () => void {
    cameraPoseListeners.add(listener)
    return () => { cameraPoseListeners.delete(listener) }
  },
  /** Record that the shell store adopted `revision` (full document or delta) and its adopt duration. */
  noteAdopted(revision: number, adoptMs = 0): void {
    if (snapshot.revision !== revision) return
    snapshot = { ...snapshot, adoptedRevision: revision, lastAdoptMs: adoptMs }
  },
  /**
   * Read the authoritative v1 save text for the current committed revision. Returns
   * immediately when `snapshot.document` already matches `snapshot.revision`, or requests
   * `station.save { includeDocument: true }` on demand after delta commits.
   */
  async readCommittedDocument(): Promise<string | null> {
    const cur = snapshot
    if (typeof cur.document === 'string' && cur.document.length > 0 && cur.documentRevision === cur.revision) {
      return cur.document
    }
    if (!player || cur.revision < 0) return null
    const saved = await stationBridge.request<{ document?: string; sourceHash?: string; revision?: number }>(
      'station.save',
      { includeDocument: true },
    )
    const doc = typeof saved.document === 'string' && saved.document.length > 0 ? saved.document : null
    if (doc && typeof saved.revision === 'number' && saved.revision === snapshot.revision) {
      snapshot = {
        ...snapshot,
        document: doc,
        documentRevision: saved.revision,
        sourceHash: typeof saved.sourceHash === 'string' && saved.sourceHash.length > 0 ? saved.sourceHash : snapshot.sourceHash,
        sourceHashRevision: typeof saved.sourceHash === 'string' && saved.sourceHash.length > 0 ? saved.revision : snapshot.sourceHashRevision,
      }
    }
    return doc
  },
  register(instance: UnityPlayer, name = 'StationGame'): void {
    cancelPendingRequests('session-changed', 'A new Unity player session registered.')
    player = instance
    objectName = name
    resyncInFlight = false
    pending.clear()
    snapshot = { ...EMPTY, ready: true, sessionId: newSessionId() }
    listeners.forEach(listener => listener())
    for (const command of queue.splice(0)) stationBridge.send(command.type, command.payload, { expectedRevision: command.expectedRevision })
  },
  unregister(): void {
    player = null
    resyncInFlight = false
    cancelPendingRequests('disconnected', 'The Unity player unregistered.')
    pending.clear()
    snapshot = EMPTY
    listeners.forEach(listener => listener())
  },
  /** C# calls this through the WebGL bridge; a string keeps the JS boundary trivial. */
  receive(text: string): void { deliver(text) },
  send(type: string, payload?: unknown, options: { id?: string; expectedRevision?: number } = {}): string {
    if (!player) {
      queue.push({ type, payload, expectedRevision: options.expectedRevision })
      return ''
    }
    const message = envelope(type, payload, options)
    pending.set(message.id, { type, at: Date.now() })
    player.SendMessage(objectName, 'BrowserCommand', JSON.stringify(message))
    return message.id
  },
  /**
   * Send a one-shot correlated command and resolve with the host's ack payload.
   * Pending callback registration happens before `SendMessage` so synchronous
   * replies settle safely, and non-commit replies return before `reduce` so a
   * late read ack can never roll back `snapshot.revision`.
   */
  request<TPayload = Record<string, unknown>>(type: string, payload?: unknown, options: RequestOptions = {}): Promise<TPayload> {
    const activePlayer = player
    if (!activePlayer) {
      return Promise.reject(new BridgeRequestError('no-player', type, options.id ?? '', 'No Unity player is registered.'))
    }
    const sessionId = snapshot.sessionId
    const message = envelope(type, payload, {
      id: options.id,
      sessionId,
      expectedRevision: options.expectedRevision,
    })
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    return new Promise<TPayload>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            if (!pendingRequests.delete(message.id)) return
            pending.delete(message.id)
            retireRequestId(message.id)
            reject(new BridgeRequestError('timeout', type, message.id, 'Bridge request timed out.'))
          }, timeoutMs)
        : null
      pendingRequests.set(message.id, {
        id: message.id,
        type,
        sessionId,
        timer,
        resolve: value => resolve(value as TPayload),
        reject,
      })
      try {
        activePlayer.SendMessage(objectName, 'BrowserCommand', JSON.stringify(message))
      } catch (error) {
        if (pendingRequests.delete(message.id)) {
          if (timer !== null) clearTimeout(timer)
          reject(new BridgeRequestError(
            'send-failed',
            type,
            message.id,
            error instanceof Error ? error.message : String(error),
          ))
        }
      }
    })
  },
  /** Ask for the committed document again, e.g. after a reconnect or a dropped commit. */
  resync(): void { stationBridge.send('station.resync') },
  /** Rejects still unanswered; useful for the verifier and the status bar. */
  pending(): { id: string; type: string; at: number }[] {
    return [...pending.entries()].map(([id, value]) => ({ id, ...value }))
  },
}

export type StationBridge = typeof stationBridge
