import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createModule} from '../game/src/build/model.ts'
import {moduleLabel} from '../game/src/app/store/catalog.ts'
import {tForLanguage} from '../game/src/sim/i18n.ts'
import {roadBetween} from '../game/src/sim/roadDocument.ts'
import {liftExtendedUp,liftModule} from '../game/src/sim/lifts.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const output=resolve('.preview/info-panel');mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0)
try {
  for(const language of ['zh-CN','en']) {
    const page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,`${language}-${process.pid}`),debugPort:9460,softwareGpu:false,windowSize:'1440,1000'})
    try {
      await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'inspector'})
      if(language==='en') await page.evaluate("document.querySelector('.tutorialLanguage button:nth-child(2)').click()")
      await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click();window.__infoErrors=[];addEventListener('error',e=>__infoErrors.push(e.message))`)
      for(const type of ['lift','sign','escalator','walkway','road','two-way']) {
        let mod=type==='road'||type==='two-way'?roadBetween([0,0],[0,30],0,6,type==='road'?'one-way':'two-way',false,type):createModule(type,0,0,0,type,0)
        if(type==='lift')mod=liftExtendedUp(liftModule({x:0,y:0,z:0},0,type))
        assert.ok(mod)
        await page.evaluate(`(()=>{const st=__metro.getState(),m=${JSON.stringify(mod)};st.commit({...st.station,cells:[],modules:[m]});__metro.setState({tool:'select',selected:{kind:'module',key:m.id,label:${JSON.stringify(moduleLabel(mod))}},past:[],future:[]})})()`)
        await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        const layout=await page.evaluate(`(()=>{const card=document.querySelector('.infoCardLayout'),details=card.querySelector('.infoCardDetails').getBoundingClientRect(),actions=card.querySelector('.infoCardActions').getBoundingClientRect();return {details:{bottom:details.bottom,left:details.left,right:details.right},actions:{top:actions.top,right:actions.right},buttons:[...card.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,title:b.title,label:b.getAttribute('aria-label')}})}})()`)
        assert.ok(layout.actions.right>layout.details.right,'actions are in a separate panel to the right')
        for(const b of layout.buttons) {
          assert.equal(b.width,32);assert.equal(b.height,32)
          assert.equal(b.x,layout.buttons[0].x)
          assert.ok(b.x>layout.details.right&&b.right<=layout.actions.right)
          assert.equal(b.title,b.label)
        }
        if(type==='road') {
          const label=tForLanguage(language,'reverse_road')
          await page.evaluate(`[...document.querySelectorAll('.infoCardActions button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`)
          assert.equal(await page.evaluate('__metro.getState().station.modules[0].rot'),2)
          assert.equal(await page.evaluate('__metro.getState().past.length'),1)
          await page.evaluate('__metro.getState().undo()')
          assert.equal(await page.evaluate('__metro.getState().station.modules[0].rot'),0)
        }
        if(type==='two-way') assert.equal(layout.buttons.length,1,'two-way traffic has no reversal action')
        if(type==='lift') {
          const configure=tForLanguage(language,'configure_lift_doors')
          await page.evaluate(`[...document.querySelectorAll('.infoCardActions button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(configure)}).click()`)
          await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
          assert.equal(await page.evaluate("document.querySelectorAll('.liftDoorRow').length"),3)
          assert.equal(await page.evaluate("document.activeElement.matches('.liftDoorPanel')"),true,'opening focuses the dialog')
          const choose=async(z,key)=>{
            const text=tForLanguage(language,key)
            await page.evaluate(`(()=>{const row=[...document.querySelectorAll('.liftDoorRow')].find(r=>r.querySelector('.liftDoorLevel').textContent==='${z} m');const button=[...row.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});button.click()})()`)
          }
          await choose(0,'lift_door_back')
          await choose(4,'lift_door_none')
          assert.equal(await page.evaluate("__metro.getState().station.modules[0].cfg.doors['0']"),'back')
          assert.equal(await page.evaluate("__metro.getState().station.modules[0].cfg.doors['4']"),'none')
          assert.equal(await page.evaluate('__metro.getState().past.length'),2,'one undoable edit per floor choice')
          await page.evaluate('__metro.getState().undo()')
          assert.equal(await page.evaluate("__metro.getState().station.modules[0].cfg.doors['4']"),undefined)
          await page.evaluate('__metro.getState().redo()')
          await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
          await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
          assert.equal(await page.evaluate("!!document.querySelector('.liftDoorDialog')"),false,'Escape closes the dialog')
          await page.evaluate(`[...document.querySelectorAll('.infoCardActions button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(configure)}).click()`)
          await page.evaluate("document.querySelector('.liftDoorDialog').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))")
          assert.equal(await page.evaluate("!!document.querySelector('.liftDoorDialog')"),false,'backdrop closes the dialog')
        }
        if(type==='lift'||type==='road') {
          const shot=await page.send('Page.captureScreenshot',{format:'png'})
          writeFileSync(resolve(output,`${type}-${language}.png`),Buffer.from(shot.data,'base64'))
        }
      }
      const blockLabel=tForLanguage(language,'passenger')
      await page.evaluate(`__metro.setState({moveDraft:null,selected:{kind:'block',key:'0,0,0',label:${JSON.stringify(blockLabel)}}})`)
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.infoCardActions')).display"),'none','block selections have no empty action panel')
      const moveModule=createModule('lift',0,0,0,'move-layout',0)
      await page.evaluate(`__metro.setState({selected:{kind:'module',key:'move-layout',label:${JSON.stringify(moduleLabel(moveModule))}},moveDraft:{module:${JSON.stringify(moveModule)},rot:0,at:null,candidate:null,reason:''}})`)
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      const move=await page.evaluate(`(()=>{const card=document.querySelector('.infoCardLayout'),d=card.querySelector('.infoCardDetails').getBoundingClientRect(),a=card.querySelector('.infoCardActions').getBoundingClientRect(),buttons=[...card.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,height:r.height,disabled:b.disabled,title:b.title,label:b.getAttribute('aria-label')}});return {details:{right:d.right},actions:{right:a.right},buttons}})()`)
      assert.ok(move.actions.right>move.details.right,'move confirmation controls stay in the right panel')
      assert.equal(move.buttons.length,2);assert.ok(move.buttons[0].disabled);assert.equal(move.buttons[0].x,move.buttons[1].x)
      assert.ok(move.buttons.every(b=>b.width===32&&b.height===32&&b.title===b.label))
      assert.deepEqual(await page.evaluate('__infoErrors'),[])
      console.log(`${language}: inspector action alignment, road reversal, lift-door editing, block selection and move controls passed`)
    } finally {await page.close()}
  }
} finally {server.close()}
