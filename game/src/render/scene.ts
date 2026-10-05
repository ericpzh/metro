// C2 barrel: the scene split (Lane F) moved `SceneRenderer` into
// `scene/SceneRenderer.ts` with one system per unit under `scene/systems/`.
// This file holds no logic; it exists so the paths `Viewport.tsx`, `Lab.tsx`,
// `ViewCube.tsx`, `ToolContext.ts` and `SimSlice.ts` import keep working.
export { SceneRenderer } from './scene/SceneRenderer.ts'
export type { PickResult, SceneStats } from './scene/systems/SceneSystem.ts'
