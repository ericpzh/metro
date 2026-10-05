// The three.js scene: camera rig, chunk meshes, outline pass, contact shadows,
// the agent InstancedMesh and the LOS overlay. Browser-only.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildSolidSet, CHUNK, meshChunk } from './chunkMesher.ts'
import { createMaterials, type MaterialSet } from './materials.ts'
import {
  buildModule,
  buildTrain,
  canvasTexture,
  createModelMaterials,
  disposeModelMaterials,
  disposeObject,
  litPanelMaterial,
  refreshSignFaceMaterial,
  rollEscalator,
  setDoors,
  setDoorsSides,
  setGateWing,
  type EscalatorRoll,
  type ModelMaterials,
  type ModuleContext,
} from './models.ts'
import { finishDef, finishMapOf } from '../sim/finishes.ts'
import { createAdArt, type AdArt } from './adArt.ts'
import { drawStationDisplay, STATION_PLATE, tvLineStatus } from './stationDisplay.ts'
import { drawSignPanel } from './signFace.ts'
import { loadPictograms } from './pictograms.ts'
import { signBoardsOf, signBoardsPanel, signFaceLayout, signPlate, type SignLayout, type SignPanelSize } from '../sim/sign.ts'
import { HALF_WALL_T, storeyBand } from '../sim/constants.ts'
import { trackBedKeys } from '../sim/placement.ts'
import { tvPairSlot } from '../sim/tvs.ts'
import { edgeCells } from '../sim/track.ts'
import { OPENING_CEILING, thinWallCells } from '../sim/openings.ts'
import { ZONE_LIST } from '../sim/zones.ts'
import { stairLevels, stairTurnCells } from '../sim/stairs.ts'
import { liftFootprintCells, liftStopZs } from '../sim/lifts.ts'
import { facilityWallCells } from '../build/model.ts'
import { STOCK_CLASSES, type StockClass } from '../sim/stock.ts'
import type { Face, FinishId, Module, StationData, WallSide } from '../sim/types.ts'
import { halfWallInnerFace, packKey } from '../sim/types.ts'
import { moduleGhostKey } from './moduleGhostKey.ts'
import { facingFrom } from './pickFacing.ts'
import { crowdVisible, levelSide, levelVisible, trainVisible, unsupportedAbove } from './levelSlicing.ts'

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

/** Crowd hue palette — §11: never matches a line colour. */
const AGENT_COLORS = [0xe4572e, 0xf2a541, 0xf7d84b, 0x3fb27f, 0x42a5c4, 0xb07cc6, 0xe07a9b, 0xd9dce1]

/** Sim seconds a door leaf takes to travel fully open or shut (matches the sim's
 *  `TRAIN_DOOR_TRAVEL`; the renderer eases toward the commanded state). */
const DOOR_TRAVEL_S = 2

/**
 * How long a 电视 window holds one piece of content before the feed changes it.
 * The range is the point: each screen rolls its own period, so a row of them
 * drifts apart instead of flipping as one wall.
 */
const TV_SWAP_MIN_MS = 6000
const TV_SWAP_MAX_MS = 20000
/** Stagger the first swap so screens do not all change on the first frame. */
const TV_FIRST_SWAP_MS = 1200
const TV_SWAP_JITTER_MS = 9000

/** Sim seconds a turnstile leaf takes to slide open, hold, and shut. */
const GATE_OPEN_S = 0.25
const GATE_HOLD_S = 0.45
const GATE_SHUT_S = 0.35
/** Half a gate cell: the lane plane sits at the cell centre, so a passenger at
 *  least this far out is outside the turnstile footprint (see `GATE_CLEAR_RADIUS`,
 *  which holds the queue at 0.62 m). Used to tell "stepping into the gate" from
 *  "waiting outside it". */
const GATE_EDGE = 0.5

/**
 * Mouse edge pan: with the pointer inside this band along a canvas edge the
 * camera drifts that way, and a corner pushes two axes at once — WASD panning
 * driven by the mouse. The push ramps from 0 at the band's inner line to full
 * WASD speed at the very edge.
 */
const EDGE_PAN_PX = 26

/** Most cells one drag preview can highlight at once (the ghost instance pool). */
const GHOST_MAX = 4096

/** Hue the module hover ghost fades toward, matching the placement cursor. */
const MODULE_GHOST_TINT = new THREE.Color(0x7fe4ff)
/** Hue the ghost turns when the placement would collide with existing equipment. */
const MODULE_GHOST_BAD = new THREE.Color(0xff5d5d)

/** Outward normal of each face, in cell units; also the paint plane's axis. */
const FACE_NORMAL: Record<Face, [number, number, number]> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
}

/** The plane geometry's own normal, so a quad can be turned to face a wall. */
const FACE_UP = new THREE.Vector3(0, 0, 1)

/** Skin tones for the crowd's heads, so a person reads as a person. */
const SKIN_COLORS = [0xf1c9a5, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa9744a]

/** Hair colours for the crowd, so a head reads as a person and not a mannequin. */
const HAIR_COLORS = [0x2b2320, 0x4a3423, 0x6b4a2b, 0xb98a4a, 0x9a9a9a, 0x3a2f2a]

/**
 * The body: a squat frustum — the neck (top) is wide, the base wider still, and
 * both are broader than the head. No arms and no legs: the crowd are the
 * "Shapes", limb-less sprites that are a body and a head (`tools/iso.mjs`
 * #person). The base sits at z = 0 and the figure faces +x, matching the crowd
 * yaw. Ten sides, smooth-shaded, so it reads as a rounded cone at low poly.
 */
function humanoidBody(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.15, 0.22, 0.58, 10, 1)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, 0.29)
  return g
}

/** The head, a block on top of the neck. Feet at z = 0, faces +x. */
function humanoidHead(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.26, 0.26, 0.26)
  g.translate(0, 0, 0.71)
  return g
}

/**
 * The hair cap: a shell over the top of the head plus a panel down the back, the
 * semicircle the concept sheets draw (`tools/iso.mjs` #person). Every face is
 * offset a hair outside the head — a cap that shares a plane with the head
 * z-fights and flickers. Feet at z = 0, faces +x.
 */
function humanoidHair(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const cap = new THREE.BoxGeometry(0.3, 0.3, 0.17)
  cap.translate(0, 0, 0.765) // 0.68 .. 0.85, just proud of the head's 0.84 top
  parts.push(cap)
  const back = new THREE.BoxGeometry(0.05, 0.28, 0.2)
  back.translate(-0.145, 0, 0.72)
  parts.push(back)
  return mergeGeometries(parts, false) as THREE.BufferGeometry
}

/**
 * One live consist. The worker only reports a pose per tick (1 Hz at 1×), so the
 * group carries the last two poses and is drawn between them each animation
 * frame — otherwise the train would jump a tick's worth of distance at a time.
 */
interface TrainEntry {
  group: THREE.Group
  sig: string
  /** Pose at the previous snapshot. */
  from: THREE.Vector3
  /** Pose at the current snapshot. */
  to: THREE.Vector3
  /** Whether the consist was present in the previous snapshot. */
  active: boolean
}

/**
 * One elevator cabin. The shaft is built once; the sim sends the car's cabin
 * height and door fraction, and the renderer glides the cabin and eases the
 * doors between snapshots. `key` is the module's `x,y,fromZ`, which pairs a car
 * with its shaft.
 */
interface LiftRig {
  key: string
  group: THREE.Object3D
  cabin: THREE.Object3D
  /** The group origin's z, so the cabin offset is `cabinZ - originZ`. */
  originZ: number
  /** Cabin floor height at the previous and current snapshots, world z. */
  baseFrom: number
  baseTo: number
  /** Door fraction at the previous and current snapshots, 0 shut … 1 open. */
  doorFrom: number
  doorTo: number
  /** False until the first snapshot names this rig. */
  have: boolean
}

/**
 * One turnstile, driven as a one-passenger-at-a-time leaf. The gate is not a
 * proximity switch that stays open while a queue waits: a passenger walking
 * through the lane is one crossing, which opens the leaf, holds it for that
 * passenger, then shuts it — the next passenger waits for the next cycle.
 */
interface GateWing {
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

export class SceneRenderer {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  ortho: THREE.OrthographicCamera
  controls: OrbitControls
  mats: MaterialSet
  modelMats: ModelMaterials
  solid = new Set<number>()
  private finishes = new Map<number, Partial<Record<Face, FinishId>>>()

  private levelGroups = new Map<number, THREE.Group>()
  private chunkMeshes: THREE.Mesh[] = []
  private outlineMeshes: THREE.Mesh[] = []
  /**
   * The same meshes as `outlineMeshes`, as a set. `applyLevel` asks "is this mesh an
   * outline?" once per chunk mesh, and the array answer is a linear scan — so the
   * slice cost grew with the square of the station. Rebuilt with the array.
   */
  private outlineSet = new Set<THREE.Mesh>()
  /** The slice state the last `applyLevel` applied, so a repeat is skipped. */
  private levelKey = ''
  /**
   * Last rebuild's meshed chunk per storey band, keyed `band|cx,cy`, so an edit that
   * touches one block re-meshes one chunk instead of the whole station.
   *
   * A block on a 62×62 three-storey station (the size the lag was reported at) puts
   * ~11k cells through the mesher on every placement — around 108 ms of main thread,
   * which is what made placing a block drop to single-digit FPS. The mesher reads
   * nothing but a chunk's own cells (their exposure, finish and skipped state), so a
   * chunk whose content is unchanged yields byte-identical geometry: reusing the
   * built meshes is not an approximation. The geometry is already on the GPU, so a
   * reuse skips both the meshing and the re-upload.
   *
   * Entries not claimed by the current rebuild are disposed at the end of it, so the
   * cache holds exactly the chunks the station currently has.
   */
  private chunkCache = new Map<string, { key: string; meshes: THREE.Mesh[]; outlines: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>()
  /**
   * Cache keys this rebuild intends to reuse, set only around the release call in
   * `setStation` so `releaseChunks` leaves their geometry — and the outline materials
   * that go with it — alone. Null outside that window, when everything is disposable.
   */
  private keepChunkGeometries: Set<string> | null = null

  private moduleMeshes: THREE.Group = new THREE.Group()
  /** The last station document, so a hover ghost can be built through the models. */
  private stationData: StationData | null = null
  /** The selected module's id and its highlight box, kept across a rebuild. */
  private selectedModuleId: string | null = null
  private selectionHelper: THREE.Box3Helper | null = null
  /** Ids of placed modules a blocked preview collides with, boxed in red. */
  private colliderIds: string[] = []
  private colliderHelpers: THREE.Box3Helper[] = []
  /** Cells whose top finish is the track bed, for the same preview context. */
  private trackCellSet = new Set<string>()
  /**
   * Stair turn-landing cells. The sim keeps them as walkable nodes, but the
   * stair model draws the platform, so the chunk mesher skips them. A reused
   * 1 m block there would read as a floating cube, not a staircase landing.
   */
  private hiddenCells = new Set<number>()
  /**
   * Every cell that draws half a block thick, by packed key → the side its panel
   * hugs: a **半墙** the player laid and every block a ramp kept beside its run
   * (`thinWallCells`). The mesher draws those cells half a block thick, and the
   * paint ghost sits on the panel's own faces rather than on the cell boundary, so
   * what the player clicks is what they paint.
   */
  private thinSides = new Map<number, WallSide>()
  /**
   * Invisible full-cell boxes standing in for a shop's hidden wall voxels, so a
   * right-click still picks the wall cell (the thin panel is module geometry,
   * which the picking path does not see).
   */
  private wallPick = new THREE.Group()
  private wallPickGeo = new THREE.BoxGeometry(1, 1, 1)
  private wallPickMat = new THREE.MeshBasicMaterial({ visible: false })
  /** Hover preview: a translucent copy of the module a click would place. */
  private previewGroup: THREE.Group = new THREE.Group()
  private previewKey = ''
  /** Materials/geometries owned by the current preview, disposed on replacement. */
  private previewMats: THREE.Material[] = []
  private previewBases: THREE.Material[] = []
  /**
   * Materials a module builder minted for the current build alone — a 电视 plate, a
   * 站台门 header, an 出入口 header, the 售票机 marquee, a room's 招牌 (see
   * `ModuleContext.owned`). `disposeObject` keeps materials because nearly all of
   * them are the shared kit, so these are collected separately and released when
   * the module groups they belong to are dropped. Without this, every rebuild
   * uploaded a fresh canvas texture per such module and never deleted one, which is
   * what made a long build session slow down until the page was reloaded.
   */
  private ownedMats: THREE.Material[] = []
  /**
   * The same, for a hover/fence-drag preview. The ghost rebuilds on every cell the
   * pointer crosses, so its builder-minted materials are released on each rebuild
   * (`clearModulePreview`) rather than accumulating for the whole drag.
   */
  private previewOwnedMats: THREE.Material[] = []
  /** Committed fence groups, hidden while the live fence drag previews them. */
  private fenceGroups: THREE.Object3D[] = []
  /**
   * Live fence-drag preview: the existing fences rebuilt with the dragged line
   * merged in (so a joint updates as you drag) plus the new translucent panels.
   */
  private fencePreviewGroup: THREE.Group = new THREE.Group()
  private fencePreviewKey = ''
  private fencePreviewMats: THREE.Material[] = []
  /** Module-local base materials the fence ghost cloned, released with its ghosts. */
  private fencePreviewBases: THREE.Material[] = []
  private trainGroup: THREE.Group = new THREE.Group()
  private trainSlots = new Map<string, TrainEntry>()
  /** Platform-screen-door groups, keyed to the line colour that opens them. */
  private psdGroups: Array<{ group: THREE.Object3D; colour: number }> = []
  /** Live escalator step bands, rolled every frame from the sim clock. */
  private escalatorRolls: EscalatorRoll[] = []
  /** Elevator cabins, moved and opened from the sim car state. */
  private liftRigs: LiftRig[] = []
  /** The shaft meshes, so a hover can find a lift and its height to extend it. */
  private liftPickMeshes: THREE.Mesh[] = []
  /** Turnstile leaves, slid open as the crowd passes through their lanes. */
  private gateWings: GateWing[] = []
  /** Wall-mounted 装饰 screens; the poster material each prints is frozen. */
  private adScreens: THREE.Mesh[] = []
  /**
   * Live 电视 content windows. Each swaps the artwork in its little window on its
   * own cadence, so a row of them is not one synchronised wall — the frame around
   * it (the station plate) never changes.
   */
  private tvScreens: Array<{ screen: THREE.Mesh; moduleId: string; poster: string; nextAt: number }> = []
  /** The lit station plate per 电视 module, drawn from the live document. */
  private tvPlates = new Map<string, THREE.CanvasTexture>()
  /**
   * The lit face of each 指示牌 per side (`id|left`, `id|right`), composed from the
   * module's own layout. A board's plate is a document render like the 电视's — it
   * exists only to light the drawn model, which is why both live here and are
   * rebuilt with the modules they belong to.
   */
  private signPlates = new Map<string, { texture: THREE.CanvasTexture; material: THREE.Material; face: 'left' | 'right' }>()
  /** The simulation clock, as the plate's clock field. */
  private clockText = '--:--'
  /** The live train poses, so a plate can count down to the next service. */
  private trainPoses: Array<{ x: number; y: number; colour: number }> = []
  /** The station's poster artwork, one cache per scene (`render/adArt.ts`). */
  private ads: AdArt
  private grid: THREE.Group = new THREE.Group()
  /** The extent and storey the drawn grid was built for, so it is only remade when it moves. */
  private gridKey = ''
  private cursor: THREE.Mesh
  /** Remove-drag preview: one red box per pending-delete block (§9.5). */
  private ghostMesh: THREE.InstancedMesh | null = null
  /** Add-drag preview: the pending cells meshed into their final shape. */
  private ghostGroup: THREE.Group = new THREE.Group()
  private ghostKey = ''
  private ghostMaterial: THREE.MeshStandardMaterial | null = null
  /** Paint-drag preview: one flat quad per face a drag would paint (§9.5). */
  private faceGhost: THREE.InstancedMesh | null = null
  private agents: THREE.InstancedMesh
  private heads: THREE.InstancedMesh
  private hair: THREE.InstancedMesh
  private blobs: THREE.InstancedMesh
  private overlay: THREE.InstancedMesh | null = null
  private zoneOverlay: THREE.InstancedMesh | null = null
  /** Flat text labels naming the zone of each area, shown with the zone map. */
  private zoneLabels: THREE.Group = new THREE.Group()
  /** One label material per zone, cached: the text texture is the same everywhere. */
  private zoneLabelMats = new Map<number, THREE.MeshBasicMaterial>()
  /** Shared quad the zone labels are drawn on, so a rebuild allocates no geometry. */
  private zoneLabelGeo: THREE.PlaneGeometry | null = null
  private prev = new Float32Array(0)
  private cur = new Float32Array(0)
  /** Frame-to-frame id -> slot lookups, so interpolation pairs the same agent. */
  private prevId = new Map<number, number>()
  private nextId = new Map<number, number>()
  /** Agent id whose colour currently occupies each slot, so colours stay put. */
  private colorIds = new Int32Array(0)
  private agentCount = 0
  /** Interpolation window in ms, sent by the worker (varies with speed). */
  private stateIntervalMs = 200
  private lastStateTime = 0
  private yaws = new Float32Array(0)
  private frameCount = 0
  private fpsTime = 0
  private fps = 0
  private lastChunkMs = 0
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  private orthoOn = false
  /** Orthographic zoom factor, driven by the wheel while a flat view is active. */
  private orthoZoom = 1
  private tmpSize = new THREE.Vector3()
  private ghost = true
  /** 隐藏天花板: drop the ceiling of the storey above the active one. */
  private autoCeiling = true
  private activeZ = 0
  private bounds = new THREE.Box3()
  private raycaster = new THREE.Raycaster()
  private pickables: THREE.Object3D[] = []
  /** Lowest storey each column reaches; a block there has nothing under it. */
  private groundOf = new Map<string, number>()
  private dimMats = new Map<THREE.Material, THREE.Material>()
  /** 隐藏墙壁: true while walls and platform screen doors should read through. */
  private hideWalls = false
  /** Translucent clones of wall/P.S.D. materials, keyed by the opaque original. */
  private clearMats = new Map<THREE.Material, THREE.Material>()
  private disposition = false
  /** Keys held for WASD panning; the viewport keeps this in sync. */
  keys = new Set<string>()
  /** Pointer position in CSS px inside the canvas, for the edge pan. */
  private pointerX = 0
  private pointerY = 0
  private pointerInside = false
  /** Buttons held on the last pointer event; the middle one orbits, so it wins. */
  private pointerButtons = 0
  private canvasW = 1
  private canvasH = 1
  private lastFrame = 0
  private zAxis = new THREE.Vector3(0, 0, 1)
  private tmpQ = new THREE.Quaternion()
  private tmpM = new THREE.Matrix4()
  private tmpP = new THREE.Vector3()
  private tmpS = new THREE.Vector3(1, 1, 1)
  private tmpColor = new THREE.Color()
  onStats: ((s: SceneStats) => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0x0b0f16, 1)
    this.renderer.shadowMap.enabled = false
    this.renderer.localClippingEnabled = true

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x0b0f16, 120, 320)

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000)
    this.camera.up.set(0, 0, 1)
    this.ortho = new THREE.OrthographicCamera(-40, 40, 40, -40, 0.1, 2000)
    this.ortho.up.set(0, 0, 1)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(0, 0, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.maxPolarAngle = Math.PI
    this.controls.minDistance = 4
    this.controls.maxDistance = 400
    this.controls.screenSpacePanning = true
    // Left and right belong to the tools; orbit is the middle button, the wheel
    // zooms, and WASD pans. (OrbitControls defaults — LEFT rotate, RIGHT pan —
    // fought the block tools' click and drag.)
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null }
    this.controls.enablePan = false
    // Orthographic views are zoomed by the wheel handler below, not by the
    // orbit dolly (which only moves the perspective camera).
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('pointermove', this.onEdgePointerMove)
    canvas.addEventListener('pointerleave', this.onEdgePointerLeave)
    canvas.addEventListener('pointerup', this.onEdgePointerUp)

    this.mats = createMaterials()
    this.modelMats = createModelMaterials()
    // The station's ad artwork, one cache per scene so every screen shares a
    // texture per poster and nothing re-uploads on a rebuild. The JPEGs decode
    // in the background; until they land a 装饰 screen prints the placeholder
    // face, and `onReady` redraws the modules so every poster appears without a
    // reload — see `render/adArt.ts` for why the pixels are not loaded lazily.
    this.ads = createAdArt(this.renderer)
    void this.ads.load(() => {
      // The parameter is the legacy packed-key set `buildModules` no longer
      // reads (it derives its own from the data), so the station alone is passed.
      if (!this.disposition && this.stationData) this.buildModules(this.stationData, new Set())
    })
    // The 指示牌's pictograms are bitmap art, and a plate printed before the
    // images decode would print the marks off it and keep them off — the texture is
    // minted once. So the decode is started here, beside the ad artwork, and the
    // modules are rebuilt the moment it lands (see `render/pictograms.ts`).
    void loadPictograms().then((icons) => {
      if (this.disposition || icons.size === 0) return
      // The two boards drawn before the art existed: the scene's own fallback
      // plate, and every module group already standing.
      refreshSignFaceMaterial(this.modelMats)
      if (this.stationData) this.buildModules(this.stationData, new Set())
    })

    // Light rig: one key + ambient + a soft fill. §2.3 item 3.
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2f39, 1.15)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff3e0, 1.5)
    key.position.set(60, -80, 120)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.45)
    fill.position.set(-70, 60, 40)
    this.scene.add(fill)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28))

    this.scene.add(this.grid)
    this.scene.add(this.moduleMeshes)
    this.scene.add(this.wallPick)
    this.scene.add(this.trainGroup)
    this.scene.add(this.ghostGroup)
    this.scene.add(this.zoneLabels)
    this.previewGroup.visible = false
    this.scene.add(this.previewGroup)
    this.scene.add(this.fencePreviewGroup)

    // Agents. Prison Architect register: a limb-less body ("Shape"), a head and
    // a hair cap, so 3,000 people are still three instanced draws. The body
    // wears the crowd palette, the head a skin tone, the hair a colour. Low-poly
    // on purpose: the silhouette matters, not the facet count.
    this.agents = new THREE.InstancedMesh(humanoidBody(), new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }), 8000)
    this.agents.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.agents.frustumCulled = false
    // Colours are per agent, not per slot: the live list shifts as people come
    // and go, so a slot's colour would otherwise change identity every frame.
    // `renderAgents` paints each slot from the id it currently holds.
    this.scene.add(this.agents)
    this.heads = new THREE.InstancedMesh(humanoidHead(), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), 8000)
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.heads.frustumCulled = false
    this.scene.add(this.heads)
    this.hair = new THREE.InstancedMesh(humanoidHair(), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 }), 8000)
    this.hair.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.hair.frustumCulled = false
    this.scene.add(this.hair)

    const blobGeo = new THREE.CircleGeometry(0.42, 10)
    this.blobs = new THREE.InstancedMesh(blobGeo, this.mats.blob, 8000)
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.blobs.frustumCulled = false
    this.blobs.renderOrder = 2
    this.scene.add(this.blobs)

    // A 1 m square that lines up with the block grid: the 4-segment ring starts
    // at 45° so its corners are the cell corners, and it is never rotated, so it
    // highlights exactly the cell under the pointer at any camera angle.
    const cursorGeo = new THREE.RingGeometry(0.6, Math.SQRT1_2, 4, 1, Math.PI / 4)
    this.cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
    this.cursor.visible = false
    this.scene.add(this.cursor)

    this.setPreset('iso')
    this.animate()
  }

  /* ------------------------------------------------------------ station */

  setStation(data: StationData, trackCells: Set<number> = new Set()): void {
    this.solid = buildSolidSet(data.cells)
    this.finishes = finishMapOf(data.cells)
    this.stationData = data
    this.trackCellSet = trackBedKeys(data.cells, data.modules)
    // A stair's turn landing is drawn by the stair model, not the block mesher.
    const solidKeys = new Set<number>()
    for (const c of data.cells) if (c.fill === 'solid') solidKeys.add(packKey(c.x, c.y, c.z))
    this.hiddenCells = new Set<number>()
    // Every cell that draws half a block thick — a 半墙 the player laid, and every
    // block a ramp kept beside its run (`thinWallCells`) — is **meshed**, not
    // hidden: the mesher draws the half the panel keeps (`meshBand`), so the drawn
    // panel is what the pointer picks and the face a player paints is the face they
    // clicked. Thin cells are collected here because the mesher's own input is a
    // solid set, which cannot say how thick a cell is.
    this.thinSides = new Map<number, WallSide>()
    for (const t of thinWallCells(data.cells, data.modules)) this.thinSides.set(packKey(t.x, t.y, t.z), t.side)
    for (const m of data.modules) {
      if (m.type !== 'stair') continue
      for (const p of stairTurnCells(m)) {
        const k = packKey(p.x, p.y, p.z)
        if (solidKeys.has(k)) this.hiddenCells.add(k)
      }
    }
    // A shop's auto walls are drawn as thin panels by the shop model, so hide
    // their 1 m voxels and leave invisible pick boxes behind: the right-click
    // wall tools still have to find the cell they act on.
    this.wallPick.clear()
    for (const m of data.modules) {
      if (m.type !== 'shop') continue
      for (const [x, y, z] of facilityWallCells(data.cells, m)) {
        const k = packKey(x, y, z)
        if (!solidKeys.has(k)) continue
        this.hiddenCells.add(k)
        const proxy = new THREE.Mesh(this.wallPickGeo, this.wallPickMat)
        proxy.position.set(x + 0.5, y + 0.5, z + 0.5)
        this.wallPick.add(proxy)
      }
    }
    // A block a ramp runs against is kept, and the mesher draws it half a block
    // thick on the side away from the run (it is in `thinSides` above), so the
    // floor at the top of a stair is not deleted and the run fits beside it. A
    // stair's side floor cells are kept this way too.
    this.wallPick.updateMatrixWorld(true)
    // An elevator passes through the floor slab at every stop above its base:
    // hide those cells so the mesher cuts a real shaft opening (the graph still
    // sees them as nodes, and the cabin supplies the floor). The base cell stays,
    // so the lift stands on solid floor.
    for (const m of data.modules) {
      if (m.type !== 'lift') continue
      const lo = Math.min(m.from.z, m.to.z)
      for (const z of liftStopZs(m.from.z, m.to.z)) {
        if (z <= lo) continue
        for (const [fx, fy] of liftFootprintCells(m)) {
          const k = packKey(fx, fy, z)
          if (solidKeys.has(k)) this.hiddenCells.add(k)
        }
      }
    }
    this.clearModulePreview()
    // A 指示牌 prints the station's lines, so a line edit reprints every face
    // already hanging before the rebuild replaces them.
    this.redrawSignPlates()
    // Give back what the last rebuild left. `disposeChunks` is not used here: it
    // disposes every chunk geometry, and the cache below re-adds the ones whose
    // content did not change. Every geometry the last rebuild made is either
    // re-added from the cache or swept as stale at the end of this pass.
    this.releaseChunks()
    this.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    // The meshes `applyLevel` assigns materials to have just been replaced, so the
    // slice has to be applied again even if the view state itself did not change.
    this.levelKey = ''
    const t0 = performance.now()
    this.lastChunkMs = 0
    // Group cells into storeys. A storey is a floor on the fixed 4 m editing
    // grid (`LEVEL_STEPS`) plus the walls it grows up to the next grid line, so
    // a cell belongs to the storey at or below it (`storeyBand`). Keying by the
    // *grid* rather than by a contiguous run matters: a lower floor's 4 m wall
    // reaches the floor above, and the raw run then reads as one tall storey,
    // merging two floors into a single band. Bands may overlap in z across
    // columns, so each band meshes exactly its own cells (`emit`) instead of a
    // z window.
    const bandOfCell = new Map<number, number>()
    // The lowest storey each column reaches. A block standing on that storey has
    // nothing under it, so it is a plate hanging in space: it must stay on screen
    // even when its storey sits above the one being looked at. Anything with a
    // storey below it is that lower room's ceiling and goes with the cut.
    this.groundOf.clear()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      const band = storeyBand(c.z)
      bandOfCell.set(packKey(c.x, c.y, c.z), band)
      const col = `${c.x},${c.y}`
      const prev = this.groundOf.get(col)
      if (prev === undefined || band < prev) this.groundOf.set(col, band)
    }
    const byBand = new Map<number, { zLo: number; zHi: number; cells: Array<{ x: number; y: number; z: number }> }>()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      const band = bandOfCell.get(packKey(c.x, c.y, c.z)) as number
      let entry = byBand.get(band)
      if (!entry) {
        entry = { zLo: c.z, zHi: c.z, cells: [] }
        byBand.set(band, entry)
      }
      if (c.z < entry.zLo) entry.zLo = c.z
      if (c.z > entry.zHi) entry.zHi = c.z
      entry.cells.push({ x: c.x, y: c.y, z: c.z })
    }
    // Solid set of just those unsupported plates, for meshing them on their own.
    // A block a ramp carve orphaned is skipped: it is the ceiling over that
    // opening (tagged by `carveRampOpenings`), so it belongs to the storey below
    // and is cut with it rather than ghosted above the active level.
    const floating = new Set<number>()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      if (c.tags?.includes(OPENING_CEILING)) continue
      if (bandOfCell.get(packKey(c.x, c.y, c.z)) === this.groundOf.get(`${c.x},${c.y}`)) floating.add(packKey(c.x, c.y, c.z))
    }
    const box = new THREE.Box3()
    // Everything the mesher reads for one chunk, hashed. A chunk whose key is
    // unchanged meshes byte-identically, so its last meshes are reused as they are.
    // `isFloat` is part of the key because the same cells are meshed on their own
    // when they are unsupported plates: which pass a chunk belongs to is part of
    // what it draws, and a chunk that changes pass must re-mesh.
    const chunkKey = (levelZ: number, cx: number, cy: number, isFloat: boolean, cells: Array<{ x: number; y: number; z: number }>): string => {
      let h = 2166136261
      let n = 0
      for (const c of cells) {
        const k = packKey(c.x, c.y, c.z)
        if (this.hiddenCells.has(k)) continue
        h = Math.imul(h ^ c.x, 16777619)
        h = Math.imul(h ^ c.y, 16777619)
        h = Math.imul(h ^ c.z, 16777619)
        // How thick the cell is, and which half it keeps: a 半墙 the player re-tags
        // (or a wall that becomes one) meshes differently at the same coordinates.
        const side = this.thinSides.get(k)
        if (side !== undefined) h = Math.imul(h ^ side.charCodeAt(0), 16777619)
        const fin = this.finishes.get(k)
        if (fin) {
          // A custom-tinted finish id is a string; hash its characters, not its object.
          for (const id of [fin.top, fin.bottom, fin.e, fin.w, fin.n, fin.s]) {
            if (id === undefined) continue
            for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
            h = Math.imul(h ^ id.length, 16777619)
          }
        }
        n++
      }
      return `${levelZ}|${isFloat ? 'f' : 's'}|${cx},${cy}|${n}:${h >>> 0}`
    }
    const reuse = new Map(this.chunkCache)
    // Which cached chunks this rebuild will keep, decided **before** anything is
    // released: a reused chunk's `BufferGeometry` must survive the sweep, because a
    // disposed geometry is not re-uploaded and its meshes would draw nothing.
    const keep = new Set<string>()
    {
      const groupByChunk = (list: Array<{ x: number; y: number; z: number }>): Map<string, Array<{ x: number; y: number; z: number }>> => {
        const perChunk = new Map<string, Array<{ x: number; y: number; z: number }>>()
        for (const c of list) {
          const k = `${Math.floor(c.x / CHUNK) * CHUNK},${Math.floor(c.y / CHUNK) * CHUNK}`
          const entry = perChunk.get(k)
          if (entry) entry.push(c)
          else perChunk.set(k, [c])
        }
        return perChunk
      }
      // Mirrors the two passes below exactly, so the keys match.
      for (const [levelZ, band] of byBand) {
        for (const [k, list] of groupByChunk(band.cells)) {
          const [cx, cy] = k.split(',').map(Number)
          const key = chunkKey(levelZ, cx, cy, false, list)
          if (reuse.has(key)) keep.add(key)
        }
        const floats = band.cells.filter((c) => floating.has(packKey(c.x, c.y, c.z)))
        if (floats.length > 0) {
          for (const [k, list] of groupByChunk(floats)) {
            const [cx, cy] = k.split(',').map(Number)
            const key = chunkKey(levelZ, cx, cy, true, list)
            if (reuse.has(key)) keep.add(key)
          }
        }
      }
    }
    this.keepChunkGeometries = keep
    this.releaseChunks()
    this.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    this.keepChunkGeometries = null
    const nextCache = new Map<string, { key: string; meshes: THREE.Mesh[]; outlines: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>()
    const meshBand = (group: THREE.Group, levelZ: number, cells: Array<{ x: number; y: number; z: number }>, solid: Set<number>, emit: Set<number>, isFloat: boolean): void => {
      // Chunks are grouped once and meshed from that chunk's own cells, rather than
      // walking the whole 16³ volume with an `emit` test per cell: the volume is
      // mostly air, and a band that spans several z levels visited every column for
      // every level in it.
      const byChunk = new Map<string, { cx: number; cy: number; cells: Array<{ x: number; y: number; z: number }> }>()
      for (const c of cells) {
        const cx = Math.floor(c.x / CHUNK) * CHUNK
        const cy = Math.floor(c.y / CHUNK) * CHUNK
        const k = `${cx},${cy}`
        let entry = byChunk.get(k)
        if (!entry) byChunk.set(k, (entry = { cx, cy, cells: [] }))
        entry.cells.push(c)
      }
      for (const { cx, cy, cells: chunkCells } of byChunk.values()) {
        const key = chunkKey(levelZ, cx, cy, isFloat, chunkCells)
        // Unchanged since the last rebuild: keep the meshes, their GPU geometry and
        // their material wiring, and only put them back in the group.
        const keptEntry = keep.has(key) ? reuse.get(key) : undefined
        if (keptEntry) {
          nextCache.set(key, keptEntry)
          for (const m of keptEntry.meshes) {
            group.add(m)
            this.chunkMeshes.push(m)
            if (m.geometry.boundingBox) box.union(m.geometry.boundingBox)
          }
          for (const o of keptEntry.outlines) {
            group.add(o)
            this.outlineMeshes.push(o)
            this.outlineSet.add(o)
          }
          continue
        }
        const chunk = meshChunk(solid, this.finishes, cx, cy, levelZ, levelZ, emit, this.hiddenCells, chunkCells, this.thinSides)
        if (chunk.triangles === 0) continue
        this.lastChunkMs = Math.max(this.lastChunkMs, chunk.ms)
        const meshes: THREE.Mesh[] = []
        const outlines: THREE.Mesh[] = []
        // One mesh per finish, sharing the chunk geometry where faces agree.
        for (const part of chunk.parts) {
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
          geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
          geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3))
          geo.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2))
          geo.setIndex(new THREE.BufferAttribute(part.indices, 1))
          geo.computeBoundingBox()
          if (geo.boundingBox) box.union(geo.boundingBox)
          const mesh = new THREE.Mesh(geo, this.mats.finish(part.finish))
          mesh.userData.levelZ = levelZ
          mesh.userData.float = isFloat
          mesh.userData.cells = chunkCells.length
          // Tag wall faces so 隐藏墙壁 can fade them (and their outline) alone.
          mesh.userData.wall = finishDef(part.finish).family === 'wall'
          group.add(mesh)
          this.chunkMeshes.push(mesh)
          meshes.push(mesh)
          // Inverted hull outline: same geometry, back faces, pushed outward.
          const outlineMat = this.outlineMaterial()
          const outline = new THREE.Mesh(geo, outlineMat)
          // The outline owns its material, and `baseMaterial` pins the opaque
          // original: without it a second `applyLevel` would take the ghost
          // clone for the base and dim the hull again, and again.
          outline.userData.baseMaterial = outlineMat
          outline.userData.levelZ = levelZ
          outline.userData.float = isFloat
          outline.userData.wall = mesh.userData.wall
          outline.renderOrder = -1
          group.add(outline)
          this.outlineMeshes.push(outline)
          this.outlineSet.add(outline)
          outlines.push(outline)
        }
        if (meshes.length > 0) {
          // Every part's geometry, not just the first: a chunk is one mesh per
          // finish, and keeping the geometry of a reused chunk means keeping all of
          // them — the rest are disposes of in `releaseChunks` otherwise, and a
          // disposed geometry is never re-uploaded.
          nextCache.set(key, { key, meshes, outlines, geometries: meshes.map((m) => m.geometry) })
        }
      }
    }
    for (const [levelZ, band] of byBand) {
      const group = new THREE.Group()
      group.userData.levelZ = levelZ
      // Emit exactly this band's cells: runs overlap in z across columns, so a
      // chunk's z window alone would mesh a neighbouring storey too. Both passes
      // read the same set — the second only meshes the plates with nothing under
      // them — so it is built once and the floating pass is handed the short list
      // of unsupported cells rather than walking the whole storey again.
      const emit = new Set<number>()
      for (const c of band.cells) emit.add(packKey(c.x, c.y, c.z))
      // The whole storey, then its unsupported plates on their own, so the two can
      // be shown separately: a storey below the active level draws whole, while a
      // plate hanging above it still stays on screen.
      meshBand(group, levelZ, band.cells, this.solid, emit, false)
      const floats = band.cells.filter((c) => floating.has(packKey(c.x, c.y, c.z)))
      if (floats.length > 0) meshBand(group, levelZ, floats, floating, emit, true)
      this.levelGroups.set(levelZ, group)
      this.scene.add(group)
    }
    // Whatever the rebuild did not claim is a chunk that no longer exists (or that
    // changed): release its geometry and its per-chunk outline material, or the
    // cache becomes the leak it was meant to avoid. A kept chunk was skipped by
    // `releaseChunks` above and is already back in `nextCache`.
    for (const [key, stale] of reuse) {
      if (nextCache.has(key)) continue
      for (const m of stale.outlines) (m.material as THREE.Material).dispose()
      for (const g of stale.geometries) g.dispose()
    }
    this.chunkCache = nextCache
    this.bounds = box
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 8, 8))
    this.buildModules(data, trackCells)
    this.buildGrid()
    const clipY = box.min.y + (box.max.y - box.min.y) * 0.5
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY)
    void t0
    this.pickables = [...this.chunkMeshes, ...this.wallPick.children, ...this.liftPickMeshes]
    this.applyLevel()
    // Rebuild the selection box against the freshly built modules, so an edit
    // does not drop the highlight.
    this.refreshSelection()
    this.refreshCollisionHighlight()
  }

  /**
   * Highlight one placed module with a world-space box, or clear it with null.
   * The id is remembered, so a `setStation` rebuild re-finds the module.
   */
  setSelection(moduleId: string | null): void {
    this.selectedModuleId = moduleId
    this.refreshSelection()
  }

  /**
   * Highlight the placed modules a blocked preview collides with — the
   * offending pieces beside the red ghost itself. Ids are remembered, so a
   * `setStation` rebuild re-finds the modules. Pass null or an empty list to
   * clear.
   */
  setCollisionHighlight(moduleIds: readonly string[] | null): void {
    const next = moduleIds ? [...new Set(moduleIds)] : []
    if (next.length === this.colliderIds.length && next.every((id, i) => id === this.colliderIds[i])) return
    this.colliderIds = next
    this.refreshCollisionHighlight()
  }

  private refreshCollisionHighlight(): void {
    for (const helper of this.colliderHelpers) {
      this.scene.remove(helper)
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
    }
    this.colliderHelpers = []
    for (const id of this.colliderIds) {
      if (id === this.selectedModuleId) continue
      const group = this.moduleMeshes.children.find((c) => c.userData.moduleId === id)
      if (!group) continue
      const box = new THREE.Box3().setFromObject(group)
      if (box.isEmpty()) continue
      box.expandByScalar(0.06)
      const helper = new THREE.Box3Helper(box, 0xff5d5d)
      helper.renderOrder = 4
      this.colliderHelpers.push(helper)
      this.scene.add(helper)
    }
  }

  private refreshSelection(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper)
      this.selectionHelper.geometry.dispose()
      ;(this.selectionHelper.material as THREE.Material).dispose()
      this.selectionHelper = null
    }
    const id = this.selectedModuleId
    if (!id) return
    const group = this.moduleMeshes.children.find((c) => c.userData.moduleId === id)
    if (!group) return
    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return
    box.expandByScalar(0.06)
    const helper = new THREE.Box3Helper(box, 0x55b6ff)
    helper.renderOrder = 4
    this.selectionHelper = helper
    this.scene.add(helper)
  }

  private outlineMaterial(): THREE.Material {
    const m = this.mats.outline.clone()
    m.onBeforeCompile = (shader) => {
      shader.uniforms.outlineWidth = { value: 0.05 }
      shader.vertexShader = 'uniform float outlineWidth;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n transformed += normal * outlineWidth;',
      )
    }
    return m
  }

  /**
   * Build every placed module through the model factory (§3 item 6). Modules are
   * no longer unit cubes: `models.ts` gives each one a silhouette from the
   * reference art, and the camera sees steel, glass, enamel and screens.
   */
  /** Release every 电视 station plate. The meshes they were painted for are gone. */
  private clearTvPlates(): void {
    for (const tex of this.tvPlates.values()) tex.dispose()
    this.tvPlates.clear()
  }

  /** Release every 指示牌 face. Called with the modules, like `clearTvPlates`. */
  private clearSignPlates(): void {
    for (const entry of this.signPlates.values()) {
      entry.texture.dispose()
      // The material is minted per face and per rebuild, so it goes with the texture
      // it wraps: `disposeObject` keeps materials (most are shared), so this is the
      // only thing that frees these.
      entry.material.dispose()
    }
    this.signPlates.clear()
  }

  /**
   * The lit face of one 指示牌 on one side, cached per module **and panel**.
   *
   * `layout` is that face's own board — 正面 for the left face, 背面 for the right —
   * and it is drawn by `render/signFace.ts` with the line shields reading the
   * **live** station document, so recolouring 1号线 reprints every board that
   * carries its shield and nothing else about the sign has to change.
   *
   * The texture is cut to the **pair's panel** (`signBoardsPanel`), not to the face
   * on it: the two faces are two plates on one piece of hardware, so they share a
   * size, and a short back prints on the same steel as a long front. That size is
   * part of the cache key — a sign that grew since its plate was minted needs a new
   * texture, not a redraw, so the key carries the panel's metres and a stale entry
   * can never be handed to a mesh cut to a different size.
   *
   * What goes back to the model is a **material** — a `MeshBasicMaterial` whose map
   * is that texture, exactly as every other printed panel in `models.ts` is built.
   * Returning the bare texture was the bug that left every sign face black: a mesh
   * cannot draw a texture in place of a material, so the face vanished and the
   * model's own dark lightbox showed through.
   */
  private makeSignPlate(id: string, layout: SignLayout, face: 'left' | 'right', panel: SignPanelSize): THREE.Material {
    const key = `${id}|${face}|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`
    const existing = this.signPlates.get(key)
    if (existing) return existing.material
    const lines = this.stationData?.lines ?? []
    const plate = signPlate(panel)
    const texture = canvasTexture(plate.width, plate.height, (g) => {
      drawSignPanel(g, layout, { lines, panel }, face)
    })
    const material = litPanelMaterial(texture)
    this.signPlates.set(key, { texture, material, face })
    return material
  }

  /**
   * Redraw every 指示牌 face in place, from the live document.
   *
   * A board prints the station's lines (a shield's colour, its number, its gloss)
   * and the player's own components. Its components come from the module
   * document, so a layout edit rebuilds the plate with the modules — but a *line*
   * edit is a different shape of change, and this is where it lands: every face
   * already hanging reprints, keeping its geometry and material, exactly like the
   * 电视's clock. `setStation` calls it before the rebuild, so a recoloured shield
   * reaches the boards a 线路 edit never touched.
   */
  private redrawSignPlates(): void {
    if (this.signPlates.size === 0) return
    const lines = this.stationData?.lines ?? []
    for (const [key, entry] of this.signPlates) {
      const id = key.slice(0, key.indexOf('|'))
      const mod = this.stationData?.modules.find((m) => m.id === id)
      if (!mod || mod.type !== 'sign') continue
      const boards = signBoardsOf(mod.cfg, this.stationData)
      const layout = signFaceLayout(boards, entry.face === 'right' ? 'back' : 'front')
      const canvas = entry.texture.image as HTMLCanvasElement | undefined
      const g = canvas?.getContext('2d')
      if (!canvas || !g) continue
      // A board that grew or shrank since the plate was minted needs a new
      // texture, not a redraw: the mesh's own size is rebuilt with the modules, so
      // the plate only has to match the geometry it is drawn on.
      const panel = signBoardsPanel(boards)
      const plate = signPlate(panel)
      if (canvas.width !== plate.width || canvas.height !== plate.height) continue
      drawSignPanel(g, layout, { lines, panel }, entry.face)
      entry.texture.needsUpdate = true
    }
  }

  private buildModules(data: StationData, _trackCells: Set<number>): void {
    this.clearModules()
    // The plates belong to the module groups just dropped, so they go with them —
    // otherwise every edit would leak one texture per 电视 or 指示牌.
    const trackCells = trackBedKeys(data.cells, data.modules)
    const ctx: ModuleContext = {
      mats: this.modelMats,
      ads: this.ads,
      data,
      trackCells,
      finish: (id) => this.mats.finish(id),
      tvPlate: (id, x, y) => this.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, data.modules),
      signFace: (id, layout, face, panel) => this.makeSignPlate(id, layout, face, panel),
      owned: this.ownedMats,
    }
    const blobsByKey = new Map<string, { levelZ: number; ground: number | undefined; blobs: Array<[number, number, number, number]> }>()
    this.psdGroups = []
    this.adScreens = []
    for (const mod of data.modules) {
      const group = buildModule(mod, ctx)
      if (!group) continue
      group.userData.moduleId = mod.id
      group.userData.levelZs = moduleLevels(mod)
      const ground = this.groundOf.get(`${mod.x},${mod.y}`)
      group.userData.groundBand = ground
      this.moduleMeshes.add(group)
      if (mod.type === 'fence') this.fenceGroups.push(group)
      if (mod.type === 'escalator') {
        const roll = group.userData.escalator as EscalatorRoll | undefined
        if (roll) this.escalatorRolls.push(roll)
      }
      if (mod.type === 'lift') {
        const cabin = group.userData.liftCabin as THREE.Object3D | undefined
        if (cabin) {
          const originZ = mod.from.z + 1
          this.liftRigs.push({ key: `${mod.x},${mod.y},${mod.from.z}`, group, cabin, originZ, baseFrom: originZ, baseTo: originZ, doorFrom: 0, doorTo: 0, have: false })
        }
        group.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) this.liftPickMeshes.push(mesh)
        })
      }
      if (mod.type === 'platform-edge') {
        const line = data.lines.find((l) => l.id === mod.cfg.line)
        const colour = line ? parseInt(line.colour.replace('#', ''), 16) || 0x1f5fd0 : 0x1f5fd0
        this.psdGroups.push({ group, colour })
      }
      if (mod.type === 'billboard' || mod.type === 'tv') {
        const screen = group.userData.adScreen as THREE.Mesh | undefined
        if (screen) this.adScreens.push(screen)
        if (mod.type === 'tv' && screen) {
          // The plate is the station information and never changes; only the
          // window (the content the network feed plays in) cycles.
          this.tvScreens.push({
            screen,
            moduleId: mod.id,
            poster: String(screen.userData.adPoster ?? ''),
            nextAt: performance.now() + TV_FIRST_SWAP_MS + Math.random() * TV_SWAP_JITTER_MS,
          })
        }
      }
      if (mod.type === 'gate') {
        if (group.userData.wing) {
          // The leaf's length runs along local x, so it blocks local y; a 90°
          // rotation swaps the world crossing axis to x.
          const axisY = (mod.rot ?? 0) % 2 === 0
          this.gateWings.push({ root: group, x: mod.x + 0.5, y: mod.y + 0.5, z: mod.z + 1, axisY, pending: 0, hold: 0, open: 0, target: 0 })
        }
      }
      const r = blobRadius(mod.type)
      if (r > 0) {
        const blob: [number, number, number, number] = [mod.x + 0.5, mod.y + 0.5, mod.z + 1 - 0.42, r]
        const bk = `${mod.z}|${ground ?? 'x'}`
        const entry = blobsByKey.get(bk)
        if (entry) entry.blobs.push(blob)
        else blobsByKey.set(bk, { levelZ: mod.z, ground, blobs: [blob] })
      }
    }
    // Contact blobs under the floor-standing modules (§11), one batch per level
    // so a shadow disappears with the storey it sits on. `clearModules` disposes
    // every previous batch, so none of them are removed again here.
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    for (const entry of blobsByKey.values()) {
      const { levelZ, ground, blobs } = entry
      const inst = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 12), this.mats.blob, Math.max(1, blobs.length))
      inst.renderOrder = 2
      inst.frustumCulled = false
      inst.userData.levelZs = [levelZ]
      inst.userData.groundBand = ground
      for (let i = 0; i < blobs.length; i++) {
        const [x, y, z, r] = blobs[i]
        m.compose(p.set(x, y, z), q, s.set(r, r, r))
        inst.setMatrixAt(i, m)
      }
      inst.count = blobs.length
      this.moduleMeshes.add(inst)
    }
    const decal = this.tactileDecals(data)
    if (decal) this.moduleMeshes.add(decal)
  }

  /** Drop the last frame's module geometry and trains without touching materials. */
  private clearModules(): void {
    this.clearFencePreview()
    // The per-piece plates are minted for the groups about to be dropped, so they
    // are released here rather than leaking one texture per 电视 or 指示牌 an edit
    // passes through.
    this.clearTvPlates()
    this.clearSignPlates()
    // The materials a builder minted for this build (a 站台门 header, an 出入口
    // header, the 售票机 marquee, a room's 招牌). They wrap a canvas of their own, so
    // keeping them — which is what `disposeObject` does with every other material —
    // would hold the pixels and the GL texture for the rest of the session.
    for (const m of this.ownedMats) {
      const map = (m as THREE.MeshBasicMaterial).map
      if (map) map.dispose()
      m.dispose()
    }
    this.ownedMats = []
    for (const child of [...this.moduleMeshes.children]) {
      disposeObject(child)
      this.moduleMeshes.remove(child)
    }
    this.fenceGroups = []
    this.escalatorRolls.length = 0
    this.liftRigs.length = 0
    this.liftPickMeshes.length = 0
    this.gateWings.length = 0
    this.adScreens.length = 0
    this.tvScreens.length = 0
  }

  /**
   * The lit station plate for one 电视: the frame the content window sits inside.
   *
   * It is station information, not artwork, so it is drawn from the live document
   * — the line's own name, colour and terminus, the clock, and how close the next
   * train is — and cached per module. It only has to be redrawn when one of those
   * changes, which `setSimClock` does once a minute rather than every frame.
   *
   * The line is the station's **first** line. A 电视 is ceiling furniture rather
   * than platform equipment, so it belongs to no platform and carries no line of
   * its own; once a station runs several lines, this is the one place to revisit
   * (a board per platform would want the line whose track is nearest).
   */
  private makeTvPlate(id: string, x: number, y: number): THREE.Texture {
    const existing = this.tvPlates.get(id)
    if (existing) return existing
    const line = this.stationData?.lines[0]
    const status = line ? tvLineStatus(line, this.trainPoses, [x, y]) : null
    const t = canvasTexture(STATION_PLATE.width, STATION_PLATE.height, (g) => {
      drawStationDisplay(g, status, this.stationData?.name ?? '', this.clockText)
    })
    this.tvPlates.set(id, t)
    return t
  }

  /**
   * The simulation clock, printed in the plate's information column. Called from
   * the worker's state frame. When the printed minute changes, every plate is
   * redrawn in place — the meshes keep their geometry and material, so nothing
   * rebuilds but the pixels.
   */
  setSimClock(simTime: number): void {
    const h = Math.floor(simTime / 3600) % 24
    const mm = Math.floor((simTime % 3600) / 60)
    const next = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    if (next === this.clockText) return
    this.clockText = next
    for (const [id, tex] of this.tvPlates) {
      const canvas = tex.image as HTMLCanvasElement
      const g = canvas.getContext('2d') as CanvasRenderingContext2D
      const line = this.stationData?.lines[0]
      const mod = this.stationData?.modules.find((m) => m.id === id)
      const status = line ? tvLineStatus(line, this.trainPoses, [mod ? mod.x + 0.5 : 0.5, mod ? mod.y + 0.5 : 0.5]) : null
      drawStationDisplay(g, status, this.stationData?.name ?? '', this.clockText)
      tex.needsUpdate = true
    }
  }

  /**
   * The content window's cadence. A 电视 updates the *feed* in its window every so
   * often, so this swaps the artwork — never the station plate around it — on a
   * period drawn per screen from the kit's own range, with a fresh period rolled
   * after each swap. Two screens side by side therefore drift apart instead of
   * flipping together, which is what the reference photo's wall of TVs looks like.
   */
  private updateAdScreens(now: number): void {
    for (const tv of this.tvScreens) {
      if (now < tv.nextAt) continue
      const win = tv.screen.userData.adWindow as { x: number; z: number; w: number; h: number } | undefined
      if (win && this.ads) {
        const next = this.ads.adWindow(win.w, win.h)
        // The quad is `adArt`'s and is shared with every screen on this panel size,
        // so it is never disposed here — only re-pointed. The material is shared
        // from the ad cache too, so it is only dropped, never disposed.
        tv.screen.geometry = next.geometry
        tv.screen.material = next.material
        tv.screen.userData.adPoster = next.slug
        tv.poster = next.slug
      }
      tv.nextAt = now + TV_SWAP_MIN_MS + Math.random() * (TV_SWAP_MAX_MS - TV_SWAP_MIN_MS)
    }
  }

  /**
   * Rolling stock (§6). The worker sends one pose per live train as a flat
   * `Float32Array`, stride 10: x, y, z, cars, stock index, doors-open, colour,
   * direction, yaw, door-side mask. A consist is cached by its signature (colour
   * + direction + length + mask), so it survives slot reordering, and its two
   * latest poses are kept so `updateTrains` can glide it between ticks.
   *
   * The mask says which door banks may open (§1.13): bit 0 the consist's local
   * +y, bit 1 its local −y. Only a side with platform screen doors is set, so
   * the leaves on the tunnel-wall side stay shut however long the train stands.
   */
  setTrains(buffer: Float32Array): void {
    const STRIDE = 10
    const n = Math.min(Math.floor(buffer.length / STRIDE), 64)
    // Keep the live poses: the 电视 station plate counts down to the next train,
    // so it has to see where the trains actually are (`tvLineStatus`).
    this.trainPoses.length = 0
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      this.trainPoses.push({ x: buffer[o], y: buffer[o + 1], colour: buffer[o + 6] & 0xffffff })
    }
    for (const entry of this.trainSlots.values()) entry.active = false
    const openColours = new Set<number>()
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const x = buffer[o]
      const y = buffer[o + 1]
      const z = buffer[o + 2]
      const cars = buffer[o + 3] | 0
      const stockIdx = buffer[o + 4] | 0
      const doorsOpen = buffer[o + 5] > 0.5
      const colour = buffer[o + 6] & 0xffffff
      const dirSign = buffer[o + 7] >= 0 ? 1 : -1
      const yaw = buffer[o + 8]
      const doorSides = buffer[o + 9] | 0
      if (doorsOpen && doorSides !== 0) openColours.add(colour)
      const sig = `${colour}:${dirSign}:${cars}:${stockIdx}:${yaw}:${doorSides}`
      let entry = this.trainSlots.get(sig)
      if (!entry) {
        const stock: StockClass = STOCK_CLASSES[stockIdx] ?? 'B'
        const group = buildTrain(this.modelMats, { x, y, z, cars, stock, doorsOpen, colour: `#${colour.toString(16).padStart(6, '0')}`, dirSign, yaw })
        // The storey the consist stands in: its track surface is half a metre
        // below the platform, so the walk-surface convention (`cell z + 1`)
        // rounds back to the floor block the train rides over. Without the
        // rounding a consist berthed at -16 banded to -16.5 — below the storey
        // it is standing on — and vanished with 显示其他层 off.
        group.userData.levelZs = [storeyBand(Math.round(z - 1))]
        group.userData.doorT = [0, 0]
        this.trainGroup.add(group)
        entry = { group, sig, from: new THREE.Vector3(x, y, z), to: new THREE.Vector3(x, y, z), active: true }
        this.trainSlots.set(sig, entry)
      } else {
        // Continue from where this consist was last drawn. A consist that has
        // only just reappeared (the previous service departed long ago) snaps to
        // its approach start rather than streaking back across the platform.
        if (entry.active) entry.from.copy(entry.to)
        else entry.from.set(x, y, z)
        entry.to.set(x, y, z)
        entry.active = true
      }
      // `visible` here is the sim's own state — a consist between services is
      // parked — and `parked` carries it across an `applyLevel`, which owns the
      // flag otherwise (the level slicing and the sim both write it).
      entry.group.userData.parked = false
      // Doors ease open and shut per bank in `updateTrains`, never snapping.
      entry.group.userData.doorOpen = doorsOpen ? 1 : 0
      entry.group.userData.doorSides = doorSides
      this.applyGroupLevel(entry.group, 'train')
    }
    for (const entry of this.trainSlots.values()) {
      if (entry.active) continue
      entry.group.userData.parked = true
      entry.group.visible = false
    }
    // The screen doors at a platform open with the train berthed at its line.
    for (const psd of this.psdGroups) psd.group.userData.doorTarget = openColours.has(psd.colour) ? 1 : 0
    this.updateTrains(performance.now(), 0)
  }

  /**
   * One pose per elevator car, stride 6: plan x, plan y, lower cell z, upper
   * cell z, cabin floor height, door fraction. Pairs each car with its shaft by
   * the first three numbers and queues the new cabin position for gliding.
   */
  setLifts(buffer: Float32Array): void {
    const STRIDE = 6
    const n = Math.floor(buffer.length / STRIDE)
    for (const rig of this.liftRigs) {
      if (rig.have) {
        rig.baseFrom = rig.baseTo
        rig.doorFrom = rig.doorTo
      }
    }
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const key = `${buffer[o] | 0},${buffer[o + 1] | 0},${buffer[o + 2] | 0}`
      const rig = this.liftRigs.find((r) => r.key === key)
      if (!rig) continue
      if (!rig.have) {
        rig.baseFrom = buffer[o + 4]
        rig.doorFrom = buffer[o + 5]
        rig.have = true
      }
      rig.baseTo = buffer[o + 4]
      rig.doorTo = buffer[o + 5]
    }
  }

  /** Glide every cabin between snapshots and draw its doors. */
  private updateLifts(now: number): void {
    if (this.liftRigs.length === 0) return
    const alpha = Math.min(1, Math.max(0, (now - this.lastStateTime) / this.stateIntervalMs))
    for (const rig of this.liftRigs) {
      if (!rig.have) continue
      const z = rig.baseFrom + (rig.baseTo - rig.baseFrom) * alpha
      rig.cabin.position.z = z - rig.originZ
      const door = rig.doorFrom + (rig.doorTo - rig.doorFrom) * alpha
      setDoors(rig.group, door)
    }
  }

  /** Place every visible consist between its last two worker poses, and ease doors. */
  private updateTrains(now: number, dt: number): void {
    const alpha = Math.min(1, Math.max(0, (now - this.lastStateTime) / this.stateIntervalMs))
    for (const entry of this.trainSlots.values()) {
      if (!entry.group.visible) continue
      entry.group.position.lerpVectors(entry.from, entry.to, alpha)
      this.advanceTrainDoors(entry.group, dt)
    }
    for (const psd of this.psdGroups) this.advanceDoors(psd.group, dt)
  }

  /**
   * Ease a consist's two door banks separately (§1.13). A bank opens only when
   * the doors are commanded open *and* its bit is set in the berth's mask, so
   * the side facing the tunnel wall never opens — that side simply has no
   * platform screen doors to meet.
   */
  private advanceTrainDoors(root: THREE.Object3D, dt: number): void {
    const sides = (root.userData.doorSides as number) ?? 0
    const open = ((root.userData.doorOpen as number) ?? 0) > 0.5
    const target = [open && (sides & 1) !== 0 ? 1 : 0, open && (sides & 2) !== 0 ? 1 : 0]
    const t = (root.userData.doorT as number[] | undefined) ?? [0, 0]
    const step = (dt * (1000 / this.stateIntervalMs)) / DOOR_TRAVEL_S
    for (let i = 0; i < 2; i++) {
      const cur = t[i]
      if (cur === target[i]) continue
      t[i] = target[i] > cur ? Math.min(target[i], cur + step) : Math.max(target[i], cur - step)
    }
    root.userData.doorT = t
    setDoorsSides(root, t[0], t[1])
  }

  /**
   * Ease one group's doors toward their target. A leaf takes `DOOR_TRAVEL_S` of
   * sim time to cross, so the motion stays proportional to the sim clock at any
   * fast-forward multiplier (`stateIntervalMs` shrinks as speed climbs).
   */
  private advanceDoors(root: THREE.Object3D, dt: number): void {
    const target = (root.userData.doorTarget as number) ?? 0
    const cur = (root.userData.doorT as number) ?? 0
    if (cur === target) return
    const step = (dt * (1000 / this.stateIntervalMs)) / DOOR_TRAVEL_S
    const t = target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step)
    root.userData.doorT = t
    setDoors(root, t)
  }

  /**
   * Roll every escalator's step band by the same simulated time the crowd
   * advances, so the steps move at `ESCALATOR_SPEED` m/s however fast the clock
   * runs. Called with `simDt`, not wall time.
   */
  private updateEscalators(simDt: number): void {
    for (const roll of this.escalatorRolls) rollEscalator(roll, simDt)
  }

  /**
   * Count the passengers crossing each gate's lane. Called once per worker
   * snapshot, because `prev`/`cur` only change then — the per-frame loop in
   * `animate` would otherwise re-count the same step dozens of times. A
   * passenger is counted when its step crosses the lane plane (previous →
   * current): a real pass, not merely queueing nearby.
   */
  private detectGateCrossings(): void {
    const n = this.agentCount
    if (n === 0 || this.gateWings.length === 0) return
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const p = i * 3
      const ax = this.cur[o]
      const ay = this.cur[o + 1]
      const az = this.cur[o + 2]
      const bx = this.prev[p]
      const by = this.prev[p + 1]
      const bz = this.prev[p + 2]
      for (const g of this.gateWings) {
        // Gate lanes live on one storey; skip agents on another.
        if (Math.abs(az - g.z) > 0.75 && Math.abs(bz - g.z) > 0.75) continue
        // The clearance between queued bodies and the node means a genuine
        // crossing always has a sizeable step along the crossing axis; a
        // walker drifting along the gate row does not.
        const sPrev = (g.axisY ? by : bx) - (g.axisY ? g.y : g.x)
        const sCur = (g.axisY ? ay : ax) - (g.axisY ? g.y : g.x)
        // The queue is held outside the gate cell, so only a passenger that was
        // outside can be entering: either stepping in past the cell edge, or
        // jumping clean across to the far side in one snapshot at speed.
        if (Math.abs(sPrev) < GATE_EDGE) continue
        const inside = Math.abs(sCur) < GATE_EDGE
        const crossed = (sPrev < 0) !== (sCur < 0)
        if (!inside && !crossed) continue
        if (Math.abs(sCur - sPrev) < 0.12) continue
        const lat = g.axisY ? (bx + ax) / 2 - g.x : (by + ay) / 2 - g.y
        if (Math.abs(lat) > 0.45) continue
        if (g.pending < 4) g.pending++
      }
    }
  }

  /**
   * Advance every turnstile's cycle. Each counted crossing queues one
   * open/hold/close cycle, and the next can start only once the leaf is fully
   * shut — so one passenger passes, the gate closes, then reopens for the next,
   * instead of being held open by whoever is waiting.
   */
  private updateGates(simDt: number): void {
    for (const g of this.gateWings) this.stepGateWing(g, simDt)
  }

  /** Run one gate's open/hold/close cycle, starting the next only once shut. */
  private stepGateWing(g: GateWing, simDt: number): void {
    if (g.hold > 0) {
      g.hold -= simDt
      g.target = 1
    } else if (g.open === 0 && g.pending > 0) {
      g.pending--
      g.hold = GATE_HOLD_S
      g.target = 1
    } else {
      g.target = 0
    }
    if (g.open === g.target) return
    const rate = (g.target > g.open ? 1 / GATE_OPEN_S : 1 / GATE_SHUT_S) * simDt
    g.open = g.target > g.open ? Math.min(g.target, g.open + rate) : Math.max(g.target, g.open - rate)
    setGateWing(g.root, g.open)
  }

  /**
   * Tactile strips along every platform edge, as a separate transparent quad
   * layer so they never break a chunk merge (§4.2). The strip sits on the side
   * of the edge cell that faces a track bed.
   */
  private tactileDecals(data: StationData): THREE.Mesh | null {
    const track = trackBedKeys(data.cells, data.modules)
    if (track.size === 0) return null
    const pos: number[] = []
    const nor: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let base = 0
    const quad = (x0: number, y0: number, x1: number, y1: number, z: number): void => {
      pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z)
      for (let i = 0; i < 4; i++) nor.push(0, 0, 1)
      uv.push(0, 0, 1, 0, 1, 1, 0, 1)
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      base += 4
    }
    for (const m of data.modules) {
      if (m.type !== 'platform-edge') continue
      const z = m.z + 1 + 0.02
      for (const [x, y] of edgeCells(m)) {
        if (track.has(`${x},${y - 1},${m.z}`)) quad(x, y, x + 1, y + 0.3, z)
        else if (track.has(`${x},${y + 1},${m.z}`)) quad(x, y + 0.7, x + 1, y + 1, z)
        else if (track.has(`${x - 1},${y},${m.z}`)) quad(x, y, x + 0.3, y + 1, z)
        else if (track.has(`${x + 1},${y},${m.z}`)) quad(x + 0.7, y, x + 1, y + 1, z)
      }
    }
    if (idx.length === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1))
    const mesh = new THREE.Mesh(geo, this.mats.tactile)
    mesh.renderOrder = 1
    mesh.userData.levelZs = [...new Set(data.modules.filter((m) => m.type === 'platform-edge').map((m) => m.z))]
    return mesh
  }

  private clearGrid(): void {
    // `Group.clear()` only unparents: the geometry and the per-build line material
    // have to be released too, or every rebuild leaves a dead VBO behind.
    for (const child of this.grid.children) {
      const seg = child as THREE.LineSegments
      seg.geometry?.dispose()
      const mat = seg.material as THREE.Material | undefined
      mat?.dispose()
    }
    this.grid.clear()
  }

  private buildGrid(): void {
    const box = this.bounds
    const x0 = Math.floor(box.min.x / 5) * 5 - 5
    const x1 = Math.ceil(box.max.x / 5) * 5 + 5
    const y0 = Math.floor(box.min.y / 5) * 5 - 5
    const y1 = Math.ceil(box.max.y / 5) * 5 + 5
    const z = this.activeZ + 1.002
    // The grid depends on the station's extent and the active storey, not on what
    // the last edit changed — and `setStation` and `setLevel` both call this, so
    // most edits rebuild an identical grid. Reuse it when nothing it reads moved.
    const key = `${x0},${x1},${y0},${y1},${z}`
    if (key === this.gridKey && this.grid.children.length > 0) return
    this.clearGrid()
    this.gridKey = key
    const minor = new Float32Array(((x1 - x0) + (y1 - y0) + 2) * 6)
    let k = 0
    for (let x = x0; x <= x1; x++) {
      minor[k++] = x; minor[k++] = y0; minor[k++] = z; minor[k++] = x; minor[k++] = y1; minor[k++] = z
    }
    for (let y = y0; y <= y1; y++) {
      minor[k++] = x0; minor[k++] = y; minor[k++] = z; minor[k++] = x1; minor[k++] = y; minor[k++] = z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(minor.subarray(0, k), 3))
    this.grid.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a3444, transparent: true, opacity: 0.8 })))
    void k
  }

  private disposeChunks(): void {
    this.releaseChunks()
    this.scene.remove(...this.levelGroups.values())
    this.levelGroups.clear()
    // `dispose()` is the end of the road, so the cache's own references go too — the
    // geometry itself was already released by `releaseChunks` above.
    this.chunkCache.clear()
  }

  /**
   * Release the rebuilt chunk geometry and the per-chunk outline materials, without
   * touching the scene graph or the chunk cache.
   *
   * `setStation` calls this to put down everything the *last* rebuild left, then
   * re-adds from `chunkCache` the chunks whose content did not change — so the
   * geometry here is still wanted by the cache entries, which is why this is split
   * from the cache's own pruning (see the stale sweep in `setStation`).
   */
  private releaseChunks(): void {
    // Geometries are shared between a chunk mesh and its outline mesh, and the
    // surface materials are shared across chunks: only the geometry and the
    // per-chunk outline material are ours to dispose.
    //
    // A chunk the rebuild is about to reuse is skipped: its geometry is handed
    // straight back to a fresh group, and disposing it would drop it from the GPU
    // without a re-upload, so the reused meshes would draw nothing.
    const keep = this.keepChunkGeometries
    const kept = keep ? new Set<THREE.BufferGeometry>() : null
    const keptOutline = keep ? new Set<THREE.Material>() : null
    if (keep) {
      for (const entry of this.chunkCache.values()) {
        if (!keep.has(entry.key)) continue
        for (const g of entry.geometries) kept?.add(g)
        for (const o of entry.outlines) keptOutline?.add(o.material as THREE.Material)
      }
    }
    for (const m of this.chunkMeshes) {
      if (kept?.has(m.geometry)) continue
      m.geometry.dispose()
    }
    for (const m of this.outlineMeshes) {
      const mat = m.material as THREE.Material
      if (keptOutline?.has(mat)) continue
      mat.dispose()
    }
    // The 显示其他层 / 隐藏墙壁 caches are keyed by the very materials just dropped —
    // an outline material is minted per chunk part per rebuild, and a module-local
    // plate material per module. Left alone they grow for the whole session, and
    // each entry pins a material (and, through `Material.clone`, its `map` texture)
    // that nothing else references any more. Dropping what is now unreachable is
    // all this needs: every live material is re-cached on the next `applyLevel`.
    this.dimMats.clear()
    this.clearMats.clear()
    this.chunkMeshes = []
    this.outlineMeshes = []
    this.outlineSet = new Set()
  }

  /* ------------------------------------------------------------- levels */

  setLevel(z: number, ghost: boolean): void {
    this.activeZ = z
    this.ghost = ghost
    this.applyLevel()
    this.buildGrid()
  }

  /** 隐藏天花板: stop hiding the ceilings of the storey above the active one. */
  setAutoCeiling(on: boolean): void {
    this.autoCeiling = on
    this.applyLevel()
  }

  /**
   * Show, ghost or hide every storey for the active level. The rule itself is
   * `render/levelSlicing.ts`; this is only the walk over the scene.
   *
   * 显示其他层 off is absolute: the active storey and nothing else — blocks,
   * fixtures, crowd and trains alike — whatever the camera angle. On, the other
   * storeys are drawn as 35% ghosts, which are translucent and keep their real
   * depth, so a storey the active one covers is simply behind it and the depth
   * test drops it: the ghost shows exactly where it does not block the depth
   * being worked on. 隐藏天花板 is the one thing above the active storey that
   * still draws, and only for the plates that are not that room's ceiling.
   */
  private applyLevel(): void {
    // This walks every chunk mesh and every module group in the station, so it is
    // the most expensive thing a view toggle does. One edit can ask for it three
    // times (`setStation` → `setLevel`, then `setAutoCeiling`, then `setCutaway`),
    // and two of those usually change nothing — so skip a repeat with the same
    // slice. `setStation` clears the key because it rebuilds the meshes this
    // assigns materials to.
    const key = `${this.activeZ}|${this.ghost}|${this.autoCeiling}|${this.hideWalls}`
    if (key === this.levelKey) return
    this.levelKey = key
    // One reused options record: `applyLevel` walks every chunk mesh in the
    // station, so it must not mint an object per mesh.
    const opts = { ghost: this.ghost, autoCeiling: this.autoCeiling, unsupported: false }
    const outlines = this.outlineSet
    for (const [lz, group] of this.levelGroups) {
      group.visible = true
      const side = levelSide([lz], this.activeZ)
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) continue
        // A plate with nothing under it (the street outside, a canopy on its own
        // columns) survives 隐藏天花板; a supported slab is that room's ceiling.
        opts.unsupported = mesh.userData.float === true
        mesh.visible = levelVisible(side, opts)
        if (!mesh.visible) continue
        const isOutline = outlines.has(mesh)
        // 隐藏墙壁: fade the wall faces, and drop their dark outline hull, which
        // would otherwise read as a solid black wall around the translucent faces.
        if (this.hideWalls && mesh.userData.wall === true) {
          if (isOutline) {
            mesh.visible = false
            continue
          }
          mesh.material = this.clearOf(this.baseOf(mesh))
          continue
        }
        const base = isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh)
        mesh.material = side === 'active' ? base : this.dimOf(base)
      }
    }
    // Fixtures follow the same rule: the storey above loses the pieces that hang
    // over the room below, and 显示其他层 decides whether the rest are drawn.
    for (const child of this.moduleMeshes.children) this.applyGroupLevel(child, 'module')
    // Trains own their `visible` flag (`setTrains` parks them between services),
    // so the slicing is combined with the sim's own state rather than replacing it.
    for (const child of this.trainGroup.children) this.applyGroupLevel(child, 'train')
  }

  /**
   * Show, ghost or hide one module or train group by the level(s) it occupies.
   * A ramp (escalator, stair, lift) belongs to every storey it spans;
   * everything else to its cell. Forestanding furniture with no level tag
   * (shadows, decals) always shows.
   */
  private applyGroupLevel(root: THREE.Object3D, kind: 'module' | 'train'): void {
    const levels = root.userData.levelZs as number[] | undefined
    const lz = root.userData.levelZ as number | undefined
    const zs = levels ?? (lz !== undefined ? [lz] : undefined)
    const side = levelSide(zs, this.activeZ)
    if (kind === 'train') {
      root.visible = trainVisible(side, this.ghost, root.userData.parked === true)
    } else {
      // A fixture whose column starts above the active storey stands on a plate
      // that is itself above it — the fixture's `float`, so 隐藏天花板 keeps it.
      const ground = root.userData.groundBand as number | undefined
      root.visible = levelVisible(side, {
        ghost: this.ghost,
        autoCeiling: this.autoCeiling,
        unsupported: unsupportedAbove(this.activeZ, ground),
      })
    }
    if (!root.visible) return
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = this.baseOf(mesh)
      // 隐藏墙壁: a wall panel or a platform screen door reads through.
      mesh.material = this.hideWalls && mesh.userData.wall === true ? this.clearOf(base) : side === 'active' ? base : this.dimOf(base)
    })
  }

  private baseOf(mesh: THREE.Mesh): THREE.Material {
    if (!mesh.userData.base) mesh.userData.base = mesh.material
    return mesh.userData.base as THREE.Material
  }

  /**
   * A 35% ghost of `base` for 显示其他层. `depthWrite` is off so a ghost never
   * occludes another ghost — the layers stack as translucent sheets and the
   * active storey, drawn opaque and first, still wins every pixel it covers.
   */
  private dimOf(base: THREE.Material): THREE.Material {
    let d = this.dimMats.get(base)
    if (!d) {
      d = base.clone()
      const anyMat = d as THREE.MeshStandardMaterial
      anyMat.transparent = true
      anyMat.opacity = 0.35
      anyMat.depthWrite = false
      if (anyMat.color) anyMat.color = anyMat.color.clone().lerp(new THREE.Color(0x6b7480), 0.7)
      if (anyMat.onBeforeCompile !== base.onBeforeCompile) anyMat.onBeforeCompile = base.onBeforeCompile
      this.dimMats.set(base, d)
    }
    return d
  }

  /**
   * A translucent clone of `base` for 隐藏墙壁: walls and platform screen doors
   * stay legible as surfaces but stop hiding the crowd and the station behind
   * them. `depthWrite` is off so the layers behind actually show through.
   */
  private clearOf(base: THREE.Material): THREE.Material {
    let c = this.clearMats.get(base)
    if (!c) {
      c = base.clone()
      c.transparent = true
      c.opacity = 0.16
      c.depthWrite = false
      if (c.onBeforeCompile !== base.onBeforeCompile) c.onBeforeCompile = base.onBeforeCompile
      this.clearMats.set(base, c)
    }
    return c
  }

  setCutaway(on: boolean): void {
    const planes = on ? [this.clipPlane] : []
    for (const m of [...this.chunkMeshes, ...this.outlineMeshes]) {
      const mat = m.material as THREE.Material
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
    // The crowd and their shadows must cut with the floors: otherwise a
    // cutaway hides the slab but leaves the people behind it floating in front.
    for (const mat of [this.agents.material, this.heads.material, this.hair.material, this.blobs.material] as THREE.Material[]) {
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
  }

  /** 隐藏墙壁: fade every wall and platform screen door, or restore them. */
  setHideWalls(on: boolean): void {
    this.hideWalls = on
    this.applyLevel()
  }

  /* -------------------------------------------------------------- agents */

  setAgents(buffer: Float32Array, count: number, intervalMs: number): void {
    const floats = count * 6
    if (this.cur.length < floats) {
      // Preserve the old frame so ids that survive the resize still interpolate
      // from where they were rather than streaking in from the origin.
      const grown = new Float32Array(Math.max(floats, 4096))
      grown.set(this.cur)
      this.cur = grown
    }
    if (this.prev.length < count * 3) this.prev = new Float32Array(Math.max(count * 3, 4096))
    if (this.yaws.length < count) this.yaws = new Float32Array(Math.max(count, 1024))
    if (this.colorIds.length < count) {
      const grown = new Int32Array(Math.max(count, 1024))
      grown.fill(-1)
      this.colorIds = grown
    }
    this.stateIntervalMs = intervalMs > 0 ? intervalMs : this.stateIntervalMs
    // Match each incoming agent to its previous-frame position by id before
    // overwriting `cur`. Slot i is not stable: `pool.compact()` shifts the live
    // list whenever an agent dies, so pairing by slot would interpolate between
    // two different people and send them flying across the station.
    const prevId = this.prevId
    const nextId = this.nextId
    nextId.clear()
    for (let i = 0; i < count; i++) {
      const o = i * 6
      const p = i * 3
      const old = prevId.get(buffer[o + 5])
      if (old !== undefined) {
        const q = old * 6
        this.prev[p] = this.cur[q]
        this.prev[p + 1] = this.cur[q + 1]
        this.prev[p + 2] = this.cur[q + 2]
      } else {
        // New spawn: start it at its own position, not somewhere it came from.
        this.prev[p] = buffer[o]
        this.prev[p + 1] = buffer[o + 1]
        this.prev[p + 2] = buffer[o + 2]
        this.yaws[i] = 0
      }
      nextId.set(buffer[o + 5], i)
    }
    this.cur.set(buffer.subarray(0, floats))
    this.prevId = nextId
    this.nextId = prevId
    this.agentCount = count
    this.lastStateTime = performance.now()
    // One crossing count per worker snapshot, now that `prev`/`cur` are final.
    this.detectGateCrossings()
  }

  setDensity(nodes: Float32Array, density: Float32Array, on: boolean): void {
    if (!this.overlay || this.overlay.count !== nodes.length / 3) {
      if (this.overlay) {
        this.scene.remove(this.overlay)
        this.overlay.dispose()
      }
      const g = new THREE.PlaneGeometry(1, 1)
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
      this.overlay = new THREE.InstancedMesh(g, m, Math.max(1, nodes.length / 3))
      this.overlay.renderOrder = 1
      this.overlay.frustumCulled = false
      this.scene.add(this.overlay)
    }
    const mat4 = new THREE.Matrix4()
    const col = new THREE.Color()
    const n = Math.min(density.length, this.overlay.count)
    for (let i = 0; i < n; i++) {
      const pop = density[i]
      const x = nodes[i * 3]
      const y = nodes[i * 3 + 1]
      const z = nodes[i * 3 + 2]
      mat4.makeTranslation(x, y, z + 0.06)
      this.overlay.setMatrixAt(i, mat4)
      const los = pop <= 0 ? 8 : losIndex(1 / pop)
      col.setHex(losColor(los))
      this.overlay.setColorAt(i, col)
    }
    this.overlay.count = n
    this.overlay.instanceMatrix.needsUpdate = true
    if (this.overlay.instanceColor) this.overlay.instanceColor.needsUpdate = true
    this.overlay.visible = on
  }

  setOverlayVisible(on: boolean): void {
    if (this.overlay) this.overlay.visible = on
  }

  /**
   * Fare-zone map (§4.5): one tinted quad per walkable floor cell and a flat
   * text label naming the zone at the centre of each contiguous area. The quads
   * carry the zone colour, the labels the zone's name, so the toggle answers
   * both "which colour" and "which zone" at a glance.
   */
  setZoneOverlay(
    quads: Float32Array,
    zones: Uint8Array,
    labels: Array<{ x: number; y: number; z: number; zone: number }>,
    on: boolean,
  ): void {
    const n = zones.length
    if (!this.zoneOverlay || this.zoneOverlay.count !== n) {
      if (this.zoneOverlay) {
        this.scene.remove(this.zoneOverlay)
        this.zoneOverlay.dispose()
      }
      const g = new THREE.PlaneGeometry(1, 1)
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })
      this.zoneOverlay = new THREE.InstancedMesh(g, m, Math.max(1, n))
      this.zoneOverlay.renderOrder = 1
      this.zoneOverlay.frustumCulled = false
      this.scene.add(this.zoneOverlay)
    }
    const mat4 = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let i = 0; i < n; i++) {
      mat4.makeTranslation(quads[i * 3], quads[i * 3 + 1], quads[i * 3 + 2])
      this.zoneOverlay.setMatrixAt(i, mat4)
      col.setHex(ZONE_LIST[zones[i]]?.colour ?? 0x888888)
      this.zoneOverlay.setColorAt(i, col)
    }
    this.zoneOverlay.count = n
    this.zoneOverlay.instanceMatrix.needsUpdate = true
    if (this.zoneOverlay.instanceColor) this.zoneOverlay.instanceColor.needsUpdate = true
    this.zoneOverlay.visible = on
    this.buildZoneLabels(labels, on)
  }

  /** Rebuild the flat zone-name labels (one per contiguous zone area). */
  private buildZoneLabels(labels: Array<{ x: number; y: number; z: number; zone: number }>, on: boolean): void {
    this.clearZoneLabels()
    if (!this.zoneLabelGeo) this.zoneLabelGeo = new THREE.PlaneGeometry(3.2, 1.2)
    for (const l of labels) {
      const mesh = new THREE.Mesh(this.zoneLabelGeo, this.zoneLabelMaterial(l.zone))
      mesh.position.set(l.x, l.y, l.z)
      mesh.renderOrder = 3
      mesh.frustumCulled = false
      this.zoneLabels.add(mesh)
    }
    this.zoneLabels.visible = on && labels.length > 0
  }

  private clearZoneLabels(): void {
    for (const child of [...this.zoneLabels.children]) this.zoneLabels.remove(child)
  }

  /** One cached text material per zone, drawn as a dark pill in the zone colour. */
  private zoneLabelMaterial(index: number): THREE.MeshBasicMaterial {
    let m = this.zoneLabelMats.get(index)
    if (m) return m
    const def = ZONE_LIST[index]
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 96
    const g = c.getContext('2d') as CanvasRenderingContext2D
    const hex = `#${(def?.colour ?? 0x888888).toString(16).padStart(6, '0')}`
    g.beginPath()
    g.roundRect(8, 8, c.width - 16, c.height - 16, 20)
    g.fillStyle = 'rgba(9,13,19,0.78)'
    g.fill()
    g.lineWidth = 5
    g.strokeStyle = hex
    g.stroke()
    g.fillStyle = '#ffffff'
    g.font = 'bold 42px "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(def?.label ?? '', c.width / 2, c.height / 2 + 2)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    this.zoneLabelMats.set(index, m)
    return m
  }

  /* ------------------------------------------------------------- camera */

  setPreset(name: 'iso' | 'plan' | 'front' | 'side' | 'custom'): void {
    const c = this.bounds.getCenter(new THREE.Vector3())
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1.2, 0.85).normalize(),
      plan: new THREE.Vector3(0, 0.001, 1).normalize(),
      front: new THREE.Vector3(0, -1, 0).normalize(),
      side: new THREE.Vector3(1, 0, 0).normalize(),
    }
    if (name === 'custom') return
    const dist = Math.max(40, this.bounds.getSize(new THREE.Vector3()).length() * 0.9)
    this.controls.target.copy(c)
    this.camera.position.copy(c).addScaledVector(dirs[name], dist)
    if (name === 'plan' || name === 'front' || name === 'side') this.setOrtho(true)
    else this.setOrtho(false)
    this.camera.lookAt(c)
    this.controls.update()
  }

  setOrtho(on: boolean): void {
    this.orthoOn = on
    // The orbit dolly does nothing to an orthographic frustum, so hand the
    // wheel to `onWheel` (and back) whenever the projection changes.
    this.controls.enableZoom = !on
    this.applyOrtho()
    this.ortho.position.copy(this.camera.position)
    this.ortho.quaternion.copy(this.camera.quaternion)
  }

  /** Rebuild the ortho frustum from the model bounds, the aspect and the zoom. */
  private applyOrtho(): void {
    const base = this.bounds.getSize(this.tmpSize).length() * 0.7 * this.orthoZoom
    const aspect = this.camera.aspect || 1
    this.ortho.left = -base * aspect
    this.ortho.right = base * aspect
    this.ortho.top = base
    this.ortho.bottom = -base
    this.ortho.updateProjectionMatrix()
  }

  /** Wheel zoom for flat views: scale the ortho frustum instead of dollying. */
  private onWheel = (e: WheelEvent): void => {
    if (!this.orthoOn) return
    e.preventDefault()
    this.orthoZoom = THREE.MathUtils.clamp(this.orthoZoom * Math.exp(e.deltaY * 0.001), 0.06, 16)
    this.applyOrtho()
  }

  /** Track the pointer for the edge pan. Outside the canvas the pan stops. */
  private onEdgePointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointerX = e.clientX - rect.left
    this.pointerY = e.clientY - rect.top
    this.pointerButtons = e.buttons
    this.pointerInside =
      this.pointerX >= 0 && this.pointerY >= 0 && this.pointerX <= rect.width && this.pointerY <= rect.height
  }

  private onEdgePointerLeave = (): void => {
    this.pointerInside = false
    this.pointerButtons = 0
  }

  /** Keep the button state fresh so a released orbit never leaves the pan off. */
  private onEdgePointerUp = (e: PointerEvent): void => {
    this.pointerButtons = e.buttons
  }

  frame(): void {
    const c = this.bounds.getCenter(new THREE.Vector3())
    this.controls.target.copy(c)
    this.controls.update()
  }

  /**
   * Snap the camera to look along a world direction (from the station toward
   * the camera). The view cube's face clicks pass a face normal, its corner
   * clicks a corner vector. `useOrtho` picks the projection: faces are true
   * projections, corners an isometric perspective.
   */
  setViewDirection(dir: THREE.Vector3, useOrtho: boolean): void {
    const c = this.bounds.getCenter(new THREE.Vector3())
    const dist = Math.max(40, this.bounds.getSize(new THREE.Vector3()).length() * 0.9)
    const d = dir.clone().normalize()
    // The camera is Z-up, so looking straight along ±Z makes `lookAt`
    // degenerate; a hair off-axis keeps the roll defined and still reads as a
    // top / bottom view.
    if (Math.abs(d.x) < 1e-3 && Math.abs(d.y) < 1e-3) d.x = 1e-3
    d.normalize()
    this.controls.target.copy(c)
    this.camera.position.copy(c).addScaledVector(d, dist)
    this.camera.lookAt(c)
    this.controls.update()
    this.setOrtho(useOrtho)
  }

  /**
   * Orbit from a pointer drag on the view cube: yaw turns around world Z,
   * pitch around the screen-right axis, and the elevation stops just short of
   * the poles so the view never flips.
   */
  orbitBy(dxPx: number, dyPx: number): void {
    const target = this.controls.target
    const offset = this.camera.position.clone().sub(target)
    const up = new THREE.Vector3(0, 0, 1)
    offset.applyAxisAngle(up, -dxPx * 0.008)
    const forward = offset.clone().normalize()
    const right = new THREE.Vector3().crossVectors(up, forward)
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    right.normalize()
    offset.applyAxisAngle(right, -dyPx * 0.008)
    const len = offset.length()
    const theta = Math.atan2(offset.y, offset.x)
    const phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(offset.z / len, -1, 1)), 0.02, Math.PI - 0.02)
    offset.set(len * Math.sin(phi) * Math.cos(theta), len * Math.sin(phi) * Math.sin(theta), len * Math.cos(phi))
    this.camera.position.copy(target).add(offset)
    this.camera.lookAt(target)
    this.controls.update()
  }

  /**
   * Pan input for this frame. WASD (Shift = faster) plus the mouse edge band:
   * a pointer within `EDGE_PAN_PX` of an edge pushes that way, ramped by how
   * deep it sits in the band so the motion starts gently, and a corner pushes
   * both axes together. The middle button orbits the camera, so its drag does
   * not also pan.
   */
  private panInput(): { forward: number; strafe: number } {
    let forward = 0
    let strafe = 0
    if (this.keys.has('w')) forward += 1
    if (this.keys.has('s')) forward -= 1
    if (this.keys.has('d')) strafe += 1
    if (this.keys.has('a')) strafe -= 1
    if (this.pointerInside && (this.pointerButtons & 4) === 0) {
      const ramp = (d: number): number => THREE.MathUtils.clamp((EDGE_PAN_PX - d) / EDGE_PAN_PX, 0, 1)
      const left = ramp(this.pointerX)
      const right = ramp(this.canvasW - this.pointerX)
      const top = ramp(this.pointerY)
      const bottom = ramp(this.canvasH - this.pointerY)
      strafe += right - left
      forward += top - bottom
    }
    return {
      forward: THREE.MathUtils.clamp(forward, -1, 1),
      strafe: THREE.MathUtils.clamp(strafe, -1, 1),
    }
  }

  /**
   * Move the camera across the world's XY plane. `panInput` blends WASD (Shift
   * = faster) with the mouse edge band; the pan is camera-relative, so it
   * follows the orbit. Q/E are the layer step and live in the app.
   */
  private panCamera(dt: number): void {
    if (dt <= 0) return
    const { forward, strafe } = this.panInput()
    if (forward === 0 && strafe === 0) return
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    dir.z = 0
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0) // looking straight down
    dir.normalize()
    // Screen right = forward x up (up is +z): (dx,dy,0) x (0,0,1) = (dy,-dx,0).
    const right = new THREE.Vector3(dir.y, -dir.x, 0)
    // Scale with zoom: a zoomed-in view pans metres per second, a zoomed-out
    // view crosses the station. Shift multiplies it.
    const distance = this.camera.position.distanceTo(this.controls.target)
    const speed = Math.max(4, Math.min(45, distance * 0.4)) * (this.keys.has('shift') ? 3 : 1)
    const move = new THREE.Vector3()
      .addScaledVector(dir, forward * speed * dt)
      .addScaledVector(right, strafe * speed * dt)
    // Move target and camera together so the orbit offset is preserved.
    this.camera.position.add(move)
    this.controls.target.add(move)
    this.controls.update()
  }

  setCursor(cell: [number, number, number] | null, valid = true): void {
    if (!cell) {
      this.cursor.visible = false
      return
    }
    this.cursor.visible = true
    this.cursor.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 1.02)
    const mat = this.cursor.material as THREE.MeshBasicMaterial
    mat.color.setHex(valid ? 0x6ee7ff : 0xff5d5d)
  }

  /**
   * Ghost preview for the active drag (§9.5). A remove drag flags the blocks it
   * would delete with boxes (red by default, or a caller's colour for a
   * different meaning — e.g. cyan for a wall opening); an add drag shows the
   * final shape the pending cells will take — meshed with the real profile, then
   * drawn translucent — so the release is not a surprise. `thin` names the
   * pending cells that are **半墙** (packed key → the side the panel hugs), so a
   * half-block wall previews as half a block rather than as a full one: the
   * thickness is the whole piece.
   */
  setGhost(
    cells: Array<[number, number, number]>,
    kind: 'add' | 'remove',
    colour = 0xff5d5d,
    thin?: ReadonlyMap<number, WallSide>,
  ): void {
    if (kind === 'add') {
      if (this.ghostMesh) this.ghostMesh.visible = false
      const key = this.ghostKeyOf(cells, thin)
      if (key === this.ghostKey) return
      this.ghostKey = key
      this.buildShapeGhost(cells, thin)
      return
    }

    this.ghostGroup.visible = false
    this.ghostKey = ''
    if (cells.length === 0) {
      if (this.ghostMesh) this.ghostMesh.visible = false
      return
    }
    if (!this.ghostMesh) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
      this.ghostMesh = new THREE.InstancedMesh(geo, mat, GHOST_MAX)
      this.ghostMesh.frustumCulled = false
      this.ghostMesh.renderOrder = 3
      this.scene.add(this.ghostMesh)
    }
    const m = new THREE.Matrix4()
    const col = new THREE.Color(colour)
    // Clamp to the pool capacity, not the previous frame's count — a drag that
    // grows bigger than the last preview must still draw every pending block.
    const n = Math.min(cells.length, GHOST_MAX)
    this.ghostMesh.count = n
    for (let i = 0; i < n; i++) {
      const [x, y, z] = cells[i]
      m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)
      this.ghostMesh.setMatrixAt(i, m)
      this.ghostMesh.setColorAt(i, col)
    }
    this.ghostMesh.visible = true
    this.ghostMesh.instanceMatrix.needsUpdate = true
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true
  }

  /**
   * A cheap order-stable fingerprint of a pending cell set, to skip re-meshing.
   * The 半墙 sides are part of it: R steps the thickness a thin wall's panel takes
   * without the pending cells moving at all, and a ghost that skipped that rebuild
   * would show the wall the player just turned away from.
   */
  private ghostKeyOf(cells: Array<[number, number, number]>, thin?: ReadonlyMap<number, WallSide>): string {
    let h = 2166136261
    for (const [x, y, z] of cells) {
      h = Math.imul(h ^ (x + 4096), 16777619)
      h = Math.imul(h ^ (y + 4096), 16777619)
      h = Math.imul(h ^ (z + 4096), 16777619)
      const side = thin?.get(packKey(x, y, z))
      if (side !== undefined) h = Math.imul(h ^ side.charCodeAt(0), 16777619)
    }
    return `${cells.length}:${h >>> 0}`
  }

  /**
   * Draw the pending add-cells as their final geometry. The real chunk mesher
   * builds the rounded silhouette, but only the pending cells emit faces while
   * the whole station answers neighbour queries — so the preview is the exact
   * surface the release will add, sitting at the exact target cells. A 半墙 among
   * them is meshed half a block thick, exactly as it will be once laid.
   */
  private buildShapeGhost(cells: Array<[number, number, number]>, thin?: ReadonlyMap<number, WallSide>): void {
    this.clearShapeGhost()
    if (cells.length === 0) return
    const emit = new Set<number>()
    const chunks = new Map<string, { cx: number; cy: number; cz: number }>()
    const added: number[] = []
    for (const [x, y, z] of cells) {
      const k = packKey(x, y, z)
      emit.add(k)
      const cx = Math.floor(x / CHUNK) * CHUNK
      const cy = Math.floor(y / CHUNK) * CHUNK
      chunks.set(`${cx},${cy},${z}`, { cx, cy, cz: z })
      if (!this.solid.has(k)) {
        this.solid.add(k)
        added.push(k)
      }
    }
    const mat = this.shapeGhostMaterial()
    try {
      for (const { cx, cy, cz } of chunks.values()) {
        const chunk = meshChunk(this.solid, this.finishes, cx, cy, cz, cz, emit, undefined, undefined, thin)
        for (const part of chunk.parts) {
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
          geo.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
          geo.setAttribute('color', new THREE.BufferAttribute(part.colors, 3))
          const mesh = new THREE.Mesh(geo, mat)
          mesh.frustumCulled = false
          mesh.renderOrder = 3
          this.ghostGroup.add(mesh)
        }
      }
    } finally {
      for (const k of added) this.solid.delete(k)
    }
    this.ghostGroup.visible = this.ghostGroup.children.length > 0
  }

  private clearShapeGhost(): void {
    for (const child of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose()
    }
  }

  private shapeGhostMaterial(): THREE.MeshStandardMaterial {
    if (!this.ghostMaterial) {
      this.ghostMaterial = new THREE.MeshStandardMaterial({
        color: 0x7fe4ff,
        emissive: 0x123a4a,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.0,
      })
    }
    return this.ghostMaterial
  }

  /**
   * Paint-tool preview (§9.5): a flat translucent quad sitting just proud of
   * every face a paint drag would colour. `colour` is the brush's own tint, so
   * the preview shows the finish, not just the rectangle. A **半墙** is the one
   * surface that is not on its cell's boundary: its panel is half a block thick,
   * so the quad for the face looking across the cell's clear half sits on the
   * panel itself, half a block in — the same place the brush will paint.
   */
  setFaceGhost(cells: Array<[number, number, number]>, face: Face, colour: number): void {
    if (cells.length === 0) {
      if (this.faceGhost) this.faceGhost.visible = false
      return
    }
    const n = Math.min(cells.length, GHOST_MAX)
    if (!this.faceGhost) {
      const g = new THREE.PlaneGeometry(1, 1)
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
      this.faceGhost = new THREE.InstancedMesh(g, m, GHOST_MAX)
      this.faceGhost.renderOrder = 4
      this.faceGhost.frustumCulled = false
      this.scene.add(this.faceGhost)
    }
    const [nx, ny, nz] = FACE_NORMAL[face]
    const q = new THREE.Quaternion().setFromUnitVectors(FACE_UP, new THREE.Vector3(nx, ny, nz))
    const mat = new THREE.Matrix4()
    const col = new THREE.Color(colour)
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < n; i++) {
      const [x, y, z] = cells[i]
      const side = this.thinSides.get(packKey(x, y, z))
      const inset = side !== undefined && face === halfWallInnerFace(side) ? HALF_WALL_T : 0
      const off = 0.505 - inset
      pos.set(x + 0.5 + nx * off, y + 0.5 + ny * off, z + 0.5 + nz * off)
      mat.compose(pos, q, scale)
      this.faceGhost.setMatrixAt(i, mat)
      this.faceGhost.setColorAt(i, col)
    }
    this.faceGhost.count = n
    this.faceGhost.visible = true
    this.faceGhost.instanceMatrix.needsUpdate = true
    if (this.faceGhost.instanceColor) this.faceGhost.instanceColor.needsUpdate = true
  }

  clearFaceGhost(): void {
    if (this.faceGhost) this.faceGhost.visible = false
  }

  /**
   * Hover preview for the module tool: a translucent copy of the exact piece a
   * click would place at the hovered cell, so the release is not a surprise. A
   * wide stair is several lane pieces in one placement, so this takes a list. The
   * model is built through the same factory as a placed module and then every
   * surface is swapped for a faded clone; passing `null` clears it.
   */
  setModulePreview(mod: Module | readonly Module[] | null, blocked = false): void {
    const mods = mod ? (Array.isArray(mod) ? mod : [mod]) : []
    const key = mods.length === 0 ? '' : `${mods.map(moduleGhostKey).join('|')}:${blocked ? 'x' : '-'}`
    if (key === this.previewKey) return
    this.clearModulePreview()
    this.previewKey = key
    if (mods.length === 0 || !this.stationData) return
    // The ghost is built against the station *plus* its own pieces, so a
    // multi-piece hover sees itself: the lanes of a wide stair join their steps
    // and drop the rail between them exactly as they will once placed.
    const data: StationData = { ...this.stationData, modules: [...this.stationData.modules, ...mods] }
    const ctx: ModuleContext = {
      mats: this.modelMats,
      ads: this.ads,
      data,
      trackCells: this.trackCellSet,
      finish: (id) => this.mats.finish(id),
      preview: true,
      tvPlate: (id, x, y) => this.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, data.modules),
      signFace: (id, layout, face, panel) => this.makeSignPlate(id, layout, face, panel),
      owned: this.previewOwnedMats,
    }
    const tint = blocked ? MODULE_GHOST_BAD : MODULE_GHOST_TINT
    const shared = new Set<THREE.Material>()
    for (const value of Object.values(this.modelMats)) {
      if (Array.isArray(value)) for (const m of value as THREE.Material[]) shared.add(m)
      else shared.add(value as THREE.Material)
    }
    for (const m of this.mats.finishCache.values()) shared.add(m)
    shared.add(this.mats.outline)
    shared.add(this.mats.blob)
    shared.add(this.mats.tactile)
    for (const mod of mods) {
      const group = buildModule(mod, ctx)
      if (!group) continue
      this.tintModuleGhost(group, mod, tint, 0.45, this.previewMats, this.previewBases, shared)
      this.previewGroup.add(group)
    }
    this.previewGroup.visible = true
  }

  /**
   * Swap every surface of a module group for a translucent ghost, and hand back the
   * map it built so a caller can reuse one ghost per base material.
   *
   * `tinted` is the colour a ghost is washed toward, or null to leave the materials'
   * own colours alone (the fence drag does not tint). A factory material may be shared
   * scene-wide, so a base the caller does not own is pushed onto `owned` for it to
   * dispose when the preview moves on.
   *
   * **A lit face keeps its own sidedness.** A 装饰 screen prints its artwork out of the
   * front of a plane only (`render/adArt.ts`), and a ghost that forced
   * `DoubleSide` — as the rest of the piece wants, so a translucent shape reads from
   * every angle — would print the campaign out of the back of the screen again. The
   * one thing R has to make obvious is which way the piece will face, and a back that
   * shows content cannot say. So a mesh the model already marked single-sided stays
   * single-sided, and the ghost shows the screen's own black housing from behind.
   */
  private tintModuleGhost(
    group: THREE.Object3D,
    mod: Module,
    tint: THREE.Color | null,
    opacity: number,
    owned: THREE.Material[],
    bases: THREE.Material[],
    shared: ReadonlySet<THREE.Material>,
  ): Map<THREE.Material, THREE.Material> {
    const ghostOf = new Map<THREE.Material, THREE.Material>()
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = mesh.material as THREE.Material
      let ghost = ghostOf.get(base)
      if (!ghost) {
        ghost = base.clone()
        const any = ghost as THREE.MeshStandardMaterial
        any.transparent = true
        any.opacity = opacity
        any.depthWrite = false
        if (any.side !== THREE.FrontSide) any.side = THREE.DoubleSide
        // A track bed lives *inside* the floor block until it is dug, so its ghost
        // must ignore depth or the block hides it entirely.
        if (mod.type === 'track') any.depthTest = false
        if (tint && any.color) any.color = any.color.clone().lerp(tint, 0.4)
        ghostOf.set(base, ghost)
        owned.push(ghost)
        // A factory material may be shared scene-wide; a module-local one (a printed
        // sign, say) is the caller's to dispose when the preview moves on.
        if (!shared.has(base)) bases.push(base)
      }
      mesh.material = ghost
      mesh.renderOrder = 5
      mesh.frustumCulled = false
    })
    return ghostOf
  }

  /** Drop the hover preview's geometry and the materials/geometries it owns. */
  private clearModulePreview(): void {
    for (const child of [...this.previewGroup.children]) {
      disposeObject(child)
      this.previewGroup.remove(child)
    }
    for (const m of this.previewMats) m.dispose()
    for (const m of this.previewBases) m.dispose()
    this.previewMats.length = 0
    this.previewBases.length = 0
    for (const m of this.previewOwnedMats) {
      const map = (m as THREE.MeshBasicMaterial).map
      if (map) map.dispose()
      m.dispose()
    }
    this.previewOwnedMats = []
    this.previewGroup.visible = false
    this.previewKey = ''
  }

  /**
   * Live preview for the 围栏 drag. Unlike a single-module hover, a fence's shape
   * depends on its neighbours, so the existing fences are rebuilt here with the
   * dragged line merged into their module list — dragging up to an existing end
   * updates that end's block (its cap and end post go) as you drag — and the new
   * panels are drawn translucent. Committed fences are hidden while this is up.
   * Passing `null` (or an empty list) clears it.
   */
  setFencePreview(mods: Module[] | null, blocked = false): void {
    const list = mods ?? []
    const key = list.length === 0 ? '' : `${blocked ? 'x' : '-'}|${list.map((m) => `${m.x},${m.y},${m.z},${m.rot ?? 0}`).join(';')}`
    if (key === this.fencePreviewKey) return
    this.clearFencePreview()
    this.fencePreviewKey = key
    if (list.length === 0 || !this.stationData) return
    // Hide the committed fences; the preview rebuilds every fence, so there is
    // no z-fighting and every joint reflects the in-progress line.
    for (const f of this.fenceGroups) f.visible = false
    const merged: StationData = { ...this.stationData, modules: [...this.stationData.modules, ...list] }
    const ctx: ModuleContext = {
      mats: this.modelMats,
      ads: this.ads,
      data: merged,
      trackCells: this.trackCellSet,
      finish: (id) => this.mats.finish(id),
      tvPlate: (id, x, y) => this.makeTvPlate(id, x, y),
      tvPairSlot: (id) => tvPairSlot(id, merged.modules),
      signFace: (id, layout, face, panel) => this.makeSignPlate(id, layout, face, panel),
    }
    const shown = (m: Module): boolean => {
      const zs = moduleLevels(m)
      const lowest = zs.length > 0 ? Math.min(...zs) : undefined
      const ground = this.groundOf.get(`${m.x},${m.y}`)
      return lowest === undefined || lowest <= this.activeZ || (ground !== undefined && ground > this.activeZ)
    }
    for (const m of this.stationData.modules) {
      if (m.type !== 'fence') continue
      const group = buildModule(m, ctx)
      if (!group) continue
      group.visible = shown(m)
      this.fencePreviewGroup.add(group)
    }
    // The dragged panels, tinted like the module hover ghost.
    const previewCtx: ModuleContext = { ...ctx, preview: true }
    const tint = blocked ? MODULE_GHOST_BAD : MODULE_GHOST_TINT
    const shared = new Set<THREE.Material>()
    for (const value of Object.values(this.modelMats)) {
      if (Array.isArray(value)) for (const m of value as THREE.Material[]) shared.add(m)
      else shared.add(value as THREE.Material)
    }
    for (const m of this.mats.finishCache.values()) shared.add(m)
    for (const m of list) {
      const group = buildModule(m, previewCtx)
      if (!group) continue
      this.tintModuleGhost(group, m, tint, 0.5, this.fencePreviewMats, this.fencePreviewBases, shared)
      this.fencePreviewGroup.add(group)
    }
  }

  /** Drop the fence-drag preview and bring the committed fences back. */
  private clearFencePreview(): void {
    for (const child of [...this.fencePreviewGroup.children]) {
      disposeObject(child)
      this.fencePreviewGroup.remove(child)
    }
    for (const m of this.fencePreviewMats) m.dispose()
    for (const m of this.fencePreviewBases) m.dispose()
    this.fencePreviewMats.length = 0
    this.fencePreviewBases.length = 0
    this.fencePreviewKey = ''
    for (const f of this.fenceGroups) f.visible = true
  }

  setGridVisible(on: boolean): void {
    this.grid.visible = on
  }

  /* -------------------------------------------------------------- picking */

  pick(clientX: number, clientY: number, workPlaneZ: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.activeCamera())
    // Blocks removed from the level above are not pickable: a click must not
    // grab a slab that is no longer drawn.
    const shown = this.pickables.filter((m) => m.visible && (!m.parent || m.parent.visible))
    const hits = this.raycaster.intersectObjects(shown, false)
    if (hits.length > 0) {
      const hit = hits[0]
      const p = hit.point
      const n = hit.face ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1)
      const inside = p.clone().addScaledVector(n, -0.02)
      const cell: [number, number, number] = [Math.floor(inside.x), Math.floor(inside.y), Math.floor(inside.z)]
      const place: [number, number, number] = [cell[0] + n.x, cell[1] + n.y, cell[2] + n.z]
      return { cell, solid: true, normal: [n.x, n.y, n.z], place, point: [p.x, p.y, p.z] }
    }
    // Work plane (§9.5): the floor plane of the active level, infinite.
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(workPlaneZ + 1))
    const p = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(plane, p)) {
      const cell: [number, number, number] = [Math.floor(p.x), Math.floor(p.y), workPlaneZ]
      return { cell, solid: false, normal: [0, 0, 1], place: cell, point: [p.x, p.y, p.z] }
    }
    return null
  }

  private activeCamera(): THREE.Camera {
    return this.orthoOn ? this.ortho : this.camera
  }

  /**
   * The id of the placed module under the pointer, found from its drawn meshes
   * rather than its collision envelope. Large equipment (an exit head-house) is
   * drawn far past the box it reserves, so a click on the visible model would
   * otherwise miss it and land on the floor beyond. Only visible modules count,
   * matching the level slicing. Null over bare floor or station geometry.
   */
  pickModule(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.activeCamera())
    const shown = this.moduleMeshes.children.filter((c) => c.visible && (!c.parent || c.parent.visible))
    const hits = this.raycaster.intersectObjects(shown, true)
    let modHit: THREE.Intersection | null = null
    let moduleId: string | null = null
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o && typeof o.userData.moduleId !== 'string') o = o.parent
      if (o) {
        modHit = hit
        moduleId = o.userData.moduleId as string
        break
      }
    }
    if (!modHit || !moduleId) return null
    // A block nearer the camera occludes the module: never select through a wall.
    const blocks = this.pickables.filter((m) => m.visible && (!m.parent || m.parent.visible))
    const blockHits = this.raycaster.intersectObjects(blocks, false)
    if (blockHits.length > 0 && blockHits[0].distance < modHit.distance) return null
    return moduleId
  }

  /**
   * The horizontal direction the camera is looking **from**, as a world step — the
   * value `moduleAt`'s `facing` wants. It is the
   * second half of a pick: a mesh answers *which* piece the pointer is on, but the
   * only cell that can hold two of them — a back-to-back 电视 pair — is one object
   * from two sides, and a caller that resolves a module from the **cell** rather
   * than from the drawn mesh has to say which face it meant.
   *
   * A camera looks the same way all over the screen, so one value serves the whole
   * frame, and `getWorldDirection` is right for both cameras the viewport swaps
   * between: the perspective one and the orthographic one, whose view direction is
   * constant by definition. The sign is the trap — see `facingFrom`.
   */
  pickFacing(): [number, number] {
    return facingFrom(this.activeCamera())
  }

  zoneAt(clientX: number, clientY: number, workPlaneZ: number): [number, number, number] | null {
    const r = this.pick(clientX, clientY, workPlaneZ)
    return r ? r.cell : null
  }

  /* --------------------------------------------------------------- loop */

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    const now = performance.now()
    const dt = this.lastFrame > 0 ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now
    this.panCamera(dt)
    if (this.controls.enabled) this.controls.update()
    this.renderAgents(now)
    this.updateTrains(now, dt)
    this.updateLifts(now)
    this.updateEscalators(dt * (1000 / this.stateIntervalMs))
    this.updateGates(dt * (1000 / this.stateIntervalMs))
    this.updateAdScreens(now)
    const cam = this.activeCamera()
    this.ortho.position.copy(this.camera.position)
    this.ortho.quaternion.copy(this.camera.quaternion)
    this.applyOrtho()
    this.renderer.render(this.scene, cam)
    this.frameCount++
    if (now - this.fpsTime > 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTime))
      this.frameCount = 0
      this.fpsTime = now
      this.onStats?.({
        fps: this.fps,
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls,
        agents: this.agentCount,
        lastChunkMs: this.lastChunkMs,
        chunks: this.chunkMeshes.length,
      })
    }
  }

  private renderAgents(now: number): void {
    const alpha = Math.min(1, (now - this.lastStateTime) / this.stateIntervalMs)
    const m = this.tmpM
    const q = this.tmpQ
    const pos = this.tmpP
    const scale = this.tmpS
    const axis = this.zAxis
    const n = this.agentCount
    let colorDirty = false
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const p = i * 3
      const id = this.cur[o + 5]
      const px = this.prev[p]
      const py = this.prev[p + 1]
      const pz = this.prev[p + 2]
      const cx = this.cur[o]
      const cy = this.cur[o + 1]
      const cz = this.cur[o + 2]
      pos.set(px + (cx - px) * alpha, py + (cy - py) * alpha, pz + (cz - pz) * alpha)
      const dx = cx - px
      const dy = cy - py
      if (dx * dx + dy * dy > 1e-6) this.yaws[i] = Math.atan2(dy, dx)
      q.setFromAxisAngle(axis, this.yaws[i])
      // Only the crowd on the storeys that are actually drawn: an agent on a
      // hidden floor above (or a ghosted one below) would otherwise float over
      // the visible floor, reading as "seen through" it.
      if (this.agentLevelVisible(pos.z)) {
        m.compose(pos, q, scale)
        this.agents.setMatrixAt(i, m)
        this.heads.setMatrixAt(i, m)
        this.hair.setMatrixAt(i, m)
        m.makeTranslation(pos.x, pos.y, pos.z + 0.03)
        this.blobs.setMatrixAt(i, m)
      } else {
        m.makeScale(0, 0, 0)
        this.agents.setMatrixAt(i, m)
        this.heads.setMatrixAt(i, m)
        this.hair.setMatrixAt(i, m)
        this.blobs.setMatrixAt(i, m)
      }
      // Paint the slot only when the agent occupying it changes, so a person
      // keeps their colour for their whole life instead of swapping each frame.
      if (this.colorIds[i] !== id) {
        this.colorIds[i] = id
        this.agents.setColorAt(i, this.tmpColor.setHex(AGENT_COLORS[id % AGENT_COLORS.length]))
        this.heads.setColorAt(i, this.tmpColor.setHex(SKIN_COLORS[id % SKIN_COLORS.length]))
        this.hair.setColorAt(i, this.tmpColor.setHex(HAIR_COLORS[id % HAIR_COLORS.length]))
        colorDirty = true
      }
    }
    this.agents.count = n
    this.heads.count = n
    this.hair.count = n
    this.blobs.count = n
    this.agents.instanceMatrix.needsUpdate = true
    this.heads.instanceMatrix.needsUpdate = true
    this.hair.instanceMatrix.needsUpdate = true
    this.blobs.instanceMatrix.needsUpdate = true
    if (colorDirty) {
      if (this.agents.instanceColor) this.agents.instanceColor.needsUpdate = true
      if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true
      if (this.hair.instanceColor) this.hair.instanceColor.needsUpdate = true
    }
  }

  setAgentsVisible(on: boolean): void {
    this.agents.visible = on
    this.heads.visible = on
    this.hair.visible = on
    this.blobs.visible = on
  }

  /**
   * True when an agent standing at walk-surface `z` belongs to a storey that is
   * on screen — the same rule the geometry follows (`render/levelSlicing.ts`).
   * A storey above the active one never shows its crowd: its floor is not drawn
   * there, so the people would stand on nothing.
   */
  private agentLevelVisible(z: number): boolean {
    return crowdVisible(z, this.activeZ, this.ghost)
  }

  resize(w: number, h: number): void {
    this.canvasW = w
    this.canvasH = h
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.orthoOn) this.applyOrtho()
  }

  dispose(): void {
    this.disposition = true
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('pointermove', this.onEdgePointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.onEdgePointerLeave)
    this.renderer.domElement.removeEventListener('pointerup', this.onEdgePointerUp)
    this.disposeChunks()
    this.clearShapeGhost()
    this.clearModulePreview()
    this.clearFencePreview()
    this.ghostMaterial?.dispose()
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper)
      this.selectionHelper.geometry.dispose()
      ;(this.selectionHelper.material as THREE.Material).dispose()
      this.selectionHelper = null
    }
    if (this.faceGhost) {
      this.scene.remove(this.faceGhost)
      this.faceGhost.geometry.dispose()
      ;(this.faceGhost.material as THREE.Material).dispose()
      this.faceGhost.dispose()
      this.faceGhost = null
    }
    disposeModelMaterials(this.modelMats)
    this.ads.dispose()
    this.clearTvPlates()
    this.tvScreens.length = 0
    for (const entry of this.trainSlots.values()) disposeObject(entry.group)
    this.trainSlots.clear()
    if (this.zoneOverlay) {
      this.scene.remove(this.zoneOverlay)
      this.zoneOverlay.geometry.dispose()
      ;(this.zoneOverlay.material as THREE.Material).dispose()
      this.zoneOverlay.dispose()
      this.zoneOverlay = null
    }
    this.clearZoneLabels()
    this.zoneLabelGeo?.dispose()
    for (const m of this.zoneLabelMats.values()) {
      m.map?.dispose()
      m.dispose()
    }
    this.zoneLabelMats.clear()
    this.renderer.dispose()
    void this.disposition
  }
}

/** Contact-blob radius per module; long runs and ramps sit their own way. */
function blobRadius(type: Module['type']): number {
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
function moduleLevels(mod: Module): number[] {
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

function losIndex(m2: number): number {
  if (m2 >= 1.2) return 0
  if (m2 >= 0.9) return 1
  if (m2 >= 0.7) return 2
  if (m2 >= 0.4) return 3
  if (m2 >= 0.2) return 4
  return 5
}

const LOS_HEX = [0x3fb27f, 0x7fc46a, 0xf7d84b, 0xf2a541, 0xe4572e, 0xb0182b]
function losColor(i: number): number {
  return i >= LOS_HEX.length ? 0x30384a : LOS_HEX[i]
}
