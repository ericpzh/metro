// Train consist (车辆) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { STOCK, doorCentres } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { buildCab } from './CabModel.ts'

/* ------------------------------------------------------------------ trains */

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
  g.userData.ownedMats = [blue]
  const carDoors = doorCentres({ stock: pose.stock, cars: pose.cars })
  const doors: THREE.Mesh[] = []
  g.userData.doors = doors

  for (let c = 0; c < pose.cars; c++) {
    const carStart = c * s.length
    const carCentre = carStart + s.length / 2 - total / 2
    const bodyLen = s.length - 0.25
    const halfLen = bodyLen / 2
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

    // Car shell. A narrower core with full-width end walls is skinned by side
    // panels that stop at each doorway, so a door opening is a real hole into
    // the cabin rather than a darker panel on a solid block.
    const coreW = s.width - 0.6
    const skinY = s.width / 2 - 0.03
    const doorZ0 = 0.57
    const doorZ1 = 2.63
    const doorH = doorZ1 - doorZ0
    const doorZMid = (doorZ0 + doorZ1) / 2
    slab(g, mats.trainBody, carCentre, 0, 1.75, bodyLen, coreW, 2.5)
    for (const e of [-1, 1]) slab(g, mats.trainBody, carCentre + e * (halfLen - 0.04), 0, 1.75, 0.08, s.width, 2.5)
    slab(g, mats.trainRoof, carCentre, 0, 3.05, bodyLen, s.width - 0.2, 0.2)
    slab(g, mats.trainDark, carCentre, 0, 0.42, bodyLen, s.width - 0.1, 0.5)
    for (const side of [-1, 1]) {
      const y = side * skinY
      // Full-length sill and header, then infill panels between the doors.
      slab(g, mats.trainBody, carCentre, y, 0.51, bodyLen, 0.06, 0.12)
      slab(g, mats.trainBody, carCentre, y, 2.82, bodyLen, 0.06, 0.38)
      for (const [a, b] of sideRuns(carCentre - halfLen, carCentre + halfLen, 0)) {
        slab(g, mats.trainBody, (a + b) / 2, y, doorZMid, b - a, 0.06, doorH)
      }
    }

    // Window band and livery on both sides, broken at the doorways.
    for (const side of [-1, 1]) {
      const face = (side * s.width) / 2
      for (const [a, b] of sideRuns(carCentre - (bodyLen - 1.4) / 2, carCentre + (bodyLen - 1.4) / 2, 0.05)) {
        slab(g, mats.trainDark, (a + b) / 2, face + side * 0.01, 2.35, b - a, 0.06, 0.95)
      }
      for (const [a, b] of sideRuns(carCentre - bodyLen / 2, carCentre + bodyLen / 2, 0.05)) {
        slab(g, blue, (a + b) / 2, face + side * 0.02, 1.05, b - a, 0.05, 0.34)
      }
      // The nose accent belongs to the cabs now (`buildCab` draws their cream
      // swoosh); a rising patch on every car only muddied the window band.
    }

    // Sliding doors over a modelled cabin: two leaves per side part to reveal an
    // open interior — a lit cavity with a bench and grab poles.
    for (const dx of inCar) {
      for (const side of [-1, 1]) {
        const face = (side * s.width) / 2
        // The cavity is an open box drawn from the inside (back faces only), so
        // its rear wall, floor, ceiling and jambs read as the car interior.
        const cavity = new THREE.Mesh(new THREE.BoxGeometry(s.doorWidth, 0.26, doorH), mats.trainInterior)
        cavity.position.set(dx, side * (skinY - 0.13), doorZMid)
        g.add(cavity)
        // A bench along the back wall and two grab poles.
        slab(g, mats.trainSeat, dx, side * (skinY - 0.18), doorZ0 + 0.28, s.doorWidth - 0.24, 0.16, 0.36)
        for (const px of [-1, 1]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, doorH - 0.12, 8), mats.steel)
          // A cylinder's axis is +y; the cabin's up is +z, so tip it upright.
          pole.rotation.x = Math.PI / 2
          pole.position.set(dx + px * (s.doorWidth / 3), side * (skinY - 0.16), doorZMid)
          g.add(pole)
        }
        // Ceiling strip light.
        slab(g, mats.glow, dx, side * (skinY - 0.16), doorZ1 - 0.07, s.doorWidth - 0.16, 0.12, 0.04)
        for (const leaf of [-1, 1]) {
          const m = slab(g, mats.trainDark, dx + (leaf * s.doorWidth) / 4, face + side * 0.03, 1.6, s.doorWidth / 2 - 0.03, 0.05, 2.1)
          registerDoorLeaf(m, leaf, s.doorWidth / 2, doors, side)
        }
      }
    }
    // Two bogies.
    for (const b of [-1, 1]) {
      const bx = carCentre + (b * s.length) / 3
      slab(g, mats.black, bx, 0, 0.35, 2.2, 1.9, 0.4)
      for (const wy of [-1, 1]) {
        // A rail wheel's axle runs across the car (+y), which is the cylinder's
        // default axis, so it needs no rotation — radius 0.36 puts the tread on
        // the rail at z = 0.
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 10), mats.rubber)
        wheel.position.set(bx, (wy * 1.5) / 2 + wy * 0.2, 0.36)
        g.add(wheel)
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

