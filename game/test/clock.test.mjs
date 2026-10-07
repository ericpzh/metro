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
  MONTH_GRID_HEADS,
  PERIOD_LABELS,
  WEEKDAY_INITIALS,
  WEEKDAY_LABELS,
  civilFromDays,
  clockHandAngles,
  clockTextOf,
  dateKeyOf,
  dayAt,
  dayTypeOf,
  daysFromCivil,
  daysInMonth,
  isOpenAt,
  monthGrid,
  normalizeCalendar,
  normalizePeaks,
  normalizeService,
  secondsOfClock,
  simTimeAtDate,
  SERVICE_LATEST,
  SERVICE_MIN_SPAN,
  stampAt,
  weekdayOf,
} from '../src/sim/clock.ts'
import { DEFAULT_PEAKS, DEFAULT_SERVICE, SIM_DAY } from '../src/sim/constants.ts'

const NOON = 12 * 3600

test('day 0 of the default calendar is 1月1日, whatever the run does after it', () => {
  const stamp = stampAt(0)
  assert.equal(stamp.readout, '1月1日 00:00:00 四', 'a fresh station opens on the new year — 2026-01-01 was a Thursday')
  assert.equal(stamp.dayIndex, 0)
  assert.equal(stamp.dateKey, '2026-01-01')
  assert.equal(stamp.dayType, 'holiday', 'and 元旦 is a statutory holiday: the shipped calendar says so')
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

test('the hands of an in-world 时钟 read the same instant the readout prints', () => {
  // The dial's hands are geometry turned every frame (`render/models/pieces/ClockModel.ts`),
  // and this is the derivation they turn by — so the clock on the wall cannot point at a
  // different minute from the 电视 plate beside it. Degrees clockwise from 12 o'clock, pinned
  // against the way a real face reads.
  assert.deepEqual(clockHandAngles(3 * 3600), { hour: 90, minute: 0 }, '3:00 — the hour hand on 3, the minute hand on 12')
  assert.deepEqual(clockHandAngles(9 * 3600), { hour: 270, minute: 0 }, '9:00 — a quarter turn the other way')
  assert.deepEqual(clockHandAngles(0), { hour: 0, minute: 0 }, 'midnight: both hands on 12')
  assert.deepEqual(clockHandAngles(NOON), { hour: 0, minute: 0 }, 'and noon is the same face twelve hours later')
  // **The hour hand carries the minutes**: at 6:30 it stands halfway between 6 and 7, which is
  // the whole difference between a clock face and a plate with two bars laid on it.
  assert.deepEqual(clockHandAngles(6 * 3600 + 30 * 60), { hour: 195, minute: 180 }, '6:30 — the hour hand half past the hour, the minute hand on 6')
  // The minute hand carries the seconds, **fractionally**: the scene sweeps the hands between
  // worker snapshots, so a floor in here would make the hand step once a sim second instead of
  // creeping the way a real movement's does.
  assert.equal(clockHandAngles(45 * 60 + 30).minute, 273, '45:30 is 273°, not 270°')
  assert.ok(Math.abs(clockHandAngles(45 * 60 + 30.5).minute - 273.05) < 1e-9, 'and half a second later it has moved a twentieth of a degree')
  // A time before the epoch reads as the hour it really is rather than as hour −1, the same
  // floor-modulo `clockTextOf` applies to a time of day.
  assert.deepEqual(clockHandAngles(-3600), { hour: 330, minute: 0 }, 'an hour before day 0 is 11 o’clock')
  // The last second of the day is a hair short of 12 on both hands, and 12:00 is 12:00 again.
  const last = clockHandAngles(SIM_DAY - 1)
  assert.ok(last.hour > 359.9 && last.hour <= 360, `the hour hand ends the day at ${last.hour}`)
  assert.ok(last.minute > 359.8 && last.minute <= 360, `and the minute hand ends it at ${last.minute}`)
  assert.deepEqual(clockHandAngles(SIM_DAY), clockHandAngles(0), 'which is where the next day starts')
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
  // 2026-01-10 is a Saturday and 2026-01-11 a Sunday: 9 and 10 days after the epoch. (The first
  // weekend of the year is inside the 元旦 holiday, which is why the fixture starts here.)
  const sat = stampAt(9 * SIM_DAY + 10 * 3600)
  const sun = stampAt(10 * SIM_DAY + 10 * 3600)
  assert.equal(sat.weekdayLabel, '周六')
  assert.equal(sat.weekdayInitial, '六', 'which is the 六 a Chinese timetable column prints')
  assert.equal(sat.dayType, 'saturday')
  assert.equal(DAY_TYPE_LABELS[sat.dayType], '周六')
  assert.equal(sun.weekdayLabel, '周日')
  assert.equal(sun.dayType, 'sunday')
  assert.equal(sun.dateKey, '2026-01-11')
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
  assert.equal(dayTypeOf(6, '2026-02-14', [], ['2026-02-14']), 'weekday', 'and a 调休 Saturday is a 工作日')
  assert.equal(dayTypeOf(6, '2026-02-14', ['2026-02-14'], ['2026-02-14']), 'holiday', 'a date on both lists is a holiday')
})

/** A stamp for a date key, read off the shipped epoch: the tests' own way in. */
function at(key, hour = 10) {
  const [y, m, d] = key.split('-').map(Number)
  return stampAt((daysFromCivil(y, m, d) - daysFromCivil(2026, 1, 1)) * SIM_DAY + hour * 3600)
}

test('the shipped calendar is the 2026 arrangement, holidays and 调休 both', () => {
  // 国务院办公厅 国办发明电〔2025〕7号: 元旦 01-01…01-03 (01-04 上班), 春节 02-15…02-23 (02-14,
  // 02-28 上班), 清明节 04-04…04-06, 劳动节 05-01…05-05 (05-09 上班), 端午节 06-19…06-21,
  // 中秋节 09-25…09-27, 国庆节 10-01…10-07 (09-20, 10-10 上班).
  assert.deepEqual(DEFAULT_CALENDAR.epoch, { year: 2026, month: 1, day: 1 })
  assert.equal(DEFAULT_CALENDAR.holidays.length, 3 + 9 + 3 + 5 + 3 + 3 + 7, 'every 放假 date')
  assert.equal(DEFAULT_CALENDAR.workdays.length, 6, 'every 调休 上班 date')
  assert.equal(at('2026-01-03').dayType, 'holiday', '元旦 runs into the Saturday')
  assert.equal(at('2026-01-04').dayType, 'weekday', 'and the Sunday after it is a 上班 day')
  assert.equal(at('2026-02-17').dayType, 'holiday', '春节初一')
  assert.equal(at('2026-02-28').dayType, 'weekday', 'a 上班 Saturday at the end of the festival')
  assert.equal(at('2026-05-01').dayType, 'holiday')
  assert.equal(at('2026-10-07').dayType, 'holiday')
  assert.equal(at('2026-10-10').dayType, 'weekday', 'and the Saturday after 国庆 is worked')
  assert.equal(at('2026-10-11').dayType, 'sunday', 'while the Sunday after that is a Sunday again')
  assert.equal(at('2026-03-07').dayType, 'saturday', 'a plain weekend in a month with no holiday')
  // Every key is a real 2026 date, and no date is on both lists.
  for (const key of [...DEFAULT_CALENDAR.holidays, ...DEFAULT_CALENDAR.workdays]) {
    assert.match(key, /^2026-\d{2}-\d{2}$/, `${key} is a date key`)
    const [y, m, d] = key.split('-').map(Number)
    assert.ok(d >= 1 && d <= daysInMonth(y, m), `${key} is a day February has`)
  }
  for (const key of DEFAULT_CALENDAR.workdays) assert.ok(!DEFAULT_CALENDAR.holidays.includes(key))
})

test('weekdayOf and daysInMonth are the arithmetic the grid stands on', () => {
  assert.equal(weekdayOf({ year: 2026, month: 1, day: 1 }), 4, '2026-01-01 was a Thursday')
  assert.equal(weekdayOf({ year: 2026, month: 1, day: 4 }), 0, 'and the 4th a Sunday')
  assert.equal(weekdayOf({ year: 2024, month: 2, day: 29 }), 4, '2024-02-29 was a Thursday')
  assert.equal(daysInMonth(2026, 2), 28, '2026 is not a leap year')
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(daysInMonth(2000, 2), 29, '2000 is, under the century rule')
  assert.equal(daysInMonth(1900, 2), 28, 'and 1900 is not')
  assert.equal(daysInMonth(2026, 1), 31)
  assert.equal(daysInMonth(2026, 12), 31)
  assert.equal(daysInMonth(2026, 4), 30)
})

test('a month grid is whole Monday-first weeks, with each date’s day type on its cell', () => {
  const jan = monthGrid(2026, 1)
  assert.equal(jan.length, 5, 'January 2026 fits five weeks')
  assert.ok(jan.every((w) => w.length === 7), 'every week is seven cells')
  assert.deepEqual(jan[0].slice(0, 3), [null, null, null], '2026-01-01 is a Thursday, so three cells lead')
  assert.equal(jan[0][3].dateKey, '2026-01-01')
  assert.equal(jan[0][3].head, '四', 'and it wears the Thursday column head')
  assert.equal(jan.flat().filter(Boolean).length, 31)
  assert.equal(monthGrid(2026, 2).flat().filter(Boolean).length, 28, 'February 2026 is 28 days')
  assert.equal(monthGrid(2024, 2).flat().filter(Boolean).length, 29, 'and February 2024 is 29')
  // The day types are already on the cells — that is what the calendar view paints.
  const cell = (key) => jan.flat().find((c) => c && c.dateKey === key)
  assert.equal(cell('2026-01-01').dayType, 'holiday')
  assert.equal(cell('2026-01-04').dayType, 'weekday', 'a 调休 Sunday reads as a work day')
  assert.equal(cell('2026-01-04').weekday, 0, 'on a Sunday')
  assert.equal(cell('2026-01-10').dayType, 'saturday')
  // A Monday-first grid puts Sunday last: the head is the weekday shifted, not the weekday.
  for (const c of jan.flat()) {
    if (!c) continue
    assert.equal(c.head, MONTH_GRID_HEADS[(c.weekday + 6) % 7], `${c.dateKey} sits in the right column`)
  }
})

test('a calendar the day cannot hold is repaired, not refused', () => {
  assert.deepEqual(normalizeCalendar(undefined), DEFAULT_CALENDAR, 'no calendar at all is the shipped one')
  assert.deepEqual(normalizeCalendar({}), DEFAULT_CALENDAR, 'and neither is an empty object')
  assert.deepEqual(normalizeCalendar({ epoch: { year: 2026, month: 2, day: 30 } }).epoch, { year: 2026, month: 2, day: 28 }, 'February has no 30th')
  assert.deepEqual(normalizeCalendar({ epoch: { year: 2026, month: 13, day: 1 } }).epoch, { year: 2026, month: 12, day: 1 })
  assert.deepEqual(normalizeCalendar({ epoch: { year: 0, month: 0, day: 0 } }).epoch, { year: 1970, month: 1, day: 1 })
  assert.deepEqual(normalizeCalendar({ epoch: { year: 'x', month: null, day: Number.NaN } }).epoch, DEFAULT_CALENDAR.epoch)
  // A list that is there is the player's own: junk keys are dropped rather than matched to
  // nothing, and a date on both lists is a holiday.
  const messy = normalizeCalendar({
    epoch: DEFAULT_CALENDAR.epoch,
    holidays: ['2026-01-01', 'not-a-date', 42, '2026-1-1', null],
    workdays: ['2026-01-01', '2026-01-04'],
  })
  assert.deepEqual(messy.holidays, ['2026-01-01'])
  assert.deepEqual(messy.workdays, ['2026-01-04'])
  assert.deepEqual(normalizeCalendar({ epoch: DEFAULT_CALENDAR.epoch, holidays: 'none' }).holidays, [], 'a list that is not a list is empty')
  assert.deepEqual(normalizeCalendar({ epoch: DEFAULT_CALENDAR.epoch }).holidays, DEFAULT_CALENDAR.holidays, 'but an absent one is the shipped list')
  // What comes out is a calendar the sim can run on, whatever went in.
  const junk = normalizeCalendar({ epoch: 'yesterday', holidays: {}, workdays: 7 })
  assert.equal(at('2026-01-01').dayType, 'holiday')
  assert.deepEqual(junk.epoch, DEFAULT_CALENDAR.epoch)
  assert.deepEqual(junk.holidays, [], 'an object where a list belongs is an empty list')
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

test('the peak pair is repaired in place, and held in order', () => {
  assert.deepEqual(normalizePeaks(undefined), DEFAULT_PEAKS, 'no peaks at all is the default pair')
  assert.deepEqual(normalizePeaks([]), DEFAULT_PEAKS)
  // A half-edited pair: the first window is kept, the missing second falls back — and the default
  // evening peak already starts after the morning one ends, so nothing moves.
  assert.deepEqual(normalizePeaks([{ from: 10 * 3600, to: 11 * 3600 }]), [
    { from: 10 * 3600, to: 11 * 3600 },
    DEFAULT_PEAKS[1],
  ])
  // **早高峰 ends no later than 晚高峰 begins.** An overlapping pair is not refused and not sorted:
  // the evening peak is pushed to start where the morning one ends, which is the same wall the
  // chart's grips apply while they are dragged.
  assert.deepEqual(normalizePeaks([{ from: 7 * 3600, to: 18 * 3600 }, { from: 17 * 3600, to: 19 * 3600 }]), [
    { from: 7 * 3600, to: 18 * 3600 },
    { from: 18 * 3600, to: 19 * 3600 },
  ])
  // A crossed pair (the evening entirely inside the morning) slides the same way.
  assert.deepEqual(normalizePeaks([{ from: 8 * 3600, to: 20 * 3600 }, { from: 9 * 3600, to: 10 * 3600 }]), [
    { from: 8 * 3600, to: 20 * 3600 },
    { from: 20 * 3600, to: 20 * 3600 + SERVICE_MIN_SPAN },
  ])
  // A morning peak that runs to the end of the day leaves the evening the last quarter hour
  // rather than nowhere: the pair always fits inside one day.
  const squeezed = normalizePeaks([{ from: 6 * 3600, to: 23 * 3600 + 59 * 60 }, { from: 17 * 3600, to: 19 * 3600 }])
  assert.equal(squeezed[0].to, SERVICE_LATEST - SERVICE_MIN_SPAN)
  assert.equal(squeezed[1].from, SERVICE_LATEST - SERVICE_MIN_SPAN)
  assert.equal(squeezed[1].to, SERVICE_LATEST)
  // The invariant holds for every pair the repair is handed, junk included.
  const cases = [
    [{ from: 0, to: 0 }, { from: 0, to: 0 }],
    [{ from: 99 * 3600, to: 0 }, { from: 0, to: 99 * 3600 }],
    ['morning', 'evening'],
    [undefined, undefined],
    [{ from: 12 * 3600, to: 12 * 3600 }, { from: 12 * 3600, to: 12 * 3600 }],
  ]
  for (const raw of cases) {
    const [a, b] = normalizePeaks(raw)
    assert.ok(a.to <= b.from, `the morning ends before the evening begins (${a.to} ≤ ${b.from})`)
    assert.ok(a.to - a.from >= SERVICE_MIN_SPAN, 'and every window is at least a quarter hour')
    assert.ok(b.to - b.from >= SERVICE_MIN_SPAN)
    assert.ok(a.from >= 0 && b.to <= SERVICE_LATEST, 'inside the day')
  }
  // Each window carries the same span repair, junk included.
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

test('the calendar pick is a seek: a date and a time of day become sim seconds', () => {
  const epoch = DEFAULT_CALENDAR.epoch // 2026-01-01
  // Forward: 9 days on is 2026-01-10, and the time of day is carried over untouched.
  const saturday = simTimeAtDate({ year: 2026, month: 1, day: 10 }, epoch, 7 * 3600 + 15 * 60)
  assert.equal(saturday, 9 * SIM_DAY + 7 * 3600 + 15 * 60)
  assert.equal(dayAt(saturday).dateKey, '2026-01-10', 'and the clock stands on that date')
  assert.equal(stampAt(saturday).clockSeconds, '07:15:00', 'at the time of day it was asked for')
  assert.equal(dayAt(saturday).dayType, 'saturday', 'which is how a Saturday gets run')
  // Backwards, onto a date before the epoch: a negative sim time is a real date, not a failure.
  const before = simTimeAtDate({ year: 2025, month: 12, day: 25 }, epoch, 12 * 3600)
  assert.ok(before < 0)
  assert.equal(dayAt(before).dateKey, '2025-12-25')
  // Day 0 is the epoch at the same time of day, and a leap day is a day like any other.
  assert.equal(simTimeAtDate(epoch, epoch, 3600), 3600)
  const leap = simTimeAtDate({ year: 2024, month: 2, day: 29 }, { year: 2024, month: 2, day: 28 }, 0)
  assert.equal(leap, SIM_DAY)
})
