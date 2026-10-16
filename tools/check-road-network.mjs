import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const output=resolve(process.env.ROAD_NETWORK_OUTPUT??'.preview/perf/road-network')
mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0)
const reports=[]
try {
  for(const language of ['zh-CN','en']) {
    const page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(`${output}/chrome-${language}-${process.pid}`),debugPort:9430,softwareGpu:false,windowSize:'1440,1000'})
    try {
      await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'network scene'})
      if(language==='en') {
        await page.evaluate("document.querySelector('.tutorialLanguage button:nth-child(2)').click()")
        await waitFor(page.evaluate,"document.documentElement.lang==='en'",{what:'English UI'})
      }
      const fixture=await page.evaluate(`(async()=>{
        document.querySelector('.tutorialActions .ghost')?.click();
        window.__networkErrors=[];window.__networkCold={station:[],update:[]};
        for(const [owner,name,key] of [[window.__scene,'setStation','station'],[window.__scene.roads,'update','update']]) {
          const original=owner[name];owner[name]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{if(__networkCold[key].length<3)__networkCold[key].push(performance.now()-start)}};
        }
        addEventListener('error',e=>__networkErrors.push(e.message));addEventListener('unhandledrejection',e=>__networkErrors.push(String(e.reason)));
        const store=window.__metro,s=store.getState(),a={id:'a',type:'road',x:0,y:-40,z:0,rot:0,w:${process.env.ROAD_WIDE==='1'?18:6},d:${process.env.ROAD_T==='1'?(process.env.ROAD_WIDE==='1'?49:43):86},cfg:{direction:'two-way'}},b={...a,id:'b',x:-40,y:0,w:86,d:${process.env.ROAD_WIDE==='1'?18:6},rot:1};
        s.commit({...s.station,cells:[],modules:[a,b,{id:'manual-light',type:'traffic-light',x:22,y:22,z:0,rot:0,cfg:{}}]});s.setActiveZ(0);store.setState({tool:'select'});
        const scene=window.__scene;scene.setPreset('iso');scene.setOrtho(true);scene.frame();
        const cam=scene.cameraSys.activeCamera();cam.zoom*=3;cam.updateProjectionMatrix();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        return {browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight],seed:s.station.seed,gpu:(()=>{const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)})()};
      })()`)
      await waitFor(page.evaluate,"window.__scene.roads.traffic?.network.junctions.length===1",{what:'derived crossing'})
      const report=await page.evaluate(`(()=>{
        const scene=window.__scene,system=scene.roads,roots=scene.modules.moduleMeshes,n=system.traffic.network;
        const signals=roots.children.flatMap(r=>r.userData.roadSignals??[]);
        let turns=0,waits=0;const times=[];
        system.setSimTime(0);system.update(performance.now()+1000,roots);
        for(let i=1;i<=600;i++) {
          const prior=new Map(system.traffic.cars.map(c=>[c.id,c.distance]));
          system.setSimTime(i/10);const start=performance.now();system.update(performance.now()+1000,roots);times.push(performance.now()-start);
          turns+=system.traffic.cars.filter(c=>n.edges[c.edge].control).length;
          waits+=system.traffic.cars.filter(c=>prior.get(c.id)===c.distance).length;
        }
        const versions=[...system.meshes.values()].flat().map(m=>m.instanceMatrix.version);
        system.update(performance.now()+2000,roots);
        const paused=[...system.meshes.values()].flat().every((m,i)=>m.instanceMatrix.version===versions[i]);
        const phases=new Set(signals.flatMap(s=>s.lenses.map(l=>l.material.color.getHex())));
        const markings={arrows:roots.children.flatMap(r=>r.userData.roadArrows??[]),stops:roots.children.flatMap(r=>r.userData.roadStopLines??[])};
        const rightHand=n.edges.filter(e=>e.junction<0).every(e=>{
          const r=e.road,offset=e.axis?e.start[0]-r.x-r.w/2:e.start[1]-r.y-r.d/2;
          return offset*e.sign*(e.axis?1:-1)>0;
        });
        const geometry={junctions:n.junctions.length,edges:n.edges.length,signals:signals.length,crosswalks:roots.children.filter(r=>r.children.some(c=>c.name==='road-crosswalk')).length,manual:!!roots.children.find(r=>r.userData.moduleId==='manual-light')};
        times.sort((a,b)=>a-b);
        const frameStart=performance.now();scene.renderer.render(scene.scene,scene.cameraSys.activeCamera());
        return {markings,rightHand,cold:__networkCold,geometry,turns,waits,paused,phases:[...phases],cars:system.traffic.cars.length,updateMs:{median:times[300],p95:times[570],max:times.at(-1)},renderMs:performance.now()-frameStart,drawCalls:scene.renderer.info.render.calls,errors:__networkErrors,shaderFailures:scene.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length};
      })()`)
      assert.equal(report.rightHand,true)
      assert.equal(report.markings.stops.length,process.env.ROAD_T==='1'?3:4)
      assert.ok(report.markings.stops.every(s=>s.width===(process.env.ROAD_WIDE==='1'?9:3)))
      assert.equal(report.markings.arrows.length,process.env.ROAD_T==='1'?(process.env.ROAD_WIDE==='1'?9:3):(process.env.ROAD_WIDE==='1'?12:4))
      if(process.env.ROAD_T==='1') {
        assert.ok(report.markings.arrows.filter(a=>a.axis).every(a=>!a.turns.includes('straight')))
        if(process.env.ROAD_WIDE==='1')assert.ok(report.markings.arrows.some(a=>a.axis&&a.turns.includes('left')&&a.turns.includes('right')))
      } else assert.ok(report.markings.arrows.every(a=>a.turns.includes('straight')))
      assert.equal(report.geometry.signals,process.env.ROAD_T==='1'?3:4);assert.equal(report.geometry.crosswalks,2);assert.equal(report.geometry.manual,true)
      assert.ok(report.turns>0);assert.ok(report.waits>0);assert.equal(report.paused,true)
      assert.deepEqual(report.errors,[]);assert.equal(report.shaderFailures,0)
      report.palette=await page.evaluate(`(async()=>{
        const head=document.querySelector('[data-tutorial-folder="decorOutside"] .folderHead');
        if(head.getAttribute('aria-expanded')!=='true')head.click();
        const tile=document.querySelector('[data-tile="traffic-light"]');tile.scrollIntoView({block:'center'});tile.click();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        return {armed:window.__metro.getState().moduleType,labels:['road','traffic-light'].map(id=>{
          const label=document.querySelector('[data-tile="'+id+'"] .bpBlockLabel');
          return {id,text:label.textContent,fits:label.scrollWidth<=label.clientWidth+1};
        })};
      })()`)
      assert.equal(report.palette.armed,'traffic-light')
      assert.deepEqual(report.palette.labels.map(l=>l.text),language==='en'?['Road','Traffic light']:['道路','交通灯'])
      assert.ok(report.palette.labels.every(l=>l.fits))
      await waitFor(page.evaluate,`document.querySelector('[data-tutorial-folder="decorOutside"] .folderBody').getBoundingClientRect().height>250`,{tries:20,every:100,what:'expanded outside folder'})
      await waitFor(page.evaluate,`!!document.querySelector('[data-tile="traffic-light"] img')?.complete`,{what:'traffic light thumbnail'})
      await page.evaluate(`document.querySelector('[data-tile="traffic-light"]').scrollIntoView({block:'center'})`)
      const shot=await page.send('Page.captureScreenshot',{format:'png'})
      writeFileSync(resolve(output,`${language}.png`),Buffer.from(shot.data,'base64'))
      reports.push({language,fixture,...report})
      console.log(JSON.stringify(reports.at(-1)))
    } finally {await page.close()}
  }
  writeFileSync(resolve(output,'report.json'),JSON.stringify(reports,null,2))
} finally {server.close()}
