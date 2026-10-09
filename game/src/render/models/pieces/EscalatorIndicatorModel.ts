import * as THREE from 'three'
import type { ModuleContext } from '../PieceBuilder.ts'

/** Fixed newel lights face people approaching each end, beside the step band. */
export function addEscalatorIndicators(ctx: ModuleContext, group: THREE.Group, len: number, railWidth: number): void {
  const arrow = new THREE.Shape()
  arrow.moveTo(-0.011, -0.036)
  arrow.lineTo(0.011, -0.036)
  arrow.lineTo(0.011, 0)
  arrow.lineTo(0.033, 0)
  arrow.lineTo(0, 0.036)
  arrow.lineTo(-0.033, 0)
  arrow.lineTo(-0.011, 0)
  arrow.closePath()
  const arrowGeo = new THREE.ShapeGeometry(arrow)
  const stopGeo = new THREE.PlaneGeometry(0.066, 0.018)
  const bezelGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.009, 24)
  bezelGeo.rotateX(Math.PI / 2) // cylinder axis becomes the display's outward normal
  const inverse = group.quaternion.clone().invert()
  const upright = new THREE.Vector3(0, 0, 1).applyQuaternion(inverse)
  const travel = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion)
  travel.z = 0
  travel.normalize().applyQuaternion(inverse)

  // The model's +x is always the actual travel direction, including down runs.
  for (const entry of [true, false]) {
    const outward = entry ? -1 : 1
    for (const side of [-1, 1]) {
      const light = new THREE.Group()
      light.name = 'escalator-indicator'
      light.userData.indication = entry ? 'entry' : 'stop'
      const normal = travel.clone().multiplyScalar(outward)
      light.position.set(entry ? 0 : len, side * (railWidth / 2 + 0.03), 0.5)
      light.position.addScaledVector(normal, 0.51)
      // Mount on the front of the rounded return, upright in world space.
      // An incline-aligned face at the lower end would point into the floor.
      light.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3().crossVectors(upright, normal),
        upright,
        normal,
      ))
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.19, 0.07), ctx.mats.steel)
      light.add(housing)
      const bezel = new THREE.Mesh(bezelGeo, ctx.mats.handrail)
      bezel.position.z = 0.037
      light.add(bezel)
      const symbol = new THREE.Mesh(entry ? arrowGeo : stopGeo, entry ? ctx.mats.ledGreen : ctx.mats.ledRed)
      symbol.name = entry ? 'entry-arrow' : 'stop-bar'
      symbol.position.z = 0.043 // proud of the bezel, avoiding coplanar flicker
      light.add(symbol)
      group.add(light)
    }
  }
}
