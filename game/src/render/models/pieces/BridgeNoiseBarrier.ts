import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { beamModelDetail, panelModelDetail } from '../../modelDetail.ts'

/** Fit the barrier bays around their posts and the bridge gantries (§5.4). */
export function buildBridgeNoiseBarrier(g: THREE.Group, mats: ModelMaterials, width: number, y: number, top: number, catenary: boolean, neighborPosts: readonly { x: number; y: number }[] = []): void {
  const base = 0.5
  const height = top - base
  const middle = base + height * 2 / 3
  const halfPost = 0.06
  const railHeight = 0.08
  // Transparent pane edges expose even opposing faces at an exact butt joint.
  // Leave a 3 mm glazing clearance inside the opaque frame on every edge.
  const glazingClearance = 0.003
  const add = (name: string, mat: THREE.Material, x: number, z: number, w: number, depth: number, h: number): void => {
    const mesh = slab(g, mat, x, y, z, w, depth, h)
    mesh.name = `bridge-barrier-${name}`
    if (name === 'top-rail') beamModelDetail(mesh, 'x')
    else if (name !== 'post') panelModelDetail(mesh)
  }
  const bay = (start: number, end: number): void => {
    if (end <= start) return
    const x = (start + end) / 2
    const w = end - start
    // Panels stop at the rail faces. Continuous panels used to share their
    // end faces with the frames, while rails shared side/top faces with posts.
    const lowerTop = middle - railHeight / 2
    const glassBottom = middle + railHeight / 2 + glazingClearance
    const glassTop = top - railHeight - glazingClearance
    add('lower-panel', mats.white, x, (base + lowerTop) / 2, w, 0.08, lowerTop - base)
    if (w > glazingClearance * 2) {
      add('glass', mats.glass, x, (glassBottom + glassTop) / 2, w - glazingClearance * 2, 0.08, glassTop - glassBottom)
    }
    add('middle-rail', mats.steel, x, middle, w, halfPost * 2, railHeight)
    add('top-rail', mats.steel, x, top - railHeight / 2, w, halfPost * 2, railHeight)
  }
  const externalCuts = neighborPosts.filter(post => Math.abs(post.y - y) < halfPost * 2 - 1e-6)
    .map(post => ({ start: post.x - halfPost, end: post.x + halfPost }))
  const cuts = [...externalCuts]
  for (let x = 0; x < width; x += 2) {
    const gantry = catenary && x % 8 === 0
    if (!gantry && externalCuts.some(cut => cut.start < x + halfPost && cut.end > x - halfPost)) continue
    cuts.push({ start: x - halfPost, end: x + halfPost })
    // The gantry supplies the upright at this position; every surrounding
    // frame and panel also stops at its faces rather than passing through it.
    if (!gantry) add('post', mats.steel, x, base + height / 2, halfPost * 2, halfPost * 2, height)
  }
  // A platform end gantry may straddle the module seam. Clip every barrier
  // component against its footprint just as we do for our own uprights.
  let start = -0.5
  const end = width - 0.5
  for (const cut of cuts.sort((a, b) => a.start - b.start)) {
    if (cut.end <= start || cut.start >= end) continue
    bay(start, Math.min(end, cut.start))
    start = Math.min(end, Math.max(start, cut.end))
  }
  bay(start, end)
}
