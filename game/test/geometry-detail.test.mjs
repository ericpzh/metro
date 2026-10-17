import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { coarseGeometry, geometryDetailReady } from '../src/render/geometryDetail.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'

await geometryDetailReady
test('a solitary reducible fixture receives other-floor detail without a neighbouring batch source',()=>{
  const roots=new THREE.Group(), group=new THREE.Group(), material=new THREE.MeshStandardMaterial()
  group.userData={moduleId:'single',moduleType:'pillar',levelZs:[4]}
  const geometry=new THREE.CylinderGeometry(.4,.4,1,64,8)
  group.add(new THREE.Mesh(geometry,material));roots.add(group)
  const batches=new EquipmentBatches();batches.sync(roots,'single','generation')
  const entry=[...batches.entries.values()][0];assert.ok(entry?.detail)
  const near=entry.mesh.geometry
  const camera=new THREE.PerspectiveCamera(60,1,.1,1000);camera.position.z=5;camera.updateMatrixWorld()
  batches.updateDetail(camera,800);assert.ok(entry.mesh.geometry.index.count<near.index.count)
  batches.hideUI=true;batches.updateDetail(camera,800);assert.equal(entry.mesh.geometry,near)
  batches.clear();geometry.dispose();material.dispose()
})
function fixture(transparent=false, merged=false) {
  const roots=new THREE.Group(), mat=new THREE.MeshStandardMaterial({transparent,opacity:transparent?.35:1})
  const geometry=new THREE.CylinderGeometry(.4,.4,1,64,8)
  geometry.rotateX(Math.PI/2)
  for(let i=0;i<2;i++) {
    const group=new THREE.Group(); group.userData={moduleId:`m${i}`,moduleType:'pillar',levelZs:[0]}
    const g=merged?geometry.clone().scale(1+i*.1,1,1):geometry
    group.add(new THREE.Mesh(g,mat));group.position.x=i*2;roots.add(group)
  }
  const batches=new EquipmentBatches(); batches.sync(roots,'initial','generation')
  const camera=new THREE.PerspectiveCamera(60,1,.1,10000)
  const far=()=>{camera.position.set(0,0,1000);camera.updateMatrixWorld();batches.updateDetail(camera,800)}
  return {roots,mat,geometry,batches,camera,far}
}

test('geometry approximation reduces triangles, preserves attributes/bounds and never mutates the authored source',()=>{
  const source=new THREE.SphereGeometry(1,48,24), positions=source.attributes.position.array.slice(), index=source.index.array.slice()
  const far=coarseGeometry(source)
  assert.ok(far.index.count<source.index.count/2)
  assert.equal(coarseGeometry(source),far,'preparation cached per immutable source')
  assert.deepEqual(source.attributes.position.array,positions);assert.deepEqual(source.index.array,index)
  assert.deepEqual(far.boundingBox,source.boundingBox)
  for(const [name,a] of Object.entries(far.attributes)) {
    assert.equal(a.itemSize,source.attributes[name].itemSize)
    assert.ok([...a.array].every(Number.isFinite))
  }
  assert.ok([...far.index.array].every(i=>i<far.attributes.position.count))
  let disposed=0;far.addEventListener('dispose',()=>disposed++)
  source.dispose();assert.equal(disposed,1,'source owns its cached approximation')
  const tiny=new THREE.BoxGeometry();assert.equal(coarseGeometry(tiny),null);tiny.dispose()
  for(const kind of ['dynamic','partial','morph']) {
    const unsupported=new THREE.SphereGeometry(1,32,16)
    if(kind==='dynamic')unsupported.attributes.position.setUsage(THREE.DynamicDrawUsage)
    if(kind==='partial')unsupported.setDrawRange(3,12)
    if(kind==='morph')unsupported.morphAttributes.position=[unsupported.attributes.position.clone()]
    assert.equal(coarseGeometry(unsupported),null,`${kind} geometry retains its original representation`)
    unsupported.dispose()
  }
  source.dispose()
})

for(const [transparent,merged] of [[false,false],[false,true],[true,false]]) test(`far geometry switches without reallocating batches: transparent=${transparent}, merged=${merged}`,()=>{
  const f=fixture(transparent,merged), mesh=f.batches.root.children[0]
  const original=mesh.geometry, originalBuffer=original.attributes.position.array
  const originalId=transparent?mesh.getGeometryIdAt(0):null
  const bounds=(mesh.boundingSphere??mesh.geometry.boundingSphere).clone()
  f.far()
  if(transparent) assert.notEqual(mesh.getGeometryIdAt(0),originalId)
  else assert.notEqual(mesh.geometry,original)
  assert.equal(f.batches.root.children[0],mesh)
  assert.deepEqual(mesh.boundingSphere??original.boundingSphere,bounds)
  assert.equal(original.attributes.position.array,originalBuffer)
  assert.equal(f.batches.updateDetail(f.camera,800),false,'settled LoD does no buffer work')
  f.batches.equipmentDetailEnabled=false;f.batches.updateDetail(f.camera,800)
  if(transparent) assert.equal(mesh.getGeometryIdAt(0),originalId)
  else assert.equal(mesh.geometry,original)
  f.batches.equipmentDetailEnabled=true;f.far()
  const ortho=new THREE.OrthographicCamera(-500,500,500,-500,.1,10000)
  ortho.position.z=1000;ortho.updateMatrixWorld();f.batches.updateDetail(ortho,800)
  ortho.zoom=1000;ortho.updateProjectionMatrix();f.batches.updateDetail(ortho,800)
  if(transparent)assert.equal(mesh.getGeometryIdAt(0),originalId)
  else assert.equal(mesh.geometry,original)
  f.camera.position.z=2;f.camera.updateMatrixWorld();f.batches.updateDetail(f.camera,800)
  if(transparent) assert.equal(mesh.getGeometryIdAt(0),originalId)
  else assert.equal(mesh.geometry,original)
  for(const root of f.roots.children) assert.equal(root.children[0].layers.mask,2**BATCH_SOURCE_LAYER)
  f.far();f.batches.setHiddenModule(f.roots.children[0]);assert.equal(mesh.visible,false)
  f.batches.setHiddenModule(null);assert.equal(mesh.visible,true)
  let disposed=0;original.addEventListener('dispose',()=>disposed++)
  f.batches.clear();f.batches.clear();assert.equal(disposed,1)
  f.geometry.dispose();f.mat.dispose()
})

test('alpha-cut surfaces and moving rigs never acquire generic geometry LoD',()=>{
  const f=fixture()
  f.mat.alphaMap=new THREE.Texture();f.batches.invalidateViews();f.batches.sync(f.roots,'mapped','new')
  assert.equal(f.batches.entries.values().next().value.detail,undefined)
  f.mat.alphaMap.dispose();f.mat.alphaMap=null
  f.mat.alphaTest=.5;f.batches.invalidateViews();f.batches.sync(f.roots,'alpha-test','new-test')
  assert.equal(f.batches.entries.values().next().value.detail,undefined)
  f.mat.alphaTest=0
  for(const root of f.roots.children)root.userData.wing=root.children[0]
  f.batches.invalidateViews();f.batches.sync(f.roots,'rigs','rigs')
  assert.equal(f.batches.root.children.length,0,'moving wing meshes never become static approximations')
  f.batches.clear();f.geometry.dispose();f.mat.dispose()
})

test('real batches force reduced other-storey geometry, keep current detail and override low quality in Hide UI',()=>{
  const f=fixture(),mesh=f.batches.root.children[0],full=mesh.geometry
  f.camera.position.z=2;f.camera.updateMatrixWorld()
  f.batches.activeZ=4;f.batches.updateDetail(f.camera,800)
  assert.notEqual(mesh.geometry,full,'other storeys are reduced even near the camera')
  f.batches.activeZ=0;f.batches.updateDetail(f.camera,800);assert.equal(mesh.geometry,full)
  f.batches.graphicsQuality='low';f.batches.updateDetail(f.camera,800);assert.notEqual(mesh.geometry,full)
  f.batches.hideUI=true;f.batches.updateDetail(f.camera,800);assert.equal(mesh.geometry,full)
  f.batches.hideUI=false;f.batches.updateDetail(f.camera,800);assert.notEqual(mesh.geometry,full)
  f.batches.clear();f.geometry.dispose();f.mat.dispose()
})
