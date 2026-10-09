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
import type { LineMapArt } from '../../lineMapArt.ts'
import type { ModelMaterials } from '../../models.ts'
import { storeyBand } from '../../../sim/constants.ts'
import { ROOF_THICKNESS, TRUSS_ROOF_BASE, trussRoofTop } from '../../../sim/structures.ts'
import type { SlopeCut } from '../../../sim/openings.ts'
import { stairLevels } from '../../../sim/stairs.ts'
import { DEFAULT_SECTION_AZIMUTH } from '../../section.ts'
import type { Section } from '../../section.ts'
import type { CellShape, Face, FinishId, Module, StationData } from '../../../sim/types.ts'

/** Pointer-pick answer: the solid cell hit, or the void cell under the work plane. */
export interface PickResult {
  /** The solid cell that was hit, or the void cell under the work plane. */
  cell: [number, number, number]
  solid: boolean
  /**
   * Face normal (0 for the work plane), snapped to the cell axis the face points
   * along: a wedge's slope and a rounded corner are drawn off-axis, and every
   * consumer of this wants the *face* (`pickCell.ts` `pickCells`).
   */
  normal: [number, number, number]
  /** Where a tool would place a new block, one whole cell out along `normal`. */
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
  /**
   * The supplied 线网图 poster, one cache per scene like the ad artwork: every map
   * shares one texture, and until its pixels land a map prints the drawn placeholder
   * board (`render/lineMapFace.ts`) rather than a blank panel. Null for a caller with
   * no artwork behind it (a unit test), which reads as "not ready".
   */
  lineMaps: LineMapArt | null
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
   * Every cell that draws as less than a whole block, by packed key → the shape it
   * draws: a **半墙** the player laid, a **三角** corner (which of the two cuts, and
   * which corner), and every block a ramp kept beside its run (`thinWallCells`). The
   * mesher draws those cells as that shape, and the paint ghost sits on a 半墙's own
   * faces rather than on the cell boundary, so what the player clicks is what they
   * paint.
   */
  thinSides: Map<number, CellShape>
  /**
   * Every block a 楼梯 / 扶梯 takes its volume out of, by packed key → the plane its
   * top is cut on (`rampSlopeCuts`). The mesher draws those blocks' tops on the
   * run's underside instead of on the cell ceiling, so the ground under a run fills
   * up to its truss. Derived from the modules alone, so the pending cell a build
   * ghost is previewing reads its cut too.
   */
  slopeCuts: Map<number, SlopeCut>
  /**
   * The filling the ground under a run is missing, by packed cell key
   * (`rampFillKeys`): a block `rampSlopeCuts` names that the station holds nothing in
   * and that stands on solid ground. The mesher draws those cells as if the block
   * below carried on up to the truss, so the wedge under a 楼梯 / 扶梯 is filled
   * without a document cell — laid by no tool, kept in step by nothing. Derived from
   * the run and the blocks, so it appears and disappears with them. It is drawn
   * geometry, so the pointer picks it like ground; no tool can write it (a cell the
   * document does not hold cannot be dug, painted or built on).
   */
  slopeFills: Set<number>
  /** Cells whose top finish is the track bed, for the same preview context. */
  trackCellSet: Set<string>
  /** Lowest storey each column reaches; a block there has nothing under it. */
  groundOf: Map<string, number>
  activeZ: number
  levelBase: number
  ghost: boolean
  /** 隐藏天花板: drop the ceiling of the storey above the active one. */
  autoCeiling: boolean
  /** 隐藏墙壁: true while walls and platform screen doors should read through. */
  hideWalls: boolean
  /**
   * 隐藏地面: true while the street plane — the generated window
   * (`sim/ground.ts`) — is not drawn at all. It is meshed as its own pass
   * (`ChunkSystem.meshStation`) and tagged `ground`, so the toggle is a
   * `visible` flag rather than a rebuild; like 隐藏墙壁 it hides in **every**
   * mode, cut and 隐藏UI included, because it is a surface the player asked to
   * be rid of rather than a way of drawing a storey.
   */
  hideGround: boolean
  hideRoof: boolean
  /**
   * 隐藏UI: the picture is the station rather than the storey being edited, so
   * the slice is put away (`levelSlicing.sliceOptions`) and every storey draws
   * as itself. It owns the editing lattice as well, but that flag lives with the
   * lattice (`GridSystem`), not here.
   */
  hideUI: boolean
  /**
   * 剖切: a surface is cutting the station. While it is on the slice is put away as
   * well (`levelSlicing.sliceOptions` takes the cut alongside 隐藏UI), so Q/E stop
   * choosing a storey to ghost and the only thing that hides any of the station is
   * the plane.
   */
  cutaway: boolean
  /** The slice state the last `applyLevel` applied, so a repeat is skipped. */
  levelKey: string
  dimMats: Map<THREE.Material, THREE.Material>
  /** Translucent clones of wall/P.S.D. materials, keyed by the opaque original. */
  clearMats: Map<THREE.Material, THREE.Material>
  /**
   * The 剖切 surface the clip plane is built from (`render/section.ts`): where
   * the cut stands, how it is turned and how far it has slid. The store owns it
   * — the rail's location box and the drag both write there — and the scene
   * only reads it, so the plane, the highlighted surface and the drag can never
   * disagree about where the cut is. The plane itself is `SectionSystem.plane`,
   * one object for the scene's lifetime, which is what lets every clipped
   * material share it by reference.
   */
  section: Section
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
  /** The simulation clock, as the plate's clock field. */
  clockText: string
  /** Interpolation window in ms, sent by the worker (varies with speed). */
  stateIntervalMs: number
  lastStateTime: number
  lastChunkMs: number
  /**
   * Keys held for WASD panning and the camera's vertical pan; the viewport (WASD
   * and Ctrl+Q/E) and the nav cube's two arrows both keep this in sync. The
   * vertical tokens are `PAN_UP` / `PAN_DOWN` — the intent rather than a key,
   * because two sources hold it — and a plain Q/E never adds either: that letter
   * is the storey step, which lives in the app.
   */
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
  thinSides = new Map<number, CellShape>()
  slopeCuts = new Map<number, SlopeCut>()
  slopeFills = new Set<number>()
  trackCellSet = new Set<string>()
  groundOf = new Map<string, number>()
  activeZ = 0
  levelBase = 0
  ghost = true
  autoCeiling = true
  hideWalls = false
  hideGround = false
  hideRoof = false
  hideUI = false
  cutaway = false
  levelKey = ''
  dimMats = new Map<THREE.Material, THREE.Material>()
  clearMats = new Map<THREE.Material, THREE.Material>()
  section: Section = { anchor: [0, 0, 0], orientation: { azimuth: DEFAULT_SECTION_AZIMUTH }, offset: 0 }
  ownedMats: THREE.Material[] = []
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
  lineMaps: LineMapArt | null

  constructor(scene: THREE.Scene, mats: MaterialSet, modelMats: ModelMaterials, ads: AdArt, lineMaps: LineMapArt | null = null) {
    this.scene = scene
    this.mats = mats
    this.modelMats = modelMats
    this.ads = ads
    this.lineMaps = lineMaps
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
export function moduleLevels(mod: Module, base = 0): number[] {
  switch (mod.type) {
    case 'roof': {
      const lower = storeyBand(mod.z + TRUSS_ROOF_BASE, base)
      const upper = storeyBand(mod.z + 1 + (mod.cfg.variant ? trussRoofTop(mod.d) : TRUSS_ROOF_BASE + ROOF_THICKNESS) - 1e-4, base)
      return lower === upper ? [lower] : [lower, upper]
    }
    case 'pillar': {
      const levels: number[] = []
      for (let z = mod.z; z < mod.z + mod.cfg.height; z += 4) levels.push(storeyBand(z, base))
      return levels
    }
    case 'escalator':
    case 'lift':
      return [storeyBand(mod.from.z, base), storeyBand(mod.to.z, base)]
    case 'stair':
      return stairLevels(mod).map((z) => storeyBand(z, base))
    default:
      return [storeyBand(mod.z, base)]
  }
}

/** Contact-blob radius per module; long runs and ramps sit their own way. */
export function blobRadius(type: Module['type']): number {
  switch (type) {
    case 'roof': return 0
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
    // The wall pieces are bolted to a wall or, for the 线网图 totem, stand on a
    // plinth; a room and a booth are their own walls and counter, and the hung 电视 and
    // both 指示牌 mounts (the board on its rods, the board on the wall) hang or bolt
    // rather than stand: none of them wants a floor contact blob under it. (A 门 is a
    // floor-standing piece like a 货架, so it takes the default blob below.)
    case 'glass':
    case 'calligraphy':
    case 'linemap':
    case 'sign':
    case 'tv':
      return 0
    default:
      return 0.8
  }
}

/**
 * The key set's vocabulary for the camera's vertical pan: the view rises while
 * `PAN_UP` is held and drops while `PAN_DOWN` is (`CameraSystem.panCameraVertical`).
 *
 * The tokens name the **intent**, not a key, because the pan has two sources that
 * hold it — the shell's key handler holds one while Ctrl+E / Ctrl+Q is down
 * (`app/Viewport.tsx`), and the nav cube's two arrows hold one while the pointer is
 * down (`app/ViewCube.tsx`). One vocabulary is what makes the two the same action at
 * the same rate, and it is why the camera never has to know which one is asking.
 */
export const PAN_UP = 'pan-up'
export const PAN_DOWN = 'pan-down'
