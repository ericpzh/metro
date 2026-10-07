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
 * 工作日 / 周六 / 周日 / 节假日. It is **derived** from the date — the calendar's two lists say
 * which dates are 节假日 and which are 调休上班, the weekday decides the rest — so the clock can
 * never disagree with the day it is printing.
 */
export type DayType = 'weekday' | 'saturday' | 'sunday' | 'holiday'

/** The station's calendar: what day 0 is, and which dates are holidays or 调休 work days. */
export interface SimCalendar {
  /** The civil date `simTime = 0` stands on, at 00:00 — 第 1 天 of the run. */
  epoch: SimDate
  /**
   * 节假日, as `YYYY-MM-DD` keys. A date on this list is a holiday whatever weekday it falls
   * on, and it **outranks `workdays`** if a file puts a date on both. §9.6C's 活动日 rows are
   * the same idea with a multiplier attached and belong beside it, keyed by the same `dateKey`.
   */
  holidays: readonly string[]
  /**
   * 调休上班日 — the weekend days a holiday arrangement moves *into* the working week. A date
   * here is 工作日 whatever weekday it falls on, which is what makes a Saturday that everyone
   * works on read as one (§9.6C 日期类型).
   */
  workdays: readonly string[]
}

/**
 * The shipped calendar: **day 0 is 2026-01-01**, and the two lists are 国务院办公厅
 * 国办发明电〔2025〕7号 (the 2026 public-holiday arrangement, published 2025-11-04) — every
 * 放假 date as a holiday and every 调休 上班 date as a work day:
 *
 * | | |
 * |---|---|
 * | 元旦 | 01-01 … 01-03 (01-04 上班) |
 * | 春节 | 02-15 … 02-23, nine days (02-14, 02-28 上班) |
 * | 清明节 | 04-04 … 04-06 |
 * | 劳动节 | 05-01 … 05-05 (05-09 上班) |
 * | 端午节 | 06-19 … 06-21 |
 * | 中秋节 | 09-25 … 09-27 |
 * | 国庆节 | 10-01 … 10-07 (09-20, 10-10 上班) |
 *
 * A station may carry its own lists (the 时刻 window's calendar is where that will be edited);
 * these are the ones a station that has not authored any runs.
 */
export const DEFAULT_CALENDAR: SimCalendar = {
  epoch: { year: 2026, month: 1, day: 1 },
  holidays: [
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
  ],
  workdays: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
}

/** The year the shipped calendar belongs to — what the 时刻 window's calendar opens on. */
export const CALENDAR_YEAR = DEFAULT_CALENDAR.epoch.year

/** 一月 … 十二月, as a month header prints them. */
export const MONTH_LABELS: readonly string[] = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
]

/** 一 二 三 四 五 六 日 — the month grid's own column heads, Monday first. */
export const MONTH_GRID_HEADS: readonly string[] = ['一', '二', '三', '四', '五', '六', '日']

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
 * Where an analogue clock's two hands stand at `seconds` into the run, in **degrees
 * clockwise from 12 o'clock** — what the in-world 时钟's dial turns its hands by
 * (`render/models/pieces/ClockModel.ts`).
 *
 * It lives here, beside the clock's own strings, because it is the same derivation: a 电视
 * prints `stampAt().clock` while the dial beside it *points* at that minute, and a second
 * implementation of "where is the minute hand" is a second answer the station could give.
 * The one place a sim second becomes a time is this module, so the printed readouts, the
 * crowd's demand and the hands on the wall all read it rather than three formatters.
 *
 * **The hour hand carries the minutes and the minute hand the seconds**, which is how a real
 * movement reads: at 10:09 the hour hand stands at 304.5°, not 300°. `seconds` is kept
 * fractional rather than floored, because the scene sweeps the hands between the worker's
 * snapshots (`render/scene/systems/ClockSystem.ts`) — a floor here would make the minute
 * hand step once a sim second instead of creeping.
 */
export function clockHandAngles(seconds: number): { hour: number; minute: number } {
  // A time before the epoch (`simTime < 0`) reads as the hour it really is rather than as
  // hour −1, the same floor-modulo `clockTextOf` applies to a time of day.
  const t = ((seconds % SIM_DAY) + SIM_DAY) % SIM_DAY
  return {
    // Twelve hours to a full turn, so 30° an hour and 0.5° a minute the hour hand has walked.
    hour: ((t % (12 * 3600)) / 3600) * 30,
    // Sixty minutes to a full turn, so 6° a minute and 0.1° a second.
    minute: ((t % 3600) / 60) * 6,
  }
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
 * The station's two peak windows (§9.6C 高峰时段), each defaulted and bent into range — and the
 * **pair held in order**: 早高峰 ends no later than 晚高峰 begins.
 *
 * A day has one morning peak and one evening peak, and everything that reads them assumes it:
 * the chart draws their grips as two bands that must not cross, the drag walls each end against
 * the other window, and a timetable whose "morning" peak ran to 18:00 would be describing
 * something that is not a morning. So the repair is the same rule the drag applies — **the
 * evening peak starts no earlier than the morning peak ends** — rather than a sort of the two
 * (which would swap the player's windows under their hands). The morning keeps the room it has,
 * and if that leaves the evening nowhere to live the evening is squeezed into the end of the day
 * rather than refused.
 */
export function normalizePeaks(raw: unknown): PeakWindows {
  const list = Array.isArray(raw) ? raw : []
  const early = normalizeSpan(list[0], DEFAULT_PEAKS[0])
  // Leave at least a minimum evening peak after the morning one, so the pair always fits.
  const earlyTo = Math.min(early.to, SERVICE_LATEST - SERVICE_MIN_SPAN)
  const first: TimeSpan = { from: Math.min(early.from, earlyTo - SERVICE_MIN_SPAN), to: earlyTo }
  const late = normalizeSpan(list[1], DEFAULT_PEAKS[1])
  const from = Math.max(late.from, first.to)
  return [first, { from, to: Math.max(late.to, from + SERVICE_MIN_SPAN) }]
}

/**
 * The station's calendar (§9.6C 日期类型): a real date for day 0, and two lists of `YYYY-MM-DD`
 * keys. Repaired rather than refused, like every other load path — an epoch that is not a date
 * falls back to the shipped one, a nonsense month rolls to the nearest legal one, and a key
 * that is not `YYYY-MM-DD` is dropped from its list rather than left to match nothing.
 */
export function normalizeCalendar(raw: unknown): SimCalendar {
  const epoch = normalizeDate(epochOf(raw))
  // **A list the document does not carry at all is the shipped one**, not an empty list: the
  // 2026 arrangement is known, and a station that only ever picked a date still wants its
  // holidays. A list that *is* there but is junk is the player's own (empty) list.
  const holidays = fieldOf(raw, 'holidays') === undefined ? [...DEFAULT_CALENDAR.holidays] : keyList(fieldOf(raw, 'holidays'))
  const workdays = fieldOf(raw, 'workdays') === undefined ? [...DEFAULT_CALENDAR.workdays] : keyList(fieldOf(raw, 'workdays'))
  return {
    epoch,
    holidays,
    // A date that is on both lists is a holiday: the shop is shut, whatever the arrangement
    // said about working weekends.
    workdays: workdays.filter((k) => !holidays.includes(k)),
  }
}

/** One date off the wire, clamped to a day that exists. */
function normalizeDate(raw: unknown): SimDate {
  const year = clampYear(numberOf(raw, 'year', DEFAULT_CALENDAR.epoch.year))
  const month = clampInt(numberOf(raw, 'month', DEFAULT_CALENDAR.epoch.month), 1, 12)
  const day = clampInt(numberOf(raw, 'day', DEFAULT_CALENDAR.epoch.day), 1, daysInMonth(year, month))
  return { year, month, day }
}

function clampYear(year: number): number {
  return clampInt(year, 1970, 2400)
}

function clampInt(value: number, lo: number, hi: number): number {
  const n = Math.round(value)
  return n < lo ? lo : n > hi ? hi : n
}

function numberOf(raw: unknown, key: string, fallback: number): number {
  const value = fieldOf(raw, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function epochOf(raw: unknown): unknown {
  return fieldOf(raw, 'epoch')
}

function fieldOf(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined
}

/** The `YYYY-MM-DD` keys an untrusted list actually holds, in the order they were given. */
function keyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((k): k is string => typeof k === 'string' && DATE_KEY_RE.test(k))
}

/** A date key's own shape: four-digit year, two-digit month and day. */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

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
 * The sim seconds at which the clock stands on `date` at `timeOfDay` — the arithmetic behind the
 * 时刻 window's calendar pick, which **moves the station to that day** rather than relabelling
 * day 0. Keeping the time of day is the point: picking a date asks "run the station on this day",
 * not "restart it at midnight".
 */
export function simTimeAtDate(date: SimDate, epoch: SimDate, timeOfDay: number): number {
  const days = daysFromCivil(date.year, date.month, date.day) - daysFromCivil(epoch.year, epoch.month, epoch.day)
  return days * SIM_DAY + timeOfDay
}

/**
 * Which of §9.6C's four day types a date is: a holiday if the station lists it, else
 * 周六 / 周日 by the weekday, else 工作日. **A 调休上班日 is a 工作日** even on a Saturday — a
 * holiday arrangement that moves a working day into the weekend is exactly the case §9.6C's
 * 日期类型 has to be able to say, and it is the reason the list is checked before the weekday.
 */
export function dayTypeOf(
  weekday: number,
  dateKey: string,
  holidays: readonly string[] = [],
  workdays: readonly string[] = [],
): DayType {
  if (holidays.includes(dateKey)) return 'holiday'
  if (workdays.includes(dateKey)) return 'weekday'
  if (weekday === 6) return 'saturday'
  if (weekday === 0) return 'sunday'
  return 'weekday'
}

/**
 * The civil day a simulated instant falls on — the calendar half of a stamp, without
 * the clock's own strings. `World` reads its day type from here, and `stampAt` is this
 * plus the time of day, so a readout and a spawn cannot disagree about the date.
 */
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

/** The weekday of a date, 0 = Sunday. 1970-01-01 was a Thursday, which is where the 4 comes
 *  from; the same rule `dayAt` applies, so a grid cell and a running clock agree. */
export function weekdayOf(date: SimDate): number {
  const days = daysFromCivil(date.year, date.month, date.day)
  return (((days + 4) % 7) + 7) % 7
}

/** How many days a month has: the first of the next month minus the first of this one. */
export function daysInMonth(year: number, month: number): number {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return daysFromCivil(next.year, next.month, 1) - daysFromCivil(year, month, 1)
}

/** One cell of a month grid: a date, its weekday and the day type it carries. */
export interface CalendarCell {
  date: SimDate
  dateKey: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** How a Monday-first grid prints it: 一 … 日. */
  head: string
  dayType: DayType
}

/**
 * A month as whole weeks, **Monday first** (the Chinese convention), with `null` for the
 * cells before the first and after the last day. The arithmetic a calendar view needs and
 * nothing about drawing it — so the grid can be pinned by a test rather than by looking at it.
 */
export function monthGrid(year: number, month: number, calendar: SimCalendar = DEFAULT_CALENDAR): Array<Array<CalendarCell | null>> {
  const lead = (weekdayOf({ year, month, day: 1 }) + 6) % 7 // Monday = 0
  const count = daysInMonth(year, month)
  const cells: Array<CalendarCell | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let day = 1; day <= count; day++) {
    const date: SimDate = { year, month, day }
    const dateKey = dateKeyOf(date)
    const weekday = weekdayOf(date)
    cells.push({
      date,
      dateKey,
      weekday,
      head: MONTH_GRID_HEADS[(weekday + 6) % 7],
      dayType: dayTypeOf(weekday, dateKey, calendar.holidays, calendar.workdays),
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Array<Array<CalendarCell | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
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
  return {
    dayIndex,
    date,
    dateKey,
    weekday,
    dayType: dayTypeOf(weekday, dateKey, calendar.holidays, calendar.workdays),
  }
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
