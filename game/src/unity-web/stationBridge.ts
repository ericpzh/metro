// Plan 11 command channel: one revisioned envelope in, one snapshot out.
//
// The Unity player owns the committed document revision, the camera and the
// simulation; this module is transport plus a small reducer. It never invents a
// station: `state` replies replace what C# published and `commit` replies carry
// the whole save exactly once. A reply from an older session is dropped, so a
// station switch cannot be overwritten by a late answer from the station the
// player just left (`11-station-loader-and-zoo-repair.md`, A6).

export const SCHEMA_VERSION = 2

export interface Envelope {
  schemaVersion: number
  id: string
  sessionId: string
  type: string
  expectedRevision?: number
  payload?: unknown
}

export type ReplyKind = 'ack' | 'reject' | 'state' | 'commit'

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

export interface StationSnapshot {
  ready: boolean
  sessionId: string
  revision: number
  sourceId: string | null
  sourceHash: string | null
  /** The v1 save text from the latest commit, or null before the first commit. */
  document: string | null
  /** Revision whose document is in `document`; the store only re-parses a newer one. */
  documentRevision: number
  state: Record<string, unknown>
  capabilities: Record<string, boolean>
  rejects: RejectRecord[]
}

export interface UnityPlayer {
  SendMessage(object: string, method: string, value?: string): void
}

const EMPTY: StationSnapshot = {
  ready: false, sessionId: '', revision: -1, sourceId: null, sourceHash: null,
  document: null, documentRevision: -1, state: {}, capabilities: {}, rejects: [],
}

let snapshot: StationSnapshot = EMPTY
let player: UnityPlayer | null = null
let objectName = 'StationGame'
let counter = 0
const listeners = new Set<() => void>()
const pending = new Map<string, { type: string; at: number }>()
const commitListeners = new Set<(snapshot: StationSnapshot) => void>()
// The shell mounts before Unity finishes booting, so the first demo open is sent
// into this queue and flushed once the player registers. Nothing is dropped and
// no command is replayed twice: the queue holds only commands, not documents.
const queue: { type: string; payload?: unknown; expectedRevision?: number }[] = []

// A session id names one Unity player generation. `register` mints a new one, so
// every reply still in flight from the previous page or player is fenced out.
function newSessionId(): string {
  counter += 1
  return `s-${Date.now().toString(36)}-${counter}`
}

export function envelope(type: string, payload?: unknown, options: { id?: string; sessionId?: string; expectedRevision?: number } = {}): Envelope {
  const id = options.id ?? `c-${counter}`
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
    const document = typeof payload.document === 'string' ? payload.document : null
    return {
      ...current,
      revision,
      document: document ?? current.document,
      documentRevision: document !== null ? revision : current.documentRevision,
      sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : current.sourceId,
      sourceHash: typeof payload.sourceHash === 'string' ? payload.sourceHash : current.sourceHash,
      capabilities: payload.capabilities && typeof payload.capabilities === 'object'
        ? { ...current.capabilities, ...(payload.capabilities as Record<string, boolean>) } : current.capabilities,
      state: { ...current.state, ...payload },
    }
  }
  if (kind === 'ack' || kind === 'reject') {
    const code = reply.code ?? (kind === 'ack' ? 'ok' : 'rejected')
    const next: StationSnapshot = { ...current, revision }
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
  return { ...current, revision, state: { ...current.state, ...payload } }
}

function deliver(text: string): void {
  let reply: Reply
  try { reply = JSON.parse(text) as Reply } catch { return }
  if (!reply || typeof reply !== 'object') return
  const before = snapshot
  const next = reduce(before, reply)
  if (reply.id) pending.delete(reply.id)
  if (next !== before) {
    snapshot = next
    listeners.forEach(listener => listener())
  }
  if (reply.kind === 'commit' && next !== before) commitListeners.forEach(listener => listener(next))
}

export const stationBridge = {
  capabilities: { tools: [] as readonly string[], speeds: [1, 4, 16, 64] as readonly number[] },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot(): StationSnapshot { return snapshot },
  /** Fires once per accepted commit, so the shell can parse the new document and rewrite the URL. */
  onCommit(listener: (snapshot: StationSnapshot) => void): () => void {
    commitListeners.add(listener)
    return () => { commitListeners.delete(listener) }
  },
  register(instance: UnityPlayer, name = 'StationGame'): void {
    player = instance
    objectName = name
    pending.clear()
    snapshot = { ...EMPTY, ready: true, sessionId: newSessionId() }
    listeners.forEach(listener => listener())
    for (const command of queue.splice(0)) stationBridge.send(command.type, command.payload, { expectedRevision: command.expectedRevision })
  },
  unregister(): void {
    player = null
    pending.clear()
    snapshot = EMPTY
    listeners.forEach(listener => listener())
  },
  /** C# calls this through the WebGL bridge; a string keeps the JS boundary trivial. */
  receive(text: string): void { deliver(text) },
  send(type: string, payload?: unknown, options: { expectedRevision?: number } = {}): string {
    if (!player) {
      queue.push({ type, payload, expectedRevision: options.expectedRevision })
      return ''
    }
    const message = envelope(type, payload, options)
    pending.set(message.id, { type, at: Date.now() })
    player.SendMessage(objectName, 'BrowserCommand', JSON.stringify(message))
    return message.id
  },
  /** Ask for the committed document again, e.g. after a reconnect or a dropped commit. */
  resync(): void { stationBridge.send('station.resync') },
  /** Rejects still unanswered; useful for the verifier and the status bar. */
  pending(): { id: string; type: string; at: number }[] {
    return [...pending.entries()].map(([id, value]) => ({ id, ...value }))
  },
}

export type StationBridge = typeof stationBridge
