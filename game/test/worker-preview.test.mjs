// The worker's select-a-passenger message (§9.5, §7.6).
//
// `World.routeOf` is pure — `agent-route.test.mjs` pins that — but the *worker*
// is what a click actually reaches, and there the preview has to be posted
// without stepping the world. Stepping it would make watching a passenger
// advance the clock they are walking on: a sim that moves because it is being
// looked at, which is the one thing the observation contract forbids.
//
// The worker is a module with a `self` context, so it is driven here the way the
// browser drives it: a stub context whose `postMessage` records frames and whose
// `setInterval` the test fires by hand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CALENDAR, simTimeAtDate } from '../src/sim/clock.ts'

const frames = []
const listeners = []
let timerFn = null
const builds = new Map()
let nextBuild = 0
function flushBuild() {
  const callbacks = [...builds.values()]
  builds.clear()
  for (const fn of callbacks) fn()
}
globalThis.self = {
  setTimeout: fn => { builds.set(++nextBuild, fn); return nextBuild },
  clearTimeout: id => builds.delete(id),
  postMessage: (msg) => frames.push(msg),
  addEventListener: (type, fn) => listeners.push([type, fn]),
  setInterval: (fn) => {
    timerFn = fn
    return 1
  },
  clearInterval: () => {},
}

const { referenceStation } = await import('../src/data/reference-station.ts')
await import('../src/sim/worker.ts')

/** Deliver one message to the worker, the way `postMessage` would. */
function post(msg) {
  for (const [type, fn] of listeners) if (type === 'message') fn({ data: msg })
}
const lastState = () => frames.filter((f) => f.type === 'state').pop()

post({ type: 'init', data: referenceStation(), seed: 1234, startSeconds: 6.5 * 3600 })
const first = lastState()
assert.ok(first, 'the worker posted its first frame')

test('selecting a passenger while the sim runs does not step it', () => {
  post({ type: 'control', playing: true, speed: 1 })
  const before = lastState().metrics.tick

  // Fire the clock: the sim advances under its own interval, as it should.
  timerFn()
  const stepped = lastState().metrics.tick
  assert.equal(stepped, before + 1, 'a running clock ticks on its own interval')

  // Now the click. The selection is a preview: it must not be another tick.
  post({ type: 'selectAgent', id: 1, token: 7 })
  assert.equal(lastState().metrics.tick, stepped, 'watching a passenger does not advance the simulation')

  // And the route still reaches the renderer, on the tick that was coming anyway.
  timerFn()
  const frame = lastState()
  assert.equal(frame.metrics.tick, stepped + 1, 'the next tick carries on from where the clock was')
  assert.equal(frame.routeToken, 7, 'and answers the newest selection')
})

test('a paused sim is told about the selection at once, still without stepping', () => {
  post({ type: 'control', playing: false, speed: 1 })
  const held = lastState().metrics.tick
  const n = frames.length
  post({ type: 'selectAgent', id: -1, token: 8 })
  assert.equal(frames.length, n + 1, 'a paused sim has no stream, so the frame is posted now')
  const frame = lastState()
  assert.equal(frame.metrics.tick, held, 'and posting it stepped nothing')
  assert.equal(frame.routeToken, 8)
  assert.equal(frame.routeAgent, -1, 'nobody is selected')
  assert.equal(frame.route.length, 0, 'so the preview line is empty')
})

test('a paused seek moves the clock and posts at once, stepping nothing', () => {
  // The 时刻 window's calendar pick (§7.9's scrub): the clock moves, the station
  // and the crowd stay. `World.seek` itself — the dropped dispatch schedule and
  // the day type that follows — is pinned in `demand.test.mjs`; this is the
  // worker half of the path, posted straight away because a paused sim has no
  // stream to carry it later.
  post({ type: 'control', playing: false, speed: 1 })
  const held = lastState().metrics.tick
  const n = frames.length

  const saturday = simTimeAtDate({ year: 2026, month: 1, day: 10 }, DEFAULT_CALENDAR.epoch, 8 * 3600)
  post({ type: 'seek', seconds: saturday })
  assert.equal(frames.length, n + 1, 'a paused sim has no stream, so the moved clock is posted now')
  const frame = lastState()
  assert.equal(frame.metrics.simTime, saturday, 'the clock moved')
  assert.equal(frame.metrics.tick, held, 'and moving it stepped nothing')
})

test('cosmetic builds acknowledge edits without rebuilding routes; speed and topology still rebuild', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data = { name: 'test', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: -4, fill: 'solid', finish: { top: 'floor.tile' } }] }
  post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
  const original = World.prototype.rebuild
  let rebuilds = 0
  World.prototype.rebuild = function (...args) { rebuilds++; return original.apply(this, args) }
  try {
    const tick = lastState().metrics.tick, count = frames.length
    const painted = { ...data, cells: [{ ...data.cells[0], finish: { top: 'floor.tile', n: 'wall.enamel' } }] }
    post({ type: 'build', data: painted })
    assert.equal(rebuilds, 0, 'side color leaves routing/server state intact')
    assert.equal(frames.length, count + 1, 'paused renderer receives the acknowledgement immediately')
    assert.equal(lastState().metrics.tick, tick)
    const slow = { ...painted, cells: [{ ...painted.cells[0], finish: { top: 'floor.concrete' } }] }
    post({ type: 'build', data: slow })
    assert.equal(rebuilds, 0, 'topology work is deferred out of the build message')
    flushBuild()
    assert.equal(rebuilds, 1, 'changed walking speed rebuilds the graph')
    post({ type: 'build', data: { ...slow, cells: [...slow.cells, { x: 1, y: 0, z: -4, fill: 'solid' }] } })
    flushBuild()
    assert.equal(rebuilds, 2, 'structural edits rebuild the graph')
  } finally { World.prototype.rebuild = original }
})

test('inert decor builds skip routing while a bench stop still rebuilds', async () => {
  const { World } = await import('../src/sim/world.ts')
  const { createModule } = await import('../src/build/model.ts')
  const data = { name: 'test', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: -4, fill: 'solid' }] }
  post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
  const original = World.prototype.rebuild
  let rebuilds = 0
  World.prototype.rebuild = function (...args) { rebuilds++; return original.apply(this, args) }
  try {
    const sticker = createModule('tactile-guide', 0, 0, -4, 'sticker')
    post({ type: 'build', data: { ...data, modules: [sticker] } })
    assert.equal(rebuilds, 0, 'a floor sticker draws without walking')
    const bench = createModule('bench', 1, 0, -4, 'bench')
    post({ type: 'build', data: { ...data, modules: [sticker, bench] } })
    flushBuild()
    assert.equal(rebuilds, 1, 'a bench stop still rebuilds the graph')
  } finally { World.prototype.rebuild = original }
})

test('sidewalk, lawn and tree builds keep routes and paused simulation untouched', async () => {
  const { World } = await import('../src/sim/world.ts')
  const { createModule } = await import('../src/build/model.ts')
  const data = { name: 'outside', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: 0, fill: 'solid' }] }
  post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
  const original = World.prototype.rebuild
  let rebuilds = 0
  World.prototype.rebuild = function (...args) { rebuilds++; return original.apply(this, args) }
  try {
    const tick = lastState().metrics.tick
    // A 树木 is planting, not an obstacle (§9.5): its tile stays walkable, so a
    // planting is the same bargain as the tiles and props around it.
    for (const type of ['sidewalk', 'lawn', 'tree']) {
      post({ type: 'build', data: { ...data, modules: [createModule(type, 0, 0, 0, type)] } })
      assert.equal(rebuilds, 0, `a ${type} placement needs no new routes`)
      assert.equal(lastState().metrics.tick, tick)
    }
  } finally { World.prototype.rebuild = original }
})

test('functional edit bursts install only the latest snapshot without advancing the clock', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data = { name: 'burst', seed: 1, modules: [], lines: [], cells: [] }
  post({ type: 'init', data, seed: 1, playing: true, speed: 1 })
  const original = World.prototype.rebuild
  const installed = []
  World.prototype.rebuild = function (...args) { installed.push(this.data); return original.apply(this, args) }
  try {
    const tick = lastState().metrics.tick
    let latest
    for (let x = 0; x < 20; x++) {
      latest = { ...data, cells: [{ x, y: 0, z: -5, fill: 'solid' }] }
      post({ type: 'build', data: latest })
    }
    // An inert edit joins pending topology, it must not discard that edit.
    latest = { ...latest, name: 'latest' }
    post({ type: 'build', data: latest })
    assert.equal(installed.length, 0)
    assert.equal(builds.size, 1, 'one bounded task, even during continuous edits')
    timerFn()
    assert.equal(lastState().metrics.tick, tick + 1, 'old coherent world continues to tick')
    flushBuild()
    assert.deepEqual(installed, [latest])
    assert.equal(lastState().metrics.tick, tick + 1, 'installing the graph is not a simulation tick')
    assert.equal(builds.size, 0)
    // Undo back to the applied document avoids rebuilding intermediate layouts.
    post({ type: 'build', data })
    post({ type: 'build', data: latest })
    flushBuild()
    assert.equal(installed.length, 1, 'a reverted burst needs no graph rebuild')
    post({ type: 'build', data })
    post({ type: 'init', data: { ...data, name: 'replacement' }, seed: 2, playing: false, speed: 1 })
    const count = installed.length
    flushBuild()
    assert.equal(installed.length, count, 'loading cancels stale queued edits')
  } finally { World.prototype.rebuild = original }
})
