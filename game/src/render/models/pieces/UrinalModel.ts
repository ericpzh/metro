import * as THREE from 'three'
import { PieceBuilder, placeLocal, ownedMaterial } from '../PieceBuilder.ts'
import { ceramicMaterial } from './RestroomFixtures.ts'
import { setModelDetail } from '../../modelDetail.ts'
import type { Module } from '../../../sim/types.ts'

// Each ring travels around the basin from its low front lip to the tall wall
// back. Continuing over the rolled rim and down the inside makes a single
// ceramic shell with a real recess, rather than a basin stuck onto a flat box.
// [half-width, half-depth, centre-y, front-z, back-z]
const SHELL_RINGS = [
  [.06, .055, -.29, .38, .40],
  [.12, .09, -.29, .41, .46],
  [.18, .135, -.28, .445, .64],
  [.195, .165, -.27, .43, .91],
  [.245, .205, -.27, .50, 1.18],
  [.26, .22, -.27, .565, 1.245],
  [.258, .219, -.27, .59, 1.26],
  [.245, .206, -.27, .602, 1.255],
  [.23, .19, -.27, .59, 1.23],
  [.222, .18, -.27, .565, 1.18],
  [.20, .155, -.27, .52, 1.04],
  [.16, .12, -.27, .475, .82],
  [.10, .075, -.275, .45, .59],
  [.045, .035, -.28, .445, .47],
  [.022, .022, -.28, .445, .445],
] as const

function shellGeometry(segments: number, subdivisions = 1): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = []
  const rings: number[][] = []
  for (let row = 0; row < SHELL_RINGS.length - 1; row++) {
    const a = SHELL_RINGS[Math.max(0, row - 1)], b = SHELL_RINGS[row]
    const c = SHELL_RINGS[row + 1], d = SHELL_RINGS[Math.min(SHELL_RINGS.length - 1, row + 2)]
    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions
      rings.push(b.map((v, i) => .5 * ((2 * v) + (-a[i] + c[i]) * t
        + (2 * a[i] - 5 * v + 4 * c[i] - d[i]) * t * t
        + (-a[i] + 3 * v - 3 * c[i] + d[i]) * t * t * t)))
    }
  }
  rings.push([...SHELL_RINGS[SHELL_RINGS.length - 1]])
  for (const [width, depth, cy, front, back] of rings) {
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2
      const sin = Math.sin(angle), cos = Math.cos(angle)
      // A slightly squared oval keeps broad ceramic shoulders without sharp corners.
      const rise = Math.min(1, (1 - cos) / 1.4)
      const shoulder = rise * rise * (3 - 2 * rise)
      positions.push(width * Math.sign(sin) * Math.abs(sin) ** .88,
        cy + depth * cos, front + (back - front) * shoulder)
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const a = ring * (segments + 1) + i, b = a + segments + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  // Close the underside around the waste outlet; the other end is the drain.
  const underside = positions.length / 3
  positions.push(0, -.29, .39)
  for (let i = 0; i < segments; i++) indices.push(underside, i, i + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  // Weld shading at the loop seam while retaining the regular ring topology.
  const normals = geometry.getAttribute('normal')
  for (let ring = 0; ring < rings.length; ring++) {
    const a = ring * (segments + 1), b = a + segments
    const normal = new THREE.Vector3().fromBufferAttribute(normals, a)
      .add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize()
    normals.setXYZ(a, normal.x, normal.y, normal.z)
    normals.setXYZ(b, normal.x, normal.y, normal.z)
  }
  return geometry
}

/** Wall-hung porcelain urinal; the open bowl faces local +y. */
export class UrinalModel extends PieceBuilder {
  readonly kind = 'urinal'
  build(mod: Extract<Module, { type: 'urinal' }>): THREE.Group {
    const g = new THREE.Group()
    const porcelain = ceramicMaterial(this.ctx)
    const chrome = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xd1d8df, metalness: .35, roughness: .18 }))
    const shell = new THREE.Mesh(shellGeometry(64, 3), porcelain)
    shell.name = 'urinal-ceramic-shell'
    setModelDetail(shell, shellGeometry(12))
    g.add(shell)

    const cylinder = (name: string, material: THREE.Material, radius: number, height: number, x: number, y: number, z: number, alongY = false, topRadius = radius) => {
      const geometry = new THREE.CylinderGeometry(topRadius, radius, height, 24)
      if (!alongY) geometry.rotateX(Math.PI / 2)
      const part = new THREE.Mesh(geometry, material)
      part.name = name
      part.position.set(x, y, z)
      const low = new THREE.CylinderGeometry(topRadius, radius, height, 5)
      if (!alongY) low.rotateX(Math.PI / 2)
      setModelDetail(part, low)
      g.add(part)
      return part
    }
    // Exposed waste outlet below the bowl and a recessed steel drain in its floor.
    cylinder('urinal-waste-outlet', porcelain, .041, .13, 0, -.29, .335, false, .047)
    cylinder('urinal-drain', chrome, .023, .006, 0, -.28, .445)
    for (const x of [-.009, 0, .009]) {
      cylinder('urinal-drain-hole', this.ctx.mats.darkSteel, .0025, .007, x, -.28, .449)
    }

    // Flushometer: inlet collar, riser, stepped valve, sensor and wall supply.
    cylinder('urinal-inlet-collar', chrome, .032, .025, 0, -.46, 1.267)
    cylinder('urinal-flush-pipe', chrome, .012, .18, 0, -.46, 1.365)
    cylinder('urinal-valve-coupling', chrome, .024, .035, 0, -.46, 1.464)
    cylinder('urinal-valve-neck', chrome, .025, .055, 0, -.46, 1.50, false, .034)
    cylinder('urinal-flush-valve', chrome, .035, .18, 0, -.46, 1.61, false, .032)
    cylinder('urinal-valve-cap', chrome, .035, .018, 0, -.46, 1.709)
    cylinder('urinal-sensor', this.ctx.mats.darkSteel, .008, .004, 0, -.424, 1.66, true)
    cylinder('urinal-wall-supply', chrome, .017, .035, 0, -.4775, 1.585, true)
    cylinder('urinal-wall-escutcheon', chrome, .036, .009, 0, -.491, 1.585, true)
    cylinder('urinal-flush-button', chrome, .011, .023, .043, -.46, 1.55).rotation.y = Math.PI / 2
    return placeLocal(g, mod)
  }
}
