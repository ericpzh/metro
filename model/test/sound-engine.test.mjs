import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundEngine} from '../src/sound-preview/audio.js';

function harness() {
 const engine=new SoundEngine();
 const node=()=>({gain:{value:0},pan:{value:0},connect(){return this;},disconnect(){},start(){},stop(){this.onended?.();}});
 engine.context={createBufferSource:node,createGain:node,createStereoPanner:node};
 engine.buses={effects:node(),crowd:node()};
 engine.load=async()=>({});
 return engine;
}
test('bursts stay within eight one-shots and release their audio nodes',async()=>{
 const engine=harness();
 await Promise.all(Array.from({length:30},()=>engine.play('click')));
 assert.equal(engine.voices.size,8);
 engine.voices.values().next().value.source.stop();
 assert.equal(engine.voices.size,7);
 assert.ok(await engine.play('click'));
 engine.stop();assert.equal(engine.voices.size,0);
});
test('stop during a cold decode prevents the late source from starting',async()=>{
 const engine=harness();let finish;
 engine.load=()=>new Promise(resolve=>{finish=resolve;});
 const playing=engine.play('slow.mp3','crowd',{loop:true});
 engine.stop();finish({});
 assert.equal(await playing,null);
 assert.equal(engine.voices.size,0);
});
