// Coloured repeated merchandise shares the scene-owned goods material.
import * as THREE from 'three'
import { omitModelDetail } from '../../modelDetail.ts'

export type StockPart = { x: number; y: number; z: number; w: number; d: number; h: number; color: number; turn?: number }
export function stockBatch(g: THREE.Group, material: THREE.Material, name: string, parts: StockPart[], geometry: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1)): void {
  if (!parts.length) { geometry.dispose(); return }
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length)
  mesh.name = name
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1)
  const p = new THREE.Vector3(), scale = new THREE.Vector3(), color = new THREE.Color()
  parts.forEach((part, i) => {
    matrix.compose(p.set(part.x, part.y, part.z), q.setFromAxisAngle(axis, part.turn ?? 0), scale.set(part.w, part.d, part.h))
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, color.setHex(part.color))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor!.needsUpdate = true
  mesh.computeBoundingSphere()
  omitModelDetail(mesh)
  g.add(mesh)
}
export const stockSphere = () => new THREE.SphereGeometry(0.5, 10, 6)
export const stockCylinder = () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateX(Math.PI / 2)
export const stockBanana = () => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(-.5, 0, .15), new THREE.Vector3(0, .2, -.25), new THREE.Vector3(.5, 0, .15),
), 8, .12, 5, false)

/** A shirt has shoulders, sleeves and a neck opening, rather than a stock box. */
export function shirtGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const points = [[-.18, 0], [.18, 0], [.18, .36], [.3, .32], [.36, .49], [.12, .6], [.07, .55], [-.07, .55], [-.12, .6], [-.36, .49], [-.3, .32], [-.18, .36]]
  points.forEach(([x, y], i) => i ? shape.lineTo(x!, y!) : shape.moveTo(x!, y!))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth: .02, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, .01, 0)
}
