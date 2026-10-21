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
import { populationEdit, hasPresentationEdit } from '../../sim/populationEdit.ts'
import { STOREY_HEIGHT } from '../../sim/constants.ts'
import { RenderDemand } from '../renderDemand.ts'
import { geometryDetailReady } from '../geometryDetail.ts'
import type { GraphicsQuality } from '../detailPolicy.ts'
import type { TrainService } from '../../sim/trainSchedule.ts'
import { createMaterials, finishesInUse } from '../materials.ts'
import type { MaterialSet } from '../materials.ts'
import { createModelMaterials, disposeModelMaterials, refreshSignFaceMaterial } from '../models.ts'
import type { ModelMaterials } from '../models.ts'
import { createAdArt } from '../adArt.ts'
import { createLineMapArt } from '../lineMapArt.ts'
import { loadPictograms } from '../pictograms.ts'
import { addStationLights, applyStationRenderer, STATION_CLEAR } from './lightRig.ts'
import type { Cell, CellShape, Face, Module, StationData } from '../../sim/types.ts'
import { mountedSignBoards, signBoardsOf } from '../../sim/sign.ts'
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
import { RoadTrafficSystem } from './systems/RoadTrafficSystem.ts'
import { ClockSystem } from './systems/ClockSystem.ts'
import { SectionSystem } from './systems/SectionSystem.ts'
import { SkySystem } from './systems/SkySystem.ts'
import type { PickResult } from './systems/SceneSystem.ts'
import { DEFAULT_SECTION_AZIMUTH, sectionNormal } from '../section.ts'
import type { Section, Vec3 } from '../section.ts'

export type { PickResult, SceneStats }

export class SceneRenderer {
  renderer: THREE.WebGLRenderer
  onStats: ((s: SceneStats) => void) | null = null
  /**
   * The camera's own horizontal aim, notified when it changes: a wall-mounted
   * ghost takes the wall the camera is looking at (`autofaceWallMount`), so an
   * orbit has to re-aim the piece already under the pointer — the pointer never
   * moved, and the settings-driven refresh (`placementPreviewKey`) knows nothing
   * about the view. The step is the one `pickFacing` reports (piece → eye).
   */
  onCameraAim: ((facing: readonly [number, number]) => void) | null = null
  /** The aim last notified, so a still camera notifies nobody. */
  private lastAim: readonly [number, number] = [NaN, NaN]
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
  private roads: RoadTrafficSystem
  private clocks: ClockSystem
  private sectionSys: SectionSystem
  private sky: SkySystem
  private lastFrame = 0
  private frameCount = 0
  private fpsTime = 0
  private fps = 0
  private readonly demand = new RenderDemand()
  private playing = true
  private artReady = false
  private pendingBuildViews: StationData | null = null
  private readonly restoreFrame = (): void => { this.requestRender() }
  /** Actual GL submissions, independent of RAF cadence while retaining a still frame. */
  framesRendered = 0

  requestRender(): void { this.demand.invalidate() }

  /** Diagnostics compare actual rendering throughput with the same scene on every RAF. */
  setContinuousRendering(on: boolean): void {
    this.requestRender()
    this.demand.continuous = on
  }

  setStaticDetail(on: boolean): void {
    this.requestRender()
    this.ctx.detailEnabled = on
    this.modules.batches.detailEnabled = on
    this.crowd.applyDetail()
    this.ctx.levelKey = ''; this.level.applyLevel()
  }

  /** Compare fixture approximations while preserving the existing tree/tile detail policy. */
  setEquipmentDetail(on: boolean): void {
    this.requestRender()
    this.modules.batches.equipmentDetailEnabled = on
  }

  setGraphicsQuality(quality: GraphicsQuality): void {
    this.requestRender()
    this.ctx.graphicsQuality = quality
    this.modules.batches.graphicsQuality = quality
    // The crowd's Low LoD is a prepared second draw rather than a batch, so the
    // quality change has to reach the passengers as well as the fixtures.
    this.crowd.applyDetail()
    this.ctx.levelKey = ''; this.level.applyLevel()
  }
  /** The live animation-frame handle, so `dispose` can stop the loop it started. */
  private raf = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    applyStationRenderer(this.renderer)
    this.renderer.shadowMap.enabled = false
    canvas.addEventListener('webglcontextrestored', this.restoreFrame)
    this.renderer.localClippingEnabled = true

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(STATION_CLEAR, 120, 320)
    this.sky = new SkySystem(scene)

    const mats = createMaterials()
    const modelMats = createModelMaterials()
    // The station's ad artwork, one cache per scene so every screen shares a
    // texture per poster and nothing re-uploads on a rebuild. The JPEGs decode
    // in the background; until they land a 装饰 screen prints the placeholder
    // face, and `onReady` redraws the modules so every poster appears without a
    // reload — see `render/adArt.ts` for why the pixels are not loaded lazily.
    const ads = createAdArt(this.renderer)
    // The 线网图's poster, one cache per scene the same way: it decodes in the
    // background and `onReady` redraws the modules, so every map hangs the real
    // 线网示意图 without a reload. Until then each prints the **drawn placeholder board**
    // (`render/lineMapFace.ts`), because a material minted around an image-less texture
    // uploads empty and stays blank.
    const lineMaps = createLineMapArt(this.renderer)
    this.ctx = new SceneContextData(scene, mats, modelMats, ads, lineMaps)
    // Decode in parallel, then refresh the models once. Separate completion
    // callbacks rebuilt the entire station up to three times and could discard
    // views just prepared during opening.
    let artChanged = false
    void Promise.all([
      this.ctx.ads.load(() => { artChanged = true }),
      this.ctx.lineMaps?.load(() => { artChanged = true }),
      loadPictograms(),
      geometryDetailReady,
    ]).then(([, , icons]) => {
      if (this.ctx.disposed) return
      this.artReady = true
      if (icons.size > 0) refreshSignFaceMaterial(this.ctx.modelMats)
      if (this.ctx.stationData) {
        if (artChanged || icons.size > 0) this.modules.buildModules(this.ctx.stationData, new Set())
        else this.modules.batches.invalidateViews()
        this.ctx.levelKey = ''; this.level.applyLevel()
        this.requestRender()
      }
      const pending = this.pendingBuildViews
      this.pendingBuildViews = null
      if (pending && pending === this.ctx.stationData) this.prepareBuildViews()
    })

    // Light rig: one key + ambient + a soft fill. §2.3 item 3 — and the same call the
    // capture passes make, so the sheets photograph the light the player sees.
    addStationLights(scene)

    this.chunks = new ChunkSystem(this.ctx)
    this.plates = new PlateSystem(this.ctx)
    this.clocks = new ClockSystem(this.ctx)
    this.roads = new RoadTrafficSystem(this.ctx)
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
    this.modules.clocks = this.clocks
    this.modules.ghost = this.ghostSys
    this.ghostSys.plates = this.plates
    this.ghostSys.modules = this.modules
    this.ghostSys.level = this.level
    this.ghostSys.clocks = this.clocks
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
    // The cut and the slice are two halves of one picture while 剖切 is on: the
    // plane decides what is invisible, and the slice walk has to clip the ghost and
    // 隐藏墙壁 materials **derived** from the ones it hands over (`applyClip`).
    this.sectionSys.level = this.level

    this.cameraSys.setPreset('iso')
    this.animate()
  }

  /* Compatibility with the old public surface. External code (Viewport, the
   * /lab page) only ever used methods, `keys` and `onStats`, but the fields
   * below were public, so they stay readable. */
  get scene(): THREE.Scene {
    // Callers can attach/remove overlays through this compatibility surface.
    this.requestRender()
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

  /** Keys held for WASD panning and the Ctrl+Q/E vertical pan; the viewport keeps this in sync. */
  get keys(): Set<string> {
    return this.ctx.keys
  }

  /* ------------------------------------------------------------ station */

  setMovingModule(id: string | null): void {
    this.requestRender()
    this.ghostSys.movingModuleId = id
    this.modules.setMovingModule(id)
  }

  setStation(data: StationData, trackCells: Set<number> = new Set(), effective?: Cell[]): void {
    this.requestRender()
    const previousData = this.ctx.stationData
    this.modules.batches.invalidateViews()
    this.ctx.levelBase = data.levelBase ?? 0
    this.ctx.storeyHeight = data.storeyHeight ?? STOREY_HEIGHT
    // A sign-board preview changes no cell and no other module, so the chunks
    // this meshes are identical: only that sign's own model and plates are
    // rebuilt, and the chunk remesh plus the station-wide plate repaints are
    // skipped. A delete lands here too — it only takes marks off one board —
    // which is what keeps dragging a tile to the bin from freezing the modal.
    // Ordinary equipment has no chunk geometry. Functional machines/barriers
    // still update worker routing, while only changed or dependent models rebuild.
    // Anything else takes the full path below.
    const signOnly = this.modules.signBoardsOnlyChanged(data)
    const equipmentOnly = signOnly === null && this.modules.equipmentOnlyChanged(data)
    if (signOnly !== null || equipmentOnly) this.ctx.stationData = data
    else this.chunks.prepareStation(data, effective)
    // A painted colour the document no longer holds can go: each finish material
    // wraps a 128² canvas texture, and the colour picker hands out a new id per
    // shade, so a long painting session used to keep every shade it ever tried.
    this.ctx.mats.retain(finishesInUse(data))
    this.ghostSys.clearModulePreview()
    const retainedModules = this.modules.retainPaintedModules(data)
    // A 指示牌 prints the station's lines, so a line edit reprints every face
    // already hanging before the rebuild replaces them — and the two 装饰 pieces that
    // carry the station's own words, a 站名's name and a 线网图's network, are
    // reprinted for the same reason: a rename or a recoloured line reaches the wall.
    if (signOnly === null && !equipmentOnly && !retainedModules && !this.modules.hasSameMetadata(data)) {
      this.plates.redrawSignPlates(previousData ?? undefined)
      this.plates.redrawDecorPlates(previousData ?? undefined)
    }
    if (signOnly === null && !equipmentOnly) {
      this.chunks.meshStation()
    }
    if (!retainedModules) {
      this.modules.buildModules(
        data,
        trackCells,
        true,
        signOnly === null ? undefined : new Set(data.modules.map((m) => m.id).filter((id) => id !== signOnly)),
      )
    }
    // `meshStation` clears the level key because it rebuilds the meshes the slice
    // dresses; both fast paths above skip it, so clear it here instead — otherwise
    // the trailing `applyLevel` early-outs and neither new-group storey visibility
    // nor the cross-module batches (`syncBatches`) catch the added/removed groups.
    // A deleted shelf kept drawing its batched body until a reload for exactly this.
    if ((signOnly !== null || equipmentOnly) && !retainedModules) this.ctx.levelKey = ''
    if (signOnly !== null) this.repaintSignPreview(data, signOnly)
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
    this.modules.refreshHoverHighlight()
  }

  /** Nonstructural edits keep cache metadata current. Visible artwork repaints
   * its owned resources; invisible settings retain the framebuffer as well. */
  updatePopulationData(data: StationData): boolean {
    const previous = this.ctx.stationData
    const edit = previous && populationEdit(previous, data)
    if (edit && hasPresentationEdit(edit)) {
      const candidates = this.modules.presentationKeepIds(data)
      if (!candidates) return false
      this.ctx.stationData = data
      this.plates.redrawSignPlates(previous ?? undefined)
      this.plates.redrawDecorPlates(previous ?? undefined)
      const keep = this.modules.repaintPresentation(data,candidates)
      if (keep.size === data.modules.length) this.modules.updatePopulationData(data)
      else {
        this.modules.buildModules(data, new Set(), true, keep)
        this.ctx.levelKey = ''
        this.level.applyLevel()
        this.sectionSys.applyClip()
        this.modules.setMovingModule(this.ghostSys.movingModuleId)
        this.modules.refreshSelection()
        this.modules.refreshCollisionHighlight()
        this.modules.refreshHoverHighlight()
      }
      this.plates.refreshSettings()
      this.requestRender()
      return true
    }
    if (!this.modules.updatePopulationData(data)) return false
    this.ctx.stationData = data
    if (edit && (edit.settings || edit.headways)) {
      this.plates.refreshSettings()
      this.requestRender()
    }
    return true
  }

  /**
   * Repaint the one sign a boards-only change belongs to, after its model was
   * rebuilt. The model carries the new panel size; this repaints the retained
   * same-size plates with the new boards, so a reorder — or a delete that keeps
   * the panel — mints no new canvas.
   */
  private repaintSignPreview(data: StationData, signId: string): void {
    const mod = data.modules.find((m) => m.id === signId)
    if (!mod || mod.type !== 'sign') return
    const boards = mountedSignBoards(mod.cfg.mount, signBoardsOf(mod.cfg, data))
    this.plates.repaintSignPreview(signId, boards, data.lines)
  }

  /**
   * The 剖切 surface a station defaults to: the middle of its plan, on the
   * storey being edited, looking +y — the fixed cut of the old toggle, now the
   * starting point the drag slides away from. Called once per station, so an edit
   * never throws away the cut the player placed.
   */
  defaultSection(): Section {
    const b = this.ctx.bounds
    const anchor: [number, number, number] = Number.isFinite(b.min.x)
      ? [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, this.ctx.activeZ]
      : [0, 0, this.ctx.activeZ]
    return { anchor, orientation: { azimuth: DEFAULT_SECTION_AZIMUTH }, offset: 0 }
  }

  /**
   * Highlight one placed module with a world-space box, or clear it with null.
   * The id is remembered, so a `setStation` rebuild re-finds the module.
   */
  setSelection(moduleId: string | null): void {
    this.requestRender()
    this.modules.setSelection(moduleId)
  }

  /** Blue outline for the equipment currently under a tool pointer. */
  setHoverHighlight(moduleId: string | null): void {
    this.requestRender()
    this.modules.setHoverHighlight(moduleId)
  }

  /**
   * Highlight the placed modules a blocked preview collides with — the
   * offending pieces beside the red ghost itself. Ids are remembered, so a
   * `setStation` rebuild re-finds the modules. Pass null or an empty list to
   * clear.
   */
  setCollisionHighlight(moduleIds: readonly string[] | null): void {
    this.requestRender()
    this.modules.setCollisionHighlight(moduleIds)
  }

  /**
   * The simulation clock, printed in the plate's information column and **pointed at** by
   * every 时钟's hands. Called from the worker's state frame. When the printed minute changes,
   * every plate is redrawn in place — the meshes keep their geometry and material, so nothing
   * rebuilds but the pixels — while the hands are swept between snapshots every frame.
   */
  setSimClock(simTime: number, services: TrainService[] = []): void {
    this.requestRender()
    this.sky.setSimTime(simTime)
    this.plates.setSimClock(simTime, services)
    this.clocks.setSimTime(simTime)
    this.roads.setSimTime(simTime)
  }

  setTrains(buffer: Float32Array): void {
    this.requestRender()
    this.trains.setTrains(buffer)
  }

  setLifts(buffer: Float32Array): void {
    this.requestRender()
    this.lifts.setLifts(buffer)
  }

  /* ------------------------------------------------------------- levels */

  setLevel(z: number, ghost: boolean): void {
    this.requestRender()
    this.level.setLevel(z, ghost)
    this.grid.buildGrid()
  }

  /** Opening work only: prepare both Q/E neighbours of the actual editing storey. */
  prepareBuildViews(): void {
    this.requestRender()
    if (!this.artReady) {
      this.pendingBuildViews = this.ctx.stationData
      return
    }
    if (this.ctx.cutaway || this.ctx.hideUI || this.chunks.levelGroups.size === 0) return
    // Populate the renderer's buffer/program caches too. A tiny offscreen target
    // uploads the exact visible batches without presenting temporary storeys.
    const target = new THREE.WebGLRenderTarget(1, 1)
    const previous = this.renderer.getRenderTarget()
    try {
      this.renderer.setRenderTarget(target)
      this.level.prepareAdjacentViews(() => {
        const camera = this.cameraSys.activeCamera()
        camera.updateMatrixWorld()
        this.modules.batches.updateDetail(camera, this.renderer.domElement.clientHeight)
        this.renderer.render(this.ctx.scene, camera)
        this.framesRendered++
      })
    } finally {
      this.renderer.setRenderTarget(previous)
      target.dispose()
    }
  }

  /** 隐藏天花板: stop hiding the ceilings of the storey above the active one. */
  setAutoCeiling(on: boolean): void {
    this.requestRender()
    this.level.setAutoCeiling(on)
  }

  setHideRoof(on: boolean): void {
    this.requestRender()
    this.level.setHideRoof(on)
  }

  /**
   * 剖切: the placed cut surface (`render/section.ts`). The plane is written in
   * place, so sliding the cut costs two numbers rather than a rebuild — but the
   * **materials** are only re-listed when the cut is switched on or off, which
   * is the only time the plane's membership changes.
   */
  setSection(section: Section, on: boolean): void {
    this.requestRender()
    const wasOn = this.sectionSys.on
    this.sectionSys.setSection(section, on)
    if (wasOn !== on) this.sectionSys.applyClip()
  }

  /**
   * 隐藏剖切面: keep the clip, put the section's own drawing away — the sheet,
   * its border and grid, and the direction arrow (`SectionSystem`). With it off
   * there is nothing to grab, so the surface stops taking the pointer too.
   */
  setSectionSurface(on: boolean): void {
    this.requestRender()
    this.sectionSys.setSurfaceVisible(on)
  }

  /**
   * The store's 剖切 flag, for callers that only carry the toggle. It reaches the
   * **storey walk** as well as the clip, because while a cut is on the slice is put
   * away: Q/E stop choosing a storey to ghost (`levelSlicing.sliceOptions` takes the
   * cut), so the only thing hiding any of the station is the plane — and the walk is
   * what restates the plane on the materials it derives from the clipped ones.
   */
  setCutaway(on: boolean): void {
    this.requestRender()
    if (this.level.cutaway === on) return
    this.level.setCutaway(on)
    // The walk has just dressed every mesh again, so the clip has to be re-stated
    // over the result: the plane decides what is invisible, not the slice.
    this.sectionSys.applyClip()
  }

  /** The section surface under the pointer — the handle a slide grabs. */
  sectionHit(clientX: number, clientY: number): boolean {
    return this.sectionSys.hit(clientX, clientY, this.renderer.domElement, this.cameraSys.activeCamera())
  }

  /** Where the pointer's ray meets the section plane, for a slide. */
  sectionPoint(clientX: number, clientY: number): [number, number, number] | null {
    return this.sectionSys.rayPoint(clientX, clientY, this.renderer.domElement, this.cameraSys.activeCamera())
  }

  /**
   * The cut's axis as the drag needs it: the direction it slides, in **canvas
   * pixels per metre**, so the pointer's travel on screen can be read as metres
   * of cut.
   *
   * This is what makes the mouse do exactly one thing. The pointer is measured
   * along this screen line, and a step across it counts for nothing, so the cut
   * only ever moves the way `R`'s turn points it — no reading a sideways drag as
   * a slide just because the camera happens to be oblique. The span is a length,
   * so a drag feels the same in a plan as in a corner isometric.
   *
   * A zero-length axis means the cut slides straight at the camera: there is no
   * screen direction that moves it, so the drag stands still rather than running
   * away (`app/Viewport.tsx` gives up on the grab).
   */
  sectionDragAxis(): { axis: [number, number]; span: number } {
    const n = sectionNormal(this.ctx.section.orientation)
    const c = this.ctx.bounds.getCenter(new THREE.Vector3())
    const origin: Vec3 = [c.x, c.y, c.z]
    const a = this.sectionScreenPoint(origin)
    const b = this.sectionScreenPoint([origin[0] + n[0], origin[1] + n[1], origin[2] + n[2]])
    if (!a || !b) return { axis: [0, 0], span: 0 }
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const span = Math.hypot(dx, dy)
    if (span < 1e-6) return { axis: [0, 0], span: 0 }
    return { axis: [dx / span, dy / span], span }
  }

  /** A station-space point in canvas-relative CSS pixels, or null behind the camera. */
  private sectionScreenPoint(point: Vec3): [number, number] | null {
    const v = new THREE.Vector3(point[0], point[1], point[2]).project(this.cameraSys.activeCamera())
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
    const size = this.renderer.getSize(new THREE.Vector2())
    return [((v.x + 1) / 2) * size.x, ((1 - v.y) / 2) * size.y]
  }

  setSectionHover(on: boolean): void {
    this.requestRender()
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
    this.requestRender()
    this.grid.setHideUI(on)
    this.level.setHideUI(on)
    // Hide UI is the presentation mode: it always restores full bodies.
    this.crowd.applyDetail()
  }

  /** 隐藏墙壁: fade every wall and platform screen door, or restore them. */
  setHideWalls(on: boolean): void {
    this.requestRender()
    this.level.setHideWalls(on)
  }

  /**
   * 隐藏地面: draw the street plane, or take it away. It reaches the storey walk
   * and nothing else: the street is meshed as its own pass
   * (`ChunkSystem.meshStation`), so the toggle is a `visible` flag on meshes that
   * already exist — no rebuild, no document write, and the walk graph is
   * untouched (`sim/ground.ts` still walks the same window).
   */
  setHideGround(on: boolean): void {
    this.requestRender()
    this.level.setHideGround(on)
  }

  /* -------------------------------------------------------------- agents */

  setAgents(buffer: Float32Array, count: number, intervalMs: number): void {
    this.requestRender()
    this.crowd.setAgents(buffer, count, intervalMs)
  }

  setPlaying(on: boolean): void {
    this.requestRender()
    this.playing = on
    this.crowd.setPlaying(on)
    this.lifts.setPlaying(on)
    this.trains.setPlaying(on)
  }

  setDensity(nodes: Float32Array, density: Float32Array, on: boolean): void {
    this.requestRender()
    this.crowd.setDensity(nodes, density, on)
  }

  setOverlayVisible(on: boolean): void {
    this.requestRender()
    this.crowd.setOverlayVisible(on)
  }

  /** 区域 map visibility alone, so an unchanged map is not rebuilt to show it. */
  setZoneOverlayVisible(on: boolean): void {
    this.requestRender()
    this.crowd.setZoneOverlayVisible(on)
  }

  setZoneOverlay(
    quads: Float32Array,
    zones: Uint8Array,
    labels: Array<{ x: number; y: number; z: number; zone: number; label?: string }>,
    on: boolean,
  ): void {
    this.requestRender()
    this.crowd.setZoneOverlay(quads, zones, labels, on)
  }

  setAgentsVisible(on: boolean): void {
    this.requestRender()
    this.crowd.setAgentsVisible(on)
  }

  /**
   * The 选择 tool's route preview: one passenger's remaining walk as xyz
   * waypoints, drawn as a light-blue line on the floor (`CrowdSystem.setRoute`).
   */
  setRoute(points: Float32Array, agentId: number): void {
    this.requestRender()
    this.crowd.setRoute(points, agentId)
  }

  /**
   * The passenger under the pointer, or null. The solid face the same ray finds is
   * what the pick has to see past — a person behind a wall is not on screen — so
   * the blocker's distance is measured here, where the camera is.
   */
  pickAgent(clientX: number, clientY: number): number | null {
    const hit = this.pick(clientX, clientY, this.ctx.activeZ)
    const cam = this.cameraSys.activeCamera()
    const blocker = hit && hit.solid
      ? Math.hypot(hit.point[0] - cam.position.x, hit.point[1] - cam.position.y, hit.point[2] - cam.position.z)
      : Infinity
    const id = this.crowd.pickAgent(clientX, clientY, cam, this.renderer.domElement.getBoundingClientRect(), blocker)
    return id >= 0 ? id : null
  }

  /* ------------------------------------------------------------- camera */

  setPreset(name: 'iso' | 'plan' | 'front' | 'side' | 'custom'): void {
    this.requestRender()
    this.cameraSys.setPreset(name)
  }

  setOrtho(on: boolean): void {
    this.requestRender()
    this.cameraSys.setOrtho(on)
  }

  frame(): void {
    this.cameraSys.frame()
  }

  setViewDirection(dir: THREE.Vector3, useOrtho: boolean): void {
    this.requestRender()
    this.cameraSys.setViewDirection(dir, useOrtho)
  }

  zoomBy(factor: number): void {
    this.cameraSys.zoomBy(factor)
  }

  orbitBy(dxPx: number, dyPx: number): void {
    this.cameraSys.orbitBy(dxPx, dyPx)
  }

  /** The perspective lens, in degrees (`CameraSystem.fov`). */
  fov(): number {
    return this.cameraSys.fov()
  }

  /** Set the perspective lens, in degrees; the flat ortho views are unaffected. */
  setFov(deg: number): void {
    this.requestRender()
    this.cameraSys.setFov(deg)
  }

  /* -------------------------------------------------------------- ghosts */

  setCursor(cell: [number, number, number] | null, valid = true): void {
    this.requestRender()
    this.grid.setCursor(cell, valid)
  }

  setGhost(
    cells: Array<[number, number, number]>,
    kind: 'add' | 'remove',
    colour = 0xff5d5d,
    thin?: ReadonlyMap<number, CellShape>,
    refused?: ReadonlyArray<[number, number, number]>,
  ): void {
    this.requestRender()
    this.ghostSys.setGhost(cells, kind, colour, thin, refused)
  }

  setFaceGhost(cells: Array<[number, number, number]>, face: Face, colour: number): void {
    this.requestRender()
    this.ghostSys.setFaceGhost(cells, face, colour)
  }

  clearFaceGhost(): void {
    this.requestRender()
    this.ghostSys.clearFaceGhost()
  }

  setModulePreview(mod: Module | readonly Module[] | null, blocked = false, tintOverride?: number): void {
    this.requestRender()
    this.ghostSys.setModulePreview(mod, blocked, tintOverride)
  }
  setRoadNodePreview(nodes:readonly {x:number;y:number;z:number}[],from?:[number,number],to?:[number,number],z=this.ctx.activeZ):void {
    this.requestRender()
    this.ghostSys.setRoadNodePreview(nodes,from,to,z)
  }

  setFencePreview(mods: Module[] | null, blocked = false): void {
    this.requestRender()
    this.ghostSys.setFencePreview(mods, blocked)
  }

  setGridVisible(on: boolean): void {
    this.requestRender()
    this.grid.setGridVisible(on)
  }

  /* -------------------------------------------------------------- picking */

  pick(clientX: number, clientY: number, workPlaneZ: number): PickResult | null {
    return this.cameraSys.pick(clientX, clientY, workPlaneZ)
  }

  pickHorizontalPlane(clientX: number, clientY: number, height: number, anchorZ: number): PickResult | null {
    return this.cameraSys.pickHorizontalPlane(clientX, clientY, height, anchorZ)
  }

  pickModule(clientX: number, clientY: number, psdCoverSupport = false): string | null {
    return this.cameraSys.pickModule(clientX, clientY, psdCoverSupport)
  }

  pickModuleSurface(clientX: number, clientY: number): { moduleId: string; normal: [number, number, number] } | null {
    const hit = this.cameraSys.pickModuleSurfaceHit(clientX, clientY)
    return hit ? { moduleId: hit.moduleId, normal: hit.normal } : null
  }

  pickModuleInBounds(clientX: number, clientY: number, moduleIds: ReadonlySet<string>): string | null {
    return this.cameraSys.pickModuleInBounds(clientX, clientY, moduleIds)
  }

  /** Whether a document module is currently shown by level and view visibility. */
  isModuleVisible(id: string): boolean {
    return this.modules.isModuleVisible(id)
  }

  pickModuleHit(clientX: number, clientY: number): { moduleId: string; point: [number, number, number] } | null {
    return this.cameraSys.pickModuleHit(clientX, clientY)
  }

  pickRoofModuleNear(clientX: number, clientY: number, moduleIds: ReadonlySet<string>, radiusPx = 24): { moduleId: string; point: [number, number, number] } | null {
    return this.cameraSys.pickRoofModuleNear(clientX, clientY, moduleIds, radiusPx)
  }

  pickFacing(): [number, number] {
    return this.cameraSys.pickFacing()
  }

  zoneAt(clientX: number, clientY: number, workPlaneZ: number): [number, number, number] | null {
    return this.cameraSys.zoneAt(clientX, clientY, workPlaneZ)
  }

  /* --------------------------------------------------------------- loop */

  followPassenger(id: number | null, onLost?: () => void): void {
    this.requestRender()
    this.crowd.followAgentId = id
    this.crowd.onFollowLost = onLost
    if (id === null) {
      this.crowd.onEyePose = undefined
      this.cameraSys.endEyeView()
    } else {
      this.cameraSys.beginEyeView()
      this.crowd.onEyePose = (x, y, z, yaw) => this.cameraSys.setEyePose(x, y, z, yaw)
    }
  }

  private animate = (): void => {
    // A disposed renderer must not keep drawing: the loop used to run for the rest
    // of the session after `dispose()` (an unmount, an HMR reload, the /lab page
    // closing), re-creating GPU resources on a renderer that had just released them.
    if (this.ctx.disposed) return
    this.raf = requestAnimationFrame(this.animate)
    const now = performance.now()
    const dt = this.lastFrame > 0 ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now
    this.cameraSys.panCamera(dt)
    this.cameraSys.panCameraVertical(dt)
    if (this.cameraSys.controls.enabled) this.cameraSys.controls.update()
    this.cameraSys.syncOrtho()
    if (this.plates.updateAdScreens(now)) this.requestRender()
    const cam = this.cameraSys.activeCamera()
    cam.updateMatrixWorld()
    this.notifyCameraAim()
    // Snapshots, fades and cabins finish interpolating after pause. All other
    // edits/ghosts/async art invalidate explicitly; still frames retain the GL buffer.
    const animating = this.playing || now < this.ctx.lastStateTime + this.ctx.stateIntervalMs
    if (this.demand.needsFrame(cam.matrixWorld.elements, cam.projectionMatrix.elements, animating)) {
      this.crowd.renderAgents(now, this.cameraSys.activeCamera())
      this.trains.updateTrains(now, dt)
      this.trains.updateGeometryDetail()
      this.lifts.updateLifts(now)
      this.lifts.updateEscalators(dt * (1000 / this.ctx.stateIntervalMs))
      this.crowd.updateGates(dt * (1000 / this.ctx.stateIntervalMs))
      this.modules.batches.atlas.update()
      this.clocks.updateClocks(now)
      this.roads.update(now, this.modules.moduleMeshes, this.sectionSys.on ? this.sectionSys.plane : null)
      this.cameraSys.syncOrtho()
      this.notifyCameraAim()
      this.sky.update(this.ctx.hideUI)
      // Following a passenger may update or leave eye view during renderAgents.
      // Sort transparent instances and choose detail against that final camera.
      const drawCamera = this.cameraSys.activeCamera()
      drawCamera.updateMatrixWorld()
      this.modules.batches.updateDetail(drawCamera, this.renderer.domElement.height / this.renderer.getPixelRatio())
      this.renderer.render(this.ctx.scene, drawCamera)
      this.framesRendered++
    }
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

  /**
   * Hand the camera's aim to `onCameraAim` when it really moved. The tolerance is
   * a thousandth of a unit of the view direction: the aim drifts in its last
   * decimals while the controls settle (`OrbitControls.update` re-derives the
   * camera every frame), and re-aiming a ghost on every one of those would rebuild
   * the piece 60 times a second for nothing.
   */
  private notifyCameraAim(): void {
    if (!this.onCameraAim) return
    const aim = this.cameraSys.pickFacing()
    if (Math.abs(aim[0] - this.lastAim[0]) <= 1e-3 && Math.abs(aim[1] - this.lastAim[1]) <= 1e-3) return
    this.lastAim = aim
    this.onCameraAim(aim)
  }

  resize(w: number, h: number): void {
    this.requestRender()
    this.cameraSys.resize(w, h)
  }

  dispose(): void {
    this.ctx.disposed = true
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.restoreFrame)
    cancelAnimationFrame(this.raf)
    this.cameraSys.dispose()
    this.sky.dispose()
    this.chunks.disposeChunks()
    this.ghostSys.dispose()
    this.grid.dispose()
    this.sectionSys.dispose()
    this.modules.disposeSelection()
    // The module groups, the plates they carry and the builder-minted materials go
    // first (teardown keeps nothing), then the shared kit, then the finish set —
    // whose every material wraps a canvas texture of its own.
    this.modules.clearModules()
    disposeModelMaterials(this.ctx.modelMats)
    this.ctx.ads.dispose()
    this.ctx.lineMaps?.dispose()
    this.plates.clearTvPlates()
    this.plates.clearSignPlates()
    this.plates.clearDecorPlates()
    this.plates.tvScreens.length = 0
    this.ctx.mats.dispose()
    this.roads.dispose()
    this.trains.dispose()
    this.crowd.dispose()
    this.renderer.dispose()
    void this.ctx.disposed
  }
}
