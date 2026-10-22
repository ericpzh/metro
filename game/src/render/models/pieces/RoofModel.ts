import * as THREE from 'three'
import { PieceBuilder, finishSlab } from '../PieceBuilder.ts'
import { DEFAULT_ROOF_FINISH, ROOF_THICKNESS, TRUSS_ROOF_BASE, TRUSS_ROOF_EAVE, TRUSS_ROOF_SKIN, TRUSS_ROOF_CHORD, trussRoofRidge, CANOPY_ROOF_DROP, CANOPY_POST_RADIUS, canopyPosts } from '../../../sim/structures.ts'
import type { Module } from '../../../sim/types.ts'

import { omitModelDetail, setModelDetail, tubeModelDetail } from '../../modelDetail.ts'

type Point = [number, number, number]

/** One structural member between two points, kept within the module footprint. */
function member(group: THREE.Group, mat: THREE.Material, a: Point, b: Point, width: number): void {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const mesh = finishSlab(group, mat, 0, 0, 0, width, direction.length(), width)
  mesh.position.copy(start.add(end).multiplyScalar(0.5))
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  mesh.name = [direction.x, direction.y, direction.z].filter(value => Math.abs(value) > 1e-6).length > 1 ? 'roof-web-diagonal' : 'roof-web-post'
}

export class RoofModel extends PieceBuilder {
  readonly kind = 'roof'

  build(mod: Extract<Module, { type: 'roof' }>): THREE.Group {
    const group = new THREE.Group()
    // The finish brush paints the roof sheets; the supporting truss stays steel.
    const mat = this.ctx.finish(mod.cfg.finish ?? DEFAULT_ROOF_FINISH)
    if (!mod.cfg.variant) {
      const z = mod.cfg.plateSnap === 'lower'
        ? -0.875
        : mod.cfg.plateSnap === 'upper' ? -0.125 : TRUSS_ROOF_BASE + ROOF_THICKNESS / 2
      finishSlab(group, mat, (mod.w - 1) / 2, (mod.d - 1) / 2, z, mod.w, mod.d, ROOF_THICKNESS)
      return this.placeLocal(group, mod)
    }

    const length = mod.w
    const metal = this.ctx.mats.steel
    const width = mod.d
    const centreX = (length - 1) / 2
    const crestY = (width - 1) / 2
    const eaveY = width - 0.5
    const canopy = mod.cfg.variant === 'canopy'
    const drop = canopy ? CANOPY_ROOF_DROP : 0
    const ridgeZ = trussRoofRidge(width) - drop
    const roofThickness = TRUSS_ROOF_SKIN
    const upper = (y: number): number => ridgeZ - (ridgeZ - (TRUSS_ROOF_EAVE - drop)) * Math.abs(y - crestY) / (width / 2)
    const lowerZ = TRUSS_ROOF_BASE + TRUSS_ROOF_CHORD / 2
    // Full-length chords meet the next dragged bay at the shared block edge (§4.1).
    const longitudinal = (y: number, z: number, thickness: number, name: string): void => {
      const beam = finishSlab(group, metal, centreX, y, z, length, thickness, thickness)
      beam.name = name
      if (name === 'roof-purlin') omitModelDetail(beam)
      else tubeModelDetail(beam)
    }

    // A shallow pitched shell: two continuous sheet runs, with the crest along X.
    // The eaves sit just inside the footprint after the sheets are tilted.
    for (const side of [-1, 1]) {
      const y0 = side < 0 ? -0.48 : crestY
      const y1 = side < 0 ? crestY : eaveY - 0.02
      const z0 = upper(y0)
      const z1 = upper(y1)
      const angle = Math.atan2(z1 - z0, y1 - y0)
      // The tilted skin's highest corner finishes exactly at the five-metre cap.
      const sheet = finishSlab(group, mat, centreX, (y0 + y1) / 2, (z0 + z1) / 2 + roofThickness - roofThickness * Math.cos(angle) / 2, length, Math.hypot(y1 - y0, z1 - z0), roofThickness)
      sheet.rotation.x = angle
    }

    // The standalone pitched shell is just the two finished roof sheets: no
    // purlins, chords, webs or other support members.
    if (mod.cfg.variant === 'shell') return this.placeLocal(group, mod)

    // Purlins follow the central crest immediately below the shared roof skin.
    for (let y = 0; y < width; y += 1) {
      longitudinal(y, upper(y) - 0.1, 0.11, 'roof-purlin')
    }

    if (canopy) {
      // Two symmetric rows at every width; the open ground has no chords or diagonal webs.
      for (const { x, y, height } of canopyPosts(mod)) {
        const geometry = new THREE.CylinderGeometry(CANOPY_POST_RADIUS, CANOPY_POST_RADIUS, height, 24)
        geometry.rotateX(Math.PI / 2)
        const post = new THREE.Mesh(geometry, metal)
        post.name = 'canopy-post'
        post.position.set(x, y, height / 2)
        const low = new THREE.CylinderGeometry(CANOPY_POST_RADIUS, CANOPY_POST_RADIUS, height, 3, 1, true)
        low.rotateX(Math.PI / 2)
        setModelDetail(post, low)
        group.add(post)
      }
      return this.placeLocal(group, mod)
    }

    if (mod.cfg.variant === 'tapered-truss') {
      // A closed triangular web: internal ribs and end ties carry the shell
      // into the heavy central chord without adding walls or a second bottom rail.
      longitudinal(crestY, lowerZ, TRUSS_ROOF_CHORD, 'roof-bottom-chord')
      // Mirror alternate ribs to halve the web density while retaining both outer edges.
      const ribYs: number[] = []
      for (let y = 0; y < width / 2; y += 2) ribYs.push(y, width - 1 - y)
      for (let x = 0; x < length; x += 1) {
        member(group, metal, [x, crestY, lowerZ], [x, crestY, ridgeZ - 0.12], 0.14)
        for (const y of ribYs) {
          member(group, metal, [x, crestY, lowerZ], [x, y, upper(y) - 0.12], 0.12)
          if (x < length - 1) member(group, metal, [x, crestY, lowerZ], [x + 1, y, upper(y) - 0.12], 0.1)
        }
        for (const y of [0, width - 1]) {
          member(group, metal, [x, y, upper(y) - 0.12], [x, crestY, ridgeZ - 0.12], 0.14)
        }
      }
    } else {
      // The original open web is turned ninety degrees: its triangular runs
      // now follow the crest, with one run roughly every four metres across.
      const trussYs = new Set<number>([0, width - 1])
      for (let y = 4; y < width - 1; y += 4) trussYs.add(y)
      for (const y of trussYs) {
        longitudinal(y, lowerZ, TRUSS_ROOF_CHORD, 'roof-bottom-chord')
        for (let x = 0; x < length; x += 1) {
          member(group, metal, [x, y, lowerZ], [x, y, upper(y) - 0.12], 0.1)
          if (x < length - 1) member(group, metal, [x, y, lowerZ], [x + 1, y, upper(y) - 0.12], 0.09)
        }
      }
    }

    const diagonals = group.children.filter(mesh => mesh.name === 'roof-web-diagonal')
    const count = mod.cfg.variant === 'tapered-truss' ? 4 : 1
    const keep = new Set(Array.from({ length: Math.min(count, diagonals.length) }, (_, i) => diagonals[Math.floor(i * diagonals.length / Math.min(count, diagonals.length))]))
    for (const mesh of group.children) if (mesh instanceof THREE.Mesh && mesh.name.startsWith('roof-web-')) {
      if (keep.has(mesh)) tubeModelDetail(mesh)
      else omitModelDetail(mesh)
    }
    return this.placeLocal(group, mod)
  }
}
