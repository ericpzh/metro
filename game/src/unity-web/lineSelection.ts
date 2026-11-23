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
  trackAdd(commandId: string, sessionId: string, stationEpoch: number): void
  noteReject(commandId: string): void
  reconcile(input: LineReconcileInput): LineReconcileResult
  clear(): void
}

export function createLineSelectionTracker(): LineSelectionTracker {
  const pendingAdds = new Map<string, { sessionId: string; stationEpoch: number }>()
  let lastSessionId = ''
  let lastEpoch = -1

  return {
    trackAdd(commandId, sessionId, stationEpoch) {
      if (!commandId) return
      pendingAdds.set(commandId, { sessionId, stationEpoch })
    },
    noteReject(commandId) {
      if (!commandId) return
      pendingAdds.delete(commandId)
    },
    reconcile({ sessionId, stationEpoch, commitId, createdLineId, lines, currentRailLineId }) {
      const epochOrSessionChanged =
        (lastSessionId !== '' && sessionId !== lastSessionId) ||
        (lastEpoch >= 0 && stationEpoch !== lastEpoch)
      if (epochOrSessionChanged) {
        // Drop any pending add requests from an earlier session or replaced station.
        for (const [id, entry] of pendingAdds) {
          if (entry.sessionId !== sessionId || entry.stationEpoch !== stationEpoch) {
            pendingAdds.delete(id)
          }
        }
      }
      lastSessionId = sessionId
      lastEpoch = stationEpoch

      let createdLine: LineDef | null = null
      if (commitId) {
        const pending = pendingAdds.get(commitId)
        if (pending) {
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
