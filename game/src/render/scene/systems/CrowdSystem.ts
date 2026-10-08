// CrowdSystem — the people: the agent InstancedMeshes, the density/zone
// overlays, the 选择 tool's route preview and the turnstile leaves the crowd
// pushes through (moved verbatim from `render/scene.ts`: `setAgents`,
// `setDensity`, `setOverlayVisible`, `setZoneOverlay`, `buildZoneLabels`,
// `clearZoneLabels`, `zoneLabelMaterial`, `renderAgents`, `setAgentsVisible`,
// `agentLevelVisible`, `detectGateCrossings`, `updateGates`, `stepGateWing`).
//
// GAME-SPEC §11 (crowd): limb-less "Shapes" — one body, one head, one hair cap —
// so thousands of people stay a handful of instanced draws, with a palette that
// never matches a line colour. The gate cycle is crowd-driven: each counted
// crossing queues one open/hold/close leaf cycle.
//
// The route preview belongs here because it belongs to a person: one passenger's
// remaining walk, painted light blue on the floor by `render/routeLine.ts`, with a
// ring on the passenger it is for and a ring where it ends. It is read-only —
// `pickAgent` and `setRoute` never touch the sim.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { setGateWing } from '../../models.ts'
import { ZONE_LIST } from '../../../sim/zones.ts'
import { crowdVisible } from '../../levelSlicing.ts'
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

/** Crowd hue palette — §11: never matches a line colour. */
const AGENT_COLORS = [0xe4572e, 0xf2a541, 0xf7d84b, 0x3fb27f, 0x42a5c4, 0xb07cc6, 0xe07a9b, 0xd9dce1]

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

/** How far up a body the pick aims: mid-torso, so a click on the head still lands. */
const AGENT_PICK_HEIGHT = 0.45

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

export class CrowdSystem extends SceneSystem {
  agents: THREE.InstancedMesh
  heads: THREE.InstancedMesh
  hair: THREE.InstancedMesh
  blobs: THREE.InstancedMesh
  overlay: THREE.InstancedMesh | null = null
  zoneOverlay: THREE.InstancedMesh | null = null
  /** Flat text labels naming the zone of each area, shown with the zone map. */
  zoneLabels: THREE.Group = new THREE.Group()
  /** One label material per zone, cached: the text texture is the same everywhere. */
  private zoneLabelMats = new Map<number, THREE.MeshBasicMaterial>()
  /** Shared quad the zone labels are drawn on, so a rebuild allocates no geometry. */
  private zoneLabelGeo: THREE.PlaneGeometry | null = null
  prev = new Float32Array(0)
  cur = new Float32Array(0)
  /** Frame-to-frame id -> slot lookups, so interpolation pairs the same agent. */
  private prevId = new Map<number, number>()
  private nextId = new Map<number, number>()
  /** Agent id whose colour currently occupies each slot, so colours stay put. */
  private colorIds = new Int32Array(0)
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
  private yaws = new Float32Array(0)
  private zAxis = new THREE.Vector3(0, 0, 1)
  private tmpQ = new THREE.Quaternion()
  private tmpM = new THREE.Matrix4()
  private tmpP = new THREE.Vector3()
  private tmpS = new THREE.Vector3(1, 1, 1)
  private tmpColor = new THREE.Color()

  constructor(ctx: SceneContext) {
    super(ctx)
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
    this.ctx.scene.add(this.agents)
    this.heads = new THREE.InstancedMesh(humanoidHead(), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), 8000)
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.heads.frustumCulled = false
    this.ctx.scene.add(this.heads)
    this.hair = new THREE.InstancedMesh(humanoidHair(), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 }), 8000)
    this.hair.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.hair.frustumCulled = false
    this.ctx.scene.add(this.hair)

    const blobGeo = new THREE.CircleGeometry(0.42, 10)
    this.blobs = new THREE.InstancedMesh(blobGeo, this.ctx.mats.blob, 8000)
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.blobs.frustumCulled = false
    this.blobs.renderOrder = 2
    this.ctx.scene.add(this.blobs)
    this.ctx.scene.add(this.zoneLabels)

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
      this.heads.material,
      this.hair.material,
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
    if (n === 0) return -1
    const left = clientX - rect.left
    const top = clientY - rect.top
    this.pickView.copy(camera.matrixWorldInverse)
    let best = -1
    let bestDist2 = AGENT_PICK_RADIUS * AGENT_PICK_RADIUS
    let bestDepth = Infinity
    const tie2 = AGENT_PICK_TIE_PX * AGENT_PICK_TIE_PX
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const x = this.cur[o]
      const y = this.cur[o + 1]
      const z = this.cur[o + 2]
      if (!this.agentLevelVisible(z)) continue
      const wy = z + AGENT_PICK_HEIGHT
      this.pickVec.set(x, y, wy).applyMatrix4(this.pickView)
      // View space looks down -z, so anything at or behind the lens has no screen
      // position at all — projecting it would mirror it back into the picture.
      if (this.pickVec.z > -0.2) continue
      const depth = -this.pickVec.z
      this.pickVec.set(x, y, wy).project(camera)
      const dx = ((this.pickVec.x + 1) / 2) * rect.width - left
      const dy = ((1 - this.pickVec.y) / 2) * rect.height - top
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
    this.ctx.stateIntervalMs = intervalMs > 0 ? intervalMs : this.ctx.stateIntervalMs
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
    labels: Array<{ x: number; y: number; z: number; zone: number }>,
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

  renderAgents(now: number): void {
    const alpha = Math.min(1, (now - this.ctx.lastStateTime) / this.ctx.stateIntervalMs)
    const m = this.tmpM
    const q = this.tmpQ
    const pos = this.tmpP
    const scale = this.tmpS
    const axis = this.zAxis
    const n = this.agentCount
    let colorDirty = false
    /** True once the previewed passenger was drawn: the route goes with them. */
    let agentOn = false
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
      const drawn = this.agentLevelVisible(pos.z)
      if (drawn) {
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
      // The 选择 tool's ring sits on the body it belongs to, moved with it through
      // the same interpolation, so what is highlighted is the person on screen.
      if (id === this.routeAgentId) {
        this.agentRing.position.set(pos.x, pos.y, pos.z + 0.02)
        agentOn = drawn
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
    // The route follows the passenger it belongs to: a storey that does not draw
    // the person does not draw the line they are walking either.
    this.agentRing.visible = agentOn && this.agentsShown
    this.route.visible = this.routeDrawn && agentOn && this.agentsShown
    this.destRing.visible = this.destDrawn && agentOn && this.agentsShown
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
    // Held rather than only applied: `renderAgents` restates the route preview's
    // visibility every frame, so the crowd's own switch has to be remembered for
    // it — otherwise hiding the crowd would leave one passenger's route drawn.
    this.agentsShown = on
    this.agents.visible = on
    this.heads.visible = on
    this.hair.visible = on
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
    return crowdVisible(z, this.ctx.activeZ, this.ctx.ghost, this.ctx.hideUI, this.ctx.levelBase)
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
    // The crowd's own instanced draws. They are one batch per body part for the
    // scene's lifetime, so they go with it — geometry, material, instance buffers.
    // `blobs` wears the shared `mats.blob`, which the material set disposes itself.
    for (const mesh of [this.agents, this.heads, this.hair, this.blobs]) {
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
