// Loading a station is a full simulation reset. A station switch (打开 / 新建 /
// 示例车站) must not let the old crowd, trains, queues or clock survive into the
// new document. `rebuild()` is the edit path and deliberately keeps the crowd;
// `load()` is the switch path and clears everything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'

/** Tick until the demo has both a crowd and a live train to throw away. */
function runUntilBusy(w) {
  let guard = 0
  while ((w.pool.count === 0 || w.trains.length === 0) && guard++ < 600) w.tickOnce()
  assert.ok(w.pool.count > 0 && w.trains.length > 0, 'the demo never got busy')
}

test('load clears the crowd, trains, clock and counters of the previous station', () => {
  const w = new World(referenceStation(), 1234567)
  runUntilBusy(w)
  assert.ok(w.tick > 0)

  // Switch stations with a different seed and start clock.
  w.load(referenceStation({ upEscalators: 3 }), 42, 6 * 3600)
  assert.equal(w.pool.count, 0, 'agents from the old station survived the load')
  assert.equal(w.trains.length, 0, 'a train from the old station survived the load')
  assert.equal(w.tick, 0, 'the tick clock did not reset')
  assert.equal(w.simTime, 6 * 3600, 'the sim clock did not reset to the requested start')
  assert.equal(w.seed, 42, 'the new station seed was ignored')
  assert.equal(w.metrics.population, 0)
  assert.deepEqual(w.totals, { boarded: 0, alighted: 0, exited: 0, leftBehind: 0 })
  for (const s of w.graph.servers) assert.equal(s.queue.length, 0, 'a server queue survived the load')
})

test('load reseeds the RNG, so the same station replays identically', () => {
  const data = referenceStation()
  const a = new World(data, 999)
  for (let i = 0; i < 120; i++) a.tickOnce()
  a.load(data, 999)
  const b = new World(data, 999)
  for (let i = 0; i < 120; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  const pos = (w) => w.pool.live.map((x) => [x.id, x.x, x.y, x.z, x.state])
  assert.deepEqual(pos(a), pos(b))
})

test('rebuild (an edit) keeps the crowd, unlike load', () => {
  const w = new World(referenceStation(), 7)
  runUntilBusy(w)
  const before = w.pool.count
  w.data = referenceStation()
  w.rebuild()
  assert.equal(w.pool.count, before, 'an edit wrongly cleared the crowd')
})
