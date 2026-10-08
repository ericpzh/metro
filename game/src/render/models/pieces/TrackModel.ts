// Track bed builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, finishSlab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { BRIDGE_DECK_DEPTH, bridgeBarrierTop } from '../../../sim/structures.ts'
import { TUNNEL_HEADROOM } from '../../../build/rail.ts'
import type { Module } from '../../../sim/types.ts'

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

function buildTrack(mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, preview = false, deckMat: THREE.Material = mats.white): THREE.Group {
  const g = new THREE.Group()
  const d = mod.d ?? 1
  // Build in the track's local frame: the run along +x, the amount across +y,
  // the origin cell's centre at (0, 0). The group is then turned and moved into
  // the world, so a quarter-turned piece runs north–south.
  const cx = (mod.w - 1) / 2
  const cy = (d - 1) / 2
  // The bed is a trench: placing the rail dug the cell, so the platform top
  // drops half a metre to this slab. The exposed block sides form the trench
  // walls; the module only supplies the bed and the power supply on top.
  slab(g, mats.black, cx, cy, 0.25, mod.w, d, 0.5)
  if (mod.cfg.bridge) {
    // One solid concrete deck (§5.4). Edge girders previously shared its outer
    // face, making the underside flicker as the camera moved.
    finishSlab(g, deckMat, cx, cy, -BRIDGE_DECK_DEPTH / 2, mod.w, d, BRIDGE_DECK_DEPTH)
    for (const y of [-0.42, d - 0.58]) {
      if (mod.cfg.bridgeRailing === 'sound-barrier' || mod.cfg.bridgeRailing === 'sound-barrier-half') {
        // Absorbing lower panels with a clear upper band, framed on both sides.
        const top = bridgeBarrierTop(mod.cfg.bridgeRailing)
        const height = top - 0.5
        const lowerHeight = height * 2 / 3
        const upperHeight = height / 3
        slab(g, mats.white, cx, y, 0.5 + lowerHeight / 2, mod.w, 0.08, lowerHeight)
        slab(g, mats.glass, cx, y, top - upperHeight / 2, mod.w, 0.08, upperHeight)
        slab(g, mats.steel, cx, y, 0.5 + lowerHeight, mod.w, 0.12, 0.08)
        slab(g, mats.steel, cx, y, top - 0.04, mod.w, 0.12, 0.08)
        for (let x = 0; x < mod.w; x += 2) slab(g, mats.steel, x, y, 0.5 + height / 2, 0.12, 0.12, height)
      } else {
        slab(g, mats.steel, cx, y, 1.25, mod.w, 0.08, 0.08)
        for (let x = 0; x < mod.w; x += 2) slab(g, mats.steel, x, y, 0.9, 0.08, 0.08, 0.7)
      }
    }
  }
  // Two rails on sleepers down the middle of the bed.
  for (const s of [-1, 1]) slab(g, mats.steel, cx, cy + s * 0.72, 0.6, mod.w, 0.1, 0.1)
  const nSleepers = Math.max(2, Math.round(mod.w / 0.6))
  for (let i = 0; i < nSleepers; i++) {
    slab(g, mats.black, ((i + 0.5) / nSleepers) * mod.w - 0.5, cy, 0.55, 0.24, Math.max(1.9, d - 0.2), 0.08)
  }
  // The line's 供电 decides the model: a conductor rail beside the running
  // rails, or an overhead wire hung over them. Both are drawn for every piece
  // bound to the line, platform and tunnel alike, so a power switch re-cuts all
  // of them when the module meshes are rebuilt.
  if (mod.cfg.bridge && mod.cfg.power === 'catenary') buildBridgeCatenary(g, mats, mod, cy, d)
  else if (mod.cfg.power === 'catenary') buildCatenary(g, mats, mod, cx, cy, d)
  else buildThirdRail(g, mats, mod.w, cx, cy)
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

/** 第三轨: a guarded conductor rail along the outer −y edge of the bed. */
function buildThirdRail(g: THREE.Group, mats: ModelMaterials, w: number, cx: number, cy: number): void {
  const ty = cy - 1.05
  // The live rail, sitting on ceramic insulators above the sleepers.
  slab(g, mats.darkSteel, cx, ty, 0.62, w, 0.09, 0.09)
  // A yellow protective cover arches over it, as a capping board on a real
  // conductor rail does, so the third rail reads at a glance.
  slab(g, mats.psu, cx, ty - 0.12, 0.8, w, 0.34, 0.05)
  slab(g, mats.psu, cx, ty - 0.28, 0.7, w, 0.05, 0.22)
  const n = Math.max(2, Math.round(w / 4))
  for (let i = 0; i < n; i++) {
    slab(g, mats.white, ((i + 0.5) / n) * w - 0.5, ty, 0.51, 0.1, 0.1, 0.14)
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
  const wireZ = ceilingBottom - 0.1
  if (!mod.cfg.tunnel) {
    // A flat canopy over the bed, with a fascia beam down each long edge.
    slab(g, mats.white, cx, cy, ceilingBottom + 0.05, w, d, 0.1)
    for (const j of [-0.5, d - 0.5]) slab(g, mats.darkSteel, cx, j, ceilingBottom + 0.04, w, 0.12, 0.12)
  }
  // Contact wire down the track centre, on short hangers from the ceiling.
  slab(g, mats.steel, cx, cy, wireZ, w, 0.05, 0.05)
  const n = Math.max(2, Math.round(w / 4))
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w - 0.5
    slab(g, mats.steel, x, cy, (wireZ + ceilingBottom) / 2, 0.05, 0.05, ceilingBottom - wireZ)
    slab(g, mats.psu, x, cy, wireZ + 0.04, 0.1, 0.1, 0.05)
  }
}

function buildBridgeCatenary(g: THREE.Group, mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, cy: number, d: number): void {
  slab(g, mats.steel, (mod.w - 1) / 2, cy, 4.1, mod.w, 0.05, 0.05)
  for (let x = 0; x < mod.w; x += 8) {
    for (const y of [-0.42, d - 0.58]) slab(g, mats.darkSteel, x, y, 2.3, 0.12, 0.12, 4.6)
    slab(g, mats.darkSteel, x, cy, 4.5, 0.12, d, 0.12)
    slab(g, mats.steel, x, cy, 4.3, 0.05, 0.05, 0.4)
  }
}

export class TrackModel extends PieceBuilder {
  readonly kind = 'track'
  build(mod: Extract<Module, { type: 'track' }>): THREE.Group {
    return buildTrack(this.ctx.mats, mod, this.ctx.preview, mod.cfg.bridgeFinish ? this.ctx.finish(mod.cfg.bridgeFinish) : this.ctx.mats.white)
  }
}

