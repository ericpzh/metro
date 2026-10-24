import test from 'node:test';
import assert from 'node:assert/strict';
import {AmbientVoice,ambientPolicy,defaultTactics,sanitizeTactics,trainPass,SPEEDS} from '../src/sound-preview/ambient.js';

test('audition tactics preserve pitch for slices and default to the approved per-layer game mix',()=>{
 const defaults=defaultTactics();
 for(const speed of SPEEDS){
  assert.equal(ambientPolicy('natural',speed).rate,1);
  assert.equal(ambientPolicy('cap2',speed).rate,Math.min(2,speed));
  assert.equal(ambientPolicy('rate',speed).rate,speed);
  assert.equal(ambientPolicy('skip',speed).rate,1);
  assert.equal(defaults.crowd[speed],'natural');
  assert.equal(defaults.train[speed],speed>1?'skip':'natural');
  assert.equal(defaults.traffic[speed],speed>=16?'skip':'rate');
 }
 const stored=sanitizeTactics({train:{4:'skip',16:'invalid'},crowd:{64:'natural'}});
 assert.equal(stored.train[4],'skip');assert.equal(stored.train[16],'skip');assert.equal(stored.crowd[64],'natural');
 assert.deepEqual(ambientPolicy('rate',Infinity),{mode:'loop',rate:1,speed:1});
});
test('accelerated train passes enter and leave with a real silent gap; holding the train freezes its spatial envelope',()=>{
 assert.equal(trainPass(0).gain,0);assert.equal(trainPass(24).x,0);
 assert.equal(trainPass(24).gain,1);assert.equal(trainPass(48).gain,0);
 assert.equal(trainPass(63).gain,0);assert.equal(trainPass(64).x,-155);
 for(const speed of SPEEDS)assert.equal(trainPass(48/speed*speed).gain,0);
 assert.deepEqual(trainPass(60,false),{x:0,gain:1,phase:'Held at platform'});
});
function harness(){
 const sources=[];
 const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){}});
 const node=()=>({gain:param(),pan:param(),connect(){return this;},disconnect(){this.disconnected=true;}});
 const context={currentTime:0,createGain:node,createStereoPanner:node,createBufferSource(){
  const source={...node(),playbackRate:param(),start(...args){this.args=args;},stop(time){if(time===undefined){this.ended=true;this.onended?.();}else this.end=time;}};
  sources.push(source);return source;
 }};
 function advance(time){context.currentTime=time;for(const source of sources)if(!source.ended&&source.end<=time){source.ended=true;source.onended?.();}}
 return {context,sources,advance};
}
test('64× sample skipping advances through the recording at original pitch, with bounded slices after a stalled frame',()=>{
 const {context,sources,advance}=harness();
 const voice=new AmbientVoice(context,{duration:30},{},ambientPolicy('skip',64));
 assert.equal(sources.length,2);assert.equal(sources[0].playbackRate.value,1);
 assert.ok(Math.abs(sources[1].args[1]-6.72)<1e-9,'105 ms of wall time skips 6.72 s through the source');
 for(let i=1;i<120;i++){
  advance(i/30);voice.tick();assert.ok(voice.nodes.size<=3,'scheduled and fading grains stay bounded');
 }
 const before=sources.length;advance(100);voice.tick();assert.ok(sources.length-before<=3,'a stalled frame cannot replay a backlog');
 voice.stop();assert.equal(voice.nodes.size,0);assert.ok(voice.level.disconnected&&voice.pan.disconnected);
 const stopped=sources.length;voice.tick();assert.equal(sources.length,stopped,'Stop all cannot resurrect grains');
});
test('changing tactics releases the previous sources, and mute allocates no player',()=>{
 const {context,sources}=harness();
 const voice=new AmbientVoice(context,{duration:30},{},ambientPolicy('rate',16));
 assert.equal(sources[0].playbackRate.value,16);
 voice.setPolicy(ambientPolicy('mute',16));assert.equal(voice.nodes.size,0);assert.equal(sources.length,1);
 voice.setPolicy(ambientPolicy('natural',16));assert.equal(sources.at(-1).playbackRate.value,1);
 voice.stop();
});
