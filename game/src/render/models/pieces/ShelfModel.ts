// Stocked shop fixtures, GAME-SPEC §5.7. The shopping face is local −y.
import * as THREE from 'three'
import { PieceBuilder, C, slab, placeLocalAtEdge } from '../PieceBuilder.ts'
import { shelfSpec, shelfVariant } from '../../../sim/shelves.ts'
import type { Module } from '../../../sim/types.ts'

type Part = { x: number; y: number; z: number; w: number; d: number; h: number; color: number }

/** Repeated stock and fittings are batched across every deck. */
function batch(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, parts: Part[], name: string): void {
  if (!parts.length) { geo.dispose(); return }
  const mesh = new THREE.InstancedMesh(geo, mat, parts.length)
  mesh.name = name
  const matrix = new THREE.Matrix4(), color = new THREE.Color()
  parts.forEach((p, i) => {
    matrix.makeScale(p.w, p.d, p.h).setPosition(p.x, p.y, p.z)
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, color.setHex(p.color))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor!.needsUpdate = true
  mesh.computeBoundingSphere()
  g.add(mesh)
}

export class ShelfModel extends PieceBuilder {
  readonly kind = 'shelf'
  build(mod: Extract<Module, { type: 'shelf' }>): THREE.Group {
    const g = new THREE.Group(), mats = this.ctx.mats
    const variant = shelfVariant(mod.cfg.variant), spec = shelfSpec(variant)
    const cooler = variant === 'cooler' || variant === 'cooler-dark', wire = variant === 'wire'
    const white = variant.startsWith('white') || variant === 'cooler'
    const frame = white ? mats.white : mats.darkSteel
    const height = spec.height, depth = spec.depth, front = -depth / 2, back = depth / 2 - 0.035
    const coolerBaseTop = 0.23, coolerTopBottom = height - 0.06
    const shellH = coolerTopBottom - coolerBaseTop, shellZ = (coolerBaseTop + coolerTopBottom) / 2
    const boxes: Part[] = [], bottles: Part[] = [], labels: Part[] = [], caps: Part[] = [], fittings: Part[] = []
    const add = (list: Part[], x: number, y: number, z: number, w: number, d: number, h: number, color: number): void => {
      list.push({ x, y, z, w, d, h, color })
    }
    const railColor = white ? C.steel : C.darkSteel
    if (wire) {
      for (const x of [-0.41, 0.41]) for (const y of [front + 0.06, back - 0.03]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.027, 10), mats.rubber)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(x, y, 0.035)
        g.add(wheel)
        slab(g, mats.steel, x, y, 0.085, 0.025, 0.035, 0.07)
      }
      slab(g, frame, 0, 0, 0.12, 0.92, depth - 0.05, 0.035)
    } else {
      // Recess the gondola's plinth behind its black toe strip while retaining
      // the tile-edge silhouette. Its old flush front faces fought for depth.
      slab(g, frame, 0, cooler ? 0 : 0.006, cooler ? 0.115 : 0.085, 0.96, cooler ? depth : depth - 0.012, cooler ? coolerBaseTop : 0.17).name = 'shelf-base'
      // Stand the trim proud of the plinth: a flush front face flickers against it.
      slab(g, mats.rubber, 0, front + (cooler ? -0.006 : 0.006), 0.04, 0.88, 0.012, 0.045).name = 'shelf-base-trim'
    }
    if (!wire) {
      const backBottom = cooler ? coolerBaseTop : 0.17
      const backTop = cooler ? coolerTopBottom : height - 0.02
      slab(g, cooler ? mats.white : white ? mats.white : mats.shelfPanel, 0, back, (backBottom + backTop) / 2, cooler ? 0.86 : 0.88, 0.035, backTop - backBottom).name = 'shelf-back'
      if (white && !cooler) for (let z = 0.27; z < height - 0.2; z += 0.11) for (const x of [-0.39, 0.39]) {
        add(fittings, x, back - 0.02, z, 0.008, 0.006, 0.023, C.darkSteel)
      }
    }
    // Slender posts keep the aisle ends open instead of enclosing the stock.
    for (const x of [-0.45, 0.45]) {
      if (cooler) {
        // Panels butt into the base and lid; no coplanar full-height posts beneath them.
        slab(g, frame, x < 0 ? -0.455 : 0.455, 0, shellZ, 0.05, depth, shellH).name = x < 0 ? 'cooler-side-left' : 'cooler-side-right'
        continue
      }
      const postBottom = wire ? 0 : 0.17
      slab(g, frame, x, back, (height + postBottom) / 2, 0.045, 0.055, height - postBottom).name = x < 0 ? 'shelf-post-left' : 'shelf-post-right'
      if (wire) {
        const postH = 1.27
        slab(g, frame, x, front + 0.02, postH / 2, 0.035, 0.035, postH)
        if (wire) {
          const rise = 0.12, run = back - front - 0.02
          const brace = slab(g, frame, x, (front + 0.02 + back) / 2, postH + rise / 2, 0.025, Math.hypot(run, rise), 0.025)
          brace.rotation.x = Math.atan2(rise, run)
        }
      }
    }
    spec.levels.forEach((level, row) => {
      const deck = level + 0.015
      slab(g, cooler || white ? mats.white : mats.steel, 0, -0.015, level, cooler ? 0.84 : 0.87, depth - 0.07, 0.03).name = `shelf-deck-${row}`
      slab(g, cooler ? mats.gateRed : white ? mats.blue : mats.darkSteel, 0, front + 0.033, level, 0.87, 0.028, 0.043)
      for (let i = 0; i < 4; i++) {
        const x = -0.31 + i * 0.205
        add(labels, x, front + 0.015, level, 0.068, 0.008, 0.027, C.white)
        add(fittings, x - 0.006, front + 0.009, level + 0.004, 0.03, 0.003, 0.004, C.black)
        add(fittings, x + 0.018, front + 0.009, level - 0.005, 0.012, 0.003, 0.006, C.orange)
      }
      const guardH = wire ? 0.105 : 0.052
      if (!cooler) {
        add(fittings, 0, front + 0.047, deck + guardH, 0.84, 0.009, 0.009, railColor)
        const bars = wire ? 15 : 8
        for (let i = 0; i < bars; i++) add(fittings, -0.4 + i * 0.8 / (bars - 1), front + 0.047, deck + guardH / 2, 0.006, 0.006, guardH, railColor)
        for (const x of [-0.42, 0.42]) {
          add(fittings, x, -0.015, deck + guardH, 0.009, depth - 0.1, 0.009, railColor)
          add(fittings, x, 0.07, level - 0.025, 0.025, depth * 0.6, 0.055, railColor)
          if (wire) for (let j = 0; j < 5; j++) add(fittings, x, front + 0.05 + j * 0.075, deck + guardH / 2, 0.006, 0.006, guardH, railColor)
        }
      }
      const bottleRow = cooler || row % 3 === 1
      for (let lane = 0; lane < 2; lane++) for (let i = 0; i < 8; i++) {
        const x = -0.357 + i * 0.102, y = front + 0.12 + lane * 0.14
        const palette = [C.green, C.orange, C.gateRed, C.blue, 0xe6c543, 0x8ccaca]
        // Paired product facings, with a second row of stock behind them.
        const color = palette[(Math.floor(i / 2) + row) % palette.length]!
        if (bottleRow) {
          const h = row % 2 ? 0.19 : 0.21
          add(bottles, x, y, deck + h / 2, 0.067, 0.067, h, color)
          add(caps, x, y, deck + h + 0.016, 0.03, 0.03, 0.032, C.white)
          add(labels, x, y - 0.036, deck + h * 0.5, 0.044, 0.008, 0.069, C.white)
          add(fittings, x, y - 0.042, deck + h * 0.51, 0.025, 0.004, 0.019, color)
        } else {
          const h = row % 3 === 0 ? 0.215 : 0.165
          add(boxes, x, y, deck + h / 2, 0.085, 0.08, h, color)
          add(labels, x, y - 0.043, deck + h * 0.53, 0.066, 0.008, h * 0.49, C.white)
          add(fittings, x, y - 0.049, deck + h * 0.66, 0.045, 0.004, 0.011, color)
          add(fittings, x, y - 0.049, deck + h * 0.4, 0.027, 0.004, 0.022, color)
          if (row % 3 === 0) add(labels, x, y, deck + h - 0.008, 0.086, 0.083, 0.009, color)
        }
      }
    })
    const headerH = wire ? 0.23 : cooler ? 0.1 : 0.18
    const headerZ = (cooler ? coolerTopBottom : height) - headerH / 2, headerY = wire ? back : cooler ? front + 0.04 : back - 0.035
    slab(g, cooler ? (white ? mats.blue : mats.darkSteel) : frame, 0, headerY, headerZ, cooler ? 0.86 : 0.94, 0.055, headerH).name = 'shelf-header'
    if (wire) slab(g, mats.shelfPanel, 0, headerY - 0.032, headerZ, 0.83, 0.012, headerH - 0.055)
    else {
      slab(g, cooler ? mats.white : mats.blue, 0, headerY - 0.032, headerZ, 0.65, 0.012, 0.075)
      for (let i = 0; i < 3; i++) slab(g, cooler ? mats.blue : mats.white, -0.18 + i * 0.18, headerY - 0.04, headerZ, 0.1, 0.005, 0.015)
    }
    if (cooler) {
      slab(g, frame, 0, 0, height - 0.03, 0.96, depth, 0.06).name = 'cooler-top'
      for (const x of [-0.217, 0.217]) {
        slab(g, mats.glass, x, front + 0.016, 1.02, 0.398, 0.012, 1.6)
        for (const edge of [-0.207, 0.207]) slab(g, mats.steel, x + edge, front, 1.02, 0.018, 0.03, 1.64)
        for (const z of [0.2, 1.84]) slab(g, mats.steel, x, front, z, 0.434, 0.03, 0.023)
        slab(g, mats.darkSteel, x < 0 ? x + 0.17 : x - 0.17, front - 0.043, 1.06, 0.018, 0.027, 0.27)
      }
      for (let i = 0; i < 10; i++) add(fittings, -0.36 + i * 0.08, front - 0.003, 0.1, 0.044, 0.007, 0.007, C.darkSteel)
    }
    batch(g, new THREE.BoxGeometry(1, 1, 1), mats.shelfGoods, boxes, 'stock-packages')
    const cylinders = (): THREE.BufferGeometry => new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2)
    batch(g, cylinders(), mats.shelfGoods, bottles, 'stock-bottles')
    batch(g, cylinders(), mats.shelfGoods, caps, 'stock-caps')
    batch(g, new THREE.BoxGeometry(1, 1, 1), mats.shelfGoods, labels, 'stock-labels')
    batch(g, new THREE.BoxGeometry(1, 1, 1), mats.shelfGoods, fittings, 'shelf-details')
    // The cooler's handles also stay inside its reserved tile.
    return placeLocalAtEdge(g, mod, depth + (cooler ? 0.12 : 0))
  }
}
