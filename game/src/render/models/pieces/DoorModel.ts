// Swing-door builder. One piece file per piece, like every other model here: see
// PieceBuilder.ts for the shared kit.
//
// This is the **one** door in the game. Both callers build through `buildDoor`:
//
//   * the 装饰 门 piece — a doorway standing on the floor, in the four variants of
//     `sim/doors.ts`, and
//   * the 办公室 / 厕所 doorway (`render/models/pieces/RoomModel.ts`), which closes the
//     opening it cut in its own wall with the very same frame, leaves and fittings, at
//     the opening's own width.
//
// The piece is a **free-standing doorway**: a threshold plate on the floor, a post at
// each end, a head across their tops and the leaf hung between them. It carries its own
// structure, so it needs no wall behind it — it is placed on a floor tile like a 货架 —
// and it is moulded in a **local frame centred on the piece**: `x` runs along it, `z` up
// from the floor top and `y` across it, with the opening's centre plane at `y = 0`. The
// caller owns the turn that puts that frame where the door really stands.
//
// Nothing is glazed and every fitting stands clear of the leaf's face: two surfaces a
// few millimetres apart z-fight, which shimmers as the camera moves, and the frames and
// panels that caused it are gone.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { DOOR_FRAME, doorLeafHeight, doorLeafWidths, doorOpeningWidth, doorSpec } from '../../../sim/doors.ts'
import { normRot, rotateLocal } from '../../../sim/track.ts'
import type { DoorMaterial, Module } from '../../../sim/types.ts'

/** A door's materials: the structure that holds it up, the leaf, and its fittings. */
export interface DoorMaterials {
  /** The threshold, the two posts and the head. */
  frame: THREE.Material
  leaf: THREE.Material
  /** The timber or steel pull the leaf is opened by. */
  handle: THREE.Material
  /** Under the pull: a steel kick plate, on every door. */
  kick: THREE.Material
  /** Stainless service-door hardware, as opposed to the timber pull. */
  stainless?: boolean
}

/**
 * The materials one variant is drawn in. A shared table rather than a branch per mesh:
 * the 不锈钢 door uses satin brushed stainless throughout, including its frame and
 * hardware. The broad faces retain diffuse light under the station's lighting rig.
 * The 木 one has a warm frame around a pale timber leaf.
 */
export function doorMaterials(mats: ModuleContext['mats'], material: DoorMaterial): DoorMaterials {
  return material === 'wood'
    ? { frame: mats.wood, leaf: mats.woodLight, handle: mats.woodDark, kick: mats.steel }
    : { frame: mats.binSteel, leaf: mats.binSteel, handle: mats.steel, kick: mats.binSteel, stainless: true }
}

/**
 * One call's worth of `at(x, z, y)`: a point of the local door frame (along the piece,
 * up from the floor top, across it from the opening's centre) mapped into the
 * **caller's own** frame.
 *
 * `at` is what lets one builder serve both callers. Each builds into a group that already
 * carries the doorway's place and turn — the standing piece's own group, a room's a child
 * of its own — so both pass the **identity**: a member's *size* is measured in the piece's
 * frame too, and a plain point mapping would leave the run and the depth swapped on a
 * quarter-turned doorway.
 */
export type DoorFramePoint = (x: number, z: number, y: number) => [number, number, number]


/**
 * Build one standing doorway into `g`: a threshold on the floor, a post at each end of
 * `span` metres, a head across their tops, and `leaves` leaves hung between them.
 *
 * Frame and leaves are boxes, with round stainless hinge barrels: it spans
 * `span` × `panelH` and stands on `y = 0` of its own frame.
 */
export function buildDoor(
  g: THREE.Group,
  at: DoorFramePoint,
  mats: DoorMaterials,
  opts: { span: number; panelH: number; leaves: number },
): THREE.Group {
  const { span, panelH, leaves } = opts
  const { threshold, thresholdDepth, post, postDepth, head, leaf, leafSet, meetGap, kick, kickProud, studProud, handle } = DOOR_FRAME
  /** One member, placed by the local door frame and sized in metres. */
  const box = (mat: THREE.Material, x: number, z: number, y: number, w: number, h: number, d: number): THREE.Mesh =>
    slab(g, mat, ...at(x, z, y), w, d, h)

  const w = Math.max(post * 2 + 0.2, span)
  const postX = w / 2 - post / 2
  const headBottom = panelH - head

  // The structure the leaf hangs in: the threshold it stands on, a post at each end, and
  // the head that ties their tops together. This is what makes the piece free-standing —
  // it holds itself up on the floor, so it needs no wall behind it.
  box(mats.frame, 0, threshold / 2, 0, w, threshold, thresholdDepth)
  box(mats.frame, -postX, threshold + (headBottom - threshold) / 2, 0, post, headBottom - threshold, postDepth)
  box(mats.frame, postX, threshold + (headBottom - threshold) / 2, 0, post, headBottom - threshold, postDepth)
  box(mats.frame, 0, headBottom + head / 2, 0, w, head, postDepth)

  // The leaves: one slab each, meeting in the middle on a 双开, hung on their own plane a
  // hair off the opening's centre so they clear the posts they swing in.
  const leafH = doorLeafHeight(panelH)
  const widths = doorLeafWidths(doorOpeningWidth(w), leaves)
  const centres = widths.length > 1 ? [-widths[0] / 2 - meetGap / 2, widths[1] / 2 + meetGap / 2] : [0]
  for (let i = 0; i < widths.length; i++) {
    const cx = centres[i]
    const lw = widths[i]
    box(mats.leaf, cx, threshold + leafH / 2, leafSet, lw, leafH, leaf)
    if (mats.stainless) {
      // Service doors have uninterrupted sheet-metal faces and upright pulls near
      // the meeting edge. The exposed hinge plates and barrels sit on the outer edge.
      const meets = i === 0 ? 1 : -1
      const front = leafSet + leaf / 2
      const pullX = cx + meets * (lw / 2 - Math.min(0.1, lw / 3))
      for (const z of [0.88, 1.16]) {
        box(mats.handle, pullX, z, front + studProud, 0.032, 0.032, 0.04)
      }
      box(mats.handle, pullX, 1.02, front + handle, 0.032, 0.32, 0.05)
      const hingeX = cx - meets * lw / 2
      for (const z of [threshold + 0.2, threshold + leafH / 2, threshold + leafH - 0.2]) {
        box(mats.handle, hingeX + meets * 0.025, z, front + 0.014, 0.045, 0.085, 0.016)
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10), mats.handle)
        barrel.rotation.x = Math.PI / 2
        barrel.position.set(...at(hingeX, z, front + 0.027))
        g.add(barrel)
      }
      // One stainless lock escutcheon on the active leaf; its slot is recessed geometry.
      if (i === widths.length - 1) {
        box(mats.handle, pullX, 0.72, front + 0.014, 0.035, 0.065, 0.012)
        box(mats.handle, pullX - 0.009, 0.72, front + 0.024, 0.008, 0.036, 0.008)
        box(mats.handle, pullX + 0.009, 0.72, front + 0.024, 0.008, 0.036, 0.008)
      }
      continue
    }
    // The kick plate along the foot of the leaf, in steel on the wooden door too. It is a
    // plate **on** the leaf, so it stands proud of the leaf's face by its own `kickProud`
    // — two surfaces a couple of millimetres apart would z-fight, and a plate that
    // shimmers as the camera moves is worse than no plate.
    box(mats.kick, cx, threshold + kick / 2, leafSet + leaf / 2 + kickProud, lw - 0.02, kick, 0.008)
    // The pull on the leaf's **free edge** — the edge away from its hinge — carried on a
    // pair of studs so it reads as a pull rather than a plate. Which edge that is depends
    // on the leaf: a 双开 pair's leaves face each other, so each pull goes on the edge that
    // meets its partner's and the two hang together at the middle of the doorway, where a
    // pair of doors is opened from. A 单开 door has one leaf and nothing to meet, so its
    // pull sits toward the free edge of the cell it fills. `meets` is the direction from
    // this leaf's centre to the edge it is opened from: +1 for the left leaf of a pair and
    // for a single door, −1 for the pair's right leaf.
    const pullW = 0.3
    const studAt = 0.12
    const meets = i === 0 ? 1 : -1
    const free = cx + (meets * lw) / 2
    // The pull's centre sits a little in from that edge, clamped so the bar and its studs
    // stay inside the leaf whatever the leaves' own widths come to.
    const want = i === 0 ? cx + 0.12 : cx - 0.12
    const pullX = meets > 0
      ? Math.min(want, free - (pullW / 2 + studAt + 0.01))
      : Math.max(want, free + (pullW / 2 + studAt + 0.01))
    const studX = Math.min(studAt, pullW / 2 - 0.02)
    const front = leafSet + leaf / 2
    box(mats.handle, pullX - studX, 1.02, front + studProud, 0.03, 0.03, 0.04)
    box(mats.handle, pullX + studX, 1.02, front + studProud, 0.03, 0.03, 0.04)
    box(mats.handle, pullX, 1.02, front + handle, pullW, 0.04, 0.05)
  }
  return g
}

/**
 * Free-standing door (门, 装饰): the doorway the player stands on a floor tile, so the
 * 装饰 rotation picks which way it faces. It is floor-standing like a 货架 — it needs
 * floor under it and nothing behind it — and rises from the floor top to
 * `cfg.variant`'s height (`sim/doors.ts`), one or two cells wide.
 *
 * The doorway stands on the **near edge of the block it is placed on**, not in the middle
 * of it: its own line — the plane the leaves hang in — sits a frame's half-depth *inside*
 * the `mod.x` face of the anchor cell (`EDGE_IN` below), and the piece extends one run
 * along the cell from there. A doorway belongs on
 * the line between two spaces, so a door dropped on a tile closes that tile's own leading
 * edge; the run it reserves is the cells it reaches into. The turn carries the line round
 * with the piece, so a boundary running either way can be closed.
 */
function buildStandingDoor(ctx: ModuleContext, mod: Extract<Module, { type: 'door' }>): THREE.Group {
  const spec = doorSpec(mod.cfg?.variant)
  const g = new THREE.Group()
  const run = mod.w > 0 ? mod.w : spec.w
  /**
   * Where the piece's own middle must sit, measured from the anchor cell's centre: one
   * frame's half-depth in from the cell's leading edge, and `(run - 1) / 2` along it so
   * the piece fills the cells it reserves. Both are expressed in the piece's local frame
   * and turned with it, so the doorway stands on the block's edge at any rotation.
   */
  const EDGE_IN = DOOR_FRAME.postDepth / 2 - 0.5
  const [rx, ry] = rotateLocal(mod.rot, (run - 1) / 2, 0)
  const [dx, dy] = rotateLocal(mod.rot, 0, EDGE_IN)
  g.position.set(mod.x + 0.5 + rx + dx, mod.y + 0.5 + ry + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  // Built straight in the module's own local frame, which is already the piece's own:
  // the group above carries the cell centre, the edge and the turn.
  const at: DoorFramePoint = (x, z, y) => [x, y, z]
  return buildDoor(g, at, doorMaterials(ctx.mats, spec.material), { span: run, panelH: spec.h, leaves: spec.leaves })
}

export class DoorModel extends PieceBuilder {
  readonly kind = 'door'
  build(mod: Extract<Module, { type: 'door' }>): THREE.Group {
    return buildStandingDoor(this.ctx, mod)
  }
}
