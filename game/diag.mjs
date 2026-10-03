// Throwaway diagnostic: run the Wusi Square test rig and watch queue metrics.
import { World } from './src/sim/world.ts'
import { scenarioStation } from './test/support/scenario-station.ts'

function run(label, data, ticks) {
  const w = new World(data, 99)
  let peakGate = 0, peakEsc = 0, peakDoorQ = 0, peakPop = 0, worst = 'A'
  let gateSamples = []
  for (let i = 0; i < ticks; i++) {
    const m = w.tickOnce()
    peakGate = Math.max(peakGate, m.gateQueue)
    peakEsc = Math.max(peakEsc, m.escalatorQueue)
    peakDoorQ = Math.max(peakDoorQ, m.doorQueue)
    peakPop = Math.max(peakPop, m.population)
    if ('ABCDEF'.indexOf(m.worstLos) > 'ABCDEF'.indexOf(worst)) worst = m.worstLos
    if (i % 150 === 0) gateSamples.push(m.gateQueue)
  }
  console.log(`\n== ${label} ==`)
  console.log(`pop peak ${peakPop}, gateQ peak ${peakGate}, escQ peak ${peakEsc}, doorQ peak ${peakDoorQ}, worst LOS ${worst}`)
  console.log(`gateQ every 150s: ${gateSamples.join(' ')}`)
  console.log(`totals:`, JSON.stringify(w.totals))
  // Per-gate queue snapshot at the end.
  const gates = w.graph.servers.filter((s) => s.kind === 'gate')
  console.log(`gates: ${gates.length}, end queue per gate: ${gates.map((g) => g.queue.length).join(',')}`)
}

const ticks = 1600
run('scenario default (12 gates, 1 up esc)', scenarioStation(), ticks)
run('scenario, 16 gates', scenarioStation({ gates: 16 }), ticks)
run('scenario, 6 gates', scenarioStation({ gates: 6 }), ticks)
