// Turnstile (闸机) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, prism, placeLocal, drawFence, fencePost } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { gateHasLane, gateSolidFaces } from '../../../sim/gates.ts'
import { rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/* ------------------------------------------------------------------ gate */

/**
 * The 闸机's own dimensions, from the reference elevation: a 1250 mm machine
 * whose shoulder is at 957 mm, over a 900 mm base, with a head that tapers in at
 * 115° to the horizontal — 25° off vertical — so its flat top is shorter than its
 * base and the machine is no rectangular block. The body takes 440 mm of the
 * cell, leaving the 560 mm a real gate lane is.
 */
const GATE_W = 0.44
const GATE_D = 0.9
const GATE_PLINTH_H = 0.08
const GATE_BODY_TOP = 0.62
const GATE_SHOULDER = 0.957
const GATE_H = 1.25
/** The shoulder's slope off vertical: the reference's 115° is measured to the top. */
const GATE_SHOULDER_TILT = ((115 - 90) * Math.PI) / 180
/** The machine's depth at a height up in the tapered head. */
function gateDepthAt(z: number): number {
  return GATE_D - 2 * (z - GATE_SHOULDER) * Math.tan(GATE_SHOULDER_TILT)
}

/**
 * Turnstile (闸机), after the 广州地铁 reference photos and elevation: a
 * brushed-stainless plinth and body, a dark-navy head carrying the tilted screen,
 * the round card reader, the QR window and the two lane lights, a black fascia
 * with a single up green arrow across the body's lower front, a blue band at the
 * foot, and the translucent red leaf across the lane. The head is a **trapezoid**
 * — its top is shorter than its base, the shoulders sloping at 115° — so the
 * machine is not a rectangular block.
 *
 * The body stands **inside** the cell's −x half, hard against that edge, so its
 * outer face *is* the cell edge: a fence run ends flush on the machine's solid
 * side (`gateSolidFaces` in `sim/gates.ts`) instead of hanging in the lane. The
 * lane — with the leaf — takes the +x half, which is also the graph node the sim
 * routes the crowd through, so nobody walks through the stainless body. **Which
 * hand that is** is not modelled here: `R` turns the whole piece, so the mirrored
 * gate is `rot` 2.
 *
 * A `fence` machine is the same body with the lane's half drawn as **fence**: the
 * run carries on through the machine's own block and meets the neighbouring
 * panels (or a wall) at the cell edge, so a doorless 闸机 closes a barrier line
 * instead of interrupting it.
 *
 * The leaf slides back into the machine as the gate opens (`setGateWing`, driven
 * by `SceneRenderer.updateGates`). A run of gates tiles correctly: each lane is
 * the gap between one gate's body and the next gate's body.
 *
 * Both faces wear the same control cluster, because a two-way gate is walked up
 * to from either side.
 */
function buildGate(ctx: ModuleContext, mod: Extract<Module, { type: 'gate' }>): THREE.Group {
  const mats = ctx.mats
  const lane = gateHasLane(mod)
  const g = new THREE.Group()
  const cx = -(0.5 - GATE_W / 2)
  const inner = -(0.5 - GATE_W)
  const front = GATE_D / 2
  const capBase = GATE_H - 0.04
  const headFront = gateDepthAt(capBase) / 2
  const topFront = gateDepthAt(GATE_H) / 2
  // Plinth, stainless body, navy head — vertical up to the shoulder, then the
  // trapezoid whose top is shorter than its base.
  slab(g, mats.darkSteel, cx, 0, GATE_PLINTH_H / 2, GATE_W - 0.02, GATE_D - 0.03, GATE_PLINTH_H)
  slab(g, mats.steel, cx, 0, (GATE_PLINTH_H + GATE_BODY_TOP) / 2, GATE_W, GATE_D, GATE_BODY_TOP - GATE_PLINTH_H)
  slab(g, mats.gateNavy, cx, 0, (GATE_BODY_TOP + GATE_SHOULDER) / 2, GATE_W, GATE_D, GATE_SHOULDER - GATE_BODY_TOP)
  const head = prism(g, mats.gateNavy, GATE_W, -front, front, -headFront, headFront, GATE_SHOULDER, capBase)
  head.position.x = cx
  const cap = prism(g, mats.darkSteel, GATE_W * 0.94, -headFront * 0.94, headFront * 0.94, -topFront, topFront, capBase, GATE_H)
  cap.position.x = cx
  for (const [fy, yaw] of [
    [-1, 0],
    [1, Math.PI],
  ] as const) {
    // `at(d, depth)` stands `d` off a face, outward, on this face.
    const at = (d: number, depth = GATE_D): number => fy * (depth / 2 + d)
    // The screen rides the sloped shoulder, tipped up at the passenger.
    const midZ = (GATE_SHOULDER + capBase) / 2
    const midFront = -(front + headFront) / 2
    const bezel = plate(g, mats.black, 0.3, 0.25, cx, at(0.004, 2 * midFront), midZ, yaw, GATE_SHOULDER_TILT)
    bezel.renderOrder = 1
    const screen = plate(g, mats.trainGlass, 0.26, 0.2, cx, at(0.014, 2 * midFront), midZ, yaw, GATE_SHOULDER_TILT)
    screen.renderOrder = 2
    // The two lane lights on the vertical face below the shoulder.
    plate(g, mats.ledGreen, 0.08, 0.05, cx - 0.15, at(0.025), 0.92, yaw)
    plate(g, mats.ledRed, 0.08, 0.05, cx + 0.15, at(0.025), 0.92, yaw)
    // The round card reader on its black pad…
    slab(g, mats.black, cx, at(0.012), 0.84, 0.18, 0.03, 0.12)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.016, 16), mats.green)
    ring.position.set(cx, at(0.026), 0.84)
    g.add(ring)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 16), mats.white)
    disc.position.set(cx, at(0.034), 0.84)
    g.add(disc)
    // …and the QR window below it.
    slab(g, mats.black, cx, at(0.012), 0.7, 0.16, 0.03, 0.085)
    plate(g, mats.trainGlass, 0.12, 0.05, cx, at(0.03), 0.7, yaw)
    // The lit lane arrow across the body's lower front — single-headed and
    // pointing up, the way through — and the blue band the reference gates print
    // their 入站 / 出站 sign on at the foot.
    slab(g, mats.black, cx, at(0.012), 0.39, 0.3, 0.03, 0.33)
    const arrow = plate(g, mats.gatePanel, 0.26, 0.29, cx, at(0.03), 0.39, yaw)
    arrow.renderOrder = 3
    slab(g, mats.blue, cx, at(0.014), 0.13, 0.3, 0.03, 0.07)
  }
  if (lane) {
    // The hinge pin on the machine's inner face, then the leaf itself, which
    // `setGateWing` keeps pinned there as it slides in. Its cabinet-side edge is
    // held fixed and the far edge runs back into the machine as the gate opens —
    // the leaf compresses along its length instead of swinging — and a stub
    // always stays proud of the panel, so the door never seems to vanish.
    slab(g, mats.darkSteel, inner + 0.015, 0, 0.51, 0.05, 0.1, 0.74)
    const fullW = 0.56
    const wing = slab(g, mats.gateRed, 0, 0, 0.51, fullW, 0.05, 0.68)
    wing.name = 'wing'
    wing.userData.fullW = fullW
    wing.userData.edgeX = inner
    g.userData.wing = wing
    setGateWing(g, 0)
  } else {
    // Doorless: the lane's half is fence, so the barrier carries on through this
    // cell. The panel meets the neighbouring run at the cell edge — and caps
    // itself there when that neighbour is nothing at all — and a jamb post stands
    // where it leaves the machine.
    const [ox, oy] = rotateLocal(mod.rot, 1, 0)
    const carried = ctx.data.modules.some((m) => {
      if (m.z !== mod.z || m.x !== mod.x + ox || m.y !== mod.y + oy) return false
      if (m.type === 'fence') return true
      // `gateSolidFaces` reads the offset from the other gate back to this cell.
      return m.type === 'gate' && gateSolidFaces(m, -ox, -oy)
    })
    drawFence(
      g,
      mats,
      {
        x0: inner,
        x1: 0.5,
        y0: 0,
        y1: 0,
        capE: !carried,
        capW: false,
        capN: false,
        capS: false,
      },
      false,
    )
    fencePost(g, mats, inner, 0)
  }
  return g
}

/** Metres of wing left proud of the cabinet when the gate is fully open. */
const WING_STUB = 0.06
/**
 * Set a turnstile's sliding wing. `open` 0 has the leaf shut across the lane,
 * 1 has it slid back into the cabinet. The leaf is compressed along its length
 * with the cabinet-side edge held fixed, so it reads as sliding into the panel
 * rather than rotating; a small stub always stays outside the panel.
 */
export function setGateWing(root: THREE.Object3D, open: number): void {
  const wing = root.userData.wing as THREE.Mesh | undefined
  if (!wing) return
  const fullW = (wing.userData.fullW as number) ?? 0.58
  const edgeX = (wing.userData.edgeX as number) ?? 0
  const s = 1 - open * (1 - WING_STUB / fullW)
  wing.scale.x = s
  // The leaf runs from the machine's inner face toward the far cell edge, so the
  // hinge end stays put as the leaf shrinks into the panel.
  wing.position.x = edgeX + (fullW * s) / 2
}

export class GateModel extends PieceBuilder {
  readonly kind = 'gate'
  build(mod: Extract<Module, { type: 'gate' }>): THREE.Group {
    return placeLocal(buildGate(this.ctx, mod), mod)
  }
}

