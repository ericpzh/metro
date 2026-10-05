// C2 barrel: the scene split (Lane F) moved `SceneRenderer` into
// `scene/SceneRenderer.ts` with one system per unit under `scene/systems/`.
// This file holds no logic; it exists so the paths `Viewport.tsx`, `Lab.tsx`,
// `ViewCube.tsx`, `ToolContext.ts` and `SimSlice.ts` import keep working.
export { SceneRenderer } from './scene/SceneRenderer.ts'
export type { PickResult, SceneStats } from './scene/systems/SceneSystem.ts'
/** The held-vertical-pan tokens the camera reads (`PAN_UP` / `PAN_DOWN`). */
export { PAN_DOWN, PAN_UP } from './scene/systems/SceneSystem.ts'
/** The lens the perspective camera opens with, and the range the FOV slider offers, in degrees. */
export { DEFAULT_FOV, FOV_MAX_DEG, FOV_MIN_DEG } from './scene/systems/CameraSystem.ts'
