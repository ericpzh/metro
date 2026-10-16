import * as THREE from 'three'
import asset from '../../../assets/trees/street-ash.json' with { type: 'json' }
import type { Module } from '../../../sim/types.ts'
import { PieceBuilder, placeLocal } from '../PieceBuilder.ts'

type MeshData = { position: number[]; normal: number[]; uv: number[]; index: number[] }
function geometry(data: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2))
  g.setIndex(data.index); g.computeBoundingBox(); g.computeBoundingSphere()
  return g
}
let branches: THREE.BufferGeometry | undefined, leaves: THREE.BufferGeometry | undefined
/** §5.8: offline EZ-Tree ash; two shared meshes, no generation or image decoding per placement. */
export class TreeModel extends PieceBuilder {
  readonly kind = 'tree'
  build(mod: Extract<Module, { type: 'tree' }>): THREE.Group {
    branches ??= geometry(asset.branches); leaves ??= geometry(asset.leaves)
    const group = new THREE.Group()
    const bark = this.ctx.mats.treeBark ?? this.ownedMaterial(new THREE.MeshStandardMaterial({ color: 0x726454, roughness: 1 }))
    const foliage = this.ctx.mats.treeLeaves ?? this.ownedMaterial(new THREE.MeshStandardMaterial({ color: 0x6c9449, side: THREE.DoubleSide, roughness: 1 }))
    const trunk = new THREE.Mesh(branches, bark), crown = new THREE.Mesh(leaves, foliage)
    trunk.name = 'tree-trunk'; crown.name = 'tree-crown'
    trunk.userData.sharedGeometry = crown.userData.sharedGeometry = true
    group.add(trunk, crown)
    return placeLocal(group, mod)
  }
}
