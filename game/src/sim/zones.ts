import { msg } from './i18n.ts'
// Fare zones — GAME-SPEC.md §4.5. Pure data shared by the sim and build tools.
// Room-purpose labels share the overlay palette without affecting fare crossings.
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

import { DEFAULT_ZONE, ZONES, type Cell, type GateDir, type RoomKind, type Zone } from './types.ts'

export type ZonePaint = Zone | RoomKind

export interface ZoneDef {
  id: Zone
  label: string
  /** Overlay colour. */
  colour: number
}

export interface ZonePaintDef {
  id: ZonePaint
  label: string
  /** Overlay colour. */
  colour: number
}

/**
 * Fare zones lead in `ZONES` order so their indices stay aligned for simulation.
 * Room-purpose colors follow them and use a separate `Cell.room` field, leaving
 * fare-gate behavior unchanged when a room is painted inside a paid area.
 */
export const ZONE_LIST: readonly ZoneDef[] = [
  { id: 'none', label: msg('no_zone'), colour: 0x9aa2ab },
  { id: 'outside', label: msg('outside'), colour: 0x5b6472 },
  { id: 'unpaid', label: msg('unpaid_area'), colour: 0x3fb27f },
  { id: 'paid', label: msg('paid_area'), colour: 0x4ea8ff },
  { id: 'platform', label: msg('platform'), colour: 0xf2a541 },
  { id: 'restricted', label: msg('equipment_area'), colour: 0xe4572e },
]

/** Full paint/overlay palette. Fare zones stay first to preserve graph indices. */
export const ZONE_PAINT_LIST: readonly ZonePaintDef[] = [
  ...ZONE_LIST,
  { id: 'store', label: msg('store'), colour: 0xb07cc6 },
  { id: 'toilet', label: msg('restroom'), colour: 0x5fb7a6 },
  { id: 'office', label: msg('office'), colour: 0xd9a24b },
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
 * The dense fare-zone index of a **cell** (see `zoneOf`). The graph reads this
 * index; the visual overlay uses `zoneDisplayIndexOf` to include room colors.
 */
export function zoneIndexOf(cell: Pick<Cell, 'zone'>): number {
  return ZONE_INDEX[zoneOf(cell)]
}

export function zoneDisplayIndexOf(cell: Pick<Cell, 'zone' | 'room'>): number {
  const id = cell.room ?? zoneOf(cell)
  const index = ZONE_PAINT_LIST.findIndex((z) => z.id === id)
  return index >= 0 ? index : zoneIndex(cell.zone)
}

export function zoneDef(zone: ZonePaint | undefined): ZonePaintDef {
  return ZONE_PAINT_LIST.find((z) => z.id === (zone ?? DEFAULT_ZONE)) ?? ZONE_PAINT_LIST[0]
}

export function zoneLabel(zone: ZonePaint | undefined): string {
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

