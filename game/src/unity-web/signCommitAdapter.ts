// The plan-11 bridge for the 指示牌 editor's **commit** (packet F3).
//
// In the Three/TS app the store owns the document, so `SignSlice`'s
// `setSignBoards` writes the module and the editor's ✓ is one commit. In the
// Unity player C# owns the committed revision: the same ✓ must instead send one
// `sign.commit` and let the commit reply replace the station (`main.tsx`'s
// `adopt`), or the store and the document would disagree the moment the player
// saves. The **drag preview stays in React** (`previewSignLayout`), because it is
// not an edit until ✓ — this adapter only changes what ✓ does.
//
// Payload (`schemaVersion: 2`, one command per sign):
//
//   { "signId": "sign-309",
//     "faces": { "front": [ { "id":"c1", "kind":"arrow", "x":0.3, "y":0.2,
//                             "scale":1, "side":"both", "arrow":"down-left" } ],
//                "back": [] } }
//
// The components are exactly `sim/sign.ts`'s fields — the fields the source
// editor writes (`SignSlice.setSignBoards`). The mount, booth attachment and
// every other saved field are C#'s to keep, and the command carries the
// committed revision so a stale ✓ is refused rather than applied to another
// station.
//
// This module is deliberately transport-only: it maps a settled `SignBoards` to
// the wire shape and decides whether a host owns the station. It never mutates
// the store and never invents a component.

import type { SignBoards, SignComponent } from '../sim/sign.ts'
import { stationBridge } from './stationBridge.ts'
import type { StationSnapshot } from './stationBridge.ts'

/**
 * The bridge surface the commit needs: the snapshot (does a host own the station,
 * and at which revision) and one send. `stationBridge` is the production
 * implementation; a test passes a recorder.
 */
export interface SignCommitPort {
  getSnapshot(): StationSnapshot
  send(type: string, payload?: unknown, options?: { expectedRevision?: number }): string
}

/** One editor component on the wire: `sim/sign.ts`'s fields, nothing else. */
export type SignCommitComponent =
  | { id: string; kind: 'arrow'; x: number; y: number; scale: number; side: string; arrow: string }
  | { id: string; kind: 'line'; x: number; y: number; scale: number; side: string; lineId: string; english: boolean }
  | { id: string; kind: 'text'; x: number; y: number; scale: number; side: string; text: string }
  | { id: string; kind: 'icon'; x: number; y: number; scale: number; side: string; icon: string }

/** The whole `sign.commit` payload for one sign. */
export interface SignCommitPayload {
  signId: string
  faces: { front: SignCommitComponent[]; back: SignCommitComponent[] }
  locale?: string
}

/** One settled component as the bridge carries it (the source editor's own fields). */
export function signCommitComponent(component: SignComponent): SignCommitComponent {
  const base = { id: component.id, x: component.x, y: component.y, scale: component.scale, side: component.side }
  switch (component.kind) {
    case 'arrow': return { ...base, kind: 'arrow', arrow: component.arrow }
    case 'line': return { ...base, kind: 'line', lineId: component.lineId, english: component.english }
    case 'text': return { ...base, kind: 'text', text: component.text }
    case 'icon': return { ...base, kind: 'icon', icon: component.icon }
  }
}

/** One sign's settled pair as the commit command. Both faces travel together: they share a panel. */
export function signCommitPayload(moduleId: string, boards: SignBoards, locale?: string): SignCommitPayload {
  const payload: SignCommitPayload = {
    signId: moduleId,
    faces: {
      front: boards.front.map(signCommitComponent),
      back: boards.back.map(signCommitComponent),
    },
  }
  if (locale) payload.locale = locale
  return payload
}

/**
 * True once a Unity host has committed a station in this page: the transport is
 * registered, a document has arrived, and the snapshot's document is the current
 * revision (a commit that names an older document has not been adopted yet).
 * Before that — and in the Three/TS app, where this module is imported but no
 * player ever registers — the store keeps its own commit path.
 */
export function unityHostOwnsStation(port: SignCommitPort = stationBridge): boolean {
  const snapshot = port.getSnapshot()
  if (snapshot.ready !== true || snapshot.revision < 0 || snapshot.resyncNeeded === true) return false
  const hasFull = typeof snapshot.document === 'string' && snapshot.document.length > 0 && snapshot.documentRevision === snapshot.revision
  const hasAdoptedDelta = snapshot.adoptedRevision === snapshot.revision || snapshot.delta?.revision === snapshot.revision
  return hasFull || hasAdoptedDelta
}

/**
 * Send one sign's ✓ to the host. Returns false when no host owns the station —
 * the caller then keeps the TypeScript app's own store commit. When it returns
 * true the commit is in flight: the store is **not** mutated, and the C# commit
 * reply (a new document) is what the shell adopts.
 */
export function commitSignBoardsToHost(
  moduleId: string, boards: SignBoards, port: SignCommitPort = stationBridge,
): boolean {
  if (!unityHostOwnsStation(port)) return false
  const revision = port.getSnapshot().revision
  port.send('sign.commit', signCommitPayload(moduleId, boards), { expectedRevision: revision })
  return true
}
