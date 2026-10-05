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
import { drawStationDisplay, STATION_PLATE, tvLineStatus } from '../../stationDisplay.ts'
import { drawSignPanel } from '../../signFace.ts'
import { signBoardsOf, signBoardsPanel, signFaceLayout, signPlate } from '../../../sim/sign.ts'
import type { SignLayout, SignPanelSize } from '../../../sim/sign.ts'
import type { StationData } from '../../../sim/types.ts'
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

  /**
   * The lit station plate for one 电视: the frame the content window sits inside.
   *
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
