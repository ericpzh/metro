// The sim slice: the worker plumbing and the live readouts it feeds. The station
// document lives in the store; the sim lives in the worker and is driven by the
// messages in `sim/protocol.ts`. Panels only — no sim logic.

import type { StateCreator } from 'zustand'
import type { GraphInfo, FromWorker } from '../../../sim/protocol.ts'
import type { StationData } from '../../../sim/types.ts'
import type { Metrics } from '../../../sim/world.ts'
import type { SceneStats } from '../../../render/scene.ts'
import type { AppState } from '../Store.ts'
import { useStore } from '../Store.ts'

export interface SimSlice {
  playing: boolean
  speed: number
  metrics: Metrics | null
  stats: SceneStats | null
  graph: GraphInfo | null

  setPlaying: (on: boolean) => void
  setSpeed: (s: number) => void
  /** Clear every agent, train and queue, keeping the built station. */
  restartSim: () => void
  setMetrics: (m: Metrics) => void
  setStats: (s: SceneStats) => void
  setGraph: (g: GraphInfo) => void
}

function sendControl(playing: boolean, speed: number): void {
  client?.postMessage({ type: 'control', playing, speed })
}

let client: Worker | null = null
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
    ) => void)
  | null = null

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
      ) => void)
    | null,
): void {
  frameCb = fn
}

/** Viewport registers here to receive the selected passenger's route. */
export function setRouteHandler(fn: ((points: Float32Array, agentId: number) => void) | null): void {
  routeCb = fn
}

/** The newest route request's token, echoed by the worker. */
let agentToken = 0
/** The passenger being previewed, or -1. */
let agentSelected = -1

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
  client.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'ready') {
      useStore.getState().setGraph(msg)
      // Open on the deepest built level so the platform crowd is what you see.
      if (msg.levelsZ.length > 0) useStore.getState().setActiveZ(msg.levelsZ[0])
    } else if (msg.type === 'state') {
      useStore.getState().setMetrics(msg.metrics)
      if (agentSelected >= 0 && msg.routeToken === agentToken && msg.routeAgent !== agentSelected) {
        // This frame is the worker's own answer to the newest selection, and the
        // passenger is not in the world: the selection goes with them, so the 信息
        // card never keeps pointing at somebody who has already left the station.
        agentSelected = -1
        useStore.getState().select(null)
      }
      frameCb?.(msg.count, msg.agents, msg.density, msg.trains, msg.lifts, msg.intervalMs, msg.metrics.simTime)
      // After the frame: the route is drawn against the positions just posted. A
      // frame answering an *older* request is dropped rather than fed to the scene —
      // a click that moves the preview to another passenger must not flash the last
      // one's line for the interval a message is in flight.
      if (msg.routeToken === agentToken) routeCb?.(msg.route, msg.routeAgent)
    }
  }
  return client
}

/** Boots the worker on the demo. Called once from boot.tsx. The game opens
 * paused — the player presses play (or Space) to start the crowd. */
export function initSim(data: StationData, seed: number, opts: { startSeconds?: number; warmup?: number } = {}): void {
  // A full reset drops every passenger, so the previewed one goes with them — the
  // world's own `selectedAgent` is cleared with the crowd it belonged to.
  agentSelected = -1
  ensureClient().postMessage({ type: 'init', data, seed, playing: false, speed: 1, ...opts })
}

export function rebuildSim(data: StationData): void {
  client?.postMessage({ type: 'build', data })
}

/**
 * Load a station into the running worker. `init` is a full reset — every agent,
 * train, queue and the clock start over — so a switch never leaves the old
 * crowd walking the new document. Live edits use `rebuildSim`, which keeps it.
 */
export function loadSim(data: StationData, opts: { startSeconds?: number; warmup?: number } = {}): void {
  const st = useStore.getState()
  // Same reset as `initSim`: the crowd starts over, so the previewed passenger is
  // not one of the new station's agents.
  agentSelected = -1
  ensureClient().postMessage({ type: 'init', data, seed: data.seed, playing: st.playing, speed: st.speed, ...opts })
}

export const createSimSlice: StateCreator<AppState, [], [], SimSlice> = (set, get) => ({
  playing: false,
  speed: 1,
  metrics: null,
  stats: null,
  graph: null,

  setPlaying: (on) => {
    sendControl(on, get().speed)
    set({ playing: on })
  },
  setSpeed: (s) => {
    sendControl(get().playing, s)
    set({ speed: s })
  },
  restartSim: () => {
    client?.postMessage({ type: 'restart' })
    set({ notice: '已清空所有行人' })
  },
  setMetrics: (m) => set({ metrics: m }),
  setStats: (s) => set({ stats: s }),
  setGraph: (g) => set({ graph: g }),
})
