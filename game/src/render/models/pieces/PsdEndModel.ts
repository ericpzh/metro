import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { psdEndOffset, psdEndSpan } from '../../../sim/psdEnds.ts'
import { PieceBuilder } from '../PieceBuilder.ts'
import { buildPsd } from './PsdModel.ts'

/** Fixed glass from the platform-screen model, without door leaves (§5.7). */
export class PsdEndModel extends PieceBuilder {
  readonly kind = 'psd-end'
  build(mod: Extract<Module, { type: 'psd-end' }>): THREE.Group {
    const group = buildPsd(this.ctx, { ...mod, type: 'platform-edge', w: 1,
      cfg: { name: '屏蔽端门', dir: 'up', line: '', side: 'left', psd: mod.cfg.psd } }, psdEndSpan(mod, this.ctx.data.modules, this.ctx.data.lines))
    const [ox, oy] = psdEndOffset(mod)
    for (const child of [...group.children]) {
      child.position.x += ox
      child.position.y += oy
      if (!(child instanceof THREE.Mesh)) continue
      // The glass can sit on a tile edge. Trim the surrounding cap/frame there,
      // rather than letting their thickness protrude into the next block (§5.3).
      child.updateMatrix()
      child.geometry.computeBoundingBox()
      const bounds = child.geometry.boundingBox!.clone().applyMatrix4(child.matrix)
      if (bounds.min.x > 0.5 + 1e-6 || bounds.max.x < -0.5 - 1e-6 ||
        bounds.min.y > 0.5 + 1e-6 || bounds.max.y < -0.5 - 1e-6) {
        group.remove(child)
        child.geometry.dispose()
        continue
      }
      const inverse = child.matrix.clone().invert()
      const position = child.geometry.getAttribute('position')
      const point = new THREE.Vector3()
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(child.matrix)
        point.x = THREE.MathUtils.clamp(point.x, -0.5, 0.5)
        point.y = THREE.MathUtils.clamp(point.y, -0.5, 0.5)
        point.applyMatrix4(inverse)
        position.setXYZ(i, point.x, point.y, point.z)
      }
      position.needsUpdate = true
      child.geometry.computeBoundingBox()
      child.geometry.computeBoundingSphere()
    }
    return group
  }
}
