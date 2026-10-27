import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'
import { createModule } from '../game/src/build/model.ts'

// Build first. Block the entry bundle to observe the shell before React starts,
// then unblock it and exercise the real renderer and settings control.
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: 'about:blank', profile: resolve('.preview', `theme-check-${process.pid}`), debugPort: 9435, windowSize: '1440,900' })
  await page.send('Page.enable')
  await page.send('Network.enable')
  await page.send('Network.setBlockedURLs', { urls: ['*assets/index-*.js'] })
  const base = `http://127.0.0.1:${server.address().port}`
  await page.send('Page.navigate', { url: `${base}/en` })
  await waitFor(page.evaluate, `!!document.querySelector('#game-loading:not([hidden])')`)
  for (const theme of ['blueprint', 'site', 'studio']) {
    if (theme !== 'blueprint') {
      await page.evaluate(`localStorage.setItem('metro-game.ui-theme', '${theme}')`)
      await page.send('Page.reload')
      await waitFor(page.evaluate, `document.documentElement.dataset.uiTheme === '${theme}'`)
    }
    assert.equal(await page.evaluate(`document.querySelector('#loading-title').textContent`), 'Preparing your station')
    assert.equal(await page.evaluate(`document.querySelector('#game-loading').hidden`), false)
  }
  for (const path of ['/benchmark/en', '/lab', '/en?capture-cards']) {
    await page.send('Page.navigate', { url: base + path })
    await waitFor(page.evaluate, `location.pathname + location.search === '${path}' && !!document.getElementById('game-loading')`)
    assert.equal(await page.evaluate(`document.querySelector('#game-loading').hidden`), true, `${path} bypasses the game loading screen`)
  }
  await page.send('Network.setBlockedURLs', { urls: [] })
  await page.send('Page.navigate', { url: `${base}/en` })
  await waitFor(page.evaluate, `!!window.__scene && document.getElementById('game-loading').hidden && __scene.framesRendered > 0`, { tries: 120, every: 200, what: 'first rendered station frame' })
  const studio = await page.evaluate(`(()=>{const key=document.querySelector('.bpKey');return {theme:document.documentElement.dataset.uiTheme,clear:__scene.renderer.getClearColor({copy(c){this.v=c.getHex();return this}}).v,key:getComputedStyle(key).backgroundColor,version:__metro.getState().version}})()`)
  assert.equal(studio.theme, 'studio')
  assert.equal(studio.clear, 0xf4f3ed)
  assert.equal(studio.key, 'rgb(255, 249, 242)')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click(); document.querySelector('.settingsMenu summary').click()`)
  const switchTheme = async () => {
    await page.evaluate(`document.querySelector('.settingsActionGrid button:last-child').click()`)
    await page.evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  }
  await switchTheme()
  assert.equal(await page.evaluate(`document.documentElement.dataset.uiTheme`), 'blueprint')
  assert.equal(await page.evaluate(`__scene.renderer.getClearColor({copy(c){this.v=c.getHex();return this}}).v`), 0x0b0f16)
  await switchTheme()
  assert.equal(await page.evaluate(`document.documentElement.dataset.uiTheme`), 'site')
  const view = await page.evaluate(`(()=>{const grid=document.querySelector('.viewGrid');return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,closed:getComputedStyle(grid.querySelector('.inlineExpand')).display,version:__metro.getState().version}})()`)
  assert.equal(view.columns, 1)
  assert.equal(view.closed, 'none')
  assert.equal(view.version, studio.version, 'changing themes does not commit the station')
  await switchTheme()
  await page.send('Page.reload')
  await waitFor(page.evaluate, `document.documentElement.dataset.uiTheme === 'studio' && !!window.__scene && document.querySelector('#game-loading').hidden`, { tries: 120, every: 200, what: 'saved theme reload' })
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click(); __metro.getState().setTimePanel(true)`)
  await waitFor(page.evaluate, `!!document.querySelector('.timeBlock')`)
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.timeBlock')).backgroundColor`), 'rgb(247, 248, 242)')
  await page.evaluate(`__metro.getState().setTimePanel(false); __metro.getState().setChartsPanel(true)`)
  await waitFor(page.evaluate, `!!document.querySelector('.chartLegend i')`)
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.chartLegend i')).backgroundColor`), 'rgb(138, 90, 8)')
  await page.evaluate(`__metro.getState().setChartsPanel(false); __metro.getState().setHideUI(true)`)
  await waitFor(page.evaluate, `!!__scene.ctx.scene.background?.isCubeTexture`, { tries: 60, every: 100, what: 'Hide UI sky' })
  await page.evaluate(`__metro.getState().setHideUI(false)`)
  const exit = createModule('exit', 0, 0, 0, 'theme-check-exit')
  await page.evaluate(`(()=>{const s=__metro.getState(); s.commit({...s.station,modules:[...s.station.modules,${JSON.stringify(exit)}]})})()`)
  await waitFor(page.evaluate, `!!document.querySelector('.exitTile')`)
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.exitGrid')).gridTemplateColumns.split(' ').length`), 1)
  console.log('Game theme and loading browser checks passed.')
} finally {
  await page?.close()
  await new Promise(resolveClose => server.close(resolveClose))
}
