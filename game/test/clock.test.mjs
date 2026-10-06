// The simulated clock (`sim/clock.ts`): a sim second becomes a civil date, a weekday,
// a day type and one readout string, and the 信息栏's clock card, the status bar's 时间
// and the in-world 电视 plates all print that one clock.
//
// What a broken version would look like is the point of most of these: a date that is
// one day out, a weekday that is one off, a leap year that is not honoured, or a
// midnight that never comes all *look* like a working clock. So the arithmetic is
// pinned against real calendar facts (2024-02-29 exists; 1970-01-01 was a Thursday)
// rather than against itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DAY_TYPE_LABELS,
  DEFAULT_CALENDAR,
  PERIOD_LABELS,
  WEEKDAY_INITIALS,
  WEEKDAY_LABELS,
  civilFromDays,
  clockTextOf,
  dateKeyOf,
  dayTypeOf,
  daysFromCivil,
  isOpenAt,
  normalizePeaks,
  normalizeService,
  secondsOfClock,
  SERVICE_LATEST,
  SERVICE_MIN_SPAN,
  stampAt,
} from '../src/sim/clock.ts'
import { DEFAULT_PEAKS, DEFAULT_SERVICE, SIM_DAY } from '../src/sim/constants.ts'

const NOON = 12 * 3600

test('day 0 of the default calendar is 1月1日, whatever the run does after it', () => {
  const stamp = stampAt(0)
  assert.equal(stamp.readout, '1月1日 00:00:00 四', 'a fresh station opens on the new year — 2026-01-01 was a Thursday')
  assert.equal(stamp.dayIndex, 0)
  assert.equal(stamp.dateKey, '2026-01-01')
  assert.equal(stamp.dayType, 'weekday', 'a Thursday is a 工作日')
  assert.equal(stamp.period, 'late', '00:00 is outside the service window')
})

test('the one-line readout is the whole clock on one line, brackets excluded', () => {
  // 07:45:12 on day 0 — the reference boot time plus twelve seconds of crowd.
  const stamp = stampAt(7 * 3600 + 45 * 60 + 12)
  assert.equal(stamp.clock, '07:45')
  assert.equal(stamp.clockSeconds, '07:45:12')
  assert.equal(stamp.dateLabel, '1月1日', 'the date is printed unpadded, the way a timetable prints it')
  assert.equal(stamp.weekdayLabel, '周四')
  assert.equal(stamp.weekdayInitial, '四')
  assert.equal(stamp.readout, '1月1日 07:45:12 四')
})

test('the parts agree with the readout: one stamp, not three readings', () => {
  for (const t of [0, 1, 59, 3599, NOON, 86399, 86400, 86401, 123456, -1, -86400]) {
    const s = stampAt(t)
    assert.equal(s.clockSeconds, `${s.clock}:${String(s.second).padStart(2, '0')}`)
    assert.equal(s.readout, `${s.dateLabel} ${s.clockSeconds} ${s.weekdayInitial}`)
    assert.equal(s.timeOfDay, s.hour * 3600 + s.minute * 60 + s.second)
    assert.equal(s.dayFraction, s.timeOfDay / SIM_DAY)
    assert.equal(s.weekdayLabel, WEEKDAY_LABELS[s.weekday])
    assert.equal(s.weekdayInitial, WEEKDAY_INITIALS[s.weekday])
  }
})

test('midnight rolls the date, the weekday and the day index over', () => {
  const last = stampAt(SIM_DAY - 1)
  const midnight = stampAt(SIM_DAY)
  assert.equal(last.clockSeconds, '23:59:59', 'the last second of day 0')
  assert.equal(last.dateLabel, '1月1日')
  assert.equal(midnight.clockSeconds, '00:00:00')
  assert.equal(midnight.dayIndex, 1)
  assert.equal(midnight.dateLabel, '1月2日', 'the station has crossed into its second day')
  assert.equal(midnight.weekdayLabel, '周五', 'and the weekday walked with it')
  assert.equal(midnight.dateKey, '2026-01-02')
})

test('a week of running lands back on the same weekday, a week later', () => {
  const start = stampAt(NOON)
  const week = stampAt(7 * SIM_DAY + NOON)
  assert.equal(week.weekday, start.weekday)
  assert.equal(week.weekdayLabel, start.weekdayLabel)
  assert.equal(week.dayIndex, 7)
  assert.equal(week.dateKey, '2026-01-08')
})

test('the weekend is 周六 and 周日 by the date, not by a switch', () => {
  // 2026-01-03 is a Saturday, 2026-01-04 a Sunday: 2 and 3 days after the epoch.
  const sat = stampAt(2 * SIM_DAY + 10 * 3600)
  const sun = stampAt(3 * SIM_DAY + 10 * 3600)
  assert.equal(sat.weekdayLabel, '周六')
  assert.equal(sat.weekdayInitial, '六', 'which is the 六 a Chinese timetable column prints')
  assert.equal(sat.dayType, 'saturday')
  assert.equal(DAY_TYPE_LABELS[sat.dayType], '周六')
  assert.equal(sun.weekdayLabel, '周日')
  assert.equal(sun.dayType, 'sunday')
  assert.equal(sun.dateKey, '2026-01-04')
})

test('a holiday is a holiday whatever weekday it lands on', () => {
  // 2026-01-05 is a Monday: 工作日 by the weekday, 节假日 once the station lists it —
  // the 日期类型 of §9.6C, which is the first thing the crowd's calendar multiplier
  // will read.
  const calendar = { ...DEFAULT_CALENDAR, holidays: ['2026-01-05'] }
  const monday = stampAt(4 * SIM_DAY + NOON)
  assert.equal(monday.dayType, 'weekday')
  const holiday = stampAt(4 * SIM_DAY + NOON, calendar)
  assert.equal(holiday.dayType, 'holiday')
  assert.equal(holiday.weekdayLabel, '周一', 'a holiday is still a Monday')
  assert.equal(DAY_TYPE_LABELS[holiday.dayType], '节假日')
})

test('dayTypeOf is the four-way rule on its own', () => {
  assert.equal(dayTypeOf(1, '2026-03-02'), 'weekday')
  assert.equal(dayTypeOf(6, '2026-03-07'), 'saturday')
  assert.equal(dayTypeOf(0, '2026-03-08'), 'sunday')
  assert.equal(dayTypeOf(6, '2026-03-07', ['2026-03-07']), 'holiday', 'the list wins over the weekday')
})

test('the period is the sim’s own periodOf, boundaries included', () => {
  const at = (h, m = 0) => stampAt(h * 3600 + m * 60).period
  assert.equal(at(0), 'late')
  assert.equal(at(5, 29), 'late', 'before 06:30 the station is shut (§9.6C 营业时间)')
  assert.equal(at(5, 30), 'late', 'and a shut station is 夜间 whatever the timetable would say')
  assert.equal(at(6, 29), 'late', 'the last shut minute')
  assert.equal(at(6, 30), 'offpeak', 'which is where the window opens and the 夜间 shoulder ends')
  assert.equal(at(7, 29), 'offpeak')
  assert.equal(at(7, 30), 'peak', 'the AM peak window opens at 07:30')
  assert.equal(at(8), 'peak')
  assert.equal(at(9), 'offpeak', 'and closes at 09:00')
  assert.equal(at(17, 30), 'peak', 'the PM window')
  assert.equal(at(18, 59), 'peak')
  assert.equal(at(19), 'offpeak')
  assert.equal(at(22, 29), 'offpeak')
  assert.equal(at(22, 30), 'late', 'the late tail')
  assert.equal(at(23, 59), 'late')
  // The readout and the period come off one stamp, so the chip cannot name a period
  // the clock is not in.
  assert.equal(PERIOD_LABELS[stampAt(8 * 3600).period], '高峰')
  assert.equal(PERIOD_LABELS[stampAt(NOON).period], '平峰')
  assert.equal(PERIOD_LABELS[stampAt(23 * 3600).period], '夜间')
})

test('the operating window decides whether the station is open at all', () => {
  // The shipped default is 06:30–23:30 (§9.6C 营业时间).
  assert.equal(DEFAULT_SERVICE.from, 6.5 * 3600)
  assert.equal(DEFAULT_SERVICE.to, 23.5 * 3600)
  assert.equal(stampAt(6 * 3600 + 29 * 60).isOpen, false, 'a minute before opening')
  assert.equal(stampAt(6 * 3600 + 30 * 60).isOpen, true)
  assert.equal(stampAt(23 * 3600 + 29 * 60).isOpen, true, 'the last open minute')
  assert.equal(stampAt(23 * 3600 + 30 * 60).isOpen, false, 'closing is shut, not open')
  assert.equal(stampAt(3 * 3600).isOpen, false)
  // The window is half-open — `[from, to)` — and `isOpenAt` is the one rule the stamp and
  // the day bar's lit band both read.
  assert.equal(isOpenAt(DEFAULT_SERVICE.from), true)
  assert.equal(isOpenAt(DEFAULT_SERVICE.to), false)
  assert.equal(isOpenAt(0, { from: 0, to: SERVICE_LATEST }), true)
  // **Shipping the window changed no crowd.** Every hour the default excludes was
  // already 夜间 service under the shoulders, so a replay of an old run still holds.
  for (const h of [0, 5, 6, 23]) assert.equal(stampAt(h * 3600).period, 'late')
})

test('the peak windows decide the periods, and shut is checked before them', () => {
  // The shipped pair is 07:30–09:00 and 17:30–19:00 (§9.6C 高峰时段).
  assert.deepEqual(DEFAULT_PEAKS, [
    { from: 7.5 * 3600, to: 9 * 3600 },
    { from: 17.5 * 3600, to: 19 * 3600 },
  ])
  assert.equal(stampAt(8 * 3600).period, 'peak')
  // Moving the morning peak moves the 高峰 with it — this is the clock the lines' headways
  // and the crowd's curve both key on, so the two cannot be on different peaks.
  const late = [{ from: 10 * 3600, to: 11 * 3600 }, DEFAULT_PEAKS[1]]
  assert.equal(stampAt(8 * 3600, DEFAULT_CALENDAR, DEFAULT_SERVICE, late).period, 'offpeak')
  assert.equal(stampAt(10 * 3600 + 30 * 60, DEFAULT_CALENDAR, DEFAULT_SERVICE, late).period, 'peak')
  // A peak drawn outside the operating hours is still a shut station: the window is asked
  // first, so a peak window cannot sneak service into hours the station is closed.
  const closed = { from: 12 * 3600, to: 18 * 3600 }
  assert.equal(stampAt(8 * 3600, DEFAULT_CALENDAR, closed, DEFAULT_PEAKS).period, 'late')
  assert.equal(stampAt(8 * 3600, DEFAULT_CALENDAR, closed, DEFAULT_PEAKS).isOpen, false)
})

test('a different window moves the period with it, and shut is checked first', () => {
  // 夜间 has two sources and they are not the same rule: the **window** (shut) and the
  // day's **shoulders** at 06:30 / 22:30. Opening all day removes the first and not the
  // second, which is what these two lines pin.
  const allDay = { from: 0, to: SERVICE_LATEST }
  assert.equal(stampAt(23 * 3600, DEFAULT_CALENDAR, allDay).isOpen, true, 'open all day…')
  assert.equal(stampAt(23 * 3600, DEFAULT_CALENDAR, allDay).period, 'late', '…and still on the 夜间 shoulder')
  assert.equal(stampAt(5 * 3600, DEFAULT_CALENDAR, allDay).isOpen, true)
  assert.equal(stampAt(5 * 3600, DEFAULT_CALENDAR, allDay).period, 'late', 'the early one too')
  // Narrowing the window *inside* the shoulders is what moves the period.
  const shortDay = { from: 9 * 3600, to: 21 * 3600 }
  assert.equal(stampAt(21 * 3600 + 30 * 60).period, 'offpeak')
  assert.equal(stampAt(21 * 3600 + 30 * 60, DEFAULT_CALENDAR, shortDay).period, 'late', 'shut from 21:00')
  assert.equal(stampAt(8 * 3600).period, 'peak')
  assert.equal(stampAt(8 * 3600, DEFAULT_CALENDAR, shortDay).period, 'late', 'a shut station has no peak to serve')
  assert.equal(stampAt(8 * 3600, DEFAULT_CALENDAR, shortDay).isOpen, false)
  assert.equal(stampAt(20 * 3600, DEFAULT_CALENDAR, shortDay).period, 'offpeak')
  assert.equal(stampAt(20 * 3600 + 59 * 60, DEFAULT_CALENDAR, shortDay).isOpen, true, 'the last open minute')
  assert.equal(stampAt(21 * 3600, DEFAULT_CALENDAR, shortDay).isOpen, false, 'closed on the dot')
})

test('a time box reads and writes a window in whole minutes', () => {
  assert.equal(clockTextOf(DEFAULT_SERVICE.from), '06:30')
  assert.equal(clockTextOf(DEFAULT_SERVICE.to), '23:30')
  assert.equal(clockTextOf(0), '00:00')
  assert.equal(clockTextOf(SIM_DAY - 1), '23:59')
  assert.equal(secondsOfClock('06:30'), DEFAULT_SERVICE.from)
  assert.equal(secondsOfClock('23:30'), DEFAULT_SERVICE.to)
  assert.equal(secondsOfClock(' 00:00 '), 0)
  assert.equal(secondsOfClock('06:30:15'), 6 * 3600 + 30 * 60 + 15, 'a one-second step still parses')
  assert.equal(secondsOfClock(''), null, 'the empty box a half-typed input reports')
  assert.equal(secondsOfClock('6:5'), null, 'minutes are two digits')
  assert.equal(secondsOfClock('06:60'), null)
  assert.equal(secondsOfClock('24:00'), null, 'the day ends at 23:59 — there is no 24 o’clock')
  assert.equal(secondsOfClock('opening'), null)
  for (const t of ['00:00', '06:30', '23:59']) assert.equal(clockTextOf(secondsOfClock(t)), t)
})

test('a window the day cannot hold is bent into range, not refused', () => {
  assert.deepEqual(normalizeService(undefined), DEFAULT_SERVICE, 'no window at all is the default')
  assert.deepEqual(normalizeService({ from: DEFAULT_SERVICE.from, to: DEFAULT_SERVICE.to }), DEFAULT_SERVICE)
  assert.deepEqual(normalizeService({ from: -100, to: 99 * 3600 }), { from: 0, to: SERVICE_LATEST })
  // Inverted: the end is pushed out to the shortest legal span after the start.
  assert.deepEqual(normalizeService({ from: 10 * 3600, to: 9 * 3600 }), {
    from: 10 * 3600,
    to: 10 * 3600 + SERVICE_MIN_SPAN,
  })
  // A start at the very end of the day pulls the whole span back with it.
  assert.deepEqual(normalizeService({ from: 25 * 3600, to: 25 * 3600 }), {
    from: SERVICE_LATEST - SERVICE_MIN_SPAN,
    to: SERVICE_LATEST,
  })
  // Whole minutes, so the stored span always agrees with what the boxes print.
  assert.deepEqual(normalizeService({ from: DEFAULT_SERVICE.from + 20, to: DEFAULT_SERVICE.to - 20 }), DEFAULT_SERVICE)
  assert.deepEqual(normalizeService({ from: Number.NaN, to: Number.POSITIVE_INFINITY }), DEFAULT_SERVICE)
  // Anything that is not a span at all — a string, a number, a null — is the default.
  for (const junk of ['06:30', 42, null, undefined]) assert.deepEqual(normalizeService(junk), DEFAULT_SERVICE)
})

test('the peak pair is repaired in place, and keeps its own order', () => {
  assert.deepEqual(normalizePeaks(undefined), DEFAULT_PEAKS, 'no peaks at all is the default pair')
  assert.deepEqual(normalizePeaks([]), DEFAULT_PEAKS)
  // A half-edited pair: the first window is kept, the missing second falls back.
  assert.deepEqual(normalizePeaks([{ from: 10 * 3600, to: 11 * 3600 }]), [
    { from: 10 * 3600, to: 11 * 3600 },
    DEFAULT_PEAKS[1],
  ])
  // **The order is the document's, not sorted**: a 晚高峰 typed earlier than the 早高峰 is an
  // edit in progress, and `periodOf` scans both windows regardless.
  assert.deepEqual(normalizePeaks([{ from: 18 * 3600, to: 19 * 3600 }, { from: 7 * 3600, to: 8 * 3600 }]), [
    { from: 18 * 3600, to: 19 * 3600 },
    { from: 7 * 3600, to: 8 * 3600 },
  ])
  // Each window carries the same repair a span does, junk included.
  assert.deepEqual(normalizePeaks([{ from: 9 * 3600, to: 9 * 3600 }, 'noon']), [
    { from: 9 * 3600, to: 9 * 3600 + SERVICE_MIN_SPAN },
    DEFAULT_PEAKS[1],
  ])
})

test('the calendar arithmetic is exact, and inversion round-trips it', () => {
  // The facts a hand-rolled date routine gets wrong: the epoch's own weekday, the
  // century rule (1900 is not a leap year, 2000 is), and a leap day in February.
  assert.equal(daysFromCivil(1970, 1, 1), 0)
  assert.equal(daysFromCivil(2000, 3, 1) - daysFromCivil(2000, 2, 28), 2, '2000-02-29 exists')
  assert.equal(daysFromCivil(1900, 3, 1) - daysFromCivil(1900, 2, 28), 1, '1900-02-29 does not')

  const epoch2024 = { ...DEFAULT_CALENDAR, epoch: { year: 2024, month: 2, day: 28 } }
  assert.equal(stampAt(0, epoch2024).weekdayLabel, '周三', '2024-02-28 was a Wednesday')
  assert.equal(stampAt(SIM_DAY, epoch2024).dateKey, '2024-02-29', 'a leap day is a day')
  assert.equal(stampAt(SIM_DAY, epoch2024).weekdayLabel, '周四')
  assert.equal(stampAt(2 * SIM_DAY, epoch2024).dateKey, '2024-03-01')
  assert.equal(stampAt(SIM_DAY * 365, epoch2024).dateKey, '2025-02-27', 'a leap year is 366 days long')

  for (const days of [-100000, -1, 0, 1, 19723, 100000]) {
    const d = civilFromDays(days)
    assert.equal(daysFromCivil(d.year, d.month, d.day), days, `${dateKeyOf(d)} round-trips`)
  }
  assert.equal(dateKeyOf({ year: 731, month: 2, day: 3 }), '0731-02-03', 'the year is padded to four')
})

test('a time before the epoch reads as an earlier date, not as hour −1', () => {
  const before = stampAt(-1)
  assert.equal(before.clockSeconds, '23:59:59')
  assert.equal(before.dateKey, '2025-12-31')
  assert.equal(before.dayIndex, -1)
  assert.equal(before.weekdayLabel, '周三', '2025-12-31 was a Wednesday')
})
