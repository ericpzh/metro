import * as THREE from '../game/node_modules/three/build/three.module.js'

// Offline illustration geometry. +X faces travel, Z is up; the bake binds
// the entire head (including the drawn eyes) to the source head bone.
export const INK = { skin: 0, top: 1, bottom: 2, shoe: 3, hair: 4, line: 5, white: 6, accent: 7 }

export function passengerHead(sourceHead) {
 const center = sourceHead.getCenter(new THREE.Vector3())
 center.z = sourceHead.max.z - 0.04
 const rx = 0.14, ry = 0.145, rz = 0.23
 const parts = []
 const head = new THREE.SphereGeometry(1, 16, 10)
 head.rotateX(Math.PI / 2)
 head.scale(rx, ry, rz)
 head.translate(center.x, center.y, center.z)
 parts.push({ geometry: head, region: INK.skin })
 // Eye marks follow the face surface rather than floating in front of it.
 function mark(y, z, width, height, region, lift) {
  const g = new THREE.CircleGeometry(1, 16)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
   const py = y + p.getX(i) * width, pz = z + p.getY(i) * height
   const x = rx * Math.sqrt(Math.max(0.02, 1 - (py / ry) ** 2 - (pz / rz) ** 2))
   p.setXYZ(i, center.x + x + lift, center.y + py, center.z + pz)
  }
  parts.push({ geometry: g, region })
 }
 for (const side of [-1, 1]) {
  mark(side * 0.061, 0.005, 0.033, 0.047, INK.line, 0.002)
  mark(side * 0.061, 0.001, 0.028, 0.039, INK.white, 0.003)
  mark(side * 0.057, 0.002, 0.016, 0.031, INK.line, 0.004)
  mark(side * 0.057 - 0.005, 0.015, 0.006, 0.009, INK.white, 0.005)
 }
 mark(0, -0.077, 0.016, 0.003, INK.line, 0.002)
 const positions = [], indices = [], regions = []
 for (const {geometry, region} of parts) {
  const offset = positions.length / 3
  positions.push(...geometry.attributes.position.array)
  indices.push(...Array.from(geometry.index.array, i => i + offset))
  regions.push(...Array(geometry.attributes.position.count).fill(region))
  geometry.dispose()
 }
 const geometry = new THREE.BufferGeometry()
 geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
 geometry.setIndex(indices)
 geometry.userData.regions = regions
 geometry.computeBoundingBox()
 return geometry
}

export function passengerRegion(material, part) {
 if (/skin/i.test(material)) return INK.skin
 if (/eye|eyebrow/i.test(material)) return INK.line
 if (/hair/i.test(material)) return INK.hair
 if (/feet/i.test(part)) return INK.shoe
 if (/legs/i.test(part)) return INK.bottom
 if (/white/i.test(material)) return INK.white
 if (/tie|red|orange/i.test(material)) return INK.accent
 return INK.top
}
