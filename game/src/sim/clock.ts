// The simulated clock (§7.9, §9.6C): the one place a sim second becomes a civil
// date, a weekday, a time of day and a period. Pure — no DOM, no worker, no three —
// so the panel readouts (`app/windows/**`), the in-world plates (`render/`) and the
// crowd's own demand (`sim/constants.ts` `periodOf`) all read the same clock rather
// than three formatters that drift apart.
//
// **The simulation counts seconds; a station lives on a calendar.** `simTime` is
// seconds since the run began and `SIM_DAY`-sized, so *day 0* is the station's first
// day and the calendar enters in exactly one place: `stampAt` lays that day on
// `calendar.epoch` and derives the date, the weekday and the day type from it. A
// long run therefore crosses midnight on its own — `dayIndex` and the date walk
// forward while the crowd keeps its seconds.
//
// Two things are authored per station and the rest is derived. The **operating hours**
// (`TimeSpan`, §9.6C 营业时间) and the two **peak windows** (高峰时段) are document data with
// defaults: they decide whether the station is open at all and when its peaks land, and
// `periodOf` — the function the dispatcher picks its headway with — reads the very same
// pair this module does, so the 已闭站 or 高峰 the card prints cannot disagree with the
// crowd it is describing.
//
// Today the *calendar* is a documented default (`DEFAULT_CALENDAR`). §9.6C's 时刻 panel
// is where a station authors its own epoch, 日期类型, 节假日 and 活动日; when that lands
// the calendar arrives as an argument from the station document and every caller
// here keeps working unchanged — which is the whole reason the epoch is a parameter
// of one function instead of a constant read in five readouts.

import {
  DEFAULT_PEAKS,
  DEFAULT_SERVICE,
  SIM_DAY,
  periodOf,
  timeOfDayOf,
  withinSpan,
  type PeakWindows,
  type Period,
  type TimeSpan,
} from './constants.ts'

/** A civil date in the proleptic Gregorian calendar. `month` is 1–12. */
export interface SimDate {
  year: number
  month: number
  day: number
}

/**
 * The four kinds of day a station's demand is authored against (§7.4, §9.6C):
 * 工作日 / 周六 / 周日 / 节假日. It is **derived** from the date — the weekday picks the
 * first three, `holidays` picks the fourth — so the clock can never disagree with the
 * day it is printing.
 */
export type DayType = 'weekday' | 'saturday' | 'sunday' | 'holiday'

/** The station's calendar: what day 0 is, and which dates are holidays. */
export interface SimCalendar {
  /** The civil date `simTime = 0` stands on, at 00:00. */
  epoch: SimDate
  /**
   * 节假日, as `YYYY-MM-DD` keys. A date on this list is a holiday whatever weekday
   * it falls on. §9.6C's 活动日 rows are the same idea with a multiplier attached and
   * belong beside it, keyed by the same `dateKey`.
   */
  holidays: readonly string[]
}

/** A station that has not authored a calendar yet opens on 2026-01-01 (a Thursday). */
export const DEFAULT_CALENDAR: SimCalendar = { epoch: { year: 2026, month: 1, day: 1 }, holidays: [] }

/** 周日 … 周六, indexed by `stampAt().weekday`. */
export const WEEKDAY_LABELS: readonly string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** The same seven days as a timetable prints them in a column: 日一二三四五六, one character. */
export const WEEKDAY_INITIALS: readonly string[] = ['日', '一', '二', '三', '四', '五', '六']

/** 工作日 / 周六 / 周日 / 节假日, as a chip prints them. */
export const DAY_TYPE_LABELS: Record<DayType, string> = {
  weekday: '工作日',
  saturday: '周六',
  sunday: '周日',
  holiday: '节假日',
}

/** 高峰 / 平峰 / 夜间 — the three periods the timetable keys its headway on (§6.5). */
export const PERIOD_LABELS: Record<Period, string> = { peak: '高峰', offpeak: '平峰', late: '夜间' }

/**
 * Everything a readout needs about one instant of simulated time. One object rather
 * than a function per field: a clock that prints its date, its weekday and its
 * period from three separate calls is three chances for them to be a second apart.
 */
export interface SimStamp {
  /** The sim seconds this stamp was read at. */
  simTime: number
  /** Whole simulated days since the epoch: 0 on the station's first day. */
  dayIndex: number
  date: SimDate
  /** `YYYY-MM-DD` — the key a holiday list or a calendar coefficient is indexed by. */
  dateKey: string
  /** 0 = Sunday … 6 = Saturday, the convention `Date.getUTCDay` uses. */
  weekday: number
  hour: number
  minute: number
  second: number
  /** Seconds since midnight, 0 … 86399. */
  timeOfDay: number
  /** How far through the day the clock stands, 0 … 1 — what a day bar draws. */
  dayFraction: number
  /** `HH:MM`. */
  clock: string
  /** `HH:MM:SS`. */
  clockSeconds: string
  /** `1月1日` — the way a timetable prints a date, unpadded. */
  dateLabel: string
  /** `周四`. */
  weekdayLabel: string
  /** `四` — the one character the timetable column carries. */
  weekdayInitial: string
  /**
   * `1月1日 00:00:00 四`, the whole clock on one line. Any chrome around it — a pair of
   * brackets — belongs to whatever draws it, not here.
   */
  readout: string
  /** Is the station open at this instant — inside its operating hours? */
  isOpen: boolean
  /** The operating hours this stamp was read against (§9.6C 营业时间). */
  service: TimeSpan
  dayType: DayType
  period: Period
}

/** The last minute of a day an operating window may reach: 23:59. */
export const SERVICE_LATEST = 23 * 3600 + 59 * 60
/** The shortest operating window a station may be given: 15 minutes. */
export const SERVICE_MIN_SPAN = 15 * 60

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `HH:MM` for any seconds-since-midnight, e.g. an operating window's ends. */
export function clockTextOf(seconds: number): string {
  const t = ((Math.round(seconds) % SIM_DAY) + SIM_DAY) % SIM_DAY
  return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}`
}

/**
 * The seconds since midnight an `HH:MM` (or `HH:MM:SS`) reads as, or null when the
 * text is not a time — the one parse behind an `<input type="time">`, whose value is
 * exactly this shape and which reports an empty string while the player is typing.
 */
export function secondsOfClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = m[3] === undefined ? 0 : Number(m[3])
  if (h > 23 || min > 59 || sec > 59) return null
  return h * 3600 + min * 60 + sec
}

/**
 * One span of a station's day, repaired into something the day can hold: both ends
 * inside 00:00–23:59 and at least a quarter of an hour apart.
 *
 * A span that crosses midnight (a night service, an overnight peak) is deliberately
 * **not** expressible here — §9.6C authors 营业时间 and 高峰时段 as spans of one day — so
 * a save or a keystroke that would invert one is bent to fit rather than refused, which
 * is what keeps the day bar and the sim agreeing about a document already written.
 *
 * It takes `unknown` because it is a *load path*: the field comes off a file the player
 * may have edited, or out of a JSON blob, and a string where a window belongs must be a
 * default rather than a crash.
 */
function normalizeSpan(raw: unknown, fallback: TimeSpan): TimeSpan {
  const from = clampSeconds(endOf(raw, 'from'), fallback.from, 0, SERVICE_LATEST - SERVICE_MIN_SPAN)
  const to = clampSeconds(endOf(raw, 'to'), fallback.to, from + SERVICE_MIN_SPAN, SERVICE_LATEST)
  return { from, to }
}

/** One end of a raw span, or undefined when the value is not an object at all. */
function endOf(raw: unknown, key: keyof TimeSpan): unknown {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined
}

/** The station's operating hours (§9.6C 营业时间), defaulted and bent into range. */
export function normalizeService(raw: unknown): TimeSpan {
  return normalizeSpan(raw, DEFAULT_SERVICE)
}

/**
 * The station's two peak windows (§9.6C 高峰时段), each defaulted and bent into range.
 * The pair keeps the order it was given — 早高峰 first — rather than being sorted: the
 * player typing a late window earlier than the early one is an edit in progress, not a
 * document to reorder under their hands, and `periodOf` scans both regardless.
 */
export function normalizePeaks(raw: unknown): PeakWindows {
  const list = Array.isArray(raw) ? raw : []
  return [normalizeSpan(list[0], DEFAULT_PEAKS[0]), normalizeSpan(list[1], DEFAULT_PEAKS[1])]
}

function clampSeconds(value: unknown, fallback: number, lo: number, hi: number): number {
  // Whole minutes only: an operating time is authored in the timetable's own unit, so
  // a stray second in a file cannot make the two ends disagree with what is printed.
  if (typeof value !== 'number' || !Number.isFinite(value)) return clampTo(fallback, lo, hi)
  return clampTo(Math.round(value / 60) * 60, lo, hi)
}

function clampTo(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Is `timeOfDay` inside the window? `[from, to)` — the closing minute is shut. */
export function isOpenAt(timeOfDay: number, service: TimeSpan = DEFAULT_SERVICE): boolean {
  return withinSpan(timeOfDay, service)
}

/**
 * Days since 1970-01-01 for a civil date. Howard Hinnant's `days_from_civil`: exact
 * for every Gregorian date, which is the half of date arithmetic that silently gets
 * leap years and century rules wrong (1900 is not a leap year, 2000 is).
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400 // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/** The civil date `days` after 1970-01-01 — the inverse of `daysFromCivil`. */
export function civilFromDays(days: number): SimDate {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097 // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day }
}

/** `YYYY-MM-DD`: the key the holiday list and a calendar coefficient are indexed by. */
export function dateKeyOf(date: SimDate): string {
  return `${String(date.year).padStart(4, '0')}-${pad2(date.month)}-${pad2(date.day)}`
}

/**
 * Which of §9.6C's four day types a date is: a holiday if the station lists it, else
 * 周六 / 周日 by the weekday, else 工作日.
 */
export function dayTypeOf(weekday: number, dateKey: string, holidays: readonly string[] = []): DayType {
  if (holidays.includes(dateKey)) return 'holiday'
  if (weekday === 6) return 'saturday'
  if (weekday === 0) return 'sunday'
  return 'weekday'
}

/** The civil day a simulated instant falls on — the calendar half of a stamp, without
 *  the clock's own strings. `World` reads its day type from here, and `stampAt` is this
 *  plus the time of day, so a readout and a spawn cannot disagree about the date. */
export interface SimDay {
  /** Whole simulated days since the epoch: 0 on the station's first day. */
  dayIndex: number
  date: SimDate
  /** `YYYY-MM-DD` — the key a holiday list or a calendar coefficient is indexed by. */
  dateKey: string
  /** 0 = Sunday … 6 = Saturday, the convention `Date.getUTCDay` uses. */
  weekday: number
  dayType: DayType
}

/**
 * The civil day `simTime` stands on. Floor division, not truncation: a time before the
 * epoch (`simTime < 0`, which a scrubber may one day allow) reads as a real date an hour
 * earlier rather than as hour −1 of day 0.
 */
export function dayAt(simTime: number, calendar: SimCalendar = DEFAULT_CALENDAR): SimDay {
  const dayIndex = Math.floor(simTime / SIM_DAY)
  const days = daysFromCivil(calendar.epoch.year, calendar.epoch.month, calendar.epoch.day) + dayIndex
  const date = civilFromDays(days)
  // 1970-01-01 was a Thursday, which is where the 4 comes from.
  const weekday = (((days + 4) % 7) + 7) % 7
  const dateKey = dateKeyOf(date)
  return { dayIndex, date, dateKey, weekday, dayType: dayTypeOf(weekday, dateKey, calendar.holidays) }
}

/**
 * Read the clock at `simTime`, against the station's own calendar and windows: the day
 * it stands on, the time of day to the second, and what that time *means* — open or
 * shut, and which of the three service periods the timetable is running.
 */
export function stampAt(
  simTime: number,
  calendar: SimCalendar = DEFAULT_CALENDAR,
  service: TimeSpan = DEFAULT_SERVICE,
  peaks: PeakWindows = DEFAULT_PEAKS,
): SimStamp {
  const seconds = Math.floor(simTime)
  const day = dayAt(seconds, calendar)
  const timeOfDay = timeOfDayOf(seconds)
  const hour = Math.floor(timeOfDay / 3600)
  const minute = Math.floor((timeOfDay % 3600) / 60)
  const second = timeOfDay % 60
  const dateLabel = `${day.date.month}月${day.date.day}日`
  const clock = `${pad2(hour)}:${pad2(minute)}`
  const clockSeconds = `${clock}:${pad2(second)}`
  const weekdayInitial = WEEKDAY_INITIALS[day.weekday]
  return {
    simTime,
    dayIndex: day.dayIndex,
    date: day.date,
    dateKey: day.dateKey,
    weekday: day.weekday,
    hour,
    minute,
    second,
    timeOfDay,
    dayFraction: timeOfDay / SIM_DAY,
    clock,
    clockSeconds,
    dateLabel,
    weekdayLabel: WEEKDAY_LABELS[day.weekday],
    weekdayInitial,
    readout: `${dateLabel} ${clockSeconds} ${weekdayInitial}`,
    isOpen: isOpenAt(timeOfDay, service),
    service,
    dayType: day.dayType,
    // The sim's own period, not a second reading of the windows: the clock can never
    // say 平峰 while the dispatcher is running its peak headway (§6.5). Read off the
    // displayed second and against the same windows the sim was given, so the chip
    // describes the time printed beside it.
    period: periodOf(seconds, service, peaks),
  }
}
