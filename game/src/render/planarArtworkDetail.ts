import * as THREE from 'three'
import { omitModelDetail, setModelDetail } from './modelDetail.ts'

/** Print static, coplanar coloured artwork once. High keeps the original vectors;
 * Low draws their same artwork on a quad, with no per-frame canvas work.
 * Inputs must be untextured MeshBasicMaterial graphics in the parent's X/Z plane.
 */
export function planarArtworkDetail(
  parent: THREE.Group, artwork: readonly THREE.Object3D[],
  width: number, height: number, y: number, z: number, rear: boolean,
  own: (material: THREE.MeshBasicMaterial) => THREE.MeshBasicMaterial,
): void {
  // CPU-only placement/bounds probes have no canvas and keep the vector graph.
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  // Low feeds are small in the scene. Bound their print to 128 px/metre:
  // the three-metre wall uses 384x256, rather than a multi-megapixel texture.
  canvas.width = Math.max(128, Math.ceil(width * 128)); canvas.height = Math.max(128, Math.ceil(height * 128))
  const context = canvas.getContext('2d')!
  parent.updateMatrixWorld(true)
  const inverse = parent.matrixWorld.clone().invert()
  const meshes: THREE.Mesh[] = []
  for (const root of artwork) root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object) })
  meshes.sort((a, b) => a.renderOrder - b.renderOrder)
  const point = new THREE.Vector3()
  for (const mesh of meshes) {
    const material = mesh.material as THREE.MeshBasicMaterial
    const transform = inverse.clone().multiply(mesh.matrixWorld)
    const source = mesh.geometry, position = source.getAttribute('position')
    const count = source.index?.count ?? position.count
    context.fillStyle = material.color.getStyle(); context.globalAlpha = material.opacity
    for (let i = 0; i < count; i += 3) {
      context.beginPath()
      for (let j = 0; j < 3; j++) {
        const index = source.index ? source.index.getX(i + j) : i + j
        point.fromBufferAttribute(position, index).applyMatrix4(transform)
        const x = ((rear ? -point.x : point.x) / width + .5) * canvas.width
        const v = (.5 - (point.z - z) / height) * canvas.height
        if (j === 0) context.moveTo(x, v); else context.lineTo(x, v)
      }
      context.closePath(); context.fill()
    }
    omitModelDetail(mesh)
    mesh.userData.coherentModelDetail = true
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  const material = own(new THREE.MeshBasicMaterial({ map: texture }))
  // A zero-index High draw retains valid attributes/bounds and no source faces.
  const full = new THREE.PlaneGeometry(width, height); full.setIndex([])
  const print = new THREE.Mesh(full, material)
  print.name = 'low-planar-artwork'
  print.userData.coherentModelDetail = true
  print.rotation.order = 'ZXY'
  print.rotation.x = Math.PI / 2
  if (rear) print.rotation.z = Math.PI
  print.position.set(0, y, z)
  parent.add(print); setModelDetail(print, new THREE.PlaneGeometry(width, height))
}
