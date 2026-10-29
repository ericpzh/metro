import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {ExplodedRamps} from '../src/render/explodedRamps.ts'
import {LevelSystem} from '../src/render/scene/systems/LevelSystem.ts'

for(const type of ['stair','escalator'])test(`${type} sections follow their tray, share animation, and own only slice materials`,()=>{
 const roots=new THREE.Group(),root=new THREE.Group(),material=new THREE.MeshBasicMaterial()
 root.userData.moduleId='ramp';roots.add(root)
 const geometry=new THREE.BoxGeometry(2,10,12),mesh=new THREE.InstancedMesh(geometry,material,1)
 mesh.position.set(3,4,-13);root.add(mesh);mesh.setMatrixAt(0,new THREE.Matrix4())
 const original=mesh.material,callback=mesh.onBeforeRender
 mesh.userData.base=original // Already dressed by setStation before slices install.
 const offsets=new Map([[-20,0],[-15,30],[-10,60]])
 const ramp=new ExplodedRamps(roots,{levelBase:0,modules:[{id:'ramp',type,z:-20}]},offsets,[1,1])
 assert.equal(ramp.group.children.length,2)
 assert.deepEqual(ramp.group.children.map(r=>r.position.toArray()),[[30,30,0],[60,60,0]])
 assert.equal(root.userData.explodedRamp,true)
 const sliced=mesh.material
 mesh.material=LevelSystem.prototype.baseOf.call({},mesh)
 assert.equal(mesh.material,sliced,'reframing must retain the base-level slice material')
 mesh.material.clippingPlanes=null;mesh.onBeforeRender()
 assert.ok(mesh.material.clippingPlanes.some(p=>p.distanceToPoint(new THREE.Vector3(0,0,-14))<0),
  'the base model is chopped at -15 m after view dressing')
 const copies=ramp.group.children.map(r=>r.children[0])
 for(const [i,copy]of copies.entries()){
  assert.equal(copy.geometry,geometry);assert.equal(copy.instanceMatrix,mesh.instanceMatrix)
  assert.equal(copy.layers.mask,1,'formerly batched leaves remain visible')
  assert.notEqual(copy.material,mesh.material)
  const z=-15+i*5,planes=copy.material.clippingPlanes
  assert.ok(planes.every(p=>p.distanceToPoint(new THREE.Vector3(0,0,z+2))>0))
  assert.ok(planes.some(p=>p.distanceToPoint(new THREE.Vector3(0,0,z-1))<0))
  assert.ok(planes.some(p=>p.distanceToPoint(new THREE.Vector3(0,0,z+6))<0))
  copy.material.clippingPlanes=null;copy.onBeforeRender();assert.equal(copy.material.clippingPlanes,planes)
 }
 mesh.visible=false;mesh.position.x=9;ramp.update()
 assert.ok(copies.every(c=>!c.visible&&c.position.x===9))
 let geometryDisposed=0,materialDisposed=0
 geometry.addEventListener('dispose',()=>geometryDisposed++);material.addEventListener('dispose',()=>materialDisposed++)
 ramp.dispose();assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0)
 assert.equal(root.userData.explodedRamp,undefined)
 assert.equal(mesh.material,original);assert.equal(mesh.onBeforeRender,callback)
 assert.equal(mesh.userData.base,original)
 geometry.dispose();material.dispose();mesh.dispose()
})
