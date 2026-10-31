import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attributeKey, bakedGeometry } from './batchGeometry.ts'
import { STOREY_HEIGHT, storeyBand } from '../sim/constants.ts'
import { ExplodedConnections } from './explodedConnections.ts'
import { packKey } from '../sim/types.ts'
import type { Cell, Module } from '../sim/types.ts'

/** Cut complete triangles once, before the resulting floor becomes a rigid object. */
export function clipFloorGeometry(source: THREE.BufferGeometry, planes: readonly THREE.Plane[]): THREE.BufferGeometry {
  if (!planes.length) return source
  const geometry = source.index ? source.toNonIndexed() : source
  const attributes = Object.entries(geometry.attributes)
  const sizes = attributes.map(([, a]) => a.itemSize)
  const positionIndex = attributes.findIndex(([name]) => name === 'position')
  const positionOffset = sizes.slice(0, positionIndex).reduce((a, b) => a + b, 0)
  const output = attributes.map(() => [] as number[])
  const vertex = (index: number): number[] => attributes.flatMap(([, a]) => Array.from({length:a.itemSize}, (_, i) => a.getComponent(index, i)))
  const distance = (v: number[], plane: THREE.Plane): number => plane.normal.x*v[positionOffset]+plane.normal.y*v[positionOffset+1]+plane.normal.z*v[positionOffset+2]+plane.constant
  for (let i = 0; i < geometry.getAttribute('position').count; i += 3) {
    let polygon = [vertex(i), vertex(i+1), vertex(i+2)]
    for (const plane of planes) {
      const cut: number[][] = []
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j], b = polygon[(j+1)%polygon.length], da = distance(a, plane), db = distance(b, plane)
        if (da >= -1e-6) cut.push(a)
        if ((da < -1e-6) !== (db < -1e-6)) {
          const t = da / (da-db)
          cut.push(a.map((value,k) => value + (b[k]-value)*t))
        }
      }
      polygon = cut
    }
    for (let j = 1; j+1 < polygon.length; j++) for (const v of [polygon[0], polygon[j], polygon[j+1]]) {
      let offset = 0
      for (let k = 0; k < attributes.length; k++) { output[k].push(...v.slice(offset,offset+sizes[k])); offset += sizes[k] }
    }
  }
  const result = new THREE.BufferGeometry()
  attributes.forEach(([name], i) => result.setAttribute(name, new THREE.Float32BufferAttribute(output[i],sizes[i])))
  if (geometry !== source) geometry.dispose()
  source.dispose()
  return result
}

/** Split the baked chunk by owned cell, independent of its painted finish. */
export function splitFrontWalls(source: THREE.BufferGeometry, cells: ReadonlySet<number>): Array<{geometry:THREE.BufferGeometry;wall:boolean}> {
  const geometry=source.index?source.toNonIndexed():source
  const position=geometry.getAttribute('position'), normal=geometry.getAttribute('normal')
  const indices:number[][]=[[],[]]
  const center=new THREE.Vector3(),vertex=new THREE.Vector3()
  for(let i=0;i<position.count;i+=3) {
    center.set(0,0,0)
    for(let j=0;j<3;j++)center.add(vertex.fromBufferAttribute(position,i+j))
    center.multiplyScalar(1/3)
    // Nudge boundary faces into their owning voxel, including top/bottom caps.
    if(normal)center.addScaledVector(vertex.fromBufferAttribute(normal,i),-1e-4)
    const wall=cells.has(packKey(Math.floor(center.x),Math.floor(center.y),Math.floor(center.z)))
    indices[wall?1:0].push(i,i+1,i+2)
  }
  if(!indices[0].length || !indices[1].length) {
    if(geometry!==source)geometry.dispose()
    return [{geometry:source,wall:indices[1].length>0}]
  }
  const result=indices.flatMap((keep,index)=>{
    if(!keep.length)return []
    const part=new THREE.BufferGeometry()
    for(const [name,attribute] of Object.entries(geometry.attributes)) {
      const values=new Float32Array(keep.length*attribute.itemSize)
      for(let j=0;j<keep.length;j++)for(let k=0;k<attribute.itemSize;k++)values[j*attribute.itemSize+k]=attribute.getComponent(keep[j],k)
      part.setAttribute(name,new THREE.Float32BufferAttribute(values,attribute.itemSize))
    }
    return [{geometry:part,wall:index===1}]
  })
  if(geometry!==source)geometry.dispose()
  source.dispose()
  return result
}

/** Generated once. A tray is ordinary immutable geometry under one translated Group. */
export class ExplodedLayout {
  readonly root = new THREE.Group()
  readonly floors: THREE.Group[]
  readonly shifts: THREE.Vector3[]
  readonly floorVisible:boolean[]
  readonly wallsVisible:boolean[]
  readonly floorBounds:THREE.Box3[]
  selected: number | null = null
  connections: ExplodedConnections | null = null
  setConnections(modules:readonly Module[],offsets:ReadonlyMap<number,number>,direction:readonly [number,number]):void {
    this.connections?.dispose()
    this.connections=new ExplodedConnections(modules,this.levels,offsets,direction,this.shifts,this.floorVisible)
    this.root.add(this.connections.lines)
  }
  private readonly materials = new Map<THREE.Material, {color?: THREE.Color; emissive?: THREE.Color}>()
  private readonly hidden: Array<[THREE.Object3D, boolean]> = []
  private readonly raycaster = new THREE.Raycaster()
  constructor(readonlyLevels: readonly number[]) {
    this.levels = [...readonlyLevels]
    this.floors = this.levels.map((level,index) => { const floor = new THREE.Group();floor.userData.floorIndex=index;floor.userData.levelZ=level;this.root.add(floor);return floor })
    this.shifts = this.floors.map(floor => floor.position)
    this.floorVisible=this.levels.map(()=>true)
    this.wallsVisible=this.levels.map(()=>true)
    this.floorBounds=this.levels.map(()=>new THREE.Box3())
  }
  readonly levels: readonly number[]

  generate(sources: readonly THREE.Object3D[], hidden: readonly THREE.Object3D[], base = 0, frontWalls?: readonly Cell[]): void {
    const frontKeys=frontWalls && new Set(frontWalls.map(c=>packKey(c.x,c.y,c.z)))
    const buckets = new Map<string, {owner:number; wall:boolean; material:THREE.Material; geometries:THREE.BufferGeometry[]}>()
    const seen = new Set<THREE.Object3D>()
    for (const source of sources) {
      source.updateWorldMatrix(true,true)
      source.traverseVisible(object => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.BatchedMesh || seen.has(object)) return
        seen.add(object)
        const mesh = object
        let level: number | undefined
        for (let parent:THREE.Object3D|null=mesh;parent && level===undefined;parent=parent.parent) {
          level = parent.userData.levelZ
          if (level===undefined && parent.userData.levelZs?.length) level=Math.min(...parent.userData.levelZs)
        }
        const materials:THREE.Material[] = Array.isArray(mesh.material)?mesh.material:[mesh.material]
        for (let materialIndex=0;materialIndex<materials.length;materialIndex++) {
          const material = materials[materialIndex]
          const plane = material.clippingPlanes?.find(p=>p.normal.z===1 && p.normal.x===0 && p.normal.y===0)
          const owner = this.levels.indexOf(plane ? -plane.constant : level ?? storeyBand(mesh.getWorldPosition(new THREE.Vector3()).z,base,STOREY_HEIGHT))
          if (owner<0) continue
          const instances = mesh instanceof THREE.InstancedMesh ? mesh.count : 1
          for (let instance=0;instance<instances;instance++) {
            const matrix=mesh.matrixWorld.clone()
            if(mesh instanceof THREE.InstancedMesh) { const local=new THREE.Matrix4();mesh.getMatrixAt(instance,local);matrix.multiply(local) }
            let geometry=bakedGeometry(mesh.geometry,matrix)
            if (materials.length>1) {
              const groups=(mesh.geometry as THREE.BufferGeometry).groups.filter(group=>group.materialIndex===materialIndex)
              const keep:number[]=[]
              for(const group of groups) for(let i=group.start;i<group.start+group.count;i++) keep.push(i)
              geometry.setIndex(keep)
              const expanded=geometry.toNonIndexed();geometry.dispose();geometry=expanded
            }
            geometry=clipFloorGeometry(geometry,material.clippingPlanes??[])
            if (!geometry.getAttribute('position').count) {geometry.dispose();continue}
            // Chunk meshes carry a boolean wall marker; equipment must stay visible.
            const parts=frontKeys && typeof mesh.userData.wall==='boolean'
              ? splitFrontWalls(geometry,frontKeys)
              : [{geometry,wall:!frontKeys && mesh.userData.wall===true}]
            for(const {geometry,wall} of parts) {
              const key=`${owner}:${wall}:${material.uuid}:${attributeKey(geometry)}`
              let bucket=buckets.get(key)
              if(!bucket){bucket={owner,wall,material,geometries:[]};buckets.set(key,bucket)}
              bucket.geometries.push(geometry)
            }
          }
        }
      })
    }
    for (const bucket of buckets.values()) {
      const geometry=mergeGeometries(bucket.geometries)!
      for(const part of bucket.geometries)part.dispose()
      geometry.computeBoundingBox();geometry.computeBoundingSphere()
      const material=bucket.material.clone()
      material.onBeforeCompile=bucket.material.onBeforeCompile
      material.clippingPlanes=null
      const color=(material as THREE.MeshBasicMaterial).color
      const emissive=(material as THREE.MeshStandardMaterial).emissive
      this.materials.set(material,{color:color?.clone(),emissive:emissive?.clone()})
      const mesh=new THREE.Mesh(geometry,material)
      mesh.userData.wall=bucket.wall
      this.floorBounds[bucket.owner].union(geometry.boundingBox!)
      this.floors[bucket.owner].add(mesh)
    }
    for(const object of hidden)this.hidden.push([object,object.visible])
    this.hideSources()
  }
  hideSources(): void { for(const [object] of this.hidden)object.visible=false }
  setVisibility(index:number,visible:boolean,walls:boolean):void {
    if(!this.floors[index])return
    this.floorVisible[index]=visible;this.wallsVisible[index]=walls
    this.floors[index].visible=visible
    for(const mesh of this.floors[index].children)if(mesh.userData.wall)mesh.visible=walls
    this.connections?.update()
  }
  select(index:number|null):void {
    this.selected=index
    this.floors.forEach((floor,i)=>floor.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return
      const material=object.material as THREE.MeshStandardMaterial, original=this.materials.get(material)!
      if(original.color)material.color.copy(original.color)
      if(original.emissive)material.emissive.copy(original.emissive)
      if(i===index) {
        if(original.color)material.color.lerp(new THREE.Color(0x58caff),.28)
        if(original.emissive)material.emissive.add(new THREE.Color(0x12364c))
      }
    }))
  }
  screenAnchor(camera:THREE.Camera,width:number,height:number):[number,number]|null {
    const index=this.selected
    if(index===null)return null
    const bounds=this.floorBounds[index],shift=this.shifts[index]
    if(bounds.isEmpty())return null
    let right=-Infinity,top=Infinity,bottom=-Infinity
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
      const p=new THREE.Vector3(x+shift.x,y+shift.y,z+shift.z).project(camera)
      right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y)
    }
    return [(right+1)*width/2,(1-(top+bottom)/2)*height/2]
  }
  pick(x:number,y:number,camera:THREE.Camera):number|null {
    this.root.updateWorldMatrix(true,true)
    this.raycaster.setFromCamera(new THREE.Vector2(x,y),camera)
    const hit=this.raycaster.intersectObjects(this.floors.filter(floor=>floor.visible),true).find(hit=>hit.object.visible)
    return hit ? hit.object.parent!.userData.floorIndex as number : null
  }
  reset():void { for(const shift of this.shifts)shift.set(0,0,0);this.select(null);this.connections?.update() }
  offsetPoses(source:Float32Array,stride:number,floorLift=0,owners?:Map<number,number>):Float32Array {
    owners?.clear()
    const result=source.slice()
    let write=0
    for(let i=0;i+stride<=result.length;i+=stride) {
      const height=floorLift ? Math.round(source[i+2]-floorLift) : source[i+2]
      const index=this.levels.findIndex(z=>height>=z && height<z+STOREY_HEIGHT)
      if(index>=0&&!this.floorVisible[index])continue
      if(owners&&index>=0)owners.set(source[i+5],this.levels[index])
      result.set(source.subarray(i,i+stride),write)
      const shift=this.shifts[index]
      if(shift){result[write]+=shift.x;result[write+1]+=shift.y;result[write+2]+=shift.z}
      write+=stride
    }
    return result.subarray(0,write)
  }
  dispose():void {
    this.connections?.dispose()
    for(const [object,visible]of this.hidden)object.visible=visible
    this.root.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose()})
    for(const material of this.materials.keys())material.dispose()
    this.root.removeFromParent();this.root.clear();this.materials.clear()
  }
}
