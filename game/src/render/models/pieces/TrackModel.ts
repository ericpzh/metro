// Track bed builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { TRACK_BED_DROP } from '../../../sim/constants.ts'
import { STOCK, TRAIN_ORIGIN_Z, trainOriginForScale, trainScaleForStorey } from '../../../sim/stock.ts'
import { PieceBuilder, slab, finishSlab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { BRIDGE_DECK_DEPTH, bridgeBarrierTop } from '../../../sim/structures.ts'
import { thirdRailSide, trackSideFixtureOffset, trackCeilingUnderside } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'
import { buildTrackCatenary } from './CatenaryModel.ts'
import { buildTrackDetails } from './TrackDetails.ts'
import { buildBridgeNoiseBarrier } from './BridgeNoiseBarrier.ts'
import { neighboringGantryPosts, trackGantryLayout } from './TrackGantry.ts'
import { buildBridgeEdgeConcrete } from './BridgeEdgeConcrete.ts'
import { buildBridgeRailing } from './BridgeRailing.ts'

/* ------------------------------------------------------------------ track */

/**
 * A flat arrow lying on the bed, pointing along local +x (or −x when `flip`).
 * Used only by the placement ghost, so the player sees which way the track's
 * 上行/下行 direction runs before committing.
 */
function buildDirectionArrow(mat: THREE.Material, x: number, y: number, z: number, flip: boolean): THREE.Group {
  const g = new THREE.Group()
  const shape = new THREE.Shape()
  // A bold arrow: shaft from −1.1 to 0.4, head reaching 1.6, ~1.4 m across.
  const shaft = 0.22
  const headBase = 0.4
  const headHalf = 0.72
  shape.moveTo(-1.1, -shaft)
  shape.lineTo(headBase, -shaft)
  shape.lineTo(headBase, -headHalf)
  shape.lineTo(1.6, 0)
  shape.lineTo(headBase, headHalf)
  shape.lineTo(headBase, shaft)
  shape.lineTo(-1.1, shaft)
  shape.closePath()
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat)
  g.add(mesh)
  g.position.set(x, y, z)
  // The shape lies flat on the bed; flip it 180° for a 下行 run.
  if (flip) g.rotation.z = Math.PI
  return g
}

function buildTrack(mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, concrete: THREE.Material, railWeb: THREE.Material, preview = false, deckMat: THREE.Material = mats.white, thirdRail: 1 | -1 = -1, neighborPosts: readonly { x: number; y: number }[] = [], vehicleWidth = 0, ceilingZ?: number): THREE.Group {
  const g = new THREE.Group()
  const d = mod.d ?? 1
  // Build in the track's local frame: the run along +x, the amount across +y,
  // the origin cell's centre at (0, 0). The group is then turned and moved into
  // the world, so a quarter-turned piece runs north–south.
  const cx = (mod.w - 1) / 2
  const cy = (d - 1) / 2
  // Continue the screen-door centre line across the platform/bridge join.
  const bridgeSupportOffset = trackSideFixtureOffset(d, vehicleWidth)
  const bridgeSpan = Math.max(d, bridgeSupportOffset * 2 + 0.12)
  const scale = trainScaleForStorey(mod.storeyHeight)
  const hardwareLift = trainOriginForScale(scale) - TRAIN_ORIGIN_Z * scale
  const bedTop = (0.45 - TRACK_BED_DROP) * scale + hardwareLift
  // The bed is a trench: placing the rail dug the cell, so the platform top
  // drops below the running gear to this recessed slab. The exposed block sides form the trench
  // walls; the module only supplies the bed and the power supply on top.
  // Fill the dug lower block completely. The rail datum stays recessed, but
  // its concrete underside meets neighbouring blocks on the integer grid.
  if (!mod.cfg.bridge) finishSlab(g, concrete, cx, cy, (bedTop - 1) / 2, mod.w, d, bedTop + 1).name = 'track-bed'
  // Raised centre slab leaves the drainage troughs below the sleeper bearing surface.
  finishSlab(g, concrete, cx, cy, bedTop + .02, mod.w, Math.max(0.8, d - 0.52), 0.04)
  if (mod.cfg.bridge) {
    // A recessed concrete trough above the unchanged pier seats (§5.4). Edge girders previously shared its outer
    // face, making the underside flicker as the camera moved.
    finishSlab(g, deckMat, cx, cy, (bedTop - BRIDGE_DECK_DEPTH) / 2, mod.w, bridgeSpan, BRIDGE_DECK_DEPTH + bedTop).name = 'bridge-deck'
    const gantry = trackGantryLayout(mod, thirdRail, vehicleWidth)
    for (const y of [cy - bridgeSupportOffset, cy + bridgeSupportOffset]) {
      const ownPostXs = gantry?.ys.some(postY => Math.abs(postY - y) < 0.12) ? gantry.xs : []
      const soundBarrier = mod.cfg.bridgeRailing === 'sound-barrier' || mod.cfg.bridgeRailing === 'sound-barrier-half'
      const shoulderDepth = (bridgeSpan - d) / 2
      const shoulderY = cy + Math.sign(y - cy) * (d / 2 + shoulderDepth / 2)
      const postXs = [
        ...ownPostXs,
        ...neighborPosts.filter(post => Math.abs(post.y - y) < 0.12 - 1e-6).map(post => post.x),
      ]
      buildBridgeEdgeConcrete(g, deckMat, mod.w, shoulderY, shoulderDepth, soundBarrier ? 0.5 : 0.55, postXs, bedTop)
      if (mod.cfg.bridgeRailing === 'sound-barrier' || mod.cfg.bridgeRailing === 'sound-barrier-half') {
        buildBridgeNoiseBarrier(g, mats, mod.w, y, bridgeBarrierTop(mod.cfg.bridgeRailing), ownPostXs.length > 0, neighborPosts)
      } else {
        buildBridgeRailing(g, mats, mod.w, y, ownPostXs.length > 0)
      }
    }
  }
  if (!mod.cfg.bridge) for (const side of [-1, 1]) finishSlab(g, concrete, cx, cy + side * (d / 2 - .025), bedTop / 2, mod.w, .05, -bedTop).name = 'track-trench-wall'
  const hardware = new THREE.Group()
  hardware.scale.set(1,scale,scale); hardware.position.set(0,cy*(1-scale),hardwareLift); g.add(hardware)
  buildTrackDetails(hardware, mats, concrete, railWeb, mod.w, d)
  // The line's 供电 decides the model: a conductor rail beside the running
  // rails, or an overhead wire hung over them. Both are drawn for every piece
  // bound to the line, platform and tunnel alike, so a power switch re-cuts all
  // of them when the module meshes are rebuilt. The conductor rail sits on the
  // travel right in tunnels/bridges, or off the platform side at a station
  // (see `thirdRailSide`).
  if (mod.cfg.power === 'catenary') buildTrackCatenary(g, mats, mod, thirdRail, vehicleWidth, ceilingZ)
  else buildThirdRail(hardware, mats, mod.w, cx, cy, thirdRail)
  // The ghost carries the travel direction (上行/下行) as arrows along the run.
  if (preview) {
    const flip = mod.cfg.dir === 'down'
    const n = Math.max(1, Math.min(8, Math.round(mod.w / 18)))
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * mod.w - 0.5
      g.add(buildDirectionArrow(mats.glow, x, cy, 0.82, flip))
    }
  }
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2
  return g
}

/**
 * 第三轨: a guarded conductor rail on one long edge of the bed. The side is the
 * travel right — local −y for 上行, local +y for 下行 — except a platform rail
 * with screens on exactly one side, which takes the side with no 屏蔽门 so the
 * live rail stays off the platform (the transition happens before the station).
 */
function buildThirdRail(g: THREE.Group, mats: ModelMaterials, w: number, cx: number, cy: number, side: 1 | -1 = -1): void {
  const firstPart = g.children.length
  const ty = cy + side * 1.05
  // The live rail, sitting on ceramic insulators above the sleepers.
  slab(g, mats.darkSteel, cx, ty, 0.62, w, 0.09, 0.09)
  // A yellow protective cover arches over it, as a capping board on a real
  // conductor rail does, so the third rail reads at a glance. The cap overhangs
  // outward, away from the running rails.
  slab(g, mats.psu, cx, ty + side * 0.12, 0.8, w, 0.34, 0.05)
  slab(g, mats.psu, cx, ty + side * 0.28, 0.7, w, 0.05, 0.22)
  const n = Math.max(2, Math.round(w / 4))
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w - 0.5
    slab(g, mats.darkSteel, x, ty, 0.5, 0.24, 0.28, 0.025)
    slab(g, mats.white, x, ty, 0.54, 0.13, 0.13, 0.08)
    slab(g, mats.darkSteel, x, ty, 0.59, 0.2, 0.17, 0.025)
  }
  for (const part of g.children.slice(firstPart)) part.position.z -= TRACK_BED_DROP

}

export class TrackModel extends PieceBuilder {
  readonly kind = 'track'
  build(mod: Extract<Module, { type: 'track' }>): THREE.Group {
    const railWeb = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: 0x62564c, roughness: 0.82, metalness: 0.25 }))
    const data = this.ctx.data
    const edges = data?.modules.filter((m): m is Extract<Module, { type: 'platform-edge' }> => m.type === 'platform-edge') ?? []
    const line = data?.lines.find((l) => l.id === mod.cfg.line)
    const lineDir = line?.direction
    const side = thirdRailSide(mod, edges, lineDir)
    const tracks = mod.cfg.bridge ? (data?.modules ?? []).flatMap(m => {
      if (m.type !== 'track') return []
      return [m]
    }) : []
    const neighborPosts = neighboringGantryPosts(mod, tracks, edges, data?.lines)
    return buildTrack(this.ctx.mats, mod, this.ctx.finish('floor.concrete'), railWeb, this.ctx.preview, this.ctx.finish(mod.cfg.bridgeFinish ?? 'floor.concrete'), side, neighborPosts, line ? STOCK[line.stock].width : 0, trackCeilingUnderside(mod, data?.cells) - mod.z)
  }
}

