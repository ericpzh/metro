// Real production UI regression. Node unit tests cover preference parsing;
// this checks the controls and spotlights a player can actually use.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'
import { TUTORIAL_STEPS, TUTORIAL_STORAGE_KEY } from '../game/src/app/windows/tutorial/steps.ts'
import { tForLanguage } from '../game/src/sim/i18n.ts'

const out = resolve('.preview/tutorial')
mkdirSync(out, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
const checks = []
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(out, `chrome-check-${process.pid}`),
    debugPort: Number(process.env.TUTORIAL_CHECK_PORT ?? 9440),
    windowSize: process.env.TUTORIAL_CHECK_SIZE ?? '1280,800',
  })
  const evaluate = page.evaluate
  const until = (expression) => waitFor(evaluate, expression, { every: 30, tries: 1000, what: 'tutorial UI' })
  const countSpots = () => evaluate(`document.querySelectorAll('.tutorialShade > rect[stroke]').length`)
  const stepIndex = () => evaluate(`Number(document.querySelector('.tutorialEyebrow > span').textContent.split('/')[0]) - 1`)
  const key = async (value, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: value, modifiers })
  }
  const clickPoint = async (point, button = 'left') => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, ...point, button, buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
  }
  const click = async (selector, scroll = false) => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw Error('Missing click target: ' + ${JSON.stringify(selector)});
      if (${scroll}) element.scrollIntoView({block:'nearest'});
      const r = element.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (!element.contains(document.elementFromPoint(x,y))) throw Error('Obscured click target: ' + ${JSON.stringify(selector)});
      return {x,y};
    })()`)
    await clickPoint(point)
  }
  const goTo = async (index) => {
    let current = await stepIndex()
    while (current !== index) {
      const previous = current
      await evaluate(current < index
        ? `document.querySelector('.tutorialActions .primary').click()`
        : `document.querySelectorAll('.tutorialActions .ghost')[1].click()`)
      await until(`Number(document.querySelector('.tutorialEyebrow > span').textContent.split('/')[0]) - 1 !== ${previous}`)
      current = await stepIndex()
    }
    await sleep(420)
  }
  const record = (name, details = {}) => { checks.push({ name, ...details }); console.log(`PASS: ${name}`) }
  const screenshot = async (name) => {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(out, `${name}.png`), Buffer.from(shot.data, 'base64'))
  }
  const scenePoint = () => evaluate(`(() => {
    const canvas = document.querySelector('.stage canvas'), r = canvas.getBoundingClientRect();
    for (const fy of [.65,.5,.8]) for (const fx of [.4,.6,.2]) {
      const x=r.x+r.width*fx,y=r.y+r.height*fy;
      if (document.elementFromPoint(x,y) === canvas && __scene.pick(x,y,__metro.getState().activeZ)) return {x,y};
    }
    throw Error('No exposed construction point');
  })()`)
  const checkCard = async (language, index) => {
    const state = await evaluate(`(() => {
      const c=document.querySelector('.tutorialCard'),r=c.getBoundingClientRect();
      return {title:document.querySelector('#tutorialTitle').textContent,body:document.querySelector('#tutorialBody').textContent,
        overflow:c.scrollWidth>c.clientWidth,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,
        spots:document.querySelectorAll('.tutorialShade > rect[stroke]').length,inert:document.querySelector('.app').inert};
    })()`)
    assert.equal(state.title, tForLanguage(language, TUTORIAL_STEPS[index].title))
    assert.equal(state.body, tForLanguage(language, TUTORIAL_STEPS[index].body))
    assert.ok(state.spots > 0, `step ${index} has a visible spotlight`)
    assert.ok(state.x >= 0 && state.y >= 0 && state.right <= state.width + 1 && state.bottom <= state.height + 1)
    assert.equal(state.overflow, false)
    assert.equal(state.inert, false, 'the game stays interactive')
  }
  const checkFolder = async (id) => {
    const selector = `[data-tutorial-folder="${id}"]`
    if (await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('.folderHead').getAttribute('aria-expanded') === 'false'`)) {
      await click(`${selector} > .folderHead`, true)
    } else {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`)
    }
    await sleep(450)
    const state = await evaluate(`(() => {
      const f=document.querySelector(${JSON.stringify(selector)}),r=f.getBoundingClientRect(),rail=document.querySelector('.rail').getBoundingClientRect();
      const y=Math.max(6,r.top-5,rail.top);
      const spot=[...document.querySelectorAll('.tutorialShade > rect[stroke]')].find(e=>Math.abs(+e.getAttribute('y')-y)<2);
      return {open:f.querySelector('.folderHead').getAttribute('aria-expanded'),top:r.top,railTop:rail.top,height:spot ? +spot.getAttribute('height') : 0};
    })()`)
    assert.equal(state.open, 'true')
    assert.ok(Math.abs(state.top - state.railTop) < 10, `${id} scrolls into view`)
    assert.ok(state.height > 100, `${id} contents are highlighted`)
    await screenshot(`folder-${id}`)
  }

  await until(`!!window.__scene && !!document.querySelector('.tutorialCard')`)
  await page.send('Page.enable')
  const captureErrors = `window.__tutorialErrors=[];addEventListener('error',e=>__tutorialErrors.push(e.message));addEventListener('unhandledrejection',e=>__tutorialErrors.push(String(e.reason)))`
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: captureErrors })
  await evaluate(captureErrors)
  assert.deepEqual(await evaluate(`({cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length,lines:__metro.getState().station.lines.length,z:__metro.getState().activeZ,playing:__metro.getState().playing})`),
    { cells: 0, modules: 0, lines: 0, z: 0, playing: false })
  record('empty paused startup at ground level')

  for (const language of ['zh-CN', 'en']) {
    if (language === 'en') {
      await evaluate(`window.dispatchEvent(new Event('metro:tutorial'));__metro.getState().newStation()`)
      await until(`!!document.querySelector('.tutorialLanguage')`)
    }
    await click(`.tutorialLanguage button:nth-child(${language === 'en' ? 1 : 2})`)
    await until(`document.documentElement.lang === ${JSON.stringify(language === 'en' ? 'zh-CN' : 'en')}`)
    await click(`.tutorialLanguage button:nth-child(${language === 'en' ? 2 : 1})`)
    await until(`document.documentElement.lang === ${JSON.stringify(language)}`)
    assert.equal(await evaluate(`localStorage.getItem('metro-game.language.zh-CN')`), language)
    for (let index = 0; index < TUTORIAL_STEPS.length; index++) {
      const practice = TUTORIAL_STEPS[index].practice
      if (practice) await evaluate(`__metro.getState().setTool(${JSON.stringify(practice.tool)})`)
      await goTo(index)
      await checkCard(language, index)
      if (index === 0) {
        assert.equal(await evaluate(`document.querySelectorAll('.tutorialLanguage button').length`), 2)
        const before = await evaluate(`__scene.camera.position.toArray()`)
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w' })
        await sleep(240)
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w' })
        assert.notDeepEqual(await evaluate(`__scene.camera.position.toArray()`), before)
      } else assert.equal(await evaluate(`!!document.querySelector('.tutorialLanguage')`), false)
      if (index === 1) {
        await key('q')
        assert.equal(await evaluate(`__metro.getState().activeZ`), -4)
        await key('e')
        assert.equal(await evaluate(`__metro.getState().activeZ`), 0)
      }
      if (index === 2 || index === 3) {
        assert.ok(await evaluate(`!!document.querySelector('.tutorialMouse')`))
        const point = await scenePoint()
        if (index === 2) {
          const before = await evaluate(`({zoom:__scene.ortho.zoom,distance:__scene.camera.position.distanceTo(__scene.controls.target)})`)
          await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -120 })
          await sleep(250)
          assert.notDeepEqual(await evaluate(`({zoom:__scene.ortho.zoom,distance:__scene.camera.position.distanceTo(__scene.controls.target)})`), before)
        } else {
          const before = await evaluate(`__scene.camera.quaternion.toArray()`)
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'middle', buttons: 4, clickCount: 1 })
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 45, y: point.y + 20, button: 'middle', buttons: 4 })
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 45, y: point.y + 20, button: 'middle', buttons: 0, clickCount: 1 })
          await sleep(250)
          assert.notDeepEqual(await evaluate(`__scene.camera.quaternion.toArray()`), before)
        }
      }
      if (index === 6) {
        const before = await evaluate(`+document.querySelector('.tutorialShade > rect[stroke]').getAttribute('height')`)
        await click('[data-tutorial="new-line"]')
        await until(`__metro.getState().station.lines.length === 1`)
        await sleep(450)
        const after = await evaluate(`(() => { const r=document.querySelector('[data-tutorial^="line-"]').getBoundingClientRect(),p=document.querySelector('.panelBody').getBoundingClientRect();return {top:r.top,panel:p.top,height:+document.querySelector('.tutorialShade > rect[stroke]').getAttribute('height')}; })()`)
        assert.ok(after.height > before * 3)
        assert.ok(Math.abs(after.top - after.panel) < 10)
        await click('[data-tutorial^="line-"] input')
        await page.send('Input.insertText', { text: 'Test' })
        assert.equal(await evaluate(`document.activeElement.tagName`), 'INPUT')
        await screenshot(`${language}-new-line`)
      }
      if (practice) {
        const base = TUTORIAL_STEPS[index].targets.length
        assert.equal(await countSpots(), base, 'inherited tool selection does not reveal the construction area')
        // B toggles; if inherited Delete is active, the first B leaves it.
        if (practice.tool === 'delete') await key('b')
        await key(practice.key)
        await sleep(380)
        assert.equal(await evaluate(`__metro.getState().tool`), practice.tool)
        assert.equal(await countSpots(), base + 1)
        await goTo(index + 1)
        await goTo(index)
        assert.equal(await countSpots(), base, 'revisiting the step resets its activation')
        await evaluate(`__metro.getState().setTool('select')`)
        await click(TUTORIAL_STEPS[index].targets[0])
        await sleep(380)
        assert.equal(await countSpots(), base + 1, 'a real tile click reveals the construction area')
        if (practice.tool === 'block') {
          const point = await scenePoint()
          await clickPoint(point)
          await until(`__metro.getState().station.cells.length > 0`)
        }
        if (practice.tool === 'delete') {
          assert.deepEqual(await evaluate(`[...document.querySelectorAll('.tutorialKeyChord')].map(e=>[...e.querySelectorAll('kbd')].map(k=>k.textContent))`), [['B'], ['Ctrl', 'Z'], ['Ctrl', 'Shift', 'Z']])
          assert.ok(await evaluate(`(()=>{const r=[...document.querySelectorAll('.tutorialKeyChord')].map(e=>e.getBoundingClientRect());return r.slice(1).every((e,i)=>e.y>r[i].y||e.x-r[i].right>=19)})()`))
        }
      }
      if (index === 12) {
        for (const id of ['equipment', 'decorCeiling']) {
          await checkFolder(id)
          await click(`[data-tutorial-folder="${id}"] > .folderHead`)
          await sleep(350)
        }
      }
      if (index === 13) {
        await checkFolder('surfaces')
        await click('[data-tutorial-folder="surfaces"] [data-tile]', true)
        assert.equal(await evaluate(`__metro.getState().tool`), 'paint')
        const mode = await evaluate(`__metro.getState().paintMode`)
        await key('Tab')
        assert.notEqual(await evaluate(`__metro.getState().paintMode`), mode)
      }
      if (index === 14) assert.deepEqual(await evaluate(`[...document.querySelectorAll('.tutorialKeyChord')].map(e=>[...e.querySelectorAll('kbd')].map(k=>k.textContent))`), [['Ctrl', 'S'], ['Ctrl', 'L']])
      if ([0, 9, 13, 14, 16].includes(index)) await screenshot(`${language}-step-${index + 1}`)
    }
    await click('.tutorialActions .primary')
    await until(`!document.querySelector('.tutorialCard')`)
    assert.deepEqual(await evaluate(`window.__tutorialErrors`), [])
    record(`${language}: all 17 steps, live controls, practice activation, new line, folders and keycaps`)
  }

  // Real top-bar help button, not a test-only route, reopens the tour.
  await click(`.topbar button[aria-label=${JSON.stringify(tForLanguage('en', 'tutorial_title'))}]`)
  await until(`!!document.querySelector('.tutorialCard')`)
  await goTo(1)
  const reload = async () => {
    const loaded = page.waitForEvent('Page.loadEventFired')
    await page.send('Page.reload')
    await loaded
    await until(`!!window.__scene`)
  }
  await reload()
  await until(`!!document.querySelector('.tutorialCard')`)
  assert.equal(await stepIndex(), 1)
  assert.equal(await evaluate(`document.documentElement.lang`), 'en')
  await click('.tutorialPreference input')
  await until(`JSON.parse(localStorage.getItem(${JSON.stringify(TUTORIAL_STORAGE_KEY)})).hidden === true`)
  await click('.tutorialActions .ghost')
  await until(`!document.querySelector('.tutorialCard')`)
  await reload()
  assert.equal(await evaluate(`!!document.querySelector('.tutorialCard')`), false)
  await click(`.topbar button[aria-label=${JSON.stringify(tForLanguage('en', 'tutorial_title'))}]`)
  await until(`!!document.querySelector('.tutorialCard')`)
  assert.equal(await stepIndex(), 0)
  await key('Escape')
  await until(`!document.querySelector('.tutorialCard')`)
  assert.deepEqual(await evaluate(`window.__tutorialErrors ?? []`), [])
  record('completion, help button, reload/resume, language persistence, skip, opt-out and Escape')
  await loadExampleStation(page)
  assert.ok(await evaluate(`__metro.getState().station.modules.some(m=>m.type==='track')`))
  assert.equal(await evaluate(`!!document.querySelector('.tutorialCard')`), false)
  record('demo-dependent browser tools explicitly load their fixture and dismiss the tour')
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ checks, passed: true }, null, 2))
} catch (error) {
  if (page) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (shot) writeFileSync(resolve(out, 'failure.png'), Buffer.from(shot.data, 'base64'))
  }
  throw error
} finally {
  await page?.close()
  await new Promise((done) => server.close(done))
}
