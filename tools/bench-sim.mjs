// The actual shipped station, actual edit helpers and actual worker snapshot work.
// Run outside node:test: elapsed time is diagnostic, never a flaky CI assertion.
import { performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cpus } from 'node:os'
import { referenceStation, REFERENCE_BOOT } from '../game/src/data/reference-station.ts'
import { World } from '../game/src/sim/world.ts'
import { withGround } from '../game/src/sim/ground.ts'
import { addCells, cloneState, toState, toData, paintFaces } from '../game/src/build/model.ts'
import { checkBlockCells } from '../game/src/build/validation.ts'
import { summarize, printTimings } from './perf-stats.mjs'

const ticks = Number(process.env.BENCH_TICKS ?? 600)
const edits = Number(process.env.BENCH_EDITS ?? 12)
if (!Number.isInteger(ticks) || ticks < 60 || !Number.isInteger(edits) || edits < 2) throw new Error('BENCH_TICKS >= 60 and BENCH_EDITS >= 2 must be integers')
const timings = {}
function measure(name, fn, count = edits) {
  fn() // JIT/cache warmup, excluded
  const samples = []
  for (let i = 0; i < count; i++) {
    const start = performance.now()
    fn(i)
    samples.push(performance.now() - start)
  }
  timings[name] = summarize(samples)
}
const data = referenceStation()
const state = toState(data)
const cell = state.cells.find((c) => c.fill === 'solid' && c.z < 0 && !c.tags?.length)
if (!cell) throw new Error('demo has no paint target')
measure('build.cloneUndo.ms', () => cloneState(state))
measure('build.paintOneCell.ms', (i = 0) => paintFaces(state, [[cell.x, cell.y, cell.z]], 'top', i % 2 ? 'floor.concrete' : 'floor.tile'))
const maxX = Math.max(...state.cells.map((c) => c.x))
const block = [[maxX + 2, 0, -16]]
const patch = Array.from({ length: 64 }, (_, i) => [maxX + 2 + i % 8, Math.floor(i / 8), -16])
if (addCells(state.cells, block, state.modules).changed !== 1) throw new Error('benchmark block was refused')
measure('build.previewOneBlock.ms', () => checkBlockCells(state, block))
measure('build.preview8x8.ms', () => checkBlockCells(state, patch))
measure('build.addOneBlock.ms', () => addCells(state.cells, block, state.modules))
measure('build.effectiveGround.ms', () => withGround(data.cells, data.modules))
measure('sim.coldWorld.ms', () => new World(data, data.seed), 3)
const world = new World(data, data.seed)
world.simTime = REFERENCE_BOOT.startSeconds
const populations = []
for (const [name, warmup] of [['opening', 120], ['settled', 600], ['morningPeak', 0]]) {
  if (name === 'morningPeak') world.simTime = 8 * 3600
  for (let i = 0; i < warmup; i++) world.tickOnce()
  const samples = []
  const stages = Object.fromEntries(['dispatchTrains', 'spawnStreet', 'stepServers', 'moveAgents', 'computeMetrics'].map((s) => [s, []]))
  const originals = {}
  for (const stage of Object.keys(stages)) {
    originals[stage] = world[stage]
    world[stage] = function (...args) {
      const start = performance.now()
      try { return originals[stage].apply(this, args) } finally { stages[stage].push(performance.now() - start) }
    }
  }
  let min = Infinity, max = 0
  for (let i = 0; i < ticks; i++) {
    const start = performance.now()
    world.tickOnce()
    samples.push(performance.now() - start)
    min = Math.min(min, world.pool.count)
    max = Math.max(max, world.pool.count)
  }
  for (const stage of Object.keys(stages)) world[stage] = originals[stage]
  timings[`sim.${name}.tick.ms`] = summarize(samples)
  for (const [stage, values] of Object.entries(stages)) timings[`sim.${name}.${stage}.ms`] = summarize(values)
  populations.push({ phase: name, min, max, tick: world.tick, simTime: world.simTime })
}
measure('sim.liveRebuild.ms', (i = 0) => {
  world.data = toData(paintFaces(state, [[cell.x, cell.y, cell.z]], 'top', i % 2 ? 'floor.concrete' : 'floor.tile'))
  world.rebuild()
})
const buffer = new Float32Array(world.pool.count * 6)
measure('sim.snapshotAndClone.ms', () => {
  const count = world.writeTransfer(buffer)
  structuredClone({ agents: buffer.slice(0, count * 6), density: world.nodePop.slice(),
    metrics: { ...world.metrics }, trains: world.trainRenderState(), lifts: world.liftRenderState(), trainServices: world.trainServices() })
}, 100)
const report = { kind: 'simulation-and-build-cpu', timestamp: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model },
  fixture: { name: data.name, seed: data.seed, cells: data.cells.length, modules: data.modules.length, nodes: world.graph.nodeCount },
  config: { ticks, edits }, populations, timings }
const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/sim.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2))
console.log(report.fixture, populations)
printTimings(timings)
console.log(`Report: ${output}`)
