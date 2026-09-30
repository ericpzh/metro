// The three.js scene: camera rig, chunk meshes, outline pass, contact shadows,
// the agent InstancedMesh and the LOS overlay. Browser-only.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildSolidSet, CHUNK, meshChunk } from './chunkMesher.ts'
import { createMaterials, type MaterialSet } from './materials.ts'
import type { StationData } from '../sim/types.ts'

const TICK_MS = 200

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

export class SceneRenderer {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  ortho: THREE.OrthographicCamera
  controls: OrbitControls
  mats: MaterialSet
  solid = new Set<number>()

  private levelGroups = new Map<number, THREE.Group>()
  private chunkMeshes: THREE.Mesh[] = []
  private outlineMeshes: THREE.Mesh[] = []
  private moduleBlobs: THREE.InstancedMesh | null = null
  private moduleMeshes: THREE.Group = new THREE.Group()
  private grid: THREE.Group = new THREE.Group()
  private cursor: THREE.Mesh
  private ghostMesh: THREE.InstancedMesh | null = null
  private agents: THREE.InstancedMesh
  private blobs: THREE.InstancedMesh
  private overlay: THREE.InstancedMesh | null = null
  private prev = new Float32Array(0)
  private cur = new Float32Array(0)
  private agentCount = 0
  private lastStateTime = 0
  private yaws = new Float32Array(0)
  private frameCount = 0
  private fpsTime = 0
  private fps = 0
  private lastChunkMs = 0
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  private orthoOn = false
  private ghost = true
  private activeZ = 0
  private bounds = new THREE.Box3()
  private raycaster = new THREE.Raycaster()
  private pickables: THREE.Object3D[] = []
  private dimMats = new Map<THREE.Material, THREE.Material>()
  private disposition = false
  private zAxis = new THREE.Vector3(0, 0, 1)
  private tmpQ = new THREE.Quaternion()
  private tmpM = new THREE.Matrix4()
  private tmpP = new THREE.Vector3()
  private tmpS = new THREE.Vector3(1, 1, 1)
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

    this.mats = createMaterials()

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

    // Agents. Low-poly on purpose: at 3,000 the silhouette matters, not the
    // facet count.
    const geo = new THREE.CapsuleGeometry(0.2, 0.7, 1, 6)
    geo.rotateX(Math.PI / 2)
    geo.translate(0, 0, 0.55)
    this.agents = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }), 8000)
    this.agents.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.agents.frustumCulled = false
    // Colours are static per slot; upload them once.
    const slotColor = new THREE.Color()
    for (let i = 0; i < 8000; i++) {
      this.agents.setColorAt(i, slotColor.setHex(AGENT_COLORS[i % AGENT_COLORS.length]))
    }
    this.scene.add(this.agents)

    const blobGeo = new THREE.CircleGeometry(0.42, 10)
    this.blobs = new THREE.InstancedMesh(blobGeo, this.mats.blob, 8000)
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.blobs.frustumCulled = false
    this.blobs.renderOrder = 2
    this.scene.add(this.blobs)

    const cursorGeo = new THREE.RingGeometry(0.35, 0.5, 4)
    this.cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
    this.cursor.visible = false
    this.scene.add(this.cursor)

    this.setPreset('iso')
    this.animate()
  }

  /* ------------------------------------------------------------ station */

  setStation(data: StationData, trackCells: Set<number> = new Set()): void {
    this.solid = buildSolidSet(data.cells)
    this.disposeChunks()
    const t0 = performance.now()
    this.lastChunkMs = 0
    // Mesh per level band: one z of solid cells at a time keeps level slicing
    // exact and each chunk small.
    const byZ = new Map<number, Array<{ x: number; y: number }>>()
    for (const c of data.cells) {
      if (c.fill !== 'solid') continue
      let arr = byZ.get(c.z)
      if (!arr) {
        arr = []
        byZ.set(c.z, arr)
      }
      arr.push(c)
    }
    const box = new THREE.Box3()
    for (const [z, cells] of byZ) {
      const group = new THREE.Group()
      group.userData.levelZ = z
      const seen = new Set<string>()
      for (const c of cells) {
        const cx = Math.floor(c.x / CHUNK) * CHUNK
        const cy = Math.floor(c.y / CHUNK) * CHUNK
        const k = `${cx},${cy}`
        if (seen.has(k)) continue
        seen.add(k)
        const chunk = meshChunk(this.solid, cx, cy, z)
        if (chunk.triangles === 0) continue
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3))
        geo.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3))
        geo.setAttribute('uv', new THREE.BufferAttribute(chunk.uvs, 2))
        geo.setIndex(new THREE.BufferAttribute(chunk.indices, 1))
        geo.computeBoundingBox()
        if (geo.boundingBox) box.union(geo.boundingBox)
        this.lastChunkMs = Math.max(this.lastChunkMs, chunk.ms)
        const mesh = new THREE.Mesh(geo, this.mats.platform)
        mesh.userData.levelZ = z
        mesh.userData.cells = cells.length
        group.add(mesh)
        this.chunkMeshes.push(mesh)
        // Inverted hull outline: same geometry, back faces, pushed outward.
        const outline = new THREE.Mesh(geo, this.outlineMaterial())
        outline.userData.levelZ = z
        outline.renderOrder = -1
        group.add(outline)
        this.outlineMeshes.push(outline)
      }
      this.levelGroups.set(z, group)
      this.scene.add(group)
    }
    this.bounds = box
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(8, 8, 8))
    this.buildModules(data, trackCells)
    this.buildGrid()
    const clipY = box.min.y + (box.max.y - box.min.y) * 0.5
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY)
    void t0
    this.pickables = [...this.chunkMeshes]
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

  private buildModules(data: StationData, trackCells: Set<number>): void {
    this.moduleMeshes.clear()
    const parts: THREE.Mesh[] = []
    const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, colour: number, zOff = 0): void => {
      const g = new THREE.BoxGeometry(w, d, h)
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4, metalness: 0.2 }))
      m.position.set(x + w / 2, y + d / 2, z + zOff + h / 2)
      parts.push(m)
    }
    for (const mod of data.modules) {
      switch (mod.type) {
        case 'gate':
          addBox(mod.x + 0.15, mod.y + 0.1, mod.z + 1, 0.7, 1.0, 0.9, 0x8b93a1)
          break
        case 'tvm':
          addBox(mod.x + 0.2, mod.y + 0.2, mod.z + 1, 0.6, 0.6, 1.1, 0xd8dde4)
          break
        case 'bench':
          addBox(mod.x + 0.15, mod.y + 0.1, mod.z + 1, 0.7, 0.8, 0.45, 0x9c6b4a)
          break
        case 'exit':
          addBox(mod.x - 0.4, mod.y - 0.4, mod.z + 1, 1.8, 1.8, 0.3, 0x3fb27f)
          break
        case 'escalator': {
          const a = new THREE.Vector3(mod.from.x + 0.5, mod.from.y + 0.5, mod.from.z + 1)
          const b = new THREE.Vector3(mod.to.x + 0.5, mod.to.y + 0.5, mod.to.z + 1)
          const mid = a.clone().add(b).multiplyScalar(0.5)
          const len = a.distanceTo(b)
          const g = new THREE.BoxGeometry(1.1, len, 0.25)
          const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.5, metalness: 0.5 }))
          m.position.copy(mid)
          m.lookAt(b)
          m.rotateX(Math.PI / 2)
          parts.push(m)
          break
        }
        case 'stair': {
          const a = new THREE.Vector3(mod.from.x + 0.5, mod.from.y + 0.5, mod.from.z + 1)
          const b = new THREE.Vector3(mod.to.x + 0.5, mod.to.y + 0.5, mod.to.z + 1)
          const mid = a.clone().add(b).multiplyScalar(0.5)
          const len = a.distanceTo(b)
          const g = new THREE.BoxGeometry(2.4, len, 0.25)
          const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9aa2ab }))
          m.position.copy(mid)
          m.lookAt(b)
          m.rotateX(Math.PI / 2)
          parts.push(m)
          break
        }
        case 'lift':
          addBox(mod.x + 0.1, mod.y + 0.1, mod.z + 1, 1.8, 1.8, 2.6, 0x445063)
          break
        case 'track': {
          for (let i = 0; i < mod.w; i++) {
            if (!trackCells.has(0)) break
            addBox(mod.x + i, mod.y, mod.z, 1, 1, 0.08, 0x2c313a, -0.02)
          }
          break
        }
        default:
          break
      }
    }
    for (const p of parts) this.moduleMeshes.add(p)
    // Contact blobs under the modules (§11).
    if (this.moduleBlobs) this.moduleMeshes.remove(this.moduleBlobs)
    const n = parts.length
    this.moduleBlobs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.8, 12), this.mats.blob, Math.max(1, n))
    this.moduleBlobs.renderOrder = 2
    const m = new THREE.Matrix4()
    parts.forEach((p, i) => {
      const box = p.geometry as THREE.BoxGeometry
      const h = box.parameters?.height ?? 1
      m.makeTranslation(p.position.x, p.position.y, p.position.z - h / 2 - 0.42)
      this.moduleBlobs!.setMatrixAt(i, m)
    })
    this.moduleBlobs.count = n
    this.moduleMeshes.add(this.moduleBlobs)
    void trackCells
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
    for (const [lz, group] of this.levelGroups) {
      const active = lz === this.activeZ
      group.visible = true
      for (const child of group.children) {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) continue
        const isOutline = this.outlineMeshes.includes(mesh)
        if (active || !this.ghost) {
          mesh.material = isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh)
          mesh.visible = true
        } else {
          mesh.material = this.dimOf(isOutline ? mesh.userData.baseMaterial ?? mesh.material : this.baseOf(mesh))
        }
      }
    }
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

  setAgents(buffer: Float32Array, count: number): void {
    if (this.cur.length < buffer.length) {
      this.cur = new Float32Array(Math.max(buffer.length, 4096))
      this.prev = new Float32Array(Math.max(buffer.length, 4096))
      this.yaws = new Float32Array(this.cur.length / 5)
    }
    this.prev.set(this.cur.subarray(0, this.cur.length))
    this.cur.set(buffer.subarray(0, this.cur.length))
    this.agentCount = count
    this.lastStateTime = performance.now()
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
    const size = this.bounds.getSize(new THREE.Vector3()).length() * 0.7
    this.ortho.left = -size
    this.ortho.right = size
    this.ortho.top = size
    this.ortho.bottom = -size
    this.ortho.position.copy(this.camera.position)
    this.ortho.quaternion.copy(this.camera.quaternion)
    this.ortho.updateProjectionMatrix()
  }

  frame(): void {
    const c = this.bounds.getCenter(new THREE.Vector3())
    this.controls.target.copy(c)
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

  /** Ghost preview for the active drag (§9.5). */
  setGhost(cells: Array<[number, number, number]>, kind: 'add' | 'remove'): void {
    if (cells.length === 0) {
      if (this.ghostMesh) this.ghostMesh.visible = false
      return
    }
    if (!this.ghostMesh) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
      this.ghostMesh = new THREE.InstancedMesh(geo, mat, 4096)
      this.ghostMesh.frustumCulled = false
      this.ghostMesh.renderOrder = 3
      this.scene.add(this.ghostMesh)
    }
    const m = new THREE.Matrix4()
    const col = new THREE.Color(kind === 'add' ? 0x6ee7ff : 0xff5d5d)
    const n = Math.min(cells.length, this.ghostMesh.count || 4096)
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

  setGridVisible(on: boolean): void {
    this.grid.visible = on
  }

  /* -------------------------------------------------------------- picking */

  pick(clientX: number, clientY: number, workPlaneZ: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.activeCamera())
    const hits = this.raycaster.intersectObjects(this.pickables, false)
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
    if (this.controls.enabled) this.controls.update()
    this.renderAgents(now)
    const cam = this.activeCamera()
    this.ortho.position.copy(this.camera.position)
    this.ortho.quaternion.copy(this.camera.quaternion)
    this.ortho.updateProjectionMatrix()
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
    const alpha = Math.min(1, (now - this.lastStateTime) / TICK_MS)
    const m = this.tmpM
    const q = this.tmpQ
    const pos = this.tmpP
    const scale = this.tmpS
    const axis = this.zAxis
    const n = this.agentCount
    for (let i = 0; i < n; i++) {
      const o = i * 5
      const px = this.prev[o]
      const py = this.prev[o + 1]
      const pz = this.prev[o + 2]
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
      m.makeTranslation(pos.x, pos.y, pos.z + 0.03)
      this.blobs.setMatrixAt(i, m)
    }
    this.agents.count = n
    this.blobs.count = n
    this.agents.instanceMatrix.needsUpdate = true
    this.blobs.instanceMatrix.needsUpdate = true
  }

  setAgentsVisible(on: boolean): void {
    this.agents.visible = on
    this.blobs.visible = on
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.disposition = true
    this.disposeChunks()
    this.renderer.dispose()
    void this.disposition
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
