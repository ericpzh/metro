// C2 barrel: re-exports everything `app/store.ts` has always exported, so old
// deep import paths (components and `game/test/*`) keep working. No logic here —
// `useStore` is wired in `store/Store.ts`, fields and actions live in
// `store/slices/*`, and catalogue data lives in `store/catalog.ts`.

export { useStore } from './store/Store.ts'
export type { AppState } from './store/Store.ts'

export type { Tool } from './store/slices/ToolSlice.ts'
export type { PaintMode, PaintBaseMode } from './store/slices/PaintSlice.ts'
export type { MoveDraft } from './store/slices/MoveSlice.ts'

export type {
  ModuleOption,
  FacilityBrush,
  ZoneBrush,
  ModuleFamily,
  ModuleFamilyKey,
  ModuleFolder,
  FolderTile,
  CutMode,
  CutModeSpec,
} from './store/catalog.ts'
export {
  MODULE_OPTIONS,
  // The variant families: one table every part of that UI reads (the grid, its
  // sub-menus, the rail's open slot and the action row's anchor) — and the grid's own
  // tile order, which says where in the palette each family's parent tile sits.
  MODULE_FAMILIES,
  actionRowOpen,
  actionsAnchorFor,
  familiesIn,
  familyAnchor,
  familyFor,
  familyOptions,
  folderTiles,
  folderOptions,
  hasModuleActions,
  isFamilyOption,
  // The 方块 tool's cut pieces: the same kind of list for the three shapes a click
  // lays instead of a block, read by the 工具 folder's tiles and their action row.
  CUT_MODES,
  cutAnchor,
  cutModeOf,
  cutSpec,
  isStairType,
  isBillboardType,
  isGlassType,
  isDoorType,
  isCalligraphyType,
  isLineMapType,
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
