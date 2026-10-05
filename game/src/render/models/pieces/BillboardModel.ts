// Advertisement lightbox (广告牌) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, plateOf } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { billboardSpec, posterFor } from '../../../sim/billboards.ts'
import { normRot, rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/* -------------------------------------------------------- wall decoration */

/**
 * Advertisement lightbox (广告牌): a framed, lit poster bolted flat to the wall
 * on the module's local −y face, so the 装饰 rotation picks which wall it hangs
 * on. Its lit face turns into the room (+y). The variant (`sim/billboards.ts`)
 * fixes the run length and the panel's shape: a one-cell landscape, a two-cell
 * 标准 or 大横版, a three-cell 长幅, a tall portrait or a square.
 *
 * The artwork is the module's own `cfg.poster`, frozen at placement — the panel
 * prints one real poster and never changes, so a row of billboards is a row of
 * different campaigns rather than a wall of flicker. `ctx.ads.adFace` crops
 * the image to the panel instead of stretching it, and `userData.adPoster` names
 * the slug the face shows (what the picker and the tests read).
 */
function buildBillboard(ctx: ModuleContext, mod: Extract<Module, { type: 'billboard' }>): THREE.Group {
  const spec = billboardSpec(mod.cfg.variant)
  const poster = posterFor(mod.cfg.poster)
  const g = new THREE.Group()
  // Place the group at the run's centre and turn it with the placement rotation,
  // so the poster hangs on the local −y wall for every variant and run length.
  const [dx, dy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  const { panelW: pw, panelH: ph, panelZ: pz } = spec
  // Housing flat against the wall, with a steel edge frame around it.
  slab(g, ctx.mats.darkSteel, 0, -0.42, pz, pw + 0.08, 0.16, ph + 0.2)
  slab(g, ctx.mats.steel, 0, -0.34, pz, pw + 0.12, 0.04, ph + 0.24)
  // The lit advertisement, facing into the room. Its geometry carries the UV
  // window that crops the poster to this panel (`ctx.ads.adFace`).
  const face = ctx.ads.adFace(poster.slug, pw, ph)
  const ad = plateOf(g, face.geometry, face.material, 0, -0.315, pz, Math.PI)
  ad.renderOrder = 1
  ad.userData.adPoster = poster.slug
  // A small illuminated 广告 / AD bar under the frame.
  const barZ = pz - ph / 2 - 0.18
  slab(g, ctx.mats.black, 0, -0.36, barZ, Math.min(0.5, pw * 0.7), 0.03, 0.16)
  const label = plate(g, ctx.mats.glow, Math.min(0.42, pw * 0.6), 0.1, 0, -0.335, barZ, Math.PI)
  label.renderOrder = 1
  g.userData.adScreen = ad
  return g
}

export class BillboardModel extends PieceBuilder {
  readonly kind = 'billboard'
  build(mod: Extract<Module, { type: 'billboard' }>): THREE.Group {
    return buildBillboard(this.ctx, mod)
  }
}

