// PLAN §2.2 / §R3: a docking train unlocks hundreds of boarding legs in one
// tick. Uncached A* was measured at 395 ms for 520 searches. The cache keyed on
// (from, to, needsClass) is load-bearing, and the per-tick re-path budget is the
// second guard. Both are asserted here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { MAX_REPATH_PER_TICK } from '../src/sim/constants.ts'

test('a synchronised re-path wave rides the path cache', () => {
  const w = new World(referenceStation(), 7)
  const g = w.graph
  const door = g.servers[g.platforms[0].doors[0]].node
  const exitId = g.exits[0].id

  // 520 agents on one boarding leg, all needing a path in the same instant.
  for (let i = 0; i < 520; i++) {
    w.pool.spawn({ origin: '', stops: [], dest: 'exit:' + exitId }, g.nodeX[door], g.nodeY[door], g.nodeZ[door], 0)
  }
  // Force one needs class so the whole wave shares a single cache key.
  for (const a of w.pool.live) {
    a.needs.stepFree = false
    a.needs.luggage = false
  }

  const t0 = performance.now()
  let guard = 0
  while (guard++ < 60) {
    w.tickOnce()
    if (w.pool.live.every((a) => a.dead || a.path.length > 0)) break
  }
  const ms = performance.now() - t0

  const alive = w.pool.live.filter((a) => !a.dead)
  assert.ok(alive.length > 450, `the wave thinned out: ${alive.length} left`)
  const first = alive[0].path
  assert.ok(first.length > 5, 'expected a real path, not a stub')
  // Every survivor shares the exact same cached Int32Array.
  for (const a of alive) assert.equal(a.path, first, 'path was not shared from the cache')

  const key = `${alive[0].fromNode}|${alive[0].destNode}|N`
  assert.ok(w.path.cache.has(key), `cache is missing ${key}`)
  assert.equal([...w.path.cache.keys()].filter((k) => k.endsWith('|N')).length >= 1, true)
  assert.ok(ms < 60, `520 cached re-paths took ${ms.toFixed(1)} ms`)
  void exitId
})

test('the per-tick re-path budget is never exceeded', () => {
  const w = new World(referenceStation(), 11)
  const g = w.graph
  // Distinct destinations so the cache cannot trivially flatten the work.
  const targets = [g.exits[0].node, g.exits[1].node, g.exits[2].node, g.nodeCount - 1]
  for (let i = 0; i < 200; i++) {
    const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[0], g.nodeY[0], g.nodeZ[0], 0)
    a.fromNode = 0
    a.destNode = targets[i % targets.length]
  }
  // Queue 200 searches by hand, then confirm at most MAX_REPATH_PER_TICK A*
  // calls happen per tick.
  for (let i = 0; i < 200; i++) {
    w.path.pending.push({ agentId: -1, from: 0, to: targets[i % targets.length], needs: { stepFree: false, luggage: false } })
  }
  let maxPerTick = 0
  let guard = 0
  while (w.path.pendingCount > 0 && guard++ < 500) {
    const before = w.path.searches
    w.tickOnce()
    maxPerTick = Math.max(maxPerTick, w.path.searches - before)
  }
  assert.ok(maxPerTick <= MAX_REPATH_PER_TICK, `budget blew: ${maxPerTick} > ${MAX_REPATH_PER_TICK}`)
  assert.equal(w.path.pendingCount, 0)
})
