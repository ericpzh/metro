import * as THREE from 'three'
import { STOREY_HEIGHT, storeyBand } from '../sim/constants.ts'
import type { StationData } from '../sim/types.ts'

/** Disposable visual slices. Geometry and animated instance buffers stay owned by
 * the original module; only the extra instances and slice materials are ours. */
export class ExplodedRamps {
  readonly group = new THREE.Group()
  private materials = new Set<THREE.Material>()
  private pairs: Array<[THREE.Object3D, THREE.Object3D]> = []
  private restore: Array<() => void> = []

  constructor(roots: THREE.Group, data: StationData, offsets: ReadonlyMap<number,number>, direction: readonly [number,number]) {
    for (const m of data.modules) {
      if (m.type !== 'stair' && m.type !== 'escalator') continue
      const source = roots.children.find(root => root.userData.moduleId === m.id)
      if (!source) continue
      source.updateWorldMatrix(true,true)
      const bounds = new THREE.Box3().setFromObject(source)
      const owner = storeyBand(m.z,data.levelBase??0,STOREY_HEIGHT)
      const sourceOffset = offsets.get(owner)??0
      source.userData.explodedRamp = true
      this.restore.push(()=>{delete source.userData.explodedRamp})
      for (const [level,offset] of offsets) {
        if (bounds.max.z <= level || bounds.min.z >= level+STOREY_HEIGHT) continue
        const root: THREE.Object3D = level === owner ? source : source.clone(true)
        if (root !== source) {
          root.position.x += direction[0]*(offset-sourceOffset)
          root.position.y += direction[1]*(offset-sourceOffset)
          this.group.add(root)
          const originals: THREE.Object3D[] = [], copies: THREE.Object3D[] = []
          source.traverse(o=>originals.push(o));root.traverse(o=>copies.push(o))
          for(let i=0;i<originals.length;i++) this.pairs.push([originals[i],copies[i]])
        }
        const planes = [new THREE.Plane(new THREE.Vector3(0,0,1),-level),
          new THREE.Plane(new THREE.Vector3(0,0,-1),level+STOREY_HEIGHT)]
        const clones = new Map<THREE.Material,THREE.Material>()
        root.traverse(object=>{
          const mesh = object as THREE.Mesh
          if (!mesh.isMesh) return
          const old = mesh.material, callback = mesh.onBeforeRender, oldBase = mesh.userData.base
          const material = (mat:THREE.Material):THREE.Material => {
            let copy = clones.get(mat)
            if (!copy) {copy=mat.clone();copy.clippingPlanes=planes;copy.clipShadows=true;clones.set(mat,copy);this.materials.add(copy)}
            return copy
          }
          mesh.material = Array.isArray(old)?old.map(material):material(old)
          // The original root still passes through LevelSystem. Its cached base
          // must be the owned slice material, or reframing/settings restore the
          // shared uncut material after the slice is installed.
          if(root===source)mesh.userData.base=mesh.material
          if(root!==source)mesh.layers.set(0)
          // Level/section dressing can clear clipping when a setting changes.
          // Restate the slice immediately before shader selection, on owned mats.
          mesh.onBeforeRender = function(...args) {
            callback.apply(this,args)
            for (const mat of Array.isArray(this.material)?this.material:[this.material]) {
              if (mat.clippingPlanes !== planes) {mat.clippingPlanes=planes;mat.needsUpdate=true}
            }
          }
          if(root===source)this.restore.push(()=>{
            mesh.material=old;mesh.onBeforeRender=callback
            if(oldBase===undefined)delete mesh.userData.base
            else mesh.userData.base=oldBase
          })
        })
      }
    }
    this.update()
  }

  update():void {
    for (const [source,copy] of this.pairs) {
      // Root translation belongs to its tray; all nested animation/LOD state is
      // shared with the real model, including escalator rolling instance matrices.
      copy.visible=source.visible
      if(copy.parent!==this.group) {
        copy.position.copy(source.position);copy.quaternion.copy(source.quaternion);copy.scale.copy(source.scale)
      }
      if(source instanceof THREE.Mesh && copy instanceof THREE.Mesh) copy.geometry=source.geometry
      if(source instanceof THREE.InstancedMesh && copy instanceof THREE.InstancedMesh) {
        copy.instanceMatrix=source.instanceMatrix;copy.instanceColor=source.instanceColor;copy.count=source.count
      }
    }
  }

  dispose():void {
    for(const restore of this.restore)restore()
    this.group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose()})
    for(const mat of this.materials)mat.dispose()
    this.group.removeFromParent();this.group.clear();this.pairs=[];this.restore=[];this.materials.clear()
  }
}
