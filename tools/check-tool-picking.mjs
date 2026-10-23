import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createModule } from '../game/src/build/model.ts'
import { moduleEnvelope, moduleAt } from '../game/src/sim/placement.ts'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output = resolve('.preview/perf/tool-picking')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(`${output}/chrome-${process.pid}`), debugPort: 12000 + process.pid % 30000, softwareGpu: false })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  const source = createModule('sign-ceiling', 8, 8, 3, 'source-sign')
  const track = { id: 'platform', type: 'track', x: 0, y: 0, z: 5, w: 8, d: 3, rot: 0, cfg: { line: '1', dir: 'up', power: 'third-rail' } }
  await page.evaluate(`(async () => {
    const store = window.__metro, scene = window.__scene;
    store.getState().commit({...store.getState().station, cells: [{x:8,y:8,z:4,fill:'solid'}], modules: ${JSON.stringify([track, source])}});
    store.setState({tool:'module',moduleType:'sign-ceiling',playing:false,activeZ:5,autoCeiling:false,cutaway:false});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    scene.setOrtho(false);
    const cs=scene.cameraSys;cs.camera.position.set(3.5,1.5,1.5);cs.controls.target.set(3.5,1.5,4);cs.camera.lookAt(cs.controls.target);cs.camera.updateMatrixWorld(true);
    window.__pickCheck={events:[],errors:[],stage:'setup',rays:0};
    addEventListener('error',e=>__pickCheck.errors.push({message:e.message,stack:e.error?.stack,stage:__pickCheck.stage}));
    addEventListener('unhandledrejection',e=>__pickCheck.errors.push(String(e.reason)));
    const intersect=cs.raycaster.intersectObjects;
    cs.raycaster.intersectObjects=function(...args){__pickCheck.rays++;return intersect.apply(this,args)};
    const dispatch=scene.withPointerPick;
    scene.withPointerPick=function(action){const before=__pickCheck.rays,t=performance.now();try{return dispatch.call(this,action)}finally{__pickCheck.events.push({stage:__pickCheck.stage,rays:__pickCheck.rays-before,ms:performance.now()-t})}};
  })()`)
  const point = async (x = 3.5, y = 1.5, z = 4) => page.evaluate(`(()=>{const scene=__scene,cam=scene.cameraSys.activeCamera(),rect=scene.renderer.domElement.getBoundingClientRect(),v=cam.position.clone().set(${x},${y},${z}).project(cam);return{x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}})()`)
  const settle = () => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const send = async (stage, type, p, button) => {
    await page.evaluate(`__pickCheck.stage=${JSON.stringify(stage)}`)
    await page.send('Input.dispatchMouseEvent', { type, ...p, ...(button ? { button, buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 } : {}) })
    await settle()
  }
  const p = await point()
  await send('first-place-hover', 'mouseMoved', p)
  await send('place-down', 'mousePressed', p, 'left')
  await send('place-up', 'mouseReleased', p, 'left')
  const placed = await page.evaluate(`__metro.getState().station.modules.filter(m=>m.type==='sign' && m.id!=='source-sign').map(m=>({x:m.x,y:m.y,z:m.z}))`)
  assert.deepEqual(placed, [{ x: 3, y: 1, z: 3 }], 'ceiling sign clicks onto the rendered platform underside')
  await page.evaluate(`__metro.getState().liftModule('source-sign')`)
  await settle()
  const movedPoint = await point(4.5)
  await send('first-move-hover', 'mouseMoved', movedPoint)
  assert.equal(await page.evaluate('__metro.getState().moveDraft.reason'), '')
  await send('move-down', 'mousePressed', movedPoint, 'left')
  await send('move-up', 'mouseReleased', movedPoint, 'left')
  assert.equal(await page.evaluate('__metro.getState().moveDraft'), null)
  const moved = await page.evaluate(`(()=>{const m=__metro.getState().station.modules.find(m=>m.id==='source-sign');return[m.x,m.y,m.z]})()`)
  assert.deepEqual(moved, [4, 1, 3])
  const ramps = []
  for (const type of ['stair-left180', 'escalator']) {
    const run = createModule(type, 0, 0, 0, 'ramp-run', 0, type === 'escalator' ? 2 : 2.04, 'up', 'lane', [], undefined, { storeyHeight: 5 })
    const envelope = moduleEnvelope(run), cells = []
    for (let x = Math.floor(envelope.x0); x < Math.ceil(envelope.x1); x++) for (let y = Math.floor(envelope.y0); y < Math.ceil(envelope.y1); y++) {
      if (moduleAt([run], x, y, 3)) cells.push({ x, y, z: 3, fill: 'solid' })
    }
    cells.push(...[0,1,2,3].map(x=>({x:x+30,y:30,z:0,fill:'solid'})))
    await page.evaluate(`(async()=>{
      const s=__metro.getState();s.commit({...s.station,cells:${JSON.stringify(cells)},modules:[${JSON.stringify(run)}]});
      __metro.setState({tool:'delete',activeZ:0,autoCeiling:false,past:[],future:[]});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    })()`)
    let target
    for (const cell of cells.filter(c=>c.z===3)) {
      const candidate = await page.evaluate(`(async()=>{
        const scene=__scene,cs=scene.cameraSys,c=${JSON.stringify(cell)};
        cs.camera.position.set(c.x+.5,c.y+.501,20);cs.controls.target.set(c.x+.5,c.y+.5,4);cs.camera.lookAt(cs.controls.target);cs.camera.updateMatrixWorld(true);
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const rect=scene.renderer.domElement.getBoundingClientRect(),v=cs.camera.position.clone().set(c.x+.5,c.y+.5,4).project(cs.activeCamera());
        const p={x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2};
        const hit=scene.pick(p.x,p.y,0),direct=scene.pickModuleHit(p.x,p.y);
        const root=scene.modules.moduleMeshes.children.find(g=>g.userData.moduleId==='ramp-run');
        const mask=cs.raycaster.layers.mask;cs.raycaster.layers.enable(31);
        const behind=cs.raycaster.intersectObject(root,true).length>0;
        cs.raycaster.layers.mask=mask;
        return hit?.solid && hit.cell.join(',')===[c.x,c.y,c.z].join(',') && !direct && behind ? {...p,cell:hit.cell} : null;
      })()`)
      if (candidate) { target = candidate; break }
    }
    assert.ok(target, `${type}: visible block must occlude actual ramp geometry inside its coarse envelope`)
    const screen = { x: target.x, y: target.y }
    await send(`${type}-block-first-hover`, 'mouseMoved', screen)
    await send(`${type}-block-down`, 'mousePressed', screen, 'left')
    await send(`${type}-block-up`, 'mouseReleased', screen, 'left')
    const result = await page.evaluate(`(()=>{const s=__metro.getState();return {run:s.station.modules.some(m=>m.id==='ramp-run'),block:s.station.cells.some(c=>c.fill==='solid'&&[c.x,c.y,c.z].join(',')===${JSON.stringify(target.cell.join(','))}),past:s.past.length}})()`)
    assert.equal(result.run, true); assert.equal(result.block, false); assert.equal(result.past, 1)
    await page.evaluate('__metro.getState().undo()'); await settle()
    assert.equal(await page.evaluate(`__metro.getState().station.cells.some(c=>c.fill==='solid'&&[c.x,c.y,c.z].join(',')===${JSON.stringify(target.cell.join(','))})`), true)
    await page.evaluate('__metro.getState().redo()'); await settle()
    await send(`${type}-direct-down`, 'mousePressed', screen, 'left')
    await send(`${type}-direct-up`, 'mouseReleased', screen, 'left')
    assert.equal(await page.evaluate(`__metro.getState().station.modules.some(m=>m.id==='ramp-run')`), false, 'an exposed run remains directly deletable')
    ramps.push({ type, cell: target.cell, ...result })
  }
  await loadExampleStation(page, 'tanwei')
  await page.evaluate(`__scene.setPreset('iso');__scene.frame();__metro.setState({activeZ:0,autoCeiling:true})`)
  await settle()
  const target = await page.evaluate(`(()=>{const r=__scene.renderer.domElement.getBoundingClientRect();return{x:r.left+r.width*.35,y:r.top+r.height*.55}})()`)
  for (const tool of ['select','pick','move','block','wall','delete','module','paint','zone','rail','tunnel']) {
    await page.evaluate(`__metro.setState({tool:${JSON.stringify(tool)},moduleType:'clock'})`)
    await settle()
    await send(`${tool}-first-hover`, 'mouseMoved', target)
    await send(`${tool}-warm-hover`, 'mouseMoved', { x: target.x + 2, y: target.y + 2 })
  }
  const report = await page.evaluate('({...__pickCheck,station:__metro.getState().station.name})')
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify({ ...report, placed, moved, ramps }, null, 2))
  assert.ok(report.events.length >= 26)
  assert.ok(report.events.every(e=>e.rays<=1), JSON.stringify(report.events.filter(e=>e.rays>1)))
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify({ events: report.events.length, maxRaycasts: Math.max(...report.events.map(e=>e.rays)), placed, moved, errors: report.errors }, null, 2))
} finally { await page?.close(); server.close() }
