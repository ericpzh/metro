// Shared contract of the scene systems (Lane F step 0).
//
// `SceneRenderer` used to own every GPU resource directly; the systems below
// split its ~70 methods by domain, so the state two systems touch — materials,
// finishes, hidden cells, thin sides, level state, disposal registries — lives
// here, in one `SceneContext`, instead of drifting into two owners. Each system
// takes the context in its constructor and owns only its domain objects; the
// orchestrator (`scene/SceneRenderer.ts`) wires sibling references after
// construction.
//
// The module helpers at the bottom (`moduleLevels`, `blobRadius`) and the
// `GateWing` shape are shared by exactly two systems (ModuleSystem builds them,
// CrowdSystem/PlateSystem consume them), so they live with the contract rather
// than in either unit (R6: shared only when two units genuinely import it).

import * as THREE from 'three'
import type { MaterialSet } from '../../materials.ts'
import type { AdArt } from '../../adArt.ts'
import type { ModelMaterials } from '../../models.ts'
import { storeyBand } from '../../../sim/constants.ts'
import { stairLevels } from '../../../sim/stairs.ts'
import type { Face, FinishId, Module, StationData, WallSide } from '../../../sim/types.ts'

/** Pointer-pick answer: the solid cell hit, or the void cell under the work plane. */
export interface PickResult {
  /** The solid cell that was hit, or the void cell under the work plane. */
  cell: [number, number, number]
  solid: boolean
  /** Face normal (0 for the work plane). */
  normal: [number, number, number]
  /** Where a tool would place a new block. */
  place: [number, number, number]
  point: [number, number, number]
}

export interface SceneStats {
  fps: number
  triangles: number
  drawCalls: number
  agents: number
  lastChunkMs: number
  chunks: number
}

/**
 * One turnstile, driven as a one-passenger-at-a-time leaf. The gate is not a
 * proximity switch that stays open while a queue waits: a passenger walking
 * through the lane is one crossing, which opens the leaf, holds it for that
 * passenger, then shuts it — the next passenger waits for the next cycle.
 */
export interface GateWing {
  /** The gate group; `setGateWing` compresses its leaf into the cabinet. */
  root: THREE.Object3D
  /** The lane centre — the graph node — in world space. */
  x: number
  y: number
  z: number
  /** Crossing axis is world Y (gate rot even); world X otherwise. */
  axisY: boolean
  /** Passengers seen crossing since the last cycle began. */
  pending: number
  /** Seconds the leaf stays open for the passenger being served now. */
  hold: number
  /** 0 shut … 1 slid open. */
  open: number
  /** Eased target: 1 while letting a passenger through, else 0. */
  target: number
}

/**
 * Every scrap of renderer state that more than one system reads or writes.
 * Fields keep the names they had on `SceneRenderer` so the moved methods read
 * as they did; only the owner prefix changed (`this.` → `this.ctx.`).
 */
export interface SceneContext {
  scene: THREE.Scene
  mats: MaterialSet
  modelMats: ModelMaterials
  ads: AdArt
  bounds: THREE.Box3
  /** The last station document, so a hover ghost can be built through the models. */
  stationData: StationData | null
  solid: Set<number>
  finishes: Map<number, Partial<Record<Face, FinishId>>>
  /**
   * Stair turn-landing cells. The sim keeps them as walkable nodes, but the
   * stair model draws the platform, so the chunk mesher skips them. A reused
   * 1 m block there would read as a floating cube, not a staircase landing.
   */
  hiddenCells: Set<number>
  /**
   * Every cell that draws half a block thick, by packed key → the side its panel
   * hugs: a **半墙** the player laid and every block a ramp kept beside its run
   * (`thinWallCells`). The mesher draws those cells half a block thick, and the
   * paint ghost sits on the panel's own faces rather than on the cell boundary, so
   * what the player clicks is what they paint.
   */
  thinSides: Map<number, WallSide>
  /** Cells whose top finish is the track bed, for the same preview context. */
  trackCellSet: Set<string>
  /** Lowest storey each column reaches; a block there has nothing under it. */
  groundOf: Map<string, number>
  activeZ: number
  ghost: boolean
  /** 隐藏天花板: drop the ceiling of the storey above the active one. */
  autoCeiling: boolean
  /** 隐藏墙壁: true while walls and platform screen doors should read through. */
  hideWalls: boolean
  /** The slice state the last `applyLevel` applied, so a repeat is skipped. */
  levelKey: string
  dimMats: Map<THREE.Material, THREE.Material>
  /** Translucent clones of wall/P.S.D. materials, keyed by the opaque original. */
  clearMats: Map<THREE.Material, THREE.Material>
  clipPlane: THREE.Plane
  /**
   * Materials a module builder minted for the current build alone — a 电视 plate, a
   * 站台门 header, an 出入口 header, the 售票机 marquee, a room's 招牌 (see
   * `ModuleContext.owned`). `disposeObject` keeps materials because nearly all of
   * them are the shared kit, so these are collected separately and released when
   * the module groups they belong to are dropped. Without this, every rebuild
   * uploaded a fresh canvas texture per such module and never deleted one, which is
   * what made a long build session slow down until the page was reloaded.
   */
  ownedMats: THREE.Material[]
  /** The live train poses, so a plate can count down to the next service. */
  trainPoses: Array<{ x: number; y: number; colour: number }>
  /** The simulation clock, as the plate's clock field. */
  clockText: string
  /** Interpolation window in ms, sent by the worker (varies with speed). */
  stateIntervalMs: number
  lastStateTime: number
  lastChunkMs: number
  /** Keys held for WASD panning; the viewport keeps this in sync. */
  keys: Set<string>
  /** True once `dispose()` has run; async art callbacks check this. */
  disposed: boolean
}

/** The concrete context. The orchestrator builds one and hands it to every system. */
export class SceneContextData implements SceneContext {
  bounds = new THREE.Box3()
  stationData: StationData | null = null
  solid = new Set<number>()
  finishes = new Map<number, Partial<Record<Face, FinishId>>>()
  hiddenCells = new Set<number>()
  thinSides = new Map<number, WallSide>()
  trackCellSet = new Set<string>()
  groundOf = new Map<string, number>()
  activeZ = 0
  ghost = true
  autoCeiling = true
  hideWalls = false
  levelKey = ''
  dimMats = new Map<THREE.Material, THREE.Material>()
  clearMats = new Map<THREE.Material, THREE.Material>()
  clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  ownedMats: THREE.Material[] = []
  trainPoses: Array<{ x: number; y: number; colour: number }> = []
  clockText = '--:--'
  stateIntervalMs = 200
  lastStateTime = 0
  lastChunkMs = 0
  keys = new Set<string>()
  disposed = false

  scene: THREE.Scene
  mats: MaterialSet
  modelMats: ModelMaterials
  ads: AdArt

  constructor(scene: THREE.Scene, mats: MaterialSet, modelMats: ModelMaterials, ads: AdArt) {
    this.scene = scene
    this.mats = mats
    this.modelMats = modelMats
    this.ads = ads
  }
}

/**
 * Base class of the scene systems (R5). A system owns one domain's objects and
 * reads everything else through the shared context; `dispose()` releases only
 * what the system itself created, mirroring the old `SceneRenderer.dispose()`.
 */
export abstract class SceneSystem {
  protected ctx: SceneContext

  constructor(ctx: SceneContext) {
    this.ctx = ctx
  }

  dispose(): void {}
}

/**
 * The storeys a module occupies, for the ghost/level slicing.
 *
 * Every entry is a **storey band**, not a raw height — `storeyBand(z)`, the same
 * key the cell mesher and `levelSide` compare against. A module's `z` is the floor
 * it is anchored to, which is what the cells around it are keyed by as well; a
 * fixture hung from the ceiling above is placed at the storey *below* the slab it
 * hangs from, so its raw `z` (1) would otherwise read as a band of its own and no
 * active storey would ever draw it. A run keeps both of its ends, and its landings
 * come out of `stairLevels` already on the grid.
 */
export function moduleLevels(mod: Module): number[] {
  switch (mod.type) {
    case 'escalator':
    case 'lift':
      return [storeyBand(mod.from.z), storeyBand(mod.to.z)]
    case 'stair':
      return stairLevels(mod).map(storeyBand)
    default:
      return [storeyBand(mod.z)]
  }
}

/** Contact-blob radius per module; long runs and ramps sit their own way. */
export function blobRadius(type: Module['type']): number {
  switch (type) {
    case 'track':
    case 'platform-edge':
    case 'escalator':
    case 'stair':
      return 0
    case 'exit':
    case 'lift':
      return 1.5
    case 'shop':
    case 'booth':
    case 'retail':
    case 'billboard':
    case 'tv':
      return 0
    default:
      return 0.8
  }
}
