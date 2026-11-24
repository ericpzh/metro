import { msg } from '../../../sim/i18n.ts'
import { populationEdit } from '../../../sim/populationEdit.ts'
import { stationEdit } from '../../../sim/stationEdit.ts'
// The sim slice: the worker plumbing and the live readouts it feeds. The station
// document lives in the store; the sim lives in the worker and is driven by the
// messages in `sim/protocol.ts`. Panels only — no sim logic.

import type { StateCreator } from 'zustand'
import type { GraphInfo, FromWorker, RoutingDiagnostic } from '../../../sim/protocol.ts'
import type { StationData } from '../../../sim/types.ts'
import type { Metrics } from '../../../sim/world.ts'
import type { TrainService } from '../../../sim/trainSchedule.ts'
import type { SceneStats } from '../../../render/scene.ts'
import { DEFAULT_SIM_TIME } from '../../../sim/constants.ts'
import { HISTORY_STRIDE, SAMPLE_SECONDS } from '../../../sim/history.ts'
import { simTimeAtDate, type SimDate } from '../../../sim/clock.ts'
import { timeOfDayOf } from '../../../sim/constants.ts'
import type { AppState } from '../Store.ts'
import { useStore } from '../Store.ts'

/**
 * The run's own record as the app holds it (§8.1, the 数据 window): the sim's
 * interleaved samples, `HISTORY_STRIDE` floats each, kept in a buffer that grows with
 * the run. `count` is how many of them are real — the array is usually larger.
 */
export interface HistorySeries {
  /** Sim seconds sample 0 stands on, for the x axis' own labels. */
  start: number
  /** Seconds between samples. */
  step: number
  values: Float32Array
  count: number
}

/** What one `state` message says about the record: a fresh run, or the new samples. */
export interface HistoryUpdate {
  values: Float32Array
  from: number
  reset: boolean
  start: number
  step: number
}

const EMPTY_HISTORY: HistorySeries = {
  start: DEFAULT_SIM_TIME,
  step: SAMPLE_SECONDS,
  values: new Float32Array(0),
  count: 0,
}

export interface SimSlice {
  playing: boolean
  speed: number
  metrics: Metrics | null
  /**
   * The Unity host's station clock, in seconds since the station's day zero — the
   * fallback the time readers use after `metrics?.simTime` (`TimePanel`, `ClockCard`).
   * The browser game never sets it, so the TS app is untouched; only
   * `unity-web/simulationAdapter.ts` feeds it from the C# session's `payload.clock`
   * (plan 11 C4). Null means "no Unity session has reported a clock".
   */
  unityClock: number | null
  stats: SceneStats | null
  graph: GraphInfo | null
  history: HistorySeries

  setPlaying: (on: boolean) => void
  setSpeed: (s: number) => void
  /** Clear every agent, train and queue, keeping the built station. */
  restartSim: () => void
  setMetrics: (m: Metrics) => void
  /** Fold the Unity session's clock in, or clear it when the session goes away. */
  setUnityClock: (seconds: number | null) => void
  setStats: (s: SceneStats) => void
  setGraph: (g: GraphInfo | null) => void
  /** Fold one frame's worth of the run's record in — replace on a reset, append otherwise. */
  setHistory: (update: HistoryUpdate) => void
  /**
   * Move the station's clock to `date`, keeping the time of day — the 时刻 window's calendar pick
   * (§7.9's scrub). The day type the crowd runs is derived from the date the clock stands on, so
   * this is how the player chooses to run a Saturday or a statutory holiday: the date, the curve,
   * the card's chip and the crowd are all that day's afterwards.
   */
  seekToDate: (date: SimDate) => void
}

function sendControl(playing: boolean, speed: number): void {
  client?.postMessage({ type: 'control', playing, speed })
}

let client: Worker | null = null
let benchmarkBackend: 'ts' | 'wasm' | undefined
let routingDiagnostic: RoutingDiagnostic | undefined

export function prepareBenchmarkWorker(backend: 'ts' | 'wasm'): void {
  client?.terminate()
  client = null
  latestFrame = null
  latestGraph = null
  latestDensity = null
  expectedStationGen = 0
  densityCb?.(null)
  sentStation = null
  benchmarkBackend = backend
  routingDiagnostic = undefined
  delete (window as Window & { __metroRouting?: RoutingDiagnostic }).__metroRouting
  useStore.setState({ metrics: null, graph: null })
}

export function benchmarkRoutingDiagnostic(): RoutingDiagnostic | undefined {
  return routingDiagnostic
}
let sentStation: StationData | null = null
const LARGE_WORKER_DOCUMENT = 20_000
let frameCb:
  | ((
      count: number,
      agents: Float32Array,
      density: Float32Array,
      trains: Float32Array,
      lifts: Float32Array,
      intervalMs: number,
      /** Sim seconds since midnight, for the in-world clocks (a 电视 plate). */
      simTime: number,
      trainServices: TrainService[],
      /** Authoritative worker tick ID for this snapshot. */
      tick?: number,
    ) => void)
  | null = null

export type FrameHandler = NonNullable<Parameters<typeof setFrameHandler>[0]>
const frameListeners = new Set<FrameHandler>()
let latestFrame: Parameters<FrameHandler> | null = null

/** Additional views observe the same simulation without replacing the main viewport. */
export function subscribeFrame(fn: FrameHandler): () => void {
  frameListeners.add(fn)
  if (latestFrame) fn(...latestFrame)
  return () => { frameListeners.delete(fn) }
}

/** Replay the latest worker snapshot after the editor renderer is recreated. */
export function replayFrameHandler(): void {
  if (frameCb && latestFrame) frameCb(...latestFrame)
}

/**
 * The 选择 tool's route preview, as the worker sends it: xyz waypoints and the
 * passenger they belong to. It rides the frame callback rather than the store
 * because it changes every tick — putting it in zustand would re-render the
 * panels for a line only the 3D view draws.
 */
let routeCb: ((points: Float32Array, agentId: number) => void) | null = null

/** Viewport registers here to receive the agent frame without re-rendering React. */
export function setFrameHandler(
  fn:
    | ((
        count: number,
        agents: Float32Array,
        density: Float32Array,
        trains: Float32Array,
        lifts: Float32Array,
        intervalMs: number,
        /** Sim seconds since midnight, for the in-world clocks (a 电视 plate). */
        simTime: number,
        trainServices: TrainService[],
        /** Authoritative worker tick ID for this snapshot. */
        tick?: number,
      ) => void)
    | null,
): void {
  frameCb = fn
}

/** Viewport registers here to receive the selected passenger's route. */
export function setRouteHandler(fn: ((points: Float32Array, agentId: number) => void) | null): void {
  routeCb = fn
}

export interface DensitySample {
  graph: GraphInfo
  density: Float32Array
}
export type DensityHandler = (sample: DensitySample | null) => void

let densityCb: DensityHandler | null = null
let expectedStationGen = 0
let latestGraph: GraphInfo | null = null
let latestDensity: { stationGen: number; graphRev: number; density: Float32Array } | null = null

/** Viewport registers here to receive graph-paired density updates without re-rendering React. */
export function setDensityHandler(fn: DensityHandler | null): void {
  densityCb = fn
}

/** Replay the latest density sample after renderer recreation only when it matches the installed graph. */
export function replayDensityHandler(): void {
  if (!densityCb) return
  if (
    latestGraph &&
    latestDensity &&
    latestDensity.stationGen === latestGraph.stationGen &&
    latestDensity.graphRev === latestGraph.graphRev &&
    latestDensity.density.length === latestGraph.nodeCount
  ) {
    densityCb({ graph: latestGraph, density: latestDensity.density })
  } else {
    densityCb(null)
  }
}

function consumeDensity(stationGen: number | undefined, graphRev: number | undefined, density: Float32Array): void {
  if (density.length === 0) return
  if (
    !latestGraph ||
    stationGen !== latestGraph.stationGen ||
    graphRev !== latestGraph.graphRev ||
    density.length !== latestGraph.nodeCount
  ) {
    return
  }
  latestDensity = { stationGen, graphRev, density }
  densityCb?.({ graph: latestGraph, density })
}

/** The newest route request's token, echoed by the worker. */
let agentToken = 0
/** The passenger being previewed, or -1. */
let agentSelected = -1
/** Whether the LOS density overlay currently demands per-node density buffers. */
let densityDemand = false

export function setSimDensityDemand(enabled: boolean): void {
  const changed = densityDemand !== enabled
  densityDemand = enabled
  if (!enabled) {
    latestDensity = null
    densityCb?.(null)
  }
  if (client && (changed || enabled)) client.postMessage({ type: 'densityDemand', enabled })
}

/**
 * Preview one passenger's route, or put the line away with `null`. The token
 * travels with the request and comes back on every frame, which is what tells a
 * frame the worker had already built when the click happened — one that names
 * nobody, or names the passenger selected *before* — from an answer to this
 * request. Without it the selection would clear itself on the first stale frame,
 * and moving the preview from one passenger to another would flash the last
 * one's line for as long as a message is in flight.
 */
export function selectSimAgent(id: number | null): void {
  agentSelected = id === null || id < 0 ? -1 : id
  agentToken++
  client?.postMessage({ type: 'selectAgent', id: agentSelected, token: agentToken })
}

/** Open the worker once and wire its messages. A station switch reuses it. */
function ensureClient(): Worker {
  if (client) return client
  client = new Worker(new URL('../../../sim/worker.ts', import.meta.url), { type: 'module' })
  if (import.meta.env?.MODE === 'wasm-experiment' && typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const params = new URLSearchParams(location.search)
    if ((benchmarkBackend ?? params.get('sim')) === 'wasm') {
      const fault = params.get('wasmFault')
      client.postMessage({ type: 'enableWasm', fault: fault === 'missing' || fault === 'search' ? fault : undefined })
    }
  }
  client.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'routing') {
      const host = window as Window & { __metroRouting?: RoutingDiagnostic }
      routingDiagnostic = msg
      host.__metroRouting = msg
    } else if (msg.type === 'ready') {
      if (expectedStationGen > 0 && msg.stationGen !== expectedStationGen) return
      latestGraph = msg
      latestDensity = null
      densityCb?.(null)
      useStore.getState().setGraph(msg)
      // The active storey is already chosen by the load path (basis floor or the
      // lowest level with user placement); the worker's level list includes the
      // infinite ground plane at 0 m, which must not drag the view down to grade.
    } else if (msg.type === 'density') {
      if (expectedStationGen > 0 && msg.stationGen !== expectedStationGen) return
      consumeDensity(msg.stationGen, msg.graphRev, msg.density)
    } else if (msg.type === 'state') {
      if (msg.stationGen !== undefined && expectedStationGen > 0 && msg.stationGen !== expectedStationGen) return
      if (typeof window !== 'undefined') {
        const deliveredAt = performance.timeOrigin + performance.now()
        const postedAt = msg.postedAt ?? deliveredAt
        const host = window as Window & {
          __metroPublication?: {
            workerCompletedTicks: number
            workerTimerMisses: number
            deliveredTick: number
            deliveredCount: number
            postedAt: number
            deliveredAt: number
            deliveryLagMs: number
          }
        }
        const prev = host.__metroPublication
        const deliveredCount = (prev?.deliveredCount ?? 0) + 1
        host.__metroPublication = {
          workerCompletedTicks: msg.workerCompletedTicks ?? msg.metrics.tick,
          workerTimerMisses: msg.workerTimerMisses ?? 0,
          deliveredTick: msg.metrics.tick,
          deliveredCount,
          postedAt,
          deliveredAt,
          deliveryLagMs: Math.max(0, deliveredAt - postedAt),
        }
      }
      useStore.getState().setMetrics(msg.metrics)
      useStore.getState().setHistory({
        values: msg.history,
        from: msg.historyFrom,
        reset: msg.historyReset,
        start: msg.historyStart,
        step: msg.historyStep,
      })
      if (agentSelected >= 0 && msg.routeToken === agentToken && msg.routeAgent !== agentSelected) {
        // This frame is the worker's own answer to the newest selection, and the
        // passenger is not in the world: the selection goes with them, so the 信息
        // card never keeps pointing at somebody who has already left the station.
        agentSelected = -1
        useStore.getState().select(null)
      }
      frameCb?.(msg.count, msg.agents, msg.density, msg.trains, msg.lifts, msg.intervalMs, msg.metrics.simTime, msg.trainServices, msg.metrics.tick)
      latestFrame = [msg.count, msg.agents, msg.density, msg.trains, msg.lifts, msg.intervalMs, msg.metrics.simTime, msg.trainServices, msg.metrics.tick]
      for (const listener of frameListeners) listener(...latestFrame)
      // After the frame: the route is drawn against the positions just posted. A
      // frame answering an *older* request is dropped rather than fed to the scene —
      // a click that moves the preview to another passenger must not flash the last
      // one's line for the interval a message is in flight.
      if (msg.routeToken === agentToken) routeCb?.(msg.route, msg.routeAgent)
      consumeDensity(msg.stationGen, msg.graphRev, msg.density)
    }
  }
  return client
}

/** Boots the worker on the initial document. Called once from boot.tsx. The game opens
 * paused — the player presses play (or Space) to start the crowd. */
export function initSim(data: StationData, seed: number, opts: { startSeconds?: number; warmup?: number } = {}): void {
  latestFrame = null
  latestGraph = null
  latestDensity = null
  expectedStationGen++
  densityCb?.(null)
  useStore.getState().setGraph(null)
  // A full reset drops every passenger, so the previewed one goes with them — the
  // world's own `selectedAgent` is cleared with the crowd it belonged to.
  agentSelected = -1
  const created = !client
  const w = ensureClient()
  if (created && densityDemand) w.postMessage({ type: 'densityDemand', enabled: true })
  w.postMessage({ type: 'init', data, seed, playing: false, speed: 1, stationGen: expectedStationGen, ...opts })
  sentStation = data
}

export function rebuildSim(data: StationData, previous?: StationData): void {
  if (!client) return
  const edit = previous ? populationEdit(previous, data) : null
  if (edit) client.postMessage({ type: 'population', edit })
  else {
    const delta = previous && sentStation?.cells === previous.cells && sentStation.modules === previous.modules &&
      data.cells.length + data.modules.length >= LARGE_WORKER_DOCUMENT ? stationEdit(previous, data) : null
    client.postMessage(delta ? { type: 'build-edit', edit: delta } : { type: 'build', data })
  }
  sentStation = data
}

/**
 * Load a station into the running worker. `init` is a full reset — every agent,
 * train, queue and the clock start over — so a switch never leaves the old
 * crowd walking the new document. Live edits use `rebuildSim`, which keeps it.
 */
export function loadSim(data: StationData, opts: { startSeconds?: number; warmup?: number } = {}): void {
  latestFrame = null
  latestGraph = null
  latestDensity = null
  expectedStationGen++
  densityCb?.(null)
  useStore.getState().setGraph(null)
  const st = useStore.getState()
  // Same reset as `initSim`: the crowd starts over, so the previewed passenger is
  // not one of the new station's agents.
  agentSelected = -1
  const created = !client
  const w = ensureClient()
  if (created && densityDemand) w.postMessage({ type: 'densityDemand', enabled: true })
  w.postMessage({ type: 'init', data, seed: data.seed, playing: st.playing, speed: st.speed, stationGen: expectedStationGen, ...opts })
  sentStation = data
}

export const createSimSlice: StateCreator<AppState, [], [], SimSlice> = (set, get) => ({
  playing: false,
  speed: 1,
  metrics: null,
  unityClock: null,
  stats: null,
  graph: null,
  history: EMPTY_HISTORY,

  setPlaying: (on) => {
    sendControl(on, get().speed)
    set({ playing: on })
  },
  setSpeed: (s) => {
    sendControl(get().playing, s)
    set({ speed: s })
  },
  setUnityClock: (seconds) => set({ unityClock: seconds }),
  restartSim: () => {
    client?.postMessage({ type: 'restart' })
    set({ notice: msg('all_passengers_cleared') })
  },
  setMetrics: (m) => set({ metrics: m }),
  setHistory: (update) =>
    set((s) => {
      // A new run: the whole series arrives at once and the old one is dropped.
      if (update.reset) {
        return {
          history: {
            start: update.start,
            step: update.step,
            values: update.values.slice(),
            count: update.values.length / HISTORY_STRIDE,
          },
        }
      }
      // 59 ticks in 60 have no new sample: no store write, no re-render.
      if (update.values.length === 0) return {}
      const count = update.from + update.values.length / HISTORY_STRIDE
      const held = s.history
      let values = held.values
      const need = count * HISTORY_STRIDE
      if (values.length < need) {
        let size = values.length || HISTORY_STRIDE * 64
        while (size < need) size *= 2
        const next = new Float32Array(size)
        next.set(values)
        values = next
      }
      values.set(update.values, update.from * HISTORY_STRIDE)
      return { history: { start: update.start, step: update.step, values, count } }
    }),
  setStats: (s) => set({ stats: s }),
  setGraph: (g) => set({ graph: g }),
  seekToDate: (date) => {
    const { station, metrics } = get()
    // The time of day is kept, so picking a date asks "run this day", not "start it at midnight".
    // A sim that has not reported a frame yet has no clock to keep: it seeks to midnight.
    const timeOfDay = metrics === null ? 0 : timeOfDayOf(metrics.simTime)
    client?.postMessage({ type: 'seek', seconds: simTimeAtDate(date, station.calendar.epoch, timeOfDay) })
  },
})
