// Line running gear (§6.3 运能, §6.5 行车间隔): which consists a line may run
// and how its peak / off-peak headways are stored.
//
// `LineDef.headwayProfile` stays seconds on all three legs, so the worker's
// `headwayFor` and the TV forecast read it unchanged — this module only owns
// the player-facing shape: the fixed consist menu, the 分/秒 split the inputs
// edit, and the repair both the load path and the panel commit through.
// Pure: no DOM, no worker, no three. `sim/` imports nothing (§7.6).
import { periodOf, SIM_DAY, type PeakWindows, type TimeSpan } from './constants.ts'
import type { LineDef, Module } from './types.ts'

/** The consists a line may run: the fixed menu the 线路 card offers. */
export const FORMATION_OPTIONS = [2, 3, 4, 6, 8] as const

/**
 * Headway bounds, seconds. The floor is the consist cycle (~53 s of
 * approach + dwell + depart in `sim/constants.ts`): `maybeDispatch` only runs
 * one consist per track, so anything shorter would read as ~53 s anyway and
 * the panel refuses to promise it. The ceiling is a 20-minute night service.
 */
export const HEADWAY_MIN_S = 60
export const HEADWAY_MAX_S = 1200

/** Snap a car count onto the fixed consist menu (ties round down, so a snapped consist never outgrows its platform). */
export function snapFormation(cars: number): number {
  if (!Number.isFinite(cars)) return 6
  let best: number = FORMATION_OPTIONS[0]
  for (const option of FORMATION_OPTIONS) {
    if (Math.abs(option - cars) < Math.abs(best - cars)) best = option
  }
  return best
}

/** Clamp a headway to whole seconds inside the written range. */
export function normalizeHeadway(value: unknown, fallback: number): number {
  const safeFallback =
    Number.isFinite(fallback) && fallback >= HEADWAY_MIN_S && fallback <= HEADWAY_MAX_S ? Math.round(fallback) : 150
  if (typeof value !== 'number' || !Number.isFinite(value)) return safeFallback
  return Math.max(HEADWAY_MIN_S, Math.min(HEADWAY_MAX_S, Math.round(value)))
}

export interface HeadwayProfile {
  peak: number
  offpeak: number
  late: number
}

/** Repair a stored profile leg by leg, keeping the untouched legs. */
export function normalizeHeadwayProfile(raw: unknown, fallback?: HeadwayProfile): HeadwayProfile {
  const base: HeadwayProfile = fallback ?? { peak: 150, offpeak: 240, late: 480 }
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    peak: normalizeHeadway(source.peak, base.peak),
    offpeak: normalizeHeadway(source.offpeak, base.offpeak),
    late: normalizeHeadway(source.late, base.late),
  }
}

/** Split seconds for the 分 / 秒 inputs. */
export function splitHeadway(totalS: number): { minutes: number; seconds: number } {
  const clamped = Math.max(HEADWAY_MIN_S, Math.min(HEADWAY_MAX_S, Math.round(totalS)))
  return { minutes: Math.floor(clamped / 60), seconds: clamped % 60 }
}

/** Join the 分 / 秒 inputs back to clamped seconds. */
export function joinHeadway(minutes: number, seconds: number): number {
  const m = Number.isFinite(minutes) ? Math.max(0, Math.min(20, Math.floor(minutes))) : 0
  const s = Number.isFinite(seconds) ? Math.max(0, Math.min(59, Math.floor(seconds))) : 0
  return Math.max(HEADWAY_MIN_S, Math.min(HEADWAY_MAX_S, m * 60 + s))
}

/** Timetable density: how many consists one direction runs per hour. */
export function trainsPerHour(headwayS: number): number {
  if (!Number.isFinite(headwayS) || headwayS <= 0) return 0
  return Math.round((3600 / headwayS) * 10) / 10
}

/** Served demand per hour at this headway for the line's per-train load. */
export function servedPerHour(alightPerTrain: number, headwayS: number): number {
  if (!Number.isFinite(headwayS) || headwayS <= 0) return 0
  return Math.round((alightPerTrain * 3600) / headwayS)
}

/**
 * How many consists one line runs per dispatch: one per platform rail, or the
 * whole line's single train when it owns no rails yet — the same count
 * `World.serviceTracks` dispatches (§6.5), so the chart and the crowd agree.
 */
export function serviceTrackCount(modules: readonly Module[], lineId: string): number {
  const bound = modules.filter((m) => m.type === 'track' && m.cfg.line === lineId)
  const platforms = bound.filter((m) => m.type === 'track' && !m.cfg.tunnel && !m.cfg.bridge)
  const n = platforms.length > 0 ? platforms.length : bound.length
  return n > 0 ? n : 1
}

/**
 * People per hour the trains bring into the station at one instant: every
 * line's per-train 下车 over its current headway, times its consists. A
 * 非工作日 runs 平峰/离峰 only, like the rest of the timetable.
 */
export function trainAlightPerHourAt(
  simTime: number,
  lines: readonly LineDef[],
  modules: readonly Module[],
  service: TimeSpan,
  peaks: PeakWindows,
  workday: boolean,
): number {
  const period = periodOf(simTime, service, peaks, workday)
  let total = 0
  for (const line of lines) {
    const headway = line.headwayProfile[period]
    if (!Number.isFinite(headway) || headway <= 0) continue
    total += ((line.alightPerTrain * 3600) / headway) * serviceTrackCount(modules, line.id)
  }
  return total
}

/**
 * `trainAlightPerHourAt` across the whole day on a uniform grid — what the
 * 列车客流曲线 draws, the step landing on the same 15-minute samples as the
 * entrance curve's.
 */
export function trainAlightSeries(
  lines: readonly LineDef[],
  modules: readonly Module[],
  service: TimeSpan,
  peaks: PeakWindows,
  workday: boolean,
  stepMinutes = 15,
): number[] {
  const step = Number.isFinite(stepMinutes) && stepMinutes > 0 ? stepMinutes : 15
  const steps = Math.max(1, Math.round((24 * 60) / step))
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(trainAlightPerHourAt((i * SIM_DAY) / steps, lines, modules, service, peaks, workday))
  return out
}

/**
 * The load-path repair: an old save may hold any integer consist (the pre-chip
 * 1–8 slider) or an out-of-range headway, so snap both rather than refuse.
 */
export function repairLineRunning(line: LineDef): LineDef {
  return {
    ...line,
    cars: snapFormation(line.cars),
    headwayProfile: normalizeHeadwayProfile(line.headwayProfile),
  }
}
