import test from 'node:test';
import assert from 'node:assert/strict';
import {spatialMix,sanitizeMix} from '../src/sound-preview/spatial.js';

test('camera height contributes to distance, outer radius is silent, and falloff is monotonic',()=>{
 const camera={x:0,y:0,z:0,bearing:0};
 assert.equal(spatialMix(camera,camera).gain,1);
 assert.equal(spatialMix(camera,{x:0,y:8,z:0}).distance,8);
 assert.equal(spatialMix(camera,{x:0,y:16,z:0}).gain,.5);
 assert.equal(spatialMix(camera,{x:100,y:0,z:0}).gain,0);
 let previous=1;
 for(let distance=0;distance<=150;distance++){
  const {gain,pan}=spatialMix(camera,{x:distance,y:0,z:0});
  assert.ok(gain<=previous && gain>=0);assert.ok(Number.isFinite(pan));previous=gain;
 }
});
test('camera bearing reverses left/right and directly above stays centered',()=>{
 const source={x:10,y:0,z:0};
 assert.equal(spatialMix({x:0,y:0,z:0,bearing:0},source).pan,1);
 assert.equal(spatialMix({x:0,y:0,z:0,bearing:Math.PI},source).pan,-1);
 assert.equal(spatialMix({x:10,y:10,z:0,bearing:Math.PI/2},source).pan,0);
});
test('stored mixer state clamps volume and rejects invalid settings',()=>{
 const mix=sanitizeMix({master:{enabled:false,volume:4},effects:{enabled:'false',volume:NaN},ambience:{volume:-2}});
 assert.deepEqual(mix.master,{enabled:false,volume:1});
 assert.deepEqual(mix.effects,{enabled:true,volume:.65});
 assert.equal(mix.ambience.volume,0);assert.equal(Object.keys(mix).length,6);
});
