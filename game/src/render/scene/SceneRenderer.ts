// SceneRenderer — the thin orchestrator (Lane F).
//
// The old `render/scene.ts` god-class (~70 methods: chunks, modules, ghosts,
// levels, trains, lifts, crowd, grid, camera, overlays) is split into one
// system per unit under `systems/`; this class owns the GL setup, the shared
// `SceneContext`, one instance per system, and the frame loop. Public methods
// do nothing but forward — all meshing, slicing and preview logic lives in the
// systems. `render/scene.ts` re-exports this file, so `Viewport.tsx` and the
// `/lab` page keep importing the path they always did.

import * as THREE from 'three'
import { createMaterials } from '../materials.ts'
import type { MaterialSet } from '../materials.ts'
import { createModelMaterials, disposeModelMaterials, refreshSignFaceMaterial } from '../models.ts'
import type { ModelMaterials } from '../models.ts'
import { createAdArt } from '../adArt.ts'
import { loadPictograms } from '../pictograms.ts'
import type { Face, Module, StationData, WallSide } from '../../sim/types.ts'
import { SceneContextData } from './systems/SceneSystem.ts'
import type { SceneStats } from './systems/SceneSystem.ts'
import { ChunkSystem } from './systems/ChunkSystem.ts'
import { ModuleSystem } from './systems/ModuleSystem.ts'
import { GhostSystem } from './systems/GhostSystem.ts'
import { LevelSystem } from './systems/LevelSystem.ts'
import { TrainSystem } from './systems/TrainSystem.ts'
import { LiftSystem } from './systems/LiftSystem.ts'
import { CrowdSystem } from './systems/CrowdSystem.ts'
import { GridSystem } from './systems/GridSystem.ts'
import { CameraSystem } from './systems/CameraSystem.ts'
import { PlateSystem } from './systems/PlateSystem.ts'
import { SectionSystem } from './systems/SectionSystem.ts'
import type { PickResult } from './systems/SceneSystem.ts'
import type { Section } from '../section.ts'

export type { PickResult, SceneStats }

export class SceneRenderer {
  renderer: THREE.WebGLRenderer
  onStats: ((s: SceneStats) => void) | null = null
  private ctx: SceneContextData
  private chunks: ChunkSystem
  private modules: ModuleSystem
  private ghostSys: GhostSystem
  private level: LevelSystem
  private trains: TrainSystem
  private lifts: LiftSystem
  private crowd: CrowdSystem
  private grid: GridSystem
  private cameraSys: CameraSystem
  private plates: PlateSystem
  private sectionSys: SectionSystem
  private lastFrame = 0
  private frameCount = 0
  private fpsTime = 0
  private fps = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0x0b0f16, 1)
    this.renderer.shadowMap.enabled = false
    this.renderer.localClippingEnabled = true

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x0b0f16, 120, 320)

    const mats = createMaterials()
    const modelMats = createModelMaterials()
    // The station's ad artwork, one cache per scene so every screen shares a
    // texture per poster and nothing re-uploads on a rebuild. The JPEGs decode
    // in the background; until they land a 装饰 screen prints the placeholder
    // face, and `onReady` redraws the modules so every poster appears without a
    // reload — see `render/adArt.ts` for why the pixels are not loaded lazily.
    const ads = createAdArt(this.renderer)
    this.ctx = new SceneContextData(scene, mats, modelMats, ads)
    void this.ctx.ads.load(() => {
      // The parameter is the legacy packed-key set `buildModules` no longer
      // reads (it derives its own from the data), so the station alone is passed.
      if (!this.ctx.disposed && this.ctx.stationData) this.modules.buildModules(this.ctx.stationData, new Set())
    })
    // The 指示牌's pictograms are bitmap art, and a plate printed before the
    // images decode would print the marks off it and keep them off — the texture is
    // minted once. So the decode is started here, beside the ad artwork, and the
    // modules are rebuilt the moment it lands (see `render/pictograms.ts`).
    void loadPictograms().then((icons) => {
      if (this.ctx.disposed || icons.size === 0) return
      // The two boards drawn before the art existed: the scene's own fallback
      // plate, and every module group already standing.
      refreshSignFaceMaterial(this.ctx.modelMats)
      if (this.ctx.stationData) this.modules.buildModules(this.ctx.stationData, new Set())
    })

    // Light rig: one key + ambient + a soft fill. §2.3 item 3.
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2f39, 1.15)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff3e0, 1.5)
    key.position.set(60, -80, 120)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.45)
    fill.position.set(-70, 60, 40)
    scene.add(fill)
    scene.add(new THREE.AmbientLight(0xffffff, 0.28))

    this.chunks = new ChunkSystem(this.ctx)
    this.plates = new PlateSystem(this.ctx)
    this.trains = new TrainSystem(this.ctx)
    this.lifts = new LiftSystem(this.ctx)
    this.crowd = new CrowdSystem(this.ctx)
    this.modules = new ModuleSystem(this.ctx)
    this.ghostSys = new GhostSystem(this.ctx)
    this.level = new LevelSystem(this.ctx)
    this.grid = new GridSystem(this.ctx)
    this.cameraSys = new CameraSystem(canvas, this.ctx, this.renderer)
    this.sectionSys = new SectionSystem(this.ctx)

    this.trains.level = this.level
    this.modules.trains = this.trains
    this.modules.lifts = this.lifts
    this.modules.crowd = this.crowd
    this.modules.plates = this.plates
    this.modules.ghost = this.ghostSys
    this.ghostSys.plates = this.plates
    this.ghostSys.modules = this.modules
    // The slice walks the chunk meshes (`outlineSet`, `levelGroups`) as well as
    // the fixtures and the trains, so all three have to be wired before the
    // first `applyLevel` — which `setStation` calls on the station's first build.
    this.level.chunks = this.chunks
    this.level.modules = this.modules
    this.level.trains = this.trains
    this.cameraSys.modules = this.modules
    this.sectionSys.chunks = this.chunks
    this.sectionSys.crowd = this.crowd
    this.sectionSys.modules = this.modules

    this.cameraSys.setPreset('iso')
    this.animate()
  }

  /* Compatibility with the old public surface. External code (Viewport, the
   * /lab page) only ever used methods, `keys` and `onStats`, but the fields
   * below were public, so they stay readable. */
  get scene(): THREE.Scene {
    return this.ctx.scene
  }

  get mats(): MaterialSet {
    return this.ctx.mats
  }

  get modelMats(): ModelMaterials {
    return this.ctx.modelMats
  }

  get solid(): Set<number> {
    return this.ctx.solid
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cameraSys.camera
  }

  get ortho(): THREE.OrthographicCamera {
    return this.cameraSys.ortho
  }

  get controls(): import('three/examples/jsm/controls/OrbitControls.js').OrbitControls {
    return this.cameraSys.controls
  }

  /** Keys held for WASD panning; the viewport keeps this in sync. */
  get keys(): Set<string> {
    return this.ctx.keys
  }

  /* ------------------------------------------------------------ station */

  setStation(data: StationData, trackCells: Set<number> = new Set()): void {
    this.chunks.prepareStation(data)
    this.ghostSys.clearModulePreview()
    // A 指示牌 prints the station's lines, so a line edit reprints every face
    // already hanging before the rebuild replaces them.
    this.plates.redrawSignPlates()
    this.chunks.meshStation(data)
    this.modules.buildModules(data, trackCells)
    this.grid.buildGrid()
    this.cameraSys.setPickables([...this.chunks.chunkMeshes, ...this.chunks.wallPick.children, ...this.lifts.liftPickMeshes])
    this.level.applyLevel()
    // A rebuild mints fresh chunk, crowd and module materials, which are not
    // clipped until this walks them again — and a cut that is on has to stay on.
    this.sectionSys.applyClip()
    // Rebuild the selection box against the freshly built modules, so an edit
    // does not drop the highlight.
    this.modules.refreshSelection()
    this.modules.refreshCollisionHighlight()
  }

  /**
   * The 剖切 surface a station defaults to: the middle of its plan, on the
   * storey being edited, facing +y — the fixed cut of the old toggle, now the
   * starting point the location box and the drag move away from. Called once
   * per station, so an edit never throws away the cut the player placed.
   */
  defaultSection(): Section {
    const b = this.ctx.bounds
    const anchor: [number, number, number] = Number.isFinite(b.min.x)
      ? [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, this.ctx.activeZ]
      : [0, 0, this.ctx.activeZ]
    return { anchor, orientation: { azimuth: 0, elevation: 0 }, offset: 0 }
  }

  /**
   * Highlight one placed module with a world-space box, or clear it with null.
   * The id is remembered, so a `setStation` rebuild re-finds the module.
   */
  setSelection(moduleId: string | null): void {
    this.modules.setSelection(moduleId)
  }

  /**
   * Highlight the placed modules a blocked preview collides with — the
   * offending pieces beside the red ghost itself. Ids are remembered, so a
   * `setStation` rebuild re-finds the modules. Pass null or an empty list to
   * clear.
   */
  setCollisionHighlight(moduleIds: readonly string[] | null): void {
    this.modules.setCollisionHighlight(moduleIds)
  }

  /**
   * The simulation clock, printed in the plate's information column. Called from
   * the worker's state frame. When the printed minute changes, every plate is
   * redrawn in place — the meshes keep their geometry and material, so nothing
   * rebuilds but the pixels.
   */
  setSimClock(simTime: number): void {
    this.plates.setSimClock(simTime)
  }

  setTrains(buffer: Float32Array): void {
    this.trains.setTrains(buffer)
  }

  setLifts(buffer: Float32Array): void {
    this.lifts.setLifts(buffer)
  }

  /* ------------------------------------------------------------- levels */

  setLevel(z: number, ghost: boolean): void {
    this.level.setLevel(z, ghost)
    this.grid.buildGrid()
  }

  /** 隐藏天花板: stop hiding the ceilings of the storey above the active one. */
  setAutoCeiling(on: boolean): void {
    this.level.setAutoCeiling(on)
  }

  /**
   * 剖切: the placed cut surface (`render/section.ts`). The plane is written in
   * place, so sliding the cut costs two numbers rather than a rebuild — but the
   * **materials** are only re-listed when the cut is switched on or off, which
   * is the only time the plane's membership changes.
   */
  setSection(section: Section, on: boolean): void {
    const wasOn = this.sectionSys.on
    this.sectionSys.setSection(section, on)
    if (wasOn !== on) this.sectionSys.applyClip()
  }

  /** The store's 剖切 flag, for callers that only carry the toggle. */
  setCutaway(on: boolean): void {
    this.setSection(this.ctx.section, on)
  }

  /** The section surface under the pointer — the handle a slide grabs. */
  sectionHit(clientX: number, clientY: number): boolean {
    return this.sectionSys.hit(clientX, clientY, this.renderer.domElement, this.cameraSys.activeCamera())
  }

  /** Where the pointer's ray meets the section plane, for a slide. */
  sectionPoint(clientX: number, clientY: number): [number, number, number] | null {
    return this.sectionSys.rayPoint(clientX, clientY, this.renderer.domElement, this.cameraSys.activeCamera())
  }

  setSectionHover(on: boolean): void {
    this.sectionSys.setHover(on)
  }

  /**
   * 隐藏UI: the drawing lattice and its cell cursor off the picture, and the
   * storey slice put away with them.
   *
   * One flag per system that owns a drawing, rather than a hard
   * `setGridVisible(false)` and a ghost material set on the rail's behalf: the
   * grid and the slice are the same picture seen twice, and one owner each keeps
   * them from disagreeing (`GridSystem`, `LevelSystem.setHideUI`).
   */
  setHideUI(on: boolean): void {
    this.grid.setHideUI(on)
    this.level.setHideUI(on)
  }

  /** 隐藏墙壁: fade every wall and platform screen door, or restore them. */
  setHideWalls(on: boolean): void {
    this.level.setHideWalls(on)
  }

  /* -------------------------------------------------------------- agents */

  setAgents(buffer: Float32Array, count: number, intervalMs: number): void {
    this.crowd.setAgents(buffer, count, intervalMs)
  }

  setDensity(nodes: Float32Array, density: Float32Array, on: boolean): void {
    this.crowd.setDensity(nodes, density, on)
  }

  setOverlayVisible(on: boolean): void {
    this.crowd.setOverlayVisible(on)
  }

  setZoneOverlay(
    quads: Float32Array,
    zones: Uint8Array,
    labels: Array<{ x: number; y: number; z: number; zone: number }>,
    on: boolean,
  ): void {
    this.crowd.setZoneOverlay(quads, zones, labels, on)
  }

  setAgentsVisible(on: boolean): void {
    this.crowd.setAgentsVisible(on)
  }

  /* ------------------------------------------------------------- camera */

  setPreset(name: 'iso' | 'plan' | 'front' | 'side' | 'custom'): void {
    this.cameraSys.setPreset(name)
  }

  setOrtho(on: boolean): void {
    this.cameraSys.setOrtho(on)
  }

  frame(): void {
    this.cameraSys.frame()
  }

  setViewDirection(dir: THREE.Vector3, useOrtho: boolean): void {
    this.cameraSys.setViewDirection(dir, useOrtho)
  }

  orbitBy(dxPx: number, dyPx: number): void {
    this.cameraSys.orbitBy(dxPx, dyPx)
  }

  /* -------------------------------------------------------------- ghosts */

  setCursor(cell: [number, number, number] | null, valid = true): void {
    this.grid.setCursor(cell, valid)
  }

  setGhost(
    cells: Array<[number, number, number]>,
    kind: 'add' | 'remove',
    colour = 0xff5d5d,
    thin?: ReadonlyMap<number, WallSide>,
  ): void {
    this.ghostSys.setGhost(cells, kind, colour, thin)
  }

  setFaceGhost(cells: Array<[number, number, number]>, face: Face, colour: number): void {
    this.ghostSys.setFaceGhost(cells, face, colour)
  }

  clearFaceGhost(): void {
    this.ghostSys.clearFaceGhost()
  }

  setModulePreview(mod: Module | readonly Module[] | null, blocked = false): void {
    this.ghostSys.setModulePreview(mod, blocked)
  }

  setFencePreview(mods: Module[] | null, blocked = false): void {
    this.ghostSys.setFencePreview(mods, blocked)
  }

  setGridVisible(on: boolean): void {
    this.grid.setGridVisible(on)
  }

  /* -------------------------------------------------------------- picking */

  pick(clientX: number, clientY: number, workPlaneZ: number): PickResult | null {
    return this.cameraSys.pick(clientX, clientY, workPlaneZ)
  }

  pickModule(clientX: number, clientY: number): string | null {
    return this.cameraSys.pickModule(clientX, clientY)
  }

  pickFacing(): [number, number] {
    return this.cameraSys.pickFacing()
  }

  zoneAt(clientX: number, clientY: number, workPlaneZ: number): [number, number, number] | null {
    return this.cameraSys.zoneAt(clientX, clientY, workPlaneZ)
  }

  /* --------------------------------------------------------------- loop */

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    const now = performance.now()
    const dt = this.lastFrame > 0 ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now
    this.cameraSys.panCamera(dt)
    if (this.cameraSys.controls.enabled) this.cameraSys.controls.update()
    this.crowd.renderAgents(now)
    this.trains.updateTrains(now, dt)
    this.lifts.updateLifts(now)
    this.lifts.updateEscalators(dt * (1000 / this.ctx.stateIntervalMs))
    this.crowd.updateGates(dt * (1000 / this.ctx.stateIntervalMs))
    this.plates.updateAdScreens(now)
    const cam = this.cameraSys.activeCamera()
    this.cameraSys.syncOrtho()
    this.renderer.render(this.ctx.scene, cam)
    this.frameCount++
    if (now - this.fpsTime > 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTime))
      this.frameCount = 0
      this.fpsTime = now
      this.onStats?.({
        fps: this.fps,
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls,
        agents: this.crowd.agentCount,
        lastChunkMs: this.ctx.lastChunkMs,
        chunks: this.chunks.chunkMeshes.length,
      })
    }
  }

  resize(w: number, h: number): void {
    this.cameraSys.resize(w, h)
  }

  dispose(): void {
    this.ctx.disposed = true
    this.cameraSys.dispose()
    this.chunks.disposeChunks()
    this.ghostSys.dispose()
    this.sectionSys.dispose()
    this.modules.disposeSelection()
    disposeModelMaterials(this.ctx.modelMats)
    this.ctx.ads.dispose()
    this.plates.clearTvPlates()
    this.plates.tvScreens.length = 0
    this.trains.dispose()
    this.crowd.dispose()
    this.renderer.dispose()
    void this.ctx.disposed
  }
}
