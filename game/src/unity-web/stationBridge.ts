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

export type ReplyKind = 'ack' | 'reject' | 'state' | 'commit' | 'camera' | 'audio'

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
  /** Exact host JSON text for each changed cell record, preserving large integers & `__proto__` (plan 41 §1). */
  changedCellsJson?: string[]
  /** Target 0-based index in `static.cells` for each changed cell record (plan 41 §1). */
  changedCellIndices?: number[]
  removedModules: string[]
  changedModules: Record<string, unknown>[]
  /** Exact host JSON text for each changed module record, preserving large integers & `__proto__` (plan 41 §1). */
  changedModulesJson?: string[]
  /** Target 0-based index in `static.modules` for each changed module record (plan 41 §1). */
  changedModuleIndices?: number[]
  lines?: Record<string, unknown>[]
  /** Exact host JSON text for the full `static.lines` list when lines changed (plan 41 §1). */
  linesJson?: string[]
  sourceHash?: string | null
  sourceHashRevision?: number
}

export interface StationSnapshot {
  ready: boolean
  sessionId: string
  revision: number
  /** Monotonic host counter bumped on every non-edit station load (`station.new` / `station.open` / `station.openDemo`). */
  stationEpoch: number
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
  /** Command id of the latest accepted commit reply (for correlating startup / add-line commands). */
  lastCommitId?: string
  /** Created line id emitted by a correlated `edit.line.add` commit reply, or null. */
  lastCommitLineId?: string | null
  state: Record<string, unknown>
  capabilities: Record<string, boolean>
  rejects: RejectRecord[]
}

export interface UnityPlayer {
  SendMessage(object: string, method: string, value?: string): void
}

export interface SendIntent {
  id: string
  type: string
  sessionId: string
  stationEpoch: number
  revision: number
  queued: boolean
}

export interface SendOptions {
  id?: string
  expectedRevision?: number
  /**
   * Invoked synchronously with the reserved command ID when `send()` accepts the command
   * (either queued before player registration/load or dispatched immediately).
   */
  beforeSend?: (intent: SendIntent) => void
  /**
   * Invoked immediately before `player.SendMessage` with the live `(sessionId, stationEpoch, revision)`
   * that the command is actually dispatched against (after any queued station load it targets
   * has been accepted and adopted). Ensures synchronous WebGL replies and queued startup drains
   * share the same registration ordering (plan 41 §2, plan 42 §1 & §2).
   */
  beforeDispatch?: (intent: SendIntent) => void
  /**
   * Invoked if a queued command is cancelled before host dispatch (e.g. player disconnect,
   * rejected target station load, failed shell adoption, or superseded by a station replacement).
   */
  onCancel?: (id: string, reason: string) => void
}

export interface AdoptionTarget {
  commandId?: string
  sessionId?: string
  stationEpoch?: number
}

export interface AdoptionFailureTarget {
  commandId: string
  sessionId: string
  stationEpoch: number
  revision: number
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
  stationEpoch: 0,
  sourceId: null,
  sourceHash: null,
  sourceHashRevision: -1,
  document: null,
  documentRevision: -1,
  delta: null,
  adoptedRevision: -1,
  resyncNeeded: false,
  lastAdoptMs: 0,
  lastCommitId: '',
  lastCommitLineId: null,
  state: {},
  capabilities: {},
  rejects: [],
}

/** Extract authoritative undo/redo availability from a committed host snapshot. */
export function readHostHistory(snap: StationSnapshot): { canUndo: boolean; canRedo: boolean } {
  const st = snap.state
  const edit = st.edit as Record<string, unknown> | null | undefined
  const canUndo = typeof st.canUndo === 'boolean'
    ? st.canUndo
    : typeof edit?.canUndo === 'boolean'
      ? edit.canUndo
      : typeof edit?.undoDepth === 'number' && edit.undoDepth > 0
  const canRedo = typeof st.canRedo === 'boolean'
    ? st.canRedo
    : typeof edit?.canRedo === 'boolean'
      ? edit.canRedo
      : typeof edit?.redoDepth === 'number' && edit.redoDepth > 0
  return { canUndo, canRedo }
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
const audioListeners = new Set<(payload: Record<string, unknown>) => void>()
const pending = new Map<string, { type: string; at: number }>()
const pendingRequests = new Map<string, PendingRequest>()
const retiredRequestIds = new Set<string>()
const commitListeners = new Set<(snapshot: StationSnapshot) => void>()
interface QueuedCommand {
  id: string
  type: string
  payload?: unknown
  expectedRevision?: number
  targetLoadId: string | null
  beforeDispatch?: (intent: SendIntent) => void
  onCancel?: (id: string, reason: string) => void
}

const STATION_LOAD_TYPES = new Set(['station.open', 'station.openDemo', 'station.new', 'station.resync'])
function isStationLoadType(type: string): boolean {
  return STATION_LOAD_TYPES.has(type)
}

function targetsStationDocument(type: string): boolean {
  return type.startsWith('edit.') || type.startsWith('face.') || type.startsWith('road.') || type.startsWith('sign.')
}

interface ActiveQueuedLoad {
  id: string
  sessionId: string
  type: string
  /** Populated only once the host's matching commit for this load is accepted by `reduce()`. */
  committed: {
    sessionId: string
    stationEpoch: number
    revision: number
  } | null
}

interface DependentDispatchGuard {
  loadId: string
  sessionId: string
  stationEpoch: number
  revision: number
}

// The shell mounts before Unity finishes booting, so startup commands wait in
// this queue and flush once the player registers. Station loads drain strictly
// FIFO with at most one active load at a time; dependent document edits wait
// until their target load completes shell adoption so their intent and revision
// guard bind to the resulting session, stationEpoch, and revision (plan 41 §2, plan 42 §1 & §2).
const queue: QueuedCommand[] = []
let activeQueuedLoad: ActiveQueuedLoad | null = null
let lastAdoptedLoadId: string | null = null
let lastDependentGuard: DependentDispatchGuard | null = null
let drainingQueue = false
let deliverDepth = 0
let pendingDrainAfterDeliver = false

function cancelQueuedCommands(predicate: (cmd: QueuedCommand) => boolean, reason: string): void {
  const cancelled: QueuedCommand[] = []
  let write = 0
  for (let i = 0; i < queue.length; i++) {
    const cmd = queue[i]
    if (predicate(cmd)) {
      cancelled.push(cmd)
    } else {
      queue[write++] = cmd
    }
  }
  queue.length = write
  for (const cmd of cancelled) {
    try { cmd.onCancel?.(cmd.id, reason) } catch { /* caller cleanup must not break bridge */ }
  }
}

function findLatestLoadId(): string | null {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (isStationLoadType(queue[i].type)) return queue[i].id
  }
  return activeQueuedLoad ? activeQueuedLoad.id : null
}

function hasQueuedLoadOrDependent(): boolean {
  for (let i = 0; i < queue.length; i++) {
    if (isStationLoadType(queue[i].type) || queue[i].targetLoadId !== null) return true
  }
  return false
}

function resolveDispatchExpectedRevision(cmd: { expectedRevision?: number; targetLoadId: string | null }): number | undefined {
  // Preserve caller-supplied revision guard verbatim for edits authored against an already loaded document.
  if (cmd.targetLoadId === null) return cmd.expectedRevision
  if (snapshot.revision < 0) return undefined
  const alreadyGuardedAtRevision =
    lastDependentGuard !== null &&
    lastDependentGuard.loadId === cmd.targetLoadId &&
    lastDependentGuard.sessionId === snapshot.sessionId &&
    lastDependentGuard.stationEpoch === snapshot.stationEpoch &&
    lastDependentGuard.revision === snapshot.revision
  if (alreadyGuardedAtRevision) return undefined
  lastDependentGuard = {
    loadId: cmd.targetLoadId,
    sessionId: snapshot.sessionId,
    stationEpoch: snapshot.stationEpoch,
    revision: snapshot.revision,
  }
  return snapshot.revision
}

function dispatchToPlayer(cmd: {
  id: string
  type: string
  payload?: unknown
  expectedRevision?: number
  targetLoadId: string | null
  beforeDispatch?: (intent: SendIntent) => void
}): void {
  if (!player) return
  const dispatchSession = snapshot.sessionId
  const effectiveExpectedRevision = resolveDispatchExpectedRevision(cmd)
  cmd.beforeDispatch?.({
    id: cmd.id,
    type: cmd.type,
    sessionId: snapshot.sessionId,
    stationEpoch: snapshot.stationEpoch,
    revision: snapshot.revision,
    queued: false,
  })
  if (!player || snapshot.sessionId !== dispatchSession) return
  const message = envelope(cmd.type, cmd.payload, {
    id: cmd.id,
    sessionId: dispatchSession,
    expectedRevision: effectiveExpectedRevision,
  })
  pending.set(message.id, { type: cmd.type, at: Date.now() })
  player.SendMessage(objectName, 'BrowserCommand', JSON.stringify(message))
}

function scheduleDrain(): void {
  if (deliverDepth > 0) {
    pendingDrainAfterDeliver = true
    return
  }
  drainQueue()
}

function drainQueue(): void {
  if (drainingQueue || !player) return
  drainingQueue = true
  try {
    while (player && queue.length > 0) {
      if (activeQueuedLoad !== null) {
        break
      }
      const next = queue[0]
      if (next.targetLoadId !== null && next.targetLoadId !== lastAdoptedLoadId) {
        queue.shift()
        try { next.onCancel?.(next.id, 'load-mismatch') } catch { /* caller cleanup must not break bridge */ }
        continue
      }
      queue.shift()
      if (isStationLoadType(next.type)) {
        activeQueuedLoad = {
          id: next.id,
          sessionId: snapshot.sessionId,
          type: next.type,
          committed: null,
        }
        lastAdoptedLoadId = null
        lastDependentGuard = null
      }
      dispatchToPlayer(next)
    }
  } finally {
    drainingQueue = false
  }
}

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

function parseJsonObjectArray(rawArr: unknown): { raws: string[]; objects: Record<string, unknown>[] } | null {
  if (!Array.isArray(rawArr)) return null
  const raws: string[] = []
  const objects: Record<string, unknown>[] = []
  for (let i = 0; i < rawArr.length; i++) {
    const item = rawArr[i]
    if (typeof item !== 'string' || item.length === 0) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(item)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    raws.push(item)
    objects.push(parsed as Record<string, unknown>)
  }
  return { raws, objects }
}

function parseNonNegativeIntArray(rawArr: unknown, expectedLength: number): number[] | null {
  if (!Array.isArray(rawArr) || rawArr.length !== expectedLength) return null
  const out: number[] = []
  for (let i = 0; i < rawArr.length; i++) {
    const v = rawArr[i]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    out.push(v)
  }
  return out
}

function parseCommitDelta(raw: unknown): StationCommitDelta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== STATION_DELTA_SCHEMA_VERSION) return null
  if (typeof r.baseRevision !== 'number' || !Number.isInteger(r.baseRevision)) return null
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision)) return null
  if (!Array.isArray(r.removedCells) || !Array.isArray(r.removedModules)) {
    return null
  }

  let changedCells: Record<string, unknown>[]
  let changedCellsJson: string[] | undefined
  if (r.changedCellsJson !== undefined) {
    const parsed = parseJsonObjectArray(r.changedCellsJson)
    if (!parsed) return null
    changedCells = parsed.objects
    changedCellsJson = parsed.raws
  } else if (Array.isArray(r.changedCells)) {
    changedCells = r.changedCells as Record<string, unknown>[]
  } else {
    return null
  }
  let changedCellIndices: number[] | undefined
  if (r.changedCellIndices !== undefined) {
    const parsed = parseNonNegativeIntArray(r.changedCellIndices, changedCells.length)
    if (!parsed) return null
    changedCellIndices = parsed
  }

  let changedModules: Record<string, unknown>[]
  let changedModulesJson: string[] | undefined
  if (r.changedModulesJson !== undefined) {
    const parsed = parseJsonObjectArray(r.changedModulesJson)
    if (!parsed) return null
    changedModules = parsed.objects
    changedModulesJson = parsed.raws
  } else if (Array.isArray(r.changedModules)) {
    changedModules = r.changedModules as Record<string, unknown>[]
  } else {
    return null
  }
  let changedModuleIndices: number[] | undefined
  if (r.changedModuleIndices !== undefined) {
    const parsed = parseNonNegativeIntArray(r.changedModuleIndices, changedModules.length)
    if (!parsed) return null
    changedModuleIndices = parsed
  }

  let lines: Record<string, unknown>[] | undefined
  let linesJson: string[] | undefined
  if (r.linesJson !== undefined) {
    const parsed = parseJsonObjectArray(r.linesJson)
    if (!parsed) return null
    lines = parsed.objects
    linesJson = parsed.raws
  } else if (Array.isArray(r.lines)) {
    lines = r.lines as Record<string, unknown>[]
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
    changedCells,
    changedCellsJson,
    changedCellIndices,
    removedModules: r.removedModules.filter((id): id is string => typeof id === 'string'),
    changedModules,
    changedModulesJson,
    changedModuleIndices,
    lines,
    linesJson,
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
  const stationEpoch = typeof payload.stationEpoch === 'number' && Number.isInteger(payload.stationEpoch)
    ? payload.stationEpoch
    : current.stationEpoch
  if (kind === 'commit') {
    const commitId = typeof reply.id === 'string' ? reply.id : ''
    const commitLineId = typeof payload.lineId === 'string' && payload.lineId.length > 0 ? payload.lineId : null
    const hasDocument = typeof payload.document === 'string'
    const hasDelta = !hasDocument && payload.delta !== undefined
    if (hasDocument) {
      if (revision < current.revision) return current
      const isDuplicateDocCommit =
        revision === current.revision &&
        stationEpoch === current.stationEpoch &&
        current.documentRevision === revision &&
        !current.resyncNeeded &&
        (commitId === '' || commitId === (current.lastCommitId ?? ''))
      if (isDuplicateDocCommit) return current
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
        stationEpoch,
        document,
        documentRevision: revision,
        delta: null,
        resyncNeeded: false,
        lastCommitId: commitId,
        lastCommitLineId: commitLineId,
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
        stationEpoch,
        document: null,
        delta,
        resyncNeeded: false,
        lastCommitId: commitId,
        lastCommitLineId: commitLineId,
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
      stationEpoch,
      lastCommitId: commitId,
      lastCommitLineId: commitLineId,
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
    // The camera and view a camera/view command just applied ride its ack, so the shell no
    // longer has to wait for the next 100 ms state interval to hear the result (plan 29 §5).
    const camera = payload.camera
    const view = payload.view
    const edit = payload.edit
    const hasStateUpdate = kind === 'ack' && (camera !== undefined || view !== undefined || edit !== undefined)
    if (kind === 'ack' && !hasStateUpdate && nextRev === current.revision) {
      return current
    }
    const next: StationSnapshot = { ...current, revision: nextRev }
    if (hasStateUpdate) {
      const state: Record<string, unknown> = { ...current.state }
      if (camera !== undefined) state.camera = camera
      if (view !== undefined) state.view = view
      if (edit !== undefined) state.edit = edit
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
  return { ...current, revision, stationEpoch, state: { ...current.state, ...payload } }
}

function deliver(text: string): void {
  let reply: Reply
  try { reply = JSON.parse(text) as Reply } catch { return }
  if (!reply || typeof reply !== 'object') return
  if (reply.kind === 'audio') {
    if (reply.sessionId === snapshot.sessionId && reply.payload) {
      for (const listener of audioListeners) listener(reply.payload)
    }
    return
  }

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
    if (next === before) {
      return
    }
    if (next.resyncNeeded) {
      if (!resyncInFlight) {
        resyncInFlight = true
        stationBridge.resync()
      }
      return
    }
    let supersededLoadId: string | null = null
    if (activeQueuedLoad && activeQueuedLoad.sessionId === next.sessionId) {
      if (replyId === activeQueuedLoad.id && activeQueuedLoad.committed === null) {
        activeQueuedLoad.committed = {
          sessionId: next.sessionId,
          stationEpoch: next.stationEpoch,
          revision: next.revision,
        }
      } else if (replyId !== activeQueuedLoad.id && next.stationEpoch !== before.stationEpoch) {
        supersededLoadId = activeQueuedLoad.id
      }
    }
    deliverDepth += 1
    try {
      commitListeners.forEach(listener => listener(next))
      if (supersededLoadId !== null && activeQueuedLoad !== null && activeQueuedLoad.id === supersededLoadId) {
        activeQueuedLoad = null
        lastAdoptedLoadId = null
        lastDependentGuard = null
        cancelQueuedCommands(cmd => cmd.targetLoadId === supersededLoadId, 'station-replaced')
        pendingDrainAfterDeliver = true
      }
    } finally {
      deliverDepth -= 1
    }
    if (deliverDepth === 0 && pendingDrainAfterDeliver) {
      pendingDrainAfterDeliver = false
      drainQueue()
    }
    return
  }
  if (reply.kind === 'reject' && activeQueuedLoad &&
      activeQueuedLoad.committed === null &&
      replyId === activeQueuedLoad.id &&
      (!replySession || replySession === activeQueuedLoad.sessionId)) {
    const failedLoadId = activeQueuedLoad.id
    activeQueuedLoad = null
    lastAdoptedLoadId = null
    lastDependentGuard = null
    cancelQueuedCommands(cmd => cmd.targetLoadId === failedLoadId, 'load-rejected')
    scheduleDrain()
  }
}

export const stationBridge = {
  onAudio(listener: (payload: Record<string, unknown>) => void): () => void {
    audioListeners.add(listener)
    return () => { audioListeners.delete(listener) }
  },
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
  /**
   * Record that the shell store adopted `revision` (full document or delta) and its adopt duration.
   * When `target` matches the active queued load's `(commandId, sessionId, stationEpoch, revision)`,
   * completes that load and releases its dependent edits in FIFO order (plan 42 §2).
   */
  noteAdopted(revision: number, adoptMs = 0, target?: AdoptionTarget): void {
    if (target?.sessionId !== undefined && target.sessionId !== snapshot.sessionId) return
    if (target?.stationEpoch !== undefined && target.stationEpoch !== snapshot.stationEpoch) return
    if (target?.commandId !== undefined && target.commandId !== (snapshot.lastCommitId ?? '')) return
    if (snapshot.revision !== revision) return
    snapshot = { ...snapshot, adoptedRevision: revision, lastAdoptMs: adoptMs }
    if (
      activeQueuedLoad !== null &&
      activeQueuedLoad.committed !== null &&
      target !== undefined &&
      target.commandId === activeQueuedLoad.id &&
      target.sessionId === activeQueuedLoad.committed.sessionId &&
      target.stationEpoch === activeQueuedLoad.committed.stationEpoch &&
      revision === activeQueuedLoad.committed.revision
    ) {
      const completedId = activeQueuedLoad.id
      activeQueuedLoad = null
      lastAdoptedLoadId = completedId
      lastDependentGuard = null
      scheduleDrain()
    }
  },
  /**
   * Report that the shell could not adopt a committed envelope (e.g. corrupt save JSON).
   * Cancels only that load's dependent edits and advances the queue to any later valid load (plan 42 §2).
   */
  noteAdoptionFailed(target: AdoptionFailureTarget, reason = 'adoption-failed'): void {
    if (activeQueuedLoad === null || activeQueuedLoad.committed === null) return
    if (
      target.commandId !== activeQueuedLoad.id ||
      target.sessionId !== activeQueuedLoad.committed.sessionId ||
      target.stationEpoch !== activeQueuedLoad.committed.stationEpoch ||
      target.revision !== activeQueuedLoad.committed.revision
    ) {
      return
    }
    const failedLoadId = activeQueuedLoad.id
    activeQueuedLoad = null
    lastAdoptedLoadId = null
    lastDependentGuard = null
    cancelQueuedCommands(cmd => cmd.targetLoadId === failedLoadId, reason)
    scheduleDrain()
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
    const hadPlayer = player !== null
    cancelPendingRequests('session-changed', 'A new Unity player session registered.')
    if (hadPlayer || activeQueuedLoad !== null) {
      activeQueuedLoad = null
      lastAdoptedLoadId = null
      lastDependentGuard = null
      pendingDrainAfterDeliver = false
      cancelQueuedCommands(() => true, 'session-changed')
    }
    player = instance
    objectName = name
    resyncInFlight = false
    pending.clear()
    snapshot = { ...EMPTY, ready: true, sessionId: newSessionId() }
    listeners.forEach(listener => listener())
    drainQueue()
  },
  unregister(): void {
    player = null
    resyncInFlight = false
    activeQueuedLoad = null
    lastAdoptedLoadId = null
    lastDependentGuard = null
    pendingDrainAfterDeliver = false
    cancelQueuedCommands(() => true, 'disconnected')
    cancelPendingRequests('disconnected', 'The Unity player unregistered.')
    pending.clear()
    snapshot = EMPTY
    listeners.forEach(listener => listener())
  },
  /** C# calls this through the WebGL bridge; a string keeps the JS boundary trivial. */
  receive(text: string): void { deliver(text) },
  send(type: string, payload?: unknown, options: SendOptions = {}): string {
    const id = options.id ?? `c-${++counter}`
    const isLoad = isStationLoadType(type)
    const isDocEdit = targetsStationDocument(type)
    const targetLoadId = isDocEdit ? findLatestLoadId() : null
    const queued =
      !player ||
      (isLoad && (activeQueuedLoad !== null || drainingQueue || hasQueuedLoadOrDependent())) ||
      targetLoadId !== null
    options.beforeSend?.({
      id,
      type,
      sessionId: snapshot.sessionId,
      stationEpoch: snapshot.stationEpoch,
      revision: snapshot.revision,
      queued,
    })
    if (queued) {
      queue.push({
        id,
        type,
        payload,
        expectedRevision: options.expectedRevision,
        targetLoadId,
        beforeDispatch: options.beforeDispatch,
        onCancel: options.onCancel,
      })
      return id
    }
    if (isLoad) {
      activeQueuedLoad = {
        id,
        sessionId: snapshot.sessionId,
        type,
        committed: null,
      }
      lastAdoptedLoadId = null
      lastDependentGuard = null
    }
    dispatchToPlayer({
      id,
      type,
      payload,
      expectedRevision: options.expectedRevision,
      targetLoadId: null,
      beforeDispatch: options.beforeDispatch,
    })
    return id
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
  resync(options?: SendOptions): string { return stationBridge.send('station.resync', undefined, options) },
  /** Rejects still unanswered; useful for the verifier and the status bar. */
  pending(): { id: string; type: string; at: number }[] {
    return [...pending.entries()].map(([id, value]) => ({ id, ...value }))
  },
}

export type StationBridge = typeof stationBridge
