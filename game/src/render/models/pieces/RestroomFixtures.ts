// Curved ceramic surfaces shared by the WC and wash basin (Z is up).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { ownedMaterial } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'

export function ceramicMaterial(ctx: ModuleContext): THREE.MeshStandardMaterial {
  return ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: 0xf3f3ed, roughness: 0.19, metalness: 0 }))
}

export function roundedFixture(g: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number, radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, d, h, 3, radius), mat)
  mesh.position.set(x, y, z)
  g.add(mesh)
  return mesh
}

/** A profile folding inward makes a real hollow rather than a dark cap. */
export function turnedFixture(g: THREE.Group, mat: THREE.Material, profile: number[][], x: number, y: number, sx = 1, sy = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 40), mat)
  mesh.geometry.rotateX(Math.PI / 2)
  mesh.scale.set(sx, sy, 1)
  mesh.position.set(x, y, 0)
  g.add(mesh)
  return mesh
}

export function fixtureRing(g: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, radius: number, tube: number, sx = 1, sy = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 48), mat)
  mesh.scale.set(sx, sy, 0.65)
  mesh.position.set(x, y, z)
  g.add(mesh)
  return mesh
}
