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

const frames = []
const listeners = []
let timerFn = null
globalThis.self = {
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
