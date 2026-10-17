import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStore } from 'zustand/vanilla'
import { detailHeight } from '../src/render/detailPolicy.ts'
import { createViewSlice } from '../src/app/store/slices/ViewSlice.ts'
import { readGraphicsQuality } from '../src/app/graphicsQuality.ts'

test('other storeys reduce even near the camera; Hide UI always restores full visible geometry',()=>{
  assert.equal(detailHeight([0],0,false,'high',800),800)
  assert.equal(detailHeight([-4],0,false,'high',800),0)
  assert.equal(detailHeight([4],0,false,'high',800),0)
  assert.equal(detailHeight([-4,4],0,false,'high',800),800,'spanning the active storey remains current')
  assert.equal(detailHeight([0],0,false,'low',800),0)
  assert.equal(detailHeight(undefined,0,false,'high',800),800)
  for(const quality of ['high','low'])for(const zs of [[0],[-4],[4],undefined])assert.equal(detailHeight(zs,0,true,quality,800),Infinity)
})

test('quality persists separately from station saves and survives unavailable/invalid storage',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}})
  try {
    assert.equal(readGraphicsQuality(),'high')
    const store=createStore((...args)=>({...createViewSlice(...args),version:7,stationEpoch:3}))
    assert.equal(store.getState().graphicsQuality,'high','a fresh store defaults to high with no stored preference')
    store.getState().setGraphicsQuality('low')
    assert.equal(readGraphicsQuality(),'low');assert.equal(store.getState().version,7);assert.equal(store.getState().stationEpoch,3)
    assert.equal(createStore((...args)=>({...createViewSlice(...args),version:7,stationEpoch:3})).getState().graphicsQuality,'low','a reloaded store restores the stored preference')
    store.getState().setGraphicsQuality('high');assert.equal(readGraphicsQuality(),'high')
    values.set('metro-game.graphics-quality','bad');assert.equal(readGraphicsQuality(),'high')
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked')}})
    assert.equal(readGraphicsQuality(),'high');store.getState().setGraphicsQuality('low')
    assert.equal(store.getState().graphicsQuality,'low')
  } finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage}
})

test('settings dropdown owns labelled actions, native opposite language, gear icon and Escape/outside dismissal',()=>{
  const menu=readFileSync(new URL('../src/app/windows/topbar/SettingsMenu.tsx',import.meta.url),'utf8')
  assert.match(menu,/import \{ FaGear \} from 'react-icons\/fa6'/)
  assert.match(menu,/<FaGear aria-hidden="true" \/>/)
  assert.match(menu,/aria-pressed=\{quality === 'low'\}/)
  assert.match(menu,/aria-pressed=\{quality === 'high'\}/)
  assert.match(menu,/language === 'en' \? t\('language_native_chinese'\) : t\('language_native_english'\)/)
  for(const key of ['restart','report_issue'])assert.match(menu,new RegExp(`<span>\\{t\\('${key}'\\)\\}</span>`))
  assert.match(menu,/event.key !== 'Escape'/);assert.match(menu,/contains\(event.target as Node\)/)
  const viewport=readFileSync(new URL('../src/app/Viewport.tsx',import.meta.url),'utf8')
  assert.match(viewport,/new SceneRenderer\(canvas\)\s*scene.setGraphicsQuality\(useStore.getState\(\).graphicsQuality\)/,'persisted quality applies before the first scene build')
})
