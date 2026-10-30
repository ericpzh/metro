import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output = resolve('.preview/perf/exploded-view')
mkdirSync(output, {recursive:true})
const server = await serveDir(resolve('game/dist'), 0)
const reports = []
try {
  for (const id of process.env.BENCH_STATION ? ['station'] : ['zoo', 'tanwei']) {
    const page = await withPage({url:`http://127.0.0.1:${server.address().port}/`, profile:resolve(output,`chrome-${id}-${process.pid}`),softwareGpu:false})
    try {
      await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', {what:'app'})
      if (process.env.BENCH_STATION) {
        const text = readFileSync(resolve(process.env.BENCH_STATION),'utf8')
        await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(text)})`)
        await waitFor(page.evaluate, '!!__scene.ctx.stationData && __scene.ctx.stationData.cells.length > 0', {what:'loaded station'})
      } else await loadExampleStation(page, id)
      await page.evaluate(`__metro.getState().setPlaying(false);window.__explodeErrors=[];window.addEventListener('error',e=>__explodeErrors.push(e.message));window.addEventListener('unhandledrejection',e=>__explodeErrors.push(String(e.reason)))`)
      await page.evaluate(`const proto=__scene.constructor.prototype;const setup=proto.setStandalonePresentation;proto.setStandalonePresentation=function(){window.__explodedScene=this;return setup.call(this)}`)
      const runs = []
      for (let n=0;n<2;n++) {
        const report = await page.evaluate(`(async()=>{
          const state=__metro.getState(),station=state.station,version=state.version,past=state.past;
          const start=performance.now();
          state.setExplodedView(true);
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const shellMs=performance.now()-start;
          while(document.querySelector('.explodedViewer')?.dataset.ready!=='true')await new Promise(r=>requestAnimationFrame(r));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const dialog=document.querySelector('.explodedViewer');
          if(!dialog?.open)throw Error('viewer did not open');
          const canvas=dialog.querySelector('canvas');
          if(canvas.width<100||canvas.height<100)throw Error('canvas not sized');
          const now=__metro.getState();
          const guides=__explodedScene.explodedLayout.connections;
          if(!guides?.connections.length)throw Error('floor connection guides missing');
          window.__guidePositions=guides.lines.geometry.attributes.position.array.slice();
          if(now.station!==station||now.version!==version||now.past!==past)throw Error('presentation edited document');
          if(dialog.textContent.includes('拖动旋转')||!dialog.querySelector('.explodedBack'))throw Error('old toolbar remains');
          if(dialog.querySelectorAll('header .seg button').length!==5)throw Error('speed bar missing');
          if(__explodedScene.controls.mouseButtons.LEFT!==0||__explodedScene.controls.mouseButtons.MIDDLE!==0)throw Error('incorrect orbit/pan controls');
          return {shellMs,openMs:performance.now()-start,levels:dialog.querySelector('footer').textContent,width:canvas.width,height:canvas.height};
        })()`)
        await page.evaluate('new Promise(r=>setTimeout(r,1500))')
        if(n===0) {
          const shot=await page.send('Page.captureScreenshot',{format:'png'})
          writeFileSync(resolve(output,`${id}.png`),Buffer.from(shot.data,'base64'))
          const live=await page.evaluate(`(async()=>{
            const scene=__explodedScene,version=__metro.getState().version,tick=__metro.getState().metrics.tick;
            const editorTrains=__scene.trains.lastBuffer;
            const editorModels=__scene.trains.trainGroup.children.slice();
            document.querySelectorAll('.explodedToolbar .seg button')[3].click();
            await new Promise(r=>setTimeout(r,1800));
            if(!__metro.getState().playing||__metro.getState().speed!==16)throw Error('speed control did not resume');
            if(__metro.getState().metrics.tick<=tick)throw Error('simulation did not advance');
            if(scene.crowd.agentCount<=0||scene.crowd.agentCount>__scene.crowd.agentCount)throw Error('viewer did not receive visible live passengers');
            const rooms=scene.ctx.stationData.cells.filter(c=>c.z===0&&(c.room||c.zone==='restricted'));
            if(${JSON.stringify(id)}==='tanwei'&&rooms.length<500)throw Error('ground rooms were removed');
            if(scene.ctx.stationData.modules.some(m=>m.type==='pillar'&&m.z===0&&m.cfg.bridgeId))throw Error('outdoor bridge pillar remains');
            const frames=scene.framesRendered;
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            if(scene.framesRendered<=frames)throw Error('live viewer did not render');
            document.querySelector('.explodedToolbar .seg button').click();
            if(__metro.getState().playing)throw Error('pause did not apply');
            if(__metro.getState().version!==version)throw Error('playback edited station');
            if(__scene.trains.lastBuffer!==editorTrains||editorModels.some((model,i)=>__scene.trains.trainGroup.children[i]!==model))throw Error('suspended editor rebuilt trains');
            if(!__scene.deferredTrains)throw Error('suspended editor lost latest train snapshot');
            return {ticks:__metro.getState().metrics.tick-tick,agents:scene.crowd.agentCount,totalAgents:__scene.crowd.agentCount,trains:scene.trains.trainGroup.children.length};
          })()`)
          Object.assign(report,{live})
          const before=await page.evaluate('({viewer:__explodedScene.controls.target.toArray(),main:__scene.controls.target.toArray()})')
          await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87})
          const held=await page.evaluate('({keys:[...__explodedScene.keys],suspended:__explodedScene.suspended,frame:__explodedScene.lastFrame,focus:document.activeElement?.outerHTML.slice(0,150)})')
          await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
          await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87})
          const after=await page.evaluate('({viewer:__explodedScene.controls.target.toArray(),main:__scene.controls.target.toArray()})')
          assert.notDeepEqual(after.viewer,before.viewer,`W pans the viewer ${JSON.stringify(held)}`)
          assert.deepEqual(after.main,before.main,'viewer input preserves the editor camera')
          const point=await page.evaluate(`(()=>{const r=document.querySelector('.explodedViewer canvas').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`)
          for(const button of ['middle','right']) {
            const initial=await page.evaluate(`({position:__explodedScene.controls.object.position.toArray(),target:__explodedScene.controls.target.toArray()})`)
            const buttons=button==='left'?1:button==='middle'?4:2
            await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,buttons,clickCount:1})
            await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+65,y:point.y+20,button,buttons})
            await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+65,y:point.y+20,button,buttons:0,clickCount:1})
            await page.evaluate('new Promise(r=>setTimeout(r,120))')
            const moved=await page.evaluate(`({position:__explodedScene.controls.object.position.toArray(),target:__explodedScene.controls.target.toArray()})`)
            assert.notDeepEqual(moved.position,initial.position,`${button} drag moves the camera`)
            if(button==='right')assert.notDeepEqual(moved.target,initial.target,`${button} drag pans`)
          }
        }
        const tool=await page.evaluate('__metro.getState().tool')
        const layoutBefore = await page.evaluate(`(()=>{
          const scene=__explodedScene,layout=scene.explodedLayout,camera=scene.cameraSys.activeCamera();
          scene.settleExplodedCamera();camera.updateMatrixWorld();layout.root.updateWorldMatrix(true,true);
          window.__layoutDocument=__metro.getState().station;window.__layoutVersion=__metro.getState().version;
          const r=document.querySelector('.explodedViewer canvas').getBoundingClientRect();
          for(const floor of layout.floors)for(const mesh of floor.children){
            const p=mesh.geometry.attributes.position;
            for(let i=0;i<p.count;i+=Math.max(3,Math.floor(p.count/120/3)*3)){
              const v=new scene.controls.target.constructor((p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3);
              v.applyMatrix4(mesh.matrixWorld).project(camera);
              if(Math.abs(v.x)>.85||Math.abs(v.y)>.8)continue;
              const index=layout.pick(v.x,v.y,camera);if(index===null)continue;
              window.__layoutGeometry=layout.floors[index].children.map(m=>({geometry:m.geometry,position:m.geometry.attributes.position.array.slice()}));
              return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2,index,target:scene.controls.target.toArray()};
            }
          }
          throw Error('no visible floor to select');
        })()`)
        const layoutStart=performance.now()
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:layoutBefore.x,y:layoutBefore.y,button:'left',buttons:1,clickCount:1})
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:layoutBefore.x,y:layoutBefore.y,button:'left',buttons:0,clickCount:1})
        assert.equal(await page.evaluate('__explodedScene.explodedLayout.selected'),layoutBefore.index,'click directly selects floor')
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:layoutBefore.x,y:layoutBefore.y,button:'left',buttons:1,clickCount:1})
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:layoutBefore.x+120,y:layoutBefore.y-80,button:'left',buttons:1})
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:layoutBefore.x+120,y:layoutBefore.y-80,button:'left',buttons:0,clickCount:1})
        const layoutResult=await page.evaluate(`new Promise((resolve,reject)=>requestAnimationFrame(()=>requestAnimationFrame(()=>{try{
          const scene=__explodedScene,layout=scene.explodedLayout,index=layout.selected;
          const guides=layout.connections,positions=guides.lines.geometry.attributes.position;
          guides.connections.forEach((connection,i)=>{
            [connection.lower,connection.upper].forEach((floor,end)=>{
              const o=i*6+end*3,shift=layout.shifts[floor];
              [shift.x,shift.y,shift.z].forEach((value,axis)=>{
                if(Math.abs(positions.array[o+axis]-__guidePositions[o+axis]-value)>1e-4)throw Error('guide endpoint detached from floor');
              });
            });
          });
          const failed=scene.renderer.info.programs.find(program=>program.diagnostics?.runnable===false);
          if(failed)throw Error('floor shader failed: '+JSON.stringify(failed.diagnostics));
          if(index===null||!layout.shifts[index].lengthSq())throw Error('floor drag did not move selected floor');
          if(layout.shifts.some((v,i)=>i!==index&&v.lengthSq()))throw Error('drag moved another floor');
          layout.floors[index].children.forEach((mesh,i)=>{
            const before=__layoutGeometry[i];if(mesh.geometry!==before.geometry)throw Error('drag rebuilt geometry');
            const now=mesh.geometry.attributes.position.array;if(now.some((v,k)=>v!==before.position[k]))throw Error('drag stretched vertices');
          });
          if(__metro.getState().station!==__layoutDocument||__metro.getState().version!==__layoutVersion)throw Error('floor drag edited station');
          resolve({shift:layout.shifts[index].toArray(),target:scene.controls.target.toArray()});
        }catch(error){reject(error)}})))`)
        assert.ok(layoutResult.target.every((v,i)=>Math.abs(v-layoutBefore.target[i])<1e-9),'floor drag preserves camera target')
        report.layoutDragMs=performance.now()-layoutStart
        if (n===0) {
          const shot=await page.send('Page.captureScreenshot',{format:'png'})
          writeFileSync(resolve(output,`${id}-arranged.png`),Buffer.from(shot.data,'base64'))
        }
        const empty=await page.evaluate(`(()=>{const r=document.querySelector('.explodedViewer canvas').getBoundingClientRect();return{x:r.left+10,y:r.top+10}})()`)
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...empty,button:'left',buttons:1,clickCount:1})
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...empty,button:'left',buttons:0,clickCount:1})
        assert.equal(await page.evaluate('__explodedScene.explodedLayout.selected'),null,'empty space deselects')
        await page.evaluate(`(()=>{
          document.querySelector('.explodedToolbar > button').click();
          if(__explodedScene.explodedLayout.shifts.some(v=>v.lengthSq()))throw Error('reset failed');
          const positions=__explodedScene.explodedLayout.connections.lines.geometry.attributes.position.array;
          if(positions.some((v,i)=>v!==__guidePositions[i]))throw Error('guide reset failed');
        })()`)
        const deferred=await page.evaluate('Array.from(__scene.deferredTrains??[])')
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'b',code:'KeyB',windowsVirtualKeyCode:66})
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'b',code:'KeyB',windowsVirtualKeyCode:66})
        assert.equal(await page.evaluate('__metro.getState().tool'),tool)
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
        await waitFor(page.evaluate, '!document.querySelector(".explodedViewer")', {what:'return to editor'})
        if(deferred.length) assert.deepEqual(await page.evaluate('Array.from(__scene.trains.lastBuffer)'),deferred,'returning applies the latest held train poses')
        assert.equal(await page.evaluate('__scene.deferredTrains'),null)
        runs.push(report)
      }
      const errors=await page.evaluate('__explodeErrors')
      assert.deepEqual(errors,[])
      reports.push({id,runs,errors})
      console.log(JSON.stringify(reports.at(-1)))
    } finally { await page.close() }
  }
  writeFileSync(resolve(output,'report.json'),JSON.stringify(reports,null,2))
} finally {server.close()}
