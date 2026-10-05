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
// The one value this file needs from three is the `Plane` a 剖切 slide is
// measured in (`sectionDragRef`); everything else goes through the renderer.
import { Plane, Vector3 } from 'three'
import { SceneRenderer, type PickResult } from '../render/scene.ts'
import { cellKey, removeFloor, thinWallSideMap, toData, zoneMapFloors, zoneRegionLabels } from '../build/model.ts'
import type { WallSide } from '../sim/types.ts'
import { zoneIndex } from '../sim/zones.ts'
import { sectionNormal, slideOffset, snapOffset } from '../render/section.ts'
import type { SectionOrientation, Vec3 } from '../render/section.ts'
import { placementPreviewKey, setFrameHandler, signModuleWithPreview, useStore, type Tool } from './store.ts'
import { ViewCube } from './ViewCube.tsx'
import { BlockTool } from './tools/BlockTool.ts'
import { DeleteTool } from './tools/DeleteTool.ts'
import { EquipmentTool } from './tools/EquipmentTool.ts'
import { MoveController } from './tools/MoveController.ts'
import { PaintTool } from './tools/PaintTool.ts'
import { PlatformTool } from './tools/PlatformTool.ts'
import { SelectTool } from './tools/SelectTool.ts'
import { TunnelTool } from './tools/TunnelTool.ts'
import { WallTool } from './tools/WallTool.ts'
import { ZoneTool } from './tools/ZoneTool.ts'
import { ToolController } from './tools/ToolController.ts'
import type { AreaDrag, FacilityDragState, HoverTile, PaintDrag, PointerInfo, ToolContext, ZoneDragState } from './tools/ToolContext.ts'

/** The 地基 (block) tool's live patch size, shown beside the pointer in metres. */
interface BuildMeasure {
  left: number
  top: number
  text: string
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SceneRenderer | null>(null)
  const overlayRef = useRef(false)
  const graphNodesRef = useRef<Float32Array>(new Float32Array(0))
  /** Solid cell keys, refreshed with the station, so a drag can tell blocks from void. */
  const solidRef = useRef<Set<string>>(new Set())
  /**
   * Every cell of the station that draws **half a block thick** — a 半墙 the player
   * laid and every block a ramp kept beside its run — by cell key → the side the
   * panel hugs, refreshed with the station. A paint brush reads it to offer the
   * panel's own inner face, which is a surface inside its cell rather than on the
   * cell's boundary (`faceTargets`); without the derived ones a stair's own half
   * wall was a surface the brush would not colour.
   */
  const thinRef = useRef<Map<string, WallSide>>(new Map())
  /** True once the first station build has framed the home view (refresh only, not edits). */
  const framedRef = useRef(false)
  /**
   * True once the first station build has placed the 剖切 surface. A station
   * switch puts it back (`initSim` reloads the document but this is the only
   * place that knows the new station's own extents), while an edit leaves it
   * where the player put it.
   */
  const sectionSeededRef = useRef(false)
  /**
   * The tile under the pointer for the equipment and 地基 tools, so R and Tab can
   * rebuild the ghost already under it (`refreshHover`).
   */
  const hoverRef = useRef<HoverTile | null>(null)
  const dragRef = useRef<AreaDrag | null>(null)
  /** The paint tool's own drag: press a face, drag a rectangle on its plane. */
  const paintRef = useRef<PaintDrag | null>(null)
  /** The zone tool's rectangle drag: a fare-zone patch or a facility room. */
  const zoneDragRef = useRef<ZoneDragState | null>(null)
  /**
   * The shop right-click drag: the press holds a shop, the rectangle previews
   * either the wall openings to cut (cyan) or the whole store to delete (red),
   * and the release applies it.
   */
  const facilityDragRef = useRef<FacilityDragState | null>(null)
  /**
   * The 剖切 slide in progress: the surface's own point the grab started on, the
   * offset it started from and the pointer's own plane. The section's plane is
   * **fixed for the drag** (`dragPlane`), so the pointer's ray always meets a
   * stable surface however far the cut has travelled — measuring against the
   * moving plane is what makes a slide accelerate away from the pointer.
   */
  const sectionDragRef = useRef<{ from: Vec3; startOffset: number; orientation: SectionOrientation; plane: Plane } | null>(
    null,
  )
  /** True while the pointer is on the section surface, for the hover read. */
  const sectionHotRef = useRef(false)

  /** The 地基 tool's pending patch size, pinned to the pointer while previewing. */
  const [buildMeasure, setBuildMeasure] = useState<BuildMeasure | null>(null)
  /** The pointer is on the 剖切 surface: the crosshair becomes a grab hand. */
  const [sectionHot, setSectionHot] = useState(false)

  // The shared controller contract (Lane C step 0): the scene, the picks, the
  // refs above, and the patch-size badge. Stable for the component's lifetime,
  // so the controllers below are built once.
  const ctx: ToolContext = useMemo(
    () => ({
      scene: () => sceneRef.current,
      pick: (clientX, clientY) => sceneRef.current?.pick(clientX, clientY, useStore.getState().activeZ) ?? null,
      pickModule: (clientX, clientY) => sceneRef.current?.pickModule(clientX, clientY) ?? null,
      facing: () => sceneRef.current?.pickFacing(),
      solids: () => solidRef.current,
      thins: () => thinRef.current,
      hover: hoverRef,
      drag: dragRef,
      paint: paintRef,
      zoneDrag: zoneDragRef,
      facilityDrag: facilityDragRef,
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
      block,
      wall,
      delete: del,
      module: equipment,
      paint,
      zone,
      rail: platform,
      tunnel,
    }
    return { select, block, wall, delete: del, equipment, paint, zone, platform, tunnel, move, byTool }
  }, [ctx])

  const version = useStore((s) => s.version)
  const station = useStore((s) => s.station)
  // A 指示牌 whose board the editor has open draws the board being arranged, not the
  // one committed (`signModuleWithPreview`). Subscribing to the id rather than to the
  // whole preview keeps this from re-rendering the viewport on every dragged bin —
  // the `version` bump the editor raises alongside it is what redraws the meshes.
  const signPreviewId = useStore((s) => s.signPreview?.moduleId ?? null)
  // The piece in the air (移动), by id: the station is drawn without it, so the
  // translucent ghost under the pointer is the only copy on screen. Subscribing to
  // the id — rather than to the whole draft — keeps a pointer move from rebuilding
  // the station's meshes.
  const moveId = useStore((s) => s.moveDraft?.module.id ?? null)
  // The carried piece and its rotation: the two things an R or a fresh lift change
  // about the ghost, so they are all the ghost effect has to watch.
  const moveKey = useStore((s) => (s.moveDraft ? `${s.moveDraft.module.id}|${s.moveDraft.rot}` : ''))
  const tool = useStore((s) => s.tool)
  // Everything the equipment ghost is drawn from, as one key: the piece, its
  // rotation and each Tab cycle. Subscribing to the key — rather than to the
  // fields — is what lets R and Tab redraw a ghost that is already under the
  // pointer, and it keeps the list in one place (`placementPreviewKey`).
  const placementKey = useStore(placementPreviewKey)
  const railRot = useStore((s) => s.railRot)
  const railLineId = useStore((s) => s.railLineId)
  const railDir = useStore((s) => s.railDir)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const activeZ = useStore((s) => s.activeZ)
  const ghostOther = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
  const cutaway = useStore((s) => s.cutaway)
  const section = useStore((s) => s.section)
  const hideWalls = useStore((s) => s.hideWalls)
  const hideUI = useStore((s) => s.hideUI)
  const ortho = useStore((s) => s.ortho)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const graph = useStore((s) => s.graph)
  const selected = useStore((s) => s.selected)

  useEffect(() => {
    overlayRef.current = overlayOn
    sceneRef.current?.setOverlayVisible(overlayOn)
  }, [overlayOn])

  const buildZoneOverlay = (): void => {
    const scene = sceneRef.current
    if (!scene) return
    const station = useStore.getState().station
    const floors = zoneMapFloors(station.cells, station.modules)
    const quads = new Float32Array(floors.length * 3)
    const zones = new Uint8Array(floors.length)
    floors.forEach((c, i) => {
      quads[i * 3] = c.x + 0.5
      quads[i * 3 + 1] = c.y + 0.5
      quads[i * 3 + 2] = c.z + 1.02
      zones[i] = zoneIndex(c.zone)
    })
    scene.setZoneOverlay(quads, zones, zoneRegionLabels(floors), useStore.getState().zoneOverlayOn)
  }

  useEffect(() => {
    buildZoneOverlay()
  }, [zoneOverlayOn, version])

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
    sceneRef.current?.setLevel(activeZ, ghostOther)
  }, [activeZ, ghostOther])

  // 剖切 is the placed section surface plus the clip (`render/section.ts`): the
  // plane is written in place, so a slide costs two numbers and no rebuild.
  useEffect(() => {
    sceneRef.current?.setSection(section, cutaway)
  }, [section, cutaway])

  useEffect(() => {
    sceneRef.current?.setHideWalls(hideWalls)
  }, [hideWalls])

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
    const anyActive =
      dragRef.current?.active === true ||
      paintRef.current?.active === true ||
      zoneDragRef.current?.active === true ||
      facilityDragRef.current?.active === true
    if (!anyActive) return false
    dragRef.current = null
    paintRef.current = null
    zoneDragRef.current = null
    facilityDragRef.current = null
    setBuildMeasure(null)
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.setGhost([], 'remove')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setModulePreview(null)
    sceneRef.current?.setFencePreview(null)
    sceneRef.current?.setCollisionHighlight(null)
    return true
  }

  // ESC cancels any in-progress drag even when the pointer never moves again, and
  // Enter / ESC are the keyboard halves of 移动's 确认 / 取消 — which live in the 信息
  // card, so the keys are what makes the drop reachable without leaving the canvas.
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
      if (!st.moveDraft) return
      st.cancelMove()
      tools.move.clearPreview()
    }
    window.addEventListener('keydown', onCancelKey)
    return () => window.removeEventListener('keydown', onCancelKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A ghost belongs to a tool; leaving one must not strand a preview — and a piece
  // in the air is put back where it came from, because a lift is not an edit and
  // switching tools is not a way to lose one.
  useEffect(() => {
    hoverRef.current = null
    dragRef.current = null
    paintRef.current = null
    zoneDragRef.current = null
    facilityDragRef.current = null
    setBuildMeasure(null)
    useStore.getState().cancelMove(false)
    sceneRef.current?.setGhost([], 'add')
    sceneRef.current?.setGhost([], 'remove')
    sceneRef.current?.clearFaceGhost()
    sceneRef.current?.setCursor(null)
    sceneRef.current?.setModulePreview(null)
    sceneRef.current?.setFencePreview(null)
    sceneRef.current?.setCollisionHighlight(null)
  }, [tool])

  // Rotating (R), switching the equipment, or cycling its width, direction,
  // 闸机's lane or fence, and the 地基 tool's 半墙 mode or the side R stepped it to
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
    sceneRef.current = scene
    // The renderer on `window`, for the same reason the store is there (`boot.tsx`):
    // a browser-driven check can aim the camera at a corner and photograph it. Only
    // the live renderer, no copy, so a probe and the game cannot disagree.
    window.__scene = scene
    scene.onStats = (s) => useStore.getState().setStats(s)
    const resize = (): void => scene.resize(canvas.clientWidth, canvas.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    setFrameHandler((count, agents, density, trains, lifts, intervalMs, simTime) => {
      scene.setAgents(agents, count, intervalMs)
      scene.setTrains(trains)
      scene.setLifts(lifts)
      // The 电视 station plate prints the station clock, so it follows the sim.
      scene.setSimClock(simTime)
      if (overlayRef.current && graphNodesRef.current.length === density.length * 3) {
        scene.setDensity(graphNodesRef.current, density, true)
      }
    })
    const onPreset = (e: Event): void => {
      const k = (e as CustomEvent).detail as string
      scene.setPreset(k === '1' ? 'iso' : k === '2' ? 'plan' : k === '4' ? 'front' : k === '5' ? 'side' : 'custom')
      useStore.getState().setOrtho(k === '2' || k === '4' || k === '5')
    }
    const onFrame = (): void => scene.frame()
    const onDelete = (): void => {
      const st = useStore.getState()
      const sel = st.selected
      if (!sel || sel.kind !== 'cell') return
      const [x, y, z] = sel.key.split(',').map(Number)
      // A build-tool floor brings its auto-wall ring with it; a hand-built or
      // auto-wall block is just removed.
      const next = removeFloor(st.station, [[x, y, z]])
      st.commit(next)
      st.select(null)
    }
    // WASD pan (Shift = faster). Q/E layer stepping stays in the app. A text
    // field keeps its letters — a focused **button** does not, or clicking a rail
    // tile would stop WASD panning the camera afterwards.
    const panKeys = new Set(['w', 'a', 's', 'd', 'shift'])
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (panKeys.has(k)) scene.keys.add(k)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      scene.keys.delete(e.key.toLowerCase())
    }
    const onBlur = (): void => scene.keys.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('metro:preset', onPreset)
    window.addEventListener('metro:frame', onFrame)
    window.addEventListener('metro:delete', onDelete)
    return () => {
      setFrameHandler(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('metro:preset', onPreset)
      window.removeEventListener('metro:frame', onFrame)
      window.removeEventListener('metro:delete', onDelete)
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
      framedRef.current = false
    }
  }, [])

  // Rebuild the static meshes only when the station itself changes.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const st = useStore.getState()
    solidRef.current = new Set(station.cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)))
    thinRef.current = thinWallSideMap(station.cells, station.modules)
    // The board the editor is arranging, drawn where the sign it belongs to hangs —
    // and, for a piece 移动 has picked up, nothing at all: it is in the air,
    // so the translucent ghost under the pointer is the only copy drawn.
    const lifted = st.moveDraft?.module.id
    const modules = station.modules
      .filter((m) => m.id !== lifted)
      .map((m) => signModuleWithPreview(m, st.signPreview))
    scene.setStation(toData({ ...station, modules }))
    scene.setAutoCeiling(st.autoCeiling)
    scene.setLevel(st.activeZ, st.ghostOtherLevels)
    // The 剖切 surface is placed once, on the first build of a station: the
    // middle of its plan on the storey being edited, facing +y — the fixed cut
    // the old toggle drew. It is deliberately **not** re-placed on every edit,
    // so moving a wall never throws away the cut the player positioned.
    if (!sectionSeededRef.current) {
      sectionSeededRef.current = true
      st.placeSection(scene.defaultSection().anchor)
    }
    scene.setSection(useStore.getState().section, st.cutaway)
    // On a fresh page load the demo station must open on the home view; the
    // constructor's preset ran before the station existed, so frame it now. A
    // later edit rebuilds the station but must not yank the camera.
    if (!framedRef.current) {
      framedRef.current = true
      scene.setPreset('iso')
    }
  }, [version, station, signPreviewId, moveId])

  // A lifted piece (移动) is drawn from its own ghost, so a fresh lift or an R while
  // it is in the air rebuilds that ghost at once instead of waiting for the next
  // pointer move. When the lift ends the ghost goes with it — and a cancel is not a
  // commit, so nothing else has rebuilt the station to drop it: that is this effect's
  // job, which is what makes the card's 取消 clear the piece on screen. `version` is in
  // the list because a commit clears the ghost with the station (`setStation`), so an
  // edit made while a piece is in the air — an undo, say — puts it back on screen.
  useEffect(() => {
    if (useStore.getState().moveDraft) tools.move.refreshHover()
    else tools.move.clearPreview()
  }, [moveKey, version, tools])

  // Keep the 3D selection box in step with the inspector's selection. A rebuild
  // re-applies it inside setStation, so this only has to run on the id itself.
  useEffect(() => {
    sceneRef.current?.setSelection(selected?.kind === 'module' ? selected.key : null)
  }, [selected])

  const pickAt = (clientX: number, clientY: number): PickResult | null => {
    const scene = sceneRef.current
    if (!scene) return null
    return scene.pick(clientX, clientY, useStore.getState().activeZ)
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
  const onPointerDown = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene || e.button === 1) return
    // The section surface owns the pointer when it is under it, before any of
    // the drag cancellation below: a grab is not a second press on a tool drag.
    if (scene.sectionHit(e.clientX, e.clientY)) {
      e.preventDefault()
      const point = scene.sectionPoint(e.clientX, e.clientY)
      if (point) {
        const section = useStore.getState().section
        const n = sectionNormal(section.orientation)
        sectionDragRef.current = {
          from: point,
          startOffset: section.offset,
          orientation: section.orientation,
          plane: new Plane(new Vector3(n[0], n[1], n[2]), -n[0] * point[0] - n[1] * point[1] - n[2] * point[2]),
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
    const info = toInfo(e, pickAt(e.clientX, e.clientY))
    // 移动 (§9.5): a piece in the air owns the pointer, whichever tool was active
    // when the 信息 card lifted it.
    if (st.moveDraft) {
      tools.move.onDown(info)
      return
    }
    tools.byTool[st.tool].onDown(info)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene) return
    // 剖切: a slide in progress owns the move. The pointer is projected onto the
    // plane the grab started in — **not** onto the moving cut — so the surface
    // follows the mouse exactly, and it is snapped to the half metre (Shift:
    // 5 cm) so the cut lands on a round number of blocks.
    const drag = sectionDragRef.current
    if (drag) {
      const p = scene.sectionPoint(e.clientX, e.clientY)
      if (!p) return
      useStore.getState().setSectionOffset(snapOffset(slideOffset(drag.startOffset, drag.from, p, drag.orientation), e.shiftKey))
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
    if (hot) return
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
              ? 0
              : facilityDragRef.current?.active === true
                ? 2
                : null
      if (activeButton !== null) {
        const otherHeld = activeButton === 2 ? (e.buttons & 1) !== 0 : (e.buttons & 2) !== 0
        if (otherHeld) {
          cancelActiveDrag()
          return
        }
      }
    }
    const hit = pickAt(e.clientX, e.clientY)
    if (!hit) {
      hoverRef.current = null
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
   * wall runs (including the 地基 tool's right-press column lift) to 墙, and
   * plain block rectangles to 地基 — or to 删除 for its line-remove drag.
   */
  const ownerForRelease = (d: AreaDrag, current: Tool): ToolController => {
    if (d.modules !== undefined) return tools.delete
    if (d.fence === true) return current === 'delete' ? tools.delete : tools.equipment
    if (d.wall === true) return d.single === true ? tools.block : tools.wall
    return current === 'delete' ? tools.delete : tools.block
  }

  const onPointerUp = (e: React.PointerEvent): void => {
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
              ? 0
              : facilityDragRef.current?.active === true
                ? 2
                : null
      if (activeButton !== null && (e.button === 0 || e.button === 2) && e.button !== activeButton) {
        cancelActiveDrag()
        return
      }
      if (e.button === 1) return
    }
    const info = toInfo(e, pickAt(e.clientX, e.clientY))
    // Route to whichever drag is active; each controller nulls its own ref and
    // applies the release. No drag active means the press already committed
    // (click tools) and the release owns nothing.
    if (facilityDragRef.current?.active === true || zoneDragRef.current?.active === true) {
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
    cancelActiveDrag()
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={sectionHot ? 'viewport grab' : 'viewport'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          hoverRef.current = null
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
      {buildMeasure && (
        <div className="buildMeasure" style={{ left: buildMeasure.left + 14, top: buildMeasure.top + 14 }}>
          {buildMeasure.text}
        </div>
      )}
      <ViewCube sceneRef={sceneRef} />
    </>
  )
}
