// CameraSystem — the camera rig, presets, pan/orbit input and pointer picking
// (moved verbatim from `render/scene.ts`: `setPreset`, `setOrtho`,
// `applyOrtho`, the wheel/edge-pointer handlers, `frame`, `setViewDirection`,
// `orbitBy`, `panInput`, `panCamera`, `pick`, `activeCamera`, `pickModule`,
// `pickFacing`, `zoneAt`, `resize`).
//
// Left and right belong to the tools; orbit is the middle button, the wheel
// zooms flat views, and WASD (+ the mouse edge band) pans camera-relative.
//
// **沉浸 is a move of the same rig** (`setImmersive`), and that is all it is: the
// camera steps to where a person in the room would stand and the orbit target
// comes with it, so the orbit rig, the wheel, the middle button, the nav cube and
// the WASD pan all go on working exactly as they do in every other view, at the
// angle the player was already holding. The control scheme is the point of the
// other views, so the mode borrows it rather than replacing it — and it puts the
// view back, to the metre, when it is turned off.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { facingFrom } from '../../pickFacing.ts'
import { packKey } from '../../../sim/types.ts'
import { SceneSystem } from './SceneSystem.ts'
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
 * A person's eye height above the floor, in metres. The whole of 沉浸's claim is
 * this number: at depth −8 m the camera is set at −6 m, because that is where
 * somebody standing on that storey's floor would be looking from.
 */
const EYE_HEIGHT = 1.62

/**
 * The floor line under `(x, y)` at storey `z`: the top of the first solid block
 * the column meets on the way down from that storey's own line, so a viewer
 * stands on the room's floor rather than inside the massing it was dug out of.
 * `z` itself when the column is open, which keeps the eye the right height above
 * the grid even over a void.
 */
function floorLine(solid: ReadonlySet<number>, x: number, y: number, z: number): number {
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  for (let cz = Math.floor(z); cz >= z - 64; cz--) {
    if (!solid.has(packKey(cx, cy, cz))) continue
    // The top of the run this block belongs to: a digging's massing is metres
    // deep, and the surface is the line above the topmost block of it.
    let top = cz
    while (solid.has(packKey(cx, cy, top + 1))) top++
    return top + 1
  }
  return z
}

/**
 * How far 沉浸 moves the rig, as one vector added to **both** the camera and its
 * orbit target: the eye ends at a person's height on `z`'s floor, at the plan
 * position the rig is looking at (its target's column).
 *
 * Being a translation is the whole design, and it is why the mode can never reset
 * anything. Adding one vector to both ends leaves the offset between them — the
 * direction the view looks along, the distance it looks from, and so the orbit the
 * player worked out — exactly what it was; only where the whole rig stands changes.
 * A player who has turned the station to look into a room arrives inside that room
 * at their own angle, and stepping back out restores the rig to the metre.
 *
 * Pure, so the one claim it makes is testable without a canvas or a GL context
 * (`test/immersive-view.test.mjs`).
 */
export function immersiveStep(
  camera: THREE.Vector3,
  target: THREE.Vector3,
  solid: ReadonlySet<number>,
  z: number,
): THREE.Vector3 {
  const eye = floorLine(solid, target.x, target.y, z) + EYE_HEIGHT
  return new THREE.Vector3(target.x - camera.x, target.y - camera.y, eye - camera.z)
}

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

  /* ------------------------------------------------------------- 沉浸 */

  /** True while the view is aimed from inside the station rather than over it. */
  private immersion = false
  /** The storey 沉浸 is currently standing on, so a re-seat knows the floor. */
  private immersiveZ = 0
  /**
   * The rig as 沉浸 found it, so leaving gives it back exactly. 沉浸 is a look
   * inside, not a view of its own: it may move the eye, but it may never cost the
   * player the orbit, the dolly and the pan they had worked out.
   */
  private immersiveFrom: { position: THREE.Vector3; target: THREE.Vector3; ortho: boolean; zoom: number } | null = null

  constructor(canvas: HTMLCanvasElement, ctx: SceneContext, renderer: THREE.WebGLRenderer) {
    super(ctx)
    this.canvas = canvas
    this.renderer = renderer
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
  }

  /* ------------------------------------------------------------- 沉浸 */

  get immersive(): boolean {
    return this.immersion
  }

  /**
   * 沉浸: the same rig, standing in the room instead of looking down at it from
   * over the station. It is a **translation of the camera and its target and
   * nothing else** — the eye steps to head height on the storey's floor at the plan
   * position the rig was looking at, and the orbit target comes with it by the same
   * step, so the direction the camera looks, the distance to its target and the roll
   * are exactly the ones the player arrived with.
   *
   * That is why it does not re-aim: 沉浸 is a way of standing inside the station,
   * not a fifth view of it, and a player who has orbited in to look at a room should
   * not lose that angle to a keypress. Turning it off puts the rig back where it
   * was, to the metre, so **K is a peek** — press it, press it again, and the view
   * is the one that was there.
   *
   * Every other control is untouched: the orbit, the wheel, the middle button,
   * WASD's pan and the nav cube all go on working as they do in every other view,
   * because the control scheme is what the other views are for.
   */
  setImmersive(on: boolean, z?: number): void {
    if (on === this.immersion) {
      // Already in that state: a repeat (the mount effect running twice, a second
      // K before a re-render) only re-seats the eye. Saving the pose again here
      // would remember the immersion one and lose the view being come back to.
      if (on) this.seatImmersive(z ?? this.immersiveZ)
      return
    }
    this.immersion = on
    if (!on) {
      const from = this.immersiveFrom
      this.immersiveFrom = null
      if (!from) return
      this.camera.position.copy(from.position)
      this.controls.target.copy(from.target)
      this.orthoZoom = from.zoom
      this.camera.lookAt(from.target)
      this.controls.update()
      // The projection last: `setOrtho` copies the camera into the ortho one.
      this.setOrtho(from.ortho)
      return
    }
    this.immersiveFrom = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      ortho: this.orthoOn,
      zoom: this.orthoZoom,
    }
    // A person's eye is a perspective view: 沉浸 never keeps a flat projection.
    this.setOrtho(false)
    this.seatImmersive(z ?? this.ctx.activeZ)
  }

  /**
   * Stand the eye at head height on `z`'s floor, at the plan position the rig is
   * looking at, and carry the orbit target along by the same step
   * (`immersiveStep`). The step, and why it can be a translation at all, is the
   * whole of 沉浸's camera; this is only the plumbing that applies it.
   */
  private seatImmersive(z: number): void {
    const step = immersiveStep(this.camera.position, this.controls.target, this.ctx.solid, z)
    this.camera.position.add(step)
    this.controls.target.add(step)
    this.controls.update()
    this.immersiveZ = z
  }

  /** The block/module meshes the current station made pickable. */
  setPickables(pickables: THREE.Object3D[]): void {
    this.pickables = pickables
  }

  /**
   * The four flat/overhead presets. 沉浸 is **not** one of them: it is a move of
   * the rig the player is already holding (`setImmersive`), so it has nothing to
   * say here.
   *
   * A preset *does* end 沉浸, and without putting the old rig back — the player has
   * just asked for a different view, so restoring the one they were working at
   * would simply overrule them. Forgetting the saved pose here is what keeps that
   * promise: the app clears its own 沉浸 flag alongside this call, and the
   * `setImmersive(false)` that follows is then a no-op rather than a restore that
   * lands on top of the preset.
   */
  setPreset(name: 'iso' | 'plan' | 'front' | 'side' | 'custom'): void {
    if (name === 'custom') return
    this.immersion = false
    this.immersiveFrom = null
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
    // The orbit dolly does nothing to an orthographic frustum, so hand the
    // wheel to `onWheel` (and back) whenever the projection changes.
    this.controls.enableZoom = !on
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

  /** Wheel zoom for flat views: scale the ortho frustum instead of dollying. */
  private onWheel = (e: WheelEvent): void => {
    // 沉浸 is a perspective view like `iso`, so the wheel keeps its usual job:
    // OrbitControls dollies the camera when the pointer is over the canvas, and
    // that is the whole of the zoom here.
    if (!this.orthoOn) return
    e.preventDefault()
    this.orthoZoom = THREE.MathUtils.clamp(this.orthoZoom * Math.exp(e.deltaY * 0.001), 0.06, 16)
    this.applyOrtho()
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
    // 沉浸 stands on a storey, so `frame` puts the eye back on the floor of the one
    // being looked around — the same translation `setImmersive` makes, taken again
    // for the storey that is on screen now. The angle is untouched, as everywhere in
    // the mode: this re-seats the eye, it does not re-aim the view.
    if (this.immersion) {
      this.seatImmersive(this.ctx.activeZ)
      return
    }
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
   * Move the camera across the world's XY plane. `panInput` blends WASD (Shift
   * = faster) with the mouse edge band; the pan is camera-relative, so it
   * follows the orbit. Q/E are the layer step and live in the app.
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
    const distance = this.camera.position.distanceTo(this.controls.target)
    const speed = Math.max(4, Math.min(45, distance * 0.4)) * (this.ctx.keys.has('shift') ? 3 : 1)
    const move = new THREE.Vector3()
      .addScaledVector(dir, forward * speed * dt)
      .addScaledVector(right, strafe * speed * dt)
    // Move target and camera together so the orbit offset is preserved.
    this.camera.position.add(move)
    this.controls.target.add(move)
    this.controls.update()
  }

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
  }
}
