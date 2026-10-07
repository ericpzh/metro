// Station clock (时钟) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { clockHandAngles } from '../../../sim/clock.ts'
import type { Module } from '../../../sim/types.ts'

/* ------------------------------------------------------ ceiling decoration */

/**
 * The pose a bare build draws: **10:09**, the pose every product photograph uses.
 *
 * A piece built with no scene behind it — a palette thumbnail, a unit test — has no sim clock to
 * read, so it draws this. A **placed** clock is seated on the sim clock the frame after it is
 * built, and so is a **hover ghost** (`render/scene/systems/ClockSystem.ts` turns both lists), so
 * this pose is what a piece that nothing is driving keeps: the reference photograph's 10:09 rather
 * than midnight or a stopped hand.
 */
export const CLOCK_POSE_SECONDS = 10 * 3600 + 9 * 60

/**
 * The pivots one 时钟's hands turn on: an hour hand and a minute hand per face, in build order,
 * two of each on the double-faced piece. The dial itself is geometry rather than a printed
 * plate, so there is no canvas to repaint when the time moves — the scene turns these
 * (`reposeClockHands`) instead, exactly as it rolls an escalator's step band.
 *
 * A pivot holds **one arm and nothing else**: its own `rotation.y` *is* the clock angle, because
 * the arm inside it is built pointing at 12 o'clock.
 */
export interface ClockRig {
  hour: THREE.Object3D[]
  minute: THREE.Object3D[]
}

/**
 * Turn every dial's hands to `seconds` — the scene's per-frame call, one step away from
 * `clockHandAngles` so the piece never derives a time of its own.
 *
 * Both faces are set from the **same** pair of angles, in the dial's own frame. That is the whole
 * of what a hand needs: each face is the same dial, and the far one hangs inside a mount turned
 * half a turn about the vertical axis, so the two faces come out as mirror images — one time, read
 * correctly from either side, which is what a real double-faced clock does. Nothing here knows
 * which face it is setting.
 */
export function reposeClockHands(rig: ClockRig, seconds: number): void {
  const { hour, minute } = clockHandAngles(seconds)
  const rad = Math.PI / 180
  for (const pivot of rig.hour) pivot.rotation.y = hour * rad
  for (const pivot of rig.minute) pivot.rotation.y = minute * rad
}

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
 * **The hands tell the simulation's own time**, not a pose baked in at build time. Each one
 * hangs on a pivot (`ClockRig`) that the scene turns once a frame from `clockHandAngles`, so
 * the dial beside a 电视's printed clock cannot disagree with it — and the **hover ghost** is
 * turned with the placed pieces, since the preview is the clock a click would add. A bare build —
 * a palette thumbnail, a unit test — draws `CLOCK_POSE_SECONDS` (10:09), the pose the reference
 * photographs show.
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
   * One dial, in a **neutral frame**: the dial's face lies in the X-Z plane, its outward
   * direction is **−y**, and every offset below is a **negative** step out of that face. There is
   * no `facing` factor anywhere in here.
   *
   * **The whole dial stands proud of the case's white end, or the cap hides it.** The white barrel
   * is capped at each end, so its cap is a flat disc `faceR` across lying *in front of* anything
   * mounted level with or inside the end plane: a mark that reached the end plane flush would be
   * buried in the cap and the face would render as a plain white disc. This dial was first built
   * that way — mounted **at** the end plane with its marks laid toward −y, which is *into* the
   * barrel — so both faces drew blank white and no test or type-check saw it, because the meshes
   * were all present with the right sizes and the right material. `DIAL_OUT` therefore starts
   * past the cap and each part is positioned as a step **out of the dial plane**, away from the
   * case, so no sign error can put it back inside the barrel.
   *
   * **A clock face is sixty divisions, not twelve.** Twelve bars alone read as a plate with marks
   * on it; the minute ticks between them are what make the ring read as a clock. The proportions
   * are measured off the reference face:
   *
   *   hour mark    0.19 R long, 0.055 R across, its outer end at the rim
   *   minute tick  0.10 R long, 0.02 R across, its outer end at the rim
   *   hour hand    0.5 R,  minute hand 0.7 R
   *
   * A mark is measured from 12 o'clock, as a clock face is read — and **12 o'clock is the dial's
   * local +z**, so the face reads correctly for a viewer whose screen up is +z and whose screen
   * right is +x. The far face is the same dial turned half a turn about the **vertical** axis,
   * which is what puts its own 12 at the top; see the mounts below.
   *
   * **The hands are pivots, not placed arms.** Each is an arm built pointing at 12 o'clock
   * inside a `Group` whose own y rotation is the clock angle, so the time is one number per
   * hand and the scene can turn it every frame without rebuilding the dial
   * (`reposeClockHands`). Measuring a hand from the hour it was built for, as this piece first
   * did, is a pose and not a clock: the dial's two arms were frozen at 10:09 forever while the
   * sim's own clock ran on beside them.
   */
  const rig: ClockRig = { hour: [], minute: [] }
  const buildDial = (): THREE.Group => {
    const dial = new THREE.Group()
    const DIAL_OUT = 0.012 // the dial plane's clearance past the case's white end
    // The marks lie on the dial plane; the hands ride **over** them and the boss is the pivot the
    // hands turn on, so the three sit at increasing heights and their boxes never interleave.
    const markOut = -DIAL_OUT // a mark's inner face on the dial plane
    const handOut = -(DIAL_OUT + 0.024) // an arm, clear above the marks
    const bossOut = -(DIAL_OUT + 0.026) // the hub, proud of both
    /** One mark: a box of `length` along the radius, its outer end at the rim. */
    const mark = (deg: number, length: number, across: number, thick: number): void => {
      const rim = faceR - 0.02
      const mid = rim - length / 2
      const a = (deg * Math.PI) / 180
      const bar = new THREE.Mesh(new THREE.BoxGeometry(length, thick, across), mats.black)
      bar.position.set(Math.sin(a) * mid, markOut - thick / 2, Math.cos(a) * mid)
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
    // **The hands, hung on pivots.** Both are built at **12 o'clock** — that is the dial's own
    // neutral pose, and it is the only pose a hand needs to be built in, because the pivot it
    // hangs on then carries the time: the pivot's y rotation *is* the clock angle. A pivot turns
    // its child about the dial's axis, and a rotation about y adds straight onto the arm's own
    // angle (`reposeClockHands` sets one number per hand), so nothing here has to know what time
    // the clock will read.
    //
    // A hand is radial like a mark, so it takes the **same** `a − π/2` turn the marks do: at
    // 12 o'clock the angle is 0, so a hand's arm carries exactly `−π/2` and points at **+z**, up
    // the face. Laying it out at the pivot's own angle instead — what this piece did while the
    // pose was frozen at 10:09 — leaves every arm across its hour, and a hand placed from its two
    // endpoints is the one thing that would have shown it.
    const hand = (len: number, wide: number, into: THREE.Object3D[]): THREE.Group => {
      const pivot = new THREE.Group()
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, wide), mats.black)
      // The arm's length runs along its own local x, and the pivot's y rotation turns it: half a
      // length out along that axis is the arm's midpoint at 12 o'clock.
      arm.position.set(0, handOut - 0.006, len / 2)
      arm.rotation.y = -Math.PI / 2
      pivot.add(arm)
      dial.add(pivot)
      into.push(pivot)
      return pivot
    }
    hand(0.19, 0.032, rig.hour) // hour: 0.5 R
    hand(0.27, 0.02, rig.minute) // minute: 0.7 R
    // The centre boss, so the hands read as turning on a pivot rather than on a hole.
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), mats.black)
    boss.position.set(0, bossOut - 0.01, 0)
    dial.add(boss)
    return dial
  }
  // Mount one dial on each end of the case: the front dial's face looks out of the **−y** end and
  // the back one's out of the **+y** end, each mounted on the case's own end surface and standing
  // its marks off that surface by `DIAL_OUT`. That standoff is the whole fix: a dial whose marks
  // lie level with or inside the end is covered by the white cap and renders as a plain white
  // disc. Each mount also carries the dial's **height** — put the height inside the dial instead
  // and the back one swings to −z, a storey below the floor.
  //
  // **The far dial is turned half a turn about the vertical axis — `z`, not `y`.** That one axis is
  // the whole of "12 o'clock is up on each face": a half turn about the dial's own normal (`y`)
  // leaves 12 pointing at −z, i.e. it hangs the face upside down, and it was this piece's geometry
  // for its whole life. Nothing showed it while the hands were a fixed pose, because a face of
  // sixty evenly spaced marks is exactly **2-fold symmetric** — the ring looks identical upside
  // down, and only the hands say where 12 is. Turned about the vertical axis instead, the far dial
  // is the near one as a real double-faced clock has it: 12 stays up, 3 crosses to the other hand,
  // and each face reads the clock to the viewer standing in front of it. The near dial needs no
  // turn at all — its own frame already reads with +z up and +x to the right, which is what the −y
  // camera sees — so one dial is built once and mounted twice, and the only difference between the
  // ends is that half turn.
  const frontDial = new THREE.Group()
  frontDial.add(buildDial())
  frontDial.position.set(0, bodyFront, dialZ)
  g.add(frontDial)
  const backDial = new THREE.Group()
  backDial.add(buildDial())
  backDial.position.set(0, bodyBack, dialZ)
  backDial.rotation.z = Math.PI
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
  // Both dials are built, so the rig is complete: seat it on the pose a bare build draws and hand
  // it to whichever scene owns the piece. A **placed** 时钟 reads the sim clock from the frame
  // after this one (`ClockSystem.updateClocks`), so the default is only ever what a thumbnail, a
  // ghost or a unit test sees.
  reposeClockHands(rig, CLOCK_POSE_SECONDS)
  g.userData.clockRig = rig
  return g
}

export class ClockModel extends PieceBuilder {
  readonly kind = 'clock'
  build(mod: Extract<Module, { type: 'clock' }>): THREE.Group {
    return placeLocal(buildClock(this.ctx.mats), mod)
  }
}

