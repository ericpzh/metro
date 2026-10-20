import * as THREE from 'three'
import { trainRoofSection } from '../../../sim/stock.ts'
import { cabShellGeometry } from './TrainShell.ts'
import { setModelDetail } from '../../modelDetail.ts'

export const CAR_ROUND_SILL = .49
export const CAR_ROUND_WAIST = trainRoofSection('B').shoulder
type Sample = { y: number; z: number; ny: number; nz: number }
const profiles = new Map<string, Sample[]>()

/** The cab's actual rear cut is the passenger body's profile, in both LODs. */
export function carShellProfile(width: number, low = false): Sample[] {
  const key = `${width}:${low}`
  const existing = profiles.get(key)
  if (existing) return existing
  const geometry = cabShellGeometry(width, low ? 1 : 5)
  const p = geometry.attributes.position, n = geometry.attributes.normal
  const levels = new Map<string, Sample>()
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)+.6)<1e-5 && p.getY(i)>=0) {
    const point = {y:p.getY(i),z:p.getZ(i)+1.82,ny:n.getY(i),nz:n.getZ(i)}
    const level = point.z.toFixed(6), previous = levels.get(level)
    if (!previous || point.y > previous.y) levels.set(level,point)
  }
  geometry.dispose()
  const result = [...levels.values()].sort((a,b)=>a.z-b.z)
  profiles.set(key,result)
  return result
}

export function carShellAt(width: number, z: number, low = false): Sample {
  const profile = carShellProfile(width,low)
  for (let i = 1; i < profile.length; i++) if (z <= profile[i].z) {
    const a = profile[i-1], b = profile[i], t = THREE.MathUtils.clamp((z-a.z)/(b.z-a.z),0,1)
    const normal = new THREE.Vector2(a.ny,a.nz).lerp(new THREE.Vector2(b.ny,b.nz),t).normalize()
    return {y:THREE.MathUtils.lerp(a.y,b.y,t),z,ny:normal.x,nz:normal.y}
  }
  return {...profile.at(-1)!,z}
}

/** Curved lower body / painted band, with shared exact profile samples. */
export function carSideSkin(width: number, a: number, b: number, bottom: number, top: number, side: number, low = false, lift = 0): THREE.BufferGeometry {
  const levels = [bottom,...carShellProfile(width,low).map(p=>p.z).filter(z=>z>bottom+1e-5&&z<top-1e-5),top]
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  for (const z of levels) {
    const p = carShellAt(width,z,low)
    for (const x of [a,b]) {positions.push(x,side*(p.y+lift),z);normals.push(0,side*p.ny,p.nz)}
  }
  for (let i = 0; i+1 < levels.length; i++) {
    const j = i*2
    indices.push(...(side>0?[j,j+2,j+1,j+1,j+2,j+3]:[j,j+1,j+2,j+1,j+3,j+2]))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setIndex(indices)
  return geometry
}

export function addCarSideSkin(root: THREE.Group, material: THREE.Material, width: number,
  a: number, b: number, bottom: number, top: number, side: number, lift = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(carSideSkin(width,a,b,bottom,top,side,false,lift),material)
  mesh.name = 'car-side-skin'
  setModelDetail(mesh,carSideSkin(width,a,b,bottom,top,side,true,lift));root.add(mesh)
  return mesh
}

/** Roof polygons use exactly the same shoulder vertices and normals as the cab. */
export function carRoofSection(width: number, low = false, wellZ?: number): THREE.Shape {
  const shoulder = carShellProfile(width,low).filter(p=>p.z>=CAR_ROUND_WAIST-1e-5)
  const shape = new THREE.Shape();shape.moveTo(-width/2,CAR_ROUND_WAIST)
  for (const p of shoulder)shape.lineTo(-p.y,p.z)
  if (wellZ!==undefined) {
    shape.lineTo(-.55,3.15);shape.lineTo(-.55,wellZ);shape.lineTo(.55,wellZ);shape.lineTo(.55,3.15)
  }
  for (const p of [...shoulder].reverse())shape.lineTo(p.y,p.z)
  shape.closePath();return shape
}

export function smoothCarRoof(geometry: THREE.BufferGeometry, width: number, low = false): void {
  const p = geometry.attributes.position, n = geometry.attributes.normal
  for (let i = 0; i < p.count; i++) {
    const side = Math.sign(p.getY(i)), section = carShellAt(width,p.getZ(i),low)
    if (Math.abs(n.getX(i))<.1 && Math.abs(Math.abs(p.getY(i))-section.y)<1e-4) n.setXYZ(i,0,side*section.ny,section.nz)
  }
}

/** Split faces at every skirt-profile height before bending. Large door faces
 * then follow the curve exactly, instead of spanning it with one straight chord. */
function curvedDoorGeometry(source: THREE.BufferGeometry, width: number, side: number, zOrigin: number, low: boolean): THREE.BufferGeometry {
  const attributes = Object.entries(source.attributes)
  type Vertex = Record<string, number[]>
  const output = new Map(attributes.map(([name])=>[name,[] as number[]]))
  const index = source.index
  const count = index?.count ?? source.attributes.position.count
  const cuts = carShellProfile(width,low).map(p=>p.z-zOrigin)
  const lerp = (a: Vertex,b: Vertex,t: number): Vertex => Object.fromEntries(attributes.map(([name])=>[name,a[name].map((v,i)=>THREE.MathUtils.lerp(v,b[name][i],t))]))
  const clip = (polygon: Vertex[], level: number, above: boolean) => {
    const result: Vertex[] = []
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=a.position[2]-level,db=b.position[2]-level
      const inside=above?da>=0:da<=0, next=above?db>=0:db<=0
      if(inside)result.push(a)
      if(inside!==next)result.push(lerp(a,b,da/(da-db)))
    }
    return result
  }
  for(let i=0;i<count;i+=3){
    const triangle=[0,1,2].map(j=>{
      const vertex=index?index.getX(i+j):i+j
      return Object.fromEntries(attributes.map(([name,attribute])=>[name,Array.from({length:attribute.itemSize},(_,k)=>attribute.array[vertex*attribute.itemSize+k])]))
    })
    const bottom=Math.min(...triangle.map(v=>v.position[2])),top=Math.max(...triangle.map(v=>v.position[2]))
    const levels=[bottom,...cuts.filter(z=>z>bottom+1e-6&&z<top-1e-6),top]
    for(let row=0;row+1<levels.length;row++){
      const polygon=clip(clip(triangle,levels[row],true),levels[row+1],false)
      for(let j=1;j+1<polygon.length;j++)for(const vertex of [polygon[0],polygon[j],polygon[j+1]]){
        const section=carShellAt(width,vertex.position[2]+zOrigin,low)
        const position=[...vertex.position];position[1]+=side*(section.y-width/2)
        for(const [name]of attributes){
          let values=name==='position'?position:vertex[name]
          if(name==='normal'){
            const normal=new THREE.Vector3(...values as [number,number,number])
            if(section.ny>.001)normal.z+=side*section.nz/section.ny*normal.y
            values=normal.normalize().toArray()
          }
          output.get(name)!.push(...values)
        }
      }
    }
  }
  const geometry=new THREE.BufferGeometry()
  for(const [name,attribute]of attributes)geometry.setAttribute(name,new THREE.Float32BufferAttribute(output.get(name)!,attribute.itemSize))
  return geometry
}

/** Includes glazing, black kick panels and seals; x-only sliding keeps the curve. */
export function curveCarDoor(root: THREE.Mesh, width: number, side: number): void {
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return
    let z=root.position.z
    for(let parent: THREE.Object3D|null=object;parent&&parent!==root;parent=parent.parent)z+=parent.position.z
    const source=object.geometry, previous=object.userData.lowDetailGeometry as THREE.BufferGeometry|undefined
    const high=curvedDoorGeometry(source,width,side,z,false)
    const low=curvedDoorGeometry(previous??source,width,side,z,true)
    source.dispose();object.geometry=high;setModelDetail(object,low)
  })
}

/** Keep the exterior roof skin, opening its solid underside to the higher cabin. */
export function openRoofUnderside(geometry: THREE.BufferGeometry): void {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
  const index = geometry.index, count = index?.count ?? positions.count, kept: number[] = []
  for (let i = 0; i < count; i += 3) {
    const corners = [0,1,2].map(j => index ? index.getX(i+j) : i+j)
    if (corners.every(vertex => normals.getZ(vertex) < -.99)) continue
    kept.push(...corners)
  }
  geometry.setIndex(kept)
}
