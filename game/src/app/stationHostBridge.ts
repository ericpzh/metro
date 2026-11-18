// The one seam between the shared app (which owns the React UI and the
// TypeScript store) and a player host that owns the committed station
// (plan 11 A6/F3: the Unity shell).
//
// The app must not import the Unity shell: `unity-web/` imports the app, so the
// reverse edge would put the shell's transport inside the store and make the
// plain Three app depend on a player it never runs. Instead the shell registers
// a small port here at mount and clears it at unmount; the app asks
// `stationHostCommit()` and falls back to its own store path when nobody is
// registered.
//
// This file is deliberately pure: no React, no bridge import, no store import.

import type { SignBoards } from '../sim/sign.ts'

/** What the app needs from a host that owns the committed document. */
export interface StationHostCommitPort {
  /** True once the host has committed a station in this page. */
  ownsStation(): boolean
  /**
   * Send the settled sign boards as one host commit. Returns true when the host
   * took the edit (the store must then NOT mutate: the host's commit reply is
   * what the shell adopts). False means "keep the TypeScript commit path".
   */
  commitSignBoards(moduleId: string, boards: SignBoards): boolean
  /**
   * The document verbs the host owns while it holds the station (plan 27 §4). Each
   * returns true when the host took the intent, so the app's own store path must not
   * run: a local `undo()` next to the host's would leave the inspector showing an
   * edit the document never made.
   */
  undo(): boolean
  redo(): boolean
  /** Delete the selected module or block. */
  deleteSelection(): boolean
  /** Escape: cancel a carried piece, a pending cell gesture or the plan. */
  cancelGesture(): boolean
  rotateCarried?(): boolean
  cycleCarriedLightPosition?(): boolean
  confirmMove?(): boolean
}

let current: StationHostCommitPort | null = null

/** The registered host, or null for the plain TypeScript app. */
export function stationHostCommit(): StationHostCommitPort | null {
  return current
}

/** Called by the player shell at mount and with `null` at unmount. */
export function registerStationHostCommit(port: StationHostCommitPort | null): void {
  current = port
}

/**
 * True when a host owns the document **and** takes this verb. The app calls it once per
 * intent: a registered host that refuses falls back to the store path, so a host without
 * the verb keeps the plain app working.
 */
export function hostOwnsVerb(verb: 'undo' | 'redo' | 'deleteSelection' | 'cancelGesture' | 'rotateCarried' | 'cycleCarriedLightPosition' | 'confirmMove'): boolean {
  const port = current
  if (!port || !port.ownsStation()) return false
  return port[verb]?.() ?? false
}
