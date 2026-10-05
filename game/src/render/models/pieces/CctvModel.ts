// Ceiling camera (监控) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * Ceiling camera (监控, 装饰): the reference bracket-and-swivel housing — a dark
 * bullet head with its lens, a two-LED illuminator and a sun hood, carried on a
 * steel arm from a ceiling plate. The head looks along the piece's local −y, so the
 * placement rotation aims it; the whole assembly sits inside its own cell, hung
 * rather than standing.
 *
 * It is a prop: no line of sight is simulated, so the piece never changes what an
 * agent can see or where one walks. The head is a child group tipped about x, which
 * is the one rotation that leaves its lens dead ahead and its tilt down the −y axis
 * whatever `rot` does to the piece as a whole.
 */
function buildCctv(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const ceiling = 3.0 // the storey ceiling underside
  // The mount is slim: a 0.14 m ceiling plate, a thin stem, a small clamp.
  slab(g, mats.darkSteel, 0.1, 0, ceiling - 0.02, 0.14, 0.14, 0.04)
  slab(g, mats.steel, 0.1, 0, (2.78 + ceiling) / 2, 0.028, 0.028, ceiling - 2.78)
  slab(g, mats.darkSteel, 0.1, 0, 2.755, 0.09, 0.08, 0.09)
  slab(g, mats.steel, 0.03, 0, 2.72, 0.16, 0.032, 0.032)
  slab(g, mats.darkSteel, -0.05, 0, 2.68, 0.07, 0.07, 0.07)
  // The head, tipped 12° down at the concourse, built about its own x = 0 so the body,
  // the hood and the lens all sit on one axis.
  const head = new THREE.Group()
  head.position.set(-0.05, -0.02, 2.63)
  head.rotation.x = -0.21
  g.add(head)
  // A slim 0.13 m body with a flange plate at the front and a shallow rail on top.
  slab(head, mats.white, 0, 0.01, 0, 0.13, 0.26, 0.13)
  slab(head, mats.steel, 0, 0.01, 0.056, 0.14, 0.22, 0.024)
  slab(head, mats.darkSteel, 0, -0.125, 0, 0.15, 0.024, 0.15)
  // The sun hood: a thin plate over the lens, a little wider than the body.
  slab(head, mats.steel, 0, 0.024, 0.126, 0.155, 0.3, 0.02)
  slab(head, mats.steel, 0, 0.114, 0.116, 0.155, 0.024, 0.044)
  // The lens: a small dark ring, the glass inside it, and the barrel behind.
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.08, 24), mats.black)
  lens.rotation.x = Math.PI / 2
  lens.position.set(0, -0.155, 0)
  head.add(lens)
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.014, 24), mats.tintedGlass)
  glass.rotation.x = Math.PI / 2
  glass.position.set(0, -0.196, 0)
  head.add(glass)
  // The two illuminator LEDs beside the lens, in the flange plate's front face.
  for (const x of [-0.052, 0.052]) {
    const led = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 12), mats.ledRed)
    led.rotation.x = Math.PI / 2
    led.position.set(x, -0.19, -0.038)
    head.add(led)
  }
  return g
}

export class CctvModel extends PieceBuilder {
  readonly kind = 'cctv'
  build(mod: Extract<Module, { type: 'cctv' }>): THREE.Group {
    return placeLocal(buildCctv(this.ctx.mats), mod)
  }
}

