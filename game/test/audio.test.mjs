import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {actionSound} from '../src/app/audioActions.ts'
import {sanitizeAudioVolumes,readAudioVolumes,setAudioVolume,getAudioVolumes,audioAssetBase} from '../src/app/audioSettings.ts'
import {sourceMix,crowdSound} from '../src/render/audioScene.ts'
import {GameAudio} from '../src/app/gameAudio.ts'
import {gameAmbientPolicy} from '../src/app/ambientPlayback.ts'

const state={version:1,tool:'block',notice:null,moveDraft:null,pickDraft:null,selected:null}
test('approved ambient policies keep voices natural, accelerate light traffic and skip fast train/traffic samples',()=>{
 for(const speed of [1,4,16,64]){
  assert.deepEqual(gameAmbientPolicy('crowd',speed),{mode:'loop',rate:1,speed})
  assert.deepEqual(gameAmbientPolicy('train',speed),{mode:speed>1?'skip':'loop',rate:1,speed})
  assert.deepEqual(gameAmbientPolicy('traffic',speed),{mode:speed>=16?'skip':'loop',rate:speed>=16?1:speed,speed})
 }
})
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
 assert.match(frame,/this\.audioSpeed>1\?33:100/)
 assert.match(frame,/if\(this\.onAudioFrame/)
})

test('audio service bounds voices, releases muted beds, cancels late decodes and suspends hidden tabs',async(t)=>{
 const keys=['AudioContext','document','window','location','fetch'],original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]))
 const requests=[],nodes=[];let clock=0,finishDecode=null
 const param=()=>({value:0,setTargetAtTime(value){this.value=value},setValueAtTime(value){this.value=value},linearRampToValueAtTime(value){this.value=value}})
 const node=()=>({gain:param(),pan:param(),playbackRate:param(),threshold:param(),ratio:param(),loop:false,
  connect(){return this},disconnect(){},start(...args){this.startArgs=args},stop(time){if(time===undefined)this.onended?.()}})
 class Context {
  state='suspended';currentTime=0;destination={}
  createGain(){return node()}createStereoPanner(){return node()}createDynamicsCompressor(){return node()}
  createBufferSource(){const source=node();nodes.push(source);return source}
  async resume(){this.state='running'}async suspend(){this.state='suspended'}
  decodeAudioData(){return finishDecode?new Promise(resolve=>{finishDecode=resolve}):Promise.resolve({duration:30})}
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
  assert.ok([...audio.beds.values()].every(v=>v.level.gain.value>0))
  const crowd=[...audio.beds.get('crowd').nodes][0]
  for(const speed of [4,16,64]){
   audio.updateScene({...frame,speed})
   assert.equal([...audio.beds.get('crowd').nodes][0],crowd,'speed changes keep the 1× passenger recording uninterrupted')
   const train=[...audio.beds.get('train').nodes],traffic=[...audio.beds.get('traffic').nodes]
   assert.equal(train.length,2,'fast trains use overlapping sample slices')
   assert.ok(train.every(source=>source.playbackRate.value===1),'train slices keep natural pitch')
   assert.ok(Math.abs(train[1].startArgs[1]-.105*speed)<1e-9,'train slices advance through simulation time')
   assert.equal(traffic.length,speed===4?1:2)
   assert.ok(traffic.every(source=>source.playbackRate.value===(speed===4?4:1)))
  }
  audio.updateScene({...frame,speed:1})
  assert.equal(audio.beds.get('train').nodes.size,1,'normal speed restores one uninterrupted train loop')
  audio.updateScene({...frame,speed:64,sources:frame.sources.filter(source=>source.kind!=='train')})
  assert.equal(audio.beds.get('train').level.gain.value,0,'the train leaving the live scene silences all its grains')
  setAudioVolume('ambient',0);assert.equal(audio.beds.size,0);assert.equal(audio.voices.size,0)
  setAudioVolume('ambient',.45)
  audio.cache.delete('train.mp3');finishDecode=true
  audio.updateScene({...frame,speed:1,sources:[frame.sources[1]]});await settle()
  audio.updateScene({...frame,speed:16,sources:[frame.sources[1]]})
  finishDecode({duration:30});await settle()
  assert.equal(audio.beds.get('train').nodes.size,2,'a late decode uses the latest sample-skipping policy')
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
