// The run's own record (§8.1, the 数据 window): the collector that samples the
// counters once a minute, the world's wiring of it (a load, a restart and a seek all
// start it over), the reader the charts draw their lines from, and the store's own
// append. The silent failure this pins is a record that quietly drifts: a sample per
// *tick* (a chart of one long minute), a first sample whose per-minute columns read as
// the whole run so far, or an append that lands at the wrong index after a reset.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SIM_TIME, LOS_ORDER } from '../src/sim/constants.ts'
import {
  History,
  HISTORY_INDEX,
  HISTORY_STRIDE,
  SAMPLE_SECONDS,
  historySeries,
} from '../src/sim/history.ts'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { useStore } from '../src/app/store.ts'
import { axisTicks, losAxis, losValue, niceMax } from '../src/app/windows/charts/scale.ts'

/** One minute's reading, with everything defaulting to the calm station. */
function reading(simTime, over = {}) {
  return {
    simTime,
    population: 0,
    crowdLos: 'A',
    gateQueue: 0,
    escalatorQueue: 0,
    liftQueue: 0,
    doorQueue: 0,
    boarded: 0,
    exited: 0,
    leftBehind: 0,
    ...over,
  }
}

/** The interleaved buffer the worker posts, as the app would receive it. */
function bufferOf(samples) {
  const out = new Float32Array(samples.length * HISTORY_STRIDE)
  samples.forEach((sample, i) => {
    for (const [column, value] of Object.entries(sample)) out[i * HISTORY_STRIDE + HISTORY_INDEX[column]] = value
  })
  return out
}

test('the record takes one sample a minute, not one a tick', () => {
  const history = new History(0)
  history.reset(1000)
  for (let t = 1001; t <= 1300; t++) history.sample(reading(t))
  // The anchor is the run's own first tick, then a minute at a time: 1001, 1061, …
  const times = historySeries(history.run(0), 'simTime', history.count)
  assert.deepEqual(times, [1001, 1061, 1121, 1181, 1241], 'the sample grid is not one minute wide')
  assert.equal(history.step, SAMPLE_SECONDS)
})

test('a sample carries the counters, the class as its order, and its own minute', () => {
  const history = new History(0)
  history.reset(0)
  history.sample(reading(1, { population: 40, crowdLos: 'C', gateQueue: 3, boarded: 12, exited: 7 }))
  // The first sample is a **baseline**: a seek keeps the counters, so a delta measured
  // from zero would read the whole run as one minute's flow.
  history.sample(reading(61, { population: 55, crowdLos: 'D', gateQueue: 5, boarded: 20, exited: 9 }))
  history.sample(reading(121, { population: 30, crowdLos: 'B', gateQueue: 1, boarded: 26, exited: 14 }))

  const values = history.run(0)
  const column = (name) => historySeries(values, name, history.count)
  assert.equal(history.count, 3)
  assert.deepEqual(column('population'), [40, 55, 30])
  assert.deepEqual(column('crowdLos'), [2, 3, 1], 'the letter is stored as its LOS order, A = 0')
  assert.deepEqual(column('gateQueue'), [3, 5, 1])
  assert.deepEqual(column('boarded'), [12, 20, 26])
  assert.deepEqual(column('exited'), [7, 9, 14])
  assert.deepEqual(column('boardedPerMin'), [0, 8, 6])
  assert.deepEqual(column('exitedPerMin'), [0, 2, 5])
  assert.deepEqual(column('leftBehindPerMin'), [0, 0, 0])
})

test('the counter columns only ever climb, and every minute is a slice of them', () => {
  const history = new History(0)
  history.reset(0)
  for (let minute = 0; minute < 40; minute++) {
    history.sample(
      reading(1 + minute * 60, {
        boarded: minute * 7,
        exited: minute * 5,
        leftBehind: minute > 20 ? minute - 20 : 0,
      }),
    )
  }
  const values = history.run(0)
  const column = (name) => historySeries(values, name, history.count)
  const boarded = column('boarded')
  const flow = column('boardedPerMin')
  for (let i = 1; i < history.count; i++) {
    assert.ok(flow[i] >= 0, `minute ${i} lost boardings: ${flow[i]}`)
    assert.ok(boarded[i] >= boarded[i - 1], `the total fell at minute ${i}`)
    assert.ok(flow[i] <= boarded[i], `one minute's flow ${flow[i]} exceeds the total ${boarded[i]}`)
  }
  assert.equal(flow.reduce((sum, v) => sum + v, 0), boarded[history.count - 1], 'the minutes do not add up to the total')
})

test('reset drops the record, so a restart or a seek cannot splice two runs', () => {
  const history = new History(0)
  history.reset(0)
  for (let t = 1; t <= 300; t++) history.sample(reading(t))
  assert.ok(history.count > 1)
  history.reset(9000)
  assert.equal(history.count, 0)
  history.sample(reading(9001, { boarded: 900 }))
  // The new run's first sample is its own baseline again, not a minute spanning the jump.
  assert.deepEqual(historySeries(history.run(0), 'boardedPerMin', history.count), [0])
})

test('the world records its own run and starts the record over on load, restart and seek', () => {
  const w = new World(scenarioStation(), 99)
  assert.equal(w.history.count, 0, 'a fresh world opened with a record already in it')
  // Every tick is remembered as it stood: the sample a minute names must be that
  // tick's own reading, not the reading of the tick it happened to be written on.
  const seen = []
  for (let i = 0; i < 121; i++) seen.push(w.tickOnce().population)
  assert.equal(w.history.count, 3, 'two ticks per minute should not be two samples')
  const held = w.history.run(0)
  const times = historySeries(held, 'simTime', w.history.count)
  const sampled = historySeries(held, 'population', w.history.count)
  assert.deepEqual(times, [DEFAULT_SIM_TIME + 1, DEFAULT_SIM_TIME + 61, DEFAULT_SIM_TIME + 121])
  times.forEach((time, i) => {
    assert.equal(sampled[i], seen[Math.round(time - DEFAULT_SIM_TIME) - 1], `sample ${i} is not the tick it names`)
  })

  w.restart()
  assert.equal(w.history.count, 0, 'a restart kept the old run in the record')
  for (let i = 0; i < 60; i++) w.tickOnce()
  assert.equal(w.history.count, 1)

  const jumped = w.simTime + 3600
  w.seek(jumped)
  assert.equal(w.history.count, 0, 'a seek kept the old day in the record')
  w.tickOnce()
  assert.equal(w.history.run(0)[HISTORY_INDEX.simTime], jumped + 1, 'the record did not restart at the seek')

  w.load(scenarioStation(), 7, DEFAULT_SIM_TIME + 7200)
  assert.equal(w.history.count, 0, 'a load kept the previous station in the record')
})

test('the app appends the posted record and replaces it on a reset', () => {
  const store = useStore.getState()
  store.setHistory({ values: bufferOf([reading(100, { boarded: 4 })]), from: 0, reset: true, start: 100, step: 60 })
  assert.deepEqual(
    { count: useStore.getState().history.count, start: useStore.getState().history.start },
    { count: 1, start: 100 },
  )

  // One more minute: appended at the index the worker named, not at the end of the buffer.
  store.setHistory({ values: bufferOf([reading(160, { boarded: 9 })]), from: 1, reset: false, start: 100, step: 60 })
  let held = useStore.getState().history
  assert.equal(held.count, 2)
  assert.deepEqual(historySeries(held.values, 'simTime', held.count), [100, 160])
  assert.deepEqual(historySeries(held.values, 'boarded', held.count), [4, 9])

  // A tick with no new sample is a message with no samples: nothing changes.
  const before = useStore.getState().history
  store.setHistory({ values: new Float32Array(0), from: 2, reset: false, start: 100, step: 60 })
  assert.equal(useStore.getState().history, before, 'an empty update still wrote to the store')

  // A long run grows the buffer past its first allocation without moving an index.
  const many = Array.from({ length: 200 }, (_, i) => reading(220 + i * 60, { population: i }))
  store.setHistory({ values: bufferOf(many), from: 2, reset: false, start: 100, step: 60 })
  held = useStore.getState().history
  assert.equal(held.count, 202)
  assert.deepEqual(historySeries(held.values, 'simTime', 3), [100, 160, 220], 'the earlier samples did not survive the growth')

  // And a reset replaces the lot: the old run is not kept behind the new one.
  store.setHistory({ values: bufferOf([reading(9000)]), from: 0, reset: true, start: 9000, step: 60 })
  held = useStore.getState().history
  assert.equal(held.count, 1)
  assert.deepEqual(historySeries(held.values, 'simTime', held.count), [9000])
})

test('the chart axis tops out on a round number above the data', () => {
  assert.equal(niceMax(0), 1, 'an empty series still needs an axis')
  assert.equal(niceMax(1), 1)
  assert.equal(niceMax(1.5), 2)
  assert.equal(niceMax(5), 5)
  assert.equal(niceMax(5.1), 10)
  assert.equal(niceMax(1400), 2000)
  assert.equal(niceMax(0.02), 0.02)
  assert.deepEqual(axisTicks(10), [0, 2.5, 5, 7.5, 10])
})

test('the crowd-level axis is drawn upside down: A at the top, F at the bottom', () => {
  // A sample stores the letter's own order (A = 0, the record's own column), while the
  // plot is y-up — so the class axis is the one that has to be flipped, and the
  // gridlines must be the letters, bottom to top, or a crowded station would draw as a
  // line climbing out of the bottom of the chart.
  assert.deepEqual(
    losAxis(['A', 'B', 'C', 'D', 'E', 'F']),
    [
      { value: 0, label: 'F' },
      { value: 1, label: 'E' },
      { value: 2, label: 'D' },
      { value: 3, label: 'C' },
      { value: 4, label: 'B' },
      { value: 5, label: 'A' },
    ],
  )
  assert.equal(losValue(0, LOS_ORDER), 5, 'A draws at the top')
  assert.equal(losValue(5, LOS_ORDER), 0, 'F draws at the bottom')
  assert.deepEqual(losAxis(LOS_ORDER).map((t) => t.label), ['F', 'E', 'D', 'C', 'B', 'A'])
})
