// Rolling stock — GAME-SPEC.md §6.1. The numbers are the Chinese metro
// classification (A/B/C) used as the tuning baseline.

export type StockClass = 'A' | 'B' | 'C'

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
