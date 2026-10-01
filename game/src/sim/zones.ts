// Fare zones — GAME-SPEC.md §4.5. Pure data shared by the sim, the build tools
// and the overlay: the sim decides who may cross, the game shows the same
// colour the player painted.
//
// A zone boundary is a movement barrier. The only walk edge that may cross one
// is through a module that legitimately does so — a gate for the fare line.
// That is what makes "a gate is the only legal crossing" true (§13.2).

import { DEFAULT_ZONE, ZONES, type GateDir, type Zone } from './types.ts'

export interface ZoneDef {
  id: Zone
  label: string
  /** Overlay colour. */
  colour: number
}

export const ZONE_LIST: readonly ZoneDef[] = [
  { id: 'outside', label: '站外', colour: 0x5b6472 },
  { id: 'unpaid', label: '非付费区', colour: 0x3fb27f },
  { id: 'paid', label: '付费区', colour: 0x4ea8ff },
  { id: 'platform', label: '站台', colour: 0xf2a541 },
  { id: 'restricted', label: '设备区', colour: 0xe4572e },
]

/** Dense index for a zone, for typed arrays in the graph and the mesh. */
export const ZONE_INDEX: Record<Zone, number> = ZONES.reduce(
  (acc, z, i) => {
    acc[z] = i
    return acc
  },
  {} as Record<Zone, number>,
)

export function zoneIndex(zone: Zone | undefined): number {
  return ZONE_INDEX[zone ?? DEFAULT_ZONE]
}

export function zoneDef(zone: Zone | undefined): ZoneDef {
  const i = zoneIndex(zone)
  return ZONE_LIST[i]
}

export function zoneLabel(zone: Zone | undefined): string {
  return zoneDef(zone).label
}

/** The paid side of the fare line: only an exit gate may leave it. */
export function isPaidZone(zone: Zone): boolean {
  return zone === 'paid' || zone === 'platform' || zone === 'restricted'
}

/** The unpaid side of the fare line: only an entry gate may leave it. */
export function isUnpaidZone(zone: Zone): boolean {
  return zone === 'unpaid' || zone === 'outside'
}

/**
 * Which way a walker crosses the fare line between two zones: `1` entering the
 * paid area, `-1` leaving it, `0` when the step does not cross it (or the two
 * zones are the same side). Direction is what a one-way gate checks.
 */
export function crossingDir(from: Zone | undefined, to: Zone | undefined): GateDir {
  const a = from ?? DEFAULT_ZONE
  const b = to ?? DEFAULT_ZONE
  if (isUnpaidZone(a) && isPaidZone(b)) return 1
  if (isPaidZone(a) && isUnpaidZone(b)) return -1
  return 0
}

