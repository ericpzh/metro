// Fire-extinguisher cabinet (灭火器) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocalAtEdge } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { extinguisherSpec, extinguisherVariant } from '../../../sim/extinguishers.ts'

/**
 * Fire-extinguisher cabinet (灭火器, 装饰): the reference red steel box, 0.70 ×
 * 0.44 m in plan and 1.10 m tall including its four legs — the drawn height
 * the shared cabinet spec reserves.
 *
 * The carcass rides a dark base plate on four corner legs, a lid overhangs it on
 * every side, and the front is two red doors laid over a dark backing so the seam
 * between them is a real groove; the upper door prints 灭火器箱 over its English
 * gloss and the lower one 火119警, and a recessed handle sits on the +x side. The
 * front faces local −y.
 */
function buildExtinguisher(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const w = 0.7
  const d = 0.44
  const h = extinguisherSpec('standard').height
  const legH = 0.16
  // Four corner legs, then the base plate they carry the carcass on.
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    for (const y of [-d / 2 + 0.06, d / 2 - 0.06]) slab(g, mats.exitRed, x, y, legH / 2, 0.05, 0.05, legH)
  }
  slab(g, mats.darkSteel, 0, 0, legH + 0.025, w, d, 0.05)
  // The carcass, and the dark backing its two doors close over.
  slab(g, mats.exitRed, 0, 0.01, 0.63, w, d - 0.02, 0.86)
  slab(g, mats.black, 0, -d / 2 + 0.011, 0.63, w - 0.06, 0.017, 0.84)
  // Two doors with a seam between them, then the overhanging lid.
  slab(g, mats.exitRed, 0, -d / 2 - 0.0125, 0.88, w - 0.05, 0.025, 0.32)
  slab(g, mats.exitRed, 0, -d / 2 - 0.0125, 0.47, w - 0.05, 0.025, 0.46)
  slab(g, mats.exitRed, 0, 0, h - 0.025, w + 0.04, d + 0.04, 0.05)
  // The recessed side handle: a dark well with the grip standing in it.
  slab(g, mats.black, w / 2 + 0.0035, 0.05, 0.88, 0.009, 0.16, 0.07)
  slab(g, mats.steel, w / 2 + 0.0125, 0.05, 0.88, 0.02, 0.12, 0.02)
  // The lettering, printed on the doors' own red steel.
  plate(g, mats.fireLabels, 0.64, 0.8, 0, -d / 2 - 0.027, 0.66, 0)
  return g
}

/** An open shell keeps the equipment visible through the front glazing. */
function buildGlassCabinet(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const { width: w, depth: d, height: h } = extinguisherSpec('glass')
  const t = 0.045
  slab(g, mats.exitRed, 0, d / 2 - t / 2, h / 2, w, t, h)
  for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) slab(g, mats.exitRed, x, 0, h / 2, t, d - 2 * t, h)
  for (const z of [t / 2, h - t / 2]) slab(g, mats.exitRed, 0, 0, z, w - 2 * t, d - 2 * t, t)
  slab(g, mats.exitRed, 0, 0, h / 2, t, d - 2 * t, h - 2 * t)
  // Left-hand storage shelves; the right bay keeps room for tall equipment.
  for (const z of [0.45, 0.85, 1.25, 1.65]) slab(g, mats.exitRed, -w / 4, 0, z, w / 2 - t * 1.5, d - 2 * t, 0.025)
  // Framed double doors. Every pane is a single surface, with no steel behind it.
  for (const x of [-w / 4, w / 4]) {
    const doorW = w / 2 - 0.008
    const doorH = h - 0.08
    const front = -d / 2 + 0.018
    for (const edge of [-1, 1]) {
      slab(g, mats.exitRed, x + edge * (doorW / 2 - 0.04), front, h / 2, 0.08, 0.036, doorH)
      slab(g, mats.exitRed, x, front, h / 2 + edge * (doorH / 2 - 0.06), doorW - 0.16, 0.036, 0.12)
    }
    plate(g, mats.glass, doorW - 0.16, doorH - 0.24, x, front, h / 2, 0)
    slab(g, mats.exitRed, x, front, 1.2, doorW - 0.16, 0.036, 0.027)
  }
  // Extinguishers have round red bodies, a pale label, valve, handle and black hose.
  function bottle(x: number, z: number, size: number) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * size, 0.075 * size, 0.38 * size, 12), mats.exitRed)
    body.rotation.x = Math.PI / 2
    body.position.set(x, -0.025, z + 0.19 * size)
    g.add(body)
    slab(g, mats.white, x, -0.101 * size, z + 0.19 * size, 0.09 * size, 0.004, 0.14 * size)
    slab(g, mats.steel, x, -0.025, z + 0.41 * size, 0.035 * size, 0.04 * size, 0.06 * size)
    slab(g, mats.black, x + 0.02 * size, -0.025, z + 0.45 * size, 0.12 * size, 0.025 * size, 0.025 * size)
    slab(g, mats.black, x + 0.095 * size, -0.025, z + 0.26 * size, 0.025 * size, 0.025 * size, 0.28 * size)
  }
  for (const x of [0.22, 0.51]) bottle(x, t, 1.5)
  for (const x of [-0.54, -0.27]) bottle(x, 0.875, 0.75)
  // Yellow helmet and rolled fire blankets on the upper/lower storage shelves.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.psu)
  helmet.rotation.x = Math.PI / 2
  helmet.position.set(-0.4, 0, 1.675)
  g.add(helmet)
  slab(g, mats.psu, -0.4, 0, 1.666, 0.29, 0.23, 0.02)
  for (const x of [-0.55, -0.35, -0.15]) {
    slab(g, mats.darkSteel, x, 0, 0.21, 0.12, 0.17, 0.32)
    slab(g, mats.psu, x, -0.088, 0.31, 0.12, 0.006, 0.07)
  }
  for (const x of [-0.075, 0.075]) slab(g, mats.steel, x, -d / 2 + 0.007, 1.02, 0.02, 0.012, 0.19)
  plate(g, mats.fireStationLabels, w - 0.12, h - 0.18, 0, -d / 2 + 0.001, h / 2, 0)
  return g
}

export class ExtinguisherModel extends PieceBuilder {
  readonly kind = 'extinguisher'
  build(mod: Extract<Module, { type: 'extinguisher' }>): THREE.Group {
    const variant = extinguisherVariant(mod.cfg.variant)
    const spec = extinguisherSpec(variant)
    const g = variant === 'glass' ? buildGlassCabinet(this.ctx.mats) : buildExtinguisher(this.ctx.mats)
    if (variant === 'compact') {
      const standard = extinguisherSpec('standard')
      g.scale.set(spec.width / standard.width, spec.depth / standard.depth, spec.height / standard.height)
    }
    // The two-cell cabinet sits centrally across its reserved run, beside its anchor.
    if (spec.cells === 2) for (const child of g.children) child.position.x += 0.5
    return placeLocalAtEdge(g, mod, spec.depth, this.ctx.data?.modules)
  }
}

