import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSkinInterval} from '../src/candidate-illustration.js';

function limb(start,end,{noise=false}={}){
 const samples=[];
 for(let bin=0;bin<40;bin++)for(let sample=0;sample<12;sample++){
  const progress=(bin+.25+sample/24)/40*1.1;
  let skin=progress>=start&&progress<end;
  if(noise&&sample<2)skin=!skin;
  samples.push({progress,skin});
 }
 return samples;
}
test('texture speckles do not move an otherwise continuous short sleeve boundary',()=>{
 const clean=fitSkinInterval(limb(.33,1.1),[1,1.1]);
 const noisy=fitSkinInterval(limb(.33,1.1,{noise:true}),[1,1.1]);
 assert.deepEqual(noisy,clean);assert(Math.abs(clean[0]-.33)<.03);
});
test('shorts and boots retain a single exposed-leg interval',()=>{
 const result=fitSkinInterval(limb(.38,.82,{noise:true}),[1,1.1]);
 assert(Math.abs(result[0]-.38)<.03);assert(Math.abs(result[1]-.82)<.03);
});
test('covered limbs cannot acquire scattered skin holes from isolated texture pixels',()=>{
 const samples=limb(2,3,{noise:true});
 assert.deepEqual(fitSkinInterval(samples,[1.03,1.04]),[1.03,1.04]);
});
