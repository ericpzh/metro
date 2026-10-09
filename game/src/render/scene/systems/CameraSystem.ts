// CameraSystem — the camera rig, presets, pan/orbit input and pointer picking
// (moved verbatim from `render/scene.ts`: `setPreset`, `setOrtho`,
// `applyOrtho`, the wheel/edge-pointer handlers, `frame`, `setViewDirection`,
// `orbitBy`, `panInput`, `panCamera`, `pick`, `activeCamera`, `pickModule`,
// `pickFacing`, `zoneAt`, `resize`).
//
// Left and right belong to the tools; orbit is the middle button, the wheel
// zooms flat views, WASD (+ the mouse edge band) pans camera-relative, and
// Ctrl+Q / Ctrl+E pan the view up and down the vertical.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { facingFrom } from '../../pickFacing.ts'
import { pickCells } from '../../pickCell.ts'
import { SceneSystem, PAN_DOWN, PAN_UP } from './SceneSystem.ts'
import type { PickResult, SceneContext } from './SceneSystem.ts'
import type { ModuleSystem } from './ModuleSystem.ts'

/**
 * Mouse edge pan: with the pointer inside this band along a canvas edge the
 * camera drifts that way, and a corner pushes two axes at once — WASD panning
 * driven by the mouse. The push ramps from 0 at the band's inner line to full
 * WASD speed at the very edge.
 */
const EDGE_PAN_PX = 26

/**
 * The lens the perspective camera opens with, in degrees: the building view. It is what
 * the nav cube's FOV slider is written against and what 回到默认视角 puts the lens back to
 * (`app/viewHome.ts`), rather than a literal 45 in three files.
 */
export const DEFAULT_FOV = 45

/**
 * The lens range the slider offers, in degrees — the camera's own `fov`, which is the
 * **vertical** field of view and so means the same thing at every window shape (a
 * screen-width field of view would change meaning when the stage is resized).
 *
 * * 30° is the long end: a telephoto that pulls the station in and fills the frame with
 *   one platform, with almost no context around it — the "tunnel vision" end.
 * * 120° is the short end: most of the station in frame at once, with the perspective
 *   leaning hard, the fisheye the wide end of a first-person slider is known for.
 *
 * Between them sit the values a shooter would call normal (60°–85°) and wide (90°–120°),
 * all of them reachable; the game's own 45° building view is nearer the long end, which is
 * what a station editor wants — a tight lens with little distortion over the block being
 * placed.
 */
export const FOV_MIN_DEG = 30
export const FOV_MAX_DEG = 120

/**
 * How close an orbit may come to the poles, in radians. At a pole the azimuth stops
 * meaning anything and the view flips on the next drag, so the orbit drag stops a hair
 * short of ±90° — it is the only way in, now the widget's slider is the lens.
 */
const POLAR_EPS = 0.02

export class CameraSystem extends SceneSystem {
  camera: THREE.PerspectiveCamera
  ortho: THREE.OrthographicCamera
  controls: OrbitControls
  private raycaster = new THREE.Raycaster()
  private pickables: THREE.Object3D[] = []
  private orthoOn = false
  /** Orthographic zoom factor, driven by the wheel while a flat view is active. */
  private orthoZoom = 1
  private tmpSize = new THREE.Vector3()
  /** Pointer position in CSS px inside the canvas, for the edge pan. */
  private pointerX = 0
  private pointerY = 0
  private pointerInside = false
  /** Buttons held on the last pointer event; the middle one orbits, so it wins. */
  private pointerButtons = 0
  private canvasW = 1
  private canvasH = 1
  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  /** Module groups for model-space picking; wired by the orchestrator. */
  modules!: ModuleSystem

  constructor(canvas: HTMLCanvasElement, ctx: SceneContext, renderer: THREE.WebGLRenderer) {
    super(ctx)
    this.canvas = canvas
    this.renderer = renderer
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.5, 2000)
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
    // Zoom is handled by onWheel for both projections. Keeping it here means
    // a wheel event can zoom while OrbitControls is also tracking a middle drag.
    this.controls.enableZoom = false
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('pointermove', this.onEdgePointerMove)
    canvas.addEventListener('pointerleave', this.onEdgePointerLeave)
    canvas.addEventListener('pointerup', this.onEdgePointerUp)
  }

  /** The block/module meshes the current station made pickable. */
  setPickables(pickables: THREE.Object3D[]): void {
    this.pickables = pickables
  }

  /** The four flat/overhead presets (iso, plan, front, side) plus `custom`. */
  setPreset(name: 'iso' | 'plan' | 'front' | 'side' | 'custom'): void {
    if (name === 'custom') return
    const c = this.ctx.bounds.getCenter(new THREE.Vector3())
    const dirs: Record<'iso' | 'plan' | 'front' | 'side', THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1.2, 0.85).normalize(),
      plan: new THREE.Vector3(0, 0.001, 1).normalize(),
      front: new THREE.Vector3(0, -1, 0).normalize(),
      side: new THREE.Vector3(1, 0, 0).normalize(),
    }
    const dist = Math.max(40, this.ctx.bounds.getSize(new THREE.Vector3()).length() * 0.9)
    this.controls.target.copy(c)
    this.camera.position.copy(c).addScaledVector(dirs[name], dist)
    if (name === 'plan' || name === 'front' || name === 'side') this.setOrtho(true)
    else this.setOrtho(false)
    this.camera.lookAt(c)
    this.controls.update()
  }

  setOrtho(on: boolean): void {
    this.orthoOn = on
    // Both projections use the shared wheel handler.
    this.controls.enableZoom = false
    this.applyOrtho()
    this.ortho.position.copy(this.camera.position)
    this.ortho.quaternion.copy(this.camera.quaternion)
  }

  /** Rebuild the ortho frustum from the model bounds, the aspect and the zoom. */
  private applyOrtho(): void {
    const base = this.ctx.bounds.getSize(this.tmpSize).length() * 0.7 * this.orthoZoom
    const aspect = this.camera.aspect || 1
    this.ortho.left = -base * aspect
    this.ortho.right = base * aspect
    this.ortho.top = base
    this.ortho.bottom = -base
    this.ortho.updateProjectionMatrix()
  }

  /** Mirror the perspective camera into the ortho one and refit the frustum. */
  syncOrtho(): void {
    this.ortho.position.copy(this.camera.position)
    this.ortho.quaternion.copy(this.camera.quaternion)
    this.applyOrtho()
  }

  /** Zoom either projection while OrbitControls can continue a middle drag. */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const factor = Math.exp(e.deltaY * 0.001)
    if (this.orthoOn) {
      this.orthoZoom = THREE.MathUtils.clamp(this.orthoZoom * factor, 0.06, 16)
      this.applyOrtho()
      return
    }

    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance)
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance))
    this.controls.update()
  }

  /** Track the pointer for the edge pan. Outside the canvas the pan stops. */
  private onEdgePointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect()
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
    const c = this.ctx.bounds.getCenter(new THREE.Vector3())
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
    const c = this.ctx.bounds.getCenter(new THREE.Vector3())
    const dist = Math.max(40, this.ctx.bounds.getSize(new THREE.Vector3()).length() * 0.9)
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
    const offset = this.camera.position.clone().sub(this.controls.target)
    const up = new THREE.Vector3(0, 0, 1)
    offset.applyAxisAngle(up, -dxPx * 0.008)
    const forward = offset.clone().normalize()
    const right = new THREE.Vector3().crossVectors(up, forward)
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    right.normalize()
    offset.applyAxisAngle(right, -dyPx * 0.008)
    const len = offset.length()
    this.placeAt(Math.atan2(offset.y, offset.x), Math.acos(THREE.MathUtils.clamp(offset.z / len, -1, 1)))
  }

  /**
   * Put the camera at an azimuth and polar angle from its target, at the distance it
   * already stands — the tail of the orbit drag, which is **a swing around the aim, not
   * away from it**. The polar angle is clamped a hair short of the poles (`POLAR_EPS`),
   * where the azimuth stops meaning anything and the view would flip.
   */
  private placeAt(theta: number, phi: number): void {
    const target = this.controls.target
    const offset = this.camera.position.clone().sub(target)
    const len = offset.length()
    if (len < 1e-6) return
    const p = THREE.MathUtils.clamp(phi, POLAR_EPS, Math.PI - POLAR_EPS)
    offset.set(len * Math.sin(p) * Math.cos(theta), len * Math.sin(p) * Math.sin(theta), len * Math.cos(p))
    this.camera.position.copy(target).add(offset)
    this.camera.lookAt(target)
    this.controls.update()
  }

  /**
   * The perspective lens, in degrees — the camera's own vertical field of view, which is
   * the one number the nav cube's slider shows and the one it writes back through
   * `setFov`.
   *
   * Degrees rather than a percentage of `DEFAULT_FOV`, because that is the unit the value
   * is *for*: a lens is quoted in degrees (a shooter's 90, a wide-angle's 100) and the
   * distortion at either end is a property of the angle itself, so a percentage only
   * added a conversion between the number on screen and the number anyone compares it to.
   *
   * The **flat presets are unaffected**: they draw through the orthographic camera, whose
   * field of view is its own frustum (`orthoZoom`, on the wheel), so this is a perspective
   * lens control.
   */
  fov(): number {
    return this.camera.fov
  }

  /**
   * Set the lens, in degrees. Clamped to the slider's own range (`FOV_MIN_DEG` /
   * `FOV_MAX_DEG`) here as well as on the slider, so no caller can push the view to a
   * lens nothing can be read through.
   *
   * A non-finite angle is **refused rather than clamped**: `MathUtils.clamp` passes a NaN
   * straight through, and a NaN `fov` makes the projection matrix NaN and draws nothing at
   * all, so the lens stays where it was instead of the station disappearing.
   */
  setFov(deg: number): void {
    if (!Number.isFinite(deg)) return
    this.camera.fov = THREE.MathUtils.clamp(deg, FOV_MIN_DEG, FOV_MAX_DEG)
    this.camera.updateProjectionMatrix()
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
    if (this.ctx.keys.has('w')) forward += 1
    if (this.ctx.keys.has('s')) forward -= 1
    if (this.ctx.keys.has('d')) strafe += 1
    if (this.ctx.keys.has('a')) strafe -= 1
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
   * Metres per second a camera pan travels. It scales with the orbit distance —
   * a zoomed-in view moves metres, a zoomed-out one crosses the station — and
   * Shift multiplies it. Both pans share it (WASD across the ground and Ctrl+Q/E
   * up the vertical) so the two cannot drift apart in feel.
   */
  private moveSpeed(): number {
    const distance = this.camera.position.distanceTo(this.controls.target)
    return Math.max(4, Math.min(45, distance * 0.4)) * (this.ctx.keys.has('shift') ? 3 : 1)
  }

  /**
   * Move the camera across the world's XY plane. `panInput` blends WASD (Shift
   * = faster) with the mouse edge band; the pan is camera-relative, so it
   * follows the orbit. Q/E are the layer step and live in the app; the camera's
   * own vertical pair is Ctrl+Q / Ctrl+E (`panCameraVertical`).
   */
  panCamera(dt: number): void {
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
    const speed = this.moveSpeed()
    const move = new THREE.Vector3()
      .addScaledVector(dir, forward * speed * dt)
      .addScaledVector(right, strafe * speed * dt)
    // Move target and camera together so the orbit offset is preserved.
    this.camera.position.add(move)
    this.controls.target.add(move)
    this.controls.update()
  }

  /**
   * Ctrl+E / Ctrl+Q: raise and lower the view along world Z, at the ground pan's
   * own rate (`moveSpeed`, Shift faster). **The camera and the point it aims at
   * move together**, exactly as `panCamera` moves them across the ground.
   *
   * Moving both is what holds the *view angle*: the offset between the camera and
   * its aim is never touched, so the station is seen from the same elevation,
   * the same distance and the same bearing, and simply slides up or down the
   * screen. Aiming the camera alone — the pan's own `controls.target` line left
   * out — would instead tilt the view onto a steeper or flatter angle, which is
   * a different control.
   *
   * Nothing clamps it and nothing needs to: the orbit distance is unchanged by a
   * move in which camera and target step together, so `OrbitControls`' own
   * `minDistance`/`maxDistance` never come into it, and the view is bounded only
   * by letting the key go (`Home` frames the station again). WASD shifts the same
   * world the same way on the other two axes.
   *
   * The pan is held under `PAN_UP` / `PAN_DOWN` (`SceneSystem.ts`): the intent,
   * not a key, because the keyboard's Ctrl+E / Ctrl+Q and the nav cube's two
   * arrows both hold it — one action, two sources, one rate. A plain Q/E adds
   * neither, because that letter is the storey step in the app.
   */
  panCameraVertical(dt: number): void {
    if (dt <= 0) return
    let lift = 0
    if (this.ctx.keys.has(PAN_UP)) lift += 1
    if (this.ctx.keys.has(PAN_DOWN)) lift -= 1
    if (lift === 0) return
    const step = lift * this.moveSpeed() * dt
    // Camera and target together, so the orbit offset — the view angle — is
    // preserved by the move.
    this.camera.position.z += step
    this.controls.target.z += step
    this.controls.update()
  }

  /**
   * The pointer's answer, in whole cells: the block hit and the block a placement
   * against it takes. The cell math is `pickCells` (pure, and pinned by
   * `test/pick-cell.test.mjs`) because the drawn mesh under the pointer is not
   * always axis-aligned: the block under a 楼梯 / 扶梯 is a wedge whose top is the
   * run's slope, and every exposed block edge is rounded, so a raw
   * `cell + face.normal` asks for a fractional block no tool can address again.
   */
  pick(clientX: number, clientY: number, workPlaneZ: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.activeCamera())
    // Blocks removed from the level above are not pickable: a click must not
    // grab a slab that is no longer drawn.
    const shown = this.pickables.filter((m) => m.visible && (!m.parent || m.parent.visible))
    const hits = this.raycaster.intersectObjects(shown, false)
    if (hits.length > 0) {
      const hit = hits[0]
      const p = hit.point
      const n = hit.face ? hit.face.normal : new THREE.Vector3(0, 0, 1)
      const picked = pickCells([p.x, p.y, p.z], [n.x, n.y, n.z])
      return { cell: picked.cell, solid: true, normal: picked.normal, place: picked.place, point: [p.x, p.y, p.z] }
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

  /** Pointer intersection at a fitting's height, independent of blocks beneath it. */
  pickHorizontalPlane(clientX: number, clientY: number, height: number, anchorZ: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.activeCamera())
    const point = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -height), point)) return null
    const cell: [number, number, number] = [Math.floor(point.x), Math.floor(point.y), anchorZ]
    return { cell, place: cell, solid: false, normal: [0, 0, 1], point: [point.x, point.y, point.z] }
  }

  activeCamera(): THREE.Camera {
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
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.activeCamera())
    const shown = this.modules.moduleMeshes.children.filter((c) => c.visible && (!c.parent || c.parent.visible))
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

  resize(w: number, h: number): void {
    this.canvasW = w
    this.canvasH = h
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.orthoOn) this.applyOrtho()
  }

  override dispose(): void {
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('pointermove', this.onEdgePointerMove)
    this.canvas.removeEventListener('pointerleave', this.onEdgePointerLeave)
    this.canvas.removeEventListener('pointerup', this.onEdgePointerUp)
    // OrbitControls wires its own pointer/wheel/contextmenu listeners onto the
    // canvas; without this they survive the scene and keep the camera alive.
    this.controls.dispose()
  }
}
