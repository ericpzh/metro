// Audition choices remain local; the default table follows the approved game mix.
import {ambientTactic} from '../../../game/src/app/ambientPlayback.ts';
export {AmbientVoice} from '../../../game/src/app/ambientPlayback.ts';
export const SPEEDS=[1,4,16,64];
export const TACTICS=[
 {id:'natural',label:'Normal pitch / 1×',detail:'Keep the recording at its original speed.'},
 {id:'cap2',label:'Cap at 2×',detail:'Speed up the recording, but never beyond 2×. Pitch rises too.'},
 {id:'rate',label:'Full speed',detail:'Playback rate matches simulation speed. Pitch rises with it.'},
 {id:'skip',label:'Skip samples / keep pitch',detail:'Play short crossfaded slices at normal pitch, skipping ahead with simulation time.'},
 {id:'mute',label:'Mute',detail:'Silence this layer at this speed.'},
];
export function defaultTactics(){return Object.fromEntries(['crowd','train','traffic'].map(id=>[id,Object.fromEntries(SPEEDS.map(speed=>[speed,ambientTactic(id,speed)]))]));}
export function sanitizeTactics(value){
 const result=defaultTactics();
 for(const id of Object.keys(result))for(const speed of SPEEDS)if(TACTICS.some(t=>t.id===value?.[id]?.[speed]))result[id][speed]=value[id][speed];
 return result;
}
export function ambientPolicy(tactic,speed){
 speed=SPEEDS.includes(speed)?speed:1;
 return {mode:tactic==='mute'?'mute':tactic==='skip'&&speed>1?'skip':'loop',rate:tactic==='rate'?speed:tactic==='cap2'?Math.min(2,speed):1,speed};
}
// A 48 simulated-second pass followed by a 16-second silent gap. Train enters
// from the left, crosses the listener's station, then leaves on the right.
export function trainPass(seconds,moving=true){
 if(!moving)return {x:0,gain:1,phase:'Held at platform'};
 const phase=((seconds%64)+64)%64;
 if(phase>=48)return {x:155,gain:0,phase:'Between trains'};
 return {x:-155+310*phase/48,gain:Math.min(1,phase/3,(48-phase)/3),phase:phase<20?'Arriving':phase<28?'At platform':'Departing'};
}
