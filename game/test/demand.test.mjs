// The crowd's day (`sim/demand.ts`): the curve the station's arrivals are shaped by, the
// three knobs sheet 06's panel D puts in the player's hands, and the calendar coefficient
// §7.4's `calendar(dayOfYear)` is made of.
//
// The load-bearing test here is the **golden one**: `demandShape` at `DEFAULT_DEMAND` must
// equal the formula it replaced, value for value. The knobs were added under a running
// simulation, so the only proof that shipping them changed no crowd is that the default
// curve is the old curve — a tolerance would hide exactly the drift this exists to catch.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DAY_TYPE_FACTOR,
  DEFAULT_DEMAND,
  DEFAULT_DEMAND_INPUT,
  DEMAND_FLOOR,
  DEMAND_LIMITS,
  PERIOD_FACTOR,
  demandAt,
  demandRate,
  demandSeries,
  demandShape,
  hourOfDay,
  normalizeDemand,
} from '../src/sim/demand.ts'
import { DEFAULT_PEAKS, DEFAULT_SERVICE, SIM_DAY } from '../src/sim/constants.ts'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'

/** The curve this replaced, copied out of the world verbatim (`World.curve`, pre-knobs):
 *  `0.06 + gauss(8, 0.85) + 0.78 × gauss(18, 1.05) + 0.18 × gauss(12.5, 2.2)`. */
function oldShape(h) {
  const gauss = (mu, s) => Math.exp(-((h - mu) * (h - mu)) / (2 * s * s))
  return 0.06 + 1.0 * gauss(8, 0.85) + 0.78 * gauss(18, 1.05) + 0.18 * gauss(12.5, 2.2)
}

test('the default knobs are the curve they replaced, to the last bit', () => {
  for (let m = 0; m <= 24 * 60; m += 5) {
    const hour = m / 60
    assert.equal(demandShape(hour, DEFAULT_DEMAND), oldShape(hour), `at ${hour} h`)
  }
  assert.equal(DEFAULT_DEMAND.amPeak, 1, 'the morning peak is the reference height')
  assert.equal(DEFAULT_DEMAND.pmPeak, 0.78, 'and the evening one is 78% of it')
  assert.equal(DEFAULT_DEMAND.sharpness, 1, 'at the reference width')
})

test('the curve peaks where the reference day peaks, and never reaches zero', () => {
  assert.ok(demandShape(8) > demandShape(7.5))
  assert.ok(demandShape(8) > demandShape(9))
  assert.ok(demandShape(8) > demandShape(18), 'the morning peak is the taller one by default')
  assert.ok(demandShape(18) > demandShape(12.5), 'and the evening one beats the midday shelf')
  assert.ok(demandShape(3) > 0 && demandShape(3) < DEMAND_FLOOR + 0.001, 'the small hours sit on the floor')
  // A little over 1, not exactly: the floor and the midday shelf both reach the 08:00 apex.
  assert.ok(demandShape(8) > 1.06 && demandShape(8) < 1.1, `the morning apex is ${demandShape(8)}`)
})

test('a knob moves the curve it names, and only that one', () => {
  const taller = { ...DEFAULT_DEMAND, amPeak: 1.5 }
  assert.ok(demandShape(8, taller) > demandShape(8), '早高峰量 raises the 08:00 peak')
  assert.equal(demandShape(18, taller), demandShape(18), 'and leaves the 18:00 one alone')
  const evening = { ...DEFAULT_DEMAND, pmPeak: 1.5 }
  assert.ok(demandShape(18, evening) > demandShape(18))
  assert.equal(demandShape(8, evening), demandShape(8))
  // 波形陡峭度 narrows the day's waves — both peaks **and** the midday shelf between them,
  // which is why the apex is not perfectly fixed: it is what the shelf still contributes
  // there. What the knob really buys is the *fall-off*: an hour off the peak drops further.
  const steep = { ...DEFAULT_DEMAND, sharpness: 0.5 }
  const flat = { ...DEFAULT_DEMAND, sharpness: 2 }
  assert.ok(Math.abs(demandShape(8, steep) - demandShape(8)) < 0.03, 'the apex barely moves')
  const dropOff = (k) => demandShape(8, k) - demandShape(9, k)
  assert.ok(dropOff(steep) > dropOff(DEFAULT_DEMAND), 'a steep day falls away faster')
  assert.ok(dropOff(flat) < dropOff(DEFAULT_DEMAND), 'a flat one holds its crowd longer')
  assert.ok(demandShape(6, steep) < demandShape(6))
  assert.ok(demandShape(9, flat) > demandShape(9))
})

test('the period and the day type are the two scales on top of the shape', () => {
  assert.deepEqual(PERIOD_FACTOR, { peak: 1, offpeak: 0.6, late: 0.25 })
  assert.deepEqual(DAY_TYPE_FACTOR, { weekday: 1, saturday: 0.45, sunday: 0.35, holiday: 0.3 })
  assert.equal(demandAt(8, 'peak', 'weekday'), demandShape(8))
  assert.equal(demandAt(8, 'offpeak', 'weekday'), demandShape(8) * 0.6)
  assert.equal(demandAt(8, 'late', 'weekday'), demandShape(8) * 0.25)
  assert.equal(demandAt(8, 'peak', 'saturday'), demandShape(8) * 0.45)
  assert.equal(demandAt(8, 'peak', 'holiday'), demandShape(8) * 0.3)
  // A weekend peak is the weekday's peak scaled — this is the whole of §7.4's calendar
  // factor today; the *shape* difference (a later, longer holiday peak) is still to come.
  for (const dt of ['saturday', 'sunday', 'holiday']) {
    assert.equal(demandAt(18, 'peak', dt) / demandShape(18), DAY_TYPE_FACTOR[dt])
  }
})

test('the rate a caller gets is the shape, the period and the day, in one number', () => {
  // 07:27 on the shipped window: open, off-peak, a weekday.
  const morning = 7 * 3600 + 27 * 60
  assert.equal(demandRate(morning, 'weekday', DEFAULT_DEMAND_INPUT), demandShape(7.45) * 0.6)
  // 08:00 is inside the AM peak window, so the same shape runs at full weight.
  assert.equal(demandRate(8 * 3600, 'weekday', DEFAULT_DEMAND_INPUT), demandShape(8) * 1)
  // 02:00 is outside the operating hours: shut, so 夜间 whatever the shape says.
  assert.equal(demandRate(2 * 3600, 'weekday', DEFAULT_DEMAND_INPUT), demandShape(2) * 0.25)
  // 23:45 is shut too, and 18:00 on a Sunday is a Sunday.
  assert.equal(demandRate(23 * 3600 + 45 * 60, 'weekday', DEFAULT_DEMAND_INPUT), demandShape(23.75) * 0.25)
  assert.equal(demandRate(18 * 3600, 'sunday', DEFAULT_DEMAND_INPUT), demandShape(18) * 0.35)
  // The hour the clock prints and the hour the curve is read at are the same number.
  assert.equal(hourOfDay(8 * 3600 + 1800), 8.5)
  assert.equal(hourOfDay(-1800), 23.5, 'and a time before midnight reads as the day before')
  assert.equal(hourOfDay(30 * SIM_DAY + 3600), 1, 'and a wrapped one as its own hour')
})

test('a series is the whole day, sampled, and closes back onto its first point', () => {
  const series = demandSeries('weekday', DEFAULT_DEMAND_INPUT, 15)
  assert.equal(series.length, 97, '15-minute steps across 24 hours, both ends included')
  assert.equal(series[0], series[96], '00:00 and 24:00 are the same instant')
  assert.equal(series[32], demandRate(8 * 3600, 'weekday', DEFAULT_DEMAND_INPUT), '08:00 is index 32')
  assert.equal(demandSeries('weekday', DEFAULT_DEMAND_INPUT, 60).length, 25, 'and an hour a step is 25 points')
  assert.ok(Math.max(...series) > 1, 'the reference day does peak above the 100% baseline')
  assert.ok(Math.min(...series) > 0, 'and never touches zero: a shut night is thin, not empty')
  // The station's own windows move the line: shut hours are the 夜间 factor, and a peak
  // window drawn *inside* the operating hours takes the 高峰 weight with it.
  const night = demandSeries('weekday', DEFAULT_DEMAND_INPUT, 60)[3]
  const shut = demandSeries('weekday', { ...DEFAULT_DEMAND_INPUT, service: { from: 9 * 3600, to: 21 * 3600 } }, 60)[3]
  assert.equal(shut, night, '03:00 was already shut, so narrowing the window changed nothing there')
  const moved = demandSeries('weekday', { ...DEFAULT_DEMAND_INPUT, peaks: [{ from: 13 * 3600, to: 14 * 3600 }, DEFAULT_PEAKS[1]] }, 60)
  const noon = demandSeries('weekday', DEFAULT_DEMAND_INPUT, 60)
  assert.ok(moved[13] > noon[13], 'a 13:00 peak makes 13:00 peak service')
  assert.ok(Math.abs(moved[13] / noon[13] - 1 / 0.6) < 1e-9, 'which is exactly the peak-over-off-peak factor')
  // A peak drawn *outside* the window is still a shut station: `periodOf` asks the window
  // first, so no peak window can sneak service into hours the station is not open.
  const early = demandSeries('weekday', { ...DEFAULT_DEMAND_INPUT, peaks: [{ from: 3 * 3600, to: 4 * 3600 }, DEFAULT_PEAKS[1]] }, 60)
  assert.equal(early[3], night, '03:00 stays 夜间 under its own peak window')
})

test('a step that does not divide the day still closes the series', () => {
  // The chart draws the day as a loop, so the last sample has to be the first one
  // whatever the step: samples on a uniform grid make that a property of the
  // series rather than of 1440 being divisible by 7.
  for (const step of [7, 25, 90]) {
    const series = demandSeries('weekday', DEFAULT_DEMAND_INPUT, step)
    assert.equal(series[0], series[series.length - 1], `a ${step}-minute step closes onto 00:00`)
    assert.ok(series.length > 1, `and a ${step}-minute step draws a line`)
  }
  // A step that is not a positive finite number is the default, not an unbounded
  // loop: this function is pure, and a NaN step must not hang the worker.
  for (const step of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const series = demandSeries('weekday', DEFAULT_DEMAND_INPUT, step)
    assert.equal(series.length, 97, `a step of ${String(step)} is the default 15 minutes`)
  }
})

test('the knobs a document holds are clamped, rounded and defaulted', () => {
  assert.deepEqual(normalizeDemand(undefined), DEFAULT_DEMAND, 'no knobs at all is the reference day')
  assert.deepEqual(normalizeDemand({}), DEFAULT_DEMAND)
  assert.deepEqual(normalizeDemand({ amPeak: 0.5 }), { ...DEFAULT_DEMAND, amPeak: 0.5 }, 'a partial patch keeps the rest')
  const [lo, hi] = DEMAND_LIMITS.amPeak
  assert.equal(normalizeDemand({ amPeak: 99 }).amPeak, hi, 'a knob past its slider is the slider’s end')
  assert.equal(normalizeDemand({ amPeak: -99 }).amPeak, lo)
  assert.equal(normalizeDemand({ sharpness: 0 }).sharpness, DEMAND_LIMITS.sharpness[0], 'a zero width would be a spike')
  assert.equal(normalizeDemand({ pmPeak: 0.7833333 }).pmPeak, 0.78, 'two decimals: a slider’s own grain')
  assert.equal(normalizeDemand({ amPeak: 7 }).amPeak, DEMAND_LIMITS.amPeak[1], 'a huge number is the slider’s end')
  for (const junk of ['peak', null, [], true, Number.NaN]) {
    assert.deepEqual(normalizeDemand({ amPeak: junk }).amPeak, DEFAULT_DEMAND.amPeak, `${String(junk)} is not a knob`)
  }
  // What comes out is always what `demandShape` can run on: no NaN reaches the spawn.
  const knobs = normalizeDemand({ amPeak: Number.POSITIVE_INFINITY, pmPeak: Number.NaN, sharpness: 'wide' })
  assert.ok(Number.isFinite(demandShape(8, knobs)))
})

test('the default input is the shipped day', () => {
  assert.deepEqual(DEFAULT_DEMAND_INPUT, { service: DEFAULT_SERVICE, peaks: DEFAULT_PEAKS, knobs: DEFAULT_DEMAND })
})

/* --------------------------------------------------- the day, in a real crowd */
// Everything above this line is the curve as arithmetic. These three are the same
// day measured in *people*, because the way the document reaches the crowd is
// `World.rebuild` reading `data.service` / `data.peaks` / `data.demand` — a path
// that no pure-function test touches, and that nothing else would catch going
// dead (the shipped demo authors none of them, so the defaults would look fine).
//
// The station is run with **no line**: every arrival is then a street arrival, so
// the count is the arrival rate rather than the mix of street entries and
// train-borne passengers a service would add.

/** Everyone who entered the station in `ticks` ticks of a line-free day. */
function arrivals(patch, startSeconds, ticks) {
  const data = referenceStation()
  data.lines = []
  Object.assign(data, patch)
  const w = new World(data, data.seed)
  w.load(data, data.seed, startSeconds)
  for (let i = 0; i < ticks; i++) w.tickOnce()
  return w.pool.count + w.totals.exited
}

test('the authored day reaches the crowd: the knobs and the window are the arrival rate', () => {
  const midPeak = 8.5 * 3600
  const quiet = arrivals({ demand: { amPeak: 0 } }, midPeak, 300)
  const normal = arrivals({}, midPeak, 300)
  const busy = arrivals({ demand: { amPeak: 2.5 } }, midPeak, 300)
  assert.ok(quiet < normal / 2, `a silenced 早高峰 is a thinner crowd (${quiet} vs ${normal})`)
  assert.ok(busy > normal * 2, `a doubled 早高峰 is a busier one (${busy} vs ${normal})`)

  // The shipped window (06:30–23:30) is what an un-authored station runs, and the
  // wider window §6.5's shoulders are cut from changes nothing: every hour it adds
  // was already 夜间 service.
  const morning = 6.5 * 3600
  const shipped = arrivals({}, morning, 600)
  const explicit = arrivals({ service: { ...DEFAULT_SERVICE } }, morning, 600)
  const allDay = arrivals({ service: { from: 0, to: 23 * 3600 + 59 * 60 } }, morning, 600)
  assert.equal(explicit, shipped, 'the same window, written down, is the same crowd')
  assert.equal(allDay, shipped, 'and a station open all day is the day the shoulders already ran')
  // A station that opens at 09:00 does not: 06:30 is outside its window, so the
  // hours run at the 夜间 factor rather than at the 平峰 one.
  const late = arrivals({ service: { from: 9 * 3600, to: 21 * 3600 } }, morning, 600)
  assert.ok(late < shipped * 0.7, `a station shut at 06:30 runs a thin service (${late} vs ${shipped})`)
})

test('the calendar day scales the crowd, and the same weekday is the same crowd', () => {
  // Day 0 opens on a Thursday, so +2 days is the 周六 factor and +3 the 周日 one.
  const morning = 6.5 * 3600
  const weekday = arrivals({}, morning, 600)
  const saturday = arrivals({}, 2 * SIM_DAY + morning, 600)
  const sunday = arrivals({}, 3 * SIM_DAY + morning, 600)
  const near = (got, want) => Math.abs(got - want) <= Math.max(3, want * 0.3)
  assert.ok(near(saturday, weekday * DAY_TYPE_FACTOR.saturday), `周六 arrives at ${DAY_TYPE_FACTOR.saturday} of a weekday (${saturday} vs ${weekday})`)
  assert.ok(near(sunday, weekday * DAY_TYPE_FACTOR.sunday), `周日 at ${DAY_TYPE_FACTOR.sunday} (${sunday} vs ${weekday})`)
  assert.ok(saturday < weekday && sunday < saturday, 'and the weekend is thinner, Sunday thinnest')
  // A week later is the same weekday *and* the same RNG stream: the crowd is the
  // crowd, to the person (§7.6).
  assert.equal(arrivals({}, 7 * SIM_DAY + morning, 600), weekday, 'the same weekday a week later runs the same crowd')
})
