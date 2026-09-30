// PLAN §2.1 and spec §10.4. The worker owns 200 ms per tick; 8 ms is a comfort
// target, not a ceiling. This test asserts the comfort target on the measured
// machine and reports the numbers either way.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

test('3,000+ agents step inside the worker tick budget', () => {
  // The under-built station is the worst case: the platform jams and the
  // population climbs through 3,000.
  const w = new World(referenceStation({ upEscalators: 1 }), 2026)
  const samples = []
  let maxPop = 0
  const ticks = 2600
  for (let i = 0; i < ticks; i++) {
    const m = w.tickOnce()
    samples.push(m.tickMs)
    maxPop = Math.max(maxPop, m.population)
  }
  const sorted = samples.slice().sort((a, b) => a - b)
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length
  const p99 = percentile(sorted, 0.99)
  const max = sorted[sorted.length - 1]

  assert.ok(maxPop >= 3000, `only reached ${maxPop} agents; the budget test needs 3,000`)
  // Assert the spec's comfort target, which the spike said was easy (§2.1).
  assert.ok(p99 < 8, `p99 worker tick ${p99.toFixed(2)} ms blew the 8 ms comfort target (max ${max.toFixed(2)})`)
  console.log(`    crowd: max ${maxPop} agents, mean ${mean.toFixed(2)} ms/tick, p99 ${p99.toFixed(2)} ms, max ${max.toFixed(2)} ms`)
})

test('the per-frame interpolation buffer is flat and contiguous', () => {
  const w = new World(referenceStation(), 5)
  for (let i = 0; i < 300; i++) w.tickOnce()
  const buf = new Float32Array(8000 * 5)
  const n = w.writeTransfer(buf)
  assert.ok(n > 0)
  assert.equal(n, w.pool.count)
  // x/y/z/state/phase are finite for every written agent.
  for (let i = 0; i < n * 5; i++) assert.ok(Number.isFinite(buf[i]), `buffer[${i}] is not finite`)
})
