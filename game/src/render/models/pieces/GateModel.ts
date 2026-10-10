// Turnstile (闸机) housings and opposing retracting leaves — GAME-SPEC.md §5.2.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, plateOf, prism, placeLocal, drawFence, fencePost } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import { gateHasLane, gateSolidFaces } from '../../../sim/gates.ts'
import { rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'

/* ------------------------------------------------------------------ gate */

const GATE_W = 0.30
const GATE_D = 0.9
const GATE_PLINTH_H = 0.08
const GATE_BODY_TOP = 0.62
const GATE_SHOULDER = 0.80
const GATE_H = 1.25
// The older reader has a long sloping fascia and a short flat crown.
const GATE_SHOULDER_TILT = Math.atan(0.33 / (GATE_H - GATE_SHOULDER))
/** The machine's depth at a height up in the tapered head. */
function gateDepthAt(z: number): number {
  return GATE_D - 2 * (z - GATE_SHOULDER) * Math.tan(GATE_SHOULDER_TILT)
}

// §5.2: the cabinet hugs the cell edge; the two leaves meet inside its lane.
function buildGate(ctx: ModuleContext, mod: Extract<Module, { type: 'gate' }>): THREE.Group {
  const mats = ctx.mats
  const lane = gateHasLane(mod)
  const modern = mod.cfg.variant === 'new'
  const g = new THREE.Group()
  const cx = -(0.5 - GATE_W / 2)
  const inner = -(0.5 - GATE_W)
  const front = GATE_D / 2
  const capBase = GATE_H - 0.04
  const headFront = gateDepthAt(capBase) / 2
  const topFront = gateDepthAt(GATE_H) / 2
  slab(g, mats.darkSteel, cx, 0, GATE_PLINTH_H / 2, GATE_W - 0.02, GATE_D - 0.03, GATE_PLINTH_H)
  if (modern) {
    // Rounded stainless ends, continuous blue belt, and a long reader ramp.
    const shape = new THREE.Shape()
    const x0 = cx - GATE_W / 2, x1 = cx + GATE_W / 2
    const y0 = -front, y1 = front, r = 0.075
    shape.moveTo(x0 + r, y0)
    shape.lineTo(x1 - r, y0); shape.quadraticCurveTo(x1, y0, x1, y0 + r)
    shape.lineTo(x1, y1 - r); shape.quadraticCurveTo(x1, y1, x1 - r, y1)
    shape.lineTo(x0 + r, y1); shape.quadraticCurveTo(x0, y1, x0, y1 - r)
    shape.lineTo(x0, y0 + r); shape.quadraticCurveTo(x0, y0, x0 + r, y0)
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.80, bevelEnabled: false, curveSegments: 8 }), mats.steel)
    body.position.z = GATE_PLINTH_H
    g.add(body)
    slab(g, mats.blue, cx, 0, 0.90, GATE_W, GATE_D - 0.02, 0.045)
    const hood = prism(g, mats.steel, GATE_W, -front + 0.02, front - 0.02, -0.13, 0.13, 0.923, 1.12)
    hood.position.x = cx
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, GATE_W * 0.94, 24), mats.steel)
    crown.rotation.z = Math.PI / 2
    crown.position.set(cx, 0, 1.12)
    g.add(crown)
    for (const x of [cx - GATE_W / 2 + 0.004, cx + GATE_W / 2 - 0.004]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.006, 24), mats.blue)
      end.rotation.z = Math.PI / 2
      end.position.set(x, 0, 1.12)
      g.add(end)
    }
  } else {
    slab(g, mats.steel, cx, 0, (GATE_PLINTH_H + GATE_BODY_TOP) / 2, GATE_W, GATE_D, GATE_BODY_TOP - GATE_PLINTH_H)
    slab(g, mats.gateNavy, cx, 0, (GATE_BODY_TOP + GATE_SHOULDER) / 2, GATE_W, GATE_D, GATE_SHOULDER - GATE_BODY_TOP)
    const head = prism(g, mats.gateNavy, GATE_W, -front, front, -headFront, headFront, GATE_SHOULDER, capBase)
    head.position.x = cx
    const cap = prism(g, mats.darkSteel, GATE_W * 0.94, -headFront * 0.94, headFront * 0.94, -topFront, topFront, capBase, GATE_H)
    cap.position.x = cx
  }
  for (const [fy, yaw] of [
    [-1, 0],
    [1, Math.PI],
  ] as const) {
    // `at(d, depth)` stands `d` off a face, outward, on this face.
    const at = (d: number, depth = GATE_D): number => fy * (depth / 2 + d)
    if (modern) {
      const tilt = Math.atan((front - 0.02 - 0.13) / (1.12 - 0.923))
      const panel = plate(g, mats.black, 0.235, 0.35, cx, fy * 0.292, 1.025, yaw, tilt)
      panel.renderOrder = 1
      plate(g, mats.trainGlass, 0.17, 0.09, cx, fy * 0.235, 1.067, yaw, tilt)
      plate(g, mats.blue, 0.13, 0.065, cx, fy * 0.337, 1.00, yaw, tilt)
      plate(g, mats.white, 0.11, 0.035, cx, fy * 0.390, 0.965, yaw, tilt)
      plate(g, mats.black, 0.14, 0.055, cx, fy * 0.125, 1.17, yaw, 25 * Math.PI / 180)
    } else {
      // All reader details follow the fascia plane, rather than standing on
      // the vertical front. The NFC circle is printed ink, not a raised button.
      const onSlope = (z: number, offset = 0.002) => fy * (gateDepthAt(z) / 2 + offset)
      const fascia = plate(g, mats.gateNavy, 0.25, 0.47, cx, onSlope(1.005), 1.005, yaw, GATE_SHOULDER_TILT)
      fascia.name = 'old-reader-fascia'
      plate(g, mats.black, 0.215, 0.145, cx, onSlope(1.125, 0.004), 1.125, yaw, GATE_SHOULDER_TILT)
      plate(g, mats.trainGlass, 0.18, 0.11, cx, onSlope(1.125, 0.005), 1.125, yaw, GATE_SHOULDER_TILT)
      const sticker = plateOf(g, new THREE.CircleGeometry(0.067, 32), mats.white, cx, onSlope(0.985, 0.004), 0.985, yaw, GATE_SHOULDER_TILT)
      sticker.name = 'reader-sticker'
      for (const radius of [0.025, 0.041]) {
        plateOf(g, new THREE.RingGeometry(radius, radius + 0.002, 32), mats.gateNavy, cx, onSlope(0.985, 0.0045), 0.985, yaw, GATE_SHOULDER_TILT)
      }
      plate(g, mats.gateNavy, 0.022, 0.026, cx, onSlope(0.985, 0.005), 0.985, yaw, GATE_SHOULDER_TILT)
      // QR/token reader below the sloped card reader, inset into its dark bezel.
      slab(g, mats.black, cx, at(0.005), 0.70, 0.15, 0.018, 0.11)
      plate(g, mats.blue, 0.115, 0.075, cx, at(0.015), 0.70, yaw)
      plate(g, mats.white, 0.093, 0.060, cx, at(0.016), 0.70, yaw)
      plate(g, mats.black, 0.018, 0.018, cx, at(0.017), 0.70, yaw)
    }
    // Each approach face points diagonally down toward the lane beside it.
    slab(g, mats.black, cx, at(0.008), 0.44, 0.20, 0.024, 0.27)
    const allowed = lane && (mod.cfg.dir === 'both' || (fy === -1 ? mod.cfg.dir === 'in' : mod.cfg.dir === 'out'))
    const indicator = plate(g, allowed ? (fy === -1 ? mats.gatePanel : mats.gatePanelBack) : mats.gateCross, 0.18, 0.23, cx, at(0.022), 0.44, yaw)
    indicator.name = allowed ? 'entry-arrow' : 'no-entry-cross'
    indicator.renderOrder = 3
  }
  if (lane) {
    const wings = new THREE.Group()
    wings.name = 'wing'
    g.add(wings)
    g.userData.wing = wings
    const fullW = (0.5 - inner) / 2
    for (const [edgeX, sign] of [[inner, 1], [0.5, -1]]) {
      // Fan-shaped flaps: broad curved top, short lower edge and an angled
      // free edge. Extrusion gives the same thin panel on both approach sides.
      const flap = new THREE.Shape()
      const w = fullW - 0.006
      flap.moveTo(0, -0.215)
      flap.lineTo(w * 0.40, -0.215)
      flap.quadraticCurveTo(w * 0.46, -0.205, w * 0.49, -0.16)
      flap.lineTo(w, 0.15)
      flap.quadraticCurveTo(w * 0.55, 0.24, 0, 0.205)
      flap.closePath()
      const geom = new THREE.ExtrudeGeometry(flap, { depth: 0.035, bevelEnabled: false, curveSegments: 12 })
      // Shape coordinates are (reach, height); the thin extrusion runs along y.
      const pos = geom.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), height = pos.getY(i), thickness = pos.getZ(i)
        pos.setXYZ(i, sign * (x - fullW / 2), thickness - 0.0175, height)
      }
      geom.computeVertexNormals()
      const wing = new THREE.Mesh(geom, mats.gateRed)
      wing.position.z = 0.64
      wings.add(wing)
      wing.name = sign === 1 ? 'left-leaf' : 'right-leaf'
      wing.userData = { fullW, edgeX, sign }

    }
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

/** §5.2: opposing leaves retract into both sides of the passage. */
export function setGateWing(root: THREE.Object3D, open: number): void {
  const wings = root.userData.wing as THREE.Group | undefined
  if (!wings) return
  const t = Math.max(0, Math.min(1, open))
  for (const leaf of wings.children) {
    const { fullW, edgeX, sign } = leaf.userData
    const width = fullW * (1 - t) + 0.025 * t
    leaf.scale.x = width / fullW
    leaf.position.x = edgeX + sign * width / 2
  }
}

export class GateModel extends PieceBuilder {
  readonly kind = 'gate'
  build(mod: Extract<Module, { type: 'gate' }>): THREE.Group {
    return placeLocal(buildGate(this.ctx, mod), mod)
  }
}

