// The worker wrapper — the only sim file that touches postMessage (§3 layout).
// Each tick is one synchronous task: run the world, then post. No await, no
// per-agent microtasks (PLAN.md §2.4).

import { TICK_HZ } from './constants.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import type { Metrics } from './world.ts'
import { World } from './world.ts'

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: string, fn: (e: MessageEvent) => void): void
  setInterval(fn: () => void, ms: number): number
}

let world: World | null = null
let playing = false
let speed = 1
let buffer = new Float32Array(0)
let density = new Float32Array(0)

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer)
}

function metricsOf(w: World): Metrics {
  return { ...w.metrics }
}

function run(): void {
  if (!world) return
  if (playing) {
    for (let i = 0; i < speed; i++) world.tickOnce()
  }
  const w = world
  const need = w.pool.count * 5
  if (buffer.length < need) buffer = new Float32Array(Math.max(need, 4096))
  const count = w.writeTransfer(buffer)
  // Density for the LOS overlay: one value per graph node.
  if (density.length !== w.nodePop.length) density = new Float32Array(w.nodePop.length)
  density.set(w.nodePop)
  // Post copies (not transfers) so the worker keeps ownership of its buffers;
  // the payload is ~120 KB and the main thread keeps prev/next anyway.
  post({
    type: 'state',
    count,
    agents: buffer.slice(0, count * 5),
    metrics: metricsOf(w),
    density: density.slice(),
  })
}

ctx.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as ToWorker
  switch (msg.type) {
    case 'init': {
      world = new World(msg.data, msg.seed)
      playing = msg.playing
      speed = msg.speed
      if (msg.startSeconds !== undefined) world.simTime = msg.startSeconds
      // Warm the station so the demo does not open on an empty floor. This is
      // just ticks: §7.6 determinism is unaffected.
      const warm = msg.warmup ?? 0
      for (let i = 0; i < warm; i++) world.tickOnce()
      const g = world.graph
      const nodes = new Float32Array(g.nodeCount * 3)
      for (let i = 0; i < g.nodeCount; i++) {
        nodes[i * 3] = g.nodeX[i]
        nodes[i * 3 + 1] = g.nodeY[i]
        nodes[i * 3 + 2] = g.nodeZ[i]
      }
      post(
        {
          type: 'ready',
          nodeCount: g.nodeCount,
          nodes,
          exits: g.exits.map((x) => ({ id: x.id, name: x.name, node: x.node })),
          platforms: g.platforms.map((p) => ({ id: p.id, name: p.name, line: p.line, doors: p.doors.length, cells: p.cells })),
          levelsZ: g.levelsZ,
        },
        [nodes.buffer],
      )
      run()
      break
    }
    case 'build': {
      if (world) {
        world.data = msg.data
        world.rebuild()
      }
      break
    }
    case 'control': {
      playing = msg.playing
      speed = msg.speed
      break
    }
  }
})

ctx.setInterval(run, 1000 / TICK_HZ)
