// SectionSystem — 剖切: the clip plane, the highlighted surface drawn on it,
// and the plane's own picking.
//
// 剖切 used to be a fixed half-station cut facing +y, built inside the chunk
// rebuild. It is now a *placed* surface the player slides, turns and drags
// (`render/section.ts` holds the arithmetic), and this system is the half of it
// that touches the GPU:
//
//   * one `THREE.Plane` object, kept alive for the scene's lifetime. The chunk
//     materials hold it **by reference** (three reads `material.clippingPlanes`
//     every draw), so sliding the cut is a two-number write — no rebuild, no
//     material clone, no `needsUpdate`, and the meshes it slices never know.
//   * the highlighted cut surface — a translucent quad, a border and a grid —
//     sitting a hair on the **kept** side of the plane so it is never clipped
//     away, and growing with the station so it always reaches past the building
//     it cuts.
//   * the picking ray for it, so the surface can be grabbed with the pointer
//     (`app/Viewport.tsx` turns a hit into a slide).

import * as THREE from 'three'
import { planeConstant, sectionNormal, sectionPoint, sectionRight, sectionUp, sectionHighlightSize } from '../../section.ts'
import type { Section, Vec3 } from '../../section.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'
import type { ChunkSystem } from './ChunkSystem.ts'
import type { CrowdSystem } from './CrowdSystem.ts'
import type { ModuleSystem } from './ModuleSystem.ts'

/** How far the highlight floats off the plane, toward the kept half, in metres. */
const LIFT = 0.02
/** Grid pitch of the section hatch, metres. */
const GRID = 2
/** The quad's half-extent when the station has no measurable bounds yet. */
const MIN_SIZE = 6
/** The shortest the direction arrow gets, metres — a mark, not a monument. */
const ARROW_MIN = 3
/** The share of the arrow taken by its head; the rest is shaft. */
const HEAD_SHARE = 0.4

export class SectionSystem extends SceneSystem {
  /** Sibling systems whose materials have to be clipped; wired by the orchestrator. */
  chunks!: ChunkSystem
  crowd!: CrowdSystem
  modules!: ModuleSystem

  /** The one plane every clipped material shares. */
  readonly plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  /** 剖切 on/off. The surface and the clip planes follow it. */
  on = false
  /** Set while the pointer is over the section surface, for the hover read. */
  hovered = false

  private group = new THREE.Group()
  private quad: THREE.Mesh
  private hatch: THREE.LineSegments
  private handle: THREE.Mesh
  private arrow: THREE.Group
  private fill: THREE.MeshBasicMaterial
  private edge: THREE.LineBasicMaterial
  private handleMat: THREE.MeshBasicMaterial
  private arrowMat: THREE.MeshBasicMaterial
  private size = MIN_SIZE
  private raycaster = new THREE.Raycaster()
  /** 隐藏剖切面: the sheet, its hatch and the direction arrow are put away. */
  private surfaceVisible = true
  /** What the arrow was last sized for, so it is only re-laid-out when it moves. */
  private arrowKey = 0

  constructor(ctx: SceneContext) {
    super(ctx)
    this.group.name = 'section'
    this.group.visible = false
    // The quad is the grab target as much as the drawing: a translucent sheet
    // over the whole station is what makes "snap the mouse onto this surface"
    // mean something. `DoubleSide` because the cut is looked at from both ways.
    this.fill = new THREE.MeshBasicMaterial({
      color: 0x59c8ff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fill)
    this.quad.userData.sectionSurface = true
    // The hatch: the quad's own border plus a 2 m grid, drawn in one
    // `LineSegments` so a slide changes one transform and no geometry at all.
    this.edge = new THREE.LineBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false })
    this.hatch = new THREE.LineSegments(new THREE.BufferGeometry(), this.edge)
    this.handleMat = new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
    this.handle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.handleMat)
    // The direction arrow: **the way it points is the half that is kept**, so the
    // mode stops being a guess about which side survives a turn. Drawn without a
    // depth test and last in the queue, because it is a diagram mark like the
    // sheet's border — half-buried in a slab it would say nothing.
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x8fe4ff, toneMapped: false, depthTest: false, transparent: true })
    this.arrow = new THREE.Group()
    this.arrow.renderOrder = 4
    this.buildArrow()
    this.group.add(this.quad, this.hatch, this.handle, this.arrow)
    this.ctx.scene.add(this.group)
    this.buildHatch(MIN_SIZE)
    this.resizeArrow(MIN_SIZE)
  }

  /**
   * The arrow's shaft and head, pointing along the group's own `+z` — which
   * `refreshHighlight` turns to the section normal. Two cylinders with **unit**
   * dimensions, so the whole mark is drawn once and then scaled to the station
   * (`resizeArrow`); the tail sits at the section plane and the head ends
   * `ARROW`-long out into the kept half.
   *
   * The split is fixed: the last 40% of the arrow is the head, the rest the shaft.
   */
  private buildArrow(): void {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), this.arrowMat)
    head.userData.arrowPart = 'head'
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), this.arrowMat)
    shaft.userData.arrowPart = 'shaft'
    for (const part of [shaft, head]) {
      part.rotation.x = Math.PI / 2
      part.renderOrder = 4
      part.frustumCulled = false
      this.arrow.add(part)
    }
  }

  /**
   * Lay the arrow out for an arrow `length` metres long: tail on the section
   * plane, head pointing out along the normal. The two unit cylinders are placed
   * and scaled so the mark spans `[0, length]` in the arrow group's local `z`,
   * with a head `HEAD_SHARE` of it and a shaft thinner than the head.
   */
  private resizeArrow(size: number): void {
    const length = Math.max(ARROW_MIN, size * 0.22)
    const key = Math.round(length * 100)
    if (key === this.arrowKey) return
    this.arrowKey = key
    const head = length * HEAD_SHARE
    const shaft = length - head
    for (const part of this.arrow.children) {
      const isHead = part.userData.arrowPart === 'head'
      const len = isHead ? head : shaft
      // The unit cylinder is centred on its own origin, so placing it at the
      // midpoint of its span runs it from the tail to the tip.
      part.position.z = isHead ? shaft + head / 2 : shaft / 2
      const radius = isHead ? length * 0.075 : length * 0.018
      part.scale.set(radius, len, radius)
    }
  }

  /** 隐藏剖切面: the sheet, its hatch and the arrow with it (`setSurfaceVisible`). */
  private applyVisibility(): void {
    const shown = this.on && this.surfaceVisible
    this.quad.visible = shown
    this.hatch.visible = shown
    this.handle.visible = shown
    this.arrow.visible = shown
  }

  /** A square outline plus its 2 m grid, in the surface's own plane. */
  private buildHatch(size: number): void {
    const pts: number[] = []
    const line = (ax: number, ay: number, bx: number, by: number): void => {
      pts.push(ax, ay, 0, bx, by, 0)
    }
    line(-size, -size, size, -size)
    line(size, -size, size, size)
    line(size, size, -size, size)
    line(-size, size, -size, -size)
    for (let v = -Math.floor(size / GRID) * GRID; v <= size + 1e-6; v += GRID) {
      line(v, -size, v, size)
      line(-size, v, size, v)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    this.hatch.geometry.dispose()
    this.hatch.geometry = geo
  }

  /**
   * The section the store has, and whether it is cutting. The plane is written
   * in place — three holds this object on every clipped material — and the
   * highlight (with its direction arrow) is moved and turned to lie on it.
   */
  setSection(section: Section, on: boolean): void {
    this.ctx.section = section
    this.on = on
    const n = sectionNormal(section.orientation)
    this.plane.normal.set(n[0], n[1], n[2])
    this.plane.constant = planeConstant(section)
    this.group.visible = on
    this.refreshHighlight()
    this.applyVisibility()
  }

  /** 隐藏剖切面: keep cutting, but put the sheet, hatch and arrow away. */
  setSurfaceVisible(on: boolean): void {
    if (this.surfaceVisible === on) return
    this.surfaceVisible = on
    this.applyVisibility()
  }

  /** Where the highlighted surface stands, sized to the station it cuts. */
  private refreshHighlight(): void {
    const s = this.ctx.section
    const p = sectionPoint(s)
    const n = sectionNormal(s.orientation)
    const size = this.boxSize()
    if (Math.abs(size - this.size) > 1e-3) {
      this.size = size
      this.quad.geometry.dispose()
      this.quad.geometry = new THREE.PlaneGeometry(size * 2, size * 2)
      this.buildHatch(size)
      this.resizeArrow(size)
    }
    // The quad's own frame: its `+z` (a PlaneGeometry's normal) is the section
    // normal, its `+x` the surface's right, its `+y` the surface's up.
    const right = sectionRight(n)
    const up = sectionUp(n, right)
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(n[0], n[1], n[2]),
    )
    const lift: Vec3 = [p[0] + n[0] * LIFT, p[1] + n[1] * LIFT, p[2] + n[2] * LIFT]
    this.group.position.set(lift[0], lift[1], lift[2])
    this.group.quaternion.setFromRotationMatrix(m)
    // The arrow rides the group's frame, so it turns with the section for free:
    // it points along the group's own `+z`, which is the normal — the half that is
    // kept. Its tail is the section plane itself, so the mark reads "from here,
    // that way is what stays". `resizeArrow` lays the parts out from its length.
    this.arrow.position.z = 0
    this.resizeArrow(size)
  }

  /** The half-extent the highlight covers: the station's own plan, plus a margin. */
  private boxSize(): number {
    const b = this.ctx.bounds
    const min = b.min
    const max = b.max
    const dx = max.x - min.x
    const dy = max.y - min.y
    const dz = max.z - min.z
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return MIN_SIZE
    return sectionHighlightSize([dx, dy, dz])
  }

  /**
   * Push the current plane onto every material that draws station geometry. The
   * list is rebuilt on demand rather than cached: a station edit replaces the
   * chunk and module materials, and a stale list would leave half the station
   * uncut. It is only ever called on a toggle or an edit, never per frame.
   *
   * Chunk and module materials take the plane **by reference**, so a slide does
   * not come through here at all.
   */
  applyClip(): void {
    const planes = this.on ? [this.plane] : []
    for (const m of [...this.chunks.chunkMeshes, ...this.chunks.outlineMeshes]) {
      const mat = m.material as THREE.Material
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
    for (const mat of this.crowd.clipMaterials()) {
      mat.clippingPlanes = planes
      mat.needsUpdate = true
    }
    // Equipment is clipped too: a 闸机, a screen door and a train standing in
    // the half that is cut away must go with the slab, exactly as the crowd does.
    for (const root of this.modules.moduleMeshes.children) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mat = mesh.material as THREE.Material
        if (Array.isArray(mat)) {
          for (const one of mat) {
            one.clippingPlanes = planes
            one.needsUpdate = true
          }
          return
        }
        mat.clippingPlanes = planes
        mat.needsUpdate = true
      })
    }
  }

  /**
   * The section surface under the pointer: the handle a slide grabs. Only while
   * the surface is on screen — with 隐藏剖切面 on there is no sheet to grab, so
   * the pointer belongs to the tools as usual.
   */
  hit(clientX: number, clientY: number, canvas: HTMLCanvasElement, camera: THREE.Camera): boolean {
    if (!this.on || !this.surfaceVisible) return false
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, camera)
    return this.raycaster.intersectObject(this.quad, false).length > 0
  }

  /**
   * Where the pointer's ray meets the surface's own plane, in station space —
   * the point a slide is measured from. The plane is the *unlifted* one, so the
   * answer is the section the player sees rather than the 2 cm the marker
   * floats above it.
   */
  rayPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement, camera: THREE.Camera): [number, number, number] | null {
    return this.rayPointOn(clientX, clientY, canvas, camera, this.plane)
  }

  /**
   * The same ray against **any** plane — what a drag uses: the plane the grab
   * started in, held still for the whole slide (`SceneRenderer.sectionDragPlane`),
   * so the pointer keeps meeting a stable surface however far the cut travels.
   */
  rayPointOn(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    plane: THREE.Plane,
  ): [number, number, number] | null {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, camera)
    const p = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null
    return [p.x, p.y, p.z]
  }

  /** The pointer is on the surface: a brighter sheet and its edge. */
  setHover(on: boolean): void {
    if (on === this.hovered) return
    this.hovered = on
    this.fill.opacity = on ? 0.26 : 0.14
    this.edge.opacity = on ? 1 : 0.75
    this.handleMat.opacity = on ? 1 : 0.85
  }

  override dispose(): void {
    this.ctx.scene.remove(this.group)
    this.quad.geometry.dispose()
    this.hatch.geometry.dispose()
    this.handle.geometry.dispose()
    for (const part of this.arrow.children) (part as THREE.Mesh).geometry.dispose()
    this.fill.dispose()
    this.edge.dispose()
    this.handleMat.dispose()
    this.arrowMat.dispose()
  }
}
