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
