// Worker protocol (§10.2). Raw transferables, no Comlink: the message set is
// small and the state payload is one Float32Array (PLAN.md §8 open question 1,
// resolved toward the leaner option).

import type { Metrics } from './world.ts'
import type { StationData } from './types.ts'

export interface GraphInfo {
  nodeCount: number
  /** xyz per node, walk-surface height. */
  nodes: Float32Array
  exits: Array<{ id: string; name: string; node: number }>
  platforms: Array<{ id: string; name: string; line: string; doors: number; cells: number[] }>
  levelsZ: number[]
}

export type ToWorker =
  // `init` boots the world and, sent again, loads a different station: both are
  // a full reset. Live edits arrive as `build`, which rebuilds the graph and
  // keeps the crowd.
  | { type: 'init'; data: StationData; seed: number; playing: boolean; speed: number; startSeconds?: number; warmup?: number }
  | { type: 'build'; data: StationData }
  | { type: 'control'; playing: boolean; speed: number }

export type FromWorker =
  | ({ type: 'ready' } & GraphInfo)
  | {
      type: 'state'
      count: number
      agents: Float32Array
      metrics: Metrics
      density: Float32Array
      /** One rolling-stock pose per live train; see `World.trainRenderState`. */
      trains: Float32Array
      /** One pose per elevator car; see `World.liftRenderState`. */
      lifts: Float32Array
      /** Real milliseconds the renderer should interpolate one snapshot over. */
      intervalMs: number
    }
