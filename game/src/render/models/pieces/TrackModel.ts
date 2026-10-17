// Track bed builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { CONTACT_WIRE_Z } from '../../../sim/constants.ts'
import { PieceBuilder, slab, finishSlab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { BRIDGE_DECK_DEPTH, bridgeBarrierTop } from '../../../sim/structures.ts'
import { TUNNEL_HEADROOM } from '../../../build/rail.ts'
import { thirdRailSide, trackSideFixtureOffset } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'
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

function buildTrack(mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, concrete: THREE.Material, railWeb: THREE.Material, preview = false, deckMat: THREE.Material = mats.white, thirdRail: 1 | -1 = -1, neighborPosts: readonly { x: number; y: number }[] = []): THREE.Group {
  const g = new THREE.Group()
  const d = mod.d ?? 1
  // Build in the track's local frame: the run along +x, the amount across +y,
  // the origin cell's centre at (0, 0). The group is then turned and moved into
  // the world, so a quarter-turned piece runs north–south.
  const cx = (mod.w - 1) / 2
  const cy = (d - 1) / 2
  // Continue the screen-door centre line across the platform/bridge join.
  const bridgeSupportOffset = trackSideFixtureOffset(d)
  const bridgeSpan = Math.max(d, bridgeSupportOffset * 2 + 0.12)
  // The bed is a trench: placing the rail dug the cell, so the platform top
  // drops half a metre to this slab. The exposed block sides form the trench
  // walls; the module only supplies the bed and the power supply on top.
  finishSlab(g, concrete, cx, cy, 0.225, mod.w, d, 0.45)
  // Raised centre slab leaves the drainage troughs below the sleeper bearing surface.
  finishSlab(g, concrete, cx, cy, 0.47, mod.w, Math.max(0.8, d - 0.52), 0.04)
  if (mod.cfg.bridge) {
    // One solid concrete deck (§5.4). Edge girders previously shared its outer
    // face, making the underside flicker as the camera moved.
    finishSlab(g, deckMat, cx, cy, -BRIDGE_DECK_DEPTH / 2, mod.w, bridgeSpan, BRIDGE_DECK_DEPTH).name = 'bridge-deck'
    for (const y of [cy - bridgeSupportOffset, cy + bridgeSupportOffset]) {
      const soundBarrier = mod.cfg.bridgeRailing === 'sound-barrier' || mod.cfg.bridgeRailing === 'sound-barrier-half'
      const shoulderDepth = (bridgeSpan - d) / 2
      const shoulderY = cy + Math.sign(y - cy) * (d / 2 + shoulderDepth / 2)
      const postXs = [
        ...(trackGantryLayout(mod)?.xs ?? []),
        ...neighborPosts.filter(post => Math.abs(post.y - y) < 0.12 - 1e-6).map(post => post.x),
      ]
      buildBridgeEdgeConcrete(g, deckMat, mod.w, shoulderY, shoulderDepth, soundBarrier ? 0.5 : 0.55, postXs)
      if (mod.cfg.bridgeRailing === 'sound-barrier' || mod.cfg.bridgeRailing === 'sound-barrier-half') {
        buildBridgeNoiseBarrier(g, mats, mod.w, y, bridgeBarrierTop(mod.cfg.bridgeRailing), mod.cfg.power === 'catenary', neighborPosts)
      } else {
        buildBridgeRailing(g, mats, mod.w, y, mod.cfg.power === 'catenary')
      }
    }
  }
  buildTrackDetails(g, mats, concrete, railWeb, mod.w, d)
  // The line's 供电 decides the model: a conductor rail beside the running
  // rails, or an overhead wire hung over them. Both are drawn for every piece
  // bound to the line, platform and tunnel alike, so a power switch re-cuts all
  // of them when the module meshes are rebuilt. The conductor rail sits on the
  // travel left, or off the platform side at a station (see `thirdRailSide`).
  if (mod.cfg.bridge && mod.cfg.power === 'catenary') buildBridgeCatenary(g, mats, mod, cy)
  else if (mod.cfg.power === 'catenary' && !mod.cfg.tunnel && mod.cfg.catenaryStyle === 'gantry') buildStationGantryCatenary(g, mats, mod, cx, cy)
  else if (mod.cfg.power === 'catenary') buildCatenary(g, mats, mod, cx, cy, d)
  else buildThirdRail(g, mats, mod.w, cx, cy, thirdRail)
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
 * travel left — local +y for 上行, local −y for 下行 — except a platform rail
 * with screens on exactly one side, which takes the side with no 屏蔽门 so the
 * live rail stays off the platform (the transition happens before the station).
 */
function buildThirdRail(g: THREE.Group, mats: ModelMaterials, w: number, cx: number, cy: number, side: 1 | -1 = -1): void {
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
}

/**
 * 接触网: an overhead contact wire over the running rails, hung from a ceiling.
 * A bored tunnel already has its shell ceiling at `TUNNEL_HEADROOM + 1`, so the
 * wire hangs from that. A platform has no ceiling of its own, and a mast cannot
 * fit in the 3 m bed beside a 3 m car (on an island platform it would grow
 * through the screen doors), so the model draws a covered trackway and hangs
 * the wire from it. Either way the wire rides *below* the 4 m storey line, so it
 * stays out of the floor slab above.
 */
function buildCatenary(g: THREE.Group, mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, cx: number, cy: number, d: number): void {
  const w = mod.w
  // The ceiling to hang from: the bore shell for a tunnel, a drawn canopy for a
  // platform. The wire sits just under it, clear of a consist's 3.65 m roof.
  // The platform canopy stops short of the 4 m storey line, so it never fights
  // the floor slab of the level above.
  const ceilingBottom = mod.cfg.tunnel ? TUNNEL_HEADROOM + 1 : TUNNEL_HEADROOM + 0.88
  const wireZ = CONTACT_WIRE_Z
  if (!mod.cfg.tunnel) {
    // A flat canopy over the bed, with a fascia beam down each long edge.
    slab(g, mats.white, cx, cy, ceilingBottom + 0.05, w, d, 0.1)
    // Put each fascia outside the slab edge. Centering it on the edge embeds
    // half of its top face in the canopy, where the coplanar faces z-fight.
    const fasciaHalfWidth = 0.06
    for (const j of [-0.5 - fasciaHalfWidth, d - 0.5 + fasciaHalfWidth]) {
      slab(g, mats.darkSteel, cx, j, ceilingBottom + 0.04, w, fasciaHalfWidth * 2, 0.12)
    }
  }
  buildContactWire(g, mats, mod, cx, cy, wireZ, ceilingBottom)
}

// Every track form presents the conductor at this shared clearance over the
// rails. Tunnels hang it from the bore; stations use either a canopy or portal.

function buildContactWire(g: THREE.Group, mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, cx: number, cy: number, wireZ: number, supportZ: number): void {
  const w = mod.w
  // Rigid conductor with a narrow copper contact strip and transverse brackets.
  slab(g, mats.steel, cx, cy, wireZ + 0.016, w, 0.09, 0.032)
  slab(g, mats.wood, cx, cy, wireZ - 0.006, w, 0.018, 0.012)
  const n = Math.max(2, Math.round(w / 4))
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w - 0.5
    slab(g, mats.darkSteel, x, cy, supportZ - 0.015, 0.14, 0.62, 0.03)
    slab(g, mats.steel, x, cy, (wireZ + supportZ) / 2, 0.05, 0.05, supportZ - wireZ)
    slab(g, mats.psu, x, cy, wireZ + 0.04, 0.1, 0.1, 0.05)
  }
}

/** A station portal keeps the conductor clear of the 4 m upper-storey floor. */
function buildStationGantryCatenary(g: THREE.Group, mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, cx: number, cy: number): void {
  const top = 3.88
  const layout = trackGantryLayout(mod)!
  const span = layout.ys[1]! - layout.ys[0]! + 0.12
  for (const x of layout.xs) {
    for (const y of layout.ys) slab(g, mats.darkSteel, x, y, (0.5 + top) / 2, 0.12, 0.12, top - 0.5).name = 'station-gantry-post'
    slab(g, mats.darkSteel, x, cy, top, 0.12, span, 0.12)
  }
  buildContactWire(g, mats, mod, cx, cy, CONTACT_WIRE_Z, top - 0.06)
}

function buildBridgeCatenary(g: THREE.Group, mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, cy: number): void {
  slab(g, mats.steel, (mod.w - 1) / 2, cy, CONTACT_WIRE_Z, mod.w, 0.05, 0.05)
  slab(g, mats.wood, (mod.w - 1) / 2, cy, CONTACT_WIRE_Z - 0.006, mod.w, 0.018, 0.012)
  const layout = trackGantryLayout(mod)!
  const span = layout.ys[1]! - layout.ys[0]! + 0.12
  for (const x of layout.xs) {
    for (const y of layout.ys) slab(g, mats.darkSteel, x, y, 2.3, 0.12, 0.12, 4.6).name = 'bridge-gantry-post'
    slab(g, mats.darkSteel, x, cy, 4.5, 0.12, span, 0.12)
    slab(g, mats.steel, x, cy, (CONTACT_WIRE_Z + 4.44) / 2, 0.05, 0.05, 4.44 - CONTACT_WIRE_Z)
  }
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
    const neighborPosts = neighboringGantryPosts(mod, tracks)
    return buildTrack(this.ctx.mats, mod, this.ctx.finish('floor.concrete'), railWeb, this.ctx.preview, this.ctx.finish(mod.cfg.bridgeFinish ?? 'floor.concrete'), side, neighborPosts)
  }
}

