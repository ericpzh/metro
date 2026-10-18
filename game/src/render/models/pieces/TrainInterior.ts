import { carShellAt } from './CarShellProfile.ts'
import { dHalfWidth } from './DTrainShell.ts'
import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { boxModelDetail, omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { CABIN_FLOOR_Z, CABIN_HALF_W, DOOR_HEAD_Z } from '../../../sim/stock.ts'

/**
 * A handrail or hanging strap is a tube on a short path: full detail samples it 16
 * times round a six-sided section, Low six times round four sides. The path's own
 * ends (a rail's run, a strap's loop) are the tube's, not new geometry, so the shape
 * a passenger holds stays where it was.
 */
function tubeDetail(mesh: THREE.Mesh): void {
  const surface = mesh.geometry as THREE.TubeGeometry
  const p = surface.parameters
  setModelDetail(mesh, new THREE.TubeGeometry(p.path, Math.min(p.closed ? 6 : 4, p.tubularSegments), p.radius, 4, p.closed))
}

/** Benches, seat-end guards, handrails and lighting from the metro cabin references (§1.13). */
export function buildTrainInterior(g: THREE.Group, mats: ModelMaterials, start: number, end: number, bays: Array<[number, number]>, doors: number[], floor: THREE.Material, express = false, overheadSpan: [number, number] = [start, end], shellWidth?: number, wheelBays: readonly number[] = [], wheelBayHalfLength = 1.2): void {
  const tube = (points: THREE.Vector3[], radius: number, mat: THREE.Material, name: string, closed = false): void => {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal')
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 6, closed), mat)
    mesh.name = name
    tubeDetail(mesh)
    g.add(mesh)
  }
  const mid = (start + end) / 2
  const halfWidth = express ? dHalfWidth(CABIN_FLOOR_Z - 0.12) - 0.04 : CABIN_HALF_W
  const floorShape = new THREE.Shape()
  const left = start-mid, right = end-mid, clear = .475
  const wheelCuts = wheelBays.map(x=>[x-mid-wheelBayHalfLength,x-mid+wheelBayHalfLength]).sort((a,b)=>a[0]-b[0])
  floorShape.moveTo(left,-halfWidth)
  for(const [a,b] of wheelCuts){floorShape.lineTo(a,-halfWidth);floorShape.lineTo(a,-clear);floorShape.lineTo(b,-clear);floorShape.lineTo(b,-halfWidth)}
  floorShape.lineTo(right,-halfWidth);floorShape.lineTo(right,halfWidth)
  for(const [a,b] of [...wheelCuts].reverse()){floorShape.lineTo(b,halfWidth);floorShape.lineTo(b,clear);floorShape.lineTo(a,clear);floorShape.lineTo(a,halfWidth)}
  floorShape.lineTo(left,halfWidth);floorShape.closePath()
  const floorGeometry = new THREE.ExtrudeGeometry(floorShape,{depth:.02,bevelEnabled:false})
  floorGeometry.translate(0,0,.04)
  const floorMesh = new THREE.Mesh(floorGeometry,floor)
  floorMesh.position.set(mid,0,CABIN_FLOOR_Z-.06);floorMesh.name='cabin-floor';g.add(floorMesh)
  if(!express&&shellWidth!==undefined){
    const p=floorGeometry.attributes.position
    for(let i=0;i<p.count;i++){
      const limit=carShellAt(shellWidth,p.getZ(i)+floorMesh.position.z).y-.005
      p.setY(i,Math.sign(p.getY(i))*Math.min(Math.abs(p.getY(i)),limit))
    }
    floorGeometry.computeVertexNormals()
  }
  // Sealed wheel housings replace the side floor only beneath window benches.
  // The 0.95 m aisle and every passenger threshold retain their original height.
  for(const centre of wheelBays)for(const side of [-1,1]){
    const outer=halfWidth-.01, y=side*(clear+outer)/2, depth=outer-clear
    slab(g,mats.trainInterior,centre,y,1.01,wheelBayHalfLength*2,depth,.02).name='cabin-wheel-housing-top'
    slab(g,mats.trainInterior,centre,side*clear,.81,wheelBayHalfLength*2,.025,.4).name='cabin-wheel-housing-wall'
    for(const end of [-1,1])slab(g,mats.trainInterior,centre+end*wheelBayHalfLength,y,.81,.025,depth,.4).name='cabin-wheel-housing-end'
  }
  for (const side of [-1, 1]) {
    const y = side * (halfWidth - 0.25)
    for (const [bay, [a, b]] of bays.entries()) {
      if (b - a < 1.2) continue
      // D stock mixes 2+2 transverse bays with longitudinal metro benches.
      if (express && bay % 2 === 0) {
        for (let x = a + 0.55; x < b - 0.35; x += 1.0) {
          for (const seatY of [0.63, 1.10]) {
            slab(g, mats.steel, x, side * seatY, CABIN_FLOOR_Z + 0.44, 0.48, 0.43, 0.07).name = 'd-transverse-seat'
            slab(g, mats.steel, x - 0.23, side * seatY, CABIN_FLOOR_Z + 0.76, 0.07, 0.43, 0.62).name = 'd-seat-back'
            slab(g, mats.gateRed, x, side * seatY, CABIN_FLOOR_Z + 0.2, 0.12, 0.12, 0.4)
          }
        }
        continue
      }
      const len = b - a - 0.14
      // Thin formed seat pan curves up into a backrest, rather than a solid box.
      const section = new THREE.Shape()
      section.moveTo(-0.27, 0.42)
      section.lineTo(0.19, 0.42)
      section.quadraticCurveTo(0.25, 0.42, 0.27, 0.53)
      section.lineTo(0.3, 0.94)
      section.lineTo(0.26, 0.94)
      section.lineTo(0.23, 0.54)
      section.quadraticCurveTo(0.21, 0.47, 0.17, 0.47)
      section.lineTo(-0.27, 0.47)
      section.closePath()
      const geometry = new THREE.ExtrudeGeometry(section, { depth: len, bevelEnabled: false, curveSegments: 8 })
      geometry.rotateY(Math.PI / 2)
      geometry.rotateX(Math.PI / 2)
      const seat = new THREE.Mesh(geometry, mats.steel)
      seat.name = 'cabin-bench'
      // Mirror across the aisle without flipping the seat's height.
      seat.scale.y = side
      seat.position.set(a + 0.07, y, CABIN_FLOOR_Z)
      // The formed pan becomes one envelope at Low: a bench is read by the row it
      // makes down the car, not by the roll of its pan edge.
      boxModelDetail(seat)
      g.add(seat)
      slab(g, mats.trainInterior, (a + b) / 2, y, CABIN_FLOOR_Z + 0.23, len - 0.18, 0.3, 0.35)
      for (const x of [a + 0.07, b - 0.07]) {
        const guardProfile = new THREE.Shape()
        guardProfile.moveTo(-0.29, 0.08)
        guardProfile.lineTo(-0.29, 0.43)
        guardProfile.quadraticCurveTo(-0.25, 0.68, -0.1, 0.79)
        guardProfile.lineTo(0.28, 1.03)
        guardProfile.lineTo(0.28, 0.08)
        guardProfile.closePath()
        const guardGeometry = new THREE.ExtrudeGeometry(guardProfile, { depth: 0.06, bevelEnabled: false, curveSegments: 12 })
        guardGeometry.rotateY(Math.PI / 2)
        guardGeometry.rotateX(Math.PI / 2)
        const guard = new THREE.Mesh(guardGeometry, mats.trainBody)
        guard.name = 'seat-end-panel'
        guard.scale.y = side
        guard.position.set(x - 0.03, y, CABIN_FLOOR_Z)
        boxModelDetail(guard)
        g.add(guard)
        tube([
          new THREE.Vector3(x, y - side * 0.29, CABIN_FLOOR_Z + 0.12),
          new THREE.Vector3(x, y - side * 0.31, CABIN_FLOOR_Z + 0.58),
          new THREE.Vector3(x, y - side * 0.21, CABIN_FLOOR_Z + 1.1),
          new THREE.Vector3(x, y + side * 0.12, DOOR_HEAD_Z - 0.18),
        ], 0.025, mats.gateRed, 'seat-end-handrail')
      }
    }
    slab(g, mats.glow, (overheadSpan[0] + overheadSpan[1]) / 2, side * 0.76, DOOR_HEAD_Z - 0.015, overheadSpan[1] - overheadSpan[0] - 0.3, 0.09, 0.025).name = 'cabin-light-strip'
    tube([new THREE.Vector3(overheadSpan[0] + 0.15, side * 0.62, 2.36), new THREE.Vector3(overheadSpan[1] - 0.15, side * 0.62, 2.36)], 0.025, mats.steel, 'overhead-handrail')
    for (let x = overheadSpan[0] + 0.7; x < overheadSpan[1] - 0.3; x += 1.15) {
      // The strap's rubber hanger is the one fitting a passenger never reads at
      // Low quality; the loop below it is what the eye follows down the car.
      omitModelDetail(slab(g, mats.rubber, x, side * 0.62, 2.24, 0.035, 0.035, 0.2))
      tube([
        new THREE.Vector3(x, side * 0.62, 2.17),
        new THREE.Vector3(x - 0.1, side * 0.62, 2.02),
        new THREE.Vector3(x + 0.1, side * 0.62, 2.02),
      ], 0.018, mats.gateRed, 'hanging-strap', true)
    }
  }
  for (const x of doors) {
    for (const side of [-1, 1]) {
      const y = side * (halfWidth - 0.025)
      slab(g, mats.white, x, y, DOOR_HEAD_Z - 0.17, 0.95, 0.035, 0.24).name = 'cabin-route-panel'
      slab(g, mats.blue, x, y - side * 0.024, DOOR_HEAD_Z - 0.17, 0.82, 0.008, 0.015)
      for (let stop = -3; stop <= 3; stop++) {
        // Three centimetres of stop ink per station: the board keeps its blue
        // route line and drops the printed stops when the car is far away.
        omitModelDetail(slab(g, mats.white, x + stop * 0.11, y - side * 0.03, DOOR_HEAD_Z - 0.17, 0.022, 0.008, 0.03))
      }
    }
    tube([new THREE.Vector3(x, 0, CABIN_FLOOR_Z), new THREE.Vector3(x, 0, DOOR_HEAD_Z - 0.04)], 0.027, mats.steel, 'cabin-centre-pole')
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 6, 32), mats.glow)
    ring.name = 'cabin-ring-light'
    ring.position.set(x, 0, DOOR_HEAD_Z - 0.025)
    setModelDetail(ring, new THREE.TorusGeometry(0.26, 0.018, 4, 12))
    g.add(ring)
  }
}
