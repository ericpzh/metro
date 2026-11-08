import * as THREE from 'three'
import { bindArtwork } from '../../artwork.ts'
import type { LineDef, Module } from '../../../sim/types.ts'
import { getLanguage } from '../../../sim/i18n.ts'
import { floorDecorSpec, floorMarkLine } from '../../../sim/floorDecor.ts'
import { drawFloorMark } from '../../floorMarkArt.ts'
import { PieceBuilder, canvasTexture } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'

type FloorMark = Extract<Module, { type: 'floor-mark' }>
interface MarkInk {
  material: THREE.MeshStandardMaterial
  retain(geometry: THREE.BufferGeometry): void
  update(lines: readonly LineDef[]): void
}
const inks = new WeakMap<ModelMaterials, Map<string, MarkInk>>()

function floorMarkInk(mats: ModelMaterials, mod: FloorMark, lines: readonly LineDef[]): MarkInk {
  const cache = inks.get(mats) ?? new Map<string, MarkInk>()
  if (!inks.has(mats)) inks.set(mats, cache)
  // The selector, not today's resolved line, owns the slot. Different selectors
  // can resolve to the same fallback now and to different lines after an edit.
  const key = JSON.stringify([mod.cfg.variant, mod.cfg.line ?? ''])
  let entry = cache.get(key)
  if (!entry) {
    const texture = canvasTexture(768, 512, () => {})
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    let current = ''
    let readers = 0
    entry = {
      material,
      retain(geometry) {
        readers++
        const release = () => {
          geometry.removeEventListener('dispose', release)
          if (--readers !== 0) return
          cache.delete(key)
          texture.dispose()
          material.dispose()
        }
        geometry.addEventListener('dispose', release)
      },
      update(next) {
        const line = floorMarkLine(mod, next)
        const signature = JSON.stringify([getLanguage(), line.id, line.name, line.colour])
        if (signature === current) return
        const canvas = texture.image as HTMLCanvasElement
        const g = canvas.getContext('2d')
        if (!g) return
        drawFloorMark(g, mod.cfg.variant, line)
        texture.needsUpdate = true
        current = signature
      },
    }
    cache.set(key, entry)
  }
  entry.update(lines)
  return entry
}

export class FloorMarkModel extends PieceBuilder {
  readonly kind = 'floor-mark'
  build(mod: FloorMark): THREE.Group {
    const g = new THREE.Group()
    const { w, d } = floorDecorSpec(mod)
    const ink = floorMarkInk(this.ctx.mats, mod, this.ctx.data?.lines ?? [])
    bindArtwork(g, data => ink.update(data.lines))
    const geometry = new THREE.PlaneGeometry(w, d)
    ink.retain(geometry)
    const mesh = new THREE.Mesh(geometry, ink.material)
    mesh.position.set((w - 1) / 2, (Math.ceil(d) - 1) / 2, 0.006)
    g.add(mesh)
    this.placeLocal(g, mod)
    g.position.x += mod.cfg.offset?.x ?? 0
    g.position.y += mod.cfg.offset?.y ?? 0
    return g
  }
}
