// Worker protocol (§10.2). Raw transferables, no Comlink: the message set is
// small and the state payload is one Float32Array (PLAN.md §8 open question 1,
// resolved toward the leaner option).

import type { Metrics } from './world.ts'
import type { StationData } from './types.ts'
import type { TrainService } from './trainSchedule.ts'

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
  // A restart keeps the built station and the clock but empties the crowd: every
  // agent, train and queue is dropped and the sim runs on from here.
  | { type: 'restart' }
  // Move the clock to `seconds` and keep everything else: the 时刻 window's calendar pick
  // (§7.9's scrub). `simTime` is seconds since the run began, the same base the metrics report.
  | { type: 'seek'; seconds: number }
  // The 选择 tool previews one passenger's route (`World.routeOf`). `id` is -1 to put
  // the preview away, and `token` is echoed back on every frame so the renderer can
  // tell "the worker has not seen my selection yet" from "that passenger is gone".
  | { type: 'selectAgent'; id: number; token: number }

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
      trainServices: TrainService[]
      /** One pose per elevator car; see `World.liftRenderState`. */
      lifts: Float32Array
      /** Real milliseconds the renderer should interpolate one snapshot over. */
      intervalMs: number
      /**
       * The route preview: xyz waypoints of the selected passenger's remaining
       * walk, empty when nothing is selected. `routeAgent` is the passenger the
       * route belongs to, or -1 when the selected one is no longer in the world,
       * and `routeToken` echoes the `selectAgent` request this frame answers.
       */
      route: Float32Array
      routeAgent: number
      routeToken: number
    }
