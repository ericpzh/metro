import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { beamModelDetail } from '../../modelDetail.ts'

/** Shared bridge and ground-decor railing profile (§5.4). */
export function buildBridgeRailing(g: THREE.Group, mats: ModelMaterials, width: number, y: number, catenary = false): void {
  beamModelDetail(slab(g, mats.steel, (width - 1) / 2, y, 1.25, width, 0.08, 0.08), 'x')
  for (let x = 0; x < width; x += 2) {
    if (catenary && x % 8 === 0) continue
    const post = slab(g, mats.steel, x, y, 0.9, 0.08, 0.08, 0.7)
    post.name = 'bridge-railing-post'; beamModelDetail(post, 'z')
  }
}
