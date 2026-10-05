// Goods shelf (货架) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, C, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/* ----------------------------------------------------------------- shelf */

/** Overall height of a 货架 gondola above the floor top, metres. */
const SHELF_H = 1.9

/**
 * The goods on one shelf deck: a row of small, colourful packages (bags, boxes
 * and jars) drawn as one InstancedMesh, so a whole shelf costs a single draw
 * call. Instance colours vary by slot, so the row reads as a stocked shelf
 * without a mesh per product. `baseZ` is the deck top, `cx`/`cy` the unit centre.
 */
function shelfGoodsRow(g: THREE.Group, mats: ModelMaterials, cx: number, cy: number, baseZ: number, along: number, seed: number): void {
  const slots = 6
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.shelfGoods, slots)
  const m = new THREE.Matrix4()
  const col = new THREE.Color()
  const colours = [C.orange, C.gateRed, C.green, C.blue, C.psu, C.white, C.trainSeat, 0xb0703c]
  const spread = along - 0.12
  for (let i = 0; i < slots; i++) {
    const x = cx - spread / 2 + (spread * i) / (slots - 1)
    // A deterministic mix of product shapes and colours per shelf.
    const kind = (i + seed) % 3
    const w = kind === 0 ? 0.13 : kind === 1 ? 0.15 : 0.1
    const d = kind === 0 ? 0.08 : kind === 1 ? 0.11 : 0.1
    const h = kind === 0 ? 0.2 : kind === 1 ? 0.09 : 0.12
    m.makeScale(w, d, h)
    m.setPosition(x, cy, baseZ + h / 2)
    mesh.setMatrixAt(i, m)
    col.setHex(colours[(i * 3 + seed * 5) % colours.length])
    mesh.setColorAt(i, col)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  g.add(mesh)
}

/**
 * One goods-shelf unit (货架): a supermarket gondola following the reference —
 * a charcoal frame with a perforated back panel, five steel shelves each with a
 * white price rail, and a row of colourful goods. The stocked front faces the
 * local −y side (the game's default view) and the back panel sits on +y, so
 * `storeShelfSpots` turns a wall run to back onto its wall. `along` runs with
 * the aisle and `deep` across it, so the same unit is an island row, a wall run,
 * or a free-standing 装饰 piece. `z0` is the floor top.
 */
function shelfUnit(g: THREE.Group, mats: ModelMaterials, cx: number, cy: number, z0: number, along: number, deep: number): void {
  const x0 = cx - along / 2
  const x1 = cx + along / 2
  const yFront = cy - deep / 2
  const yBack = cy + deep / 2
  // Base plinth and the perforated back panel against the local +y edge.
  slab(g, mats.darkSteel, cx, cy, z0 + 0.09, along, deep, 0.18)
  slab(g, mats.shelfPanel, cx, yBack - 0.035, z0 + SHELF_H / 2, along - 0.06, 0.05, SHELF_H)
  // Two side uprights and a top cap.
  for (const x of [x0 + 0.03, x1 - 0.03]) slab(g, mats.darkSteel, x, cy, z0 + SHELF_H / 2, 0.06, deep, SHELF_H)
  slab(g, mats.darkSteel, cx, cy, z0 + SHELF_H - 0.03, along, deep, 0.06)
  // Five shelves, each a steel deck with a white price rail at the front.
  const levels = [0.42, 0.7, 0.98, 1.26, 1.54]
  for (let i = 0; i < levels.length; i++) {
    const deckZ = z0 + levels[i]
    slab(g, mats.steel, cx, cy - 0.02, deckZ, along - 0.12, deep - 0.1, 0.03)
    slab(g, mats.white, cx, yFront + 0.05, deckZ + 0.045, along - 0.12, 0.03, 0.07)
    shelfGoodsRow(g, mats, cx, cy - 0.02, deckZ + 0.015, along, i)
  }
}

/**
 * A free-standing shelf for the 装饰 folder: the store's own unit, one cell
 * wide, turning with the placement rotation via `placeLocal`.
 */
function buildShelf(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  shelfUnit(g, mats, 0, 0, 0, 0.96, 0.5)
  return g
}

export class ShelfModel extends PieceBuilder {
  readonly kind = 'shelf'
  build(mod: Extract<Module, { type: 'shelf' }>): THREE.Group {
    return placeLocal(buildShelf(this.ctx.mats), mod)
  }
}

