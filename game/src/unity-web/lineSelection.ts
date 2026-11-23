// Authoritative rail-line selection reconciliation for the Unity shell (plan 39 §5).
//
// Keeps `useStore.railLineId` synchronized with host commits:
// - Selects the newly created line ID from a correlated successful `edit.line.add`
//   commit once the line is present in the adopted document.
// - Falls back to the first remaining line (or `''`) when a commit removes the
//   selected line, or after undo/redo/station replacement invalidates it.
// - Ignores refused adds and stale replies from earlier sessions or epochs.

import type { LineDef } from '../sim/types.ts'

export interface LineReconcileInput {
  sessionId: string
  stationEpoch: number
  commitId: string
  createdLineId: string | null | undefined
  lines: readonly LineDef[]
  currentRailLineId: string
}

export interface LineReconcileResult {
  nextRailLineId: string
  createdLine: LineDef | null
  changed: boolean
}

export interface LineSelectionTracker {
  /** Reserve a queued add-line command ID before it is bound to a session/epoch at host dispatch (plan 41 §2). */
  reserveAdd(commandId: string): void
  /** Bind a previously reserved queued add-line command ID to the active session and station epoch right before dispatch. */
  bindAdd(commandId: string, sessionId: string, stationEpoch: number): boolean
  /** Immediately register and bind an add-line command ID right before host dispatch. */
  trackAdd(commandId: string, sessionId: string, stationEpoch: number): void
  noteReject(commandId: string): void
  /** Clear pending add intents whenever the host session or station epoch changes (or disconnects). */
  syncFence(sessionId: string, stationEpoch: number): void
  reconcile(input: LineReconcileInput): LineReconcileResult
  clear(): void
}

interface PendingAddIntent {
  bound: boolean
  sessionId: string
  stationEpoch: number
}

export function createLineSelectionTracker(): LineSelectionTracker {
  const pendingAdds = new Map<string, PendingAddIntent>()
  let lastSessionId = ''
  let lastEpoch = -1

  const pruneForFence = (sessionId: string, stationEpoch: number): void => {
    if (!sessionId) {
      // Only wipe intents on an actual disconnect from a connected session;
      // pre-register startup syncs with empty sessionId keep reserved startup adds.
      if (lastSessionId !== '') {
        pendingAdds.clear()
        lastSessionId = ''
        lastEpoch = -1
      }
      return
    }
    const sessionChanged = lastSessionId !== '' && sessionId !== lastSessionId
    const epochChanged = lastEpoch >= 0 && stationEpoch !== lastEpoch
    if (sessionChanged) {
      pendingAdds.clear()
    } else if (epochChanged) {
      for (const [id, entry] of pendingAdds) {
        if (entry.bound && (entry.sessionId !== sessionId || entry.stationEpoch !== stationEpoch)) {
          pendingAdds.delete(id)
        }
      }
    }
    lastSessionId = sessionId
    lastEpoch = stationEpoch
  }

  return {
    reserveAdd(commandId) {
      if (!commandId) return
      pendingAdds.set(commandId, { bound: false, sessionId: '', stationEpoch: -1 })
    },
    bindAdd(commandId, sessionId, stationEpoch) {
      if (!commandId || !sessionId) return false
      pruneForFence(sessionId, stationEpoch)
      if (!pendingAdds.has(commandId)) return false
      pendingAdds.set(commandId, { bound: true, sessionId, stationEpoch })
      return true
    },
    trackAdd(commandId, sessionId, stationEpoch) {
      if (!commandId || !sessionId) return
      pruneForFence(sessionId, stationEpoch)
      pendingAdds.set(commandId, { bound: true, sessionId, stationEpoch })
    },
    noteReject(commandId) {
      if (!commandId) return
      pendingAdds.delete(commandId)
    },
    syncFence(sessionId, stationEpoch) {
      pruneForFence(sessionId, stationEpoch)
    },
    reconcile({ sessionId, stationEpoch, commitId, createdLineId, lines, currentRailLineId }) {
      pruneForFence(sessionId, stationEpoch)

      let createdLine: LineDef | null = null
      if (commitId) {
        const pending = pendingAdds.get(commitId)
        if (pending && pending.bound) {
          pendingAdds.delete(commitId)
          if (pending.sessionId === sessionId && pending.stationEpoch === stationEpoch && createdLineId) {
            createdLine = lines.find(l => l.id === createdLineId) ?? null
          }
        }
      }

      if (createdLine) {
        return {
          nextRailLineId: createdLine.id,
          createdLine,
          changed: createdLine.id !== currentRailLineId,
        }
      }

      const stillPresent = currentRailLineId !== '' && lines.some(l => l.id === currentRailLineId)
      if (stillPresent) {
        return { nextRailLineId: currentRailLineId, createdLine: null, changed: false }
      }

      const fallback = lines[0]?.id ?? ''
      return {
        nextRailLineId: fallback,
        createdLine: null,
        changed: fallback !== currentRailLineId,
      }
    },
    clear() {
      pendingAdds.clear()
      lastSessionId = ''
      lastEpoch = -1
    },
  }
}
