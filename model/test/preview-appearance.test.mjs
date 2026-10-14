import test from 'node:test';
import assert from 'node:assert/strict';
import {appearanceSizeRanges,constrainAppearance,previewScale,randomAppearance,sizePercent} from '../src/preview-appearance.js';
import {MODEL_LIBRARY,modelEligible} from '../src/characters/library.js';

test('preview bounds switch by age, clamp old URLs and reset to their midpoint',()=>{
 for(const age of ['adult','child']){
  assert.deepEqual(appearanceSizeRanges(age).height,[.8,1.2]);
  for(const axis of ['width','depth']){
   assert.deepEqual(appearanceSizeRanges(age)[axis],age==='child'?[.8,.9]:[.9,1.1]);
   assert.equal(sizePercent(axis,-100,age),age==='child'?80:90);
   assert.equal(sizePercent(axis,999,age),age==='child'?90:110);
   for(const value of [null,undefined,'invalid',Infinity])assert.equal(sizePercent(axis,value,age),age==='child'?85:100);
  }
  assert.equal(sizePercent('height',99.7,age),100);
 }
});

test('age changes allow only small/crossbody bags for children and preserve height',()=>{
 for(const model of MODEL_LIBRARY){
  const state={...model,age:'child',size:{height:117,width:110,depth:100}};
  constrainAppearance(state);
  assert.equal(state.bag,model.bag&&(model.bagStyle==='small'||model.bagType==='crossbody'));assert.notEqual(state.hair,'bald');
  assert.deepEqual(state.size,{height:117,width:90,depth:90});
  assert(MODEL_LIBRARY.some(m=>m.character===state.character&&m.hair===state.hair&&m.bag===state.bag&&(!m.bag||m.bagStyle===state.bagStyle)&&modelEligible(m,'child')));
 }
 const adult={age:'adult',hair:'long',bag:true,size:{height:100,width:85,depth:80}};
 constrainAppearance(adult);assert.equal(adult.bag,false);assert.deepEqual(adult.size,{height:100,width:90,depth:90});
});

test('preview scale maps width/height/depth to the GLB axes at each age base',()=>{
 assert.deepEqual(previewScale({age:'adult',size:{height:120,width:90,depth:110}}),[.9,1.2,1.1]);
 const child=previewScale({age:'child',size:{height:80,width:80,depth:90}});
 for(const [i,expected] of [.56,.52,.63].entries())assert(Math.abs(child[i]-expected)<1e-10);
});

test('random previews preserve the 20/80 population and choose equally within each model pool',()=>{
 let seed=1234567,children=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32},counts=new Map();
 for(let i=0;i<120000;i++){
  const state=randomAppearance(random),child=state.age==='child';
  if(child){children++;assert(!state.bag||state.bagStyle==='small'||state.bagStyle.startsWith('crossbody-'));assert.notEqual(state.hair,'bald')}
  const model=MODEL_LIBRARY.find(m=>m.character===state.character&&m.hair===state.hair&&m.bag===state.bag&&(!m.bag||(m.bagStyle??'standard')===state.bagStyle));
  assert(model&&modelEligible(model,state.age));const key=`${state.age}:${model.id}`;counts.set(key,(counts.get(key)??0)+1);
  assert(state.size.height>=80&&state.size.height<=120);
  for(const axis of ['width','depth'])assert(child?state.size[axis]>=80&&state.size[axis]<=90:state.size[axis]>=90&&state.size[axis]<=110);
 }
 assert(children>23500&&children<24500);
 for(const age of ['adult','child']){
  const pool=MODEL_LIBRARY.filter(m=>modelEligible(m,age));
  const mean=(age==='child'?children:120000-children)/pool.length;
  for(const model of pool)assert(Math.abs(counts.get(`${age}:${model.id}`)-mean)<mean*.1,`${age} ${model.id} stays equally selectable`);
 }
 const atChance=randomAppearance(()=>.2);assert.equal(atChance.age,'adult','the 20% child interval ends at .2');
 const atZero=randomAppearance(()=>0);assert.equal(atZero.age,'child');assert.deepEqual(atZero.size,{height:80,depth:80,width:80});
});

test('side bags obey adult sex rules, child rules and long-hair compatibility',()=>{
 assert.equal(MODEL_LIBRARY.length,56);
 assert.equal(MODEL_LIBRARY.filter(m=>m.adultEligible).length,50);
 assert.equal(MODEL_LIBRARY.filter(m=>m.childEligible).length,19);
 for(const character of ['male','female'])for(const age of ['adult','child'])for(const style of ['shoulder-left','shoulder-right','crossbody-left','crossbody-right','purse-left','purse-right','small']){
  const state={age,character,hair:character==='male'?'short':'bob',bag:true,bagStyle:style,size:{height:100,width:100,depth:100}};
  constrainAppearance(state);
  const allowed=age==='child'?style==='small'||style.startsWith('crossbody-'):style.startsWith('purse-')?character==='female':style.startsWith('crossbody-')?character==='male':true;
  assert.equal(state.bag,allowed,`${age}/${character}/${style}`);
 }
 for(const [age,style] of [['adult','shoulder-left'],['adult','purse-right'],['child','crossbody-left']]){
  const state={age,character:'female',hair:'long',bag:true,bagStyle:style,size:{height:100,width:100,depth:100}};constrainAppearance(state);assert(state.bag);assert.equal(state.hair,'long');
 }
});
