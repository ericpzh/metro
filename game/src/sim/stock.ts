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

/** Door centres from the car-door cadence — the authoritative list, §1.13. */
export function doorCentres(line: { stock: StockClass; cars: number }): number[] {
  const s = STOCK[line.stock]
  const total = s.length * line.cars
  const out: number[] = []
  for (let c = 0; c < line.cars; c++) {
    const carStart = c * s.length
    // Doors are evenly spaced along the car, inset from the cab ends.
    const span = s.length - 4
    for (let d = 0; d < s.doorsPerSide; d++) {
      const t = (d + 1) / (s.doorsPerSide + 1)
      out.push(carStart + 2 + t * span)
    }
  }
  return out.map((v) => Math.round((v - total / 2) * 10) / 10)
}
