// Fare zones — GAME-SPEC.md §4.5. Pure data shared by the sim, the build tools
// and the overlay: the sim decides who may cross, the game shows the same
// colour the player painted.
//
// A zone boundary is a movement barrier. The only walk edge that may cross one
// is through a module that legitimately does so — a gate for the fare line.
// That is what makes "a gate is the only legal crossing" true (§13.2).
//
// A cell that carries **no** label reads as `none` — 无分区: the player has not
// said what it is, and the game does not pretend they did. It is a **reading, not
// a record** (nothing is written to the save), and 无分区 sits on the unpaid side of
// the fare line, so an unpainted station still grows no barrier of its own. One
// rule, read by the sim, the build tools and the 分区 map alike.

import { DEFAULT_ZONE, ZONES, type Cell, type GateDir, type Zone } from './types.ts'

export interface ZoneDef {
  id: Zone
  label: string
  /** Overlay colour. */
  colour: number
}

/**
 * The zones, in `ZONES`' own order (`zoneDef` indexes this list by `ZONE_INDEX`,
 * so the two may never drift apart). 无分区 leads: it is the colour of floor
 * nobody has zoned, and it is deliberately the palest of them — an unpainted
 * station should read as unpainted, not as a sixth kind of area.
 */
export const ZONE_LIST: readonly ZoneDef[] = [
  { id: 'none', label: '无分区', colour: 0x9aa2ab },
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

/**
 * The zone of a cell: the label it carries, or **无分区** when it carries none.
 *
 * 无分区 is a reading, not a record — nothing is written to the save — and it is
 * what makes an unpainted tile honest: the 分区 map tints it as unzoned, the 信息
 * card says so, and the fare line counts it with the unpaid side (`isUnpaidZone`)
 * rather than inventing a zone the player never chose. The generated street is
 * not an exception: `withGround` labels its own cells 站外 (`sim/ground.ts`),
 * because that plane *is* the world outside the station.
 */
export function zoneOf(cell: Pick<Cell, 'zone'>): Zone {
  return cell.zone ?? DEFAULT_ZONE
}

/**
 * The dense zone index of a **cell** (see `zoneOf`). The graph, the overlay and
 * the build tools all read a cell's zone through this, so an unpainted cell
 * cannot read as 无分区 in one of them and something else in another.
 */
export function zoneIndexOf(cell: Pick<Cell, 'zone'>): number {
  return ZONE_INDEX[zoneOf(cell)]
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

/**
 * The unpaid side of the fare line: only an entry gate may leave it. 无分区 is
 * here on purpose — a cell nobody has zoned must not become a barrier of its own,
 * or an unfinished station walls its own circulation off (§4.5, and the reason
 * `ZONE_LINES_BLOCK` is off while the demo's paint is unfinished).
 */
export function isUnpaidZone(zone: Zone): boolean {
  return zone === 'unpaid' || zone === 'outside' || zone === 'none'
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

