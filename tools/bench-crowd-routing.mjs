// Phase A/B/C/E benchmark and spread harness for crowd routing (design/crowd-routing-plan.md).
// Measures wide-hall approach spread, two-connector balancing, narrow single-route control,
// and Zoo / Tanwei / Tianhe Park morning-peak routing work and tick latency.
import { performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cpus } from 'node:os'
import { World } from '../game/src/sim/world.ts'
import { referenceStation } from '../game/src/data/reference-station.ts'

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

function summarizeMs(samples) {
  const s = samples.slice().sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  return {
    count: s.length,
    totalMs: +sum.toFixed(2),
    meanMs: +(sum / Math.max(1, s.length)).toFixed(3),
    p50Ms: +percentile(s, 0.5).toFixed(3),
    p95Ms: +percentile(s, 0.95).toFixed(3),
    maxMs: +(s[s.length - 1] ?? 0).toFixed(3),
  }
}

export function buildWideConcourseFixture({ width = 11, twoConnectors = false } = {}) {
  const cells = []
  const yMid = Math.floor(width / 2)
  // Upper concourse at z = 9 (surface z = 10)
  for (let x = 0; x <= 29; x++) {
    for (let y = 0; y < width; y++) {
      cells.push({ x, y, z: 9, fill: 'solid', zone: 'unpaid' })
    }
  }
  // Lower landing hall at z = 4 (surface z = 5)
  for (let x = 33; x <= 42; x++) {
    for (let y = 0; y < width; y++) {
      cells.push({ x, y, z: 4, fill: 'solid', zone: 'unpaid' })
    }
  }
  const modules = [
    { id: 'exit-in', type: 'exit', x: 1, y: yMid, z: 9, rot: 0, cfg: { name: 'In', open: false, inRate: 0, headHouse: false } },
    { id: 'exit-out', type: 'exit', x: 41, y: yMid, z: 4, rot: 0, cfg: { name: 'Out', open: true, inRate: 0, headHouse: false } },
  ]
  if (twoConnectors) {
    modules.push(
      { id: 'esc-1', type: 'escalator', x: 26, y: 2, z: 9, rot: 0, from: { x: 26, y: 2, z: 9 }, to: { x: 35, y: 2, z: 4 }, cfg: { dir: 'down', width: 1 } },
      { id: 'esc-2', type: 'escalator', x: 26, y: width - 3, z: 9, rot: 0, from: { x: 26, y: width - 3, z: 9 }, to: { x: 35, y: width - 3, z: 4 }, cfg: { dir: 'down', width: 1 } },
    )
  } else {
    modules.push(
      { id: 'esc-1', type: 'escalator', x: 26, y: yMid, z: 9, rot: 0, from: { x: 26, y: yMid, z: 9 }, to: { x: 35, y: yMid, z: 4 }, cfg: { dir: 'down', width: 1 } },
    )
  }
  return { name: twoConnectors ? 'two-connector' : width === 1 ? 'narrow-control' : 'wide-single', seed: 42, cells, modules, lines: [] }
}

function measureCrossSections(worldOpts, { width = 11, wave = 60, spawnTicks = 12, totalTicks = 120, seed = 42 } = {}) {
  const data = buildWideConcourseFixture({ width })
  const w = new World(data, seed, worldOpts)
  const yMid = Math.floor(width / 2)
  const sections = [10, 16] // x=10 (16 m before escalator), x=16 (10 m before escalator)
  const laneHits = Object.fromEntries(sections.map(sx => [sx, new Map()]))
  const perTick = []
  let spawned = 0
  let maxEscQueue = 0

  for (let t = 0; t < totalTicks; t++) {
    if (t < spawnTicks) {
      const batch = Math.ceil((wave - spawned) / (spawnTicks - t))
      for (let k = 0; k < batch && spawned < wave; k++) {
        const a = w.pool.spawn({ origin: 'exit:exit-in', stops: [], dest: 'exit:exit-out' }, 1.5, yMid + 0.5, 10, w.tick)
        if (a) {
          a.needs = { stepFree: false, luggage: false }
          spawned++
        }
      }
    }
    const t0 = performance.now()
    w.tickOnce()
    perTick.push(performance.now() - t0)
    maxEscQueue = Math.max(maxEscQueue, w.metrics.escalatorQueue)
    for (const a of w.pool.live) {
      if (a.dead || a.state !== 1) continue // walking only (outside service queue)
      if (Math.abs(a.z - 10) > 0.25) continue
      const ix = Math.floor(a.x)
      const iy = Math.floor(a.y)
      for (const sx of sections) {
        if (ix >= sx - 1 && ix <= sx + 1) {
          const map = laneHits[sx]
          map.set(iy, (map.get(iy) ?? 0) + 1)
        }
      }
    }
  }

  const sectionStats = {}
  for (const sx of sections) {
    const map = laneHits[sx]
    const total = [...map.values()].reduce((a, b) => a + b, 0)
    const maxLane = total > 0 ? Math.max(...map.values()) : 0
    sectionStats[`x=${sx}`] = {
      occupiedLanes: map.size,
      totalSamples: total,
      busiestLaneShare: total > 0 ? +(maxLane / total).toFixed(4) : 0,
      laneCounts: Object.fromEntries([...map.entries()].sort((a, b) => a[0] - b[0])),
    }
  }
  const esc = w.graph.servers.find(s => s.kind === 'escalator')
  return {
    spawned,
    exited: w.metrics.exited,
    stuck: w.metrics.stuck,
    escalatorServed: esc?.served ?? 0,
    maxEscQueue,
    remainingEscQueue: w.metrics.escalatorQueue,
    sections: sectionStats,
    searches: w.path.searches,
    expansions: w.path.expansions,
    sparseStats: typeof w.routingStats === 'function' ? w.routingStats() : null,
    tick: summarizeMs(perTick),
  }
}

function measureTwoConnector(worldOpts, { seed = 42 } = {}) {
  const data = buildWideConcourseFixture({ width: 11, twoConnectors: true })
  const w = new World(data, seed, worldOpts)
  const escs = w.graph.servers.filter(s => s.kind === 'escalator')
  // Preload esc-1 with 30 queued riders so esc-2 is clearly faster.
  const esc1 = escs[0]
  const esc2 = escs[1]
  for (let i = 0; i < 30; i++) {
    const q = w.pool.spawn({ origin: 'exit:exit-in', stops: [], dest: 'exit:exit-out' }, w.graph.nodeX[esc1.node], w.graph.nodeY[esc1.node], w.graph.nodeZ[esc1.node], 0)
    if (q) {
      q.legs = [{ node: w.graph.exits.find(e => e.id === 'exit-out').node, kind: 'exit', ref: 'exit:exit-out' }]
      q.destNode = q.legs[0].node
      q.needs = { stepFree: false, luggage: false }
      q.path = Int32Array.from([esc1.node, esc1.exitNode])
      q.pathIdx = 1
      q.server = esc1.id
      q.state = 2
      esc1.queue.push(q.id)
    }
  }
  // Spawn 40 fresh passengers from the middle of the hall.
  const arrivals = new Set()
  for (let i = 0; i < 40; i++) {
    const a = w.pool.spawn({ origin: 'exit:exit-in', stops: [], dest: 'exit:exit-out' }, 1.5, 5.5, 10, 0)
    if (a) {
      a.needs = { stepFree: false, luggage: false }
      arrivals.add(a.id)
    }
  }
  const servedBefore1 = esc1.served
  const servedBefore2 = esc2.served
  for (let t = 0; t < 120; t++) w.tickOnce()
  return {
    esc1ServedTotal: esc1.served - servedBefore1,
    esc2ServedTotal: esc2.served - servedBefore2,
    esc1QueueEnd: esc1.queue.length,
    esc2QueueEnd: esc2.queue.length,
    exited: w.metrics.exited,
    stuck: w.metrics.stuck,
    searches: w.path.searches,
    expansions: w.path.expansions,
    sparseStats: typeof w.routingStats === 'function' ? w.routingStats() : null,
  }
}

function measureDemoPeak(demoId, worldOpts, { ticks = 180, seed = 42 } = {}) {
  const data = referenceStation(demoId)
  const w = new World(data, seed, worldOpts)
  w.simTime = 8 * 3600
  const samples = []
  let peakPop = 0
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now()
    w.tickOnce()
    samples.push(performance.now() - t0)
    if (w.pool.count > peakPop) peakPop = w.pool.count
  }
  return {
    demo: demoId,
    nodes: w.graph.nodeCount,
    ticks,
    peakPop,
    finalPop: w.pool.count,
    boarded: w.metrics.boarded,
    alighted: w.metrics.alighted,
    exited: w.metrics.exited,
    stuck: w.metrics.stuck,
    searches: w.path.searches,
    cacheHits: w.path.cacheHits,
    expansions: w.path.expansions,
    sparseStats: typeof w.routingStats === 'function' ? w.routingStats() : null,
    tick: summarizeMs(samples),
  }
}

const mode = process.argv.includes('--legacy') ? 'legacy' : process.argv.includes('--sparse') ? 'sparse' : 'default'
const worldOpts = mode === 'default' ? {} : { routingMode: mode }
const skipDemos = process.argv.includes('--no-demos')
const onlyTianhe = process.argv.includes('--tianhe-only')

const report = {
  timestamp: new Date().toISOString(),
  mode,
  environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model },
  wideSingle: measureCrossSections(worldOpts, { width: 11 }),
  narrowControl: measureCrossSections(worldOpts, { width: 1 }),
  twoConnector: measureTwoConnector(worldOpts),
  demos: {},
}

if (!skipDemos) {
  const list = onlyTianhe ? ['tianhe'] : ['zoo', 'tanwei', 'tianhe']
  for (const id of list) {
    report.demos[id] = measureDemoPeak(id, worldOpts, { ticks: 180, seed: 42 })
  }
}

const outPath = resolve(process.env.BENCH_OUTPUT ?? `.preview/crowd-routing/web-${mode}.json`)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.error(`Wrote ${outPath}`)
