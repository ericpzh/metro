import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { referenceStation } from '../../game/src/data/reference-station.ts'
import { World } from '../../game/src/sim/world.ts'

const output = process.argv[2]
if (!output) throw new Error('Provide an output directory for the Zoo World trace')
const seed = 7654321
const authored = referenceStation('zoo')
const station = { ...authored, cells: authored.cells.filter(c => !(c.x === 67 && c.y === 27 && c.z === -15)) }
const world = new World(station, seed)
const graph = world.graph
const start = graph.nodeIndex.get('59,20,-15')
const end = graph.nodeIndex.get('59,16,-15')
const gate = graph.servers.find(s => s.kind === 'gate' && graph.nodeX[s.node] === 59.5 &&
  graph.nodeY[s.node] === 18.5 && graph.nodeZ[s.node] === -14)
if (start === undefined || end === undefined || !gate) throw new Error('Zoo route fixture changed')
const needs = { stepFree: false, luggage: false }
const path = [...world.path.search(start, end, needs)]
if (!path.includes(gate.node)) throw new Error('Fixture route misses the gate')
// Slow this fixture server so arrivals separated by crowd movement still overlap.
gate.rate = 0.2

world.spawnStreet = () => {}
world.dispatchTrains = () => {}
const passengers = Array.from({ length: 5 }, () => {
  const person = world.pool.spawn({ origin: '', stops: [], dest: '' },
    graph.nodeX[start], graph.nodeY[start], graph.nodeZ[start], 0)
  Object.assign(person, { state: 1, needs, path: Int32Array.from(path), pathIdx: 0, destNode: end })
  return person
})
const gateIndex = path.indexOf(gate.node)
for (const person of passengers) {
  Object.assign(person, { pathIdx: gateIndex, gateDir: 1, gateApproach: path[gateIndex - 1] })
  world.joinServer(person, gate.id)
}
const gateState = () => ({
  queue: [...gate.queue], lane: gate.lane, cooldown: gate.cooldown,
  waitAccum: gate.waitAccum, waitCount: gate.waitCount,
})
const trace = Array.from({ length: 30 }, () => {
  const beforeService = gateState()
  const metrics = world.tickOnce()
  return {
    tick: world.tick, simTime: world.simTime, period: metrics.period,
    beforeService, gate: gateState(),
    agents: passengers.map(a => ({
      id: a.id, x: a.x, y: a.y, z: a.z, state: a.state, pathIndex: a.pathIdx,
      gateDirection: a.gateDir, wait: a.wait, dead: a.dead,
    })),
  }
})
if (!trace.some(row => row.gate.queue.length > 1)) throw new Error('Injected burst failed to produce a backlog')
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'injected-burst.json'), JSON.stringify({
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  stationSha256: createHash('sha256').update(readFileSync('game/src/data/demo-station.json')).digest('hex'),
  seed, gateId: gate.id, rate: gate.rate, injectedIds: passengers.map(a => a.id),
  path: path.map(node => ({
    x: graph.nodeX[node], y: graph.nodeY[node], z: graph.nodeZ[node],
    zone: graph.nodeZone[node], gate: node === gate.node,
  })),
  limitations: 'Five agents injected directly into the alternate Zoo gate queue. Street spawning and train dispatch disabled.',
  trace,
}, null, 2) + '\n')
