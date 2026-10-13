import { t } from '../../../sim/i18n.ts'
import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { psdEndOffset, psdEndSpan } from '../../../sim/psdEnds.ts'
import { PieceBuilder } from '../PieceBuilder.ts'
import { buildPsd } from './PsdModel.ts'
import { finishPsdHousing } from './PsdHousing.ts'

/** Fixed glass from the platform-screen model, without door leaves (§5.7). */
export class PsdEndModel extends PieceBuilder {
  readonly kind = 'psd-end'
  build(mod: Extract<Module, { type: 'psd-end' }>): THREE.Group {
    const span = psdEndSpan(mod, this.ctx.data.modules, this.ctx.data.lines)
    const group = buildPsd(this.ctx, { ...mod, type: 'platform-edge', w: 1,
      cfg: { name: t('screen_end_door'), dir: 'up', line: '', side: 'left', psd: mod.cfg.psd } }, span)
    const [ox, oy] = psdEndOffset(mod)
    // Glass meets the screen centreline, but the opaque return must stop at
    // its housing: otherwise perpendicular caps/fascias share top faces (§5.7).
    const corner = this.ctx.data.modules.find((m) => m.id === mod.cfg.corner && m.type === 'platform-edge')
    const housing: THREE.Box3[] = []
    if (corner?.type === 'platform-edge') {
      // Use the same builder's actual end profile, without textures or glass.
      // A single clearance for every height leaves a slit beside the fascia.
      const reference = buildPsd(this.ctx, corner, [-0.5, corner.w - 0.5], true)
      reference.updateMatrixWorld(true)
      group.updateMatrixWorld(true)
      const inverse = group.matrixWorld.clone().invert()
      for (const child of reference.children) {
        if (!(child instanceof THREE.Mesh)) continue
        child.geometry.computeBoundingBox()
        housing.push(child.geometry.boundingBox!.clone().applyMatrix4(inverse.clone().multiply(child.matrixWorld)))
        child.geometry.dispose()
      }
    }
    const children = [...group.children]
    const sliced = new Set<THREE.Object3D>()
    for (const child of children) {
      child.position.x += ox
      child.position.y += oy
      if (!(child instanceof THREE.Mesh)) continue
      // The glass can sit on a tile edge. Trim the surrounding cap/frame there,
      // rather than letting their thickness protrude into the next block (§5.3).
      child.updateMatrix()
      child.geometry.computeBoundingBox()
      const bounds = child.geometry.boundingBox!.clone().applyMatrix4(child.matrix)
      if (child.geometry instanceof THREE.BoxGeometry && housing.length && !sliced.has(child)) {
        // Split at changes in the housing cross-section so each slice reaches
        // its matching face instead of stopping at the widest light/cap.
        const cuts = [...new Set([bounds.min.z, bounds.max.z, ...housing.flatMap((box) => [box.min.z, box.max.z])])]
          .filter((z) => z >= bounds.min.z && z <= bounds.max.z).sort((a, b) => a - b)
        if (cuts.length > 2) {
          group.remove(child)
          for (let i = 1; i < cuts.length; i++) {
            if (cuts[i] - cuts[i - 1] < 1e-6) continue
            const slice = child.clone()
            slice.geometry = child.geometry.clone()
            const vertices = slice.geometry.getAttribute('position')
            for (let j = 0; j < vertices.count; j++) vertices.setZ(j, THREE.MathUtils.clamp(vertices.getZ(j) + child.position.z, cuts[i - 1], cuts[i]) - child.position.z)
            slice.geometry.computeBoundingBox()
            slice.geometry.computeBoundingSphere()
            group.add(slice)
            // Already translated; process with the rest of this loop.
            slice.position.x -= ox
            slice.position.y -= oy
            children.push(slice)
            sliced.add(slice)
          }
          child.geometry.dispose()
          continue
        }
      }
      let minX = -0.5, maxX = 0.5
      if (child.name !== 'psd-fixed-glass') for (const box of housing) {
        if (Math.min(bounds.max.z, box.max.z) - Math.max(bounds.min.z, box.min.z) < 1e-6 ||
          Math.min(bounds.max.y, box.max.y) - Math.max(bounds.min.y, box.min.y) < 1e-6) continue
        if (ox > 0) minX = Math.max(minX, box.max.x)
        else if (ox < 0) maxX = Math.min(maxX, box.min.x)
      }
      if (bounds.min.x > maxX + 1e-6 || bounds.max.x < minX - 1e-6 ||
        bounds.min.y > 0.5 + 1e-6 || bounds.max.y < -0.5 - 1e-6) {
        group.remove(child)
        child.geometry.dispose()
        continue
      }
      const inverse = child.matrix.clone().invert()
      const position = child.geometry.getAttribute('position')
      const point = new THREE.Vector3()
      // Clamping every fitting to the exact same plane makes the fascia,
      // rails and posts fight for depth at a snapped tile edge. Retain their
      // original depth ordering in a millimetre-scale inset (§5.7), also
      // keeping opaque faces clear of an adjacent block. Glass stays snapped.
      const depth = bounds.max.y - bounds.min.y
      const inset = child.geometry instanceof THREE.BoxGeometry
        ? 0.001 + Math.max(0, 0.28 - depth) * 0.01
        : 0
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(child.matrix)
        // The shortened corner's free end also has overlapping sill/trim caps.
        point.x = THREE.MathUtils.clamp(point.x, bounds.min.x + inset, bounds.max.x - inset)
        point.x = THREE.MathUtils.clamp(point.x, minX + (minX === -0.5 ? inset : 0), maxX - (maxX === 0.5 ? inset : 0))
        point.y = THREE.MathUtils.clamp(point.y, -0.5 + inset, 0.5 - inset)
        point.applyMatrix4(inverse)
        position.setXYZ(i, point.x, point.y, point.z)
      }
      position.needsUpdate = true
      child.geometry.computeBoundingBox()
      child.geometry.computeBoundingSphere()
    }
    finishPsdHousing(group)
    return group
  }
}
