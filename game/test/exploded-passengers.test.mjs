import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'

for (const teleport of [false,true]) {
  test(`storey transitions ${teleport?'teleport in exploded view':'interpolate in the base game'}`, () => {
    const ctx={scene:new THREE.Scene(),mats:{blob:new THREE.MeshBasicMaterial()},activeZ:0,levelBase:0,storeyHeight:5,ghost:true,hideUI:true,stateIntervalMs:1000}
    const crowd=new CrowdSystem(ctx)
    crowd.teleportBetweenStoreys=teleport
    const frame=(x,y,z)=>new Float32Array([x,y,z,0,0,7])
    crowd.setAgents(frame(2,3,-9),1,1000)
    crowd.setAgents(frame(4,5,-9),1,1000)
    assert.deepEqual([...crowd.prev.subarray(0,3)],[2,3,-9],'same-floor walking stays interpolated')
    crowd.setAgents(frame(4,45,-4),1,1000)
    assert.deepEqual([...crowd.prev.subarray(0,3)],teleport?[4,45,-4]:[4,5,-9])
    crowd.dispose()
    ctx.mats.blob.dispose()
  })
}

test('exploded transfers teleport by source floor even when dragged trays share the same displayed height',()=>{
  const ctx={scene:new THREE.Scene(),mats:{blob:new THREE.MeshBasicMaterial()},activeZ:0,levelBase:0,storeyHeight:5,ghost:true,hideUI:true,stateIntervalMs:1000}
  const crowd=new CrowdSystem(ctx);crowd.teleportBetweenStoreys=true
  const frame=(x,y,z,id=7)=>new Float32Array([x,y,z,0,0,id])
  crowd.setAgents(frame(2,3,1),1,1000,new Map([[7,-10]]))
  crowd.setAgents(frame(4,5,1),1,1000,new Map([[7,-10]]))
  assert.deepEqual([...crowd.prev.subarray(0,3)],[2,3,1],'walking on a tray remains smooth')
  crowd.setAgents(frame(40,55,1),1,1000,new Map([[7,-5]]))
  assert.deepEqual([...crowd.prev.subarray(0,3)],[40,55,1],'no interpolation through the dashed connection gap')
  for(const alpha of [.1,.5,.9])for(let axis=0;axis<3;axis++)assert.equal(crowd.prev[axis]+(crowd.cur[axis]-crowd.prev[axis])*alpha,crowd.cur[axis])
  crowd.dispose();ctx.mats.blob.dispose()
})

test('opposing transfers stay teleported through ID reordering and disappearing passengers',()=>{
 const ctx={scene:new THREE.Scene(),mats:{blob:new THREE.MeshBasicMaterial()},activeZ:0,levelBase:2,storeyHeight:5,ghost:true,hideUI:true,stateIntervalMs:1000}
 const crowd=new CrowdSystem(ctx);crowd.teleportBetweenStoreys=true
 const frame=(rows)=>new Float32Array(rows.flatMap(([id,x])=>[x,0,3,0,0,id]))
 crowd.setAgents(frame([[7,1],[8,50]]),2,1000,new Map([[7,2],[8,7]]))
 crowd.setAgents(frame([[8,2],[7,51]]),2,1000,new Map([[8,2],[7,7]]))
 assert.deepEqual([...crowd.prev.subarray(0,6)],[2,0,3,51,0,3])
 crowd.setAgents(frame([[7,52]]),1,1000,new Map([[7,7]]))
 assert.deepEqual([...crowd.prev.subarray(0,3)],[51,0,3],'same-floor movement remains interpolated after compaction')
 crowd.setAgents(frame([[8,4],[7,53]]),2,1000,new Map([[8,2],[7,7]]))
 assert.deepEqual([...crowd.prev.subarray(0,6)],[4,0,3,52,0,3],'reappearing passenger starts at its destination')
 crowd.dispose();ctx.mats.blob.dispose()
})

test('base-game movement keeps interpolation even if presentation floor metadata is supplied',()=>{
 const ctx={scene:new THREE.Scene(),mats:{blob:new THREE.MeshBasicMaterial()},activeZ:0,levelBase:0,storeyHeight:5,ghost:true,hideUI:true,stateIntervalMs:1000}
 const crowd=new CrowdSystem(ctx)
 crowd.setAgents(new Float32Array([1,2,3,0,0,7]),1,1000,new Map([[7,-10]]))
 crowd.setAgents(new Float32Array([40,50,3,0,0,7]),1,1000,new Map([[7,-5]]))
 assert.deepEqual([...crowd.prev.subarray(0,3)],[1,2,3])
 crowd.dispose();ctx.mats.blob.dispose()
})

test('reused floor maps and resume snapshots cannot leave a frozen passenger at the old tray',()=>{
 const ctx={scene:new THREE.Scene(),mats:{blob:new THREE.MeshBasicMaterial()},activeZ:0,levelBase:0,storeyHeight:5,ghost:true,hideUI:true,stateIntervalMs:1000}
 const crowd=new CrowdSystem(ctx);crowd.teleportBetweenStoreys=true
 const owners=new Map([[7,-10]]),frame=new Float32Array([40,50,1,0,0,7])
 crowd.setAgents(frame,1,1000,owners)
 const position=new THREE.Vector3(1,2,1)
 crowd.frozen.set(7,{position,yaw:0,pose:[0,0,0,0],activity:[0,0,0,0]})
 crowd.resumeSnapshotPending=true
 owners.set(7,-5)
 crowd.setAgents(frame,1,1000,owners)
 assert.deepEqual(position.toArray(),[40,50,1],'logical-floor transfer updates even an identical displayed resume packet')
 assert.deepEqual([...crowd.prev.subarray(0,3)],[40,50,1])
 crowd.dispose();ctx.mats.blob.dispose()
})
