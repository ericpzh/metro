// The actual shipped station, actual edit helpers and actual worker snapshot work.
// Run outside node:test: elapsed time is diagnostic, never a flaky CI assertion.
import { performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cpus } from 'node:os'
import { referenceStation, REFERENCE_BOOT } from '../game/src/data/reference-station.ts'
import { World } from '../game/src/sim/world.ts'
import { withGround } from '../game/src/sim/ground.ts'
import { addCells, addFloor, addWalls, wallRun, cloneState, toState, toData, paintFaces, fillSurface } from '../game/src/build/model.ts'
import { checkBlockCells } from '../game/src/build/validation.ts'
import { isCosmeticStationEdit } from '../game/src/sim/cosmeticEdit.ts'
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
const largePatch = Array.from({ length: 1024 }, (_, i) => [maxX + 2 + i % 32, Math.floor(i / 32), -16])
const wallLine = Array.from({ length: 32 }, (_, i) => [maxX + 2 + i, 0, -15])
const alternating = cells => [cells, cells.map(([x, y, z]) => [x + 1, y, z])]
const blocks = alternating(block), patches = alternating(patch), largePatches = alternating(largePatch), wallRuns = alternating(wallRun(wallLine))
const solids = new Set(state.cells.filter(c => c.fill === 'solid').map(c => `${c.x},${c.y},${c.z}`))
const wallCell = state.cells.find(c => c.fill === 'solid' && c.tags?.includes('wall') && !solids.has(`${c.x},${c.y + 1},${c.z}`))
if (!wallCell) throw new Error('demo has no exposed north wall paint target')
const wallTarget = [[wallCell.x, wallCell.y, wallCell.z]]
measure('build.paintWallFace.ms', () => paintFaces(state, wallTarget, 'n', 'wall.enamel'))
measure('build.fillWallSurface.ms', () => fillSurface(state, ...wallTarget[0], 'n', 'wall.enamel'))
if (addCells(state.cells, block, state.modules).changed !== 1) throw new Error('benchmark block was refused')
measure('build.previewOneBlock.ms', (i = 0) => checkBlockCells(state, blocks[i % 2]))
measure('build.preview8x8.ms', (i = 0) => checkBlockCells(state, patches[i % 2]))
measure('build.preview32x32.ms', (i = 0) => checkBlockCells(state, largePatches[i % 2]))
measure('build.preview32WallColumns.ms', (i = 0) => checkBlockCells(state, wallRuns[i % 2]))
measure('build.preview32x32Unchanged.ms', () => checkBlockCells(state, largePatch))
const coldStates = Array.from({ length: edits + 1 }, () => ({ ...state, cells: state.cells.slice() }))
measure('build.preview32x32ColdIndex.ms', (i = edits) => checkBlockCells(coldStates[i], largePatch))
measure('build.addOneBlock.ms', () => addCells(state.cells, block, state.modules))
measure('build.add8x8.ms', () => addCells(state.cells, patch, state.modules))
measure('build.add32x32.ms', () => addCells(state.cells, largePatch, state.modules))
measure('build.add32WallColumns.ms', () => addWalls(state, wallLine))
measure('build.addFloor8x8.ms', () => addFloor(state, patch))
measure('build.addFloor32x32.ms', () => addFloor(state, largePatch))
const wallFaces = state.cells.filter(c => c.fill === 'solid' && c.tags?.includes('wall')).slice(0, 1024).map(c => [c.x, c.y, c.z])
measure('build.paint1024WallFaces.ms', () => paintFaces(state, wallFaces, 'n', 'wall.enamel'))
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
const wallPainted = toData(paintFaces(state, wallTarget, 'n', 'wall.enamel'))
const normalizedData = toData(state)
if (!isCosmeticStationEdit(normalizedData, wallPainted)) throw new Error('wall paint unexpectedly changes simulation inputs')
measure('sim.classifyWallPaint.ms', () => isCosmeticStationEdit(normalizedData, wallPainted))
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
