import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {captureRamp} from '../src/app/captureRamp.ts'
import {passengerArtIndex} from '../../tools/passenger-cards.mjs'

test('authored art ramps use their requested landing dimensions without changing palette defaults',()=>{
 for(const type of ['escalator','stair']){
  const from={x:0,y:0,z:0},to={x:0,y:9,z:5}
  const module={id:type,type,x:0,y:0,z:0,from,to,cfg:type==='stair'?{width:1.6,flights:[{from,to}]}:{dir:'up',incline:30}}
  const before=structuredClone(module),ramp=captureRamp(module,{rise:4,run:7})
  assert.deepEqual(ramp.to,{x:0,y:7,z:4})
  if(type==='stair')assert.deepEqual(ramp.cfg.flights,[{from,to:ramp.to}])
  assert.deepEqual(module,before)
  assert.equal(captureRamp(module),module)
  assert.throws(()=>captureRamp(module,{rise:NaN,run:7}),/Invalid/)
 }
})

test('adjacent art passengers spread across clothing recipes and remain deterministic',()=>{
 const choices=Array.from({length:80},(_,id)=>passengerArtIndex(id,440))
 assert.ok(new Set(choices.map(i=>Math.floor(i/11))).size>25,'queues cannot repeat one outfit across neighbouring bag recipes')
 assert.deepEqual(choices,Array.from({length:80},(_,id)=>passengerArtIndex(id,440)))
 assert.ok(choices.every(i=>i>=0&&i<440))
})

test('sheet capture and layering retain single-floor UI, idle queues and local PSD occlusion',()=>{
 const read=file=>readFileSync(new URL('../../tools/'+file,import.meta.url),'utf8')
 assert.ok(read('render-ui-shots.mjs').includes('st.setGhostOther(false)'))
 assert.ok(read('refresh-model-art.mjs').includes("node('tools/render-piece-elevations.mjs'"))
 assert.ok(read('refresh-model-art.mjs').includes("node('tools/render-piece-views.mjs','--hero'"))
 const queue=read('sheets-e.mjs')
 assert.ok(queue.includes('data-role="queue" data-pose="waiting"'))
 assert.ok(queue.includes('planPerson(0, 0, identity, false'))
 const interchange=read('sheet-13-two-line.mjs')
 assert.ok(interchange.includes('landing: 3300, runs: 3200, concourse: 3000'))
 assert.ok(interchange.includes('mask="url(#interchange-psd-occlusion)"'))
 assert.ok(interchange.includes('<use href="#interchange-near-psd"'))
 assert.ok(read('render-piece-elevations.mjs').includes('ramp: {rise:4,run:7}'))
 assert.ok(read('sheets-a.mjs').includes("CORE1 - pieceAt('stair-straight', 0, 0).w - 6"))
})
