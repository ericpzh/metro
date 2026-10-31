import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { bindArtwork, prepareArtwork } from '../src/render/artwork.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CITY_STYLE_IDS, lineColourFor, SHENZHEN_LINE_COLOURS } from '../src/sim/cityStyles.ts'
import { toState, toData, cloneState } from '../src/build/model.ts'
import { defaultLine } from '../src/build/rail.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { populationEdit, applyPopulationEdit } from '../src/sim/populationEdit.ts'
import { useStore } from '../src/app/store.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { exitHeaderCanvas } from '../src/render/models/pieces/ExitModel.ts'
import { refreshCityTrainMark } from '../src/render/cityBranding.ts'
import { presentationKeepIds } from '../src/render/presentationEdit.ts'
import { getLanguage, setLanguage } from '../src/sim/i18n.ts'

const fixture = () => toState({ name: '光明', nameEn: 'Guangming', seed: 1, cells: [], modules: [], lines: [defaultLine('6', 'up', 'third-rail')] })

test('city identity round-trips, old and unknown saves default to Guangzhou', () => {
  for (const cityStyle of CITY_STYLE_IDS) {
    const state = { ...fixture(), cityStyle }
    assert.equal(toData(state).cityStyle, cityStyle)
    assert.equal(cloneState(state).cityStyle, cityStyle)
    assert.equal(JSON.parse(serialize(state)).city, cityStyle)
    assert.equal(parse(serialize(state)).state.cityStyle, cityStyle)
  }
  const doc = JSON.parse(serialize(fixture()))
  for (const value of [undefined, null, 'unknown', {}, '__proto__']) {
    doc.city = value
    assert.equal(parse(JSON.stringify(doc)).state.cityStyle, 'guangzhou')
  }
})

test('city switch is one undoable presentation patch, all existing colours survive', () => {
  const previous = useStore.getState(), before = fixture()
  before.lines.push({ ...defaultLine('2', 'down', 'third-rail'), colour: '#123456' })
  try {
    useStore.setState({ station: before, past: [], future: [], version: 0, geometryVersion: 0 })
    useStore.getState().setCityStyle('shenzhen')
    const after = useStore.getState().station
    assert.equal(after.cityStyle, 'shenzhen')
    assert.equal(after.lines[0].colour, before.lines[0].colour)
    assert.equal(after.lines, before.lines)
    assert.equal(after.lines[1].colour, '#123456')
    assert.equal(after.cells, before.cells)
    assert.equal(after.modules, before.modules)
    assert.equal(useStore.getState().geometryVersion, 0, 'city never dirties chunk geometry')
    assert.equal(useStore.getState().past.length, 1)
    const patch = populationEdit(before, after)
    assert.ok(patch.station)
    assert.deepEqual(applyPopulationEdit(before, patch), after)
    useStore.getState().setCityStyle('shenzhen')
    assert.equal(useStore.getState().past.length, 1, 'same choice is a no-op')
    useStore.getState().undo()
    assert.equal(useStore.getState().station, before)
    useStore.getState().redo()
    assert.equal(useStore.getState().station, after)
    useStore.getState().addLine()
    assert.equal(useStore.getState().station.lines.at(-1).colour, '#00a2e1', 'new line uses Shenzhen palette')
  } finally { useStore.setState(previous) }
})

test('all supplied Shenzhen line colours, including 6B and planned lines, reach line defaults', () => {
  const expected = ['00ab39','db6d1c','00a2e1','dc241f','9950b2','3abca8','0035ad','db6d1c','846e74','f8779e','6a1d44','a192b2','de7c00','f2c75c','76b900','1e22aa','c6afd4','034ea2','bb16a3','88dbdf','bbbbbb','fbe122']
  expected.forEach((colour, i) => assert.equal(defaultLine(String(i+1), 'up', 'third-rail', 5, 'shenzhen').colour, '#'+colour))
  for (const [id, colour] of Object.entries({ '6B':'#037776', '24':'#79abde', '25':'#fead77', '27':'#3c8065', '29':'#9f2f47', '32':'#ba5801' })) assert.equal(lineColourFor(id,'shenzhen'),colour)
  assert.equal(Object.keys(SHENZHEN_LINE_COLOURS).length, 28)
  assert.equal(lineColourFor('1'), '#edcf3b')
  assert.equal(lineColourFor('unknown', 'shenzhen'), '#2f7ef2')
})

test('the first automatically-created rail line uses the saved city', () => {
  const previous = useStore.getState()
  try {
    useStore.setState({ station: { ...fixture(), cityStyle:'shenzhen', lines:[] }, past:[],future:[],railLineId:'' })
    useStore.getState().layTrack([0,0,0])
    assert.equal(useStore.getState().station.lines[0]?.colour,'#00ab39')
  } finally { useStore.setState(previous) }
})

test('Shenzhen entrance prints navy, white identity, station names and actual line badges', () => {
  const old = globalThis.document, language = getLanguage()
  try {
    for (const [width,locale] of [[512,'zh-CN'],[1024,'en']]) {
      setLanguage(locale)
      const { g, ops } = stubCanvas(width,96)
      globalThis.document = { createElement: () => ({ getContext: () => g }) }
      exitHeaderCanvas('光明站','C1口','Guangming Station',width,{cityStyle:'shenzhen',lines:[defaultLine('6','up','third-rail',5,'shenzhen')]})
      assert.equal(ops.filled[0], '#101b2b')
      for (const text of ['C1','光明站','Guangming Station','6','号线','Line 6']) assert.ok(ops.texts.includes(text), text)
      assert.ok(ops.filled.includes('#3abca8'))
      assert.ok(!ops.texts.includes('广州地铁'))
      assert.ok(!ops.texts.includes('入口'), 'reference uses the exit letter beside a train icon')
      const chinese = ops.words.find(w=>w.text==='光明站'), english = ops.words.find(w=>w.text==='Guangming Station')
      assert.equal(chinese.x,english.x); assert.ok(english.y>chinese.y)
    }
  } finally { globalThis.document = old;setLanguage(language) }
})

test('Shenzhen entrance badges follow line recolouring through the retained artwork path', () => {
  const before = { ...fixture(), cityStyle: 'shenzhen', modules: [{ id:'exit',type:'exit',x:0,y:0,z:0,w:1,h:1,cfg:{name:'C',inRate:10,style:'doorway'} }] }
  const after = { ...before, lines: before.lines.map(l=>({...l,colour:'#123456'})) }
  const edit = populationEdit(before,after)
  assert.ok(edit)
  assert.ok(!presentationKeepIds(before,after,edit).has('exit'),'line-colour edits must repaint the entrance badge')
})

test('cab emblem repaints one existing texture, no geometry or texture replacement on switch', () => {
  const { g, ops } = stubCanvas(128,150)
  const canvas = { width:128,height:150,getContext:()=>g }
  const map = new THREE.CanvasTexture(canvas), material = new THREE.MeshBasicMaterial({map,transparent:true})
  refreshCityTrainMark(material,'shenzhen')
  assert.ok(ops.filled.every(c=>c==='#009943'))
  const version = map.version
  refreshCityTrainMark(material,'shenzhen')
  assert.equal(map.version,version,'unchanged identity does no upload')
  refreshCityTrainMark(material,'guangzhou')
  assert.equal(material.map,map);assert.equal(map.image,canvas)
  assert.ok(map.version>version)
  assert.equal(ops.filled.at(-1),'#d8231c')
  material.dispose();map.dispose()
})

test('both demo documents explicitly load Guangzhou', async () => {
  for (const name of ['demo-station','tanwei-station']) {
    const { default: data } = await import(`../src/data/${name}.json`, { with: { type: 'json' } })
    assert.equal(data.city, 'guangzhou')
    assert.equal(toState(data).cityStyle, 'guangzhou')
  }
})

test('switching cities rebuilds a covered exit shell; name edits repaint it',()=>{
  const meshes=new THREE.Group(),root=new THREE.Group()
  root.userData.moduleId='exit';root.userData.exitCityStyle='guangzhou'
  let repaints=0;bindArtwork(root,()=>repaints++);prepareArtwork(root);meshes.add(root)
  const data={...fixture(),cityStyle:'shenzhen',modules:[{id:'exit'}]}
  const repaint=next=>ModuleSystem.prototype.repaintPresentation.call({moduleMeshes:meshes},next,new Set())
  assert.ok(!repaint(data).has('exit'));assert.equal(repaints,0)
  root.userData.exitCityStyle='shenzhen'
  assert.ok(repaint(data).has('exit'));assert.equal(repaints,1)
  assert.ok(!repaint({...data,cityStyle:'guangzhou'}).has('exit'),'undo must restore Guangzhou shell')
})

test('virtual exits and decor pylons rebuild their city shell and retain name repainting',()=>{
  for(const type of ['exit','guidepost']) {
    const mod={id:'pylon',type,cfg:type==='exit'?{style:'virtual',name:'C'}:{}}
    const before={...fixture(),modules:[mod]},after={...before,cityStyle:'shenzhen'}
    assert.ok(!presentationKeepIds(before,after,populationEdit(before,after)).has('pylon'))
    const root=new THREE.Group(),meshes=new THREE.Group();root.userData.moduleId='pylon';root.userData.guideCityStyle='guangzhou';meshes.add(root)
    let count=0;bindArtwork(root,()=>count++);prepareArtwork(root)
    const repaint=()=>ModuleSystem.prototype.repaintPresentation.call({moduleMeshes:meshes},after,new Set())
    assert.ok(!repaint().has('pylon'));assert.equal(count,0)
    root.userData.guideCityStyle='shenzhen';assert.ok(repaint().has('pylon'));assert.equal(count,1)
  }
})
