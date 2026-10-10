// Train consist (车辆) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { STOCK, CABIN_FLOOR_Z, CABIN_HALF_W, DOOR_HEAD_Z, DOOR_SILL_Z, doorCentres } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { buildCab } from './CabModel.ts'
import { buildTrainInterior } from './TrainInterior.ts'

/* ------------------------------------------------------------------ trains */

/**
 * Where the car's glazing starts, above the consist origin: a **waist rail** at
 * chest height over the cabin floor, so the window is the ~1 m band a seated
 * passenger sees over and a standing one is watched through. It has to clear the
 * cabin floor (`CABIN_FLOOR_Z`) by enough to be a rail, and stop under the door
 * head so the skin above the glass is the header, not a slit.
 */
const WINDOW_SILL_Z = 1.6

export interface TrainPose {
  x: number
  y: number
  z: number
  cars: number
  stock: StockClass
  doorsOpen: boolean
  colour: string
  dirSign: number
  /** Yaw (radians) that turns the consist's local +x onto the track's run axis. */
  yaw: number
}

/**
 * One train (车辆) as an A/B/C/L consist: rounded body, window band, livery,
 * sliding doors at the timetable's door centres and two bogies per car. Both
 * ends wear the same cab (§1.12), and only the lamps tell them apart: the
 * leading end lights white, the trailing end red. Built in world space with the
 * origin at the train centre on the track surface.
 *
 * The car is a **real cabin**, not a block with doors painted on it: a floor at
 * `CABIN_FLOOR_Z`, a ceiling, and a lining behind the seats, seen through a
 * glazed window band and the open doorways. That is what lets the crowd the sim
 * seats inside a consist (`World.seatAlighter` / `boardRider`) be *watched*
 * riding in — and stepping out of — a train rather than appearing beside one.
 * The skin still stops at every doorway, so a door opening is a real hole.
 *
 * The cab is a re-skin of the end car's last 2 m, not an extension, so the
 * body stays exactly `cars × carLength` long and the door cadence keeps lining
 * up with the screen doors it was derived from (§1.13). It stops just short of
 * the car's first passenger door, which stands `DOOR_END_INSET` in from the car
 * end. Only the coupler hangs past the nose, as it does on the real car.
 */
export function buildTrain(mats: ModelMaterials, pose: TrainPose): THREE.Group {
  const g = new THREE.Group()
  g.rotation.z = pose.yaw
  const s = STOCK[pose.stock]
  const total = s.length * pose.cars
  const blue = new THREE.MeshStandardMaterial({ color: new THREE.Color(pose.colour), roughness: 0.3, metalness: 0.4 })
  // The consist's own livery is minted per build (it wears the line's colour), so the
  // group owns it: everything else on a train is the shared kit, which `disposeObject`
  // deliberately keeps. `TrainSystem` releases these when it evicts the consist.
  const floor = new THREE.MeshStandardMaterial({ color: 0x586879, roughness: 0.85, metalness: 0 })
  g.userData.ownedMats = [blue, floor]
  const carDoors = doorCentres({ stock: pose.stock, cars: pose.cars })
  const doors: THREE.Mesh[] = []
  g.userData.doors = doors

  for (let c = 0; c < pose.cars; c++) {
    const carStart = c * s.length
    const carCentre = carStart + s.length / 2 - total / 2
    const bodyLen = s.length - 0.25
    const halfLen = bodyLen / 2
    const shellStart = carCentre - halfLen + (c === 0 ? 1.875 : 0)
    const shellEnd = carCentre + halfLen - (c === pose.cars - 1 ? 1.875 : 0)
    const shellCentre = (shellStart + shellEnd) / 2
    const shellLen = shellEnd - shellStart
    // Doors in this car. `doorCentres` offsets are already measured from the
    // consist centre, the same frame the car centres use.
    const inCar = carDoors.filter((off) => off > carCentre - s.length / 2 && off < carCentre + s.length / 2).sort((a, b) => a - b)
    // A car-side run that stops short of each doorway, so the body skin has a
    // real hole at every door.
    const sideRuns = (minX: number, maxX: number, pad: number): Array<[number, number]> => {
      const out: Array<[number, number]> = []
      let cur = minX
      for (const off of inCar) {
        const a = off - s.doorWidth / 2 - pad
        const b = off + s.doorWidth / 2 + pad
        if (b <= minX || a >= maxX) continue
        if (a > cur) out.push([cur, Math.min(a, maxX)])
        cur = Math.max(cur, b)
      }
      if (cur < maxX) out.push([cur, maxX])
      return out
    }

    // Car shell: a cabin between two end bulkheads, skinned by side panels that
    // stop at each doorway. The panels are cut at `WINDOW_SILL_Z`, so the glass
    // above them is the window the cabin is read through.
    const coreW = s.width - 0.6
    const skinY = s.width / 2 - 0.03
    const doorH = DOOR_HEAD_Z - DOOR_SILL_Z
    const doorZMid = (DOOR_SILL_Z + DOOR_HEAD_Z) / 2
    slab(g, mats.trainInterior, carCentre, 0, DOOR_HEAD_Z + 0.05, bodyLen, coreW + 0.24, 0.1)
    for (const e of [-1, 1]) {
      if ((e < 0 && c === 0) || (e > 0 && c === pose.cars - 1)) continue
      slab(g, mats.trainBody, carCentre + e * (halfLen - 0.04), 0, 1.75, 0.08, s.width - 0.08, 2.5)
    }
    // A rolled shoulder joins the flat side to the roof without a square eave.
    const roofSection = new THREE.Shape()
    const hw = s.width / 2
    roofSection.moveTo(-hw, 2.75)
    roofSection.quadraticCurveTo(-hw, 3.15, -hw + 0.4, 3.15)
    roofSection.lineTo(hw - 0.4, 3.15)
    roofSection.quadraticCurveTo(hw, 3.15, hw, 2.75)
    roofSection.lineTo(-hw, 2.75)
    roofSection.closePath()
    const roofGeometry = new THREE.ExtrudeGeometry(roofSection, { depth: shellLen, bevelEnabled: false, curveSegments: 32 })
    roofGeometry.rotateY(Math.PI / 2)
    roofGeometry.rotateX(Math.PI / 2)
    const roof = new THREE.Mesh(roofGeometry, mats.trainBody)
    roof.name = 'car-roof'
    roof.position.set(shellStart, 0, 0)
    g.add(roof)
    // Keep the underframe between the wheel backs rather than filling their space.
    slab(g, mats.trainDark, carCentre, 0, 0.39, bodyLen, 1.25, 0.22)
    for (const side of [-1, 1]) {
      const y = side * skinY
      // Full-length sill and header, then infill panels between the doors.
      slab(g, mats.trainBody, shellCentre, y, 0.51, shellLen, 0.06, 0.12)
      slab(g, mats.trainBody, shellCentre, y, 2.69, shellLen, 0.06, 0.12)
      for (const [a, b] of sideRuns(shellStart, shellEnd, 0)) {
        // Below the waist: body. Above it: the glazing that makes the cabin visible.
        slab(g, mats.trainBody, (a + b) / 2, y, (DOOR_SILL_Z + WINDOW_SILL_Z) / 2, b - a, 0.06, WINDOW_SILL_Z - DOOR_SILL_Z)
        slab(g, mats.glass, (a + b) / 2, y, (WINDOW_SILL_Z + DOOR_HEAD_Z) / 2, b - a, 0.04, DOOR_HEAD_Z - WINDOW_SILL_Z)
        // The lining behind the seats, so a passenger looking out of one window
        // sees a wall and not the platform through the window opposite. It stands
        // at the cabin's own clear half-width, the box the sim seats riders in.
        slab(g, mats.trainInterior, (a + b) / 2, side * (CABIN_HALF_W + 0.02), (CABIN_FLOOR_Z + WINDOW_SILL_Z) / 2, b - a, 0.04, WINDOW_SILL_Z - CABIN_FLOOR_Z)
      }
    }

    // Livery band on both sides, broken at the doorways. The window band above it
    // is glass now, so nothing opaque covers the cabin.
    for (const side of [-1, 1]) {
      const face = (side * s.width) / 2
      for (const [a, b] of sideRuns(shellStart, shellEnd, 0.05)) {
        slab(g, blue, (a + b) / 2, face + side * 0.02, 1.05, b - a, 0.05, 0.34)
      }
      // Longitudinal seating in the bays between the doors, under the windows —
      // the doorways themselves stay clear for the people walking out of them.
    }

    // Ceiling lighting down the cabin, so the interior reads as a lit room.
    buildTrainInterior(g, mats, carCentre - halfLen, carCentre + halfLen,
      sideRuns(shellStart + 0.1, shellEnd - 0.1, 0.25), inCar, floor)

    // Sliding doors onto the cabin: two leaves per side part to reveal the
    // interior the platform is about to trade passengers with.
    //
    // A leaf has to **read as a door**, not as a hole, and it has to wear the car's own
    // paint. It used to be one `mats.trainDark` slab — the same value as the cabin's
    // shadow behind the doorway — so a closed consist photographed as a row of black
    // rectangles with no door in them, which is what the elevations on sheets 05 and 11
    // showed. A leaf is now the body's own material with a **window** in its upper half,
    // a kick plate at its foot, and a rubber seal standing at each jamb of the doorway it
    // closes: the leaf is the door, the window is what the cabin is still watched through,
    // and the two closed leaves stay two leaves.
    for (const dx of inCar) {
      for (const side of [-1, 1]) {
        const face = (side * s.width) / 2
        for (const px of [-1, 1]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, doorH - 0.12, 8), mats.steel)
          // A cylinder's axis is +y; the cabin's up is +z, so tip it upright.
          pole.rotation.x = Math.PI / 2
          pole.position.set(dx + px * (s.doorWidth / 2 + 0.1), side * (skinY - 0.16), doorZMid)
          g.add(pole)
        }
        // The doorway's own seal, at each jamb: the skin's cut edge is body colour,
        // and a door needs a frame to sit in. It does not move with the leaves.
        for (const jamb of [-1, 1]) {
          slab(g, mats.rubber, dx + (jamb * s.doorWidth) / 2, face + side * 0.015, doorZMid, 0.06, 0.03, doorH)
        }
        for (const leaf of [-1, 1]) {
          const lw = s.doorWidth / 2 - 0.03
          // The leaf wears the **body's own paint** (`mats.trainBody`): a door is part of
          // the car's skin, and the two have to read as one colour. It was `mats.steel`
          // first, which is `metalness: 0.72` — with no environment map a metal has no
          // diffuse, so the ambient light in the rig does not reach it and the leaf came out
          // charcoal while the body beside it stayed near-white (the same trap `trainBody`
          // itself records). Steel is for the fittings: the grab poles below.
          // A real aperture: a glass box against an uncut painted slab shares
          // its back face and flickers. The frame surrounds the pane (§1.13).
          const frame = new THREE.Shape()
          frame.moveTo(-lw / 2, -doorH / 2)
          frame.lineTo(lw / 2, -doorH / 2)
          frame.lineTo(lw / 2, doorH / 2)
          frame.lineTo(-lw / 2, doorH / 2)
          frame.closePath()
          const window = new THREE.Path()
          const windowHalfW = (lw - 0.18) / 2
          window.moveTo(-windowHalfW, 0.28 - 0.43)
          window.lineTo(-windowHalfW, 0.28 + 0.43)
          window.lineTo(windowHalfW, 0.28 + 0.43)
          window.lineTo(windowHalfW, 0.28 - 0.43)
          window.closePath()
          frame.holes.push(window)
          const geometry = new THREE.ExtrudeGeometry(frame, { depth: 0.05, bevelEnabled: false })
          geometry.rotateX(Math.PI / 2)
          geometry.translate(0, 0.025, 0)
          const m = new THREE.Mesh(geometry, mats.trainBody)
          m.position.set(dx + (leaf * s.doorWidth) / 4, face + side * 0.065, doorZMid)
          g.add(m)
          // Inset 5 mm from the aperture edges; the pane has no opaque backing.
          const pane = slab(m, mats.glass, 0, 0, 0.28, lw - 0.19, 0.02, 0.85)
          pane.name = 'train-door-window'
          // The kick plate, so the leaf has a foot and the sill has a line.
          slab(m, mats.rubber, 0, side * 0.041, -doorH / 2 + 0.14, lw, 0.02, 0.28)
          registerDoorLeaf(m, leaf, s.doorWidth / 2, doors, side)
        }
      }
    }
    // Two bogies.
    for (const b of [-1, 1]) {
      const bx = carCentre + (b * s.length) / 3
      slab(g, mats.darkSteel, bx, 0, 0.37, 2.2, 1.22, 0.16)
      // The fixed cabin floor starts at z=.50 underneath. Wheels touch the rail
      // at zero and stop at .48, leaving clearance without moving the doors (§1.13).
      for (const axle of [-1, 1]) {
        const ax = bx + axle * 0.72
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.65, 10), mats.darkSteel)
        shaft.position.set(ax, 0, 0.24)
        g.add(shaft)
        for (const wy of [-1, 1]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.13, 20), mats.darkSteel)
          wheel.position.set(ax, wy * 0.75, 0.24)
          g.add(wheel)
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.145, 12), mats.steel)
          hub.position.copy(wheel.position)
          g.add(hub)
          slab(g, mats.darkSteel, ax, wy * 0.57, 0.39, 0.22, 0.18, 0.16)
        }
      }
    }
  }

  // A cab at each end (車头), identical but for the lamps: the leading one burns
  // white, the trailing one red — the only difference the reference photos show
  // between the two ends of a consist.
  const lead = (total / 2) * (pose.dirSign >= 0 ? 1 : -1)
  const leadOut = pose.dirSign >= 0 ? 1 : -1
  buildCab(g, mats, s, lead, leadOut, true)
  buildCab(g, mats, s, -lead, -leadOut, false)
  // The train keeps its own pose; the caller moves the group.
  g.position.set(pose.x, pose.y, pose.z)
  return g
}

/**
 * Slide the two door banks of a consist independently (GAME-SPEC §1.13): `plus`
 * drives the leaves on the consist's local +y, `minus` those on local −y, each
 * 0 shut to 1 fully open. A side with no platform screen doors is simply left at
 * 0, so a train never opens onto the tunnel wall. Leaves with no side (a screen
 * door, a lift cabin) follow `plus`.
 */
export function setDoorsSides(root: THREE.Object3D, plus: number, minus: number): void {
  const doors = (root.userData.doors as THREE.Mesh[] | undefined) ?? []
  for (const d of doors) {
    const side = (d.userData.side as number | undefined) ?? 1
    const t = side >= 0 ? plus : minus
    const closed = (d.userData.closedX as number) ?? d.position.x
    const sign = (d.userData.openSign as number) ?? 1
    const travel = (d.userData.travel as number) ?? 0.32
    d.position.x = closed + sign * travel * t
  }
}

/**
 * Slide every registered door leaf of `root` to progress `t` (0 shut, 1 fully
 * open). The caller owns the easing/progress; this only places the geometry.
 */
export function setDoors(root: THREE.Object3D, t: number): void {
  setDoorsSides(root, t, t)
}

export class TrainModel extends PieceBuilder {
  readonly kind = 'train'
  build(pose: TrainPose): THREE.Group {
    return buildTrain(this.ctx.mats, pose)
  }
}

