// PlateSystem — printed light: the 电视 station plates, the 指示牌 faces and
// the 装饰/电视 artwork windows with their refresh cadence (moved verbatim from
// `render/scene.ts`: `makeTvPlate`, `clearTvPlates`, `makeSignPlate`,
// `redrawSignPlates`, `clearSignPlates`, `setSimClock`, `updateAdScreens`).
//
// A plate is a document render that exists only to light its model mesh, which
// is why the textures live here and are rebuilt with the modules they belong
// to. The 电视 content window is the exception: the plate around it never
// changes, only the artwork inside cycles, on its own cadence per screen.

import * as THREE from 'three'
import { canvasTexture, litPanelMaterial } from '../../models.ts'
import type { PrintedFace } from '../../models.ts'
import { drawStationDisplay, STATION_PLATE, tvLineStatus } from '../../stationDisplay.ts'
import { calligraphyPlate, drawCalligraphyPanel } from '../../calligraphyFace.ts'
import { drawLineMapPlaceholder, lineMapPlaceholderPlate } from '../../lineMapFace.ts'
import { drawSignPanel } from '../../signFace.ts'
import { calligraphyPanelSize } from '../../../sim/calligraphy.ts'
import { lineMapSpec } from '../../../sim/linemaps.ts'
import { signBoardsOf, signBoardsPanel, signFaceLayout, signPlate } from '../../../sim/sign.ts'
import type { SignLayout, SignPanelSize } from '../../../sim/sign.ts'
import type { CalligraphyAxis, CalligraphyStyle, Module, StationData } from '../../../sim/types.ts'
import { SceneSystem } from './SceneSystem.ts'
import type { SceneContext } from './SceneSystem.ts'

/** The cache key of one 指示牌 face: the module, the side, and the panel's own size. */
function signPlateKey(id: string, face: 'left' | 'right', panel: SignPanelSize): string {
  return `${id}|${face}|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`
}

/**
 * How long a 电视 window holds one piece of content before the feed changes it.
 * The range is the point: each screen rolls its own period, so a row of them
 * drifts apart instead of flipping as one wall.
 */
const TV_SWAP_MIN_MS = 6000
const TV_SWAP_MAX_MS = 20000
/** Stagger the first swap so screens do not all change on the first frame. */
export const TV_FIRST_SWAP_MS = 1200
export const TV_SWAP_JITTER_MS = 9000

export class PlateSystem extends SceneSystem {
  /** Wall-mounted 装饰 screens; the poster material each prints is frozen. */
  adScreens: THREE.Mesh[] = []
  /**
   * Live 电视 content windows. Each swaps the artwork in its little window on its
   * own cadence, so a row of them is not one synchronised wall — the frame around
   * it (the station plate) never changes.
   */
  tvScreens: Array<{ screen: THREE.Mesh; moduleId: string; poster: string; nextAt: number }> = []
  /** The lit station plate per 电视 module, drawn from the live document. */
  tvPlates = new Map<string, THREE.CanvasTexture>()
  /**
   * The lit face of each 指示牌 per side (`id|left`, `id|right`), composed from the
   * module's own layout. A board's plate is a document render like the 电视's — it
   * exists only to light the drawn model, which is why both live here and are
   * rebuilt with the modules they belong to.
   */
  signPlates = new Map<string, { texture: THREE.CanvasTexture; material: THREE.Material; face: 'left' | 'right' }>()
  /**
   * The printed faces of the two 装饰 pieces that carry the station's own words: a
   * 站名's ink (the station's name, in the piece's hand and axis) and a 线网图's board
   * (the supplied 线网示意图, or the drawn placeholder board until its pixels land).
   * Keyed `id|kind|what it prints`, so a piece whose hand or axis was changed is a new
   * face rather than a repaint — the same mechanism the 指示牌's faces use, for the same
   * reason: they exist only to light the mesh they are bolted to.
   *
   * `owned` says whether **this system** minted the pixels. The map's board is the art
   * cache's (`render/lineMapArt.ts`) and is shared by every map on the same panel, so
   * it is retained and released by that cache and never disposed from here.
   */
  decorPlates = new Map<string, { face: PrintedFace; owned: boolean; kind: 'calligraphy' | 'linemap' }>()
  /**
   * What the 电视 plates were last drawn from: the station's name and, for every
   * line, everything the board prints — its name, colour, direction, both termini,
   * its peak headway and the travel axis the countdown is measured along.
   * Those are the only inputs a **rebuild** can change (the clock and the
   * next-train countdown are redrawn in place by `setSimClock`), so a change to
   * any of them reprints every plate, and nothing else does. A field left out of
   * the stamp is a board that keeps printing the line as it was: the plate is
   * retained by module id, so a rename or a new terminus would never be redrawn.
   */
  private tvPlateStamp = ''
  /**
   * Every plate texture this system minted. A lit face wraps one of these, and the
   * two places that free a builder-minted material's map (`ModuleSystem.clearModules`,
   * `GhostSystem.clearModulePreview`) have to leave a retained plate's pixels alone —
   * the plate outlives the mesh it is printed on.
   */
  private mintedTextures = new WeakSet<THREE.Texture>()

  /** True for a texture this system owns — a 电视 plate or a 指示牌 face. */
  ownsTexture(tex: THREE.Texture | null | undefined): boolean {
    return tex !== null && tex !== undefined && this.mintedTextures.has(tex)
  }

  constructor(ctx: SceneContext) {
    super(ctx)
  }

  /** Release every 电视 station plate. The meshes they were painted for are gone. */
  clearTvPlates(): void {
    for (const tex of this.tvPlates.values()) tex.dispose()
    this.tvPlates.clear()
  }

  /**
   * Keep the plates of the 电视 the document still has, and drop the rest.
   *
   * A rebuild used to dispose every plate and redraw it — a 640×304 canvas and its
   * upload per television — for an edit that touched one wall. The plate is a
   * function of the module's id (its position only moves the next-train countdown,
   * which `setSimClock` refreshes every minute).
   */
  retainTvPlates(data: StationData): void {
    const stamp = `${data.name}|${data.lines
      .map((l) => `${l.id},${l.name},${l.colour},${l.direction},${l.upTerminus},${l.downTerminus},${l.headwayProfile.peak},${l.travelSign}`)
      .join('|')}`
    if (stamp !== this.tvPlateStamp) {
      this.tvPlateStamp = stamp
      this.clearTvPlates()
      return
    }
    const keep = new Set<string>()
    for (const mod of data.modules) if (mod.type === 'tv') keep.add(mod.id)
    for (const [id, tex] of [...this.tvPlates]) {
      if (keep.has(id)) continue
      tex.dispose()
      this.tvPlates.delete(id)
    }
  }

  /**
   * Keep every 指示牌 face whose module, side and panel are unchanged, and drop the
   * rest. Each face is a 512 px/m canvas (≈1.2 MB for a 2 m board), so wiping them
   * all per edit was the most expensive part of a rebuild after the chunks. What is
   * kept is the canvas, its texture and its material: `redrawSignPlates` still
   * repaints the pixels from the live document, so a 线路 edit reaches a retained
   * face, and only the allocation is saved.
   */
  retainSignPlates(data: StationData): void {
    const keep = new Set<string>()
    for (const mod of data.modules) {
      if (mod.type !== 'sign') continue
      const panel = signBoardsPanel(signBoardsOf(mod.cfg, data))
      keep.add(signPlateKey(mod.id, 'left', panel))
      keep.add(signPlateKey(mod.id, 'right', panel))
    }
    for (const [key, entry] of [...this.signPlates]) {
      if (keep.has(key)) continue
      entry.texture.dispose()
      entry.material.dispose()
      this.signPlates.delete(key)
    }
  }

  /** Release every 指示牌 face. Called with the modules, like `clearTvPlates`. */
  clearSignPlates(): void {
    for (const entry of this.signPlates.values()) {
      entry.texture.dispose()
      // The material is minted per face and per rebuild, so it goes with the texture
      // it wraps: `disposeObject` keeps materials (most are shared), so this is the
      // only thing that frees these.
      entry.material.dispose()
    }
    this.signPlates.clear()
  }

  /**
   * The lit face of one 指示牌 on one side, cached per module **and panel**.
   *
   * `layout` is that face's own board — 正面 for the left face, 背面 for the right —
   * and it is drawn by `render/signFace.ts` with the line shields reading the
   * **live** station document, so recolouring 1号线 reprints every board that
   * carries its shield and nothing else about the sign has to change.
   *
   * The texture is cut to the **pair's panel** (`signBoardsPanel`), not to the face
   * on it: the two faces are two plates on one piece of hardware, so they share a
   * size, and a short back prints on the same steel as a long front. That size is
   * part of the cache key — a sign that grew since its plate was minted needs a new
   * texture, not a redraw, so the key carries the panel's metres and a stale entry
   * can never be handed to a mesh cut to a different size.
   *
   * What goes back to the model is a **material** — a `MeshBasicMaterial` whose map
   * is that texture, exactly as every other printed panel in `models.ts` is built.
   * Returning the bare texture was the bug that left every sign face black: a mesh
   * cannot draw a texture in place of a material, so the face vanished and the
   * model's own dark lightbox showed through.
   */
  makeSignPlate(id: string, layout: SignLayout, face: 'left' | 'right', panel: SignPanelSize): THREE.Material {
    const key = signPlateKey(id, face, panel)
    const existing = this.signPlates.get(key)
    if (existing) return existing.material
    const lines = this.ctx.stationData?.lines ?? []
    const plate = signPlate(panel)
    const texture = canvasTexture(plate.width, plate.height, (g) => {
      drawSignPanel(g, layout, { lines, panel }, face)
    })
    const material = litPanelMaterial(texture)
    this.mintedTextures.add(texture)
    this.signPlates.set(key, { texture, material, face })
    return material
  }

  /**
   * Redraw every 指示牌 face in place, from the live document.
   *
   * A board prints the station's lines (a shield's colour, its number, its gloss)
   * and the player's own components. Its components come from the module
   * document, so a layout edit rebuilds the plate with the modules — but a *line*
   * edit is a different shape of change, and this is where it lands: every face
   * already hanging reprints, keeping its geometry and material, exactly like the
   * 电视's clock. `setStation` calls it before the rebuild, so a recoloured shield
   * reaches the boards a 线路 edit never touched.
   */
  redrawSignPlates(): void {
    if (this.signPlates.size === 0) return
    const lines = this.ctx.stationData?.lines ?? []
    for (const [key, entry] of this.signPlates) {
      const id = key.slice(0, key.indexOf('|'))
      const mod = this.ctx.stationData?.modules.find((m) => m.id === id)
      if (!mod || mod.type !== 'sign') continue
      const boards = signBoardsOf(mod.cfg, this.ctx.stationData)
      const layout = signFaceLayout(boards, entry.face === 'right' ? 'back' : 'front')
      const canvas = entry.texture.image as HTMLCanvasElement | undefined
      const g = canvas?.getContext('2d')
      if (!canvas || !g) continue
      // A board that grew or shrank since the plate was minted needs a new
      // texture, not a redraw: the mesh's own size is rebuilt with the modules, so
      // the plate only has to match the geometry it is drawn on.
      const panel = signBoardsPanel(boards)
      const plate = signPlate(panel)
      if (canvas.width !== plate.width || canvas.height !== plate.height) continue
      drawSignPanel(g, layout, { lines, panel }, entry.face)
      entry.texture.needsUpdate = true
    }
  }

  /* ------------------------------------- the station's own words (装饰) */

  /**
   * The cache key of one 站名 or 线网图 face: the module **and** what it prints.
   *
   * The two pieces carry the station's own words rather than a composed document, so
   * what their plate depends on is the piece's own choice (a hand and an axis, a
   * panel's size) — and the *document* behind it, which is why `redrawDecorPlates`
   * repaints rather than re-keys when the station is renamed or a line is
   * recoloured. A key includes the piece so two inscriptions in the same hand on
   * different panels are two textures, exactly as two 指示牌 faces are.
   */
  private decorPlateKey(mod: Module): string | null {
    if (mod.type === 'calligraphy') {
      const axis = mod.cfg?.axis === 'v' ? 'v' : 'h'
      const panel = calligraphyPanelSize(axis, mod.w, mod.panelH)
      return `${mod.id}|calligraphy|${mod.cfg?.style ?? 'kai'}|${axis}|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`
    }
    if (mod.type === 'linemap') {
      const spec = lineMapSpec(mod.cfg?.mount)
      return `${mod.id}|linemap|${spec.panelW.toFixed(3)}x${spec.panelH.toFixed(3)}`
    }
    return null
  }

  /**
   * Keep every inscription and map whose module and parameters are unchanged, and
   * drop the rest — the same bargain `retainSignPlates` makes, for the same reason:
   * the plate is the expensive part of a rebuild (a 512 px/m canvas per piece), and
   * `redrawDecorPlates` still repaints the pixels from the live document, so what is
   * saved is the allocation and not the accuracy.
   */
  retainDecorPlates(data: StationData): void {
    const keep = new Set<string>()
    for (const mod of data.modules) {
      const key = this.decorPlateKey(mod)
      if (key !== null) keep.add(key)
    }
    const drop = (entry: { face: PrintedFace; owned: boolean }): void => {
      if (!entry.owned) return
      entry.face.texture?.dispose()
      entry.face.material.dispose()
    }
    for (const [key, entry] of [...this.decorPlates]) {
      // A **placeholder** map board is dropped the moment the supplied poster is in
      // hand: its key is the same, so leaving it in the cache would keep the drawn
      // board on the wall for the session instead of the artwork.
      const stalePlaceholder = entry.kind === 'linemap' && entry.owned && this.ctx.lineMaps?.ready() === true
      if (!stalePlaceholder && keep.has(key)) continue
      drop(entry)
      this.decorPlates.delete(key)
    }
  }

  /** Release every 站名 / 线网图 face this system minted. The art cache keeps its own. */
  clearDecorPlates(): void {
    for (const entry of this.decorPlates.values()) {
      if (!entry.owned) continue
      entry.face.texture?.dispose()
      entry.face.material.dispose()
    }
    this.decorPlates.clear()
  }

  /**
   * The ink of one 站名: the **live** station name, in the piece's hand and axis,
   * cut to the panel the piece carries.
   *
   * A material, like every other printed face here — and a **transparent** one, since
   * an inscription is brush strokes on the wall rather than a printed board: the
   * pixels the brush does not cover must be the wall's, not a ground of the plate's.
   */
  makeCalligraphyPlate(id: string, spec: { style: CalligraphyStyle; axis: CalligraphyAxis; panel: { w: number; h: number } }): PrintedFace {
    const key = `${id}|calligraphy|${spec.style}|${spec.axis}|${spec.panel.w.toFixed(3)}x${spec.panel.h.toFixed(3)}`
    const existing = this.decorPlates.get(key)
    if (existing) return existing.face
    const text = this.ctx.stationData?.name ?? ''
    const plate = calligraphyPlate(spec.panel)
    const texture = canvasTexture(plate.width, plate.height, (g) => {
      drawCalligraphyPanel(g, { text, style: spec.style, axis: spec.axis, panel: spec.panel })
    })
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.FrontSide })
    this.mintedTextures.add(texture)
    const face: PrintedFace = { material, texture }
    this.decorPlates.set(key, { face, owned: true, kind: 'calligraphy' })
    return face
  }

  /**
   * The board of one 线网图: the **supplied poster** once its pixels are in hand
   * (`render/lineMapArt.ts`), and the drawn placeholder board before that.
   *
   * One face serves **both** faces of the free-standing totem — each is its own plane
   * turned to its own side, so neither is a mirror of the other and the one map reads
   * correctly from either. The art's quad carries the poster's own UV window (a real
   * image is cropped to the panel, never stretched), which is why a face carries its
   * geometry as well as its material: the drawn placeholder is cut to the panel and
   * needs no window of its own.
   */
  makeLineMapPlate(id: string, panel: { w: number; h: number }): PrintedFace {
    const key = `${id}|linemap|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`
    const existing = this.decorPlates.get(key)
    if (existing) return existing.face
    const art = this.ctx.lineMaps
    if (art?.ready()) {
      const painted = art.face(panel.w, panel.h)
      // The art owns its texture and material (every map on this panel shares them), so
      // the ownership tests that free a module's maps must leave them alone.
      if (painted.material.map) this.mintedTextures.add(painted.material.map)
      const face: PrintedFace = { material: painted.material, geometry: painted.geometry }
      this.decorPlates.set(key, { face, owned: false, kind: 'linemap' })
      return face
    }
    const lines = this.ctx.stationData?.lines ?? []
    const stationName = this.ctx.stationData?.name ?? ''
    const plate = lineMapPlaceholderPlate(panel)
    const texture = canvasTexture(plate.width, plate.height, (g) => {
      drawLineMapPlaceholder(g, { lines, stationName, panel })
    })
    const material = litPanelMaterial(texture)
    this.mintedTextures.add(texture)
    const face: PrintedFace = { material, texture }
    this.decorPlates.set(key, { face, owned: true, kind: 'linemap' })
    return face
  }

  /**
   * Redraw every **drawn** inscription and placeholder map in place, from the live
   * document.
   *
   * This is where a **rename** and a **line edit** land: the plates outlive the meshes
   * they are printed on (they are retained by key), so without this a station renamed
   * after its 站名 was hung would keep its old name on the wall for the session.
   * Redrawing rather than re-keying keeps the allocations, exactly as
   * `redrawSignPlates` does for the 指示牌's shields.
   *
   * The map's **artwork** is a supplied poster and does not depend on the document, so
   * its face is skipped — a line edit cannot change a picture of the whole network.
   */
  redrawDecorPlates(): void {
    if (this.decorPlates.size === 0) return
    const data = this.ctx.stationData
    if (!data) return
    for (const [key, entry] of this.decorPlates) {
      if (!entry.owned || !entry.face.texture) continue
      const id = key.slice(0, key.indexOf('|'))
      const mod = data.modules.find((m) => m.id === id)
      if (!mod) continue
      const canvas = entry.face.texture.image as HTMLCanvasElement | undefined
      const g = canvas?.getContext('2d')
      if (!canvas || !g) continue
      if (mod.type === 'calligraphy') {
        const axis = mod.cfg?.axis === 'v' ? 'v' : 'h'
        const panel = calligraphyPanelSize(axis, mod.w, mod.panelH)
        const plate = calligraphyPlate(panel)
        // A panel that changed size needs a new texture, not a repaint: the mesh's
        // own geometry is rebuilt with the modules, so the plate only has to match it.
        if (canvas.width !== plate.width || canvas.height !== plate.height) continue
        // The ink has no ground, so the old strokes have to be taken off the canvas
        // before the new ones go down — a redraw over a redraw would double-print.
        g.clearRect(0, 0, canvas.width, canvas.height)
        drawCalligraphyPanel(g, { text: data.name, style: mod.cfg?.style ?? 'kai', axis, panel })
        entry.face.texture.needsUpdate = true
      } else if (mod.type === 'linemap') {
        const spec = lineMapSpec(mod.cfg?.mount)
        const panel = { w: spec.panelW, h: spec.panelH }
        const plate = lineMapPlaceholderPlate(panel)
        if (canvas.width !== plate.width || canvas.height !== plate.height) continue
        // The placeholder board paints its own ground edge to edge, so it needs no
        // clearing.
        drawLineMapPlaceholder(g, { lines: data.lines, stationName: data.name, panel })
        entry.face.texture.needsUpdate = true
      }
    }
  }

  /**
   * The lit station plate for one 电视: the frame the content window sits inside.   *
   * It is station information, not artwork, so it is drawn from the live document
   * — the line's own name, colour and terminus, the clock, and how close the next
   * train is — and cached per module. It only has to be redrawn when one of those
   * changes, which `setSimClock` does once a minute rather than every frame.
   *
   * The line is the station's **first** line. A 电视 is ceiling furniture rather
   * than platform equipment, so it belongs to no platform and carries no line of
   * its own; once a station runs several lines, this is the one place to revisit
   * (a board per platform would want the line whose track is nearest).
   */
  makeTvPlate(id: string, x: number, y: number): THREE.Texture {
    const existing = this.tvPlates.get(id)
    if (existing) return existing
    const line = this.ctx.stationData?.lines[0]
    const status = line ? tvLineStatus(line, this.ctx.trainPoses, [x, y]) : null
    const t = canvasTexture(STATION_PLATE.width, STATION_PLATE.height, (g) => {
      drawStationDisplay(g, status, this.ctx.stationData?.name ?? '', this.ctx.clockText)
    })
    this.mintedTextures.add(t)
    this.tvPlates.set(id, t)
    return t
  }

  /**
   * The simulation clock, printed in the plate's information column. Called from
   * the worker's state frame. When the printed minute changes, every plate is
   * redrawn in place — the meshes keep their geometry and material, so nothing
   * rebuilds but the pixels.
   */
  setSimClock(simTime: number): void {
    const h = Math.floor(simTime / 3600) % 24
    const mm = Math.floor((simTime % 3600) / 60)
    const next = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    if (next === this.ctx.clockText) return
    this.ctx.clockText = next
    for (const [id, tex] of this.tvPlates) {
      const canvas = tex.image as HTMLCanvasElement
      const g = canvas.getContext('2d') as CanvasRenderingContext2D
      const line = this.ctx.stationData?.lines[0]
      const mod = this.ctx.stationData?.modules.find((m) => m.id === id)
      const status = line ? tvLineStatus(line, this.ctx.trainPoses, [mod ? mod.x + 0.5 : 0.5, mod ? mod.y + 0.5 : 0.5]) : null
      drawStationDisplay(g, status, this.ctx.stationData?.name ?? '', this.ctx.clockText)
      tex.needsUpdate = true
    }
  }

  /**
   * The content window's cadence. A 电视 updates the *feed* in its window every so
   * often, so this swaps the artwork — never the station plate around it — on a
   * period drawn per screen from the kit's own range, with a fresh period rolled
   * after each swap. Two screens side by side therefore drift apart instead of
   * flipping together, which is what the reference photo's wall of TVs looks like.
   */
  updateAdScreens(now: number): void {
    for (const tv of this.tvScreens) {
      if (now < tv.nextAt) continue
      const win = tv.screen.userData.adWindow as { x: number; z: number; w: number; h: number } | undefined
      if (win && this.ctx.ads) {
        const next = this.ctx.ads.adWindow(win.w, win.h)
        // The quad is `adArt`'s and is shared with every screen on this panel size,
        // so it is never disposed here — only re-pointed. The material is shared
        // from the ad cache too, so it is only dropped, never disposed.
        tv.screen.geometry = next.geometry
        tv.screen.material = next.material
        tv.screen.userData.adPoster = next.slug
        tv.poster = next.slug
      }
      tv.nextAt = now + TV_SWAP_MIN_MS + Math.random() * (TV_SWAP_MAX_MS - TV_SWAP_MIN_MS)
    }
  }
}
