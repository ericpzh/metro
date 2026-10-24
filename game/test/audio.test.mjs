import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {actionSound} from '../src/app/audioActions.ts'
import {sanitizeAudioVolumes,readAudioVolumes,setAudioVolume,getAudioVolumes,audioAssetBase} from '../src/app/audioSettings.ts'
import {sourceMix,crowdSound} from '../src/render/audioScene.ts'
import {GameAudio} from '../src/app/gameAudio.ts'

const state={version:1,tool:'block',notice:null,moveDraft:null,pickDraft:null,selected:null}
test('audio asset paths work at root, English/demo routes and deployed /game prefix',()=>{
 for(const path of ['/','/en','/en/','/en/zoo','/tanwei','/lab'])assert.equal(audioAssetBase(path),'/audio/')
 for(const path of ['/game','/game/','/game/en/','/game/en/tanwei','/game/lab'])assert.equal(audioAssetBase(path),'/game/audio/')
})
test('accepted gestures produce one outcome; hover, cancellation and no-op remain silent',()=>{
 assert.equal(actionSound(state,{...state,version:2},0,false),'place')
 assert.equal(actionSound({...state,moveDraft:{}},{...state,version:2},0,false),'move')
 assert.equal(actionSound(state,{...state,version:2},0,true),'delete')
 assert.equal(actionSound(state,{...state,version:2},2,false),'delete')
 assert.equal(actionSound(state,{...state,pickDraft:{},selected:{kind:'module',key:'a'}},0,false),'pick')
 assert.equal(actionSound(state,{...state,selected:{kind:'cell',key:'0,0,0'}},0,false),'select')
 assert.equal(actionSound(state,{...state,notice:'Blocked'},0,false),'refused')
 assert.equal(actionSound({...state,notice:'Blocked'},{...state,notice:'Blocked'},0,false,true),'refused','a repeated refusal must still sound on an actual attempt')
 assert.equal(actionSound({...state,notice:'Blocked'},{...state,notice:'Blocked'},0,false),null,'an unchanged hover notice is silent')
 assert.equal(actionSound({...state,moveDraft:{}},{...state,notice:'Cancelled'},2,false),null)
 assert.equal(actionSound(state,state,0,false),null)
 const selected={...state,selected:{kind:'cell',key:'a'}}
 assert.equal(actionSound(selected,{...selected,selected:{kind:'cell',key:'a'}},0,false),null)
})
test('four local volume preferences clamp, persist, tolerate corrupt/unavailable storage',()=>{
 const original=globalThis.localStorage
 let stored=null
 try{
  globalThis.localStorage={getItem:()=>stored,setItem:(_key,value)=>{stored=value}}
  assert.deepEqual(sanitizeAudioVolumes({master:2,effects:2,ambient:-1}),{master:1,effects:1,ambient:0,music:.25})
  assert.deepEqual(sanitizeAudioVolumes({master:NaN,effects:NaN}),{master:1,effects:.65,ambient:.45,music:.25})
  setAudioVolume('master',.5);setAudioVolume('effects',.23);setAudioVolume('ambient',0)
  assert.deepEqual(readAudioVolumes(),{master:.5,effects:.23,ambient:0,music:.25})
  stored='bad JSON';assert.deepEqual(readAudioVolumes(),{master:1,effects:.65,ambient:.45,music:.25})
  globalThis.localStorage={getItem(){throw Error('denied')},setItem(){throw Error('quota')}}
  setAudioVolume('effects',.4);assert.equal(getAudioVolumes().effects,.4)
  assert.deepEqual(readAudioVolumes(),{master:1,effects:.65,ambient:.45,music:.25})
 }finally{globalThis.localStorage=original;setAudioVolume('master',1);setAudioVolume('effects',.65);setAudioVolume('ambient',.45)}
})
test('native Z-up camera distance and orientation control gain/pan, including finite-radius silence',()=>{
 const source={kind:'train',position:[20,0,0],level:1}
 assert.equal(sourceMix([0,0,0],[1,0,0],source).pan,1)
 assert.equal(sourceMix([0,0,0],[-1,0,0],source).pan,-1)
 assert.ok(sourceMix([0,0,80],[1,0,0],source).gain<sourceMix([0,0,0],[1,0,0],source).gain)
 assert.equal(sourceMix([0,0,300],[1,0,0],source).gain,0)
})
test('large populations require at most 256 position samples and one crowd source',()=>{
 const data=new Float32Array(100000*6);let reads=0
 const buffer=new Proxy(data,{get(target,key){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,target)}})
 const source=crowdSound(buffer,100000,[0,0,20])
 assert.equal(source.kind,'crowd');assert.ok(reads<=256*3);assert.ok(source.level<=.65)
 assert.equal(crowdSound(new Float32Array(),0,[0,0,0]),null)
})
test('approved assets have exactly six effect files and source/license records; settings expose master, effects, ambience and music',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url)))
 assert.deepEqual(manifest.filter(s=>s.file.endsWith('.wav')).map(s=>s.file).sort(),['delete.wav','move.wav','pick.wav','place.wav','refused.wav','select.wav'])
 assert.equal(manifest.length,9)
 for(const asset of manifest){assert.ok(asset.source.license);assert.ok(asset.source.source)}
 const menu=readFileSync(new URL('../src/app/windows/topbar/SettingsMenu.tsx',import.meta.url),'utf8')
 assert.equal((menu.match(/<Slider /g)??[]).length,3)
 assert.match(menu,/<MusicSetting\/>/)
 const frame=readFileSync(new URL('../src/render/scene/SceneRenderer.ts',import.meta.url),'utf8')
 assert.match(frame,/now-this.lastAudioTime>=100/)
 assert.match(frame,/if\(this\.onAudioFrame/)
})

test('audio service bounds voices, releases muted beds, cancels late decodes and suspends hidden tabs',async(t)=>{
 const keys=['AudioContext','document','window','location','fetch'],original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]))
 const requests=[],nodes=[];let clock=0,finishDecode=null
 const param=()=>({value:0,setTargetAtTime(value){this.value=value}})
 const node=()=>({gain:param(),pan:param(),threshold:param(),ratio:param(),loop:false,
  connect(){return this},disconnect(){},start(){},stop(){this.onended?.()}})
 class Context {
  state='suspended';currentTime=0;destination={}
  createGain(){return node()}createStereoPanner(){return node()}createDynamicsCompressor(){return node()}
  createBufferSource(){const source=node();nodes.push(source);return source}
  async resume(){this.state='running'}async suspend(){this.state='suspended'}
  decodeAudioData(){return finishDecode?new Promise(resolve=>{finishDecode=resolve}):Promise.resolve({})}
 }
 try{
  Object.assign(globalThis,{AudioContext:Context,document:Object.assign(new EventTarget(),{hidden:false}),window:new EventTarget(),location:{pathname:'/game/en/',origin:'https://example.test'},fetch:async url=>{requests.push(String(url));return{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}}})
  t.mock.method(performance,'now',()=>clock)
  setAudioVolume('effects',.65);setAudioVolume('ambient',.45)
  const audio=new GameAudio(),unmount=audio.mount()
  document.dispatchEvent(new Event('visibilitychange'));assert.equal(audio.context,null,'no autoplay/context on mount')
  window.dispatchEvent(new Event('pointerdown'))
  const settle=()=>new Promise(resolve=>setImmediate(resolve))
  await settle()
  assert.equal(requests.length,6,'small effect set is decoded once on unlock')
  setAudioVolume('master',.5)
  assert.equal(audio.effects.gain.value,.325)
  assert.equal(audio.ambient.gain.value,.225)
  setAudioVolume('master',0)
  assert.equal(audio.effects.gain.value,0)
  assert.equal(audio.ambient.gain.value,0)
  setAudioVolume('master',1)
  for(let i=0;i<30;i++){clock+=70;audio.play('select');await settle()}
  assert.equal(audio.voices.size,8,'burst cannot exceed the one-shot pool')
  setAudioVolume('effects',0);assert.equal(audio.voices.size,0)
  const frame={position:[0,0,10],right:[1,0,0],sources:['crowd','train','traffic'].map(kind=>({kind,position:[10,0,0],level:.5}))}
  for(let i=0;i<20;i++)audio.updateScene(frame)
  await settle();audio.updateScene(frame)
  assert.equal(audio.beds.size,3);assert.equal(requests.filter(url=>url.endsWith('.mp3')).length,3)
  assert.ok([...audio.beds.values()].every(v=>v.gain.gain.value>0))
  setAudioVolume('ambient',0);assert.equal(audio.beds.size,0);assert.equal(audio.voices.size,0)
  setAudioVolume('ambient',.45)
  audio.cache.delete('crowd.mp3');finishDecode=true
  audio.updateScene({...frame,sources:[frame.sources[0]]});await settle()
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(audio.context.state,'suspended')
  finishDecode({});await settle();assert.equal(audio.voices.size,0,'hidden tab cannot receive a late decoded source')
  unmount();assert.equal(audio.voices.size,0)
 }finally{
  for(const key of keys){const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
  setAudioVolume('master',1);setAudioVolume('effects',.65);setAudioVolume('ambient',.45)
 }
})
