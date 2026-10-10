// Ticket vending machine (售票机) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, canvasTexture, slab, plate, capTop, ownedMaterial, placeLocalAtEdge } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/** The 车票 / Ticket marquee above a TVM, and the exit's signage. */
function signCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#12181f'
  g.fillRect(0, 0, 256, 64)
  g.strokeStyle = '#e8b23a'
  g.lineWidth = 3
  g.strokeRect(40, 6, 56, 52)
  g.fillStyle = '#e8b23a'
  g.font = 'bold 30px "Microsoft YaHei", sans-serif'
  g.fillText('车票', 48, 46)
  g.fillStyle = '#eef1f4'
  g.font = 'bold 22px sans-serif'
  g.fillText('Ticket', 118, 42)
  return c
}

/* ------------------------------------------------------------------- TVM */

/** Ticket machine (售票机): stainless body, green housing, LCD and a sign. */
function buildTvm(ctx: ModuleContext): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // Plinth and body.
  slab(g, mats.darkSteel, 0, 0.02, 0.06, 0.72, 0.64, 0.12)
  slab(g, mats.steel, 0, 0, 0.62, 0.68, 0.6, 1.0)
  // Green upper housing and the front cover around the slot.
  slab(g, mats.green, 0, 0, 1.3, 0.68, 0.6, 0.36)
  slab(g, mats.green, 0, -0.29, 0.62, 0.6, 0.06, 0.5)
  capTop(g, mats.darkSteel, 0, 0, 1.48, 0.72, 0.64)
  // Tilted LCD in a dark bezel.
  slab(g, mats.black, 0, -0.28, 1.03, 0.56, 0.06, 0.42)
  plate(g, mats.screen, 0.46, 0.3, 0, -0.315, 1.05, 0)
  // Card reader and the ticket slot.
  slab(g, mats.black, 0.24, -0.3, 1.28, 0.12, 0.04, 0.16)
  slab(g, mats.black, -0.12, -0.31, 0.42, 0.3, 0.03, 0.06)
  slab(g, mats.darkSteel, 0.2, -0.31, 0.7, 0.16, 0.03, 0.12)
  // The 车票 marquee on two posts.
  slab(g, mats.darkSteel, -0.26, 0, 1.56, 0.04, 0.04, 0.2)
  slab(g, mats.darkSteel, 0.26, 0, 1.56, 0.04, 0.04, 0.2)
  slab(g, mats.black, 0, 0, 1.72, 0.8, 0.08, 0.3)
  const sign = plate(g, ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 64, (c) => c.drawImage(signCanvas(), 0, 0)) })), 0.74, 0.24, 0, -0.05, 1.72, 0)
  sign.renderOrder = 1
  return g
}

export class TvmModel extends PieceBuilder {
  readonly kind = 'tvm'
  build(mod: Extract<Module, { type: 'tvm' }>): THREE.Group {
    return placeLocalAtEdge(buildTvm(this.ctx), mod, 0.6)
  }
}

