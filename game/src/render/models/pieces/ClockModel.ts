// Station clock (时钟) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/* ------------------------------------------------------ ceiling decoration */

/**
 * Station clock (时钟, 装饰): a **round** dial hung by a rod from the storey ceiling,
 * 0.78 m across and hanging in the lower half of the storey so the hall below reads
 * it. The face is white with black hour markers, minute ticks and two hands and
 * **nothing else** — no numerals, no name, no logo, which is the reference face.
 *
 * **The face is geometry, not a printed canvas.** The dial is a white disc, the marks
 * and the hands are thin boxes laid on it, and the bezel is a dark ring around it.
 * That is deliberate: a canvas texture on the cap is one indirection between the
 * source and the pixels, and the built page measured it wrong — the texture that
 * reached the GPU carried the marks' ink across the whole face while the unit tests,
 * whose canvas is a stub, all passed. Boxes have nothing to get wrong, and
 * `test/ceiling-decor.test.mjs` reads the face's colour and counts its marks straight
 * off the geometry.
 *
 * The ceiling underside is local z 3.0 (`LEVEL_STEPS`, the surface
 * `ceilingMountMissing` demanded before the piece could be placed), so the rod spans
 * exactly the gap between the ceiling plate and the regulator box on top of the dial.
 * Nothing reaches the floor: the whole piece hangs.
 */
function buildClock(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const faceR = 0.38 // the dial radius; the case is a shade larger all round
  const caseR = 0.4
  const ceiling = 3.0 // the storey ceiling underside, above the block top
  // **A slim body, white at both ends and black round the rim.** The white cylinder is the dial
  // material; the black wrap hides its barrel so the white reads as a **face** at each end rather
  // than as a white drum. The clock is double-faced, because a concourse clock is read from either
  // side.
  const bodyDepth = 0.12
  const bodyFront = -0.06 // the front white end; the camera looks from −y
  const bodyBack = bodyFront + bodyDepth
  const dialZ = 2.35 // the dial centre height: the lower half of the storey, easy to read
  // The white body. **A `CylinderGeometry` is Y-up, so its caps already face ±y and it needs no
  // rotation**: the ends of the barrel are the two faces. A quarter-turn about x would lay it flat
  // in the X-Z plane, which is the wrong plane and no sign of that turn fixes it.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(faceR, faceR, bodyDepth, 48), mats.white)
  body.position.set(0, bodyFront + bodyDepth / 2, dialZ)
  g.add(body)
  // The black wrap: an **open** ring around the barrel. Open-ended because a capped cylinder would
  // lay a black disc across each white face and hide the dial.
  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(caseR, caseR, bodyDepth + 0.05, 48, 1, true),
    mats.darkSteel,
  )
  wrap.position.set(0, bodyFront + bodyDepth / 2, dialZ)
  g.add(wrap)
  /**
   * One dial, in a **neutral frame**: the dial's face lies in the X-Z plane, its outward direction
   * is **+y**, and every offset below is a positive distance out of that face. There is no `facing`
   * factor anywhere in here.
   *
   * **The whole dial stands proud of the case's white end, or the cap hides it.** The white barrel
   * is capped at each end, so its cap is a flat disc `faceR` across lying *in front of* anything
   * mounted level with or inside the end plane: a mark that reached the end plane flush would be
   * buried in the cap and the face would render as a plain white disc. This dial was first built
   * that way — mounted **at** the end plane with its marks laid toward −y, which is *into* the
   * barrel — so both faces drew blank white and no test or type-check saw it, because the meshes
   * were all present with the right sizes and the right material. `DIAL_OUT` therefore starts
   * past the cap and each part is positioned as a **positive** step out of the dial plane, so no
   * sign error can put it back inside the case.
   *
   * A real double-faced clock is one dial mounted twice — the far one turned half a turn — so this
   * is built once and mounted twice rather than being branched on inside.
   *
   * **A clock face is sixty divisions, not twelve.** Twelve bars alone read as a plate with marks
   * on it; the minute ticks between them are what make the ring read as a clock. The proportions
   * are measured off the reference face:
   *
   *   hour mark    0.19 R long, 0.055 R across, its outer end at the rim
   *   minute tick  0.10 R long, 0.02 R across, its outer end at the rim
   *   hour hand    0.5 R,  minute hand 0.7 R
   *
   * A mark is measured from 12 o'clock, as a clock face is read.
   */
  const buildDial = (out: 1 | -1): THREE.Group => {
    const dial = new THREE.Group()
    // `out` is the side of the dial's own plane its parts stand on: +1 for a dial whose face looks
    // along +y and −1 for one looking along −y. It touches **only** the y offsets — every mark's
    // height off the face and nothing else — so each dial keeps the whole face exactly as built,
    // hands included, and one sign is the single thing that differs between the two ends.
    const DIAL_OUT = 0.012 // the dial plane's clearance past the case's white end
    // The marks lie on the dial plane; the hands ride **over** them and the boss is the pivot the
    // hands turn on, so the three sit at increasing heights and their boxes never interleave.
    const markOut = out * DIAL_OUT // a mark's inner face on the dial plane
    const handOut = out * (DIAL_OUT + 0.024) // an arm, clear above the marks
    const bossOut = out * (DIAL_OUT + 0.026) // the hub, proud of both
    /** One mark: a box of `length` along the radius, its outer end at the rim. */
    const mark = (deg: number, length: number, across: number, thick: number): void => {
      const rim = faceR - 0.02
      const mid = rim - length / 2
      const a = (deg * Math.PI) / 180
      const bar = new THREE.Mesh(new THREE.BoxGeometry(length, thick, across), mats.black)
      bar.position.set(Math.sin(a) * mid, markOut + (out * thick) / 2, Math.cos(a) * mid)
      // **A mark runs radially**, so its long axis points at the centre: the 12 and 6 marks stand
      // vertical in the dial's plane and the 3 and 9 marks lie horizontal along the radius, which is
      // what a clock face does.
      //
      // A box's `width` is its local x, so the turn that aims that axis along the radius at angle
      // `a` is **`a − π/2`** — read off the matrix, not derived by hand: at every clock angle that
      // turn gives a dot of 1.000 against the radius, while `π/2 − a` gives 0.105 to 0.5 (every
      // mark *across* the rim, so 12 and 6 come out horizontal and 3 and 9 vertical) and `−a`
      // gives 0 as well. A box's +x may point inward or outward — a bar is symmetric — so the
      // magnitude is what matters.
      bar.rotation.y = a - Math.PI / 2
      dial.add(bar)
    }
    // The sixty minute ticks, five between every pair of hour marks. Short and fine, they are what
    // turns the ring into a clock face.
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue
      mark(i * 6, 0.04, 0.009, 0.006)
    }
    // Twelve hour marks over them: the quarter-hour four are longer and heavier, which shapes the
    // face.
    for (let i = 0; i < 12; i++) {
      const quarter = i % 3 === 0
      mark(i * 30, quarter ? 0.09 : 0.08, quarter ? 0.024 : 0.016, 0.008)
    }
    // The hands, at 10:09 — the pose every product photograph uses, and one where neither hand
    // covers a mark. A hand is radial too, but its box carries its length along local **z** where
    // a mark's carries it along local x, so it takes the *opposite* turn: `a + π/2` against the
    // mark's `π/2 − a`. The arm is placed from its two endpoints, so a wrong turn shows up as the
    // tip landing on the wrong hour.
    const hand = (deg: number, len: number, wide: number): void => {
      const a = (deg * Math.PI) / 180
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, wide), mats.black)
      arm.position.set((dx * len) / 2, handOut + out * 0.006, (dz * len) / 2)
      // A hand's box also carries its length along local x, so it takes the **same** turn as a
      // mark; `π/2 − a` would lay the hand across its hour.
      arm.rotation.y = a - Math.PI / 2
      dial.add(arm)
    }
    hand(304, 0.19, 0.032) // hour: just short of 10
    hand(54, 0.27, 0.02) // minute: just past 10 past
    // The centre boss, so the hands read as turning on a pivot rather than on a hole.
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), mats.black)
    boss.position.set(0, bossOut + out * 0.01, 0)
    dial.add(boss)
    return dial
  }
  // Mount one dial on each end of the case: the front dial's face looks out of the **−y** end and
  // the back one's out of the **+y** end, each mounted on the case's own end surface and standing
  // its marks off that surface by `DIAL_OUT`. That standoff is the whole fix: a dial whose marks
  // lie level with or inside the end is covered by the white cap and renders as a plain white
  // disc. Each mount also carries the dial's **height** — put the height inside the dial instead
  // and the back one swings to −z, a storey below the floor — and a half turn about y, which is
  // the turn a real double-faced clock's far dial takes and which the round face is indifferent
  // to. The face itself is left entirely alone: both ends show the same dial, hands and all.
  const frontDial = new THREE.Group()
  frontDial.add(buildDial(-1))
  frontDial.position.set(0, bodyFront, dialZ)
  frontDial.rotation.y = Math.PI
  g.add(frontDial)
  const backDial = new THREE.Group()
  backDial.add(buildDial(1))
  backDial.position.set(0, bodyBack, dialZ)
  backDial.rotation.y = Math.PI
  g.add(backDial)
  // The rod from the top of the case up to the ceiling plate. It hangs in the piece's own frame,
  // not the dial's, so it stays square to the storey whatever the faces do — and it leaves from the
  // case's **rim**, not from part way down it, or it would stand inside the dial.
  const rodDepth = bodyFront + bodyDepth / 2
  const caseTop = dialZ + caseR
  const rodBottom = caseTop - 0.02
  const rodTop = ceiling
  slab(g, mats.darkSteel, 0, rodDepth, caseTop - 0.045, 0.09, 0.09, 0.09) // the lug on the case rim
  slab(g, mats.steel, 0, rodDepth, (rodBottom + rodTop) / 2, 0.03, 0.03, rodTop - rodBottom)
  slab(g, mats.darkSteel, 0, rodDepth, ceiling - 0.018, 0.15, 0.15, 0.036)
  return g
}

export class ClockModel extends PieceBuilder {
  readonly kind = 'clock'
  build(mod: Extract<Module, { type: 'clock' }>): THREE.Group {
    return placeLocal(buildClock(this.ctx.mats), mod)
  }
}

