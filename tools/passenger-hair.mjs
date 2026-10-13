import * as THREE from '../game/node_modules/three/build/three.module.js'

// Small, texture-free silhouettes authored for the baked Quaternius heads.
export const HAIRSTYLES = ['cropped', 'swept', 'bob', 'ponytail', 'buns', 'curly']

export function passengerHair(style, head) {
 const parts = []
 const center = head.getCenter(new THREE.Vector3())
 const size = head.getSize(new THREE.Vector3())
 const top = head.max.z
 function ellipsoid(x, y, z, rx, ry, rz, cap = false) {
  const g = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, cap ? Math.PI * 0.61 : Math.PI)
  // Sphere's pole is Y; the game's pole is Z.
  g.rotateX(Math.PI / 2)
  g.scale(rx, ry, rz)
  g.translate(x, y, z)
  parts.push(g)
 }
 const x = center.x, y = center.y
 const rx = size.x * 0.52, ry = size.y * 0.53
 ellipsoid(x, y, top - 0.10, rx, ry, style === 'cropped' ? 0.108 : 0.135, true)
 if (style === 'swept') ellipsoid(x + 0.025, y + 0.015, top - 0.025, rx * 0.95, ry * 0.9, 0.06)
 if (style === 'bob') {
  ellipsoid(x - rx * 0.5, y, top - 0.16, rx * 0.7, ry * 1.08, 0.17)
  for (const side of [-1, 1]) ellipsoid(x, y + side * ry * 0.85, top - 0.15, rx * 0.65, ry * 0.38, 0.16)
 }
 if (style === 'ponytail') ellipsoid(x - rx * 1.25, y, top - 0.17, 0.055, 0.055, 0.19)
 if (style === 'buns') for (const side of [-1, 1]) ellipsoid(x - 0.035, y + side * ry, top - 0.015, 0.065, 0.065, 0.065)
 if (style === 'curly') {
  for (let i = 0; i < 8; i++) {
   const a = i * Math.PI / 4
   ellipsoid(x + Math.cos(a) * rx * 0.8, y + Math.sin(a) * ry * 0.8, top - 0.025, 0.06, 0.06, 0.07)
  }
  ellipsoid(x, y, top + 0.01, 0.07, 0.07, 0.065)
 }
 const positions = [], indices = []
 for (const part of parts) {
  const offset = positions.length / 3
  positions.push(...part.attributes.position.array)
  indices.push(...Array.from(part.index.array, i => i + offset))
  part.dispose()
 }
 const geometry = new THREE.BufferGeometry()
 geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
 geometry.setIndex(indices)
 return geometry
}
