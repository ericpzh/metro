import * as THREE from 'three'
import { TRAIN_ORIGIN_Z } from '../../../sim/stock.ts'
import { RAIL_HEAD_Z, RAIL_CENTRE_OFFSET } from '../../../sim/constants.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { buildTrainSuspension } from './TrainSuspension.ts'

/** Wheel contact derives from the lowered track and platform-aligned cabin. */
export const BOGIE_RAIL_Z = RAIL_HEAD_Z - TRAIN_ORIGIN_Z
const AUTHORED_RAIL_Z = 0.15
export const BOGIE_WHEEL_RADIUS = 0.40
export const BOGIE_FLANGE_RADIUS = .178 * (BOGIE_WHEEL_RADIUS / .165)
export const BOGIE_AXLE_Z = BOGIE_RAIL_Z + BOGIE_WHEEL_RADIUS
export const BOGIE_WHEEL_Y = RAIL_CENTRE_OFFSET
export const BOGIE_AXLE_HALF_SPAN = 0.72
const BASE_AXLE_Z = AUTHORED_RAIL_Z + .165

/** Bogies sit in the first and last inter-door window bays of each car. */
export function carBogieCentres(doors: readonly number[]): number[] {
  return [(doors[0]+doors[1])/2,(doors.at(-2)!+doors.at(-1)!)/2]
}

/** Shared full-size two-axle bogie for A/B/C/D/L (§1.12–1.13).
 * Full-size wheelsets rise into housings beneath the window seats. Central
 * axles, motor and crossmembers clear the thin, unchanged-height aisle floor.
 * Meshes remain siblings of the car so production batching can merge the
 * entire consist's static steel, rather than adding draws per bogie. */
export function buildTrainBogie(parent: THREE.Group, mats: ModelMaterials, centre: number, axleHalfSpan = BOGIE_AXLE_HALF_SPAN): void {
  const firstPart = parent.children.length
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const part = new THREE.Mesh(geometry, material)
    part.name = `bogie-${name}`
    parent.add(part)
    return part
  }
  const bar = (name: string, material: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number) => {
    const part = slab(parent, material, centre + x, y, z, w, d, h)
    part.name = `bogie-${name}`
    return part
  }
  const cylinder = (name: string, material: THREE.Material, x: number, y: number, z: number, radius: number, length: number, vertical = false, detail = true) => {
    const part = mesh(new THREE.CylinderGeometry(radius, radius, length, 16), material, name)
    part.position.set(centre + x, y, z)
    if (vertical) part.rotation.x = Math.PI / 2
    if (detail) setModelDetail(part, new THREE.CylinderGeometry(radius, radius, length, 6))
    else omitModelDetail(part)
    return part
  }
  const rod = (name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, material = mats.steel, detail = true) => {
    const part = mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 10), material, name)
    if (detail) setModelDetail(part, new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 4))
    else omitModelDetail(part)
    part.position.copy(a).add(b).multiplyScalar(.5)
    part.position.x += centre
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    return part
  }
  const lathe = (name: string, material: THREE.Material, profile: number[][], segments: number, low: number, x: number, y: number, z: number) => {
    const points = profile.map(([radius, axis]) => new THREE.Vector2(radius, axis))
    const part = mesh(new THREE.LatheGeometry(points, segments), material, name)
    setModelDetail(part, new THREE.LatheGeometry(points, low))
    part.position.set(centre + x, y, z)
    return part
  }

  // Sculpted side frames rise over the primary suspension, with a lower waist
  // and a transverse bolster between them; no solid slab hides the wheelsets.
  const outline = new THREE.Shape()
  outline.moveTo(-.97, .40); outline.lineTo(-.97, .49); outline.lineTo(-.65, .49)
  outline.quadraticCurveTo(-.51, .49, -.34, .43); outline.lineTo(.34, .43)
  outline.quadraticCurveTo(.51, .49, .65, .49); outline.lineTo(.97, .49)
  outline.lineTo(.97, .40); outline.lineTo(.65, .40); outline.lineTo(.34, .35)
  outline.lineTo(-.34, .35); outline.lineTo(-.65, .40); outline.closePath()
  for (const side of [-1, 1]) {
    const frame = new THREE.ExtrudeGeometry(outline, { depth: .10, bevelEnabled: false, curveSegments: 6 })
    // Shape XY is the bogie's XZ elevation; extruded Z becomes its Y thickness.
    frame.applyMatrix4(new THREE.Matrix4().set(1,0,0,0, 0,0,-1,side*.98+.05, 0,1,0,0, 0,0,0,1))
    const part = mesh(frame, mats.darkSteel, 'side-frame')
    part.position.x = centre
    setModelDetail(part, new THREE.BoxGeometry(1.94, .10, .10).translate(0, side*.98, .44))
    const air = lathe('air-spring', mats.rubber, [[0,.425],[.10,.425],[.145,.435],[.16,.45],[.15,.475],[.10,.483],[0,.483]], 20, 6, 0, side*.64, 0)
    air.rotation.x = Math.PI / 2
    cylinder('air-spring-top-plate', mats.steel, 0, side*.64, .49, .125, .012, true)
    rod('brake-pipe', new THREE.Vector3(-.78,side*1.045,.35), new THREE.Vector3(.78,side*1.045,.35), .007, mats.trainDark, false)
  }
  bar('bolster', mats.darkSteel, 0, 0, .405, .28, 1.90, .10)
  for (const sign of [-1, 1]) bar('frame-crossmember', mats.darkSteel, sign*.56, 0, .40, .13, 1.96, .06)
  cylinder('traction-motor', mats.trainDark, .12, 0, .31, .073, .64)
  bar('gear-case', mats.darkSteel, -.62, -.27, .32, .23, .24, .17)
  rod('motor-coupling', new THREE.Vector3(-.52,-.27,.315), new THREE.Vector3(.07,-.27,.315), .022)

  for (const end of [-1, 1]) {
    const ax = end * BOGIE_AXLE_HALF_SPAN
    cylinder('axle', mats.steel, ax, 0, BASE_AXLE_Z, .034, 2.08)
    for (const side of [-1, 1]) {
      // Separate adjoining web and tyre profiles share their boundary rings;
      // the polished tread is geometry, not a coplanar decorative overlay.
      const web = lathe('wheel-web', mats.darkSteel,
        [[0,-.055],[.06,-.055],[.075,-.045],[.135,-.045],[.13,.045],[.075,.045],[.06,.09],[0,.09]],
        24, 8, ax, side*BOGIE_WHEEL_Y, BASE_AXLE_Z)
      const rim = lathe('wheel-tyre', mats.steel,
        [[.135,-.045],[.15,-.058],[ .178,-.058],[ .178,-.042],
          [ .165,-.03],[ .165,.07],[.155,.075],[.14,.075],[.13,.045]],
        24, 8, ax, side*BOGIE_WHEEL_Y, BASE_AXLE_Z)
      // A proper rotation mirrors the flange to the gauge side without reversing winding.
      if (side < 0) { web.rotation.x = Math.PI; rim.rotation.x = Math.PI }
      for (let i=0; i<6; i++) {
        const angle = i * Math.PI / 3
        cylinder('wheel-face-bolt', mats.steel, ax + Math.sin(angle)*.105,
          side*(BOGIE_WHEEL_Y+.05), BASE_AXLE_Z + Math.cos(angle)*.105, .009, .012, false, false)
      }
      cylinder('brake-disc', mats.steel, ax, side*.59, BASE_AXLE_Z, .115, .018)
      bar('brake-caliper', mats.trainDark, ax+end*.10, side*.59, .335, .075, .065, .105)
      bar('axle-box', mats.darkSteel, ax, side*.98, BASE_AXLE_Z, .16, .16, .14)
      cylinder('bearing-cap', mats.steel, ax, side*1.075, BASE_AXLE_Z, .06, .035)
      cylinder('bearing-centre', mats.trainDark, ax, side*1.097, BASE_AXLE_Z, .025, .014, false, false)
      rod('trailing-arm', new THREE.Vector3(ax,side*.98,BASE_AXLE_Z), new THREE.Vector3(end*.31,side*.98,.375), .023, mats.darkSteel)
      cylinder('trailing-arm-pivot', mats.steel, end*.31, side*1.04, .375, .035, .025, false, false)
      const points: THREE.Vector3[] = []
      for (let i=0;i<=40;i++) {
        const t=i/40, angle=t*Math.PI*7
        points.push(new THREE.Vector3(centre+ax+Math.cos(angle)*.042,side*1.08+Math.sin(angle)*.042,.382+t*.052))
      }
      const spring = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, .006, 5, false), mats.steel, 'primary-coil-spring')
      omitModelDetail(spring)
      cylinder('spring-seat', mats.darkSteel, ax, side*1.08, .382, .058, .012, true)
      bar('spring-seat-bracket', mats.darkSteel, ax, side*1.015, .382, .14, .14, .012)
      bar('spring-frame-bracket', mats.darkSteel, ax, side*1.045, .44, .14, .15, .018)
      rod('damper-rod', new THREE.Vector3(ax+end*.13,side*1.065,.32), new THREE.Vector3(ax+end*.10,side*1.065,.465), .009, mats.steel, false)
      rod('damper-body', new THREE.Vector3(ax+end*.13,side*1.065,.32), new THREE.Vector3(ax+end*.115,side*1.065,.395), .018, mats.darkSteel, false)
    }
  }
  const scale = BOGIE_WHEEL_RADIUS / .165
  const central = new Set(['bolster','frame-crossmember','traction-motor','gear-case','motor-coupling'])
  const structural = new Set(['side-frame','trailing-arm','brake-pipe','frame-crossmember','bolster'])
  for (const part of parent.children.slice(firstPart) as THREE.Mesh[]) {
    const name = part.name.slice(6)
    part.updateMatrix()
    const inverse = part.matrix.clone().invert()
    const pivotX = name==='wheel-face-bolt'||name==='brake-caliper' ? Math.sign(part.position.x-centre)*BOGIE_AXLE_HALF_SPAN : name==='primary-coil-spring' ? Math.sign((part.geometry.boundingBox?.getCenter(new THREE.Vector3()).x ?? centre)-centre)*BOGIE_AXLE_HALF_SPAN : part.position.x-centre
    for (const geometry of [part.geometry,part.userData.lowDetailGeometry as THREE.BufferGeometry | undefined]) {
      if (!geometry) continue
      const p = geometry.attributes.position, n = geometry.attributes.normal
      const point = new THREE.Vector3(), normal = new THREE.Vector3()
      const zScale = central.has(name)||name==='axle' ? 1 : scale
      const xScale = structural.has(name)||central.has(name)||name==='axle' ? 1 : scale
      for (let i=0;i<p.count;i++) {
        point.fromBufferAttribute(p,i).applyMatrix4(part.matrix)
        const x = point.x-centre
        point.x = centre+pivotX+(x-pivotX)*xScale
        point.z = central.has(name) ? point.z+.10 : name==='axle' ? point.z+(AUTHORED_RAIL_Z + BOGIE_WHEEL_RADIUS-BASE_AXLE_Z) : AUTHORED_RAIL_Z+(point.z-AUTHORED_RAIL_Z)*scale
        point.applyMatrix4(inverse);p.setXYZ(i,point.x,point.y,point.z)
        if(n){normal.fromBufferAttribute(n,i).transformDirection(part.matrix);normal.x/=xScale;normal.z/=zScale;normal.transformDirection(inverse);n.setXYZ(i,normal.x,normal.y,normal.z)}
      }
      p.needsUpdate=true;if(n)n.needsUpdate=true
      geometry.computeBoundingBox();geometry.computeBoundingSphere()
    }
    // Retain useful axle/world centres for animation, picking and inspection.
    if(name==='axle'||name==='wheel-tyre'||name==='wheel-web') {
      const dz=AUTHORED_RAIL_Z + BOGIE_WHEEL_RADIUS-part.position.z
      part.position.z+=dz
      const localShift = new THREE.Vector3(0,0,-dz).applyQuaternion(part.quaternion.clone().invert())
      for(const geometry of [part.geometry,part.userData.lowDetailGeometry as THREE.BufferGeometry|undefined])geometry?.translate(localShift.x,localShift.y,localShift.z)
    }
  }

  if (axleHalfSpan !== BOGIE_AXLE_HALF_SPAN) for(const part of parent.children.slice(firstPart) as THREE.Mesh[]) {
    const name=part.name.slice(6)
    if(central.has(name)||name==='air-spring'||name==='air-spring-top-plate')continue
    part.updateMatrix();const inverse=part.matrix.clone().invert()
    const shape=name==='side-frame'||name==='trailing-arm'||name==='brake-pipe'
    const side=Math.sign(part.position.x-centre)
    for(const geometry of [part.geometry,part.userData.lowDetailGeometry as THREE.BufferGeometry|undefined]){
      if(!geometry)continue
      const p=geometry.attributes.position,point=new THREE.Vector3()
      for(let i=0;i<p.count;i++){
        point.fromBufferAttribute(p,i).applyMatrix4(part.matrix)
        const sign=name==='primary-coil-spring'?Math.sign(point.x-centre):side
        point.x=shape?centre+(point.x-centre)*axleHalfSpan/BOGIE_AXLE_HALF_SPAN:point.x+sign*(axleHalfSpan-BOGIE_AXLE_HALF_SPAN)
        point.applyMatrix4(inverse);p.setXYZ(i,point.x,point.y,point.z)
      }
      p.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere()
    }
    if(name==='axle'||name==='wheel-tyre'||name==='wheel-web'){
      const dx=side*(axleHalfSpan-BOGIE_AXLE_HALF_SPAN)
      part.position.x+=dx
      for(const geometry of [part.geometry,part.userData.lowDetailGeometry as THREE.BufferGeometry|undefined])geometry?.translate(-dx,0,0)
    }
  }

  for(const side of [-1,1])rod('bolster-outrigger',new THREE.Vector3(0,side*.45,.52),new THREE.Vector3(0,side*.98,.74),.045,mats.darkSteel)

  for (const part of parent.children.slice(firstPart)) part.position.z += BOGIE_RAIL_Z - AUTHORED_RAIL_Z

  buildTrainSuspension(parent, mats, centre, BOGIE_AXLE_Z, axleHalfSpan)

}
