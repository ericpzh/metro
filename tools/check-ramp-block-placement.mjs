// Real-pointer reproduction on the reported save. Leaves the source save untouched.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const path = process.argv[2]
if (!path) throw Error('Usage: node tools/check-ramp-block-placement.mjs <save.json>')
const source = readFileSync(resolve(path), 'utf8')
const output = resolve('.preview/ramp-block-placement')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 15000 + process.pid % 20000 })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click(); window.__previousMetrics = __metro.getState().metrics; __metro.getState().loadFromText(${JSON.stringify(source)})`)
  await waitFor(page.evaluate, '__metro.getState().metrics && __metro.getState().metrics !== __previousMetrics', { tries: 240, what: 'reported save' })
  await page.evaluate(`(() => {
    const s = __metro.getState(), scene = __scene;
    s.setPlaying(false); s.setHideGround(true); s.setGhostOther(false); s.setActiveZ(-20);
    s.setTool('block'); __metro.setState({ autoWalls: false, halfWall: false, triangles: false, suspendedCeiling: false });
    scene.setOrtho(false);
    const cs = scene.cameraSys; cs.controls.enableDamping = false;
    cs.camera.position.set(77.1, -94, -14); cs.controls.target.set(77.1, -99.1, -16);
    cs.controls.update(); cs.camera.updateMatrixWorld(true); scene.requestRender();
  })()`)
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const target = await page.evaluate(`(() => {
    const scene = __scene, cam = scene.cameraSys.activeCamera(), rect = scene.renderer.domElement.getBoundingClientRect();
    for (const x of [77.1,77.25,77.4,77.6,77.8]) for (const y of [-99.05,-99.15,-99.3,-99.5,-99.8]) {
      const v = new cam.position.constructor(x,y,-16).project(cam);
      const p = { x: Math.round(rect.left + (v.x + 1) * rect.width / 2), y: Math.round(rect.top + (1 - v.y) * rect.height / 2) };
      if (document.elementFromPoint(p.x,p.y) !== scene.renderer.domElement) continue;
      const hit = scene.pick(p.x,p.y,-20);
      if (hit?.solid && hit.place.join(',') === '77,-100,-16') return p;
    }
    return null;
  })()`)
  assert.ok(target, 'could not expose the supporting block top at the reported coordinate')
  await page.evaluate(`(() => {
    window.__placementPicks = []; window.__placementEvents = []; window.__placementStart = performance.now();
    const scene = __scene, intersect = scene.cameraSys.raycaster.intersectObjects;
    scene.cameraSys.raycaster.intersectObjects = function(...args) { __placementPicks.push(performance.now()); return intersect.apply(this,args) };
    let current = null;
    for (const type of ['pointermove','pointerdown','pointerup']) {
      addEventListener(type,e => { if (e.target !== scene.renderer.domElement) return; current = {type,start:performance.now(),raysBefore:__placementPicks.length}; __placementEvents.push(current) },true);
      addEventListener(type,() => { if (!current || current.type !== type) return; current.handlerMs = performance.now() - current.start; current.rays = __placementPicks.length - current.raysBefore; current = null });
    }
    const render = scene.renderer.render;
    scene.renderer.render = function(...args) {
      const result = render.apply(this,args);
      const state = __metro.getState().station;
      if (scene.ctx.stationData.cells === state.cells) for (const event of __placementEvents) if (event.firstRenderMs === undefined) event.firstRenderMs = performance.now() - event.start;
      return result;
    };
  })()`)

  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target })
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', buttons: 1, clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 })
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const result = await page.evaluate(`({ elapsedMs: performance.now() - __placementStart, sceneIntersections: __placementPicks.length, events: __placementEvents, placed: __metro.getState().station.cells.some(c => c.x === 77 && c.y === -100 && c.z === -16 && c.fill === 'solid'), canvas: [__scene.renderer.domElement.width,__scene.renderer.domElement.height], userAgent: navigator.userAgent })`)
  assert.ok(result.placed, 'pointer placement refused the retained stair wedge')
  assert.ok(result.sceneIntersections <= 3, 'more than one scene pick per pointer event')
  assert.ok(result.events.every(e => e.rays <= 1), 'an event repeated the scene pick')
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'placed.png'), Buffer.from(screenshot.data, 'base64'))
  result.saveSha256 = createHash('sha256').update(source).digest('hex')
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify(result, null, 2))
  console.log(result)
} finally { await page?.close(); server.close() }
