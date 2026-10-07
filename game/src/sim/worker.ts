// The worker wrapper — the only sim file that touches postMessage (§3 layout).
// Each tick is one synchronous task: run the world, then post. No await, no
// per-agent microtasks (PLAN.md §2.4).

import { BASE_TICK_MS } from './constants.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import type { Metrics } from './world.ts'
import { World } from './world.ts'

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: string, fn: (e: MessageEvent) => void): void
  setInterval(fn: () => void, ms: number): number
  clearInterval(id: number): void
}

let world: World | null = null
let playing = false
let speed = 1
let timer: number | null = null
let buffer = new Float32Array(0)
let density = new Float32Array(0)
/**
 * The newest route-preview request and its token. The token is echoed on every
 * frame so the renderer can tell a frame computed *before* it asked (which says
 * "nobody is selected") from an answer to its own request ("that passenger has
 * left the station") — the two look identical without it.
 */
let agentToken = 0
/** The shared empty route, so a frame with nothing selected allocates nothing. */
const NO_ROUTE = new Float32Array(0)
/**
 * Something the renderer has not been told about yet.
 *
 * While the sim is paused the *station* can still change — an edit, a restart, a
 * speed change — and those have to reach the screen. But a paused tick that changed
 * nothing has no news to post, and the old `run()` built and cloned a full ~150 KB
 * snapshot every interval anyway (1/4/16 Hz regardless of `playing`): pure garbage,
 * a store write and an O(agents x gates) crossing scan per message, for data that
 * was already on screen. So a paused `run` with nothing dirty returns immediately.
 */
let dirty = true

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer)
}

function metricsOf(w: World): Metrics {
  return { ...w.metrics }
}

/** Real milliseconds between ticks at the current speed; 1x is real time. */
function intervalMs(): number {
  const s = speed > 0 ? speed : 1
  return Math.max(4, BASE_TICK_MS / s)
}

/**
 * Is the clock running? One tick per fire, and news on every fire. Both `run` and
 * the messages that only *show* something read this, so "what advances the sim" is
 * asked in one place.
 */
function stepping(): boolean {
  return playing && speed > 0
}

function run(): void {
  if (!world) return
  if (stepping()) world.tickOnce()
  // Paused with nothing changed since the last frame: there is no news to post.
  else if (!dirty) return
  dirty = false
  const w = world
  const need = w.pool.count * 6
  if (buffer.length < need) buffer = new Float32Array(Math.max(need, 4096))
  const count = w.writeTransfer(buffer)
  // Density for the LOS overlay: one value per graph node.
  if (density.length !== w.nodePop.length) density = new Float32Array(w.nodePop.length)
  density.set(w.nodePop)
  // The 选择 tool's route preview, rebuilt for the one passenger it belongs to and
  // null when that passenger is no longer in the world. Its buffer is transferred
  // rather than copied: nothing here keeps it.
  const route = w.selectedAgent >= 0 ? w.routeOf(w.selectedAgent) : null
  const points = route ?? NO_ROUTE
  // Post copies (not transfers) so the worker keeps ownership of its buffers;
  // the payload is ~145 KB and the main thread keeps prev/next anyway.
  post({
    type: 'state',
    count,
    agents: buffer.slice(0, count * 6),
    metrics: metricsOf(w),
    density: density.slice(),
    trains: w.trainRenderState(),
    lifts: w.liftRenderState(),
    // The renderer interpolates between snapshots over exactly this window, so
    // speed stays even no matter which multiplier is selected.
    intervalMs: intervalMs(),
    route: points,
    routeAgent: route ? w.selectedAgent : -1,
    routeToken: agentToken,
  }, route ? [points.buffer] : [])
}

/** One tick per fire. Speed multiplies ticks per second, never the step. */
function schedule(): void {
  if (timer !== null) ctx.clearInterval(timer)
  timer = ctx.setInterval(run, intervalMs())
}

ctx.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as ToWorker
  switch (msg.type) {
    case 'init': {
      // The first `init` boots a world; sending it again loads a different
      // station. Either way it is a full reset — no agent, train, queue or clock
      // survives. Live edits use `build`, which keeps the crowd on purpose.
      if (world) world.load(msg.data, msg.seed, msg.startSeconds)
      else {
        world = new World(msg.data, msg.seed)
        if (msg.startSeconds !== undefined) world.simTime = msg.startSeconds
      }
      playing = msg.playing
      speed = msg.speed
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
      schedule()
      dirty = true
      run()
      break
    }
    case 'build': {
      if (world) {
        world.data = msg.data
        world.rebuild()
        // The edit has to reach the screen now: while paused there is no stream to
        // carry it later, which is the other half of the dirty flag.
        dirty = true
        run()
      }
      break
    }
    case 'control': {
      playing = msg.playing
      speed = msg.speed
      schedule()
      dirty = true
      run()
      break
    }
    case 'restart': {
      // Empty the crowd but keep the station document and the clock. The next
      // `run` posts the cleared state immediately, even while paused.
      if (world) {
        world.restart()
        dirty = true
        run()
      }
      break
    }
    case 'seek': {
      // The scrub (the 时刻 window's calendar pick): the clock moves, the station and the crowd
      // stay. Posted straight away, because a paused sim has no stream to carry it later.
      if (world) {
        world.seek(msg.seconds)
        dirty = true
        run()
      }
      break
    }
    case 'selectAgent': {
      // A preview is not an edit: the world — and so the clock the passenger is
      // walking on — is untouched. The renderer has to be told *now* only when
      // nothing else is about to tell it: a running sim carries the route on its
      // next tick, and stepping the world here would make *watching* a passenger
      // advance the simulation (§7.6: `routeOf` is an observation).
      if (world) world.selectedAgent = msg.id
      agentToken = msg.token
      dirty = true
      if (!stepping()) run()
      break
    }
  }
})
