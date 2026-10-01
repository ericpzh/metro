// §7.6 determinism is a hard requirement: seed + tick -> identical crowd.
// Same seed, same ticks, identical positions, asserted here so a regression in
// the RNG, iteration order or a stray Math.random fails CI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'

function positions(world) {
  return world.pool.live.map((a) => [a.id, a.x, a.y, a.z, a.state])
}

test('same seed and tick produce identical agents', () => {
  const a = new World(referenceStation(), 424242)
  const b = new World(referenceStation(), 424242)
  for (let i = 0; i < 600; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  // A real crowd passed through, so the comparison below is meaningful. Throughput
  // tuning moves the *standing* population around, so count everyone the run
  // created — still inside plus everyone who already left.
  const throughput = a.pool.count + a.totals.exited + a.totals.boarded
  assert.ok(throughput > 300, `expected a crowd, got ${throughput}`)
  assert.deepEqual(positions(a), positions(b))

  // And it keeps holding deep into the run.
  for (let i = 0; i < 600; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  assert.deepEqual(positions(a), positions(b))
})

test('a different seed diverges', () => {
  const a = new World(referenceStation(), 1)
  const b = new World(referenceStation(), 2)
  for (let i = 0; i < 200; i++) {
    a.tickOnce()
    b.tickOnce()
  }
  assert.notDeepEqual(positions(a), positions(b))
})

test('no Math.random in the simulation source', async () => {
  const fs = await import('node:fs')
  const path = new URL('../src/sim/', import.meta.url)
  for (const name of fs.readdirSync(path)) {
    if (!name.endsWith('.ts')) continue
    const text = fs.readFileSync(new URL(name, path), 'utf8')
    assert.ok(!/Math\.random/.test(text), `${name} uses Math.random`)
  }
})
