import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,statSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {GameMusic} from '../src/app/gameMusic.ts'
import {MUSIC_TRACKS} from '../src/app/musicTracks.ts'
import {setAudioVolume} from '../src/app/audioSettings.ts'

test('approved full recordings retain licenses, credits and hashes within the asset limit',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../public/audio/music/manifest.json',import.meta.url)))
 assert.equal(manifest.length,8)
 for(const track of MUSIC_TRACKS){
  const entry=manifest.find(e=>e.file===track.file)
  assert.equal(entry.source,track.source);assert.equal(entry.license,track.license)
  assert.ok(track.credit.includes(track.author));assert.ok(track.licenseUrl.startsWith('https://creativecommons.org/'))
  const file=new URL('../public/audio/music/'+track.file,import.meta.url)
  assert.ok(statSync(file).size<25*1024*1024)
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),entry.sha256)
  assert.match(entry.changes,/Full recording/)
 }
})

test('music streams one element, retains pause position, rotates, mutes, and cancels hidden/late playback',async()=>{
 const keys=['Audio','document','window','location','localStorage'],original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]))
 const elements=[],storage=new Map();let finish
 class Media {
  paused=true;volume=1;currentTime=0;src='';preload=''
  constructor(){elements.push(this)}
  play(){this.paused=false;return new Promise(resolve=>{finish=resolve})}
  pause(){this.paused=true}
 }
 try{
  Object.assign(globalThis,{Audio:Media,document:Object.assign(new EventTarget(),{hidden:false}),window:new EventTarget(),location:{pathname:'/game/en/tanwei',origin:'https://example.test'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}})
  setAudioVolume('music',.25)
  const music=new GameMusic(),unmount=music.mount()
  assert.equal(elements.length,0,'no audio fetch before a real gesture')
  window.dispatchEvent(new Event('pointerdown'))
  const player=elements[0];assert.equal(elements.length,1);assert.equal(player.volume,.25)
  assert.equal(player.src,'https://example.test/game/audio/music/dream-culture.mp3')
  player.currentTime=42;music.toggle();finish();await Promise.resolve()
  assert.equal(player.paused,true);assert.equal(storage.get('metro-game.music-paused'),'true')
  window.dispatchEvent(new Event('keydown'));assert.equal(player.paused,true,'unrelated gestures do not undo explicit pause')
  music.toggle();finish();await Promise.resolve();assert.equal(player.currentTime,42)
  setAudioVolume('music',0);assert.equal(player.paused,true)
  setAudioVolume('music',.4);assert.equal(player.volume,.4);assert.equal(player.paused,false)
  for(let i=0;i<8;i++)player.onended()
  assert.equal(music.getSnapshot().track,0);assert.equal(elements.length,1)
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));finish();await Promise.resolve();assert.equal(player.paused,true)
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(player.paused,true)
  window.dispatchEvent(new Event('pointerdown'));assert.equal(player.paused,false)
  player.onerror();assert.equal(music.getSnapshot().unavailable,true);music.toggle();finish();await Promise.resolve();assert.equal(music.getSnapshot().unavailable,false)
  unmount();finish();await Promise.resolve();assert.equal(player.paused,true)
  music.toggle();assert.equal(player.paused,true,'unmounted service cannot start')
 }finally{
  for(const key of keys){const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
  setAudioVolume('music',.25)
 }
})
