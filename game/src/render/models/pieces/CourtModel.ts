import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { omitModelDetail } from '../../modelDetail.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'

/** One marked court and its freestanding net, within a 14 × 7 m placement bay. */
export class CourtModel extends PieceBuilder {
  readonly kind = 'court'
  private buildDivider(mod: Extract<Module, { type: 'court' }>): THREE.Group {
    const g = new THREE.Group()
    const frame = this.ctx.mats.darkSteel
    const fabric = new THREE.MeshStandardMaterial({ color: '#343344', roughness: 0.96 })
    // A portable 2 m fabric screen with broad, stable T-feet; no brand artwork.
    slab(g, fabric, 0.5, 0, 0.53, 1.9, 0.045, 0.86).name = 'divider-fabric'
    for (const x of [-0.42, 1.42]) {
      slab(g, frame, x, 0, 0.5, 0.06, 0.07, 1).name = 'divider-post'
      slab(g, frame, x, 0, 0.035, 0.08, 0.8, 0.07).name = 'divider-foot'
      for (const y of [-0.35, 0.35]) omitModelDetail(slab(g, frame, x, y, 0.025, 0.16, 0.12, 0.05))
    }
    for (const z of [0.10, 0.96]) slab(g, frame, 0.5, 0, z, 1.94, 0.065, 0.045).name = 'divider-rail'
    return this.placeLocal(g, mod)
  }
  build(mod: Extract<Module, { type: 'court' }>): THREE.Group {
    if (mod.cfg.variant === 'divider') return this.buildDivider(mod)
    const g = new THREE.Group()
    const badminton = mod.cfg.variant === 'badminton'
    const length = badminton ? 13.4 : 13.4112
    const width = badminton ? 6.1 : 6.096
    const cx = 6.5, cy = 3
    const left = cx - length / 2, right = cx + length / 2
    const bottom = cy - width / 2, top = cy + width / 2
    const surface = new THREE.MeshStandardMaterial({ color: badminton ? '#237d59' : '#235ba0', roughness: 0.92 })
    const kitchen = new THREE.MeshStandardMaterial({ color: '#68afc3', roughness: 0.92 })
    const ink = this.ctx.mats.white
    const steel = this.ctx.mats.darkSteel
    slab(g, surface, cx, cy, 0.012, 14, 7, 0.024).name = 'court-surface'
    if (!badminton) slab(g, kitchen, cx, cy, 0.026, 4.2672, width, 0.004).name = 'court-kitchen'
    const line = (x: number, y: number, w: number, d: number) => {
      slab(g, ink, x, y, 0.032, w, d, 0.006).name = 'court-marking'
    }
    const stroke = badminton ? 0.04 : 0.0508
    for (const y of [bottom, top]) line(cx, y, length, stroke)
    for (const x of [left, right]) line(x, cy, stroke, width)
    const service = badminton ? 1.98 : 2.1336
    for (const side of [-1, 1]) {
      line(cx + side * service, cy, stroke, width)
      const run = length / 2 - service
      line(cx + side * (service + run / 2), cy, run, stroke)
      if (badminton) line(cx + side * (length / 2 - 0.76), cy, stroke, width)
    }
    if (badminton) for (const side of [-1, 1]) line(cx, cy + side * 2.59, length, stroke)
    const height = badminton ? 1.55 : 0.9144
    const centerHeight = badminton ? 1.524 : 0.8636
    const depth = badminton ? 0.76 : 0.82
    const netWidth = width + 0.36
    const netBottom = cy - netWidth / 2
    for (const side of [-1, 1]) {
      const y = cy + side * (width / 2 + 0.18)
      slab(g, steel, cx, y, 0.08, 0.36, 0.28, 0.16).name = 'net-foot'
      slab(g, steel, cx, y, height / 2 + 0.024, 0.055, 0.055, height).name = 'net-post'
    }
    // Shared line geometry keeps the open mesh net visibly transparent from either side.
    const vertices: number[] = []
    const netTop = (y: number) => centerHeight + (height - centerHeight) * Math.abs((y - cy) / (netWidth / 2))
    const segment = (y0: number, z0: number, y1: number, z1: number) => vertices.push(cx, y0, z0 + 0.03, cx, y1, z1 + 0.03)
    const columns = Math.ceil(netWidth / 0.065), rows = Math.ceil(depth / 0.065)
    for (let i = 0; i <= columns; i++) {
      const y = netBottom + netWidth * i / columns
      segment(y, netTop(y) - depth, y, netTop(y))
    }
    for (let j = 0; j <= rows; j++) for (const side of [-1, 1]) {
      segment(cy, centerHeight - depth * j / rows, cy + side * netWidth / 2, height - depth * j / rows)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#263238' }))
    mesh.name = 'court-net-mesh'
    g.add(mesh)
    for (const side of [-1, 1]) {
      const tape = slab(g, ink, cx, cy + side * netWidth / 4, (centerHeight + height) / 2 + 0.03, 0.035, Math.hypot(netWidth / 2, height - centerHeight), 0.035)
      tape.rotation.x = side * Math.atan2(height - centerHeight, netWidth / 2)
      tape.name = 'net-top-tape'
    }
    return this.placeLocal(g, mod)
  }
}
