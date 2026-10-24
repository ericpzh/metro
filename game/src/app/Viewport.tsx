import {gameAudio} from './gameAudio.ts'
import {actionSound} from './audioActions.ts'
import {getAudioVolumes,subscribeAudioVolumes} from './audioSettings.ts'
import { TouchZoom } from './touchZoom.ts'
import { placementSurface } from './tools/placementSurface.ts'
import { clearToolPreview } from './tools/clearPreview.ts'
import { populationEdit } from '../sim/populationEdit.ts'
import { FrameTask } from './frameTask.ts'
import { translate } from '../sim/i18n.ts'
import { useLanguage } from './i18n.ts'
// The viewport: owns the SceneRenderer lifecycle and dispatches pointer input
// to the active tool controller. Panels stay in React; only this file (and the
// controllers it dispatches to) touches three directly.
//
// Pointer logic lives in app/tools/* — one ToolController subclass per tool
// (plan.md Lane C, R4). This file keeps the renderer boot, the station/overlay
// effects, the keyboard shortcuts, the cross-tool cancel guards, and the
// release routing; the per-tool press/move/release bodies moved verbatim into
// their controllers (GAME-SPEC §9.5 gestures).

import { useEffect, useMemo, useRef, useState } from 'react'
import { TfiHandDrag } from 'react-icons/tfi'
import { TbBulldozer } from 'react-icons/tb'
import { CgColorPicker } from 'react-icons/cg'
import { SceneRenderer, PAN_DOWN, PAN_UP, type PickResult } from '../render/scene.ts'
import { removeFloor, toData, zoneMapFloorsAt, zoneRegionLabels } from '../build/model.ts'
import { StationGeometry } from './stationGeometry.ts'
import { trussRoofTop } from '../sim/structures.ts'
import type { CellShape } from '../sim/types.ts'
import { zoneDisplayIndexOf } from '../sim/zones.ts'
import { dragOffset, snapOffset, walkAlong } from '../render/section.ts'
import { placementPreviewKey, selectSimAgent, setFrameHandler, setRouteHandler, signModuleWithPreview, useStore, type Tool } from './store.ts'
import { ViewCube } from './ViewCube.tsx'
import { goHomeView } from './viewHome.ts'
import { BlockTool } from './tools/BlockTool.ts'
import { DeleteTool } from './tools/DeleteTool.ts'
import { EquipmentTool } from './tools/EquipmentTool.ts'
import { MoveController } from './tools/MoveController.ts'
import { PaintTool } from './tools/PaintTool.ts'
import { PickTool } from './tools/PickTool.ts'
import { PlatformTool } from './tools/PlatformTool.ts'
import { SelectTool } from './tools/SelectTool.ts'
import { TunnelTool } from './tools/TunnelTool.ts'
import { WallTool } from './tools/WallTool.ts'
import { ownsContextMenu } from './tools/geometry/pointer.ts'
import { ZoneTool } from './tools/ZoneTool.ts'
import { ToolController } from './tools/ToolController.ts'
import type { AreaDrag, HoverTile, PaintDrag, PointerInfo, ToolContext, ZoneDragState } from './tools/ToolContext.ts'

/** The 方块 (block) tool's live patch size, shown beside the pointer in metres. */
interface BuildMeasure {
  left: number
  top: number
  text: string
}

interface PointerPosition {
  left: number
  top: number
}

/**
 * Whether a key event belongs to a text field rather than to the game. A button
 * is deliberately **not** one: the build rail and the view toggles are all
 * `button`s, and a keydown aimed at a focused button is the game's key, not the
 * field's. (The browser still activates a focused button on Space and Enter,
 * which is why `App` blurs the button on a Space press — but that is about the
 * *click*, never about the key reaching the game.)
 * Exported so `windows/AppShell.tsx`'s global shortcuts use one definition of
 * "this key is for a text field".
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

export function Viewport(): React.ReactElement {
  const language = useLanguage()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerFrame = useRef(new FrameTask())
  const sceneRef = useRef<SceneRenderer | null>(null)
  const overlayRef = useRef(false)
  const graphNodesRef = useRef<Float32Array>(new Float32Array(0))
  /** Solid cell keys, refreshed with the station, so a drag can tell blocks from void. */
  const solidRef = useRef<Set<string>>(new Set())
  const geometryRef = useRef(new StationGeometry())
  /**
   * The keys of the cells a **zone may be painted on** — the station's floor, by
   * the same rule the 分区 map draws with (`zoneFloorKeys`), refreshed with the
   * station beside `solidRef`. A zone belongs to a floor cell (§4.5), so the 分区
   * brush asks this rather than "is there a block here": a wall coping, a ceiling
   * and the earth over a tunnel are solid and are not floor.
   */
  const floorRef = useRef<Set<string>>(new Set())
  /**
   * Every cell of the station that draws **half a block thick** — a 半墙 the player
   * laid and every block a ramp kept beside its run — by cell key → the side the
   * panel hugs, refreshed with the station. A paint brush reads it to offer the
   * panel's own inner face, which is a surface inside its cell rather than on the
   * cell's boundary (`faceTargets`); without the derived ones a stair's own half
   * wall was a surface the brush would not colour.
   */
  const thinRef = useRef<Map<string, CellShape>>(new Map())
  /** True once the first station build has framed the home view (refresh only, not edits). */
  const framedRef = useRef(false)
  /**
   * The last `stationEpoch` the home view was applied to. A switch (打开 /
   * 示例车站 / 新建) moves the epoch, so the rebuild below runs home against
   * the fresh bounds; an edit keeps it, so the camera stays put.
   */
  const homeEpochRef = useRef(-1)
  /**
   * True once the first station build has placed the 剖切 surface. A station
   * switch puts it back (`initSim` reloads the document but this is the only
   * place that knows the new station's own extents), while an edit leaves it
   * where the player put it.
   */
  const sectionSeededRef = useRef(false)
  /**
   * The tile under the pointer for the equipment and 方块 tools, so R and Tab can
   * rebuild the ghost already under it (`refreshHover`).
   */
  const hoverRef = useRef<HoverTile | null>(null)
  const dragRef = useRef<AreaDrag | null>(null)
  /** The paint tool's own drag: press a face, drag a rectangle on its plane. */
  const paintRef = useRef<PaintDrag | null>(null)
  /** The zone tool's rectangle drag: a floor label or counter module. */
  const zoneDragRef = useRef<ZoneDragState | null>(null)
  /**
   * The 剖切 slide in progress: where on screen the grab started, the offset it
   * started from, and the cut's own axis projected onto the screen — the line the
   * pointer is measured along. The axis is taken **once**, at the press
   * (`SceneRenderer.sectionDragSpan`), so a slide can never re-aim itself
   * mid-drag: the cut only ever moves the way (R) has set.
   */
  const sectionDragRef = useRef<{ startX: number; startY: number; startOffset: number; axis: [number, number]; span: number } | null>(
    null,
  )
  /** True while the pointer is on the section surface, for the hover read. */
  const sectionHotRef = useRef(false)
  /**
   * The fingerprint of the 区域 map currently built (`buildZoneOverlay`), so the
   * effect that runs on every commit can leave an unchanged map alone.
   */
  const zoneKeyRef = useRef('')

  /** The 方块 tool's pending patch size, pinned to the pointer while previewing. */
  const [buildMeasure, setBuildMeasure] = useState<BuildMeasure | null>(null)
  const [movePointer, setMovePointer] = useState<PointerPosition | null>(null)
  const [deletePointer, setDeletePointer] = useState<PointerPosition | null>(null)
  const [pickerPointer, setPickerPointer] = useState<PointerPosition | null>(null)
  const activeTool = useStore((state) => state.tool)

  useEffect(() => {
    sceneRef.current?.setHoverHighlight(null)
  }, [activeTool])
  /** The pointer is on the 剖切 surface: the crosshair becomes a grab hand. */
  const [sectionHot, setSectionHot] = useState(false)

  // The shared controller contract (Lane C step 0): the scene, the picks, the
  // refs above, and the patch-size badge. Stable for the component's lifetime,
  // so the controllers below are built once.
  const ctx: ToolContext = useMemo(
    () => ({
      scene: () => sceneRef.current,
      pick: (clientX, clientY) => sceneRef.current?.pick(clientX, clientY, useStore.getState().activeZ) ?? null,
      pickModule: (clientX, clientY, psdCoverSupport) => sceneRef.current?.pickModule(clientX, clientY, psdCoverSupport) ?? null,
      pickModuleSurface: (clientX, clientY) => sceneRef.current?.pickModuleSurface(clientX, clientY) ?? null,
      facing: () => sceneRef.current?.pickFacing(),
      solids: () => solidRef.current,
      floors: () => floorRef.current,
      thins: () => thinRef.current,
      hover: hoverRef,
      drag: dragRef,
      paint: paintRef,
      zoneDrag: zoneDragRef,
      showMeasure: (clientX, clientY, text) => {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        setBuildMeasure({ left: clientX - rect.left, top: clientY - rect.top, text })
      },
      clearMeasure: () => setBuildMeasure(null),
    }),
    [],
  )

  const tools = useMemo(() => {
    const select = new SelectTool(ctx)
    const pick = new PickTool(ctx)
    const block = new BlockTool(ctx)
    const wall = new WallTool(ctx)
    const del = new DeleteTool(ctx)
    const equipment = new EquipmentTool(ctx)
    const paint = new PaintTool(ctx)
    const zone = new ZoneTool(ctx)
    const platform = new PlatformTool(ctx)
    const tunnel = new TunnelTool(ctx)
    const move = new MoveController(ctx)
    const byTool: Record<Tool, ToolController> = {
      select,
      pick,
      move,
      block,
      wall,
      delete: del,
      module: equipment,
      paint,
      zone,
      rail: platform,
      tunnel,
    }
    return { select, pick, block, wall, delete: del, equipment, paint, zone, platform, tunnel, move, byTool }
  }, [ctx])
  useEffect(() => () => {
    pointerFrame.current.cancel()
    tools.block.cancelPreview()
  }, [tools])

  const version = useStore((s) => s.version)
  const geometryVersion = useStore((s) => s.geometryVersion)
  const station = useStore((s) => s.station)
  const stationEpoch = useStore((s) => s.stationEpoch)
  // A 指示牌 whose board the editor has open draws the board being arranged, not the
  // one committed (`signModuleWithPreview`). Subscribing to the id rather than to the
  // whole preview keeps this from re-rendering the viewport on every dragged bin.
  // `signVersion` is the preview's own redraw counter, watched by the rebuild effect
  // below: a preview still redraws through `setStation` (a board can resize the
  // panel), but it is not a document edit, so it must not ride on `version` — that
  // is the counter every other reader of the document keys off, the undo stack
  // included. See `SignSlice.signVersion`.
  const signPreviewId = useStore((s) => s.signPreview?.moduleId ?? null)
  const signVersion = useStore((s) => s.signVersion)
  // The piece in the air (移动), by id: the station is drawn without it, so the
  // translucent ghost under the pointer is the only copy on screen. Subscribing to
  // the id — rather than to the whole draft — keeps a pointer move from rebuilding
  // the station's meshes.
  const moveId = useStore((s) => s.moveDraft?.module.id ?? null)
  // The carried piece and its rotation: the two things an R or a fresh lift change
  // about the ghost, so they are all the ghost effect has to watch.
  const moveKey = useStore((s) => (s.moveDraft ? `${s.moveDraft.module.id}|${s.moveDraft.rot}|${s.moveDraft.module.type === 'light' ? s.moveDraft.module.cfg.position ?? 0 : ''}` : ''))
  const tool = useStore((s) => s.tool)
  // Everything the equipment ghost is drawn from, as one key: the piece, its
  // rotation and each Tab cycle. Subscribing to the key — rather than to the
  // fields — is what lets R and Tab redraw a ghost that is already under the
  // pointer, and it keeps the list in one place (`placementPreviewKey`).
  const placementKey = useStore(placementPreviewKey)
  const facilityRot = useStore((s) => s.facilityRot)
  const railRot = useStore((s) => s.railRot)
  const railLineId = useStore((s) => s.railLineId)
  const railDir = useStore((s) => s.railDir)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const activeZ = useStore((s) => s.activeZ)
  const graphicsQuality = useStore((s) => s.graphicsQuality)
  const edgeScrolling = useStore((s) => s.edgeScrolling)
  const ghostOther = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
  const cutaway = useStore((s) => s.cutaway)
  const hideSectionSurface = useStore((s) => s.hideSectionSurface)
  const section = useStore((s) => s.section)
  const hideWalls = useStore((s) => s.hideWalls)
  const hideGround = useStore((s) => s.hideGround)
  const hideRoof = useStore((s) => s.hideRoof)
  const exploded = useStore((s) => s.explodedView)
  useEffect(() => { sceneRef.current?.setSuspended(exploded) }, [exploded])
  const followAgentId = useStore((s) => s.followAgentId)
  const hideUI = useStore((s) => s.hideUI)
  const ortho = useStore((s) => s.ortho)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const graph = useStore((s) => s.graph)
  const selected = useStore((s) => s.selected)

  useEffect(() => {
    tools.zone.refreshFacilityPreview()
  }, [facilityRot, tools])

  useEffect(() => {
    overlayRef.current = overlayOn
    sceneRef.current?.setOverlayVisible(overlayOn)
  }, [overlayOn])

  const buildZoneOverlay = (): void => {
    const scene = sceneRef.current
    if (!scene) return
    // 区域 map off: there is nothing to draw and no reason to flood-fill the whole
    // station for it. This effect runs on every commit, and the flood fill plus the
    // label sweep were being paid for while the map was hidden.
    if (!useStore.getState().zoneOverlayOn) {
      scene.setZoneOverlayVisible(false)
      return
    }
    const station = useStore.getState().station
    // One storey at a time: the map follows the Z axis, so what is tinted is the
    // floor of the level being edited (`activeZ`) and never every storey's paint
    // stacked into one picture. The labels come off the same floors, and no region
    // spans storeys, so they follow with it.
    const z = useStore.getState().activeZ
    const floors = zoneMapFloorsAt(station.cells, z, station.modules, station.levelBase, station.storeyHeight)
    const quads = new Float32Array(floors.length * 3)
    const zones = new Uint8Array(floors.length)
    // A fingerprint of the picture the quads make, so an edit that touched no
    // walkable floor (a wall, a bench, a line colour) does not mint another overlay
    // — and another set of labels — for the same map. The storey is part of the
    // fingerprint: the same floor plan painted the same way on another level is a
    // different picture.
    let h = 2166136261
    floors.forEach((c, i) => {
      // A cell with no label of its own wears its storey's default colour — 站外
      // on the street plane (`zoneIndexOf`) — so the map tints the floor the
      // crowd and the graph already read it as.
      const zone = zoneDisplayIndexOf(c)
      quads[i * 3] = c.x + 0.5
      quads[i * 3 + 1] = c.y + 0.5
      quads[i * 3 + 2] = c.z + 1.02
      zones[i] = zone
      h = Math.imul(h ^ (c.x + 4096), 16777619)
      h = Math.imul(h ^ (c.y + 4096), 16777619)
      h = Math.imul(h ^ (c.z + 4096), 16777619)
      h = Math.imul(h ^ zone, 16777619)
    })
    const labels = zoneRegionLabels(floors, station.modules)
    for (const l of labels) {
      h = Math.imul(h ^ Math.round(l.x * 100), 16777619)
      h = Math.imul(h ^ Math.round(l.y * 100), 16777619)
      for (const ch of l.label ?? '') h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    }
    const key = `${z}:${floors.length}:${h >>> 0}`
    if (key === zoneKeyRef.current) {
      scene.setZoneOverlayVisible(true)
      return
    }
    zoneKeyRef.current = key
    scene.setZoneOverlay(quads, zones, labels, true)
  }

  useEffect(() => {
    buildZoneOverlay()
  }, [zoneOverlayOn, geometryVersion, activeZ])

  useEffect(() => {
    if (!graph) return
    graphNodesRef.current = graph.nodes
    sceneRef.current?.setDensity(graph.nodes, new Float32Array(graph.nodeCount), overlayRef.current)
  }, [graph])

  // 隐藏天花板 is a slice setting like the level itself: it is applied on mount
  // (the renderer's own default matches the store's) and on every change.
  useEffect(() => {
    sceneRef.current?.setAutoCeiling(autoCeiling)
  }, [autoCeiling])

  useEffect(() => {
    sceneRef.current?.setHideRoof(hideRoof)
  }, [hideRoof])

  useEffect(() => {
    sceneRef.current?.setLevel(activeZ, ghostOther)
  }, [activeZ, ghostOther])

  useEffect(() => {
    sceneRef.current?.setGraphicsQuality(graphicsQuality)
  }, [graphicsQuality])

  useEffect(() => {
    sceneRef.current?.setEdgeScrolling(edgeScrolling)
  }, [edgeScrolling])

  // 剖切 is the placed section surface plus the clip (`render/section.ts`): the
  // plane is written in place, so a slide costs two numbers and no rebuild. The
  // flag goes on to the **storey walk** as well, because while a cut is on the slice
  // is put away — Q/E stop choosing a storey to ghost, so the only thing hiding any
  // of the station is the cut — and the walk is what re-clips the materials it
  // derives from the plane (`SceneRenderer.setCutaway`).
  useEffect(() => {
    sceneRef.current?.setSection(section, cutaway)
    sceneRef.current?.setCutaway(cutaway)
  }, [section, cutaway])

  // 隐藏剖切面: the clip stays, the sheet and its direction arrow go.
  useEffect(() => {
    sceneRef.current?.setSectionSurface(!hideSectionSurface)
  }, [hideSectionSurface])

  useEffect(() => {
    sceneRef.current?.setHideWalls(hideWalls)
  }, [hideWalls])

  // 隐藏地面: the street plane, out of the picture. It is the one surface with a
  // mesh pass of its own, so this is a visibility write on both ends — applied on
  // mount like 隐藏天花板, and on every change after.
  useEffect(() => {
    sceneRef.current?.setHideGround(hideGround)
  }, [hideGround])

  // 隐藏UI: the drawing lattice, its cell cursor, and the storey slice that puts
  // the ghost sheet over the floor under the camera. One flag, one effect: the
  // renderer hands it to the two systems that own those drawings
  // (`SceneRenderer.setHideUI`).
  useEffect(() => {
    sceneRef.current?.setHideUI(hideUI)
  }, [hideUI])

  useEffect(() => {
    sceneRef.current?.setOrtho(ortho)
  }, [ortho])

  /**
   * Drop any in-progress area drag without applying it (§9.5): a right-click or
   * ESC while previewing a foundation, paint, zone or room rectangle just clears
   * the ghost. Returns true when a drag was cancelled.
   */
  const cancelActiveDrag = (): boolean => {
    pointerFrame.current.cancel()
    tools.block.cancelPreview()
    const anyActive =
      dragRef.current?.active === true ||
      paintRef.current?.active === true ||
      zoneDragRef.current?.active === true
    if (!anyActive) return false
    dragRef.current = null
    paintRef.current = null
    zoneDragRef.current = null
    setBuildMeasure(null)
    clearToolPreview(sceneRef.current)
    return true
  }

  // ESC cancels any in-progress drag even when the pointer never moves again, and
  // Enter / ESC are the keyboard halves of 移动's 确认 / 取消 — which live in the 信息
  // card, so the keys are what makes the drop reachable without leaving the canvas.
  // ESC is also the way out of a **吸取**: the piece a pick armed goes back with the
  // tool, its settings and the boards a picked sign copied (`cancelPick`).
  useEffect(() => {
    const onCancelKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Enter') {
        if (!useStore.getState().moveDraft) return
        e.preventDefault()
        useStore.getState().confirmMove()
        if (!useStore.getState().moveDraft) tools.move.clearPreview()
        return
      }
      if (e.key !== 'Escape') return
      if (cancelActiveDrag()) return
      const st = useStore.getState()
      if (st.signEditorFor !== null || st.signComposing) return
      // A piece 移动 has in the air is what Escape puts back first: it is the thing
      // the player is holding. A 吸取 piece is only what the rail is armed with, so
      // it is the second thing Escape ends — and it ends it whole (`cancelPick`: the
      // tool, the piece, its settings and the boards a picked sign copied).
      if (st.moveDraft) {
        st.cancelMove()
        tools.move.clearPreview()
        return
      }
      st.cancelPick()
    }
    window.addEventListener('keydown', onCancelKey)
    return () => window.removeEventListener('keydown', onCancelKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.followPassenger(followAgentId, () => useStore.getState().endPassengerView())
    return () => sceneRef.current?.followPassenger(null)
  }, [followAgentId])

  useEffect(() => {
    const exitEyeView = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      if (st.followAgentId === null || e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      st.endPassengerView()
    }
    window.addEventListener('keydown', exitEyeView, true)
    return () => window.removeEventListener('keydown', exitEyeView, true)
  }, [])

  // A ghost belongs to a tool; leaving one must not strand a preview — and a piece
  // in the air is put back where it came from, because a lift is not an edit and
  // switching tools is not a way to lose one.
  useEffect(() => {
    hoverRef.current = null
    pointerFrame.current.cancel()
    tools.block.cancelPreview()
    dragRef.current = null
    paintRef.current = null
    zoneDragRef.current = null
    setBuildMeasure(null)
    useStore.getState().cancelMove(false)
    clearToolPreview(sceneRef.current, true)
  }, [tool])

  // Rotating (R), switching the equipment, or cycling its width, direction,
  // 闸机's lane or fence, and the 方块 tool's 半墙 mode or the side R stepped it to
  // (Tab / R) rebuild the ghost at the hovered tile at once, instead of waiting for
  // the pointer to move again.
  useEffect(() => {
    tools.equipment.refreshHover()
    tools.block.refreshHover()
  }, [placementKey, tools])

  // The same for the rail piece: R, the bound line and the direction all change
  // the pre-rendered ghost, so rebuild it in place.
  useEffect(() => {
    tools.platform.refreshHover()
  }, [railRot, railLineId, railDir, tools])

  // The tunnel's length changes its ghost; the hovered rail does not.
  useEffect(() => {
    tools.tunnel.refreshHover()
  }, [tunnelLength, tools])

  // Boot the renderer.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new SceneRenderer(canvas)
    scene.setGraphicsQuality(useStore.getState().graphicsQuality)
    sceneRef.current = scene
    const unmountAudio=gameAudio.mount()
    const updateAudio=():void=>{scene.onAudioFrame=getAudioVolumes().ambient>0?frame=>gameAudio.updateScene(frame):null}
    updateAudio()
    const unsubscribeAudio=subscribeAudioVolumes(updateAudio)
    scene.setPlaying(useStore.getState().playing)
    let pendingMoveCommit=false
    const unsubscribePlaying = useStore.subscribe((state, previous) => {
      if (state.playing !== previous.playing) scene.setPlaying(state.playing)
      if (state.stationEpoch !== previous.stationEpoch) gameAudio.stop()
      if(previous.moveDraft && !state.moveDraft){pendingMoveCommit=true;queueMicrotask(()=>{pendingMoveCommit=false})}
      if(pendingMoveCommit && state.version!==previous.version){pendingMoveCommit=false;gameAudio.play('move')}
      if (!previous.moveDraft && state.moveDraft) gameAudio.play('pick')
    })
    // A fresh scene owns no overlay, so the fingerprint of the last one means
    // nothing to it: the next build has to mint the map again.
    zoneKeyRef.current = ''
    // The renderer on `window`, for the same reason the store is there (`boot.tsx`):
    // a browser-driven check can aim the camera at a corner and photograph it. Only
    // the live renderer, no copy, so a probe and the game cannot disagree.
    window.__scene = scene
    scene.onStats = (s) => useStore.getState().setStats(s)
    // A wall panel hangs on the wall the **camera** is looking at
    // (`autofaceWallMount`), so an orbit has to re-aim the ghost already under the
    // pointer: the settings-driven refresh only fires when R / Tab changes
    // something, and the pointer has not moved. Only when nothing else owns the
    // pointer — a drag in progress is already drawing its own preview — and never
    // while following a passenger, whose camera the crowd drives.
    scene.onCameraAim = () => {
      const st = useStore.getState()
      if (st.followAgentId !== null) return
      if (dragRef.current || paintRef.current || zoneDragRef.current || sectionDragRef.current) return
      tools.equipment.refreshHover()
      tools.move.refreshHover()
    }
    const resize = (): void => scene.resize(canvas.clientWidth, canvas.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    setFrameHandler((count, agents, density, trains, lifts, intervalMs, simTime, trainServices) => {
      scene.setAgents(agents, count, intervalMs)
      scene.setTrains(trains)
      scene.setLifts(lifts)
      // The 电视 station plate prints the station clock, so it follows the sim.
      scene.setSimClock(simTime, trainServices)
      if (overlayRef.current && graphNodesRef.current.length === density.length * 3) {
        scene.setDensity(graphNodesRef.current, density, true)
      }
    })
    // The 选择 tool's route preview rides the same frame, one step later: the line is
    // drawn against the positions the frame above has just installed.
    setRouteHandler((points, agentId) => scene.setRoute(points, agentId))
    const onPreset = (e: Event): void => {
      const k = (e as CustomEvent).detail as string
      scene.setPreset(k === '1' ? 'iso' : k === '2' ? 'plan' : k === '4' ? 'front' : k === '5' ? 'side' : 'custom')
      useStore.getState().setOrtho(k === '2' || k === '4' || k === '5')
    }
    const onFrame = (): void => scene.frame()
    // 回到默认视角 (Ctrl+H, and the nav cube's own ⌂ button through the same action):
    // the isometric build view in perspective, and nothing else.
    const onHome = (): void => goHomeView(scene)
    const onDelete = (): void => {
      const st = useStore.getState()
      const sel = st.selected
      if (!sel || sel.kind !== 'cell') return
      const [x, y, z] = sel.key.split(',').map(Number)
      // A build-tool floor brings its auto-wall ring with it; a hand-built or
      // auto-wall block is just removed.
      const next = removeFloor(st.station, [[x, y, z]])
      st.commit(next)
      if(useStore.getState().version!==st.version)gameAudio.play('delete')
      st.select(null)
    }
    // WASD pan (Shift = faster). Q/E layer stepping stays in the app. A text
    // field keeps its letters — a focused **button** does not, or clicking a rail
    // tile would stop WASD panning the camera afterwards.
    //
    // **Shift+W pans nothing**: it is the 轨道 folder's own key on the rail's
    // Shift+letter ladder (`rail/helpers.ts` `RAIL_FOLDERS`), and a folder that
    // also shoved the camera forward would be a key with two meanings. The fast
    // pan keeps Shift+A/S/D, and a plain W is still forward.
    //
    // **Ctrl+Q / Ctrl+E raise and lower the view** (`CameraSystem.panCameraVertical`),
    // the one camera pair that needs a modifier: a plain Q/E steps the storey
    // (`AppShell`), so the modifier is what tells the two apart. The key set holds
    // the pan under its own name — `PAN_UP` / `PAN_DOWN`, the intent rather than the
    // key — so the camera cannot mistake a storey step for a move, and so the nav
    // cube's two arrows can hold the very same pan from the very same vocabulary
    // (`app/ViewCube.tsx`). The camera and the point it aims at travel together, so
    // the view angle is untouched and the station slides up or down the screen.
    // Shift stays the fast modifier, as it is for the pan, and Alt is left out
    // because AltGr **is** Ctrl+Alt on a European layout, where AltGr+Q/E types a
    // letter. The press is taken from the browser before it acts on it: Ctrl+E is
    // Chrome's address-bar search and Ctrl+Q quits Firefox.
    const panKeys = new Set(['w', 'a', 's', 'd', 'shift'])
    const onKeyDown = (e: KeyboardEvent): void => {
      if (useStore.getState().followAgentId !== null) return
      if (isTypingTarget(e.target)) return
      const k = e.key.toLowerCase()
      // **Alt+letter folds a 信息栏 folder** (`rail/helpers.ts` `INSPECTOR_FOLDERS`:
      // 信息, 视图, 出入口, 线路), so it may not also shove the camera — Alt+W would
      // otherwise fold 视图 *and* start a forward pan. The pan keys are the bare
      // letters, plus the Shift+W that the rail's own ladder takes (`Shift+A/S/D`
      // stays the fast pan).
      if (e.altKey) return
      if (e.shiftKey && k === 'w') return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'q' || k === 'e')) {
        e.preventDefault()
        scene.keys.add(k === 'e' ? PAN_UP : PAN_DOWN)
        return
      }
      if (panKeys.has(k)) scene.keys.add(k)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      scene.keys.delete(k)
      // The vertical pan is held under the intent's name, so the letter's release
      // has to clear that — otherwise letting go of Ctrl+E would leave the view
      // climbing. A release clears the token whatever put it there: the two
      // sources are one action, and a second holder of the same direction is one
      // pan, not two.
      if (k === 'q') scene.keys.delete(PAN_DOWN)
      if (k === 'e') scene.keys.delete(PAN_UP)
    }
    const onBlur = (): void => scene.keys.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('metro:preset', onPreset)
    window.addEventListener('metro:frame', onFrame)
    window.addEventListener('metro:home', onHome)
    window.addEventListener('metro:delete', onDelete)
    return () => {
      unsubscribePlaying()
      unsubscribeAudio()
      unmountAudio()
      setFrameHandler(null)
      setRouteHandler(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('metro:preset', onPreset)
      window.removeEventListener('metro:frame', onFrame)
      window.removeEventListener('metro:home', onHome)
      window.removeEventListener('metro:delete', onDelete)
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
      framedRef.current = false
      homeEpochRef.current = -1
    }
  }, [])

  const renderedStationRef = useRef<{
    station: typeof station; stationEpoch: number; signVersion: number
    signPreviewId: typeof signPreviewId; language: typeof language
  } | null>(null)
  // Rebuild the static meshes only when the station itself changes.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const st = useStore.getState()
    const previous = renderedStationRef.current
    renderedStationRef.current = { station, stationEpoch, signVersion, signPreviewId, language }
    if (previous && !signPreviewId && previous.stationEpoch === stationEpoch &&
      previous.signPreviewId === signPreviewId &&
      previous.signVersion === signVersion && previous.language === language &&
      populationEdit(previous.station, station)) {
      const data = toData(station)
      if (scene.updatePopulationData(data)) {
        geometryRef.current.resolve(data)
        return
      }
    }
    // The tools' live "is there a block here" set is the **effective** cell list —
    // the document's own cells plus the generated street window (`withGround`) —
    // not the raw document. The street is stored inverted (only holes are cells),
    // so a scan of `station.cells` alone would leave the plane real to the crowd
    // and to the mesher but invisible to the pointer: no red box, no paintable
    // top face, no zoned ground, no block to remove.
    const geometry = geometryRef.current.resolve(toData(station))
    const ground = geometry.ground
    solidRef.current = geometry.solids
    // The 分区 brush's own set, off the same effective list and by the same rule
    // the map draws with — so a zone lands on the street, which the document does
    // not store, and never on a wall coping, which the map could not tint.
    floorRef.current = geometry.floors
    thinRef.current = geometry.thins
    // The board the editor is arranging, drawn where the sign it belongs to hangs —
    // while the move effect hides a lifted piece without changing drawn data.
    const modules = station.modules
      .map((m) => signModuleWithPreview(m, st.signPreview))
    // Hand the street this effect already built to the mesher: `prepareStation`
    // would materialise the same window again per commit, the second
    // window-wide pass of this edit (the walk graph builds the third, in the
    // worker).
    // Apply view modes before installing geometry so a mode selected before
    // the first renderer mount (for example the benchmark's Hide UI preset)
    // participates in the initial level walk instead of waiting for a toggle.
    scene.setHideUI(st.hideUI)
    scene.setStation(toData({ ...station, modules }), undefined, ground)
    scene.setAutoCeiling(st.autoCeiling)
    scene.setHideGround(st.hideGround)
    scene.setHideRoof(st.hideRoof)
    scene.setLevel(st.activeZ, st.ghostOtherLevels)
    // The 剖切 surface starts at the middle of the plan on the storey being
    // edited, facing +y — the fixed cut the old toggle drew. A switch re-places
    // it against the fresh bounds; an edit leaves the player's cut alone, so
    // moving a wall never throws it away.
    const switched = stationEpoch !== homeEpochRef.current
    if (!sectionSeededRef.current || switched) {
      sectionSeededRef.current = true
      st.placeSection(scene.defaultSection().anchor)
    }
    scene.setSection(useStore.getState().section, st.cutaway)
    // The home view: on a fresh page load the demo must open on it (the
    // constructor's preset ran before the station existed, so frame it now),
    // and a station switch (打开 / 示例车站 / 新建) returns to it against the
    // fresh bounds — iso in perspective through the default lens. A later edit
    // rebuilds the station but must not yank the camera.
    if (!framedRef.current || switched) {
      framedRef.current = true
      homeEpochRef.current = stationEpoch
      goHomeView(scene)
      scene.prepareBuildViews()
    }
  }, [version, station, stationEpoch, signPreviewId, signVersion, language])

  // A lifted piece (移动) is drawn from its own ghost, so a fresh lift or an R while
  // it is in the air rebuilds that ghost at once instead of waiting for the next
  // pointer move. When the lift ends the ghost goes with it — and a cancel is not a
  // commit, so nothing else has rebuilt the station to drop it: that is this effect's
  // job, which is what makes the card's 取消 clear the piece on screen. `geometryVersion` is in
  // the list because a structural commit clears the ghost with the station (`setStation`), so an
  // edit made while a piece is in the air — an undo, say — puts it back on screen.
  useEffect(() => {
    sceneRef.current?.setMovingModule(moveId)
    if (useStore.getState().moveDraft) tools.move.refreshHover()
    else {
      tools.move.clearPreview()
      const st=useStore.getState()
      // Move cancellation shares the preview root; restore the active road's
      // node handles after that cleanup and any station rebuild.
      if(st.tool==='module'&&st.moduleType==='road'&&!dragRef.current?.road) tools.equipment.refreshHover()
    }
  }, [moveKey, moveId, geometryVersion, tools])

  // Keep the 3D selection box in step with the inspector's selection. A rebuild
  // re-applies it inside setStation, so this only has to run on the id itself.
  useEffect(() => {
    sceneRef.current?.setSelection(selected?.kind === 'module' ? selected.key : null)
  }, [selected])

  // The 选择 tool's agent preview (§9.5): the selection names the passenger and the
  // worker answers with the walk still ahead of them. Leaving the tool puts the line
  // away — a route is drawn *for* a tool that is asking about one person — and coming
  // back re-arms the same passenger, because the selection is still theirs.
  useEffect(() => {
    selectSimAgent(tool === 'select' && selected?.kind === 'agent' ? Number(selected.key) : null)
  }, [selected, tool])

  const pickAt = (clientX: number, clientY: number, button = 0): PickResult | null => {
    const scene = sceneRef.current
    if (!scene) return null
    const st = useStore.getState()
    if (!st.moveDraft && st.tool === 'module' && st.moduleType === 'roof' && button !== 2 && dragRef.current?.mode !== 'remove') {
      const roofIds = new Set(st.station.modules.filter((m) => m.type === 'roof' && !m.cfg.variant).map((m) => m.id))
      const direct = scene.pickModuleHit(clientX, clientY)
      const directModule = direct ? st.station.modules.find((m) => m.id === direct.moduleId) : undefined
      const directRoof = directModule?.type === 'roof' && !directModule.cfg.variant ? direct : null
      const slab = directRoof ?? scene.pickRoofModuleNear(clientX, clientY, roofIds)
      const roof = slab ? st.station.modules.find((m) => m.id === slab.moduleId) : undefined
      if (slab && roof?.type === 'roof' && !roof.cfg.variant) {
        const cell: [number, number, number] = [Math.floor(slab.point[0]), Math.floor(slab.point[1]), roof.z]
        return {
          cell, place: cell, solid: true, normal: [0, 0, 1], point: slab.point,
          ...(roof.cfg.plateSnap ? { roofSnap: roof.cfg.plateSnap } : {}),
        }
      }
    }
    if (!st.moveDraft && st.tool === 'module' && st.moduleType.startsWith('roof') && st.moduleType !== 'roof' && button !== 2 && dragRef.current?.mode !== 'remove') {
      const hit = scene.pickHorizontalPlane(clientX, clientY, st.activeZ + 1 + (st.moduleType === 'roof-canopy' ? 0 : trussRoofTop(st.roofWidth)), st.activeZ)
      if (hit) hit.cell = [Math.round(hit.point[0]), Math.round(hit.point[1]), st.activeZ]
      return hit
    }
    if ((st.moveDraft || ['module', 'block', 'wall', 'rail', 'tunnel'].includes(st.tool))
      && button !== 2 && dragRef.current?.mode !== 'remove') {
      const surface = scene.pickPlacement(clientX, clientY, st.activeZ)
      return st.moveDraft || st.tool === 'module'
        ? placementSurface(st.station, st.moveDraft?.module ?? st.moduleType, surface)
        : surface
    }
    return scene.pick(clientX, clientY, st.activeZ)
  }

  const toInfo = (e: React.PointerEvent, hit: PickResult | null): PointerInfo => ({
    clientX: e.clientX,
    clientY: e.clientY,
    button: e.button,
    buttons: e.buttons,
    shiftKey: e.shiftKey,
    hit,
    preventDefault: () => e.preventDefault(),
  })

  /**
   * 剖切: grab the highlighted cut surface. The press is what decides — while the
   * pointer is *on* the surface every button belongs to it, so the grab works
   * whatever tool the build rail is left on; a press anywhere else is the tool's
   * as usual. The surface snaps under the mouse for the same reason: a hover
   * lights it up and switches the cursor to a grab hand.
   */
  const touchZoom = useRef(new TouchZoom())
  const touchPress = useRef<React.PointerEvent | null>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    pointerFrame.current.cancel()
    // Defer touch edits until release so the first finger of a pinch never builds.
    if (e.pointerType === 'touch') {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      touchZoom.current.down(e.pointerId, e.clientX, e.clientY)
      touchPress.current = touchPress.current ?? e
      cancelActiveDrag()
      sectionDragRef.current = null
      return
    }
    startPointerTool(e)
  }

  const withToolSound = (event: React.PointerEvent, action:()=>void):void => {
    const before=useStore.getState()
    const removal=dragRef.current?.mode==='remove' || paintRef.current?.button===2 || zoneDragRef.current?.button===2
    // A refusal can repeat the notice already shown during hover. Listen only
    // while the click/release executes; hover itself never emits an audio cue.
    let announcedNotice=false
    const unsubscribe=useStore.subscribe(state=>{if(state.notice)announcedNotice=true})
    try{action()}finally{unsubscribe()}
    const sound=actionSound(before,useStore.getState(),event.button,removal,announcedNotice)
    if(sound)gameAudio.play(sound)
  }

  const startPointerTool = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (scene) scene.withPointerPick(() => withToolSound(e, () => dispatchPointerDown(e)))
  }

  const dispatchPointerDown = (e: React.PointerEvent): void => {
    if (useStore.getState().followAgentId !== null) return
    const scene = sceneRef.current
    if (!scene || e.button === 1) return
    // The section surface owns the pointer when it is under it, before any of
    // the drag cancellation below: a grab is not a second press on a tool drag.
    if (scene.sectionHit(e.clientX, e.clientY)) {
      e.preventDefault()
      // The line the pointer will be measured along: the cut's own axis on
      // screen, taken once here. A cut that slides straight at the camera has no
      // such line, and there is nothing to grab it by.
      const { axis, span } = scene.sectionDragAxis()
      if (span > 0) {
        const section = useStore.getState().section
        sectionDragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startOffset: section.offset,
          axis,
          span,
        }
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      }
      return
    }
    // A second press while an area drag is previewing cancels it instead of
    // starting a second drag, so the release commits nothing. In practice this
    // is a right-click during a left drag (or the reverse); ESC is handled
    // separately above for drags that never see another press.
    if (cancelActiveDrag()) {
      e.preventDefault()
      return
    }
    const st = useStore.getState()
    const info = toInfo(e, pickAt(e.clientX, e.clientY, e.button))
    // 移动 (§9.5): a piece in the air owns the pointer, whichever tool was active
    // when the 信息 card lifted it.
    if (st.moveDraft) {
      tools.move.onDown(info)
      return
    }
    tools.byTool[st.tool].onDown(info)
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (scene) scene.withPointerPick(() => dispatchPointerMove(e))
  }

  const dispatchPointerMove = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') {
      e.preventDefault()
      const factor = touchZoom.current.move(e.pointerId, e.clientX, e.clientY)
      if (factor !== 1) sceneRef.current?.zoomBy(factor)
      return
    }
    if (useStore.getState().followAgentId !== null) return
    if (activeTool === 'move') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) setMovePointer({ left: e.clientX - rect.left, top: e.clientY - rect.top })
    }
    if (activeTool === 'delete') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) setDeletePointer({ left: e.clientX - rect.left, top: e.clientY - rect.top })
    }
    if (activeTool === 'pick') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) setPickerPointer({ left: e.clientX - rect.left, top: e.clientY - rect.top })
    }
    const scene = sceneRef.current
    if (!scene) return
    // 剖切: a slide in progress owns the move. The pointer's travel is measured
    // **along the cut's own axis on screen** — the axis was fixed at the press —
    // and converted to metres, so the cut walks the way (R) points it and a
    // sideways drag moves it not at all. The step is snapped to the half metre
    // (Shift: 5 cm) so the cut lands on a round number of blocks.
    const drag = sectionDragRef.current
    if (drag) {
      const walked = walkAlong([drag.startX, drag.startY], [e.clientX, e.clientY], drag.axis)
      useStore.getState().setSectionOffset(snapOffset(dragOffset(drag.startOffset, walked, drag.span), e.shiftKey))
      return
    }
    // Hover: the surface lights up and the cursor becomes a grab hand where a
    // press would take it (the same hit test the press uses), so the surface the
    // pointer can snap onto says so before it is grabbed.
    const hot = scene.sectionHit(e.clientX, e.clientY)
    if (hot !== sectionHotRef.current) {
      sectionHotRef.current = hot
      scene.setSectionHover(hot)
      setSectionHot(hot)
    }
    if (hot) {
      scene.setHoverHighlight(null)
      return
    }
    // Right-click cancel while the left button is still held: the second
    // pointerdown is unreliable (one mouse pointer, button already down), but
    // the buttons bitmask on the move is not — a left drag that gains the
    // right bit, or the reverse, drops the drag at once.
    {
      const activeButton =
        dragRef.current?.active === true
          ? dragRef.current.button
          : paintRef.current?.active === true
            ? paintRef.current.button
            : zoneDragRef.current?.active === true
              ? zoneDragRef.current.button
              : null
      if (activeButton !== null) {
        const otherHeld = activeButton === 2 ? (e.buttons & 1) !== 0 : (e.buttons & 2) !== 0
        if (otherHeld) {
          cancelActiveDrag()
          return
        }
      }
    }
    const hit = pickAt(e.clientX, e.clientY, e.buttons & 2 ? 2 : 0)
    if (!hit) {
      tools.block.cancelPreview()
      hoverRef.current = null
      scene.setHoverHighlight(null)
      setBuildMeasure(null)
      // A carried piece (移动) keeps its parked ghost: only where it is aimed, not
      // whether it exists, depends on the pointer.
      if (!useStore.getState().moveDraft) {
        scene.setCursor(null)
        scene.setModulePreview(null)
        scene.setCollisionHighlight(null)
      }
      return
    }
    const st = useStore.getState()
    const info = toInfo(e, hit)
    // 移动 again: while a piece is in the air every move only aims it. Nothing else
    // the pointer could do — selecting, building, painting — happens until it is
    // dropped or put back.
    if (st.moveDraft) {
      tools.move.onMove(info)
      return
    }
    tools.byTool[st.tool].onMove(info)
  }

  /**
   * Which controller owns an in-progress area-drag release. The press promised
   * the gesture, so the flags on the drag — not the current tool — decide:
   * module sweeps and delete-side fence lines to 删除, 围栏 runs to 设备,
   * wall runs (including the 方块 tool's right-press column lift) to 墙, and
   * plain block rectangles to 方块 — or to 删除 for its line-remove drag.
   */
  const ownerForRelease = (d: AreaDrag, current: Tool): ToolController => {
    if (d.road === true) return tools.equipment
    if (d.roof === true) return d.deleteTile === true ? tools.delete : tools.equipment
    if (d.modules !== undefined) return tools.delete
    if (d.tactile === true) return current === 'delete' ? tools.delete : tools.equipment
    if (d.fence === true) return current === 'delete' ? tools.delete : tools.equipment
    if (d.wall === true) return d.single === true ? tools.block : tools.wall
    return current === 'delete' ? tools.delete : tools.block
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    // A deletion sweep collects the full path, including bends within one frame.
    if (e.pointerType === 'touch' || dragRef.current?.modules !== undefined) {
      pointerFrame.current.flush()
      handlePointerMove(e)
    }
    else pointerFrame.current.schedule(() => {
      handlePointerMove(e)
      if (pointerFrame.current.inAnimationFrame) tools.block.flushFramePreview()
    })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    pointerFrame.current.flush()
    const scene = sceneRef.current
    if (scene) scene.withPointerPick(() => withToolSound(e, () => dispatchPointerUp(e)))
  }

  const dispatchPointerUp = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') {
      e.preventDefault()
      const tap = touchZoom.current.up(e.pointerId)
      const press = touchPress.current
      touchPress.current = null
      if (!tap || !press || press.pointerId !== e.pointerId || Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) > 8) return
      startPointerTool(e)
    }
    if (useStore.getState().followAgentId !== null) return
    setBuildMeasure(null)
    // 剖切: the slide ends here. The offset is already in the store (every move
    // committed it), so the release only has to let the surface go.
    if (sectionDragRef.current) {
      sectionDragRef.current = null
      sceneRef.current?.setSectionHover(false)
      return
    }
    // Releasing the other button while a drag is held cancels it: the classic
    // case is right-up during a left drag, whose own pointerdown never fired
    // while the left button was down — committing here would apply the very
    // rectangle the player tried to cancel. The still-held button's later
    // release then finds no active drag and commits nothing.
    {
      const activeButton =
        dragRef.current?.active === true
          ? dragRef.current.button
          : paintRef.current?.active === true
            ? paintRef.current.button
            : zoneDragRef.current?.active === true
              ? zoneDragRef.current.button
              : null
      if (activeButton !== null && (e.button === 0 || e.button === 2) && e.button !== activeButton) {
        cancelActiveDrag()
        return
      }
      if (e.button === 1) return
    }
    const info = toInfo(e, pickAt(e.clientX, e.clientY, e.button))
    // Route to whichever drag is active; each controller nulls its own ref and
    // applies the release. No drag active means the press already committed
    // (click tools) and the release owns nothing.
    if (zoneDragRef.current?.active === true) {
      tools.zone.onUp(info)
      return
    }
    if (paintRef.current?.active === true) {
      tools.paint.onUp(info)
      return
    }
    const d = dragRef.current
    if (d?.active === true) ownerForRelease(d, useStore.getState().tool).onUp(info)
  }

  // A right-click also fires contextmenu while another button is held, even when
  // its own pointerdown never arrived — so it cancels any previewing drag too.
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    // The browser can fire this at right-down; let the erase drag reach release.
    const activeDrag =
      dragRef.current?.active === true ? dragRef.current
        : paintRef.current?.active === true ? paintRef.current
          : zoneDragRef.current?.active === true ? zoneDragRef.current
            : null
    if (ownsContextMenu(activeDrag, e.buttons)) return
    cancelActiveDrag()
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`${sectionHot ? 'viewport grab' : 'viewport'}${activeTool === 'move' || activeTool === 'delete' || activeTool === 'pick' ? ' toolPointer' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pointerFrame.current.cancel()
          touchZoom.current.cancel(e.pointerId)
          touchPress.current = null
          cancelActiveDrag()
          sectionDragRef.current = null
        }}
        onLostPointerCapture={(e) => {
          pointerFrame.current.cancel()
          if (e.pointerType === 'touch') {
            touchZoom.current.cancel(e.pointerId)
            touchPress.current = null
          }
        }}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          pointerFrame.current.cancel()
          tools.block.cancelPreview()
          hoverRef.current = null
          sceneRef.current?.setHoverHighlight(null)
          setBuildMeasure(null)
          if (sectionHotRef.current) {
            sectionHotRef.current = false
            setSectionHot(false)
            sceneRef.current?.setSectionHover(false)
          }
          // A piece in the air outlives the pointer: its ghost stays parked where it
          // was aimed, so going to the 信息 card for 确认 does not take the aim away.
          if (useStore.getState().moveDraft) return
          sceneRef.current?.setCursor(null)
          sceneRef.current?.setModulePreview(null)
          sceneRef.current?.setCollisionHighlight(null)
          sceneRef.current?.setGhost([], 'remove')
          sceneRef.current?.clearFaceGhost()
        }}
      />
      {activeTool === 'move' && movePointer && (
        <TfiHandDrag
          className="movePointer"
          aria-hidden="true"
          style={{ left: movePointer.left + 5, top: movePointer.top + 5 }}
        />
      )}
      {activeTool === 'delete' && deletePointer && (
        <TbBulldozer
          className="deletePointer"
          aria-hidden="true"
          style={{ left: deletePointer.left + 5, top: deletePointer.top + 5 }}
        />
      )}
      {activeTool === 'pick' && pickerPointer && (
        <CgColorPicker
          className="pickerPointer"
          aria-hidden="true"
          style={{ left: pickerPointer.left + 5, top: pickerPointer.top + 5 }}
        />
      )}
      {buildMeasure && (
        <div className="buildMeasure" style={{ left: buildMeasure.left + 14, top: buildMeasure.top + 14 }}>
          {translate(buildMeasure.text)}
        </div>
      )}
      <ViewCube sceneRef={sceneRef} />
    </>
  )
}
