// Ramps vs solid ground, and the escalator capacity model.
//
// GAME-SPEC §5.4: a placed ramp carves the floor it climbs through, but the
// landing cells stay because the station graph uses them as the ramp's nodes.
// §7.8: an escalator is single-direction, one passenger per step.
import test from 'node:test'
import assert from 'node:assert/strict'
import { carveRampOpenings, rampBlocked } from '../src/sim/openings.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { countUpEscalators, initialStation, setUpEscalators } from '../src/build/model.ts'
import { ESCALATOR_RATE, ESCALATOR_SPEED, ESCALATOR_STEP_PITCH } from '../src/sim/constants.ts'

test('a ramp carves the slab it climbs through, but keeps its landings', () => {
  const cells = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const ramp = {
    id: 'e',
    type: 'escalator',
    x: 1,
    y: 0,
    z: 0,
    from: { x: 1, y: 0, z: 0 },
    to: { x: 1, y: 3, z: -2 },
    cfg: { dir: 'down' },
  }
  const removed = carveRampOpenings(cells, [ramp])
  assert.ok(removed > 0, 'the slab the ramp passes through is carved')
  assert.ok(cells.some((c) => c.x === 1 && c.y === 0 && c.z === 0), 'the landing cell is kept')
  assert.ok(!cells.some((c) => c.x === 1 && c.y === 1 && c.z === 0), 'the cell beside the landing is open')
})

test('the reference station keeps every ramp landing node', () => {
  const d = referenceStation()
  const has = new Set(d.cells.map((c) => `${c.x},${c.y},${c.z}`))
  let ramps = 0
  for (const m of d.modules) {
    if (m.type !== 'escalator' && m.type !== 'stair' && m.type !== 'lift') continue
    ramps++
    assert.ok(has.has(`${m.from.x},${m.from.y},${m.from.z}`), `from landing missing for ${m.id}`)
    assert.ok(has.has(`${m.to.x},${m.to.y},${m.to.z}`), `to landing missing for ${m.id}`)
  }
  assert.ok(ramps > 0)
})

test('an escalator runs one passenger per step at 75/min', () => {
  assert.equal(ESCALATOR_RATE, ESCALATOR_SPEED / ESCALATOR_STEP_PITCH)
  assert.ok(Math.abs(ESCALATOR_RATE * 60 - 75) < 0.01, `expected 75/min, got ${ESCALATOR_RATE * 60}`)
})

const ramp = (id, x, fromY, fromZ, toY, toZ) => ({
  id,
  type: 'escalator',
  x,
  y: fromY,
  z: fromZ,
  from: { x, y: fromY, z: fromZ },
  to: { x, y: toY, z: toZ },
  cfg: { dir: fromZ > toZ ? 'down' : 'up' },
})

test('a ramp directly below another is blocked; a ramp in the next column is not', () => {
  const down = ramp('down', -4, 28, 0, 21, -4)
  const stacked = ramp('stacked', -4, 22, -4, 29, 0) // same column, overlapping y/z
  const beside = ramp('beside', -2, 28, 0, 21, -4) // next column over
  assert.ok(rampBlocked([down], stacked), 'a ramp placed below must be rejected')
  assert.ok(!rampBlocked([down], beside), 'a ramp in the next column is fine')
})

test('no two ramps in the reference station overlap', () => {
  const ramps = referenceStation().modules.filter((m) => m.type === 'escalator' || m.type === 'stair' || m.type === 'lift')
  assert.ok(ramps.length > 0)
  for (let i = 0; i < ramps.length; i++) {
    for (let j = i + 1; j < ramps.length; j++) {
      assert.ok(!rampBlocked([ramps[i]], ramps[j]), `${ramps[i].id} and ${ramps[j].id} overlap`)
    }
  }
})

test('every surface exit has both an up and a down escalator', () => {
  const d = referenceStation()
  const exits = d.modules.filter((m) => m.type === 'exit')
  assert.ok(exits.length > 0)
  for (const e of exits) {
    // A run whose surface landing (the higher end) lands within a bay-width of
    // the exit: its roof is what covers them.
    const near = d.modules.filter((m) => {
      if (m.type !== 'escalator') return false
      const top = m.from.z >= m.to.z ? m.from : m.to
      return Math.hypot(top.x - e.x, top.y - e.y) <= 2.5
    })
    assert.ok(near.some((m) => m.cfg.dir === 'down'), `${e.id} has no down escalator under its roof`)
    assert.ok(near.some((m) => m.cfg.dir === 'up'), `${e.id} has no up escalator under its roof`)
  }
})

test('adding up escalators never stacks them', () => {
  const s = setUpEscalators(initialStation(), 5)
  assert.equal(countUpEscalators(s), 5, 'all five land in free columns')
  const ramps = s.modules.filter((m) => m.type === 'escalator')
  for (let i = 0; i < ramps.length; i++) {
    for (let j = i + 1; j < ramps.length; j++) {
      assert.ok(!rampBlocked([ramps[i]], ramps[j]), `${ramps[i].id} and ${ramps[j].id} overlap`)
    }
  }
})
