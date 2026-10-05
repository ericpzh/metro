// CameraSystem — the camera rig, presets, pan/orbit input and pointer picking
// (moved verbatim from `render/scene.ts`: `setPreset`, `setOrtho`,
// `applyOrtho`, the wheel/edge-pointer handlers, `frame`, `setViewDirection`,
// `orbitBy`, `panInput`, `panCamera`, `pick`, `activeCamera`, `pickModule`,
// `pickFacing`, `zoneAt`, `resize`).
//
// Left and right belong to the tools; orbit is the middle button, the wheel
// zooms flat views, and WASD (+ the mouse edge band) pans camera-relative.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { facingFrom } from '../../pickFacing.ts'
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

  /** The block/module meshes the current station made pickable. */
  setPickables(pickables: THREE.Object3D[]): void {
    this.pickables = pickables
  }

  setPreset(name: 'iso' | 'plan' | 'front' | 'side' | 'custom'): void {
    const c = this.ctx.bounds.getCenter(new THREE.Vector3())
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1.2, 0.85).normalize(),
      plan: new THREE.Vector3(0, 0.001, 1).normalize(),
      front: new THREE.Vector3(0, -1, 0).normalize(),
      side: new THREE.Vector3(1, 0, 0).normalize(),
    }
    if (name === 'custom') return
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
