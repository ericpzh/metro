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
      frameCb?.(msg.count, msg.agents, msg.density, msg.trains, msg.lifts, msg.intervalMs, msg.metrics.simTime)
    }
  }
  return client
}

/** Boots the worker on the demo. Called once from boot.tsx. The game opens
 * paused — the player presses play (or Space) to start the crowd. */
export function initSim(data: StationData, seed: number, opts: { startSeconds?: number; warmup?: number } = {}): void {
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
