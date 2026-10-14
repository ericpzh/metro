import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { passengerIsChild, passengerProportions } from '../src/sim/walking.ts'
import { passengerAppearance, PASSENGER_LIBRARY } from '../src/render/passengerModel.ts'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'

test('passengers have independent height/depth/width variation and a 20% child population', () => {
 let children=0
 const min=[Infinity,Infinity,Infinity],max=[0,0,0],horizontalMin=[[Infinity,Infinity],[Infinity,Infinity]],horizontalMax=[[0,0],[0,0]],widthDepth=new Set(),heights=new Set()
 for(let id=0;id<50000;id++){
  const child=passengerIsChild(id),p=passengerProportions(id)
  if(child)children++
  const size=[p[0]/(child?.65:1),p[1]/(child?.70:1),p[2]/(child?.70:1)]
  assert.ok(size[0]>=.8 && size[0]<=1.2,'height is 80–120% of the age base')
  const age=child?1:0
  for(const axis of [1,2]){
   assert.ok(child ? size[axis]>=.8 && size[axis]<=.9 : size[axis]>=.9 && size[axis]<=1.1,child ? 'child horizontal axes are 80–90%' : 'adult horizontal axes are 90–110%')
   horizontalMin[age][axis-1]=Math.min(horizontalMin[age][axis-1],size[axis])
   horizontalMax[age][axis-1]=Math.max(horizontalMax[age][axis-1],size[axis])
  }
  for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],size[axis]);max[axis]=Math.max(max[axis],size[axis])}
  if(!child){heights.add(p[0]);widthDepth.add(`${Math.floor((p[1]-.9)*50)},${Math.floor((p[2]-.9)*50)}`)}
  const model=PASSENGER_LIBRARY[passengerAppearance(id)[0]];
  if(child){assert(model.childEligible);assert(!model.bag||model.bagStyle==='small'||model.bagType==='crossbody');assert.notEqual(model.hair,'bald')}
  else assert(model.adultEligible);
 }
 assert.ok(children>9750 && children<10250,'20% chance across many independent identities')
 assert.ok(min[0]<.801 && max[0]>1.199,'height covers the requested range')
 for(let axis=0;axis<2;axis++){
  assert.ok(horizontalMin[0][axis]<.901 && horizontalMax[0][axis]>1.099,'adult horizontal axes cover 90–110%')
  assert.ok(horizontalMin[1][axis]<.801 && horizontalMax[1][axis]>.899,'child horizontal axes cover 80–90%')
 }
 assert.equal(widthDepth.size,100,'width and depth vary independently, rather than sharing one scale')
 assert.ok(heights.size>39000,'each adult receives a stable individual size')
 for(const id of [0,7,99,100000,0x7fffffff]){
  const before=passengerAppearance(id),scratch=[0,0,0,0,0]
  passengerAppearance(id+1,scratch)
  assert.equal(passengerAppearance(id,scratch),scratch,'rendering reuses caller storage')
  assert.deepEqual(scratch,before,'another passenger cannot change identity, size or age')
 }
})

test('the crowd applies each size axis to bodies and ground shadows through reordering', () => {
 const ctx={scene:new THREE.Scene(),mats:{blob:new THREE.MeshBasicMaterial()},activeZ:0,levelBase:0,ghost:false,hideUI:true,stateIntervalMs:1000}
 const crowd=new CrowdSystem(ctx)
 const ids=[0,1,2,3,4,5,6,7,8,9]
 const render=entries=>{crowd.setAgents(new Float32Array(entries.flatMap(id=>[id*3,0,0,2,0,id])),entries.length,1000);crowd.renderAgents(ctx.lastStateTime+1000)}
 try{
  for(const order of [ids,ids.toReversed()]){
   render(order)
   for(const [slot,id] of order.entries()){
    const a=passengerAppearance(id),body=new THREE.Matrix4(),shadow=new THREE.Matrix4(),color=new THREE.Color()
    crowd.agents.getMatrixAt(slot,body);crowd.blobs.getMatrixAt(slot,shadow);crowd.agents.getColorAt(slot,color)
    const scale=new THREE.Vector3().setFromMatrixScale(body),footprint=new THREE.Vector3().setFromMatrixScale(shadow)
    assert.ok(scale.distanceTo(new THREE.Vector3(a[2],a[3],a[1]))<1e-6,'length, width and height reach the displayed matrix')
    assert.ok(footprint.distanceTo(new THREE.Vector3(a[2],a[3],1))<1e-6,'child shadows shrink with the body')
    assert.equal(crowd.agents.geometry.getAttribute('passengerOutfit').getX(slot),a[0])
    assert.ok(Math.abs(color.r-a[4])<1e-6,'adding an axis does not turn width into ink tone')
    assert.equal(body.elements[14],0,'resizing preserves the floor origin')
   }
  }
 }finally{crowd.dispose();ctx.mats.blob.dispose()}
})
