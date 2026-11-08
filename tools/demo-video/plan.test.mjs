import test from 'node:test'
import assert from 'node:assert/strict'
import { timeline, validatePlan,VIDEO_SECONDS } from './plan.mjs'
import { STOCK_CLASSES } from '../../game/src/sim/stock.ts'
import { CITY_STYLE_IDS,GUANGZHOU_LINE_COLOURS } from '../../game/src/sim/cityStyles.ts'
import { graphicHtml } from './design.mjs'
import { ui } from '../../web/src/i18n.js'
import { music } from './audio.mjs'
import {stageDocument} from './fixtures.mjs'
import {authoredState,authoredSteps,authoredFrameSteps,validateAuthoredReplay,isFrameModule,authoredCamera} from './authored-layout.mjs'
import {serialize,parse} from '../../game/src/persistence/save.ts'
import {decorCatalogue} from './catalogue.mjs'

test('both locales produce the same contiguous 70.2-second recording schedule', () => {
  const en = timeline('en'), zh = timeline('zh')
  for (const plan of [en, zh]) {
    validatePlan(plan)
    assert.equal(plan[0].start, 0)
    assert.equal(plan.at(-1).end, VIDEO_SECONDS)
    assert.deepEqual(plan.filter(s => s.view === 'flythrough').map(s => [s.station, s.level, s.seconds, s.simSpeed, s.playbackRate, s.captureSeconds]), [
      ['tianhe', -10, 4, 1, 4, 16],
      ['tianhe', -5, 4.1, 1, 4, 16.4],
    ])
    const demand = plan.find(s => s.kind === 'demand')
    assert.equal(demand.station, 'tianhe')
    assert.equal(demand.level, -5)
    assert.equal(demand.playbackRate, 4)
    assert.equal(demand.captureSeconds, 8.8)
    assert.ok(!plan.some(s => s.kind === 'views'))
    for (let i = 1; i < plan.length; i++) assert.equal(plan[i].start, plan[i - 1].end)
    assert.deepEqual(plan.filter(s => s.stock).map(s => s.stock), [...STOCK_CLASSES])
    for (const s of plan.filter(s => s.city)) assert.ok(CITY_STYLE_IDS.includes(s.city))
    assert.deepEqual(plan.filter(s=>s.city).map(s=>s.city),CITY_STYLE_IDS)
    assert.equal(plan.filter(s=>s.kind==='decor').length,0)
    for(const s of plan.filter(s=>s.kind==='city'))assert.equal(s.seconds,.4)
    assert.equal(plan.filter(s=>s.stock).reduce((n,s)=>n+s.seconds,0),4)
    const closing=plan.slice(plan.findIndex(s=>s.kind==='placement'),-1)
    assert.deepEqual([...new Set(closing.map(s=>s.kind))],['placement','city','stock'])
  }
  assert.deepEqual(en.map(s => [s.id, s.start, s.end]), zh.map(s => [s.id, s.start, s.end]))
  assert.notEqual(en[0].title, zh[0].title)
})

test('montage angles carry forward at constant speed across every cut',()=>{
 const plan=timeline('zh')
 for(const [kind,total,step] of [['city',180,22.5],['stock',50,10]]){
  const group=plan.filter(s=>s.kind===kind)
  assert.equal(group.at(-1).spin.to-group[0].spin.from,total)
  for(let i=0;i<group.length;i++){
   assert.equal(group[i].spin.to-group[i].spin.from,step)
   if(i)assert.equal(group[i-1].spin.to,group[i].spin.from)
  }
 }
})

test('authored save is reproduced exactly, with continuous tool groups',()=>{
 const construction=timeline('zh').filter(s=>['blocks','colours','placement'].includes(s.kind))
 assert.equal(construction.length,1);assert.equal(construction[0].kind,'placement');assert.equal(construction[0].seconds,22.5);assert.equal(construction[0].trimStart,1)
 for(const shot of timeline('zh').filter(s=>['blocks','colours','placement'].includes(s.kind))){
  assert.equal(shot.station,'empty');assert.equal(shot.playbackRate,8);assert.equal(shot.captureSeconds,shot.seconds*8)
 }
 const {state}=validateAuthoredReplay();assert.equal(state.modules.length,authoredState.modules.length);assert.equal(state.cells.length,authoredState.cells.length)
 const byId=ms=>[...ms].sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(byId(state.modules),byId(authoredState.modules));assert.deepEqual(state.cells,authoredState.cells)
 for(const batch of ['roadside-fence','tactile','gate','fence']){
  const grouped=authoredSteps.filter(s=>s.batch===batch)
  const first=authoredSteps.indexOf(grouped[0]);assert.deepEqual(authoredSteps.slice(first,first+grouped.length),grouped)
  assert.ok(grouped.some(s=>s.kind==='drag'))
 }
 assert.equal(authoredSteps[0].batch,'roadside-fence')
 assert.equal(authoredSteps.filter(s=>['roadside-fence','fence'].includes(s.batch)).flatMap(s=>s.modules).length,state.modules.filter(m=>m.type==='fence').length)
 for(const type of ['tvm','bench','vending'])assert.ok(authoredSteps.some(s=>s.kind==='drag'&&s.modules[0].type===type))
 const remaining=authoredSteps.filter(s=>!s.batch&&s.modules[0].type!=='tvm')
 for(let i=1;i<remaining.length;i++)assert.ok(remaining[i].east<=remaining[i-1].east)
 const frame=authoredFrameSteps();assert.equal(frame.flatMap(s=>s.cells??[]).length,authoredState.cells.length)
 const paving=frame.filter(s=>s.kind==='rectangle'),overrides=frame.filter(s=>s.kind==='surface-override')
 assert.equal(paving.length,1)
 assert.equal(paving[0].modules.length,189)
 assert.ok(overrides.every(s=>frame.indexOf(s)>frame.indexOf(paving[0])&&paving[0].modules.some(m=>m.id===s.replaces)))
 const replaced=new Set(overrides.map(s=>s.replaces))
 assert.deepEqual(byId(frame.flatMap(s=>s.modules??[]).filter(m=>!replaced.has(m.id))),byId(authoredState.modules.filter(isFrameModule)))
 assert.ok(authoredSteps.filter(s=>s.kind==='drag').length>=10)
 const finishes=new Set(state.cells.flatMap(c=>Object.values(c.finish??{})));assert.ok(finishes.has('wall.enamel#bdffee'))
 assert.equal(state.modules.filter(m=>m.type==='roof').length,0)
 assert.ok(state.modules.find(m=>m.type==='ac-unit').x>=27)
 const lift=state.modules.find(m=>m.type==='lift');assert.deepEqual(lift.cfg.rises,[5,5]);assert.equal(lift.to.z,11)
 const loaded=parse(serialize(state));assert.ok(loaded.ok);assert.equal(loaded.droppedCells,0);assert.equal(loaded.droppedModules,0);assert.equal(loaded.state.modules.length,state.modules.length)
 assert.ok(authoredCamera.from.azimuth<180&&authoredCamera.to.azimuth>180);assert.ok(authoredCamera.from.height<=6&&authoredCamera.to.height<=6)
})

test('city identity and the five train liveries use the requested station and game palette',()=>{
 for(const shot of timeline('zh').filter(s=>s.stage)){
  const doc=stageDocument(shot,shot.stationName,ui.zh.nav.brand)
  if(shot.kind==='placement'){assert.equal(doc.modules.length,0);assert.equal(doc.cells.length,0)}else assert.ok(doc.modules.length>0||doc.cells.length>0)
  if(shot.stage==='bridge'){
   assert.equal(doc.modules.filter(m=>m.type==='track').length,1)
   assert.ok(doc.modules[0].cfg.bridge&&doc.modules[0].w>=1000)
   assert.equal(doc.lines[0].stock,shot.stock)
    assert.equal(doc.lines[0].power,['D','L'].includes(shot.stock)?'catenary':'third-rail')
    assert.equal(doc.modules[0].cfg.power,doc.lines[0].power)
   assert.equal(doc.lines[0].colour,GUANGZHOU_LINE_COLOURS[shot.lineNumber]);assert.equal(doc.modules[0].cfg.line,shot.lineNumber)
  }
  if(shot.stage==='city'){
   assert.equal(doc.name,'动物园');assert.equal(doc.nameEn,'Zoo')
   assert.equal(doc.modules.filter(m=>m.type==='escalator').length,2)
   assert.ok(doc.modules.filter(m=>m.type==='escalator').every(m=>m.from.z===0&&m.to.z===-5))
  }
 }
})

test('every scene has designed graphics and locale-owned copy', () => {
  for (const locale of ['en', 'zh']) {
    for (const s of timeline(locale)) {
      const html=graphicHtml(s,locale),t=ui[locale].video
      assert.ok(!html.includes('undefined'))
      assert.ok(html.includes('class="route"'))
      if(s.panels)for(const p of s.panels)assert.ok(html.includes(p.title))
      else assert.ok(html.includes(['city','stock','decor'].includes(s.kind)?s.title:t.headlines[s.id]??s.title),`${locale}: missing ${s.id}`)
      if(['demand','cube'].includes(s.kind))assert.ok(html.includes('native'))
    }
  }
})

test('Chinese editorial copy has no English prose',()=>{
  for(const shot of timeline('zh')){
    const text=graphicHtml(shot,'zh').replace(/<img[^>]*>/g,' ').replace(/<[^>]+>/g,' ').replace('stationdesigner.com','').replace(music.title,'').replace(music.author,'').replace('CC0','').replace('OpenGameArt','')
    assert.ok(!/[A-Za-z]{2,}/.test(text),shot.id)
  }
})

test('closing card credits the selected soundtrack',()=>{
  for(const locale of ['zh','en']){
    const closing=graphicHtml(timeline(locale).at(-1),locale)
    for(const name of [music.title,music.author,music.license,'OpenGameArt'])assert.ok(closing.includes(name))
  }
})
