// C2 barrel: re-exports everything `app/store.ts` has always exported, so old
// deep import paths (components and `game/test/*`) keep working. No logic here —
// `useStore` is wired in `store/Store.ts`, fields and actions live in
// `store/slices/*`, and catalogue data lives in `store/catalog.ts`.

export { useStore } from './store/Store.ts'
export type { AppState } from './store/Store.ts'

export type { Tool } from './store/slices/ToolSlice.ts'
export type { PaintMode, PaintBaseMode } from './store/slices/PaintSlice.ts'
export type { MoveDraft } from './store/slices/MoveSlice.ts'

export type { ModuleOption, FacilityBrush, ZoneBrush } from './store/catalog.ts'
export {
  MODULE_OPTIONS,
  isStairType,
  isBillboardType,
  isBenchType,
  isDecorType,
  isWallMountedType,
  isFenceType,
  isExitType,
  isEscalatorType,
  isGateType,
  isRotatableType,
  FACILITY_OPTIONS,
  isFacilityBrush,
  moduleLabel,
  placementPreviewKey,
} from './store/catalog.ts'

export { signModuleWithPreview } from './store/slices/SignSlice.ts'
export { setFrameHandler, initSim, rebuildSim } from './store/slices/SimSlice.ts'
