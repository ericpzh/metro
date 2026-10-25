import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const demo = JSON.parse(readFileSync('game/src/data/tanwei-station.json','utf8'))
const output = resolve('.preview/perf/tanwei-raised-floors')
mkdirSync(output,{recursive:true})
const server = await serveDir(resolve('game/dist'),0)
let page
try {
  page = await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,`chrome-${process.pid}`),debugPort:15000+process.pid%20000})
  await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await page.evaluate(`__metro.getState().commit(${JSON.stringify(demo)});__metro.setState({activeZ:10,playing:false,autoCeiling:true,ghostOtherLevels:false})`)
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const results=[]
  for (const tag of [null,'opening-ceiling','suspended-ceiling']) {
    if(tag) {
      await page.evaluate(`(()=>{const st=__metro.getState();st.commit({...st.station,cells:st.station.cells.map(c=>c.z===11&&((c.x===15&&c.y===2)||(c.x===22&&c.y===-5))?{...c,tags:[${JSON.stringify(tag)}]}:c)})})()`)
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    }
    for(const [x,y] of [[15,2],[22,-5]]) {
      const result=await page.evaluate(`(async()=>{
        const s=__scene,cs=s.cameraSys;s.setLevel(10,false);s.setAutoCeiling(true);s.setOrtho(false);
        cs.controls.enableDamping=false;cs.camera.position.set(${x+.5},${y-12},25);
        cs.controls.target.set(${x+.5},${y+.5},12);cs.controls.update();cs.camera.updateMatrixWorld(true);s.ctx.scene.updateMatrixWorld(true);
        const ray=new cs.raycaster.constructor(),v=cs.camera.position.clone();ray.set(v.clone().set(${x+.5},${y+.5},13),v.clone().set(0,0,-1));
        const hosts=s.chunks.chunkMeshes.filter(m=>m.visible&&ray.intersectObject(m).some(h=>Math.abs(h.point.z-12)<1e-6));
        let draws=0;const callbacks=hosts.map(m=>m.onBeforeRender);hosts.forEach(m=>m.onBeforeRender=()=>draws++);
        const start=performance.now();s.requestRender();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const frameMs=performance.now()-start;hosts.forEach((m,i)=>m.onBeforeRender=callbacks[i]);
        return {hosts:hosts.length,draws,frameMs};
      })()`)
      results.push({x,y,z:11,tag,...result})
      assert.ok(result.hosts>0&&result.draws>0,`raised floor ${x},${y},11 must draw, tag=${tag}`)
    }
  }
  writeFileSync(resolve(output,'browser.json'),JSON.stringify(results,null,2))
  console.log(results)
} finally {await page?.close();server.close()}
