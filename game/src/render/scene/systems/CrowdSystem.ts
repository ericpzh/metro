// CrowdSystem — the people: the agent InstancedMeshes, the density/zone
// overlays, the 选择 tool's route preview and the turnstile leaves the crowd
// pushes through (moved verbatim from `render/scene.ts`: `setAgents`,
// `setDensity`, `setOverlayVisible`, `setZoneOverlay`, `buildZoneLabels`,
// `clearZoneLabels`, `zoneLabelMaterial`, `renderAgents`, `setAgentsVisible`,
// `agentLevelVisible`, `detectGateCrossings`, `updateGates`, `stepGateWing`).
//
// Authored, animated anime silhouettes in one instanced draw. This
// intentionally replaces §11's limb-less Shapes style. Each gate
// cycle is crowd-driven: every crossing queues one open/hold/close leaf cycle.
//
// The route preview belongs here because it belongs to a person: one passenger's
// remaining walk, painted light blue on the floor by `render/routeLine.ts`, with a
// ring on the passenger it is for and a ring where it ends. It is read-only —
// `pickAgent` and `setRoute` never touch the sim.

import * as THREE from 'three'
import { passengerMesh, passengerFrames, passengerAppearance, PASSENGER_WALK_FRAMES, PASSENGER_WALK_PROFILES, PASSENGER_EYE_HEIGHT } from '../../passengerModel.ts'
import type { PassengerAppearance } from '../../passengerModel.ts'
import { passengerWalkProfile } from '../../../sim/walking.ts'
import { setGateWing } from '../../models.ts'
import { AgentState } from '../../../sim/types.ts'
import { PASSENGER_CULL_HEIGHT_FRACTION, PASSENGER_CULL_RADIUS_SCALE, PASSENGER_INSTANCE_CAPACITY, storeyBand } from '../../../sim/constants.ts'
import { ZONE_PAINT_LIST } from '../../../sim/zones.ts'
import { crowdVisible, levelSide } from '../../levelSlicing.ts'
import {
  ROUTE_MAX_POINTS,
  ROUTE_MAX_QUADS,
  ROUTE_QUAD_VERTS,
  ROUTE_LIFT,
  routeIndices,
  writeRouteRibbon,
} from '../../routeLine.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { GateWing, SceneContext } from './SceneSystem.ts'

/**
 * The route preview's colour — the light blue §9.5's 选择 tool draws a passenger's
 * walk in. Deliberately outside the crowd and line palettes: it is not a person
 * and not a line, it is the path of the one being watched.
 */
const ROUTE_BLUE = 0x7fd4ff

/** How close to the pointer, in screen pixels, a passenger has to be to be picked. */
const AGENT_PICK_RADIUS = 14

/**
 * How far apart, in pixels, two bodies are the *same* click: inside this the pick
 * falls through to whichever stands in front, because two people 3 px apart on
 * screen are one person to the pointer and the player meant the front one.
 */
const AGENT_PICK_TIE_PX = 3

/** How much nearer than the passenger a solid face has to be before it hides them. */
const AGENT_PICK_CLEARANCE = 0.8

/** Sim seconds a turnstile leaf takes to slide open, hold, and shut. */
const GATE_OPEN_S = 0.25
const GATE_HOLD_S = 0.45
const GATE_SHUT_S = 0.35
/** Half a gate cell: the lane plane sits at the cell centre, so a passenger at
 *  least this far out is outside the turnstile footprint (see `GATE_CLEAR_RADIUS`,
 *  which holds the queue at 0.62 m). Used to tell "stepping into the gate" from
 *  "waiting outside it". */
const GATE_EDGE = 0.5

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

/**
 * One prepared crowd draw and the per-frame packing state it carries: the slot
 * identity map (so a swap does not rewrite outfit/ink), its own attribute set and
 * the number of instances packed this frame.
 */
interface CrowdDraw {
  mesh: THREE.InstancedMesh
  pose: THREE.InstancedBufferAttribute
  outfit: THREE.InstancedBufferAttribute
  level: THREE.InstancedBufferAttribute
  ids: Float64Array
  count: number
  appearance: boolean
}

export class CrowdSystem extends SceneSystem {
  agents: THREE.InstancedMesh
  /**
   * The Low-detail crowd (§9.3): the same animated atlas driven by a coarser
   * baked topology. The renderer keeps both prepared draws in the scene and packs
   * each passenger into the one its storey asks for — the storey being edited
   * draws full, a ghosted storey draws the reduced topology — so 高画质 gets
   * per-level detail instead of one crowd-wide switch. 低画质 puts the whole crowd
   * on this draw and 隐藏UI restores the full one.
   */
  agentsLow: THREE.InstancedMesh
  private drawFull!: CrowdDraw
  private drawLow!: CrowdDraw
  private detailPolicy = ''
  blobs: THREE.InstancedMesh
  overlay: THREE.InstancedMesh | null = null
  zoneOverlay: THREE.InstancedMesh | null = null
  /** Flat text labels naming the zone of each area, shown with the zone map. */
  zoneLabels: THREE.Group = new THREE.Group()
  /** One label material per zone, cached: the text texture is the same everywhere. */
  private zoneLabelMats = new Map<string, THREE.MeshBasicMaterial>()
  /** Shared quad the zone labels are drawn on, so a rebuild allocates no geometry. */
  private zoneLabelGeo: THREE.PlaneGeometry | null = null
  prev = new Float32Array(0)
  cur = new Float32Array(0)
  /** Frame-to-frame id -> slot lookups, so interpolation pairs the same agent. */
  private prevId = new Map<number, number>()
  private nextId = new Map<number, number>()
  followAgentId: number | null = null
  onEyePose?: (x: number, y: number, z: number, yaw: number) => void
  onFollowLost?: () => void
  agentCount = 0
  /** Turnstile leaves, slid open as the crowd passes through their lanes. */
  gateWings: GateWing[] = []
  /** The 选择 tool's route line, its own scratch buffer, and the two rings. */
  private route: THREE.Mesh
  private routePos: Float32Array
  private agentRing: THREE.Mesh
  private destRing: THREE.Mesh
  /** The passenger the route belongs to, or -1: set by `setRoute`, read per frame. */
  private routeAgentId = -1
  /** Whether the last route had a drawable line and a destination to ring. */
  private routeDrawn = false
  private destDrawn = false
  /** The crowd's own 显示 switch (`setAgentsVisible`), held for the route preview. */
  private agentsShown = true
  /** Scratch for `pickAgent`: one point, cloned into view space and into NDC. */
  private pickView = new THREE.Matrix4()
  private pickVec = new THREE.Vector3()
  private pickTop = new THREE.Vector3()
  private playing = true
  private resumeSnapshotPending = false
  private frozen = new Map<number, { position: THREE.Vector3; yaw: number; pose: [number, number, number, number] }>()
  private yaws = new Float32Array(0)
  private gaitPhases = new Float32Array(0)
  private gaitWeights = new Float32Array(0)
  private lastRenderTime = 0
  private snapshotVersion = 0
  private renderedKey = ''
  private renderedPoses = new Float32Array(PASSENGER_INSTANCE_CAPACITY * 4)
  private appearances = new Float64Array(PASSENGER_INSTANCE_CAPACITY * 5)
  private frustum = new THREE.Frustum()
  private projection = new THREE.Matrix4()
  private bodySphere = new THREE.Sphere()
  private poseScratch: [number, number, number, number] = [0, 0, 0, 0]
  private appearanceScratch: PassengerAppearance = [0, 0, 0, 0, 0]
  private passengerColor = new THREE.Color()
  private zAxis = new THREE.Vector3(0, 0, 1)
  private tmpQ = new THREE.Quaternion()
  private tmpM = new THREE.Matrix4()
  private tmpP = new THREE.Vector3()
  private tmpS = new THREE.Vector3(1, 1, 1)

  constructor(ctx: SceneContext) {
    super(ctx)
    this.agents = passengerMesh(PASSENGER_INSTANCE_CAPACITY)
    this.agentsLow = passengerMesh(PASSENGER_INSTANCE_CAPACITY, 'low')
    // Both draws stay in the scene: `count` (and the per-storey split) decides
    // what each submits, so a level change never toggles a whole mesh.
    this.ctx.scene.add(this.agents)
    this.ctx.scene.add(this.agentsLow)

    const blobGeo = new THREE.CircleGeometry(0.42, 10)
    this.blobs = new THREE.InstancedMesh(blobGeo, this.ctx.mats.blob, PASSENGER_INSTANCE_CAPACITY)
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.blobs.frustumCulled = false
    this.blobs.renderOrder = 2
    this.ctx.scene.add(this.blobs)
    this.ctx.scene.add(this.zoneLabels)
    this.drawFull = this.drawRecord(this.agents)
    this.drawLow = this.drawRecord(this.agentsLow)

    // The 选择 tool's route preview: one ribbon on the walk surface, a ring under
    // the passenger it belongs to and a ring where the walk ends. The position
    // buffer is sized for the longest route there is and the draw range picks the
    // part in use, so following a walking passenger uploads no new geometry and
    // allocates nothing (`render/routeLine.ts` is where the quads are worked out).
    this.routePos = new Float32Array(ROUTE_MAX_QUADS * ROUTE_QUAD_VERTS * 3)
    const routeGeo = new THREE.BufferGeometry()
    routeGeo.setAttribute('position', new THREE.BufferAttribute(this.routePos, 3))
    routeGeo.setIndex(new THREE.BufferAttribute(routeIndices(ROUTE_MAX_QUADS), 1))
    routeGeo.setDrawRange(0, 0)
    this.route = new THREE.Mesh(
      routeGeo,
      new THREE.MeshBasicMaterial({ color: ROUTE_BLUE, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.route.renderOrder = 2
    this.route.frustumCulled = false
    this.route.visible = false
    this.ctx.scene.add(this.route)

    this.agentRing = this.routeRing(0.3, 0.46, 0.95)
    this.destRing = this.routeRing(0.36, 0.54, 0.8)
    // Record the starting policy so the first frame already packs by storey.
    this.detailPolicy = this.detailPolicyKey()
  }

  /** The attribute set and slot map one prepared crowd draw packs into. */
  private drawRecord(mesh: THREE.InstancedMesh): CrowdDraw {
    return {
      mesh,
      pose: mesh.geometry.getAttribute('passengerPose') as THREE.InstancedBufferAttribute,
      outfit: mesh.geometry.getAttribute('passengerOutfit') as THREE.InstancedBufferAttribute,
      level: mesh.geometry.getAttribute('passengerLevel') as THREE.InstancedBufferAttribute,
      ids: new Float64Array(PASSENGER_INSTANCE_CAPACITY).fill(-1),
      count: 0,
      appearance: false,
    }
  }

  /** The quality/Hide-UI policy a crowd repack depends on, as one comparable key. */
  private detailPolicyKey(): string {
    return `${this.ctx.detailEnabled !== false}|${this.ctx.hideUI}|${this.ctx.graphicsQuality ?? 'high'}`
  }

  /**
   * Which prepared topology a passenger on storey band `level` is drawn with.
   *
   * 低画质 draws the whole crowd reduced and 隐藏UI — the presentation mode —
   * always draws full bodies. In 高画质 the crowd follows the same rule as the
   * fixtures and consists beside it: the storey being edited is drawn full, and a
   * ghosted storey (显示其他层) is drawn with the reduced topology. `level` is the
   * `storeyBand` the same repack records in the draw's `passengerLevel` attribute.
   */
  private crowdDetail(level: number): 'full' | 'low' {
    if (this.ctx.detailEnabled === false || this.ctx.hideUI) return 'full'
    if (this.ctx.graphicsQuality === 'low') return 'low'
    return levelSide([level], this.ctx.activeZ) === 'active' ? 'full' : 'low'
  }

  /**
   * A quality or Hide-UI change re-splits the crowd between its two prepared
   * draws. Both meshes stay in the scene; nothing is rebuilt or reallocated, and
   * the next frame repacks pose, identity and level for every slot.
   */
  applyDetail(): void {
    const policy = this.detailPolicyKey()
    if (policy === this.detailPolicy) return
    this.detailPolicy = policy
    // Both draws may carry different identities after the re-split: repack outfit
    // and ink for every slot instead of trusting the previous slot map.
    this.drawFull.ids.fill(-1)
    this.drawLow.ids.fill(-1)
    this.renderedKey = ''
    this.snapshotVersion++
  }

  /** One flat ring of the route preview, lying on the floor. */
  private routeRing(inner: number, outer: number, opacity: number): THREE.Mesh {
    const geo = new THREE.RingGeometry(inner, outer, 24)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: ROUTE_BLUE, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
    )
    mesh.renderOrder = 2
    mesh.frustumCulled = false
    mesh.visible = false
    this.ctx.scene.add(mesh)
    return mesh
  }

  /**
   * The 选择 tool's route preview: the xyz waypoints of one passenger's remaining
   * walk, and the passenger they belong to. An empty route puts the line away; a
   * `null`-ish id (-1) means nobody is selected at all.
   */
  setRoute(points: Float32Array, agentId: number): void {
    this.snapshotVersion++
    this.routeAgentId = agentId
    const total = Math.floor(points.length / 3)
    const n = Math.min(total, ROUTE_MAX_POINTS)
    if (n < 2) {
      this.routeDrawn = false
      this.destDrawn = false
      this.route.visible = false
      this.destRing.visible = false
      return
    }
    const quads = writeRouteRibbon(n === total ? points : points.subarray(0, n * 3), this.routePos)
    const attr = this.route.geometry.getAttribute('position') as THREE.BufferAttribute
    // Only the vertices in use are uploaded: the buffer is sized for the longest
    // route there is, and a short one should not re-send the whole of it.
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, quads * ROUTE_QUAD_VERTS * 3)
    attr.needsUpdate = true
    this.route.geometry.setDrawRange(0, quads * 6)
    this.routeDrawn = quads > 0
    this.route.visible = this.routeDrawn
    // The ring closes the line at the door, counter or exit the walk is aiming at.
    const last = (n - 1) * 3
    this.destRing.position.set(points[last], points[last + 1], points[last + 2] + ROUTE_LIFT)
    this.destDrawn = true
    this.destRing.visible = true
  }

  /** Materials the cutaway must slice with the floors (read by LevelSystem). */
  clipMaterials(): THREE.Material[] {
    return [
      this.agents.material,
      this.agentsLow.material,
      this.blobs.material,
      // The route preview is drawn in the station too: a cut that hides the floor
      // it lies on has to hide the line as well.
      this.route.material,
      this.agentRing.material,
      this.destRing.material,
    ] as THREE.Material[]
  }

  /**
   * The passenger under the pointer, or -1 for none (§9.5's 选择 tool).
   *
   * The pick is **screen-space**, not a ray against the bodies: an agent is three
   * small instanced meshes and a ray would either miss a 0.3 m person or need a
   * fattened proxy for every one of three thousand. Instead every body on a storey
   * the slice draws is projected, and the one nearest the pointer within
   * `AGENT_PICK_RADIUS` wins — with the nearer body breaking a tie, so a passenger
   * standing in front of another is the one that is picked.
   *
   * "Nearest" is resolved to ~3 px (`AGENT_PICK_TIE_PX`): bodies 3 px apart on
   * screen are the same click, and the one standing in front is what the player
   * meant to hit. Past that the genuinely nearer body wins however deep it stands,
   * because a click 12 px onto one passenger is not a click on their neighbour.
   *
   * `blocker` is how far away the frontmost solid face under the pointer is (the
   * caller's own ray): a body a wall stands in front of is not on screen, and a
   * click that lands on the wall must not select it. The tolerance is generous
   * because the ray that finds the wall also finds the floor *under the passenger's
   * own feet*, which is a little nearer than the body when the click is low.
   */
  pickAgent(clientX: number, clientY: number, camera: THREE.Camera, rect: DOMRect, blocker: number): number {
    const n = this.agentCount
    if (n === 0 || !this.agentsShown) return -1
    const alpha = Math.max(0, Math.min(1, ((this.lastRenderTime >= this.ctx.lastStateTime ? this.lastRenderTime : performance.now()) - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
    const left = clientX - rect.left
    const top = clientY - rect.top
    this.pickView.copy(camera.matrixWorldInverse)
    let best = -1
    let bestDist2 = AGENT_PICK_RADIUS * AGENT_PICK_RADIUS
    let bestDepth = Infinity
    const tie2 = AGENT_PICK_TIE_PX * AGENT_PICK_TIE_PX
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const id = this.cur[o + 5]
      if (id === this.followAgentId) continue
      const frozen = this.frozen.get(id)
      const p = i * 3
      const x = frozen?.position.x ?? this.prev[p] + (this.cur[o] - this.prev[p]) * alpha
      const y = frozen?.position.y ?? this.prev[p + 1] + (this.cur[o + 1] - this.prev[p + 1]) * alpha
      const z = frozen?.position.z ?? this.prev[p + 2] + (this.cur[o + 2] - this.prev[p + 2]) * alpha
      if (!this.agentLevelVisible(z)) continue
      const height = passengerAppearance(id, this.appearanceScratch)[1]
      this.pickVec.set(x, y, z + 0.12 * height).applyMatrix4(this.pickView)
      this.pickTop.set(x, y, z + 1.7 * height).applyMatrix4(this.pickView)
      // View space looks down -z, so anything at or behind the lens has no screen
      // position at all — projecting it would mirror it back into the picture.
      const bottomDepth = -this.pickVec.z, topDepth = -this.pickTop.z
      if (bottomDepth < 0.2 || topDepth < 0.2) continue
      // A screen-space capsule spans feet to head, rather than making only one
      // point on a now much taller body selectable. It follows the drawn pose.
      this.pickVec.applyMatrix4(camera.projectionMatrix)
      this.pickTop.applyMatrix4(camera.projectionMatrix)
      const bx = ((this.pickVec.x + 1) / 2) * rect.width
      const by = ((1 - this.pickVec.y) / 2) * rect.height
      const sx = (this.pickTop.x - this.pickVec.x) * rect.width / 2
      const sy = (this.pickVec.y - this.pickTop.y) * rect.height / 2
      const length2 = sx * sx + sy * sy
      const along = length2 > 0 ? Math.max(0, Math.min(1, ((left - bx) * sx + (top - by) * sy) / length2)) : 0
      // Compare depth at the clicked part of the body. A fixed torso centre
      // incorrectly let a taller passenger behind a shorter one win the tie.
      const depth = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
        ? 1 / ((1 - along) / bottomDepth + along / topDepth)
        : bottomDepth + (topDepth - bottomDepth) * along
      const dx = bx + sx * along - left
      const dy = by + sy * along - top
      const dist2 = dx * dx + dy * dy
      if (dist2 > AGENT_PICK_RADIUS * AGENT_PICK_RADIUS) continue
      if (depth > blocker + AGENT_PICK_CLEARANCE) continue
      if (dist2 < bestDist2 - tie2 || (dist2 <= bestDist2 + tie2 && depth < bestDepth)) {
        best = this.cur[o + 5]
        bestDist2 = dist2
        bestDepth = depth
      }
    }
    return best
  }

  /** Pause captures the displayed pose, including an unfinished stride. Control
   * snapshots may repeat or reorder agents without turning walkers into idle. */
  setPlaying(on: boolean, now = performance.now()): void {
    if (on === this.playing) return
    if (!on) {
      this.renderAgents(now, undefined, true)
      const alpha = Math.max(0, Math.min(1, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs))
      const pose = this.renderedPoses
      for (let i = 0; i < this.agentCount; i++) {
        const p = i * 3, o = i * 6
        this.frozen.set(this.cur[o + 5], {
          position: new THREE.Vector3(this.prev[p] + (this.cur[o] - this.prev[p]) * alpha,
            this.prev[p + 1] + (this.cur[o + 1] - this.prev[p + 1]) * alpha,
            this.prev[p + 2] + (this.cur[o + 2] - this.prev[p + 2]) * alpha),
          yaw: this.yaws[i], pose: [pose[i * 4], pose[i * 4 + 1], pose[i * 4 + 2], pose[i * 4 + 3]],
        })
      }
    } else {
      for (let i = 0; i < this.agentCount; i++) {
        const frozen = this.frozen.get(this.cur[i * 6 + 5])
        if (!frozen) continue
        frozen.position.toArray(this.prev, i * 3)
        this.yaws[i] = frozen.yaw
        const firstFrame = PASSENGER_WALK_PROFILES[passengerWalkProfile(this.cur[i * 6 + 5])].firstFrame
        this.gaitPhases[i] = (frozen.pose[0] - firstFrame + frozen.pose[2]) / PASSENGER_WALK_FRAMES
        this.gaitWeights[i] = frozen.pose[3]
      }
      this.ctx.lastStateTime = now
      this.frozen.clear()
      this.resumeSnapshotPending = true
    }
    this.lastRenderTime = now
    this.playing = on
  }

  setAgents(buffer: Float32Array, count: number, intervalMs: number): void {
    const floats = count * 6
    // Play/pause controls publish a copy of the latest sim state. The first
    // resume copy must not replace the frozen origin with its future endpoint.
    if (this.resumeSnapshotPending) {
      this.resumeSnapshotPending = false
      if (count === this.agentCount && buffer.subarray(0, floats).every((value, i) => value === this.cur[i])) return
    }
    if (this.cur.length < floats) {
      // Preserve the old frame so ids that survive the resize still interpolate
      // from where they were rather than streaking in from the origin.
      const grown = new Float32Array(Math.max(floats, 4096))
      grown.set(this.cur)
      this.cur = grown
    }
    if (this.prev.length < count * 3) this.prev = new Float32Array(Math.max(count * 3, 4096))
    if (this.yaws.length < count) {
      const capacity = Math.max(count, 1024)
      for (const key of ['yaws', 'gaitPhases', 'gaitWeights'] as const) {
        const grown = new Float32Array(capacity)
        grown.set(this[key])
        this[key] = grown
      }
    }
    this.ctx.stateIntervalMs = intervalMs > 0 ? intervalMs : this.ctx.stateIntervalMs
    // Match each incoming agent to its previous-frame position by id before
    // overwriting `cur`. Slot i is not stable: `pool.compact()` shifts the live
    // list whenever an agent dies, so pairing by slot would interpolate between
    // two different people and send them flying across the station.
    const prevId = this.prevId
    const nextId = this.nextId
    const oldYaws = this.yaws.slice()
    const oldPhases = this.gaitPhases.slice()
    const oldWeights = this.gaitWeights.slice()
    // Finish phases before remapping: writing new prev slots must not overwrite
    // another passenger's previous-frame distance during compaction/reordering.
    for (let old = 0; old < this.agentCount; old++) {
      const q = old * 6
      const p = old * 3
      if (this.cur[q + 3] !== AgentState.Riding) {
        const walked = Math.hypot(this.cur[q] - this.prev[p], this.cur[q + 1] - this.prev[p + 1])
        const strideScale = passengerAppearance(this.cur[q + 5], this.appearanceScratch)[2]
        const stride = PASSENGER_WALK_PROFILES[passengerWalkProfile(this.cur[q + 5])].stride
        oldPhases[old] = (oldPhases[old] + walked / (stride * strideScale)) % 1
      }
    }
    nextId.clear()
    for (let i = 0; i < count; i++) {
      const o = i * 6
      const p = i * 3
      const old = prevId.get(buffer[o + 5])
      if (old !== undefined) {
        this.yaws[i] = oldYaws[old]
        const q = old * 6
        this.gaitPhases[i] = oldPhases[old]
        this.gaitWeights[i] = oldWeights[old]
        this.prev[p] = this.cur[q]
        this.prev[p + 1] = this.cur[q + 1]
        this.prev[p + 2] = this.cur[q + 2]
      } else {
        // New spawn: start it at its own position, not somewhere it came from.
        this.prev[p] = buffer[o]
        this.prev[p + 1] = buffer[o + 1]
        this.prev[p + 2] = buffer[o + 2]
        this.yaws[i] = 0
        this.gaitPhases[i] = (buffer[o + 5] * 0.61803398875) % 1
        this.gaitWeights[i] = 0
      }
      nextId.set(buffer[o + 5], i)
      this.appearances.set(passengerAppearance(buffer[o + 5], this.appearanceScratch), i * 5)
    }
    this.cur.set(buffer.subarray(0, floats))
    this.prevId = nextId
    this.nextId = prevId
    this.agentCount = count
    this.snapshotVersion++
    for (const id of this.frozen.keys()) if (!this.prevId.has(id)) this.frozen.delete(id)
    this.ctx.lastStateTime = performance.now()
    // One crossing count per worker snapshot, now that `prev`/`cur` are final.
    this.detectGateCrossings()
  }

  setDensity(nodes: Float32Array, density: Float32Array, on: boolean): void {
    if (!this.overlay || this.overlay.count !== nodes.length / 3) {
      this.dropOverlay(this.overlay)
      const g = new THREE.PlaneGeometry(1, 1)
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
      this.overlay = new THREE.InstancedMesh(g, m, Math.max(1, nodes.length / 3))
      this.overlay.renderOrder = 1
      this.overlay.frustumCulled = false
      this.ctx.scene.add(this.overlay)
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

  /** 区域 map visibility, without rebuilding the map. */
  setZoneOverlayVisible(on: boolean): void {
    if (this.zoneOverlay) this.zoneOverlay.visible = on
    if (!on) this.zoneLabels.visible = false
    else if (this.zoneLabels.children.length > 0) this.zoneLabels.visible = true
  }

  /**
   * Drop one overlay for good. `InstancedMesh.dispose()` frees only the instance
   * buffers, so the quad's geometry and its material — both minted per overlay —
   * have to go with it or every resize leaves a pair on the GPU for the session.
   */
  private dropOverlay(overlay: THREE.InstancedMesh | null): void {
    if (!overlay) return
    this.ctx.scene.remove(overlay)
    overlay.geometry.dispose()
    ;(overlay.material as THREE.Material).dispose()
    overlay.dispose()
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
    labels: Array<{ x: number; y: number; z: number; zone: number; label?: string }>,
    on: boolean,
  ): void {
    const n = zones.length
    if (!this.zoneOverlay || this.zoneOverlay.count !== n) {
      this.dropOverlay(this.zoneOverlay)
      const g = new THREE.PlaneGeometry(1, 1)
      const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })
      this.zoneOverlay = new THREE.InstancedMesh(g, m, Math.max(1, n))
      this.zoneOverlay.renderOrder = 1
      this.zoneOverlay.frustumCulled = false
      this.ctx.scene.add(this.zoneOverlay)
    }
    const mat4 = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let i = 0; i < n; i++) {
      mat4.makeTranslation(quads[i * 3], quads[i * 3 + 1], quads[i * 3 + 2])
      this.zoneOverlay.setMatrixAt(i, mat4)
      col.setHex(ZONE_PAINT_LIST[zones[i]]?.colour ?? 0x888888)
      this.zoneOverlay.setColorAt(i, col)
    }
    this.zoneOverlay.count = n
    this.zoneOverlay.instanceMatrix.needsUpdate = true
    if (this.zoneOverlay.instanceColor) this.zoneOverlay.instanceColor.needsUpdate = true
    this.zoneOverlay.visible = on
    this.buildZoneLabels(labels, on)
  }

  /** Rebuild the flat zone-name labels (one per contiguous zone area). */
  private buildZoneLabels(labels: Array<{ x: number; y: number; z: number; zone: number; label?: string }>, on: boolean): void {
    this.clearZoneLabels()
    if (!this.zoneLabelGeo) this.zoneLabelGeo = new THREE.PlaneGeometry(3.2, 1.2)
    for (const l of labels) {
      const mesh = new THREE.Mesh(this.zoneLabelGeo, this.zoneLabelMaterial(l.zone, l.label))
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
  private zoneLabelMaterial(index: number, label?: string): THREE.MeshBasicMaterial {
    const key = `${index}:${label ?? ''}`
    let m = this.zoneLabelMats.get(key)
    if (m) return m
    const def = ZONE_PAINT_LIST[index]
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
    g.fillText(label ?? def?.label ?? '', c.width / 2, c.height / 2 + 2)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    this.zoneLabelMats.set(key, m)
    return m
  }

  renderAgents(now: number, camera?: THREE.Camera, force = false): void {
    if (!force && !this.agentsShown && this.followAgentId === null) {
      this.lastRenderTime = now
      this.renderedKey = ''
      return
    }
    const key = `${this.snapshotVersion}|${this.playing}|${this.ctx.activeZ}|${this.ctx.ghost}|${this.ctx.hideUI}|${this.ctx.levelBase}|${this.ctx.storeyHeight}|${this.agentsShown}|${this.followAgentId}|${this.detailPolicyKey()}|${camera?.matrixWorld.elements.join(',') ?? ''}|${camera?.projectionMatrix.elements.join(',') ?? ''}`
    if (!force && !this.playing && key === this.renderedKey) return
    this.renderedKey = key
    if (camera) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const alpha = Math.min(1, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs)
    const full = this.drawFull, low = this.drawLow
    full.count = 0; full.appearance = false
    low.count = 0; low.appearance = false
    const dt = this.playing && this.lastRenderTime > 0 ? Math.max(0, Math.min(0.05, (now - this.lastRenderTime) / 1000)) : 0
    this.lastRenderTime = now
    const m = this.tmpM
    const q = this.tmpQ
    const pos = this.tmpP
    const scale = this.tmpS
    const axis = this.zAxis
    const n = this.agentCount
    let followed = false
    let blobCount = 0
    /** True once the previewed passenger was drawn: the route goes with them. */
    let agentOn = false
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const p = i * 3
      const id = this.cur[o + 5]
      const appearance = this.appearanceScratch
      for (let a = 0; a < 5; a++) appearance[a] = this.appearances[i * 5 + a]
      scale.set(appearance[2], appearance[3], appearance[1])
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
      const travelled = this.cur[o + 3] !== AgentState.Riding ? Math.hypot(dx, dy) : 0
      const moving = travelled > 1e-5 ? 1 : 0
      this.gaitWeights[i] += (moving - this.gaitWeights[i]) * Math.min(1, dt * 12)
      // Fore/aft mesh scaling changes the physical step length, including for
      // children. Phase uses the same distance as the displayed translation.
      const frames = passengerFrames(travelled * alpha / appearance[2], this.gaitPhases[i], this.gaitWeights[i], this.poseScratch, passengerWalkProfile(id))
      const frozen = this.frozen.get(id)
      if (frozen) {
        pos.copy(frozen.position)
        this.yaws[i] = frozen.yaw
        q.setFromAxisAngle(axis, frozen.yaw)
      }
      const shown = frozen?.pose ?? frames
      this.renderedPoses.set(shown, i * 4)
      // Only the crowd on the storeys that are actually drawn: an agent on a
      // hidden floor above (or a ghosted one below) would otherwise float over
      // the visible floor, reading as "seen through" it.
      this.bodySphere.center.set(pos.x, pos.y, pos.z + appearance[1] * PASSENGER_CULL_HEIGHT_FRACTION)
      this.bodySphere.radius = Math.max(appearance[1], appearance[2], appearance[3]) * PASSENGER_CULL_RADIUS_SCALE
      const drawn = this.agentsShown && this.agentLevelVisible(pos.z) && id !== this.followAgentId
        && (!camera || this.followAgentId !== null || this.frustum.intersectsSphere(this.bodySphere))
      if (drawn) {
        // The storey this instance stands on decides its topology, and the same
        // value is recorded per instance so the split is inspectable.
        const level = storeyBand(pos.z, this.ctx.levelBase, this.ctx.storeyHeight)
        const group = this.crowdDetail(level) === 'low' ? low : full
        const slot = group.count++
        if (group.ids[slot] !== id) {
          group.ids[slot] = id
          group.appearance = true
          group.outfit.setX(slot, appearance[0])
          this.passengerColor.setRGB(appearance[4], appearance[4], appearance[4])
          group.mesh.setColorAt(slot, this.passengerColor)
        }
        group.level.setX(slot, level)
        group.pose.setXYZW(slot, shown[0], shown[1], shown[2], shown[3])
        m.compose(pos, q, scale)
        group.mesh.setMatrixAt(slot, m)
        // The flat ground shadow follows the same independent horizontal axes.
        scale.z = 1
        m.compose(pos, q, scale)
        m.elements[14] += 0.03
        this.blobs.setMatrixAt(blobCount++, m)
      }
      // The 选择 tool's ring sits on the body it belongs to, moved with it through
      // the same interpolation, so what is highlighted is the person on screen.
      if (id === this.routeAgentId) {
        this.agentRing.position.set(pos.x, pos.y, pos.z + 0.02)
        agentOn = drawn
      }
      if (id === this.followAgentId) {
        followed = true
        this.onEyePose?.(pos.x, pos.y, pos.z + PASSENGER_EYE_HEIGHT * appearance[1], this.yaws[i])
      }

    }
    for (const group of [full, low]) {
      group.mesh.count = group.count
      if (!group.count) continue
      const attributes = [group.pose, group.mesh.instanceMatrix, group.level]
      if (group.appearance) {
        attributes.push(group.outfit)
        if (group.mesh.instanceColor) attributes.push(group.mesh.instanceColor)
      }
      for (const attr of attributes) {
        attr.clearUpdateRanges()
        attr.addUpdateRange(0, group.count * attr.itemSize)
        attr.needsUpdate = true
      }
    }
    this.blobs.count = blobCount
    if (blobCount) {
      const matrix = this.blobs.instanceMatrix
      matrix.clearUpdateRanges()
      matrix.addUpdateRange(0, blobCount * matrix.itemSize)
      matrix.needsUpdate = true
    }
    // The route follows the passenger it belongs to: a storey that does not draw
    // the person does not draw the line they are walking either.
    this.agentRing.visible = agentOn && this.agentsShown && this.followAgentId === null
    this.route.visible = this.routeDrawn && agentOn && this.agentsShown && this.followAgentId === null
    this.destRing.visible = this.destDrawn && agentOn && this.agentsShown && this.followAgentId === null
    if (this.followAgentId !== null && !followed) this.onFollowLost?.()

  }

  setAgentsVisible(on: boolean): void {
    // Held rather than only applied: `renderAgents` restates the route preview's
    // visibility every frame, so the crowd's own switch has to be remembered for
    // it — otherwise hiding the crowd would leave one passenger's route drawn.
    this.agentsShown = on
    this.agents.visible = on
    this.agentsLow.visible = on
    this.blobs.visible = on
    if (!on) {
      this.agentRing.visible = false
      this.route.visible = false
      this.destRing.visible = false
    }
  }

  /**
   * True when an agent standing at walk-surface `z` belongs to a storey that is
   * on screen — the same rule the geometry follows (`render/levelSlicing.ts`).
   * A storey above the active one never shows its crowd: its floor is not drawn
   * there, so the people would stand on nothing.
   */
  private agentLevelVisible(z: number): boolean {
    return crowdVisible(z, this.ctx.activeZ, this.ctx.ghost, this.ctx.hideUI, this.ctx.levelBase, this.ctx.storeyHeight)
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
  updateGates(simDt: number): void {
    if (!this.playing) return
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

  override dispose(): void {
    // The LOS overlay belongs to this system as much as the zone map does: it was
    // never dropped here, so a page that used the overlay left its geometry and
    // material behind on teardown.
    this.dropOverlay(this.overlay)
    this.overlay = null
    this.dropOverlay(this.zoneOverlay)
    this.zoneOverlay = null
    this.clearZoneLabels()
    this.zoneLabelGeo?.dispose()
    for (const m of this.zoneLabelMats.values()) {
      m.map?.dispose()
      m.dispose()
    }
    this.zoneLabelMats.clear()
    // The crowd's human and shadow draws live with the scene, including the
    // outfit/pose textures, geometry, material and instance buffers.
    // `blobs` wears the shared `mats.blob`, which the material set disposes itself.
    this.agents.userData.disposePassenger()
    for (const mesh of [this.agents, this.agentsLow, this.blobs]) {
      mesh.geometry.dispose()
      if (mesh !== this.blobs) (mesh.material as THREE.Material).dispose()
      mesh.dispose()
      this.ctx.scene.remove(mesh)
    }
    // And the route preview: the ribbon's own geometry and material, and the two
    // rings, which are the scene's only other meshes in this system.
    for (const mesh of [this.route, this.agentRing, this.destRing]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      this.ctx.scene.remove(mesh)
    }
  }
}
