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
