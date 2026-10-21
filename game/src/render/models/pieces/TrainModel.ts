// Train consist (车辆) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { trainDoorMotion } from '../../trainDoorMotion.ts'
import { PieceBuilder, slab, registerDoorLeaf } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { STOCK, CABIN_FLOOR_Z, CABIN_HALF_W, DOOR_HEAD_Z, DOOR_SILL_Z, doorCentres, doorWidthAt } from '../../../sim/stock.ts'
import type { StockClass } from '../../../sim/stock.ts'
import { buildCab } from './CabModel.ts'
import { buildStreamlinedCab } from './StreamlinedCab.ts'
import { buildDCarShell, buildDGangway, buildDDoor } from './DTrainShell.ts'
import { CAR_GAP, buildConsistGangways } from './TrainGangway.ts'
import { buildTrainInterior, buildTrainCeiling } from './TrainInterior.ts'
import { syncTrainDoorBatches } from '../../trainBatches.ts'
import { buildBWindowBay } from './BTrainWindows.ts'
import { buildLWindowBay } from './LTrainWindows.ts'
import { buildCWindowBay } from './CTrainWindows.ts'
import { addCarSideSkin, curveCarDoor, openRoofUnderside, carRoofSection, smoothCarRoof, carShellProfile, CAR_ROUND_SILL, CAR_ROUND_WAIST } from './CarShellProfile.ts'
import { buildTrainBogie, carBogieCentres } from './TrainBogie.ts'
import { buildTrainUnderframe } from './TrainUnderframe.ts'
import { buildTrainRoofAc } from './TrainRoofAc.ts'
import { buildTrainPantograph, PANTOGRAPH_MOUNT_Z, PANTOGRAPH_WELL_HALF_LENGTH } from './TrainPantograph.ts'

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
  /** Absent for legacy model callers, which keep the third-rail roof. */
  power?: 'third-rail' | 'catenary'
  modelScale?: number
}

/**
 * One train (车辆) as an A/B/C/D/L consist: rounded body, window band, livery,
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
  g.userData.liveryMaterial = blue
  // The consist's own livery is minted per build (it wears the line's colour), so the
  // group owns it: everything else on a train is the shared kit, which `disposeObject`
  // deliberately keeps. `TrainSystem` releases these when it evicts the consist.
  const floor = new THREE.MeshStandardMaterial({ color: 0x586879, roughness: 0.85, metalness: 0 })
  g.userData.ownedMats = [blue, floor]
  const carDoors = doorCentres({ stock: pose.stock, cars: pose.cars })
  const doors: THREE.Mesh[] = []
  g.userData.doors = doors
  // Every car boundary that has a car on both sides, in the consist's own x. A/B/C/L
  // close each of them with the black gangway below; D wears its own curved bellows.
  const joints: number[] = []

  for (let c = 0; c < pose.cars; c++) {
    const carStart = c * s.length
    if (c > 0) {
      const joint = carStart - total / 2
      if (pose.stock === 'D') buildDGangway(g, mats, joint)
      else joints.push(joint)
    }
    const carCentre = carStart + s.length / 2 - total / 2
    // The car stops `CAR_GAP` short of its own length, which is the gap the gangway fills.
    const bodyLen = s.length - CAR_GAP
    const halfLen = bodyLen / 2
    let pantographX: number | undefined
    if (pose.power === 'catenary' && (c === 0 || c === pose.cars - 1)) {
      const inward = c === 0 ? 1 : -1
      pantographX = pose.cars === 1 ? carCentre : carCentre + inward * (halfLen - 2)
      buildTrainPantograph(g, mats, pantographX, inward, PANTOGRAPH_MOUNT_Z)
    }
    const cabCut = (s.cabLength ?? 2) - 0.125
    const shellStart = carCentre - halfLen + (c === 0 ? cabCut : 0)
    const shellEnd = carCentre + halfLen - (c === pose.cars - 1 ? cabCut : 0)
    // Doors in this car. `doorCentres` offsets are already measured from the
    // consist centre, the same frame the car centres use.
    const inCar = carDoors.filter((off) => off > carCentre - s.length / 2 && off < carCentre + s.length / 2).sort((a, b) => a - b)
    const bogieCentres = carBogieCentres(inCar)
    const axleHalfSpan = Math.min(.72, ((inCar[1]-inCar[0])-s.doorWidth-.8)/2-.05)
    // A car-side run that stops short of each doorway, so the body skin has a
    // real hole at every door.
    const sideRuns = (minX: number, maxX: number, pad: number): Array<[number, number]> => {
      const out: Array<[number, number]> = []
      let cur = minX
      for (const off of inCar) {
        const width = doorWidthAt({stock:pose.stock,cars:pose.cars}, off)
        const a = off - width / 2 - pad
        const b = off + width / 2 + pad
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
    const skinY = s.width / 2 - 0.03
    const doorH = DOOR_HEAD_Z - DOOR_SILL_Z
    const doorZMid = (DOOR_SILL_Z + DOOR_HEAD_Z) / 2
    buildTrainCeiling(g, mats.trainInterior, shellStart, shellEnd, s.width, pose.stock === 'D')
    if (pose.stock === 'D') {
      buildDCarShell(g, mats, shellStart, shellEnd, sideRuns(shellStart, shellEnd, 0), blue, pantographX)
    } else {
      for (const e of [-1, 1]) {
        if ((e < 0 && c === 0) || (e > 0 && c === pose.cars - 1)) continue
        const profile=carShellProfile(s.width), endShape=new THREE.Shape()
        endShape.moveTo(-profile[0].y,profile[0].z)
        for(const p of profile)endShape.lineTo(p.y,p.z)
        for(const p of [...profile].reverse())endShape.lineTo(-p.y,p.z)
        endShape.closePath()
        const geometry=new THREE.ExtrudeGeometry(endShape,{depth:.08,bevelEnabled:false})
        geometry.rotateY(Math.PI/2);geometry.rotateX(Math.PI/2)
        const end=new THREE.Mesh(geometry,mats.trainBody);end.name='car-end-bulkhead'
        end.position.x=carCentre+e*(halfLen-.04)-.04;g.add(end)
      }
      // A rolled shoulder joins the flat side to the roof without a square eave. The
      // outline is `TrainGangway`'s own (`CAR_WAIST_Z`, `CAR_CROWN_Z`, `CAR_SHOULDER`),
      // because the gangway between two cars is the same section, lightly inboard.
      const roofSection = carRoofSection(s.width)
      const roofRuns: Array<{ start: number; end: number; section: THREE.Shape; lowSection: THREE.Shape }> = []
      const plain = (start: number, end: number) => ({start,end,section:roofSection,lowSection:carRoofSection(s.width,true)})
      if (pantographX === undefined) roofRuns.push(plain(shellStart,shellEnd))
      else {
        const a = pantographX - PANTOGRAPH_WELL_HALF_LENGTH, b = pantographX + PANTOGRAPH_WELL_HALF_LENGTH
        roofRuns.push(plain(shellStart,a), {start:a,end:b,section:carRoofSection(s.width,false,PANTOGRAPH_MOUNT_Z),lowSection:carRoofSection(s.width,true,PANTOGRAPH_MOUNT_Z)}, plain(b,shellEnd))
      }
      for (const run of roofRuns) {
        const roofGeometry = new THREE.ExtrudeGeometry(run.section, { depth: run.end - run.start, bevelEnabled: false, curveSegments: 32 })
        roofGeometry.rotateY(Math.PI / 2)
        roofGeometry.rotateX(Math.PI / 2)
        openRoofUnderside(roofGeometry)
        smoothCarRoof(roofGeometry,s.width)
        const roof = new THREE.Mesh(roofGeometry, mats.trainBody)
        roof.name = 'car-roof'
        roof.position.set(run.start, 0, 0)
        // Four curve segments retain both rolled shoulders at Low, including
        // the vertical edges of the recessed pantograph mounting well.
        const lowRoof = new THREE.ExtrudeGeometry(run.lowSection, { depth: run.end - run.start, bevelEnabled: false, curveSegments: 4 })
        lowRoof.rotateY(Math.PI / 2)
        lowRoof.rotateX(Math.PI / 2)
        openRoofUnderside(lowRoof)
        smoothCarRoof(lowRoof,s.width,true)
        setModelDetail(roof, lowRoof)
        g.add(roof)
      }
      for (const side of [-1, 1]) {
        const y = side * skinY
        // Full-length sill and header, then infill panels between the doors. Both are the
        // shell's own outline height, so the body's sill is `CAR_SILL_Z` exactly.
        addCarSideSkin(g,mats.trainBody,s.width,shellStart,shellEnd,CAR_ROUND_SILL,DOOR_SILL_Z,side)
        addCarSideSkin(g,mats.trainBody,s.width,shellStart,shellEnd,DOOR_HEAD_Z,CAR_ROUND_WAIST,side)
        for (const [a, b] of sideRuns(shellStart, shellEnd, 0)) {
          // Below the waist: body. Above it: the glazing that makes the cabin visible.
          addCarSideSkin(g,mats.trainBody,s.width,a,b,DOOR_SILL_Z,WINDOW_SILL_Z,side)
          if (pose.stock === 'A' || pose.stock === 'B') {
            // Only inter-door bays carry passenger windows: four on A, three on B.
            // Shared inset glazing keeps the windows small and end bays painted.
            const betweenDoors = a > inCar[0] && b < inCar[inCar.length - 1]
            buildBWindowBay(g, mats, a, b, y, WINDOW_SILL_Z, DOOR_HEAD_Z, betweenDoors, pose.stock)
          } else if (pose.stock === 'C') {
            buildCWindowBay(g, mats, a, b, y, WINDOW_SILL_Z, DOOR_HEAD_Z,
              a > inCar[0] && b < inCar[inCar.length - 1])
          } else if (pose.stock === 'L') {
            buildLWindowBay(g, mats, a, b, y, WINDOW_SILL_Z, DOOR_HEAD_Z,
              a > inCar[0] && b < inCar[inCar.length - 1])
          } else {
            slab(g, mats.glass, (a + b) / 2, y, (WINDOW_SILL_Z + DOOR_HEAD_Z) / 2, b - a, 0.04, DOOR_HEAD_Z - WINDOW_SILL_Z)
          }
          // The lining behind the seats, so a passenger looking out of one window
          // sees a wall and not the platform through the window opposite. It stands
          // at the cabin's own clear half-width, the box the sim seats riders in.
          slab(g, mats.trainInterior, (a + b) / 2, side * (CABIN_HALF_W + 0.02), (CABIN_FLOOR_Z + WINDOW_SILL_Z) / 2, b - a, 0.04, WINDOW_SILL_Z - CABIN_FLOOR_Z)
        }
      }

      // Livery band on both sides, broken at the doorways. The window band above it
      // is glass now, so nothing opaque covers the cabin.
      for (const side of [-1, 1]) {
        for (const [a, b] of sideRuns(shellStart, shellEnd, 0.05)) {
          addCarSideSkin(g,blue,s.width,a,b,.88,1.22,side,.001)
        }
        // Longitudinal seating in the bays between the doors, under the windows —
        // the doorways themselves stay clear for the people walking out of them.
      }
    }
    const frameStart = carCentre - halfLen + (s.cabLength && c === 0 ? 1.5 : 0)
    const frameEnd = carCentre + halfLen - (s.cabLength && c === pose.cars - 1 ? 1.5 : 0)
    slab(g, mats.trainDark, (frameStart + frameEnd) / 2, 0, 0.39, frameEnd - frameStart, 1.25, 0.22)

    // Ceiling lighting down the cabin, so the interior reads as a lit room.
    buildTrainInterior(g, mats, s.cabLength ? shellStart : carCentre - halfLen, s.cabLength ? shellEnd : carCentre + halfLen,
      sideRuns(shellStart + 0.1, shellEnd - 0.1, 0.25), inCar, floor, pose.stock === 'D', [shellStart, shellEnd], s.width, bogieCentres, axleHalfSpan+.48)

    // Sliding doors onto the cabin: two leaves per side part to reveal the
    // interior the platform is about to trade passengers with.
    //
    // A leaf has to **read as a door**, not as a hole, and it has to wear the car's own
    // paint. It used to be one `mats.trainDark` slab — the same value as the cabin's
    // shadow behind the doorway — so a closed consist photographed as a row of black
    // rectangles with no door in them, which is what the elevations on sheets 05 and 11
    // showed. A leaf is now the body's own material with a **window** in its upper half,
    // a thin rubber perimeter around each leaf and seals at each jamb of the doorway it
    // closes: the leaf is the door, the window is what the cabin is still watched through,
    // and the two closed leaves stay two leaves.
    for (const dx of inCar) {
      for (const side of [-1, 1]) {
        const face = side * s.width / 2
        if (pose.stock === 'D') {
          buildDDoor(g, mats, dx, side, doorWidthAt({stock:pose.stock,cars:pose.cars}, dx), doors, doorWidthAt({stock:pose.stock,cars:pose.cars}, dx) === s.singleEndDoorWidth)
          continue
        }
        for (const px of [-1, 1]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, doorH - 0.12, 8), mats.steel)
          // A cylinder's axis is +y; the cabin's up is +z, so tip it upright.
          pole.rotation.x = Math.PI / 2
          pole.position.set(dx + px * (s.doorWidth / 2 + 0.1), side * (skinY - 0.16), doorZMid)
          g.add(pole)
        }
        // The doorway's own seal, at each jamb: the skin's cut edge is body colour,
        // and a door needs a frame to sit in. It does not move with the leaves.
        // Low drops the 3 cm rubber strip: the leaf still sits in its painted
        // aperture, which is what the doorway reads as from the platform.
        for (const jamb of [-1, 1]) {
          const seal=slab(g,mats.rubber,dx+(jamb*s.doorWidth)/2,face-side*.016,doorZMid,.06,.03,doorH)
          omitModelDetail(seal);curveCarDoor(seal,s.width,side)
        }
        for (const leaf of [-1, 1]) {
          const lw = s.doorWidth / 2
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
          m.position.set(dx + (leaf * s.doorWidth) / 4, face - side * 0.025, doorZMid)
          g.add(m)
          // Inset 5 mm from the aperture edges; the pane has no opaque backing.
          const pane = slab(m, mats.glass, 0, 0, 0.28, lw - 0.19, 0.02, 0.85)
          pane.name = 'train-door-window'
          m.name = 'passenger-curved-door'
          const sealShape = new THREE.Shape()
          sealShape.moveTo(-lw/2,-doorH/2); sealShape.lineTo(lw/2,-doorH/2)
          sealShape.lineTo(lw/2,doorH/2); sealShape.lineTo(-lw/2,doorH/2); sealShape.closePath()
          const sealHole = new THREE.Path()
          sealHole.moveTo(-lw/2+.025,-doorH/2+.025); sealHole.lineTo(-lw/2+.025,doorH/2-.025)
          sealHole.lineTo(lw/2-.025,doorH/2-.025); sealHole.lineTo(lw/2-.025,-doorH/2+.025); sealHole.closePath()
          sealShape.holes.push(sealHole)
          const sealGeometry = new THREE.ExtrudeGeometry(sealShape,{depth:.008,bevelEnabled:false})
          sealGeometry.rotateX(Math.PI/2)
          const leafSeal = new THREE.Mesh(sealGeometry,mats.rubber)
          leafSeal.position.y = side * .031 + .004
          leafSeal.name = 'train-door-perimeter-seal'
          m.add(leafSeal)
          curveCarDoor(m,s.width,side)
          registerDoorLeaf(m, leaf, s.doorWidth / 2, doors, side)
          m.userData.closedY = m.position.y
          m.userData.plugTravel = 0.06
        }
      }
    }
    for (const centre of bogieCentres) buildTrainBogie(g, mats, centre, axleHalfSpan)
    buildTrainUnderframe(g, mats, bogieCentres, s.width)
    buildTrainRoofAc(g, mats, shellStart, shellEnd, pose.stock === 'D' ? 3.25 : 3.15, pantographX)
  }

  // The black bellows in every gap between two cars, one mesh for the whole consist.
  buildConsistGangways(g, mats, joints, s.width)

  // A cab at each end (車头), identical but for the lamps: the leading one burns
  // white, the trailing one red — the only difference the reference photos show
  // between the two ends of a consist.
  const lead = (total / 2) * (pose.dirSign >= 0 ? 1 : -1)
  const leadOut = pose.dirSign >= 0 ? 1 : -1
  if (s.cabLength) {
    buildStreamlinedCab(g, mats, s, lead, leadOut, true, blue)
    buildStreamlinedCab(g, mats, s, -lead, -leadOut, false, blue)
  } else {
    buildCab(g, mats, s, lead, leadOut, true, blue)
    buildCab(g, mats, s, -lead, -leadOut, false, blue)
  }
  // The train keeps its own pose; the caller moves the group.
  g.scale.setScalar(pose.modelScale ?? 1)
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
  const plusMotion = trainDoorMotion(plus)
  const minusMotion = minus === plus ? plusMotion : trainDoorMotion(minus)
  for (const d of doors) {
    const side = (d.userData.side as number | undefined) ?? 1
    const t = side >= 0 ? plus : minus
    const closed = (d.userData.closedX as number) ?? d.position.x
    const sign = (d.userData.openSign as number) ?? 1
    const travel = (d.userData.travel as number) ?? 0.32
    if (d.userData.plugTravel) {
      const pose = side >= 0 ? plusMotion : minusMotion
      d.position.x = closed + sign * travel * pose.slide
      d.position.y = d.userData.closedY + side * d.userData.plugTravel * pose.plug
    } else d.position.x = closed + sign * travel * t
  }
  syncTrainDoorBatches(root)
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

