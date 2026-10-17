import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { omitModelDetail } from '../../modelDetail.ts'
import { CONTACT_STRIP_Z } from '../../../sim/constants.ts'

/** Above the cabin ceiling; a roof well leaves room for the raised linkage. */
export const PANTOGRAPH_MOUNT_Z = 2.85
export const PANTOGRAPH_WELL_HALF_LENGTH = 1.12

/** Single-arm collector raised from its roof well to the tunnel wire (§1.12). */
export function buildTrainPantograph(parent: THREE.Group, mats: ModelMaterials, x: number, inward: number, roof: number): void {
  const g = new THREE.Group()
  g.name = 'train-pantograph'
  g.position.x = x
  g.rotation.z = inward < 0 ? Math.PI : 0
  parent.add(g)
  const contact = CONTACT_STRIP_Z - 0.5
  const rise = contact - roof
  const thickness = 0.012
  const z = (t: number) => roof + rise * t
  const beam = (a: number[], b: number[], width: number, mat: THREE.Material, name: string) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, to.distanceTo(from), thickness), mat)
    mesh.position.copy(from).add(to).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
    mesh.name = name
    g.add(mesh)
    return mesh
  }
  for (const side of [-1, 1]) {
    const y = side * 0.32
    slab(g, mats.trainDark, 0, y, z(0.10), 1.8, 0.08, thickness).name = 'pantograph-base'
    for (const dx of [-0.65, 0.65]) {
      omitModelDetail(slab(g, mats.white, dx, y, z(0.05), 0.12, 0.12, rise * 0.1))
    }
    beam([0.6, y, z(0.2)], [-0.85, y, z(0.53)], 0.065, mats.darkSteel, 'pantograph-lower-arm')
    beam([-0.85, y, z(0.53)], [0.5, side * 0.36, contact - 0.012], 0.045, mats.steel, 'pantograph-upper-arm')
    omitModelDetail(beam([0.8, y, z(0.2)], [-0.72, y, z(0.51)], 0.018, mats.steel, 'pantograph-tie-rod'))
    beam([0.5, side * 0.36, contact - 0.012], [0.5, side * 0.68, contact - 0.012], 0.035, mats.steel, 'pantograph-head-support')
    beam([0.5, side * 0.68, contact - 0.012], [0.5, side * 0.86, contact - 0.03], 0.035, mats.steel, 'pantograph-horn')
  }
  for (const dx of [0.39, 0.61]) {
    slab(g, mats.trainDark, dx, 0, contact - thickness / 2, 0.065, 1.36, thickness).name = 'pantograph-contact-strip'
  }
}
