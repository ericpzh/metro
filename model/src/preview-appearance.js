import {MODEL_LIBRARY,isBackpack,modelEligible} from './characters/library.js';
import {supportsBackpack} from './characters/hairstyles.js';
import {PASSENGER_CHILD_CHANCE, PASSENGER_CHILD_SCALE, PASSENGER_CHILD_SIZE_VARIATION, PASSENGER_SIZE_VARIATION} from '../../game/src/sim/constants.ts';

export const sizeRanges=PASSENGER_SIZE_VARIATION;
export const appearanceSizeRanges=age=>age==='child'?{...sizeRanges,...PASSENGER_CHILD_SIZE_VARIATION}:sizeRanges;
export function sizePercent(axis,value,age='adult'){
 const [min,max]=appearanceSizeRanges(age)[axis].map(v=>Math.round(v*100)),number=Number(value);
 return Number.isFinite(number)&&value!==null?Math.max(min,Math.min(max,Math.round(number))):(min+max)/2;
}
export function constrainAppearance(state){
 if(state.age==='child'){
  if(state.hair==='bald')state.hair='short';
 }
 state.bagStyle??='standard';
 if(!supportsBackpack(state.character??'female',state.hair)&&state.bag&&isBackpack(state.bagStyle))state.bag=false;
 if(state.bag&&!MODEL_LIBRARY.some(model=>model.character===(state.character??'female')&&model.hair===state.hair&&model.bagStyle===state.bagStyle&&modelEligible(model,state.age))){
  // Legacy standard entries omit bagStyle; all restricted combinations clear
  // the bag rather than silently selecting a bag the user did not request.
  if(state.bagStyle!=='standard'||state.age==='child')state.bag=false;
 }
 for(const axis of Object.keys(sizeRanges))state.size[axis]=sizePercent(axis,state.size[axis],state.age);
}
// GLB/viewer axes are Y-up: width X, height Y, fore/aft depth Z.
export function previewScale(state){
 const base=state.age==='child'?PASSENGER_CHILD_SCALE:{height:1,width:1,depth:1};
 return [state.size.width/100*base.width,state.size.height/100*base.height,state.size.depth/100*base.depth];
}
export function randomAppearance(random=Math.random){
 const age=random()<PASSENGER_CHILD_CHANCE?'child':'adult';
 const pool=MODEL_LIBRARY.filter(model=>modelEligible(model,age));
 const model=pool[Math.floor(random()*pool.length)],size={};
 for(const [axis,range] of Object.entries(appearanceSizeRanges(age))){
  const [min,max]=range.map(v=>Math.round(v*100));
  size[axis]=min+Math.floor(random()*(max-min+1));
 }
 return {age,character:model.character,hair:model.hair,bag:model.bag,bagStyle:model.bagStyle??'standard',outfit:model.outfit??'original',swapTones:model.swapTones??false,size};
}
