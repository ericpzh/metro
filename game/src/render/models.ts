// Procedural module models â€” dispatcher plus compatibility barrel (Lane E).
//
// buildModule keeps its signature and routes each module type to its piece
// builder (render/models/pieces/*, one class per piece extending PieceBuilder).
// Every other name this file used to define now lives in PieceBuilder.ts or a
// piece file and is re-exported below, so existing import paths keep working.
import type * as THREE from 'three'
import type { Module } from '../sim/types.ts'
import type { ModuleContext } from './models/PieceBuilder.ts'
import { PillarModel } from './models/pieces/PillarModel.ts'
import { RoofModel } from './models/pieces/RoofModel.ts'
import { TvmModel } from './models/pieces/TvmModel.ts'
import { VendingModel } from './models/pieces/VendingModel.ts'
import { BenchModel } from './models/pieces/BenchModel.ts'
import { ShelfModel } from './models/pieces/ShelfModel.ts'
import { DeskModel } from './models/pieces/DeskModel.ts'
import { CubicleModel } from './models/pieces/CubicleModel.ts'
import { SinkModel } from './models/pieces/SinkModel.ts'
import { GuidepostModel, BusstopModel } from './models/pieces/StreetDecorModel.ts'
import { BinModel } from './models/pieces/BinModel.ts'
import { ExtinguisherModel } from './models/pieces/ExtinguisherModel.ts'
import { VentModel } from './models/pieces/VentModel.ts'
import { LightModel } from './models/pieces/LightModel.ts'
import { ClockModel } from './models/pieces/ClockModel.ts'
import { CctvModel } from './models/pieces/CctvModel.ts'
import { BillboardModel } from './models/pieces/BillboardModel.ts'
import { GlassModel } from './models/pieces/GlassModel.ts'
import { DoorModel } from './models/pieces/DoorModel.ts'
import { CalligraphyModel } from './models/pieces/CalligraphyModel.ts'
import { LineMapModel } from './models/pieces/LineMapModel.ts'
import { TvModel } from './models/pieces/TvModel.ts'
import { SignModel } from './models/pieces/SignModel.ts'
import { GateModel } from './models/pieces/GateModel.ts'
import { FenceModel } from './models/pieces/FenceModel.ts'
import { EscalatorModel } from './models/pieces/EscalatorModel.ts'
import { StairModel } from './models/pieces/StairModel.ts'
import { LiftModel } from './models/pieces/LiftModel.ts'
import { ExitModel } from './models/pieces/ExitModel.ts'
import { PsdModel } from './models/pieces/PsdModel.ts'
import { TrackModel } from './models/pieces/TrackModel.ts'
import { RoomModel } from './models/pieces/RoomModel.ts'
import { BoothModel } from './models/pieces/BoothModel.ts'

/**
 * Build one placed module. Returns a group in world space, or null for a module
 * with nothing to draw. The caller owns disposal.
 */
export function buildModule(mod: Module, ctx: ModuleContext): THREE.Object3D | null {
  switch (mod.type) {
    case 'pillar': return new PillarModel(ctx).build(mod)
    case 'roof': return new RoofModel(ctx).build(mod)
    case 'tvm':
      return new TvmModel(ctx).build(mod)
    case 'vending':
      return new VendingModel(ctx).build(mod)
    case 'bench':
      return new BenchModel(ctx).build(mod)
    case 'shelf':
      return new ShelfModel(ctx).build(mod)
    case 'desk':
      return new DeskModel(ctx).build(mod)
    case 'cubicle':
      return new CubicleModel(ctx).build(mod)
    case 'sink':
      return new SinkModel(ctx).build(mod)
    case 'guidepost': return new GuidepostModel(ctx).build(mod)
    case 'busstop': return new BusstopModel(ctx).build(mod)
    case 'bin':
      return new BinModel(ctx).build(mod)
    case 'extinguisher':
      return new ExtinguisherModel(ctx).build(mod)
    case 'vent':
      return new VentModel(ctx).build(mod)
    case 'light':
      return new LightModel(ctx).build(mod)
    case 'clock':
      return new ClockModel(ctx).build(mod)
    case 'cctv':
      return new CctvModel(ctx).build(mod)
    case 'billboard':
      return new BillboardModel(ctx).build(mod)
    case 'glass':
      return new GlassModel(ctx).build(mod)
    case 'door':
      return new DoorModel(ctx).build(mod)
    case 'calligraphy':
      return new CalligraphyModel(ctx).build(mod)
    case 'linemap':
      return new LineMapModel(ctx).build(mod)
    case 'tv':
      return new TvModel(ctx).build(mod)
    case 'sign':
      return new SignModel(ctx).build(mod)
    case 'gate':
      return new GateModel(ctx).build(mod)
    case 'fence':
      return new FenceModel(ctx).build(mod)
    case 'escalator':
      return new EscalatorModel(ctx).build(mod)
    case 'stair':
      return new StairModel(ctx).build(mod)
    case 'lift':
      return new LiftModel(ctx).build(mod)
    case 'exit':
      return new ExitModel(ctx).build(mod)
    case 'platform-edge':
      return new PsdModel(ctx).build(mod)
    case 'track':
      return new TrackModel(ctx).build(mod)
    case 'shop':
      return new RoomModel(ctx).build(mod)
    case 'booth':
      return new BoothModel(ctx).build(mod)
    case 'retail':
      return new RoomModel(ctx).build({ ...mod, type: 'shop', cfg: { kind: 'store' } } as Extract<Module, { type: 'shop' }>)
    default:
      return null
  }
}

export type { ModelMaterials, ModuleContext, PrintedFace } from './models/PieceBuilder.ts'
export {
  canvasTexture,
  createModelMaterials,
  disposeModelMaterials,
  disposeObject,
  drawMetroMark,
  isSharedGeometry,
  litPanelMaterial,
  refreshSignFaceMaterial,
} from './models/PieceBuilder.ts'
export { setGateWing } from './models/pieces/GateModel.ts'
export { CLOCK_POSE_SECONDS, reposeClockHands } from './models/pieces/ClockModel.ts'
export type { ClockRig } from './models/pieces/ClockModel.ts'
export type { EscalatorRoll } from './models/pieces/EscalatorModel.ts'
export { rollEscalator } from './models/pieces/EscalatorModel.ts'
export type { TrainPose } from './models/pieces/TrainModel.ts'
export { buildTrain, setDoors, setDoorsSides } from './models/pieces/TrainModel.ts'
