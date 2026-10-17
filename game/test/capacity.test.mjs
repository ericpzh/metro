// V4's acceptance: an under-built station visibly breaks under an AM peak, and
// the fix (an extra escalator, a wider gate line) visibly fixes it. The
// capacity ladder of §7.8 is a comparison, so this test is a comparison.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'

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
  let crowdLos = 'A'
  for (let i = 0; i < ticks; i++) {
    const m = w.tickOnce()
    peakEscQueue = Math.max(peakEscQueue, m.escalatorQueue)
    peakPop = Math.max(peakPop, m.population)
    if ('ABCDEF'.indexOf(m.crowdLos) > 'ABCDEF'.indexOf(crowdLos)) crowdLos = m.crowdLos
  }
  return { world: w, peakEscQueue, peakPop, crowdLos, totals: w.totals }
}

test('a station with nobody in it reads free flow, not a crush', () => {
  // The reading is the station's own crowd over the station's own floor, so an
  // empty station is LOS A. It must never be a floor of E for "worst", which is
  // what the old per-node readout reported (nobody in the station, E 非常拥挤).
  const data = scenarioStation()
  for (const m of data.modules) if (m.type === 'exit') m.cfg.inRate = 0
  for (const l of data.lines) l.alightPerTrain = 0
  const w = new World(data, 99)
  for (let i = 0; i < 200; i++) w.tickOnce()
  assert.ok(w.graph.stationArea > 0, 'the station had no floor to divide by')
  assert.equal(w.metrics.population, 0)
  assert.equal(w.metrics.crowdLos, 'A')
})

test('one escalator off the platform breaks; three fix it', () => {
  // AM-peak load is set explicitly: the demo default is lighter and would not
  // jam even the broken station.
  const broken = run(setAlighting(scenarioStation({ upEscalators: 1 }), 540), 1600)
  const fixed = run(setAlighting(scenarioStation({ upEscalators: 3 }), 540), 1600)

  assert.ok(
    fixed.peakEscQueue * 2 < broken.peakEscQueue,
    `the extra escalators did not relieve the platform exit: broken ${broken.peakEscQueue} vs fixed ${fixed.peakEscQueue}`,
  )
  assert.ok(fixed.peakPop < broken.peakPop, `fixed station still carries more people: ${fixed.peakPop} vs ${broken.peakPop}`)
  assert.ok(
    'ABCDEF'.indexOf(broken.crowdLos) > 'ABCDEF'.indexOf(fixed.crowdLos),
    `the broken station did not read as the more crowded one: ${broken.crowdLos} vs ${fixed.crowdLos}`,
  )
  assert.equal(broken.crowdLos, 'D')
  assert.ok(broken.totals.exited > 0 && fixed.totals.exited > broken.totals.exited, 'the fixed station did not clear more people')
  console.log(
    `    platform exit peak queue: broken ${broken.peakEscQueue}, fixed ${fixed.peakEscQueue}; ` +
      `exited ${broken.totals.exited} -> ${fixed.totals.exited}; ` +
      `crowd level ${broken.crowdLos} -> ${fixed.crowdLos}`,
  )
})

test('boarding demand that the doors cannot clear is counted as left behind', () => {
  // A short train against a boarding-heavy peak keeps the doors saturated
  // across physique/stride distributions. No alighting wave may contribute to
  // the left-behind counter: this assertion is specifically about boarders.
  const data = setInRates(scenarioStation({ upEscalators: 3 }), 6000)
  for (const line of data.lines) { line.cars = 1; line.alightPerTrain = 0 }
  const r = run(data, 1600)
  assert.ok(r.world.totals.boarded > 0, 'nobody boarded a train at all')
  assert.equal(r.world.totals.alighted, 0, 'only boarding demand contributes to this capacity fixture')
  assert.ok(r.world.totals.leftBehind > 0, 'expected people left behind at a saturated platform')
  console.log(`    boarded ${r.world.totals.boarded}, left behind ${r.world.totals.leftBehind}`)
})
