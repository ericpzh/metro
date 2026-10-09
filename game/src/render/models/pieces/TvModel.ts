// Passenger-information screen (电视) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, ownedMaterial, slab, plate, plateOf, placeLocal } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { posterFor } from '../../../sim/billboards.ts'
import type { TvPairSlot } from '../../../sim/tvs.ts'
import type { Module } from '../../../sim/types.ts'
import { TV_POSTER_RECT } from '../../stationDisplay.ts'

/**
 * The 电视 and 广告牌 window: a lit pane sits inside a dark slab, and a plane that
 * is coplanar with the slab's surface z-fights it — which reads as a black window
 * rather than as a rendering fault. Every lit pane over a slab stands this far
 * proud of it. The 广告牌 uses 0.025 for the same reason.
 */
const LIT_STAND_OFF = 0.015

/**
 * How deep one 电视's panel is, either side of its own origin — the body of a single
 * screen, and half the body of a back-to-back pair. The pair is exactly two of these
 * and no more (`TV_PAIR_MARGIN` is the only slack), so a merged pair reads as two
 * screens back to back in a slim housing rather than as a metre-deep box: two thin
 * televisions, back to back.
 */
const TV_HALF_DEPTH = 0.05

/**
 * The seam between the two members of a pair, metres: their backing slabs stop this
 * far short of the cell's mid-plane so the two bodies touch but do not coincide. It
 * is also what a lone 电视 has always had between its backing and the screen centre,
 * so the same arithmetic gives both bodies.
 */
const TV_PAIR_MARGIN = 0.01

/**
 * Passenger-information screen (电视, 装饰): a slim dark bezel with a bright
 * screen, hung by two rods from the storey ceiling like the 指示牌. The floor top
 * is the local origin and the ceiling slab is one storey up (`LEVEL_STEPS`, 4 m =
 * local z 3.0), which is exactly what `ceilingMountMissing` required before it
 * could be placed.
 *
 * The screen is **two** lit panes, not one poster. Down the left is the station
 * board — line shield, 本趟 / 下趟 / 第三趟列车开往, the countdown and the clock —
 * drawn by `render/stationDisplay.ts` as one unlit texture, because it is authored
 * information rather than artwork. To its right is the **content window**: the
 * only part that carries artwork, and the only part the scene re-points on its own
 * cadence (`SceneRenderer.updateAdScreens`). A real platform TV is exactly this
 * shape — information beside the feed — so a poster never has to pretend to be a
 * departure board.
 *
 * **The board faces one way only.** The piece hangs against a wall or the platform
 * edge, so there is one viewing side: the local **−y** face. What the other side
 * shows is its own dark backing — a blank panel, which is what the back of a
 * television looks like. Both lit panes therefore ride the −y face of their backing
 * slab; putting one on the slab's centre line buries it, and the window then reads
 * as a black rectangle.
 *
 * **Two of them back to back are one piece of hardware.** A second 电视 on the same
 * cell turned to face the other way (`sim/tvs.ts`) is drawn as a *pair*: one housing,
 * one bezel, one pair of suspension rods, with a lit face each side — the concourse
 * screen a passage walked both ways hangs overhead. The housing is **two panels
 * thick** (`TV_HALF_DEPTH` either side of the cell's centre), because that is all the
 * object is: two thin televisions stood against each other. It deliberately does not
 * fill the cell — a metre-deep box reads as a chunk of concrete hung from the
 * ceiling, which is not what the piece is.
 *
 * Drawing the two solo models instead is not merely twice the geometry: the housing
 * is symmetric about its centre, so the two backings are left-half-coincident and the
 * station board lands exactly coplanar with the far face of the opposite backing. The
 * board then z-fights its neighbour and loses its outer 0.006 m to it
 * (`test/tv-pair.test.mjs` measures both). The pair branch below is what removes that:
 * each member's backing stops `TV_PAIR_MARGIN` short of the seam, and each lit face
 * sits proud of the surface the two screens share.
 */
function buildTv(ctx: ModuleContext, mod: Extract<Module, { type: 'tv' }>): THREE.Group {
  const g = new THREE.Group()
  const mats = ctx.mats
  // The screen is wider than one cell is deep, which is fine for hung hardware —
  // `ceilingMountMissing` only asks for a ceiling, and the piece is decor.
  const sw = 1.42
  const sh = 0.8
  const zc = 2.15 // screen centre above the floor top
  const ceiling = 3.0 // the storey ceiling underside
  // A lone 电视 is one slim panel (0.1 m through). A pair is **two** of them back to
  // back, not a box as deep as the cell: the two screens sit against each other and
  // the housing is only as thick as the pair of them.
  const slot: TvPairSlot = ctx.tvPairSlot?.(mod.id) ?? { hangs: true, depth: 0, rodId: mod.id }
  const paired = slot.depth > 0
  const bodyHalf = TV_HALF_DEPTH * (paired ? 2 : 1)
  const depth = bodyHalf * 2
  // Every lit pane prints on the local −y face, paired or not — that is the model the
  // station has always had. **Which side of the cell that lands on is `placeLocal`'s
  // job, not this one's**: the two members of a pair differ by a half-turn of `rot`,
  // so the same local face and the same local offsets come out on opposite sides of
  // the cell. Turning the panes here as well would cancel that half-turn and drop
  // both screens on one side — see the `depth` note in `sim/tvs.ts`.
  const surface = -bodyHalf
  // One pane's own dark backing, spanning from the body's mid-plane out to the body's
  // face less `TV_PAIR_MARGIN`. On a lone 电视 that is the 0.04 m slab it has always
  // had; on a pair the two of them meet 0.02 m apart down the middle of the cell,
  // where the shared housing hides the seam, instead of occupying each other's space.
  const backingDepth = bodyHalf - TV_PAIR_MARGIN
  const backingCentre = bodyHalf - backingDepth / 2
  // Only the element that hangs the pair carries the suspension: one rod pair and
  // one set of ceiling plates for the object, not two overlapping sets.
  if (!paired || slot.hangs) {
    for (const x of [-0.42, 0.42]) {
      slab(g, mats.steel, x, 0, (zc + sh / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + sh / 2) - 0.04)
      slab(g, mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
    }
  }
  // An open bezel frame around the screen, so the panel reads as a piece of
  // hardware rather than a floating image. Drawn once for the pair: a second frame
  // in the same cell would be coplanar with this one on all six faces.
  if (!paired || slot.hangs) {
    const bw = 0.07
    slab(g, mats.darkSteel, 0, 0, zc + sh / 2 + bw / 2, sw + 2 * bw, depth, bw)
    slab(g, mats.darkSteel, 0, 0, zc - sh / 2 - bw / 2, sw + 2 * bw, depth, bw)
    for (const x of [-(sw + bw) / 2, (sw + bw) / 2]) slab(g, mats.darkSteel, x, 0, zc, bw, depth, sh)
  }

  // The video overlays the full station plate; shared fractions keep the footer clear.
  const winW = sw * TV_POSTER_RECT.w
  const winX = -sw / 2 + sw * (TV_POSTER_RECT.x + TV_POSTER_RECT.w / 2)
  // The station plate covers the screen behind the video, leaving its footer visible.
  slab(g, mats.black, 0, -backingCentre, zc, sw, backingDepth, sh)
  const plateTex = ctx.tvPlate(mod.id, mod.x + 0.5, mod.y + 0.5)
  plateTex.wrapS = THREE.ClampToEdgeWrapping
  plateTex.repeat.set(1, 1)
  plateTex.offset.set(0, 0)
  const plateMesh = plate(g, ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: plateTex })), sw, sh, 0, surface - LIT_STAND_OFF, zc, 0)
  plateMesh.renderOrder = 1
  plateMesh.userData.adStationPlate = mod.id

  // Content window: the artwork, cropped to the window's aspect. The scene may
  // re-point this at another poster later, so the mesh is registered by role and
  // the module's frozen slug is only the opening frame.
  const winH = sh * TV_POSTER_RECT.h
  const winZ = zc + sh / 2 - sh * (TV_POSTER_RECT.y + TV_POSTER_RECT.h / 2)
  const poster = posterFor(mod.cfg.poster)
  const face = ctx.ads.adFace(poster.slug, winW, winH)
  // **Proud of its own backing, and clear of it.** Both the board and the window
  // are slabs; a lit pane on the slab's centre line is buried in it, and one on the
  // slab's surface merely z-fights it — either way the window renders as a flat
  // black rectangle with no error anywhere. The pane goes half a slab out plus a
  // stand-off, the same relationship the 广告牌 uses for its poster.
  const screen = plateOf(g, face.geometry, face.material, winX, surface - LIT_STAND_OFF - 0.001, winZ, 0)
  screen.renderOrder = 2
  screen.userData.adPoster = poster.slug
  screen.userData.adWindow = { x: winX, z: winZ, w: winW, h: winH }
  // Power / status light on the lower bezel, on this element's own side.
  plate(g, mats.ledGreen, 0.05, 0.05, sw / 2 - 0.09, surface - 0.005, zc - sh / 2, 0)
  g.userData.adScreen = screen
  return g
}

export class TvModel extends PieceBuilder {
  readonly kind = 'tv'
  build(mod: Extract<Module, { type: 'tv' }>): THREE.Group {
    return placeLocal(buildTv(this.ctx, mod), mod)
  }
}

