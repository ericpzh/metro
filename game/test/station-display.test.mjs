import test from 'node:test'
import assert from 'node:assert/strict'
import { STATION_PLATE, TV_POSTER_RECT, drawStationDisplay, stationDisplayLayout, tvLineStatus } from '../src/render/stationDisplay.ts'
import { TRAIN_APPROACH_S } from '../src/sim/constants.ts'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

const line = { id: '5', name: '5号线', colour: '#c8102e', direction: 'up', upTerminus: '文冲', downTerminus: '滘口' }
const service = (over = {}) => ({ lineId: '5', trackId: 'up', direction: 'up', x: 0, y: 0, z: -8, fx: 1, fy: 0, halfLength: 60, arrivals: [{seconds: 5, atPlatform: false}, {seconds: 150, atPlatform: false}, {seconds: 300, atPlatform: false}], ...over })

test('TV converts sim seconds to minutes and prints three separately stacked cards', () => {
  const status = tvLineStatus([line], [service()], [40, 2, -8])
  assert.deepEqual(status.arrivals.map((a) => a.minutes), [1, 3, 5], '150 seconds is 3 displayed minutes, never 150 minutes')
  const { g, ops } = stubCanvas(STATION_PLATE.width, STATION_PLATE.height)
  drawStationDisplay(g, status, '动物园', '09:34', '8月20日')
  const texts = ops.words.map((w) => w.text)
  for (const text of ['即将到站', '3 分钟', '5 分钟', '09:34', '8月20日', '动物园']) assert.ok(texts.includes(text), text)
  const layout = stationDisplayLayout()
  for (let i = 0; i < 3; i++) {
    const words = ops.words.filter((w) => w.y >= layout.cards[i].y && w.y < layout.cards[i].y + layout.cards[i].h)
    assert.equal(words.length, 4, 'Chinese label, English label, destination and countdown have their own lines')
    assert.equal(new Set(words.map((w) => w.y)).size, 4)
  }
})

test('nearest track selects its direction, works along rotated rails and separates floors', () => {
  const up = service({ x: 0, y: 0, fx: 0, fy: 1 })
  const down = service({ x: 5, y: 0, fx: 0, fy: 1, direction: 'down' })
  const otherFloor = service({ x: 4, z: 0 })
  assert.equal(tvLineStatus([line], [up, down, otherFloor], [4, 50, -8]).terminus, '滘口')
  assert.equal(tvLineStatus([line], [up, down], [1, 50, -8]).terminus, '文冲')
})

test('no service publishes no invented countdown or arrival claim', () => {
  const status = tvLineStatus([line], [], [0, 0, 0])
  assert.deepEqual(status.arrivals, [])
  const { g, ops } = stubCanvas()
  drawStationDisplay(g, status, '动物园', '06:30')
  assert.equal(ops.words.filter((w) => w.text === '暂无班次').length, 3)
  assert.equal(tvLineStatus([], [], [0, 0, 0]), null)
})

test('a plate with no line still prints the station under three empty cards', () => {
  // `tvLineStatus` answers null with no lines, but the plate still has to draw:
  // three 暂无线路 cards, three 暂无班次 countdowns, and the station card intact.
  const { g, ops } = stubCanvas()
  drawStationDisplay(g, null, '动物园', '06:30')
  assert.equal(ops.words.filter((w) => w.text === '暂无线路').length, 3, 'one per card, never a blank panel')
  assert.equal(ops.words.filter((w) => w.text === '暂无班次').length, 3)
  assert.ok(ops.words.some((w) => w.text === '动物园'), 'the station card survives the missing line')
})

test('the approach window ends exactly at TRAIN_APPROACH_S', () => {
  // Six seconds out the train is arriving; one second later it is a countdown.
  // The edge is inclusive, so a train on it never flickers between the two.
  assert.equal(TRAIN_APPROACH_S, 6, 'a six-second platform approach, not a minute')
  const at = (seconds, atPlatform = false) => service({ arrivals: [{ seconds, atPlatform }, { seconds: 150, atPlatform: false }, { seconds: 300, atPlatform: false }] })
  const edge = tvLineStatus([line], [at(TRAIN_APPROACH_S)], [0, 0, -8])
  assert.equal(edge.arrivals[0].arriving, true, 'on the window edge counts as arriving')
  const past = tvLineStatus([line], [at(TRAIN_APPROACH_S + 1)], [0, 0, -8])
  assert.equal(past.arrivals[0].arriving, false, 'one second past the edge is a countdown')
  assert.equal(past.arrivals[0].minutes, 1, 'seven seconds ceil to one displayed minute')
  const { g, ops } = stubCanvas()
  drawStationDisplay(g, edge, '动物园', '06:30')
  assert.ok(ops.words.some((w) => w.text === '即将到站'), 'the edge card prints the arriving word')
})

test('reference layout has a quarter-width column, wide video and a clock below the video', () => {
  const { poster, cards, strip, clock, station } = stationDisplayLayout()
  assert.equal(TV_POSTER_RECT.x, 0.25)
  assert.equal(poster.w / poster.h, (960 * 0.75) / (540 * 0.82))
  for (const card of cards) assert.ok(card.x + card.w < poster.x)
  assert.ok(poster.y + poster.h < strip.y)
  assert.equal(clock.y, strip.y)
  assert.equal(station.y + station.h <= STATION_PLATE.height, true)
})

test('worker service forecasts match actual berth times without altering world state', () => {
  const world = new World(scenarioStation(), 99)
  const before = JSON.stringify(world.snapshot())
  const forecast = world.trainServices()[0]
  assert.ok(forecast)
  assert.equal(JSON.stringify(world.snapshot()), before, 'reading the timetable never advances time or RNG')
  const expected = forecast.arrivals.map((a) => world.simTime + a.seconds)
  const actual = []
  while (actual.length < 3 && world.tick < 1000) {
    world.tickOnce()
    for (const train of world.trains) if (train.state === 'berth' && train.t === 0) actual.push(world.simTime)
  }
  assert.deepEqual(actual, expected, 'all three published arrivals match the dispatcher, not nominal speed estimates')
  const berthed = world.trainServices()[0]
  assert.equal(berthed.arrivals[0].atPlatform, true)
  assert.equal(berthed.arrivals[0].seconds, 0)
})

for (const headways of [{peak: 20, offpeak: 20, late: 20}, {peak: 150, offpeak: 70, late: 90}]) {
  test(`arrival forecast follows occupied-track delays and period changes: ${JSON.stringify(headways)}`, () => {
    const data = scenarioStation()
    data.lines[0].headwayProfile = headways
    const world = new World(data, 99)
    world.seek(7 * 3600 + 29 * 60 + 50)
    world.tickOnce()
    const expected = world.trainServices()[0].arrivals.map((a) => world.simTime + a.seconds)
    const actual = []
    while (actual.length < 3 && world.tick < 600) {
      world.tickOnce()
      for (const train of world.trains) if (train.state === 'berth' && train.t === 0) actual.push(world.simTime)
    }
    assert.deepEqual(actual, expected)
    world.seek(world.simTime + 3600)
    const future = world.trainServices()[0].arrivals
    assert.equal(future.length, 3, 'a clock seek rebuilds future dispatch information')
    assert.ok(future.every((a) => a.seconds >= 0))
  })
}
