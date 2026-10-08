// Build model: C2 barrel. Logic lives in model/ — this file only re-exports,
// so the ~40 test files importing this deep path keep resolving every name.
// Explicit lists (no `export *`): internal cross-file helpers such as
// `cloneCell`, `assignAdPosters` and `NEIGH4` must not leak out as public API.

export { addCells, cellKey, GROUND_Z, isSolid, nearestLevel, removeCells } from './model/Cells.ts';
export { isGridCell, isGridModule, repairGrid } from './model/Grid.ts';
export { cloneState, toData, toState, toStateRepairing, type StationState } from './model/State.ts';
export {
  addEquipment,
  createModule,
  ESCALATOR_RISE,
  ESCALATOR_RUN,
  fenceRotForLine,
  nextEscalatorDir,
  nextExitName,
  nextModuleId,
  randomAdSlug,
  moveEquipment,
  removeModule,
  replaceEquipment,
  type SignLineInput,
} from './model/Equipment.ts';
export { extendLift, liftInColumn } from './model/Lifts.ts';
export { paintBridgeSurface } from './model/BridgePaint.ts';
export { syncBridgePillars } from './model/BridgePillars.ts';
export {
  eraseFace,
  eraseFaces,
  faceFinish,
  faceOverride,
  facePresent,
  fillSurface,
  paintFace,
  paintFaces,
  paintStairSurface,
  paintPillarSurface,
} from './model/Paint.ts';
export {
  eraseZoneCells,
  paintZone,
  paintZoneCells,
  zoneAt,
  zoneFloorAt,
  zoneFloorKeys,
  zoneMapFloors,
  zoneMapFloorsAt,
  zoneRegionLabels,
  type ZoneLabel,
} from './model/Zones.ts';
export { addFloor, AUTO_FLOOR, plannedAutoWalls, removeFloor, syncAutoWalls } from './model/Floors.ts';
export {
  addWalls,
  AUTO_WALL,
  AUTO_WALL_H,
  halfWallRunSide,
  halfWallSideDirs,
  thinWallSideMap,
  triangleRunSide,
  triangleSideDirs,
  WALL,
  wallColumnAt,
  wallColumnsAt,
  wallDirRot,
  wallPointerDir,
  wallRun,
  wallSnap,
  WALL_DIRS,
  type WallDir,
  type WallSnap,
} from './model/Walls.ts';
export type { CellShape, TriangleKind, TriSide } from '../sim/types.ts';
export {
  boothBenchSpots,
  carveFacilityOpenings,
  ensureRoomFurniture,
  FACILITY_MIN,
  facilitiesOverlapping,
  facilityAt,
  facilityCovers,
  facilityFloorCells,
  facilityOpeningCells,
  facilityPlan,
  facilityRect,
  facilityRectOf,
  facilityWallCells,
  isWalledRoomKind,
  officeDeskSpots,
  placeFacility,
  removeFacility,
  restroomSpots,
  SHOP_WALL_H,
  storeShelfSpots,
  type FacilityKind,
  type FacilityPlan,
  type FacilityRect,
  type FurnitureSpot,
} from './model/Facilities.ts';
export { initialStation, labStation } from './model/Reference.ts';

export { paintRoofSurface } from './model/RoofPaint.ts';
