import * as THREE from 'three'
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js'
import { setModelDetail } from '../../modelDetail.ts'
import { cabShellGeometry } from './TrainShell.ts'
import { CabFrontSurface } from './CabFrontSurface.ts'

const frontSurfaces = new WeakMap<THREE.Mesh, CabFrontSurface>()

type Vertex = { p: THREE.Vector3; n: THREE.Vector3 }

/** Split the existing skin at paint boundaries. All three colours share the
 * original surface; there are no stacked mask/bumper solids or hidden skins. */
export function cabSkinGeometry(width: number, segments = 5): THREE.BufferGeometry[] {
  const source = cabShellGeometry(width, segments)
  const p = source.getAttribute('position'), n = source.getAttribute('normal')
  const positions: number[][] = [[], [], []], normals: number[][] = [[], [], []]
  const contour = (halfWidth: number, bottom: number, top: number, radius: number) => {
    const points: THREE.Vector2[] = []
    for (const [y, z, start] of [[halfWidth-radius, top-radius, 0], [-halfWidth+radius, top-radius, 90],
      [-halfWidth+radius, bottom+radius, 180], [halfWidth-radius, bottom+radius, 270]]) {
      for (let i = 0; i <= 8; i++) {
        const angle = (start + i * 90 / 8) * Math.PI / 180
        points.push(new THREE.Vector2(y + radius * Math.cos(angle), z + radius * Math.sin(angle)))
      }
    }
    return points
  }
  const regions = [contour(width * .43, 1.13, 3.03, .26), contour(width * .43, .86, 1.12, .11)]
  const emit = (polygon: Vertex[], material: number) => {
    for (let j = 1; j + 1 < polygon.length; j++) for (const v of [polygon[0], polygon[j], polygon[j+1]]) {
      positions[material].push(v.p.x, v.p.y, v.p.z)
      normals[material].push(v.n.x, v.n.y, v.n.z)
    }
  }
  for (let i = 0; i < p.count; i += 3) {
    const triangle = [0,1,2].map(j=>({p:new THREE.Vector3().fromBufferAttribute(p,i+j),n:new THREE.Vector3().fromBufferAttribute(n,i+j)}))
    let remaining = [triangle]
    if (triangle.some(v=>v.p.x > .9)) for (const [region, boundary] of regions.entries()) {
      const outside: Vertex[][] = []
      for (const polygon of remaining) {
        let inside = polygon
        for (let edge = 0; edge < boundary.length && inside.length; edge++) {
          const a = boundary[edge], b = boundary[(edge+1)%boundary.length]
          const distance = (v: Vertex) => (b.x-a.x)*(v.p.z+1.82-a.y) - (b.y-a.y)*(v.p.y-a.x)
          const next: Vertex[] = [], cut: Vertex[] = []
          for (let j = 0; j < inside.length; j++) {
            const v = inside[j], w = inside[(j+1)%inside.length], dv = distance(v), dw = distance(w)
            ;(dv >= 0 ? next : cut).push(v)
            if ((dv >= 0) !== (dw >= 0)) {
              const t = dv/(dv-dw), crossing = {p:v.p.clone().lerp(w.p,t), n:v.n.clone().lerp(w.n,t).normalize()}
              next.push(crossing); cut.push(crossing)
            }
          }
          if (cut.length >= 3) outside.push(cut)
          inside = next
        }
        emit(inside, region+1)
      }
      remaining = outside
    }
    for (const polygon of remaining) emit(polygon, 0)
  }
  source.dispose()
  return positions.map((values,i)=>{
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3))
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals[i],3))
    return geometry
  })
}

/** Embed glazing and fittings in the same curved skin before applying its rake. */
export function seatCabFront(mesh: THREE.Mesh, shell: THREE.Mesh, nose: number, outward: number,
  reference: number, lift: number, thicknessScale = .03): void {
  // Sample interiors as well as edges: a single large front triangle would
  // chord across the rounded shoulder and disappear behind the painted shell.
  const source = mesh.geometry, low = mesh.userData.lowDetailGeometry as THREE.BufferGeometry | undefined
  const detailed = new TessellateModifier(.12, 8).modify(source)
  const reduced = low ? new TessellateModifier(.25, 6).modify(low) : undefined
  source.dispose(); mesh.geometry = detailed
  if (reduced) setModelDetail(mesh, reduced)
  mesh.updateMatrix(); shell.updateMatrixWorld(true)
  const inverse = mesh.matrix.clone().invert(), point = new THREE.Vector3()
  let surface = frontSurfaces.get(shell)
  if (!surface) { surface = new CabFrontSurface(shell.geometry); frontSurfaces.set(shell, surface) }
  const inverseShell = shell.matrixWorld.clone().invert()
  const ray = new THREE.Ray(), hit = new THREE.Vector3()
  const cache: Map<string,number> = shell.userData.frontSamples ??= new Map<string,number>()
  for (const geometry of [mesh.geometry, mesh.userData.lowDetailGeometry as THREE.BufferGeometry | undefined]) {
    if (!geometry) continue
    const p = geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrix)
      const key = `${point.y.toFixed(6)},${point.z.toFixed(6)}`
      let x = cache.get(key)
      if (x === undefined) {
        ray.origin.set(nose+outward*4,point.y,point.z)
        ray.direction.set(-outward,0,0)
        ray.applyMatrix4(inverseShell)
        if (!surface.intersect(ray, hit)) throw new Error('Cab fitting lies outside its shell')
        x = hit.applyMatrix4(shell.matrixWorld).x
        cache.set(key,x)
      }
      point.x = x + outward * (lift + (outward*(point.x-nose)-reference)*thicknessScale)
      point.applyMatrix4(inverse); p.setXYZ(i,point.x,point.y,point.z)
    }
    p.needsUpdate = true
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  }
}
