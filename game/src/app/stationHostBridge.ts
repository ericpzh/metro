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
import type { CityStyle } from '../sim/cityStyles.ts'
import type { LiftDoorSide, LineDef, LineDirection } from '../sim/types.ts'

/** Exit inspector settings that can be committed directly through a player host. */
export interface ExitPatch {
  name?: string
  inRate?: number
  open?: boolean
}

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
  /** Send an exit card's name / inRate / open change to the host. */
  commitExit?(moduleId: string, patch: ExitPatch): boolean
  /** Send a city style selection to the host. */
  commitCityStyle?(city: CityStyle): boolean
  /** Send a bilingual station rename to the host. */
  commitStationName?(name: string, nameEn: string): boolean
  /** Ask the host to add a new default line using the station's city palette. */
  commitAddLine?(direction?: LineDirection): boolean
  /** Ask the host to remove a line and all tracks/doors bound to it. */
  commitRemoveLine?(lineId: string): boolean
  /** Send a partial line parameter patch (cosmetic, service, or structural) to the host. */
  commitUpdateLine?(lineId: string, patch: Partial<LineDef>): boolean
  /** Set a lift shaft's cabin door side at one storey. */
  commitLiftDoorSide?(moduleId: string, z: number, side: LiftDoorSide): boolean
  /** Reverse an escalator or moving walkway's direction. */
  commitSwitchRunDirection?(moduleId: string): boolean
  /** Reverse a one-way road segment's direction. */
  commitSwitchRoadDirection?(moduleId: string): boolean
  /** Regenerate derived platform screen doors for a platform track. */
  commitRegenRail?(trackId: string): boolean
  /** Start moving a placed module on the host. */
  startMove?(moduleId: string): boolean
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
