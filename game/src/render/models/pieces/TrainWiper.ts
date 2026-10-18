import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { setModelDetail } from '../../modelDetail.ts'

/** Parked articulated wiper fitted to the actual windshield surface. */
export function buildTrainWiper(parent: THREE.Group, mats: ModelMaterials,
  surface: (y: number, z: number, lift: number) => THREE.Vector3,
  pivotY: number, pivotZ: number, bladeY: number, bladeZ: number, tipY: number, tipZ: number): void {
  const tube = (name: string, points: THREE.Vector3[], radius: number) => {
    const curve = new THREE.CatmullRomCurve3(points)
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 6, false), mats.rubber)
    mesh.name = name
    setModelDetail(mesh, new THREE.TubeGeometry(curve, 4, radius, 4, false))
    parent.add(mesh)
  }
  const pivot = surface(pivotY, pivotZ, 0.012)
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mats.darkSteel)
  hub.name = 'cab-wiper-pivot'; hub.position.copy(pivot)
  setModelDetail(hub, new THREE.SphereGeometry(0.035, 6, 4)); parent.add(hub)
  tube('cab-wiper-arm', [pivot, surface((pivotY + bladeY) / 2 - 0.025, (pivotZ + bladeZ) / 2, 0.022), surface(bladeY, bladeZ, 0.015)], 0.012)
  const points = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8
    return surface(THREE.MathUtils.lerp(bladeY - (tipY - bladeY) * 0.35, tipY, t),
      THREE.MathUtils.lerp(bladeZ - (tipZ - bladeZ) * 0.35, tipZ, t), 0.006)
  })
  tube('cab-wiper-blade', points, 0.019)
}
