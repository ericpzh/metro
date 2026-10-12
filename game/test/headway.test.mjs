// The line running gear (`sim/headway.ts`): the fixed consist menu, the
// headway clamp, and the 分/秒 split the panel's inputs edit. Pure arithmetic,
// so it is pinned here rather than through the store (`line-edit` owns the
// panel half).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMATION_OPTIONS,
  joinHeadway,
  normalizeHeadway,
  normalizeHeadwayProfile,
  repairLineRunning,
  servedPerHour,
  serviceTrackCount,
  snapFormation,
  splitHeadway,
  trainAlightPerHourAt,
  trainAlightSeries,
  trainsPerHour,
} from '../src/sim/headway.ts'
import { DEFAULT_PEAKS, DEFAULT_SERVICE } from '../src/sim/constants.ts'

test('the consist menu is the fixed 2/3/4/6/8 grouping', () => {
  assert.deepEqual([...FORMATION_OPTIONS], [2, 3, 4, 6, 8])
})

test('snapFormation lands on the nearest menu entry, ties down', () => {
  assert.equal(snapFormation(2), 2)
  assert.equal(snapFormation(3), 3)
  assert.equal(snapFormation(4), 4)
  assert.equal(snapFormation(5), 4)
  assert.equal(snapFormation(7), 6)
  assert.equal(snapFormation(1), 2, 'a single car is not a consist')
  assert.equal(snapFormation(0), 2)
  assert.equal(snapFormation(99), 8)
  assert.equal(snapFormation(Number.NaN), 6)
})

test('headways clamp to whole seconds inside 60–1200', () => {
  assert.equal(normalizeHeadway(150, 150), 150)
  assert.equal(normalizeHeadway(90.4, 150), 90)
  assert.equal(normalizeHeadway(20, 150), 60, 'below the consist cycle clamps to the floor')
  assert.equal(normalizeHeadway(9999, 150), 1200)
  assert.equal(normalizeHeadway(Number.NaN, 240), 240, 'a bad value falls back leg by leg')
})

test('normalizeHeadwayProfile repairs leg by leg and keeps the untouched legs', () => {
  assert.deepEqual(normalizeHeadwayProfile({ peak: 90, offpeak: 300, late: 480 }), { peak: 90, offpeak: 300, late: 480 })
  assert.deepEqual(normalizeHeadwayProfile({ peak: 20 }, { peak: 150, offpeak: 240, late: 480 }), {
    peak: 60,
    offpeak: 240,
    late: 480,
  })
  assert.deepEqual(normalizeHeadwayProfile(undefined), { peak: 150, offpeak: 240, late: 480 })
})

test('the 分/秒 split round-trips through join', () => {
  assert.deepEqual(splitHeadway(150), { minutes: 2, seconds: 30 })
  assert.deepEqual(splitHeadway(240), { minutes: 4, seconds: 0 })
  assert.equal(joinHeadway(2, 30), 150)
  assert.equal(joinHeadway(0, 20), 60, 'the join clamps the same floor the store does')
  assert.equal(joinHeadway(99, 99), 1200)
})

test('the capacity readouts follow the interval', () => {
  assert.equal(trainsPerHour(150), 24)
  assert.equal(trainsPerHour(240), 15)
  assert.equal(servedPerHour(200, 150), 4800)
  assert.equal(servedPerHour(200, 300), 2400, 'doubling the headway halves the served demand')
})

test('repairLineRunning snaps a pre-chip save into the menu', () => {
  const line = {
    id: '1',
    name: '1号线',
    colour: '#fff',
    stock: 'B',
    cars: 7,
    power: 'third-rail',
    headwayProfile: { peak: 20, offpeak: 240, late: 480 },
    alightPerTrain: 200,
    terminus: 'through',
    direction: 'up',
    upTerminus: '',
    downTerminus: '',
    travelSign: 1,
    stations: [],
  }
  const repaired = repairLineRunning(line)
  assert.equal(repaired.cars, 6)
  assert.equal(repaired.headwayProfile.peak, 60)
  assert.equal(repaired.headwayProfile.offpeak, 240)
})

test('serviceTrackCount dispatches one consist per platform rail', () => {
  const rail = (id, line, extra = {}) => ({ id, type: 'track', cfg: { line, ...extra } })
  const modules = [rail('a', '1'), rail('b', '1'), rail('t', '1', { tunnel: true })]
  assert.equal(serviceTrackCount(modules, '1'), 2, 'tunnel runs are extensions, not berths')
  assert.equal(serviceTrackCount([rail('t', '2', { tunnel: true })], '2'), 1, 'a tunnel-only line still runs one train')
  assert.equal(serviceTrackCount([], '3'), 1, 'a line with no rails runs one line-level train')
})

test('the train curve is per-train alighting over the running headway, times the consists', () => {
  const line = { id: '1', alightPerTrain: 200, headwayProfile: { peak: 150, offpeak: 240, late: 480 } }
  const modules = [
    { id: 'a', type: 'track', cfg: { line: '1' } },
    { id: 'b', type: 'track', cfg: { line: '1' } },
  ]
  assert.equal(
    trainAlightPerHourAt(8 * 3600, [line], modules, DEFAULT_SERVICE, DEFAULT_PEAKS, true),
    9600,
    'two consists of 200 over a 150 s peak headway',
  )
  assert.equal(trainAlightPerHourAt(12 * 3600, [line], modules, DEFAULT_SERVICE, DEFAULT_PEAKS, true), 6000)
  assert.equal(trainAlightPerHourAt(2 * 3600, [line], modules, DEFAULT_SERVICE, DEFAULT_PEAKS, true), 3000)
  // A 非工作日 runs 平峰/离峰 only: 08:00 steps down to the offpeak headway.
  assert.equal(trainAlightPerHourAt(8 * 3600, [line], modules, DEFAULT_SERVICE, DEFAULT_PEAKS, false), 6000)
  const series = trainAlightSeries([line], modules, DEFAULT_SERVICE, DEFAULT_PEAKS, true)
  assert.equal(series.length, 97, 'one sample every 15 minutes, closing the loop')
  assert.equal(series[32], 9600, '08:00 rides the peak headway')
  assert.equal(series[48], 6000, '12:00 rides the offpeak headway')
  assert.equal(trainAlightSeries([line], modules, DEFAULT_SERVICE, DEFAULT_PEAKS, false)[32], 6000)
  assert.deepEqual(trainAlightSeries([], [], DEFAULT_SERVICE, DEFAULT_PEAKS, true), new Array(97).fill(0))
})
