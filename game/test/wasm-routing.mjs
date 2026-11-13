import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import init, { Router, probe } from '../generated/wasm/metro_routing.js'
import { EDGE_KIND, PathFinder } from '../src/sim/station.ts'
import { World } from '../src/sim/world.ts'
import { WasmRouting } from '../src/sim/wasmRouting.ts'
import { EXAMPLE_STATION_IDS, referenceStation } from '../src/data/reference-station.ts'

await init({ module_or_path: readFileSync(new URL('../generated/wasm/metro_routing_bg.wasm', import.meta.url)) })
assert.equal(probe(), 42)

const walker = { stepFree: false, luggage: false }
const stepFree = { stepFree: true, luggage: false }
const luggage = { stepFree: false, luggage: true }

function pair(graph, kernel) {
  kernel.install(graph)
  const ts = new PathFinder(graph)
  const wasm = new PathFinder(graph)
  wasm.routeSearch = kernel.search
  wasm.onSearchFailure = error => assert.fail(String(error))
  return [ts, wasm]
}

function diamond(secondCost = 1, firstKind = EDGE_KIND.walk, secondKind = EDGE_KIND.walk) {
  return {
    nodeCount: 5,
    nodeX: Float32Array.of(0, 1, 1, 2, 3),
    nodeY: Float32Array.of(0, 1, -1, 0, 0),
    nodeZ: new Float32Array(5),
    nodeZone: Uint8Array.of(2, 3, 3, 3, 0),
    adjStart: Int32Array.of(0, 2, 3, 4, 4, 4),
    adjTo: Int32Array.of(1, 2, 3, 3),
    adjCost: Float32Array.of(1, secondCost, 1, 1),
    adjKind: Uint8Array.of(firstKind, secondKind, 0, 0),
    adjServer: new Int32Array(4).fill(-1),
    servers: [],
    serverForNode: new Map(),
  }
}

test('equal branches, unreachable nodes, step-free costs and queued completion order match', () => {
  const kernel = new WasmRouting(Router)
  try {
    const paths = pair(diamond(), kernel)
    for (const path of paths) {
      assert.deepEqual(path.search(0, 3, walker), Int32Array.of(0, 1, 3))
      assert.equal(path.search(0, 4, walker), null)
      path.request(10, 0, 3, walker)
      path.request(11, 0, 3, walker)
      path.request(12, 0, 4, walker)
      assert.deepEqual(path.process(1).map(req => req.agentId), [10, 11])
      assert.deepEqual(path.process(1).map(req => req.agentId), [12])
      assert.deepEqual(path.request(13, 0, 3, walker), Int32Array.of(0, 1, 3))
    }
    const [ts, wasm] = pair(diamond(2, EDGE_KIND.stair, EDGE_KIND.lift), kernel)
    for (const needs of [walker, stepFree, luggage]) {
      assert.deepEqual(wasm.search(0, 3, needs), ts.search(0, 3, needs))
    }
    assert.deepEqual(wasm.search(0, 3, stepFree), Int32Array.of(0, 2, 3))
    // A tiny Z difference exercises rounding in the heuristic on near-equal branches.
    const nearTie = diamond()
    nearTie.nodeZ[1] = 2 ** -26
    const [nearTs, nearWasm] = pair(nearTie, kernel)
    assert.deepEqual(nearWasm.search(0, 3, walker), nearTs.search(0, 3, walker))
  } finally { kernel.dispose() }
})

test('directional forecasts, regular waits and congestion stay live across searches', () => {
  const graph = diamond()
  graph.servers.push({ kind: 'gate', rate: 1, queue: [] })
  graph.serverForNode.set(1, 0)
  graph.adjServer[2] = 0
  const kernel = new WasmRouting(Router)
  try {
    const paths = pair(graph, kernel)
    let wait = 0
    for (const path of paths) path.gateWait = (_server, dir) => dir === 1 ? wait : 50
    for (const path of paths) assert.deepEqual(path.search(0, 3, walker), Int32Array.of(0, 1, 3))
    wait = 10
    for (const path of paths) assert.deepEqual(path.search(0, 3, walker), Int32Array.of(0, 2, 3))
    wait = 0
    graph.servers[0].queue.push(1)
    for (const path of paths) assert.deepEqual(path.search(0, 3, walker), Int32Array.of(0, 2, 3))
    for (const path of paths) {
      path.congestion[2] = 2
      assert.deepEqual(path.search(0, 3, walker), Int32Array.of(0, 1, 3))
    }
  } finally { kernel.dispose() }
})

test('a malformed result retries the same queued request once in TypeScript', () => {
  class InvalidRouter extends Router {
    route() { return Int32Array.of(0, -1, 3) }
  }
  const kernel = new WasmRouting(InvalidRouter)
  try {
    const graph = diamond()
    const [ts, wasm] = pair(graph, kernel)
    const errors = []
    wasm.onSearchFailure = error => errors.push(String(error))
    for (const path of [ts, wasm]) path.request(42, 0, 3, walker)
    assert.deepEqual(wasm.process(1), ts.process(1))
    assert.deepEqual(wasm.request(43, 0, 3, walker), ts.request(43, 0, 3, walker))
    assert.equal(wasm.searches, 1)
    assert.equal(wasm.routeSearch, null)
    assert.deepEqual(errors, ['Error: Invalid WASM route'])
  } finally { kernel.dispose() }
})

function fingerprint(world) {
  const { tickMs, ...metrics } = world.metrics
  const agents = world.pool.live.map(a => [a.id, a.state, a.x, a.y, a.z, a.pathIdx, [...a.path]])
  const sample = [metrics, agents, [...world.trainRenderState()], [...world.liftRenderState()]]
  return createHash('sha256').update(JSON.stringify(sample)).digest('hex')
}

for (const id of EXAMPLE_STATION_IDS) {
  test(`seeded passenger, clock, train and lift trace matches on ${id}`, () => {
    const data = referenceStation(id)
    const ts = new World(data, 1234)
    const wasm = new World(data, 1234)
    const kernel = new WasmRouting(Router)
    let searches = 0
    function install() {
      kernel.install(wasm.graph)
      wasm.path.onSearchFailure = error => assert.fail(String(error))
      wasm.path.routeSearch = (...args) => {
        searches++
        return kernel.search(...args)
      }
    }
    try {
      install()
      for (let tick = 1; tick <= 180; tick++) {
        if (tick === 90) {
          ts.rebuild()
          wasm.rebuild()
          install()
        }
        ts.tickOnce()
        wasm.tickOnce()
        assert.equal(fingerprint(wasm), fingerprint(ts), `tick ${tick}`)
        assert.deepEqual([...wasm.path.cache], [...ts.path.cache], `cached routes at tick ${tick}`)
      }
      assert.ok(searches > 0)
      assert.ok(wasm.metrics.trainArrivals > 0)
    } finally { kernel.dispose() }
  })
}
