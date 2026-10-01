// V4's acceptance: an under-built station visibly breaks under an AM peak, and
// the fix (an extra escalator, a wider gate line) visibly fixes it. The
// capacity ladder of §7.8 is a comparison, so this test is a comparison.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'

function setInRates(data, rate) {
  for (const m of data.modules) if (m.type === 'exit') m.cfg.inRate = rate
  return data
}

function setAlighting(data, n) {
  for (const l of data.lines) l.alightPerTrain = n
  return data
}

function run(data, ticks) {
  const w = new World(data, 99)
  let peakEscQueue = 0
  let peakPop = 0
  let worstLos = 'A'
  for (let i = 0; i < ticks; i++) {
    const m = w.tickOnce()
    peakEscQueue = Math.max(peakEscQueue, m.escalatorQueue)
    peakPop = Math.max(peakPop, m.population)
    if ('ABCDEF'.indexOf(m.worstLos) > 'ABCDEF'.indexOf(worstLos)) worstLos = m.worstLos
  }
  return { world: w, peakEscQueue, peakPop, worstLos, totals: w.totals }
}

test('one escalator off the platform breaks; three fix it', () => {
  // AM-peak load is set explicitly: the demo default is lighter and would not
  // jam even the broken station.
  const broken = run(setAlighting(referenceStation({ upEscalators: 1 }), 540), 1600)
  const fixed = run(setAlighting(referenceStation({ upEscalators: 3 }), 540), 1600)

  assert.ok(
    fixed.peakEscQueue * 2 < broken.peakEscQueue,
    `the extra escalators did not relieve the platform exit: broken ${broken.peakEscQueue} vs fixed ${fixed.peakEscQueue}`,
  )
  assert.ok(fixed.peakPop < broken.peakPop, `fixed station still carries more people: ${fixed.peakPop} vs ${broken.peakPop}`)
  assert.equal(broken.worstLos, 'F')
  assert.ok(broken.totals.exited > 0 && fixed.totals.exited > broken.totals.exited, 'the fixed station did not clear more people')
  console.log(
    `    platform exit peak queue: broken ${broken.peakEscQueue}, fixed ${fixed.peakEscQueue}; ` +
      `exited ${broken.totals.exited} -> ${fixed.totals.exited}`,
  )
})

test('boarding demand that the doors cannot clear is counted as left behind', () => {
  // A boarding-heavy peak: the exits pour in far faster than the platform can
  // absorb, so the door queues survive a dwell and the counter climbs.
  const data = setInRates(referenceStation({ upEscalators: 3 }), 6000)
  const r = run(data, 1600)
  assert.ok(r.world.totals.boarded > 0, 'nobody boarded a train at all')
  assert.ok(r.world.totals.leftBehind > 0, 'expected people left behind at a saturated platform')
  console.log(`    boarded ${r.world.totals.boarded}, left behind ${r.world.totals.leftBehind}`)
})
