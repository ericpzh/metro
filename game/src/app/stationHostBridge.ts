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
