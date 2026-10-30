import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {ExplodedLayout,clipFloorGeometry} from '../src/render/explodedLayout.ts'

function fixture() {
  const scene=new THREE.Group(), material=new THREE.MeshStandardMaterial({color:0x999999})
  for(const z of [-10,-5]){
    const group=new THREE.Group();group.userData.levelZ=z
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,4,5),material)
    mesh.position.set(z===-10?-6:6,0,z+2.5);group.add(mesh);scene.add(group)
  }
  const layout=new ExplodedLayout([-10,-5]);layout.generate([scene],[scene]);return {layout,scene,material}
}

test('floors are independent rigid objects: large translations never edit vertices or connect trays',()=>{
  const {layout,scene,material}=fixture()
  assert.equal(scene.visible,false)
  const mesh=layout.floors[0].children[0], original=Array.from(mesh.geometry.attributes.position.array)
  const geometry=mesh.geometry, materialBefore=mesh.material
  layout.shifts[0].set(500,-300,200)
  assert.deepEqual(Array.from(geometry.attributes.position.array),original)
  assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,materialBefore)
  assert.deepEqual(layout.shifts[1].toArray(),[0,0,0])
  assert.equal(layout.floors[0].children[0].material.onBeforeCompile.toString().includes('explodedShifts'),false)
  layout.reset();assert.deepEqual(layout.shifts[0].toArray(),[0,0,0])
  layout.dispose();assert.equal(scene.visible,true)
  scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('selection visibly highlights the whole floor, deselection and reset restore materials',()=>{
  const {layout,scene,material}=fixture()
  const a=layout.floors[0].children[0].material,b=layout.floors[1].children[0].material
  const color=a.color.clone(),emissive=a.emissive.clone()
  layout.select(0);assert.notDeepEqual(a.color,color);assert.deepEqual(b.color,color)
  layout.select(null);assert.deepEqual(a.color,color);assert.deepEqual(a.emissive,emissive)
  layout.select(1);layout.reset();assert.equal(layout.selected,null);assert.deepEqual(b.color,color)
  layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('floor picking follows real translated geometry and returns null on empty space',()=>{
  const {layout,scene,material}=fixture()
  const camera=new THREE.OrthographicCamera(-20,20,15,-15,.1,100)
  camera.position.set(0,0,30);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  assert.equal(layout.pick(-.3,0,camera),0)
  assert.equal(layout.pick(.3,0,camera),1)
  assert.equal(layout.pick(0,.9,camera),null)
  layout.shifts[0].x=12
  assert.equal(layout.pick(-.3,0,camera),null)
  layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('cross-storey ramp triangles are physically cut before a tray is generated',()=>{
  const geometry=new THREE.BoxGeometry(2,2,12).toNonIndexed()
  geometry.translate(0,0,-7)
  const cut=clipFloorGeometry(geometry,[new THREE.Plane(new THREE.Vector3(0,0,1),10),new THREE.Plane(new THREE.Vector3(0,0,-1),-5)])
  cut.computeBoundingBox()
  assert.ok(cut.boundingBox.min.z>=-10-1e-6);assert.ok(cut.boundingBox.max.z<=-5+1e-6)
  assert.ok(cut.getAttribute('position').count>0)
  cut.dispose()
})

test('live poses follow floor translations without modifying the source frame',()=>{
  const {layout,scene,material}=fixture();layout.shifts[0].set(10,20,30)
  const source=new Float32Array([1,2,-9,0,0,0,3,4,-4,0,0,0])
  const result=layout.offsetPoses(source,6)
  assert.deepEqual(Array.from(result).slice(0,3),[11,22,21]);assert.deepEqual(Array.from(result).slice(6,9),[3,4,-4])
  assert.deepEqual(Array.from(source).slice(0,3),[1,2,-9])
  layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('paused passenger and train poses snap with their tray instead of remaining at old positions',async()=>{
  const {CrowdSystem}=await import('../src/render/scene/systems/CrowdSystem.ts')
  const {TrainSystem}=await import('../src/render/scene/systems/TrainSystem.ts')
  const position=new THREE.Vector3(0,0,-9),prev=new Float32Array(3)
  CrowdSystem.prototype.snapPresentationPoses.call({agentCount:1,cur:new Float32Array([10,20,21,0,0,7]),prev,frozen:new Map([[7,{position}]])})
  assert.deepEqual(position.toArray(),[10,20,21]);assert.deepEqual(Array.from(prev),[10,20,21])
  const entry={from:new THREE.Vector3(),to:new THREE.Vector3(40,50,60),group:new THREE.Group()}
  TrainSystem.prototype.snapPresentationPoses.call({trainSlots:new Map([['train',entry]])})
  assert.deepEqual(entry.from.toArray(),[40,50,60]);assert.deepEqual(entry.group.position.toArray(),[40,50,60])
})

test('instanced multi-material meshes bake all faces independently of later source transforms',()=>{
 const source=new THREE.Group();source.userData.levelZ=-10;source.position.x=3
 const geometry=new THREE.BoxGeometry(2,2,2),before=geometry.attributes.position.array.slice()
 const a=new THREE.MeshStandardMaterial({color:0xff0000}),b=new THREE.MeshStandardMaterial({color:0x00ff00})
 const mesh=new THREE.InstancedMesh(geometry,[a,b,a,b,a,b],2)
 mesh.position.z=-9
 mesh.setMatrixAt(0,new THREE.Matrix4())
 mesh.setMatrixAt(1,new THREE.Matrix4().makeScale(-1,1,1).setPosition(6,0,0))
 source.add(mesh)
 const layout=new ExplodedLayout([-10]);layout.generate([source],[source])
 assert.equal(layout.floors[0].children.length,2)
 assert.equal(layout.floors[0].children.reduce((sum,m)=>sum+m.geometry.attributes.position.count,0),72)
 const bounds=new THREE.Box3().setFromObject(layout.root)
 assert.deepEqual(bounds.min.toArray(),[2,-1,-10]);assert.deepEqual(bounds.max.toArray(),[10,1,-8])
 source.scale.set(9,9,9);mesh.position.set(100,100,100)
 assert.deepEqual(new THREE.Box3().setFromObject(layout.root),bounds)
 assert.deepEqual(geometry.attributes.position.array,before)
 let disposed=0,sourceDisposed=0
 geometry.addEventListener('dispose',()=>sourceDisposed++)
 for(const child of layout.floors[0].children)child.geometry.addEventListener('dispose',()=>disposed++)
 layout.dispose();assert.equal(disposed,2);assert.equal(sourceDisposed,0)
 geometry.dispose();a.dispose();b.dispose()
})

test('layout owns guide replacement, reset and cleanup, without making lines selectable',()=>{
 const {layout,scene,material}=fixture()
 const module={id:'ramp',type:'escalator',x:0,y:0,z:-10,from:{x:0,y:0,z:-10},to:{x:10,y:0,z:-5},cfg:{dir:'up'}}
 const offsets=new Map([[-10,0],[-5,20]])
 layout.setConnections([module],offsets,[1,0])
 const first=layout.connections,initial=first.lines.geometry.attributes.position.array.slice()
 let retired=0;first.lines.geometry.addEventListener('dispose',()=>retired++)
 layout.shifts[0].set(4,5,6);first.update();layout.select(0);layout.reset()
 assert.deepEqual(first.lines.geometry.attributes.position.array,initial)
 assert.equal(layout.selected,null)
 layout.setConnections([module],offsets,[1,0])
 assert.equal(retired,1);assert.equal(first.lines.parent,null)
 const second=layout.connections;let disposed=0
 second.lines.geometry.addEventListener('dispose',()=>disposed++)
 layout.dispose();assert.equal(disposed,1);assert.equal(second.lines.parent,null)
 scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('train cabin-origin offsets map back to the owning floor before translation',()=>{
 const {layout,scene,material}=fixture();layout.shifts[0].set(10,20,3)
 const source=new Float32Array([1,2,-10.3,4,0,0,0,1,0,0])
 const result=layout.offsetPoses(source,10,-.3)
 assert.deepEqual(Array.from(result).slice(0,2),[11,22])
 assert.ok(Math.abs(result[2]+7.3)<1e-5)
 assert.ok(Math.abs(source[2]+10.3)<1e-5)
 layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('floor and wall visibility stay independent without rebuilding geometry, including shared materials',()=>{
 const source=new THREE.Group(),material=new THREE.MeshStandardMaterial()
 for(const z of [-10,-5]){
   const group=new THREE.Group();group.userData.levelZ=z;source.add(group)
   for(const wall of [false,true]){
     const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,1),material);mesh.position.set(wall?3:0,0,z+1);mesh.userData.wall=wall;group.add(mesh)
   }
 }
 const layout=new ExplodedLayout([-10,-5]);layout.generate([source],[source])
 assert.equal(layout.floors[0].children.length,2,'wall and floor may share a material but remain separate batches')
 const meshes=layout.floors.flatMap(f=>f.children),geometry=meshes.map(m=>m.geometry)
 layout.select(0);layout.shifts[0].set(20,30,40)
 layout.setVisibility(0,true,false)
 assert.equal(layout.floors[0].children.find(m=>m.userData.wall).visible,false)
 assert.equal(layout.floors[0].children.find(m=>!m.userData.wall).visible,true)
 assert.ok(layout.floors[1].children.every(m=>m.visible))
 layout.setVisibility(0,false,false);assert.equal(layout.floors[0].visible,false);assert.equal(layout.selected,0)
 layout.setVisibility(0,true,false);assert.deepEqual(layout.shifts[0].toArray(),[20,30,40])
 assert.equal(layout.floors[0].children.find(m=>m.userData.wall).visible,false,'showing floor preserves wall choice')
 layout.setVisibility(0,true,true);assert.ok(layout.floors[0].children.every(m=>m.visible))
 assert.ok(meshes.every((mesh,i)=>mesh.geometry===geometry[i]))
 layout.setVisibility(1,false,true);layout.reset();assert.equal(layout.floors[1].visible,false,'position reset preserves visibility')
 layout.dispose();source.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('hidden floors and walls cannot be selected and hidden-floor live poses are omitted',()=>{
 const {layout,scene,material}=fixture()
 const camera=new THREE.OrthographicCamera(-20,20,15,-15,.1,100);camera.position.set(0,0,30);camera.lookAt(0,0,0);camera.updateMatrixWorld()
 layout.setVisibility(0,false,true)
 assert.equal(layout.pick(-.3,0,camera),null)
 const source=new Float32Array([1,2,-9,0,0,7,3,4,-4,0,0,8])
 assert.deepEqual(Array.from(layout.offsetPoses(source,6)),Array.from(source).slice(6))
 layout.setVisibility(0,true,true);assert.equal(layout.pick(-.3,0,camera),0)
 assert.deepEqual(layout.offsetPoses(source,6),source)
 layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('selected-floor panel anchor follows the floor and camera, including when the floor is hidden',()=>{
 const {layout,scene,material}=fixture()
 const camera=new THREE.OrthographicCamera(-20,20,15,-15,.1,100);camera.position.set(0,0,30);camera.lookAt(0,0,0);camera.updateMatrixWorld()
 assert.equal(layout.screenAnchor(camera,400,300),null)
 layout.select(0)
 const initial=layout.screenAnchor(camera,400,300)
 assert.ok(Math.abs(initial[0]-160)<1e-6);assert.ok(Math.abs(initial[1]-150)<1e-6)
 layout.shifts[0].x=10
 assert.ok(Math.abs(layout.screenAnchor(camera,400,300)[0]-260)<1e-6)
 layout.setVisibility(0,false,false)
 assert.ok(Math.abs(layout.screenAnchor(camera,400,300)[0]-260)<1e-6,'hidden floor keeps its recovery panel anchored')
 camera.zoom=2;camera.updateProjectionMatrix()
 assert.notDeepEqual(layout.screenAnchor(camera,400,300),initial)
 layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})

test('passenger floor identities survive arbitrary tray heights and visibility compaction',()=>{
 const {layout,scene,material}=fixture(),owners=new Map([[999,999]])
 layout.shifts[1].z=-5
 const source=new Float32Array([1,2,-9,0,0,7,3,4,-4,0,0,8])
 const positions=layout.offsetPoses(source,6,0,owners)
 assert.equal(positions[2],positions[8]);assert.deepEqual([...owners],[[7,-10],[8,-5]])
 layout.setVisibility(0,false,true);layout.offsetPoses(source,6,0,owners)
 assert.deepEqual([...owners],[[8,-5]],'ownership follows passenger IDs after hidden-row compaction')
 layout.offsetPoses(new Float32Array(),6,0,owners);assert.equal(owners.size,0,'old passengers do not retain floor identities')
 layout.dispose();scene.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose()
})
