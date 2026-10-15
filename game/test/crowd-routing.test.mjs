import test from 'node:test'
import assert from 'node:assert/strict'
import { crowdedWalkEnd, spreadWalkRoute } from '../src/sim/crowdRouting.ts'
import { CROWD_REPLAN_PER_TICK } from '../src/sim/constants.ts'
import { buildGraph, PathFinder } from '../src/sim/station.ts'
import { World } from '../src/sim/world.ts'

const needs = { stepFree: false, luggage: false }
function station(width = 9) {
  const cells = []
  for (let x = 0; x <= 20; x++) for (let y = 0; y < width; y++) cells.push({ x, y, z: 4, fill: 'solid', zone: 'unpaid' })
  return { name: 'corridor', seed: 1, cells, modules: [], lines: [] }
}
function wallRoute(g) {
  return Int32Array.from({ length: 21 }, (_, x) => g.nodeIndex.get(`${x},0,4`))
}

test('a committed wall route spreads into clear floor and retains its itinerary tail', () => {
  const g = buildGraph(station()), finder = new PathFinder(g), route = wallRoute(g)
  const before = route.slice()
  assert.equal(crowdedWalkEnd(finder, route, 0), 0, 'empty floor needs no new search')
  for (let x = 3; x <= 6; x++) finder.congestion[g.nodeIndex.get(`${x},0,4`)] = 10
  const end = crowdedWalkEnd(finder, route, 0)
  assert.equal(end, 8, 'the walking decision looks eight metres ahead')
  const spread = spreadWalkRoute(finder, route, 0, end, needs)
  assert.ok(spread)
  assert.ok([...spread].some(n => g.nodeY[n] > 0.5), 'the route leaves the crowded wall')
  assert.deepEqual(spread.slice(-12), route.slice(9), 'the rest of the trip stays intact')
  assert.deepEqual(route, before, 'other passengers retain their shared cached route')
  finder.congestion.fill(0)
  assert.equal(spreadWalkRoute(finder, route, 0, end, needs), null, 'equal routes do not trigger switching')
})

test('crowding remains passable in a narrow corridor', () => {
  const g = buildGraph(station(1)), finder = new PathFinder(g), route = wallRoute(g)
  finder.congestion.fill(12)
  assert.equal(spreadWalkRoute(finder, route, 0, 8, needs), null, 'the only route remains valid without a pointless switch')
})

test('walking reconsideration stops before a service decision', () => {
  const data = station()
  data.modules.push({ id: 'gate', type: 'gate', x: 5, y: 0, z: 4, cfg: { dir: 'both' } })
  const g = buildGraph(data), finder = new PathFinder(g), route = wallRoute(g)
  finder.congestion.fill(12)
  assert.equal(crowdedWalkEnd(finder, route, 0), 4, 'the gate remains owned by gate selection')
})

function busyWorld(wave = 1) {
  const w = new World(station(), 91)
  const route = wallRoute(w.graph)
  for (let i = 0; i < 8; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, 5.5, 0.5, 5, 0)
    a.state = 3
    a.timer = 1000
  }
  const walkers = []
  for (let i = 0; i < wave; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, 0.5, 0.5, 5, 0)
    a.state = 1
    a.path = route
    a.pathIdx = 0
    a.destNode = route.at(-1)
    a.needs = { ...needs }
    walkers.push(a)
  }
  return { w, walkers, route }
}

test('live walkers reconsider an already committed route when a crowd forms', () => {
  const { w, walkers: [a], route } = busyWorld()
  w.tickOnce()
  assert.notEqual(a.path, route, 'live density changes the committed route')
  assert.ok([...a.path].some(n => w.graph.nodeY[n] > 1.5), 'the walker takes the open corridor')
  const selected = a.path
  w.tickOnce()
  assert.equal(a.path, selected, 'the cooldown holds the chosen corridor')
})

test('a wave shares a bounded walking-search budget and replays deterministically', () => {
  function run() {
    const { w, walkers } = busyWorld(CROWD_REPLAN_PER_TICK + 3)
    let searches = 0
    const search = w.path.search.bind(w.path)
    w.path.search = (...args) => { searches++; return search(...args) }
    w.tickOnce()
    assert.equal(searches, CROWD_REPLAN_PER_TICK, 'the initial wave cannot run unlimited A* searches')
    assert.equal(walkers.filter(a => a.crowdCheckTick === 0).length, 3, 'deferred walkers remain eligible')
    return walkers.map(a => ({ path: [...a.path], x: a.x, y: a.y }))
  }
  assert.deepEqual(run(), run(), 'the same seed and crowd produce the same routes and movement')
})

test('a walker can reconsider after it has advanced beyond its initial waypoint', () => {
  const { w, walkers: [a], route } = busyWorld()
  a.x = w.graph.nodeX[route[1]]
  a.pathIdx = 2
  w.tickOnce()
  assert.notEqual(a.path, route, 'a reached previous waypoint still permits a crowd decision')
  assert.equal(a.path[0], route[1], 'the replacement begins where the walker stands')
})
