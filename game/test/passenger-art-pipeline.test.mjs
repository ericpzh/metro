import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {passengerCaptureBatches, validatePassengerCaptures} from '../../tools/passenger-capture-plan.mjs'

function fixture(count) {
 const library=Array.from({length:count},(_,i)=>({id:`model-${i}`,sourceSha256:`hash-${i}`})),index=[],cycles=[]
 for(const [variant,model] of library.entries()) for(const view of ['iso','elevation','plan']) {
  for(let sample=0;sample<4;sample++)index.push({variant,model:model.id,sourceSha256:model.sourceSha256,view,sample,walking:sample!==0,file:`${variant}-${view}-still-${sample}`})
  const headings=view==='iso'?8:view==='elevation'?2:1
  for(let heading=0;heading<headings;heading++)for(let sample=0;sample<24;sample++)cycles.push({variant,model:model.id,sourceSha256:model.sourceSha256,view,heading,sample,file:`${variant}-${view}-${heading}-${sample}`})
 }
 return {library,index,cycles}
}

test('bounded capture planning includes every model as the library grows', () => {
 for(const count of [1,11,29,100]) {
  const variants=Array.from({length:count},(_,i)=>i),batches=passengerCaptureBatches(variants)
  assert.deepEqual(batches.flat(),variants)
  assert.ok(batches.every(batch=>batch.length>0 && batch.length<=4))
 }
 assert.throws(()=>passengerCaptureBatches([0],0))
})

test('art capture validation accepts a growing library and rejects missing models or frames', () => {
 for(const count of [1,3,12]) {
  const {index,cycles,library}=fixture(count)
  assert.doesNotThrow(()=>validatePassengerCaptures(index,cycles,library,24))
  assert.throws(()=>validatePassengerCaptures(index.filter(c=>c.variant!==count-1),cycles,library,24),/missing/)
  assert.throws(()=>validatePassengerCaptures(index,cycles.slice(1),library,24),/incomplete/)
 }
})

test('stale game builds and duplicate captured files cannot regenerate model art', () => {
 const {index,cycles,library}=fixture(2)
 assert.throws(()=>validatePassengerCaptures([{...index[0],sourceSha256:'old'},...index.slice(1)],cycles,library,24),/stale game build/)
 assert.throws(()=>validatePassengerCaptures([{...index[0],model:'removed-model'},...index.slice(1)],cycles,library,24),/unknown or stale/)
 assert.throws(()=>validatePassengerCaptures(index,[...cycles,cycles[0]],library,24),/duplicate captured file/)
})

test('the art requires complete child strides and rejects bags or bald child cards', () => {
 const {index,cycles,library}=fixture(3)
 Object.assign(library[0],{bag:false,hair:'short'})
 Object.assign(library[1],{bag:true,hair:'bob'})
 Object.assign(library[2],{bag:false,hair:'bald'})
 const kids=cards=>cards.filter(c=>c.variant===0).map(c=>({...c,age:'child',file:`child-${c.file}`}))
 const stills=[...index,...kids(index)],walks=[...cycles,...kids(cycles)]
 assert.doesNotThrow(()=>validatePassengerCaptures(stills,walks,library,24,true))
 assert.throws(()=>validatePassengerCaptures(index,walks,library,24,true),/missing/)
 assert.throws(()=>validatePassengerCaptures(stills,walks.slice(0,-1),library,24,true),/incomplete/)
 for(const variant of [1,2]){
  const bad={...index.find(c=>c.variant===variant),age:'child',file:'ineligible-child'}
  assert.throws(()=>validatePassengerCaptures([...stills,bad],walks,library,24,true),/ineligible child/)
 }
})


test('capture age pools include child small/crossbody bags and exclude adult female crossbody cards',()=>{
 const {index,cycles,library}=fixture(3)
 Object.assign(library[0],{bag:true,hair:'short',bagStyle:'small',adultEligible:true,childEligible:true})
 Object.assign(library[1],{bag:true,hair:'bob',bagType:'crossbody',adultEligible:false,childEligible:true})
 Object.assign(library[2],{bag:true,hair:'long',bagType:'purse',adultEligible:true,childEligible:false})
 const adult=cards=>cards.filter(c=>c.variant!==1),kids=cards=>cards.filter(c=>c.variant!==2).map(c=>({...c,age:'child',file:`child-${c.file}`}))
 const stills=[...adult(index),...kids(index)],walks=[...adult(cycles),...kids(cycles)]
 assert.doesNotThrow(()=>validatePassengerCaptures(stills,walks,library,24,true))
 assert.throws(()=>validatePassengerCaptures([...stills,{...index.find(c=>c.variant===1),file:'adult-crossbody'}],walks,library,24,true),/ineligible adult/)
 assert.throws(()=>validatePassengerCaptures([...stills,{...index.find(c=>c.variant===2),age:'child',file:'child-purse'}],walks,library,24,true),/ineligible child/)
})

test('the repeatable command refreshes exactly the five requested sheets and only sheet 07 UI', () => {
 const script=readFileSync(new URL('../../tools/refresh-model-art.mjs',import.meta.url),'utf8')
 assert.ok(script.includes("node('tools/gen-art.mjs','01','02','07','12','13','--en')"))
 assert.ok(script.includes("'--sheet','07'"))
 assert.ok(!script.includes('render-view-shots.mjs'))
 assert.ok(script.includes('PASSENGER_CARDS_DIR') && script.includes('UI_SHOTS_EN_DIR'))
 const ui=readFileSync(new URL('../../tools/render-ui-shots.mjs',import.meta.url),'utf8')
 assert.ok(ui.includes("SHOTS.filter(shot => shot.id === 'played')"))
})
