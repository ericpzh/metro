import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const input = process.env.BENCH_STATION
if (!input) throw new Error('Set BENCH_STATION to the reported station save')
const save = readFileSync(input, 'utf8')
const output = resolve('.preview/perf/ceiling-floor')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 15000 + process.pid % 20000 })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(save)});__metro.setState({activeZ:-5,playing:false,autoCeiling:true,ghostOtherLevels:false})`)
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const result = await page.evaluate(`(()=>{
    const s=__scene, ctx=s.ctx, meshes=s.chunks.chunkMeshes;
    ctx.scene.updateMatrixWorld(true);
    const ray=new s.cameraSys.raycaster.constructor(),v=s.cameraSys.camera.position.clone();
    ray.set(v.clone().set(97.5,-98.5,-3),v.clone().set(0,0,-1));
    const hosts=meshes.filter(m=>ray.intersectObject(m).some(h=>h.point.z>=-5&&h.point.z<=-4));
    const states=[];
    for(const level of [-10,-5,0,-5]) for(const on of [false,true]) {
      s.setLevel(level,false);s.setAutoCeiling(on);
      states.push({level,on,visible:hosts.some(m=>m.visible),hosts:hosts.map(m=>({visible:m.visible,ceiling:m.userData.suspendedCeiling,level:m.userData.levelZ}))});
    }
    return {activeZ:__metro.getState().activeZ,renderZ:ctx.activeZ,cell:__metro.getState().station.cells.find(c=>c.x===97&&c.y===-99&&c.z===-5),states};
  })()`)
  writeFileSync(resolve(output,'browser.json'), JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
  assert.ok(result.states.filter(x=>x.level===-5).every(x=>x.visible), 'active floor must survive Hide ceiling and level changes')
  // A subsequent ramp carve may tag the upper floor. Reproduce that edit through
  // the document path, then verify a real frame submits the floor geometry.
  await page.evaluate(`(()=>{const st=__metro.getState();st.commit({...st.station,cells:st.station.cells.map(c=>c.x===97&&c.y===-99&&c.z===-5?{...c,tags:[...(c.tags??[]),'opening-ceiling']}:c)});__metro.setState({activeZ:-5,autoCeiling:true})})()`)
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const drawn = await page.evaluate(`(async()=>{
    const s=__scene,cs=s.cameraSys;
    s.setLevel(-5,false);s.setAutoCeiling(true);s.setOrtho(false);
    cs.controls.enableDamping=false;cs.camera.position.set(97.5,-110,9);
    cs.controls.target.set(97.5,-98.5,-4);cs.controls.update();cs.camera.updateMatrixWorld(true);
    s.ctx.scene.updateMatrixWorld(true);
    const ray=new cs.raycaster.constructor(),v=cs.camera.position.clone();
    ray.set(v.clone().set(97.5,-98.5,-3),v.clone().set(0,0,-1));
    const hosts=s.chunks.chunkMeshes.filter(m=>ray.intersectObject(m).some(h=>h.point.z>=-5&&h.point.z<=-4));
    let draws=0;const callbacks=hosts.map(m=>m.onBeforeRender);
    hosts.forEach(m=>m.onBeforeRender=()=>{draws++});
    s.requestRender();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    hosts.forEach((m,i)=>m.onBeforeRender=callbacks[i]);
    return {hosts:hosts.length,visible:hosts.some(m=>m.visible),draws};
  })()`)
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output,'floor-minus-five.png'), Buffer.from(screenshot.data,'base64'))
  writeFileSync(resolve(output,'browser.json'), JSON.stringify({ ...result, taggedFloor: drawn },null,2))
  console.log({ taggedFloor: drawn })
  assert.ok(drawn.visible && drawn.draws > 0, 'ramp-tagged active floor must be submitted to the renderer')
} finally { await page?.close(); server.close() }
