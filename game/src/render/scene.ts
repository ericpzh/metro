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
  createModelMaterials,
  disposeModelMaterials,
  disposeObject,
  rollEscalator,
  setDoors,
  setGateWing,
  type EscalatorRoll,
  type ModelMaterials,
  type ModuleContext,
} from './models.ts'
import { finishMapOf } from '../sim/finishes.ts'
import { trackBedKeys } from '../sim/placement.ts'
import { edgeCells } from '../sim/track.ts'
import { OPENING_CEILING } from '../sim/openings.ts'
import { ZONE_LIST } from '../sim/zones.ts'
import { stairLevels, stairTurnCells } from '../sim/stairs.ts'
import { facilityWallCells } from '../build/model.ts'
import type { StockClass } from '../sim/stock.ts'
import type { Face, FinishId, Module, StationData } from '../sim/types.ts'
import { packKey } from '../sim/types.ts'

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

  private moduleMeshes: THREE.Group = new THREE.Group()
  /** The last station document, so a hover ghost can be built through the models. */
  private stationData: StationData | null = null
  /** Cells whose top finish is the track bed, for the same preview context. */
  private trackCellSet = new Set<string>()
  /**
   * Stair turn-landing cells. The sim keeps them as walkable nodes, but the
   * stair model draws the platform, so the chunk mesher skips them. A reused
   * 1 m block there would read as a floating cube, not a staircase landing.
   */
  private hiddenCells = new Set<number>()
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
  private trainGroup: THREE.Group = new THREE.Group()
  private trainSlots = new Map<string, TrainEntry>()
  /** Platform-screen-door groups, keyed to the line colour that opens them. */
  private psdGroups: Array<{ group: THREE.Object3D; colour: number }> = []
  /** Live escalator step bands, rolled every frame from the sim clock. */
  private escalatorRolls: EscalatorRoll[] = []
  /** Turnstile leaves, slid open as the crowd passes through their lanes. */
  private gateWings: GateWing[] = []
  private grid: THREE.Group = new THREE.Group()
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
  private activeZ = 0
  private bounds = new THREE.Box3()
  private raycaster = new THREE.Raycaster()
  private pickables: THREE.Object3D[] = []
  /** Lowest storey each column reaches; a block there has nothing under it. */
  private groundOf = new Map<string, number>()
  private dimMats = new Map<THREE.Material, THREE.Material>()
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
    this.wallPick.updateMatrixWorld(true)
    this.clearModulePreview()
    this.disposeChunks()
    const t0 = performance.now()
    this.lastChunkMs = 0
    // Group cells into storeys. There are no named levels any more: a storey is
    // one contiguous vertical run of solid cells in a column, keyed by the run's
    // lowest z. A floor slab and the walls standing on it therefore share a
    // storey, while a slab a full storey below is its own — which is what the
    // depth rail slices against. Runs may overlap in z across columns, so each
    // band meshes exactly its own cells (`emit`) instead of a z window.
    const zsByCol = new Map<string, number[]>()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      const col = `${c.x},${c.y}`
      const arr = zsByCol.get(col)
      if (arr) arr.push(c.z)
      else zsByCol.set(col, [c.z])
    }
    const bandOfCell = new Map<number, number>()
    // The lowest storey each column reaches. A block standing on that storey has
    // nothing under it, so it is a plate hanging in space: it must stay on screen
    // even when its storey sits above the one being looked at. Anything with a
    // storey below it is that lower room's ceiling and goes with the cut.
    this.groundOf.clear()
    for (const [col, zs] of zsByCol) {
      zs.sort((a, b) => a - b)
      const comma = col.indexOf(',')
      const cx0 = Number(col.slice(0, comma))
      const cy0 = Number(col.slice(comma + 1))
      let base = zs[0]
      this.groundOf.set(col, base)
      for (let i = 0; i < zs.length; i++) {
        if (i > 0 && zs[i] !== zs[i - 1] + 1) base = zs[i]
        bandOfCell.set(packKey(cx0, cy0, zs[i]), base)
      }
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
    const meshBand = (group: THREE.Group, levelZ: number, band: { zLo: number; zHi: number; cells: Array<{ x: number; y: number; z: number }> }, solid: Set<number>, isFloat: boolean): void => {
      // Emit exactly this band's cells: runs overlap in z across columns, so a
      // chunk's z window alone would mesh a neighbouring storey too.
      const emit = new Set<number>()
      for (const c of band.cells) emit.add(packKey(c.x, c.y, c.z))
      const seen = new Set<string>()
      for (const c of band.cells) {
        const cx = Math.floor(c.x / CHUNK) * CHUNK
        const cy = Math.floor(c.y / CHUNK) * CHUNK
        const k = `${cx},${cy}`
        if (seen.has(k)) continue
        seen.add(k)
        const chunk = meshChunk(solid, this.finishes, cx, cy, band.zLo, band.zHi, emit, this.hiddenCells)
        if (chunk.triangles === 0) continue
        this.lastChunkMs = Math.max(this.lastChunkMs, chunk.ms)
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
          mesh.userData.cells = band.cells.length
          group.add(mesh)
          this.chunkMeshes.push(mesh)
          // Inverted hull outline: same geometry, back faces, pushed outward.
          const outline = new THREE.Mesh(geo, this.outlineMaterial())
          outline.userData.levelZ = levelZ
          outline.userData.float = isFloat
          outline.renderOrder = -1
          group.add(outline)
          this.outlineMeshes.push(outline)
        }
      }
    }
    for (const [levelZ, band] of byBand) {
      const group = new THREE.Group()
      group.userData.levelZ = levelZ
      // The whole storey, then its unsupported plates on their own, so the two can
      // be shown separately: a storey below the active level draws whole, while a
      // plate hanging above it still stays on screen.
      meshBand(group, levelZ, band, this.solid, false)
      meshBand(group, levelZ, band, floating, true)
      this.levelGroups.set(levelZ, group)
      this.scene.add(group)
    }
    this.bounds = box
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 8, 8))
    this.buildModules(data, trackCells)
    this.buildGrid()
    const clipY = box.min.y + (box.max.y - box.min.y) * 0.5
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY)
    void t0
    this.pickables = [...this.chunkMeshes, ...this.wallPick.children]
    this.applyLevel()
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
  private buildModules(data: StationData, _trackCells: Set<number>): void {
    this.clearModules()
    const trackCells = trackBedKeys(data.cells, data.modules)
    const ctx: ModuleContext = { mats: this.modelMats, data, trackCells, finish: (id) => this.mats.finish(id) }
    const blobsByKey = new Map<string, { levelZ: number; ground: number | undefined; blobs: Array<[number, number, number, number]> }>()
    this.psdGroups = []
    for (const mod of data.modules) {
      const group = buildModule(mod, ctx)
      if (!group) continue
      group.userData.levelZs = moduleLevels(mod)
      const ground = this.groundOf.get(`${mod.x},${mod.y}`)
      group.userData.groundBand = ground
      this.moduleMeshes.add(group)
      if (mod.type === 'escalator') {
        const roll = group.userData.escalator as EscalatorRoll | undefined
        if (roll) this.escalatorRolls.push(roll)
      }
      if (mod.type === 'platform-edge') {
        const line = data.lines.find((l) => l.id === mod.cfg.line)
        const colour = line ? parseInt(line.colour.replace('#', ''), 16) || 0x1f5fd0 : 0x1f5fd0
        this.psdGroups.push({ group, colour })
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
    for (const child of [...this.moduleMeshes.children]) {
      disposeObject(child)
      this.moduleMeshes.remove(child)
    }
    this.escalatorRolls.length = 0
    this.gateWings.length = 0
  }

  /**
   * Rolling stock (§6). The worker sends one pose per live train as a flat
   * `Float32Array`, stride 8: x, y, z, cars, stock index, doors-open, colour,
   * direction. A consist is cached by its signature (colour + direction +
   * length), so it survives slot reordering, and its two latest poses are kept
   * so `updateTrains` can glide it between ticks instead of teleporting.
   */
  setTrains(buffer: Float32Array): void {
    const STRIDE = 9
    const n = Math.min(Math.floor(buffer.length / STRIDE), 64)
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
      if (doorsOpen) openColours.add(colour)
      const sig = `${colour}:${dirSign}:${cars}:${stockIdx}:${yaw}`
      let entry = this.trainSlots.get(sig)
      if (!entry) {
        const stock: StockClass = (['A', 'B', 'C'] as const)[stockIdx] ?? 'B'
        const group = buildTrain(this.modelMats, { x, y, z, cars, stock, doorsOpen, colour: `#${colour.toString(16).padStart(6, '0')}`, dirSign, yaw })
        // The track surface is one above its floor block's z.
        group.userData.levelZs = [z - 1]
        group.userData.doorT = 0
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
      entry.group.visible = true
      // Doors ease open and shut in `updateTrains` rather than snapping.
      entry.group.userData.doorTarget = doorsOpen ? 1 : 0
      this.applyGroupLevel(entry.group, false)
    }
    for (const entry of this.trainSlots.values()) {
      if (!entry.active) entry.group.visible = false
    }
    // The screen doors at a platform open with the train berthed at its line.
    for (const psd of this.psdGroups) psd.group.userData.doorTarget = openColours.has(psd.colour) ? 1 : 0
    this.updateTrains(performance.now(), 0)
  }

  /** Place every visible consist between its last two worker poses, and ease doors. */
  private updateTrains(now: number, dt: number): void {
    const alpha = Math.min(1, Math.max(0, (now - this.lastStateTime) / this.stateIntervalMs))
    for (const entry of this.trainSlots.values()) {
      if (!entry.group.visible) continue
      entry.group.position.lerpVectors(entry.from, entry.to, alpha)
      this.advanceDoors(entry.group, dt)
    }
    for (const psd of this.psdGroups) this.advanceDoors(psd.group, dt)
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

  private buildGrid(): void {
    this.grid.clear()
    const box = this.bounds
    const x0 = Math.floor(box.min.x / 5) * 5 - 5
    const x1 = Math.ceil(box.max.x / 5) * 5 + 5
    const y0 = Math.floor(box.min.y / 5) * 5 - 5
    const y1 = Math.ceil(box.max.y / 5) * 5 + 5
    const z = this.activeZ + 1.002
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
    // Geometries are shared between a chunk mesh and its outline mesh, and the
    // surface materials are shared across chunks: only the geometry and the
    // per-chunk outline material are ours to dispose.
    for (const m of this.chunkMeshes) m.geometry.dispose()
    for (const m of this.outlineMeshes) (m.material as THREE.Material).dispose()
    for (const g of this.levelGroups.values()) this.scene.remove(g)
    this.levelGroups.clear()
    this.chunkMeshes = []
    this.outlineMeshes = []
  }

  /* ------------------------------------------------------------- levels */

  setLevel(z: number, ghost: boolean): void {
    this.activeZ = z
    this.ghost = ghost
    this.applyLevel()
    this.buildGrid()
  }

  private applyLevel(): void {
    // Block by block. At or below the active level the whole storey is drawn —
    // opaque when it is the active one, a 35% ghost when it is under it. Above
    // the active level every block that has something under it is cut away (it
    // is that lower room's ceiling), but a block with nothing under it is a
    // plate hanging in space and stays, so the station does not look guillotined.
    for (const [lz, group] of this.levelGroups) {
      group.visible = true
      const active = lz === this.activeZ
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) continue
        const float = mesh.userData.float === true
        // Below/at the active level draw the full storey; above it, only floats.
        mesh.visible = lz <= this.activeZ ? !float : float
        if (!mesh.visible) continue
        const isOutline = this.outlineMeshes.includes(mesh)
        const base = isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh)
        mesh.material = active || !this.ghost ? base : this.dimOf(base)
      }
    }
    // Fixtures follow the same rule: a gate on a cut-away storey goes, but one
    // standing on an unsupported plate above the active level stays.
    for (const child of this.moduleMeshes.children) this.applyGroupLevel(child, true)
    // Trains own their `visible` flag (setTrains parks them), so leave it be.
    for (const child of this.trainGroup.children) this.applyGroupLevel(child, false)
  }

  /**
   * Dim or restore one module/train group by the level(s) it occupies. A ramp
   * (escalator, stair, lift) belongs to both ends; everything else to its cell.
   * Forestanding furniture with no level tag (shadows, decals) always shows.
   */
  private applyGroupLevel(root: THREE.Object3D, manageVisible: boolean): void {
    const levels = root.userData.levelZs as number[] | undefined
    const lz = root.userData.levelZ as number | undefined
    const zs = levels ?? (lz !== undefined ? [lz] : undefined)
    if (manageVisible) {
      // Same rule as the blocks: cut away above the active level unless the
      // fixture stands on a plate that itself has nothing under it.
      const lowest = zs ? Math.min(...zs) : undefined
      const ground = root.userData.groundBand as number | undefined
      const shown = lowest === undefined || lowest <= this.activeZ || (ground !== undefined && ground > this.activeZ)
      root.visible = shown
      if (!shown) return
    }
    const active = !this.ghost || (zs ? zs.includes(this.activeZ) : true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const base = this.baseOf(mesh)
      mesh.material = active ? base : this.dimOf(base)
    })
  }

  private baseOf(mesh: THREE.Mesh): THREE.Material {
    if (!mesh.userData.base) mesh.userData.base = mesh.material
    return mesh.userData.base as THREE.Material
  }

  private dimOf(base: THREE.Material): THREE.Material {
    let d = this.dimMats.get(base)
    if (!d) {
      d = base.clone()
      const anyMat = d as THREE.MeshStandardMaterial
      anyMat.transparent = true
      anyMat.opacity = 0.35
      if (anyMat.color) anyMat.color = anyMat.color.clone().lerp(new THREE.Color(0x6b7480), 0.7)
      if (anyMat.onBeforeCompile !== base.onBeforeCompile) anyMat.onBeforeCompile = base.onBeforeCompile
      this.dimMats.set(base, d)
    }
    return d
  }

  setCutaway(on: boolean): void {
    const planes = on ? [this.clipPlane] : []
    for (const m of [...this.chunkMeshes, ...this.outlineMeshes]) {
      const mat = m.material as THREE.Material
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
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
   * drawn translucent — so the release is not a surprise.
   */
  setGhost(cells: Array<[number, number, number]>, kind: 'add' | 'remove', colour = 0xff5d5d): void {
    if (kind === 'add') {
      if (this.ghostMesh) this.ghostMesh.visible = false
      const key = this.ghostKeyOf(cells)
      if (key === this.ghostKey) return
      this.ghostKey = key
      this.buildShapeGhost(cells)
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

  /** A cheap order-stable fingerprint of a pending cell set, to skip re-meshing. */
  private ghostKeyOf(cells: Array<[number, number, number]>): string {
    let h = 2166136261
    for (const [x, y, z] of cells) {
      h = Math.imul(h ^ (x + 4096), 16777619)
      h = Math.imul(h ^ (y + 4096), 16777619)
      h = Math.imul(h ^ (z + 4096), 16777619)
    }
    return `${cells.length}:${h >>> 0}`
  }

  /**
   * Draw the pending add-cells as their final geometry. The real chunk mesher
   * builds the rounded silhouette, but only the pending cells emit faces while
   * the whole station answers neighbour queries — so the preview is the exact
   * surface the release will add, sitting at the exact target cells.
   */
  private buildShapeGhost(cells: Array<[number, number, number]>): void {
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
        const chunk = meshChunk(this.solid, this.finishes, cx, cy, cz, cz, emit)
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
   * the preview shows the finish, not just the rectangle.
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
      pos.set(x + 0.5 + nx * 0.505, y + 0.5 + ny * 0.505, z + 0.5 + nz * 0.505)
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
   * Hover preview for the module tool: a translucent copy of the exact module a
   * click would place at the hovered cell, so the release is not a surprise. The
   * model is built through the same factory as a placed module and then every
   * surface is swapped for a faded clone; passing `null` clears it.
   */
  setModulePreview(mod: Module | null, blocked = false): void {
    const span =
      mod && mod.type === 'stair'
        ? `:${mod.to.x},${mod.to.y},${mod.to.z}:${mod.cfg.width}`
        : mod && mod.type === 'escalator'
          ? `:${mod.from.x},${mod.from.y},${mod.from.z}>${mod.to.x},${mod.to.y},${mod.to.z}:${mod.cfg.dir}`
          : mod && mod.type === 'track'
            ? `:${mod.w}x${mod.d ?? 1}:${mod.cfg.line}:${mod.cfg.dir ?? ''}`
            : ''
    const key = mod ? `${mod.type}:${mod.x},${mod.y},${mod.z}:${mod.rot ?? 0}${span}:${blocked ? 'x' : '-'}` : ''
    if (key === this.previewKey) return
    this.clearModulePreview()
    this.previewKey = key
    if (!mod || !this.stationData) return
    const ctx: ModuleContext = { mats: this.modelMats, data: this.stationData, trackCells: this.trackCellSet, finish: (id) => this.mats.finish(id), preview: true }
    const group = buildModule(mod, ctx)
    if (!group) return
    const tint = blocked ? MODULE_GHOST_BAD : MODULE_GHOST_TINT
    const shared = new Set<THREE.Material>([
      ...(Object.values(this.modelMats) as THREE.Material[]),
      ...this.mats.finishCache.values(),
      this.mats.outline,
      this.mats.blob,
      this.mats.tactile,
    ])
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
        any.opacity = 0.45
        any.depthWrite = false
        any.side = THREE.DoubleSide
        // A track bed lives *inside* the floor block until it is dug, so its
        // ghost must ignore depth or the block hides it entirely.
        if (mod.type === 'track') any.depthTest = false
        if (any.color) any.color = any.color.clone().lerp(tint, 0.4)
        ghostOf.set(base, ghost)
        this.previewMats.push(ghost)
        // A factory material may be shared scene-wide; a module-local one (a
        // printed sign, say) is ours to dispose when the preview moves on.
        if (!shared.has(base)) this.previewBases.push(base)
      }
      mesh.material = ghost
      mesh.renderOrder = 5
      mesh.frustumCulled = false
    })
    this.previewGroup.add(group)
    this.previewGroup.visible = true
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
    this.previewGroup.visible = false
    this.previewKey = ''
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
    this.updateEscalators(dt * (1000 / this.stateIntervalMs))
    this.updateGates(dt * (1000 / this.stateIntervalMs))
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
      m.compose(pos, q, scale)
      this.agents.setMatrixAt(i, m)
      this.heads.setMatrixAt(i, m)
      this.hair.setMatrixAt(i, m)
      m.makeTranslation(pos.x, pos.y, pos.z + 0.03)
      this.blobs.setMatrixAt(i, m)
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
    this.ghostMaterial?.dispose()
    if (this.faceGhost) {
      this.scene.remove(this.faceGhost)
      this.faceGhost.geometry.dispose()
      ;(this.faceGhost.material as THREE.Material).dispose()
      this.faceGhost.dispose()
      this.faceGhost = null
    }
    disposeModelMaterials(this.modelMats)
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
      return 1.2
    case 'shop':
    case 'booth':
    case 'retail':
      return 0
    default:
      return 0.8
  }
}

/** The cell level(s) a module occupies, for the ghost/level slicing. */
function moduleLevels(mod: Module): number[] {
  switch (mod.type) {
    case 'escalator':
    case 'lift':
      return [mod.from.z, mod.to.z]
    case 'stair':
      return stairLevels(mod)
    default:
      return [mod.z]
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
