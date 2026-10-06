// Rolling stock — GAME-SPEC.md §6.1. The numbers are the Chinese metro
// classification (A/B/C/L) used as the tuning baseline. L is the linear-motor
// (直线电机) car: 2.8 m wide and 16.8 m long, three doors a side, third-rail
// pickup — the Guangzhou Line 4/5/6 stock.

/**
 * The classification order shared by the worker and the renderer to encode a
 * stock index in the rolling-stock pose. Keep them in sync through this list so
 * adding a class cannot desync the two sides.
 */
export const STOCK_CLASSES = ['A', 'B', 'C', 'L'] as const

export type StockClass = (typeof STOCK_CLASSES)[number]

export interface Stock {
  cls: StockClass
  width: number
  length: number
  height: number
  doorsPerSide: number
  doorWidth: number
  crushPerCar: number
  ratedPerCar: number
  consist: [number, number]
  power: 'third-rail' | 'catenary'
}

export const STOCK: Record<StockClass, Stock> = {
  A: {
    cls: 'A',
    width: 3.0,
    length: 22.0,
    height: 3.8,
    doorsPerSide: 5,
    doorWidth: 1.4,
    crushPerCar: 310,
    ratedPerCar: 250,
    consist: [6, 8],
    power: 'catenary',
  },
  B: {
    cls: 'B',
    width: 2.8,
    length: 19.5,
    height: 3.8,
    doorsPerSide: 4,
    doorWidth: 1.3,
    crushPerCar: 240,
    ratedPerCar: 200,
    consist: [4, 6],
    power: 'third-rail',
  },
  C: {
    cls: 'C',
    width: 2.6,
    length: 19.0,
    height: 3.6,
    doorsPerSide: 4,
    doorWidth: 1.2,
    crushPerCar: 200,
    ratedPerCar: 170,
    consist: [4, 6],
    power: 'third-rail',
  },
  L: {
    cls: 'L',
    width: 2.8,
    length: 16.8,
    height: 3.6,
    doorsPerSide: 3,
    doorWidth: 1.4,
    crushPerCar: 215,
    ratedPerCar: 170,
    consist: [4, 6],
    power: 'third-rail',
  },
}

export function trainLength(line: { stock: StockClass; cars: number }): number {
  return STOCK[line.stock].length * line.cars
}

export function trainRatedCapacity(line: { stock: StockClass; cars: number }): number {
  return STOCK[line.stock].ratedPerCar * line.cars
}

/** Capacity/hour = cars × rated/car × 3600/headway. §6.3. */
export function lineCapacityPerHour(line: {
  stock: StockClass
  cars: number
  headwayProfile: { peak: number; offpeak: number; late: number }
}): number {
  const perTrain = trainRatedCapacity(line)
  const perHour = 3600 / line.headwayProfile.peak
  return Math.round(perTrain * perHour)
}

/**
 * Metres of car the ends keep clear of a passenger door: the cab (or the
 * gangway) and the bogie live there. Real Chinese metro cars hold the door
 * centre about 2.8 m from the car end, so the leaf's edge stands ~2.1 m in —
 * which also clears the modelled cab's re-skin at the consist's two ends. The
 * doors inside a car then sit on one uniform pitch, and it is *that* cadence the
 * screen doors repeat, so a PSD opening can never drift from its car door
 * (GAME-SPEC §1.13). Two insets are never less than one pitch, so the doors stay
 * evenly spread across a car boundary too — exactly so on a three-door L car,
 * where the whole consist ends up on a single 5.6 m cadence.
 */
export const DOOR_END_INSET = 2.8

/** Door centres from the car-door cadence — the authoritative list, §1.13. */
export function doorCentres(line: { stock: StockClass; cars: number }): number[] {
  const s = STOCK[line.stock]
  const total = s.length * line.cars
  // One pitch per car, held clear of both ends: the doors spread out to the car
  // rather than bunching in the middle, and every car carries the same cadence,
  // so the screen doors can repeat it down the run. A one-door car has no pitch
  // to spread over and keeps its centre.
  const pitch = s.doorsPerSide > 1 ? (s.length - 2 * DOOR_END_INSET) / (s.doorsPerSide - 1) : 0
  const out: number[] = []
  for (let c = 0; c < line.cars; c++) {
    const carStart = c * s.length
    for (let d = 0; d < s.doorsPerSide; d++) out.push(carStart + (s.doorsPerSide > 1 ? DOOR_END_INSET + d * pitch : s.length / 2))
  }
  // Round the distance from the centre, not the raw position: rounding the
  // signed value would break the front/back symmetry on an exact half-decimetre.
  return out.map((v) => {
    const off = v - total / 2
    return Math.sign(off) * (Math.round(Math.abs(off) * 10) / 10)
  })
}

/**
 * Where a consist's doors stand along a rail, in rail-local metres from the
 * rail's first cell (cell `i` spans `[i, i + 1]`, so the run's centre — which is
 * also the consist's — sits at `railW / 2`). `render/models.ts` cuts the screen
 * open at these and `sim/station.ts` seats one door server on the cell each one
 * falls in, so a screen door and the car door it exists to meet are placed from
 * one list and cannot drift (§1.13).
 */
export function doorRunOffsets(line: { stock: StockClass; cars: number }, railW: number): number[] {
  return doorCentres(line).map((off) => railW / 2 + off)
}

/* -------------------------------------------------------------- the cabin */

/**
 * The car's own interior: a doorway's clear height, the cabin floor over the
 * consist origin, and the box a passenger stands in. The **sim's rider slots**
 * (`cabinSlot`) and the **cabin the model draws** (`TrainModel`) are both cut
 * from these numbers, so the people inside a train stand on the floor that was
 * drawn for them and leave through the doorway the sim walks them to — the same
 * contract `doorCentres` holds between a car door and the screen door that
 * exists to meet it (§1.13).
 *
 * The consist origin rides the track bed, half a metre under the platform, so a
 * floor at `CABIN_FLOOR_Z` lands a hand's width over the platform surface — the
 * step up a real car has.
 */
export const DOOR_SILL_Z = 0.57
export const DOOR_HEAD_Z = 2.63
export const CABIN_FLOOR_Z = 0.62
/** Clear half-width inside the car's skins, and the first row's standoff from it. */
export const CABIN_HALF_W = 1.15
export const CABIN_DOOR_INSET = 0.25
/** Each of the two abreast a 1.3 m doorway passes, off the door's own centre. */
export const CABIN_PAIR_HALF = 0.32
/** Row pitch of a doorway's queue, receding inboard, metres. */
export const CABIN_ROW_PITCH = 0.55
/** How deep a doorway's queue is loaded: rows, so 2 × this passengers a door. */
export const CABIN_MAX_ROWS = 12
/**
 * Sim seconds between one doorway passing its next pair out. Two abreast a
 * 1.3 m doorway clears ~1.7 pax/s — a little quicker than the doors board
 * (§5.9: alighting is faster than boarding), and a full wave of 540 over a
 * 24-door consist leaves in ~14 s of the 30 s dwell.
 */
export const CABIN_ALIGHT_PAIR_S = 1.2
/**
 * How long a doorway keeps alighting before it turns to boarding, seconds of
 * door-open time. A dwell trades the two (§5.9, §6.3): the wave leaves first,
 * but a train cannot hold a doorway shut for a whole dwell, so past this the
 * rest of the wave rides on — counted among the stop's left-behind arrivals —
 * and the doorway boards. Well inside the 30 s dwell, so a full 12-row cabin
 * (14 s of pairs) clears before it and a wave that cannot clear still leaves the
 * platform its boarding time.
 */
export const CABIN_ALIGHT_MAX_S = 15
/** Metres along the car the queue steps each time it turns at a wall. */
export const CABIN_TURN_STEP = 0.75
/** Turns a doorway's queue may make before it stops walking along the car. */
export const CABIN_MAX_TURNS = 2

/**
 * Where the `row`-th pair of a doorway's queue stands, in consist-local metres
 * from the consist centre. `file` is which of the two abreast the doorway passes
 * (−1 / +1 off the door centre) and `side` is which way the doorway faces
 * (+1 the consist's local +y).
 *
 * The queue starts at the doorway and walks **inboard**, crossing the car to the
 * far wall and turning back along the aisle — so a deep wave snakes down the car
 * instead of stacking on one column, and the row nearest its door is always the
 * one that leaves first (§5.9: alighting is the door's own business).
 */
export function cabinSlot(doorX: number, side: number, file: number, row: number): [number, number] {
  const half = CABIN_HALF_W - CABIN_DOOR_INSET
  const span = half * 2
  const depth = row * CABIN_ROW_PITCH
  const turn = Math.floor(depth / span)
  const within = depth - turn * span
  // A turn at either wall: even turns head away from the doorway's own skin, odd
  // turns head back toward it, which is the snake a full car's aisle actually is.
  const outbound = turn % 2 === 0
  const y = side * (outbound ? half - within : -half + within)
  const x = doorX + file * CABIN_PAIR_HALF + Math.min(turn, CABIN_MAX_TURNS) * CABIN_TURN_STEP
  return [x, y]
}
