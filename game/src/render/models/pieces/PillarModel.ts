import * as THREE from 'three'
import { setModelDetail } from '../../modelDetail.ts'
import { DEFAULT_MATERIAL } from '../../../sim/finishes.ts'
import { PieceBuilder, finishSlab, slab } from '../PieceBuilder.ts'
import { pillarWidth, pillarOffset, pillarSupportsBridge, BRIDGE_DECK_DEPTH } from '../../../sim/structures.ts'
import type { PillarModule } from '../../../sim/structures.ts'
export class PillarModel extends PieceBuilder {
  readonly kind = 'pillar'
  build(mod: PillarModule): THREE.Group {
    const g = new THREE.Group()
    const w = pillarWidth(mod)
    const offset = pillarOffset(mod)
    const bridge = this.ctx.data.modules.find((m) => pillarSupportsBridge(mod, m))
    const h = bridge ? bridge.z - BRIDGE_DECK_DEPTH - mod.z - 1 : mod.cfg.height - (mod.cfg.bridgeId ? BRIDGE_DECK_DEPTH + 1 : 0)
    const mat = mod.cfg.finish ? this.ctx.finish(mod.cfg.finish) : mod.cfg.size === 'thick' ? this.ctx.finish(DEFAULT_MATERIAL) : this.ctx.mats.darkSteel
    if (mod.cfg.size === 'thick') {
      const cylinder = (material: THREE.Material, radius: number, height: number, z: number, finish = false): void => {
        const makeGeometry = (segments: number): THREE.CylinderGeometry => {
          const geometry = new THREE.CylinderGeometry(radius, radius, height, segments)
          if (finish) {
            // Match the painted box's one texture repeat per metre around the shaft.
            const uv = geometry.attributes.uv as THREE.BufferAttribute
            const scaled = new Set<number>()
            for (const group of geometry.groups) {
              const uScale = group.materialIndex === 0 ? 2 * Math.PI * radius : 2 * radius
              const vScale = group.materialIndex === 0 ? height : 2 * radius
              for (let i = group.start; i < group.start + group.count; i++) {
                // Cylinder vertices are shared by adjacent triangles; scale each once.
                const vertex = geometry.index!.getX(i)
                if (scaled.has(vertex)) continue
                scaled.add(vertex)
                uv.setXY(vertex, uv.getX(vertex) * uScale, uv.getY(vertex) * vScale)
              }
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3))
          }
          geometry.rotateX(Math.PI / 2)
          return geometry
        }
        const geometry = makeGeometry(48)
        const mesh = new THREE.Mesh(geometry, material)
        setModelDetail(mesh, makeGeometry(8))
        mesh.position.set(offset.x, offset.y, z)
        g.add(mesh)
      }
      // Recess the round shaft beneath its round steel collars to avoid coincident faces.
      if (h > 0.2) cylinder(mat, w / 2 - 0.01, h - 0.2, h / 2, true)
      for (let z = 0; z <= h; z += 4) cylinder(this.ctx.mats.steel, w / 2, 0.1, Math.max(0.05, Math.min(h - 0.05, z)))
      if (bridge || h % 4 !== 0) cylinder(this.ctx.mats.steel, w / 2, 0.1, h - 0.05)
      return this.placeLocal(g, mod)
    }
    // Keep the slim shaft inside its steel collars. Coincident outer faces and
    // end caps otherwise z-fight, most visibly at the top and every 4 m joint.
    const shaftInset = mod.cfg.size === 'slim' ? 0.04 : 0
    const shaftStart = mod.cfg.size === 'slim' ? 0.1 : 0
    const shaftEnd = mod.cfg.size === 'slim' ? Math.max(shaftStart, h - 0.1) : h
    const shaftH = shaftEnd - shaftStart
    const shaftW = w - shaftInset * 2
    if (shaftH > 0) {
      if (mod.cfg.finish) finishSlab(g, mat, offset.x, offset.y, (shaftStart + shaftEnd) / 2, shaftW, shaftW, shaftH)
      else slab(g, mat, offset.x, offset.y, (shaftStart + shaftEnd) / 2, shaftW, shaftW, shaftH)
    }
    // Steel collars make each five-metre extension legible without enlarging its footprint.
    for (let z = 0; z <= h; z += 4) slab(g, this.ctx.mats.steel, offset.x, offset.y, Math.max(0.05, Math.min(h - 0.05, z)), w, w, 0.1)
    if (bridge || h % 4 !== 0) slab(g, this.ctx.mats.steel, offset.x, offset.y, h - 0.05, w, w, 0.1)
    // Slim pillar `rot` selects one of nine in-cell positions; the offset above
    // already expresses that position, so applying it again as a model turn
    // would collapse several edge and corner choices onto the same locations.
    return this.placeLocal(g, mod.cfg.size === 'slim' ? { ...mod, rot: 0 } : mod)
  }
}
