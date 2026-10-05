// The simulation world (§7.6 determinism). Split so the exported data shapes and the
// `World` class are their own units: `world/types.ts` is the vocabulary (train state,
// metrics, snapshot), `world/World.ts` is the simulation itself. This barrel keeps the
// `sim/world.ts` import path — and every name it exported — stable.

export { World } from './world/World.ts'
export {
  STATE_ARRIVING,
  STATE_WALKING,
  STATE_QUEUING,
  STATE_BUYING,
  STATE_BROWSING,
  STATE_WAITING,
  STATE_RIDING,
  STATE_LEAVING,
  STOCK,
  LANE_SLOT,
  WALK_SPEED,
} from './world/World.ts'
export type { TrainState, Train, Metrics, DynamicSnapshot } from './world/types.ts'
