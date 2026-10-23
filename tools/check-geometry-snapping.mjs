import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createModule } from '../game/src/build/model.ts'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve('.preview/perf/geometry-snapping')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 12000 + process.pid % 30000, softwareGpu: false })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await page.evaluate(`(() => {
    window.__snapAudit = { errors: [], rays: 0, events: [], preview: null, surfacePicks: [] };
    addEventListener('error', e => __snapAudit.errors.push(e.message));
    addEventListener('unhandledrejection', e => __snapAudit.errors.push(String(e.reason)));
    const scene = __scene, camera = scene.cameraSys, intersect = camera.raycaster.intersectObjects;
    camera.raycaster.intersectObjects = function(...args) { __snapAudit.rays++; return intersect.apply(this,args) };
    const preview = scene.setModulePreview;
    scene.setModulePreview = function(mods,...args) { __snapAudit.preview = mods ? JSON.parse(JSON.stringify(Array.isArray(mods) ? mods[0] : mods)) : null; return preview.call(this,mods,...args) };
    const dispatch = scene.withPointerPick;
    scene.withPointerPick = function(action) { const rays = __snapAudit.rays; try { return dispatch.call(this,action) } finally { __snapAudit.events.push({ rays: __snapAudit.rays - rays }) } };
    const placement = scene.pickPlacement;
    scene.pickPlacement = function(...args) { const hit=placement.apply(this,args);__snapAudit.surfacePicks.push(hit);return hit };
  })()`)
  const settle = () => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const point = (x, y = .5, z = 12) => page.evaluate(`(() => { const scene=__scene,cam=scene.cameraSys.activeCamera(),r=scene.renderer.domElement.getBoundingClientRect(),p=cam.position.clone().set(${x},${y},${z}).project(cam); return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2} })()`)
  const send = async (type, p, button) => {
    await page.send('Input.dispatchMouseEvent', { type, ...p, ...(button ? { button, buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 } : {}) })
    await settle()
  }
  const fixtures = []
  for (const base of [0, 2, 4]) for (const beam of [false, true]) {
    const source = { ...createModule('cctv-ptz', 4, 0, 17, 'source'), ceilingAnchored: true }
    const modules = [source, ...(beam ? [createModule('hanger-roof', -1, 0, 11, 'beam', 0, 4)] : [])]
    await page.evaluate(`(async () => {
      const store=__metro,s=store.getState(),cells=[];
      for(let x=-3;x<=6;x++)for(let y=-3;y<=3;y++)for(const z of [11,18])cells.push({x,y,z,fill:'solid'});
      s.commit({...s.station,name:'Geometry snap audit',levelBase:${base},cells,modules:${JSON.stringify(modules)},lines:[]});
      store.setState({tool:'module',moduleType:'cctv-ptz',moduleRot:0,activeZ:10,playing:false,ghostOther:true,autoCeiling:false,cutaway:false,past:[],future:[]});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      __scene.setOrtho(false); const cs=__scene.cameraSys; cs.controls.enableDamping=false; cs.camera.position.set(${beam ? '.5,-10,16.4' : '5,-10,15'});cs.controls.target.set(.5,.5,${beam ? 15.9 : 12});cs.controls.update();cs.camera.updateMatrixWorld(true);
    })()`)
    await settle()
    const p = await point(.5, .5, beam ? 15.9 : 12)
    if (beam) {
      const terrain = await page.evaluate(`__scene.pick(${p.x},${p.y},10)`)
      assert.ok(!terrain || terrain.cell[1] > 3, 'low-angle pointer would otherwise land beyond the beam')
    }
    await send('mouseMoved', p)
    if (beam) {
      for (const tool of ['block', 'wall', 'rail', 'tunnel']) {
        await page.evaluate(`__metro.setState({tool:${JSON.stringify(tool)}})`)
        const count = await page.evaluate('__snapAudit.surfacePicks.length')
        await send('mouseMoved', { x: p.x + .1, y: p.y })
        const picks = await page.evaluate(`__snapAudit.surfacePicks.slice(${count})`)
        assert.ok(picks.length > 0, `${tool} uses visible object surfaces`)
        assert.equal(picks.at(-1)?.moduleId, 'beam', `${tool} cannot target ground behind the beam`)
      }
      await page.evaluate(`__metro.setState({tool:'module'})`)
      await send('mouseMoved', p)
    }
    const preview = await page.evaluate('__snapAudit.preview')
    assert.ok(preview, 'real pointer must produce a preview')
    assert.equal(preview.z, beam ? 11 : 17, `base ${base}, beam ${beam}: preview uses actual support`)
    assert.equal(!!preview.ceilingAnchored, !beam)
    await send('mousePressed', p, 'left'); await send('mouseReleased', p, 'left')
    const placed = await page.evaluate(`__metro.getState().station.modules.find(m=>m.type==='cctv'&&m.id!=='source')`)
    assert.ok(placed)
    assert.equal(placed.z, preview.z)
    await page.evaluate(`__metro.getState().undo();__metro.getState().liftModule('source')`)
    await settle()
    const destination = await point(1.5, .5, beam ? 15.9 : 12)
    await send('mouseMoved', destination)
    const carried = await page.evaluate('__metro.getState().moveDraft')
    assert.equal(carried.reason, '')
    assert.equal(carried.candidate.z, preview.z)
    assert.equal(!!carried.candidate.ceilingAnchored, !beam, 'moving onto a beam clears the old slab flag')
    await send('mousePressed', destination, 'left'); await send('mouseReleased', destination, 'left')
    assert.equal(await page.evaluate('__metro.getState().moveDraft'), null)
    fixtures.push({ base, beam, previewZ: preview.z, placedZ: placed.z, movedZ: carried.candidate.z })
  }
  for (const base of [0, 2, 4]) {
    const source = createModule('billboard-wide', 4, 0, 0, 'source-wall', 2)
    await page.evaluate(`(async () => {
      const store=__metro,s=store.getState(),cells=[];
      for(let x=-2;x<=6;x++)for(let y=-2;y<=3;y++)cells.push({x,y,z:11,fill:'solid'});
      for(let z=12;z<=17;z++)cells.push({x:0,y:1,z,fill:'solid',tags:['wall']});
      s.commit({...s.station,name:'Wall snap audit',levelBase:${base},cells,modules:[${JSON.stringify(source)}],lines:[]});
      store.setState({tool:'module',moduleType:'billboard-wide',moduleRot:2,activeZ:10,playing:false,ghostOther:true,autoCeiling:false,cutaway:false,past:[],future:[]});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const cs=__scene.cameraSys;cs.controls.enableDamping=false;cs.camera.position.set(.5,-10,15);cs.controls.target.set(.5,1,14.5);cs.controls.update();cs.camera.updateMatrixWorld(true);
    })()`)
    await settle()
    const p = await point(.5, 1, 14.5)
    await send('mouseMoved', p)
    const preview = await page.evaluate('__snapAudit.preview')
    assert.equal(preview.z, 11, 'wall preview uses the actual floor under a high course')
    await send('mousePressed', p, 'left'); await send('mouseReleased', p, 'left')
    const placed = await page.evaluate(`__metro.getState().station.modules.find(m=>m.type==='billboard'&&m.id!=='source-wall')`)
    assert.ok(placed)
    assert.equal(placed.z, 11)
    await page.evaluate(`__metro.getState().undo();__metro.getState().liftModule('source-wall')`)
    await settle()
    await send('mouseMoved', { x: p.x + .1, y: p.y })
    const carried = await page.evaluate('__metro.getState().moveDraft')
    assert.equal(carried.reason, '')
    assert.equal(carried.candidate.z, 11)
    await send('mousePressed', p, 'left'); await send('mouseReleased', p, 'left')
    assert.equal(await page.evaluate('__metro.getState().moveDraft'), null)
    fixtures.push({ base, wall: true, previewZ: preview.z, placedZ: placed.z, movedZ: carried.candidate.z })
  }
  const report = await page.evaluate('__snapAudit')
  assert.deepEqual(report.errors, [])
  assert.ok(report.events.length > 0 && report.events.every(e => e.rays <= 1))
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify({ fixtures, events: report.events, errors: report.errors }, null, 2))
  console.log(JSON.stringify({ fixtures: fixtures.length, events: report.events.length, maxRaycasts: Math.max(...report.events.map(e=>e.rays)), errors: report.errors }))
} finally { await page?.close(); server.close() }
