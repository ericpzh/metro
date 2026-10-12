// The crowd's day (§7.4, §9.6C 客流曲线): the curves the station's arrivals are shaped by,
// as data rather than as a private formula inside the world.
//
// **One module, three readers.** `World.spawnStreet` draws its Poisson arrivals from these
// curves, and the 时刻 window plots the very same samples — so a slider the player drags
// moves the picture and the crowd together, and neither can describe a day the other is
// not running. That is why the shape lives here and not in either of them.
//
// The curve is §7.4's `λ = base × curve(timeOfDay) × …`, split the way the two knobs in
// sheet 06's panel D are:
//
//   shape(hour)   the double peak itself — the 早高峰 / 晚高峰 heights and their width,
//   period factor 高峰 / 平峰 / 离峰, the timetable's own multiplier (§6.5).
//
// There are **two saved curves**: the 工作日 one (peaky, with its 高峰) and the 非工作日
// one (flatter — a 非工作日 runs 平峰/离峰 only, so the timetable never asks for its
// peak weight). The calendar date decides which one the spawn and the chart read; the
// old weekend/holiday volume multipliers are gone, folded into the curves themselves.
// The **defaults reproduce the pre-knob curve exactly on 工作日** — `demandShape` at
// `DEFAULT_DEMAND` is the `0.06 + gauss(8, 0.85) + 0.78 × gauss(18, 1.05) + 0.18 ×
// gauss(12.5, 2.2)` this replaced, to the last bit — so shipping the knobs changed no
// crowd, and a **工作日** run still replays. `demand.test.mjs` pins the golden curve
// against the old numbers.
//
// Pure: no DOM, no worker, no three. `sim/` imports nothing (§7.6).

import { DEFAULT_PEAKS, DEFAULT_SERVICE, SIM_DAY, periodOf, timeOfDayOf, type PeakWindows, type Period, type TimeSpan } from './constants.ts'

/** The three knobs sheet 06's panel D puts in the player's hands (§9.6C 客流曲线). */
export interface DemandKnobs {
  /** 早高峰量: the 08:00 peak's height. 1 is the reference weekday. */
  amPeak: number
  /** 晚高峰量: the 18:00 peak's height. */
  pmPeak: number
  /** 波形陡峭度: a scale on the peaks' widths. 1 is the reference 0.85 h / 1.05 h. */
  sharpness: number
}

/** The reference weekday: what a station that has not touched the sliders runs. */
export const DEFAULT_DEMAND: DemandKnobs = { amPeak: 1, pmPeak: 0.78, sharpness: 1 }

/** The reference off-day: lower and flatter — no commute spikes to author away. */
export const DEFAULT_OFFDAY: DemandKnobs = { amPeak: 0.35, pmPeak: 0.4, sharpness: 1.5 }

/** The two saved curves: one for 工作日, one for 非工作日. */
export interface DayDemand {
  workday: DemandKnobs
  offday: DemandKnobs
}

/** Where the two peaks and the midday shelf sit, in hours after midnight. */
export const DEMAND_AM_HOUR = 8
export const DEMAND_PM_HOUR = 18
export const DEMAND_MIDDAY_HOUR = 12.5
/** Their widths at `sharpness` 1, in hours. */
export const DEMAND_SIGMA = { am: 0.85, pm: 1.05, midday: 2.2 }
/** The overnight floor the peaks rise from, and the midday shelf's height. */
export const DEMAND_FLOOR = 0.06
export const DEMAND_MIDDAY = 0.18

/** The knobs' written range (the sliders' own ends). */
export const DEMAND_LIMITS = {
  amPeak: [0, 2.5],
  pmPeak: [0, 2.5],
  sharpness: [0.4, 2],
} as const

/**
 * The timetable's multiplier (§6.5): a peak headway moves the full crowd, 平峰 a little
 * over half of it, 离峰 a quarter.
 */
export const PERIOD_FACTOR: Record<Period, number> = { peak: 1, offpeak: 0.6, late: 0.25 }

/** Seconds since midnight as hours (0–24, float). */
export function hourOfDay(simTime: number): number {
  return timeOfDayOf(simTime) / 3600
}

function gauss(x: number, mu: number, sigma: number): number {
  const d = x - mu
  return Math.exp(-(d * d) / (2 * sigma * sigma))
}

/**
 * The time-of-day curve on its own — the line sheet 06's panel A plots, before the
 * period and the day type scale it. Its floor keeps a shut-night trickle from reaching
 * zero, which is what `DEFAULT_SERVICE`'s shut hours then scale down by 0.25.
 */
export function demandShape(hour: number, knobs: DemandKnobs = DEFAULT_DEMAND): number {
  const s = knobs.sharpness
  return (
    DEMAND_FLOOR +
    knobs.amPeak * gauss(hour, DEMAND_AM_HOUR, DEMAND_SIGMA.am * s) +
    knobs.pmPeak * gauss(hour, DEMAND_PM_HOUR, DEMAND_SIGMA.pm * s) +
    DEMAND_MIDDAY * gauss(hour, DEMAND_MIDDAY_HOUR, DEMAND_SIGMA.midday * s)
  )
}

/**
 * The multiplier the spawn applies at one instant: the shape, scaled by the period the
 * timetable is in.
 *
 * The period is handed in rather than derived — the world has already asked `periodOf`
 * this tick, and asking twice is two chances to answer differently.
 */
export function demandAt(hour: number, period: Period, knobs: DemandKnobs = DEFAULT_DEMAND): number {
  return demandShape(hour, knobs) * PERIOD_FACTOR[period]
}

/** The station's whole authored day, in one object: what every caller of this module
 *  needs and nothing else. */
export interface DemandInput {
  service: TimeSpan
  peaks: PeakWindows
  workday: DemandKnobs
  offday: DemandKnobs
}

/** `demandAt` for a station whose period has not been worked out yet — the 时刻 window's
 *  own entry point, and the one the chart's samples go through. */
export function demandRate(simTime: number, workday: boolean, input: DemandInput): number {
  return demandAt(
    hourOfDay(simTime),
    periodOf(simTime, input.service, input.peaks, workday),
    workday ? input.workday : input.offday,
  )
}

/**
 * One demand sample across the whole day, the last point closing the loop onto the
 * first — what a chart draws. The samples sit on a **uniform** grid, so "one every
 * `stepMinutes`" is a real property rather than an accident of the a step dividing
 * 24 h: a step of 7 or 25 minutes gives the same first and last sample, and a step
 * that is zero, negative or not a number falls back to the default instead of
 * asking for an unbounded number of them.
 */
export function demandSeries(workday: boolean, input: DemandInput, stepMinutes = 15): number[] {
  const step = Number.isFinite(stepMinutes) && stepMinutes > 0 ? stepMinutes : 15
  const steps = Math.max(1, Math.round((24 * 60) / step))
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(demandRate((i * SIM_DAY) / steps, workday, input))
  return out
}

/**
 * The knobs a document actually holds: each one inside its written range, at two
 * decimals (a slider's own grain), and back to the default when the field is missing or
 * is not a number at all. Repairs rather than refuses, like every other load path.
 */
export function normalizeDemand(raw: unknown, fallback: DemandKnobs = DEFAULT_DEMAND): DemandKnobs {
  return {
    amPeak: knob(raw, 'amPeak', fallback.amPeak),
    pmPeak: knob(raw, 'pmPeak', fallback.pmPeak),
    sharpness: knob(raw, 'sharpness', fallback.sharpness),
  }
}

/**
 * The two curves a document actually holds. A save from before the split carries one
 * flat set of knobs — that was the 工作日 curve, so it stays the 工作日 one and the
 * 非工作日 curve is the default.
 */
export function normalizeDayDemand(raw: unknown): DayDemand {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (!('workday' in source || 'offday' in source)) {
    return { workday: normalizeDemand(raw), offday: { ...DEFAULT_OFFDAY } }
  }
  return {
    workday: normalizeDemand(source.workday),
    offday: normalizeDemand(source.offday, DEFAULT_OFFDAY),
  }
}

function knob(raw: unknown, key: keyof DemandKnobs, fallback: number): number {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const [lo, hi] = DEMAND_LIMITS[key]
  const clamped = value < lo ? lo : value > hi ? hi : value
  return Math.round(clamped * 100) / 100
}

/** The day's worth of input a document with none authored runs on. */
export const DEFAULT_DEMAND_INPUT: DemandInput = {
  service: DEFAULT_SERVICE,
  peaks: DEFAULT_PEAKS,
  workday: DEFAULT_DEMAND,
  offday: DEFAULT_OFFDAY,
}
