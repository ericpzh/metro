import { drawNanjingHeader } from '../src/render/models/pieces/NanjingExitHeader.ts'
import { drawNanjingGuideFace } from '../src/render/models/pieces/NanjingGuidepost.ts'
import { refreshNanjingTrainMark } from '../src/render/cityBranding.ts'
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
import { drawChengduGuideLabels } from '../src/render/models/pieces/ChengduGuidepost.ts'
import { drawChengduHeader } from '../src/render/models/pieces/ChengduExitHeader.ts'
import { exitHeaderResolution } from '../src/render/exitHeaderResolution.ts'
import { drawMetroMark, refreshCityTrainMark } from '../src/render/cityBranding.ts'
import { drawChengduLogo } from '../src/render/chengduBranding.ts'
import chengduContours from '../src/assets/branding/chengdu-contours.json' with { type: 'json' }
import { presentationKeepIds } from '../src/render/presentationEdit.ts'
import { getLanguage, setLanguage } from '../src/sim/i18n.ts'
import { drawChongqingTrainBadge } from '../src/render/chongqingBranding.ts'
import { refreshChongqingTrainMark } from '../src/render/chongqingTrainMark.ts'
import { drawWuhanHeader } from '../src/render/models/pieces/WuhanExitHeader.ts'
import { drawWuhanGuideLabels } from '../src/render/models/pieces/WuhanGuidepost.ts'
import { drawChongqingHeader } from '../src/render/models/pieces/ChongqingExitHeader.ts'

const fixture = () => toState({ name: '光明', nameEn: 'Guangming', seed: 1, cells: [], modules: [], lines: [defaultLine('6', 'up', 'third-rail')] })

test('Chongqing preserves custom colours, undo and saved identity and uses every supplied default',()=>{
  assert.equal(CITY_STYLE_IDS[5],'chongqing')
  const colours=['F2A900','E4002B','007A33','003DA5','DC8633','00A3E0','F67599','008C95','7A9A01','861F41','5F259F','D986BA','D2D755','B89D18','B94700','0057B8','B04A5A','9F5CC0','2CD5C4','0057B8','0057B8','319B42','2F6F7A','93C90E','D6A148','8A75D1','0057B8','0057B8','0057B8','FF585D']
  colours.forEach((hex,i)=>assert.equal(defaultLine(String(i),'up','third-rail',5,'chongqing').colour,'#'+hex.toLowerCase()))
  for(const id of ['jt','bt','yc','nc','dz','qw','江跳线','璧铜线','永川线','南川线','大足线','綦万线'])assert.equal(lineColourFor(id,'chongqing'),'#0057b8')
  for(const id of ['环','环线'])assert.equal(lineColourFor(id,'chongqing'),'#f2a900')
  const previous=useStore.getState(),before=fixture()
  try{
    useStore.setState({station:before,past:[],future:[],geometryVersion:0})
    useStore.getState().setCityStyle('chongqing')
    assert.equal(useStore.getState().station.lines,before.lines);assert.equal(useStore.getState().geometryVersion,0)
    assert.equal(parse(serialize(useStore.getState().station)).state.cityStyle,'chongqing')
    useStore.getState().undo();assert.equal(useStore.getState().station,before)
    useStore.getState().redo();assert.equal(useStore.getState().station.cityStyle,'chongqing')
    useStore.getState().addLine();assert.equal(useStore.getState().station.lines.at(-1).colour,'#007a33')
  }finally{useStore.setState(previous)}
})

test('Wuhan supplied palette, undo/reload and new-line defaults preserve existing custom colours',()=>{
  const colours=['0067a1','ec9cbb','d3b466','a6d30b','a43034','007128','eb7c16','9dabaa','a5d4ad','7f74ac','f6d300','00a3e9','25cad0','825aa3','5c5577','c24c6d','e9a786','da7c49','469c7f','7ec3e4','b2007b']
  assert.equal(CITY_STYLE_IDS[6],'wuhan')
  colours.forEach((hex,i)=>assert.equal(defaultLine(String(i+1),'up','third-rail',5,'wuhan').colour,'#'+hex))
  for(const id of ['Yangluo','阳逻','阳逻线'])assert.equal(lineColourFor(id,'wuhan'),'#b2007b')
  for(const id of ['Xingang','新港','新港线'])assert.equal(lineColourFor(id,'wuhan'),'#7f74ac')
  const previous=useStore.getState(),before=fixture();before.lines[0].colour='#123456'
  try{
    useStore.setState({station:before,past:[],future:[],version:0,geometryVersion:0})
    useStore.getState().setCityStyle('wuhan')
    assert.equal(useStore.getState().station.lines,before.lines);assert.equal(useStore.getState().geometryVersion,0)
    const saved=parse(serialize(useStore.getState().station)).state
    assert.equal(saved.cityStyle,'wuhan');assert.equal(saved.lines[0].colour,'#123456')
    useStore.getState().undo();assert.equal(useStore.getState().station,before)
    useStore.getState().redo();assert.equal(useStore.getState().station.cityStyle,'wuhan')
    useStore.getState().addLine();assert.equal(useStore.getState().station.lines.at(-1).colour,'#ec9cbb')
  }finally{useStore.setState(previous)}
})

test('Wuhan navy plate prints bilingual brand/station, live interchange badges and subscript exit',()=>{
  const {g,ops}=stubCanvas(512,96),lines=['2','4'].map(id=>defaultLine(id,'up','third-rail',5,'wuhan'))
  drawWuhanHeader(g,'中南路','C2口','Zhongnan Rd.',512,lines)
  for(const text of ['武汉地铁','WUHAN METRO','中南路站','ZHONGNAN RD. STATION','2','4','C','2','出入口','Entrance'])assert.ok(ops.texts.includes(text),text)
  assert.equal(ops.filled[0],'#183b70');for(const line of lines)assert.ok(ops.filled.includes(line.colour))
  assert.deepEqual(exitHeaderResolution(512,'wuhan'),{width:2048,height:384})
  const guide=stubCanvas(192,640);drawWuhanGuideLabels(guide.g,'仁和路','C','Renhe Rd.',[{id:'4',colour:'#123456'}])
  assert.ok(guide.ops.texts.includes('RENHE RD. STATION'));assert.ok(guide.ops.texts.includes('C'));assert.ok(guide.ops.filled.includes('#123456'))
})

test('Wuhan gradient cab artwork repaints the retained atlas once and stays inside its first slot',()=>{
  const {g}=stubCanvas(384,150),points=[];g.moveTo=(x,y)=>points.push([x,y]);g.lineTo=g.moveTo
  const texture=new THREE.CanvasTexture({width:384,height:150,getContext:()=>g}),mat=new THREE.MeshBasicMaterial({map:texture})
  try{
    refreshCityTrainMark(mat,'wuhan');const version=texture.version
    assert.ok(points.length>10);assert.ok(points.every(([x,y])=>x>=0&&x<=128&&y>=0&&y<=150))
    refreshCityTrainMark(mat,'wuhan');assert.equal(texture.version,version)
    refreshCityTrainMark(mat,'chongqing');refreshCityTrainMark(mat,'wuhan');assert.equal(mat.map,texture);assert.ok(texture.version>version)
  }finally{texture.dispose();mat.dispose()}
})

test('Chongqing train badges include actual line number and colour and retain their texture',()=>{
  for(const [id,colour] of [['0','#f2a900'],['4','#dc8633'],['6','#f67599'],['jt','#0057b8']]){
    const {g,ops}=stubCanvas(512,128);g.ellipse=()=>{}
    drawChongqingTrainBadge(g,id,colour)
    assert.ok(ops.texts.includes(id));assert.ok(ops.filled.includes('#ffffff'));assert.ok(ops.filled.includes(colour))
    const map=new THREE.CanvasTexture({width:512,height:128,getContext:()=>g}),mat=new THREE.MeshBasicMaterial({map})
    refreshChongqingTrainMark(mat,'chongqing',id,colour);const version=map.version
    refreshChongqingTrainMark(mat,'chongqing',id,colour);assert.equal(map.version,version)
    refreshChongqingTrainMark(mat,'chongqing','10','#123456');assert.equal(mat.map,map);assert.ok(map.version>version)
    refreshChongqingTrainMark(mat,'guangzhou','10','#123456');assert.equal(mat.userData.badgeKey,'')
    map.dispose();mat.dispose()
  }
})

test('Chongqing cream entrance plate prints live interchange colours and numeric/alphanumeric exits',()=>{
  for(const exit of ['4','3A','4A出入口']){
    const {g,ops}=stubCanvas(512,96),lines=[{...defaultLine('9','up','third-rail'),colour:'#123456'},{...defaultLine('5','up','third-rail'),colour:'#654321'}]
    drawChongqingHeader(g,'红岩村',exit,'Hongyancun',512,lines)
    for(const label of ['9','5','红岩村','Hongyancun','出入口',exit.replace('出入口','')])assert.ok(ops.texts.includes(label),label)
    assert.deepEqual(exitHeaderResolution(512,'chongqing'),{width:2048,height:384})
  }
})

test('Chengdu line badges share the station-name ink centre with and without English',()=>{
  for(const english of ['Tanwei','']) {
    const {g,ops}=stubCanvas(512,96),rectangles=[],fill=g.fillRect
    g.fillRect=(x,y,w,h)=>{rectangles.push({x,y,w,h,colour:g.fillStyle});fill(x,y,w,h)}
    const lines=[{...defaultLine('5','up','third-rail'),colour:'#123456'},{...defaultLine('6','up','third-rail'),colour:'#654321'}]
    drawChengduHeader(g,'坦尾','B',english,512,lines)
    const station=ops.words.filter(w=>w.text==='坦尾站'||english&&w.text===english)
    const centre=(Math.min(...station.map(w=>w.y-w.size/2))+Math.max(...station.map(w=>w.y+w.size/2)))/2
    for(const line of lines) {
      const rect=rectangles.find(r=>r.colour===line.colour)
      assert.equal(rect.y+rect.h/2,centre,'badge box aligns with the bilingual station name')
      const text=ops.words.filter(w=>w.text===`${line.id}号线`||w.text===`Line ${line.id}`)
      const ink=(Math.min(...text.map(w=>w.y-w.size/2))+Math.max(...text.map(w=>w.y+w.size/2)))/2
      assert.ok(Math.abs(ink-centre)<=.5,'badge text aligns with the middle text')
    }
  }
})

test('Chengdu headers render native text at fourfold resolution, with bounded wide panels',()=>{
  const previous=globalThis.document,{g}=stubCanvas(),scales=[],textScales=[]
  let scale=1;g.scale=(x,y)=>{scales.push([x,y]);scale=x};const fill=g.fillText;g.fillText=(...args)=>{textScales.push(scale);fill(...args)}
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>g})}
  try {
    const pixels=exitHeaderResolution(512,'chengdu'),canvas=exitHeaderCanvas('坦尾','B','Tanwei',512,{cityStyle:'chengdu'},pixels.width/512)
    assert.deepEqual(pixels,{width:2048,height:384});assert.equal(canvas.width,2048);assert.equal(canvas.height,384)
    assert.deepEqual(scales,[[4,4]]);assert.ok(textScales.length>0&&textScales.every(s=>s===4),'scale applies while drawing text, not when stretching a low-resolution image')
    assert.deepEqual(exitHeaderResolution(512,'guangzhou'),{width:512,height:96})
    assert.deepEqual(exitHeaderResolution(2048,'chengdu'),{width:4096,height:192})
  } finally {globalThis.document=previous}
})

test('city changes replace lower-resolution doorway artwork and retain same-resolution repaints',()=>{
  const meshes=new THREE.Group(),root=new THREE.Group();root.userData.moduleId='door';root.userData.exitHeaderScale=1
  bindArtwork(root,()=>{});prepareArtwork(root);meshes.add(root)
  const data={...fixture(),cityStyle:'chengdu',modules:[{id:'door'}]}
  const repaint=next=>ModuleSystem.prototype.repaintPresentation.call({moduleMeshes:meshes},next,new Set())
  assert.ok(!repaint(data).has('door'),'switching into Chengdu replaces the original lower-resolution allocation')
  root.userData.exitHeaderScale=4;assert.ok(repaint(data).has('door'),'renaming keeps the sharp allocation')
  assert.ok(!repaint({...data,cityStyle:'guangzhou'}).has('door'),'undo restores the original resolution policy')
})

test('Chengdu English starts at the Chinese top edge on its right',()=>{
  for(const name of ['坦尾','很长的中文车站名称']) {
    const {g,ops}=stubCanvas(192,640),translations=[]
    g.translate=(x,y)=>translations.push({x,y})
    drawChengduGuideLabels(g,name,'B','Tanwei')
    const chinese=ops.words.find(w=>w.text===Array.from(name)[0]),english=ops.words.find(w=>w.text==='Tanwei'),anchor=translations[0]
    assert.ok(anchor.x>chinese.x+chinese.size/2,'English is beside the Chinese on its right')
    assert.ok(Math.abs(anchor.y-(chinese.y-chinese.size/2))<1e-6,'both names share a top edge')
    assert.equal(english.x,0);assert.equal(english.y,0)
    assert.deepEqual(ops.rotations,[Math.PI/2]);assert.equal(g.textAlign,'left')
  }
})

test('Chengdu P1 train/UI and P6 exit logos keep distinct supplied contours and colours',()=>{
  assert.notEqual(chengduContours.trainUi.sha256,chengduContours.exit.sha256)
  assert.ok(chengduContours.trainUi.aspect>2&&chengduContours.trainUi.aspect<2.5)
  assert.ok(chengduContours.exit.aspect>2.5&&chengduContours.exit.aspect<3)
  assert.ok(chengduContours.exit.layers[3].paths.length>chengduContours.trainUi.layers[3].paths.length,'P6 also carries the supplied Chinese lettering')
  const ui=stubCanvas(),exit=stubCanvas()
  drawMetroMark(ui.g,64,64,118,'#006bb1','chengdu')
  drawChengduLogo(exit.g,64,64,118,true,'#ffffff')
  assert.deepEqual(ui.ops.filled,['#0068b2','#1685c8','#7cbde6','#281a16'])
  assert.deepEqual(exit.ops.filled,['#ffffff','#ffffff','#ffffff','#ffffff'])
  assert.equal(ui.ops.texts.length,0);assert.equal(exit.ops.texts.length,0,'logos use original glyph contours')
})

test('Chengdu is fifth, preserves saved colours and uses the supplied map palette for new lines',()=>{
  assert.equal(CITY_STYLE_IDS[4],'chengdu')
  const before=fixture(),previous=useStore.getState()
  try {
    useStore.setState({station:before,past:[],future:[],geometryVersion:0})
    useStore.getState().setCityStyle('chengdu')
    assert.equal(useStore.getState().station.lines,before.lines)
    assert.equal(useStore.getState().geometryVersion,0)
    useStore.getState().addLine()
    assert.equal(useStore.getState().station.lines.at(-1).colour,'#ff6034')
    assert.equal(parse(serialize(useStore.getState().station)).state.cityStyle,'chengdu')
    useStore.getState().undo();useStore.getState().undo()
    assert.equal(useStore.getState().station,before)
    useStore.getState().redo();assert.equal(useStore.getState().station.cityStyle,'chengdu')
    for(const [id,colour] of Object.entries({'1':'#3c0899','4':'#00af66','7':'#70d1df','18':'#1d6b70','蓉2号线':'#80bc28'}))
      assert.equal(defaultLine(id,'up','third-rail',5,'chengdu').colour,colour)
  } finally {useStore.setState(previous)}
})

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
    // `city` is the legacy key `serialize` still writes; the refreshed demo saves carry
    // `cityStyle`. Either one has to name the city — nothing may fall back to the default.
    assert.equal(data.city ?? data.cityStyle, 'guangzhou', `${name} names its city`)
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

test('Shanghai branding, numeric exits and palette preserve existing station data',async()=>{
  const {nextExitName,createModule}=await import('../src/build/model.ts')
  assert.equal(nextExitName([],'shanghai'),'1号口')
  const exit=createModule('exit',0,0,0,'e');exit.cfg.name='1号口'
  assert.equal(nextExitName([exit],'shanghai'),'2号口')
  assert.equal(lineColourFor('12','shanghai'),'#007b61')
  const old=globalThis.document
  try {
    const {g,ops}=stubCanvas(512,96);globalThis.document={createElement:()=>({getContext:()=>g})}
    exitHeaderCanvas('南京西路','13号口','West Nanjing Road Station',512,{cityStyle:'shanghai',lines:[defaultLine('12','up','third-rail',5,'shanghai')]})
    for(const text of ['13','南京西路站','West Nanjing Road Station','12'])assert.ok(ops.texts.includes(text),text)
    assert.equal(ops.filled[0],'#353b35')
  } finally {globalThis.document=old}
})

test('Beijing station roundel and white calligraphic cab mark use separate retained artwork',()=>{
  const {g,ops}=stubCanvas(128,150)
  const canvas={width:128,height:150,getContext:()=>g},map=new THREE.CanvasTexture(canvas)
  const material=new THREE.MeshBasicMaterial({map,transparent:true})
  refreshCityTrainMark(material,'beijing')
  assert.equal(material.userData.cityLogo,'beijing')
  assert.equal(material.userData.cityTrainMark,'beijing-calligraphy')
  assert.deepEqual(ops.filled,['#ffffff'],'P7 is white lettering without the orange train body')
  assert.equal(ops.arcs.length,0,'the cab must not print the circular station emblem')
  assert.equal(ops.texts.length,0,'the supplied calligraphy must not depend on an installed font')
  const version=map.version
  refreshCityTrainMark(material,'beijing');assert.equal(map.version,version)
  drawMetroMark(g,64,64,110,'#004a95','beijing')
  assert.equal(ops.arcs.length,1,'the station uses the blue circular DC emblem')
  assert.ok(ops.stroked.includes('#004a95'))
  refreshCityTrainMark(material,'shanghai')
  assert.equal(material.map,map);assert.equal(map.image,canvas)
  assert.equal(material.userData.cityTrainMark,'shanghai');assert.ok(map.version>version)
  material.dispose();map.dispose()
})

test('Beijing plates print live bilingual names and original line colours at every bay width',()=>{
  const saved=globalThis.document,language=getLanguage()
  try {
    for(const [width,locale] of [[512,'zh-CN'],[1024,'en']]) {
      setLanguage(locale)
      const {g,ops}=stubCanvas(width,96)
      globalThis.document={createElement:()=>({getContext:()=>g})}
      exitHeaderCanvas('双井','C口','SHUANGJING Station',width,{cityStyle:'beijing',lines:[{...defaultLine('7','up','third-rail'),colour:'#123456'},defaultLine('10','up','third-rail',5,'beijing')]})
      assert.equal(ops.filled[0],'#073563')
      for(const text of ['双井站','SHUANGJING Station','7','10','Line 7','Line 10'])assert.ok(ops.texts.includes(text),text)
      assert.ok(ops.filled.includes('#123456'));assert.ok(ops.filled.includes('#0092bc'))
      const cn=ops.words.find(w=>w.text==='双井站'),en=ops.words.find(w=>w.text==='SHUANGJING Station')
      assert.equal(cn.x,en.x);assert.ok(cn.y<en.y)
      assert.ok(!ops.texts.includes('广州地铁'));assert.ok(!ops.texts.includes('C'))
    }
  }finally{globalThis.document=saved;setLanguage(language)}
})

for(const city of ['beijing','shanghai'])test(`${city} selection preserves saved lines and only changes new-line defaults`,()=>{
  const previous=useStore.getState(),before=fixture()
  before.lines=[{...defaultLine('1','up','third-rail'),colour:'#123456'}]
  try {
    useStore.setState({station:before,past:[],future:[],version:0,geometryVersion:0})
    useStore.getState().setCityStyle(city)
    assert.equal(useStore.getState().station.lines,before.lines)
    assert.equal(useStore.getState().station.lines[0].colour,'#123456')
    assert.equal(useStore.getState().geometryVersion,0)
    useStore.getState().addLine()
    assert.equal(useStore.getState().station.lines.at(-1).colour,city==='beijing'?'#004b87':'#82bf25')
    const loaded=parse(serialize(useStore.getState().station)).state
    assert.equal(loaded.lines[0].colour,'#123456','save/load preserves authored colour')
  }finally{useStore.setState(previous)}
})

test('every supplied Beijing and Shanghai colour reaches the new-line factory',()=>{
  const numbered={
    beijing:['A4343A','004B87','D90627','008C95','AA0061','B58500','FFC56E','009B77','97D700','0092BC','FF8674','9C4F01','F4DA40','CA9A8E','653279','6BA539','00ABAB','685BC7','D3A3C9','666666'],
    shanghai:['E3002B','82BF25','FCD600','461D84','944D9A','E30067','ED6F00','0094D8','87CAED','C6AFD4','871C2B','007B61','E999C0','626020','BCA886','98D1C0','BC796F','C4984F','F5AB78','009F65','F7AF00','5F376F','B0D478'],
  }
  for(const [city,colours] of Object.entries(numbered))colours.forEach((hex,i)=>assert.equal(defaultLine(String(i+1),'up','third-rail',5,city).colour,'#'+hex.toLowerCase(),`${city} ${i+1}`))
  const extra={
    beijing:{'22':'F4C1CA','25':'D86018','28':'476205',Batong:'A4343A',Daxing:'008C95',Yizhuang:'D0006F',Fangshan:'D86018',Yanfang:'D86018',S1:'A45A2A',Changping:'D986BA',Xijiao:'D22630',CapitalAirport:'A192B2',DaxingAirport:'0049A5',M101:'666666',YizhuangT1:'D22630'},
    shanghai:{'26':'5F67A9',Pujiang:'B5B5B6',Maglev:'1C5F5B'},
  }
  const names={beijing:{'八通线':'Batong','大兴线':'Daxing','亦庄线':'Yizhuang','房山线':'Fangshan','燕房线':'Yanfang','S1线':'S1','昌平线':'Changping','西郊线':'Xijiao','首都机场线':'CapitalAirport','大兴机场线':'DaxingAirport','M101线':'M101','亦庄T1线':'YizhuangT1'},shanghai:{'浦江线':'Pujiang','磁浮线':'Maglev'}}
  for(const [city,entries] of Object.entries(extra)) {
    for(const [id,hex] of Object.entries(entries))assert.equal(defaultLine(id,'up','third-rail',5,city).colour,'#'+hex.toLowerCase(),`${city} ${id}`)
    for(const [name,id] of Object.entries(names[city]))assert.equal(defaultLine(name,'up','third-rail',5,city).colour,'#'+entries[id].toLowerCase(),name)
  }
})

test('Nanjing exact supplied numbered/suburban palette and undoable save identity preserve custom colours',()=>{
  const hex=['009ace','a6093d','009a44','7d55c7','f2da51','4bbbb4','4a7729','93282c','fa4616','b9975b','ef426f']
  hex.forEach((h,i)=>assert.equal(defaultLine(String(i+1),'up','third-rail',5,'nanjing').colour,'#'+h))
  const suburbs=['4bbbb4','93282c','ba84ac','ff631b','f2df67','c98bdb','b46b7a','ff8000','ffc600']
  suburbs.forEach((h,i)=>assert.equal(defaultLine('S'+(i+1),'up','third-rail',5,'nanjing').colour,'#'+h))
  assert.equal(CITY_STYLE_IDS[7],'nanjing')
  const previous=useStore.getState(),before=fixture();before.lines[0].colour='#123456'
  try{
    useStore.setState({station:before,past:[],future:[],version:0,geometryVersion:0})
    useStore.getState().setCityStyle('nanjing');assert.equal(useStore.getState().station.lines,before.lines);assert.equal(useStore.getState().geometryVersion,0)
    const saved=parse(serialize(useStore.getState().station)).state;assert.equal(saved.cityStyle,'nanjing');assert.equal(saved.lines[0].colour,'#123456')
    useStore.getState().undo();assert.equal(useStore.getState().station,before);useStore.getState().redo();assert.equal(useStore.getState().station.cityStyle,'nanjing')
    useStore.getState().addLine();assert.equal(useStore.getState().station.lines.at(-1).colour,'#a6093d')
  }finally{useStore.setState(previous)}
})
test('Nanjing navy exit plate and white guide face print live colours, bilingual station and boxed exit',()=>{
  const lines=['3','5'].map(id=>defaultLine(id,'up','third-rail',5,'nanjing')),{g,ops}=stubCanvas(512,96)
  drawNanjingHeader(g,'诚信大道','4口','Chengxindadao',512,lines)
  for(const word of ['3','5','号线','Line 3/5','诚信大道站','CHENGXINDADAO','4'])assert.ok(ops.texts.includes(word),word)
  assert.equal(ops.filled[0],'#14213f');for(const line of lines)assert.ok(ops.filled.includes(line.colour))
  assert.deepEqual(exitHeaderResolution(512,'nanjing'),{width:2048,height:384})
  const face=stubCanvas(384,1800);drawNanjingGuideFace(face.g,{lines,nameEn:'Minggugong'},'明故宫','1A')
  for(const word of ['地铁','Metro','明故宫站','MINGGUGONG','1A'])assert.ok(face.ops.texts.includes(word))
})
test('Nanjing clears nose artwork and retains the separate side texture through city switches',()=>{
  const front=stubCanvas(384,150),side=stubCanvas(256,256)
  const a=new THREE.CanvasTexture({width:384,height:150,getContext:()=>front.g}),b=new THREE.CanvasTexture({width:256,height:256,getContext:()=>side.g})
  const nose=new THREE.MeshBasicMaterial({map:a}),sides=new THREE.MeshBasicMaterial({map:b})
  try{
    refreshCityTrainMark(nose,'nanjing');assert.equal(front.ops.fills,0,'all nose atlas slots stay transparent')
    refreshNanjingTrainMark(sides,'nanjing');assert.ok(side.ops.filled.includes('#d82316'));assert.ok(side.ops.filled.includes('#ffffff'));const version=b.version
    refreshNanjingTrainMark(sides,'nanjing');assert.equal(b.version,version)
    refreshNanjingTrainMark(sides,'wuhan');assert.equal(sides.userData.citySideMark,'');assert.equal(sides.map,b);assert.ok(b.version>version)
  }finally{a.dispose();b.dispose();nose.dispose();sides.dispose()}
})
