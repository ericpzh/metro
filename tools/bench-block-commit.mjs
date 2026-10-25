// Real preview -> committed block input, including the first structural edit.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'
const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/block-commit/report.json')
const underground=(process.env.BENCH_VIEW??'underground')==='underground'
const piece=process.env.BENCH_PIECE??'block'
const action=process.env.BENCH_ACTION??'place'
const modulePiece=piece==='stair-block'
if(!['block','wall','half-wall','tri-upper','tri-lower','stair-block'].includes(piece)||!['place','delete','erase','move'].includes(action)||(action==='move'&&!modulePiece)||(action==='erase'&&modulePiece))throw Error('Unsupported block benchmark piece/action')
mkdirSync(dirname(output), {recursive:true})
const server = await serveDir(resolve(process.env.BENCH_DIST??'game/dist'), 0)
let page
try {
  page = await withPage({url:`http://127.0.0.1:${server.address().port}/`, profile:resolve(dirname(output),`chrome-${process.pid}`),debugPort:20000+process.pid%20000,windowSize:'1440,1000',softwareGpu:process.argv.includes('--software-gpu')})
  await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
  if (process.env.BENCH_STATION) {
    const source = readFileSync(resolve(process.env.BENCH_STATION),'utf8')
    await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click();window.__oldMetrics=__metro.getState().metrics;__metro.getState().loadFromText(${JSON.stringify(source)})`)
    await waitFor(page.evaluate,'!!__metro.getState().metrics && __metro.getState().metrics!==__oldMetrics',{tries:240,what:'imported station'})
  } else await loadExampleStation(page,process.env.BENCH_DEMO??'tanwei')
  await page.evaluate(`__metro.getState().setPlaying(false);new Promise(r=>setTimeout(r,1500))`)
  if(underground)await page.evaluate(`(() => {
    const s=__metro.getState(),scene=__scene;
    s.setHideGround(true);s.setGhostOther(false);scene.setPreset('plan');
    // setPreset frames the full street bounds. For large saves its default
    // camera distance lies beyond the 320 m fog cutoff even in orthographic
    // mode. Keep the actual floor in view, not merely ray-pickable through fog.
    const cam=scene.cameraSys,direction=cam.camera.position.clone().sub(cam.controls.target).normalize();
    cam.controls.enableDamping=false;cam.controls.target.z=s.activeZ;
    cam.camera.position.copy(cam.controls.target).addScaledVector(direction,160);
    cam.controls.update();cam.syncOrtho();scene.zoomBy(2/3);
    return new Promise(r=>setTimeout(r,500));
  })()`)
  const setup = await page.evaluate(`(() => {
    const s=__metro.getState(),scene=__scene,rect=scene.renderer.domElement.getBoundingClientRect();
    s.setTool(${JSON.stringify(modulePiece?'module':piece==='wall'?'wall':'block')});__metro.setState({moduleType:${JSON.stringify(piece)},autoWalls:false,halfWall:${piece==='half-wall'},triangles:${piece.startsWith('tri-')},triKind:${JSON.stringify(piece==='tri-lower'?'lower':'upper')},suspendedCeiling:false});
    const points=[],seen=new Set();
    const interior=${process.env.BENCH_INTERIOR !== '0'};
    const xs=s.station.cells.map(c=>c.x),ys=s.station.cells.map(c=>c.y);
    const bounds=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
    const candidates=[];
    if(${underground}){
      const camera=scene.cameraSys.activeCamera();camera.updateMatrixWorld(true);
      const floor=s.station.cells.filter(c=>c.fill==='solid'&&c.z===s.activeZ);
      for(let i=0;i<floor.length;i+=Math.max(1,Math.floor(floor.length/100))){
        const c=floor[i],v=new camera.position.constructor(c.x+.5,c.y+.5,c.z+1).project(camera);
        candidates.push({x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2});
      }
    }else for(let row=2;row<9;row++)for(let col=2;col<9;col++)candidates.push({x:rect.left+rect.width*col/10,y:rect.top+rect.height*row/10});
    for(const p of candidates){
      p.x=Math.round(p.x);p.y=Math.round(p.y);
      if(document.elementFromPoint(p.x,p.y)!==scene.renderer.domElement)continue;
      const hit=scene.pick(p.x,p.y,s.activeZ);if(!hit)continue;
      const cell=hit.solid?hit.place:hit.cell,key=cell.join(',');
      if(${underground}&&(!hit.solid||cell[2]!==s.activeZ+1))continue;
      const camera=scene.cameraSys.activeCamera(),fog=scene.ctx.scene.fog;
      if(fog&&camera.position.distanceTo(new camera.position.constructor(...hit.point))>=fog.far-5)continue;
      if(interior&&(cell[0]<bounds[0]+2||cell[0]>bounds[1]-2||cell[1]<bounds[2]+2||cell[1]>bounds[3]-2))continue;
      if(seen.has(key)||s.station.cells.some(c=>c.fill==='solid'&&c.x===cell[0]&&c.y===cell[1]&&c.z===cell[2]))continue;
      seen.add(key);points.push({...p,cell});
    }
    const b=window.__blockCommit={work:{},events:[],renders:[],allRenders:[],errors:[]};
    addEventListener('error',e=>b.errors.push(e.message));addEventListener('unhandledrejection',e=>b.errors.push(String(e.reason)));
    const wrap=(o,k,label=k)=>{const f=o[k];if(typeof f!=='function')return;o[k]=function(...a){const t=performance.now();try{return f.apply(this,a)}finally{const w=b.work[label]??={calls:0,ms:0};w.calls++;w.ms+=performance.now()-t;if(label==='render'){const end=performance.now();b.allRenders.push(end);if(b.commitEvent&&scene.ctx.stationData.cells===storeStation().cells&&scene.ctx.stationData.modules===storeStation().modules)b.renders.push(end)}}}};
    const storeStation=()=>__metro.getState().station;
    for(const [o,keys] of [[scene,['setStation']],[scene.chunks,['prepareStation','meshStation']],[scene.modules,['buildModules','retainPaintedModules','syncBatches']],[scene.level,['applyLevel']],[scene.cameraSys.raycaster,['intersectObjects']],[scene.renderer,['render']],[Storage.prototype,['setItem']]])for(const k of keys)wrap(o,k);
    const commit=s.commit;__metro.setState({commit:(...a)=>{const t=performance.now();b.commitEvent=b.currentEvent;try{return commit(...a)}finally{b.work.commit={calls:1,ms:performance.now()-t}}}});
    for(const type of ['pointerdown','pointerup']){
      let event;addEventListener(type,e=>{if(e.target!==scene.renderer.domElement)return;event={type,start:performance.now(),raysBefore:b.work.intersectObjects?.calls??0};b.currentEvent=event;b.events.push(event)},true);
      addEventListener(type,()=>{if(event){event.handlerMs=performance.now()-event.start;event.rays=(b.work.intersectObjects?.calls??0)-event.raysBefore;event=null;b.currentEvent=null}});
    }
    const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {points,fixture:{name:s.station.name,cells:s.station.cells.length,modules:s.station.modules.length,seed:s.station.seed,population:s.metrics?.population,activeZ:s.activeZ,quality:s.graphicsQuality},camera:{position:scene.cameraSys.activeCamera().position.toArray(),target:scene.cameraSys.controls.target.toArray(),fog:scene.ctx.scene.fog?[scene.ctx.scene.fog.near,scene.ctx.scene.fog.far]:null},gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:[rect.width,rect.height],pixelRatio:scene.renderer.getPixelRatio(),buffer:[scene.renderer.domElement.width,scene.renderer.domElement.height],browser:navigator.userAgent};
  })()`)
  if(process.env.BENCH_DEBUG==='1')await page.evaluate(`(()=>{for(const name of ['pick','pickModuleHit']){const original=__scene[name];__scene[name]=function(...args){const hit=original.apply(this,args);(__blockCommit.picks??=[]).push({name,args,hit,event:__blockCommit.currentEvent?.type});return hit}}})()`)
  if(process.argv.includes('--profile')){await page.send('Profiler.enable');await page.send('Profiler.start')}
  const samples=[]
  const settle=()=>page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const hover=async p=>{await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await page.evaluate('new Promise(r=>setTimeout(r,100))')}
  const gesture=async (p,button='left')=>{
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button,buttons:button==='left'?1:2,clickCount:1});await settle()
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button,buttons:0,clickCount:1});await settle()
  }
  const reset=()=>page.evaluate(`(()=>{const b=__blockCommit;b.work={};b.events=[];b.renders=[];b.allRenders=[];b.picks=[];b.commitEvent=null;b.before=__metro.getState().station;b.version=__metro.getState().version;b.roots=new Map(__scene.modules.moduleMeshes.children.map(g=>[g.userData.moduleId,g]))})()`)
  const state=()=>page.evaluate(`(()=>{const b=__blockCommit,s=__metro.getState(),before=b.before,e=b.commitEvent;
    const oldCells=new Set(before.cells.map(c=>[c.x,c.y,c.z].join(','))),newCells=new Set(s.station.cells.map(c=>[c.x,c.y,c.z].join(',')));
    const added=s.station.cells.filter(c=>!oldCells.has([c.x,c.y,c.z].join(','))),removed=before.cells.filter(c=>!newCells.has([c.x,c.y,c.z].join(',')));
    const oldIds=new Set(before.modules.map(m=>m.id)),newIds=new Set(s.station.modules.map(m=>m.id));
    return {commits:s.version-b.version,added,removed,addedModules:s.station.modules.filter(m=>!oldIds.has(m.id)),removedModules:before.modules.filter(m=>!newIds.has(m.id)),work:b.work,event:e,events:b.events,picks:b.picks,
      replaced:__scene.modules.moduleMeshes.children.filter(g=>g.userData.moduleId&&b.roots.get(g.userData.moduleId)!==g).map(g=>g.userData.moduleId),
      firstRenderMs:e?b.renders.find(t=>t>=e.start)-e.start:null,twoRafMs:e?performance.now()-e.start:null,chunkVisits:b.work.meshStation?__scene.chunks.chunkKeyCellVisits:0,meshedCells:b.work.meshStation?__scene.chunks.meshedCellVisits:0,errors:b.errors,glError:__scene.renderer.getContext().getError()}})()`)
  for(const p of setup.points){
    if(samples.length>=5)break
    await page.evaluate(`__metro.getState().setTool(${JSON.stringify(modulePiece?'module':piece==='wall'?'wall':'block')})`)
    await hover(p);await reset();await gesture(p)
    const placed=await state()
    if(!placed.commits)continue
    if(placed.commits!==1||(modulePiece?placed.addedModules.length!==1:!placed.added.length))throw Error('Unexpected placement '+JSON.stringify(placed))
    let target=p,sample=placed,pickup=null
    // Find an actually visible interior point. Rail wires can cover the exact
    // centre; thin panels leave half their nominal cell empty. These untimed
    // visibility queries must not delete an unrelated piece behind/above it.
    if(modulePiece){
      target=await page.evaluate(`(()=>{const m=${JSON.stringify(placed.addedModules[0])},cam=__scene.cameraSys.activeCamera(),r=__scene.renderer.domElement.getBoundingClientRect();for(let dx=-2;dx<=2;dx+=.25)for(let dy=-2;dy<=2;dy+=.25){const v=new cam.position.constructor(m.x+dx,m.y+dy,m.z+1).project(cam),p={x:Math.round(r.left+(v.x+1)*r.width/2),y:Math.round(r.top+(1-v.y)*r.height/2)};if(__scene.pickModule(p.x,p.y)===m.id)return p}return null})()`)
      if(!target)throw Error('New module has no visible target')
    }else{
      target=await page.evaluate(`(()=>{
        const cells=${JSON.stringify(placed.added)},keys=new Set(cells.map(c=>[c.x,c.y,c.z].join(','))),cam=__scene.cameraSys.activeCamera(),r=__scene.renderer.domElement.getBoundingClientRect();
        for(const c of cells.sort((a,b)=>b.z-a.z))for(const ox of [.25,.75,.4,.6])for(const oy of [.25,.75,.4,.6]){
          const v=new cam.position.constructor(c.x+ox,c.y+oy,c.z+1).project(cam),p={x:Math.round(r.left+(v.x+1)*r.width/2),y:Math.round(r.top+(1-v.y)*r.height/2)},hit=__scene.pick(p.x,p.y,__metro.getState().activeZ);
          if(hit?.solid&&keys.has(hit.cell.join(','))&&!__scene.pickModule(p.x,p.y))return p;
        }
        return null;
      })()`)
      if(!target)throw Error('New block has no visible target '+JSON.stringify(placed.added))
    }
    if(action==='delete'||action==='erase'){
      if(action==='delete')await page.evaluate(`__metro.getState().setTool('delete')`)
      const eraseHit=action==='erase'?await page.evaluate(`__scene.pick(${target.x},${target.y},__metro.getState().activeZ)`):null
      await hover(target);await reset();await gesture(target,action==='erase'?'right':'left');sample=await state()
      const intended=new Set(placed.added.map(c=>[c.x,c.y,c.z].join(',')))
      const column=action==='erase'&&piece==='wall'?{x:eraseHit.cell[0],y:eraseHit.cell[1],z:eraseHit.cell[2]}:null
      const minZ=column?Math.floor(column.z/5)*5+1:0,topZ=column?minZ+4:0
      const allowed=c=>intended.has([c.x,c.y,c.z].join(','))||column&&c.x===column.x&&c.y===column.y&&c.z>=minZ&&c.z<=topZ
      const wrongCells=!sample.removed.length||sample.removed.some(c=>!allowed(c))
      const removedKeys=new Set(sample.removed.map(c=>[c.x,c.y,c.z].join(',')))
      if(sample.commits!==1||(modulePiece?sample.removedModules[0]?.id!==placed.addedModules[0].id:wrongCells)||column&&placed.added.filter(c=>c.z>=minZ&&c.z<=topZ).some(c=>!removedKeys.has([c.x,c.y,c.z].join(','))))throw Error('Unexpected delete '+JSON.stringify({sample,placed,target}))
    }else if(action==='move'){
      await page.evaluate(`__metro.getState().setTool('move')`);await hover(target);await reset();await gesture(target)
      pickup=await page.evaluate(`(()=>{const b=__blockCommit,e=b.events[0];return {event:e,firstRenderMs:b.allRenders.find(t=>t>=e.start)-e.start,commits:__metro.getState().version-b.version}})()`)
      if(!await page.evaluate('!!__metro.getState().moveDraft'))throw Error('Move pickup missed placed module')
      let valid=false
      for(const destination of setup.points){
        if(destination===p||destination.cell[0]===p.cell[0]&&destination.cell[1]===p.cell[1])continue
        await hover(destination)
        if(await page.evaluate(`!!__metro.getState().moveDraft&&!__metro.getState().moveDraft.reason`)){target=destination;valid=true;break}
      }
      if(!valid)throw Error('No valid move destination')
      await reset();await gesture(target);sample=await state()
      if(sample.commits!==1||await page.evaluate('!!__metro.getState().moveDraft'))throw Error('Move did not commit')
      sample.movedId=placed.addedModules[0].id;sample.pickup=pickup
    }
    if(sample.events.some(e=>e.rays>1)||sample.errors.length||sample.glError||!Number.isFinite(sample.firstRenderMs))throw Error('Invalid interaction '+JSON.stringify(sample))
    if(action==='place'&&underground){
      const hit=await page.evaluate(`__scene.pick(${target.x},${target.y},__metro.getState().activeZ)`)
      if(modulePiece){
        const id=await page.evaluate(`__scene.pickModule(${target.x},${target.y})`)
        if(id!==placed.addedModules[0].id)throw Error('Placed module is not visible/pickable '+id)
        sample.visibleModule=id
      }else{
        if(!hit?.solid||!placed.added.some(c=>JSON.stringify([c.x,c.y,c.z])===JSON.stringify(hit.cell)))throw Error('Committed block is not visible/pickable: '+JSON.stringify({point:p,hit}))
        sample.visibleCell=hit.cell
      }
    }
    sample.point=p;sample.target=target
    samples.push(sample);console.log(`${piece} ${action} #${samples.length}: event-to-render ${sample.firstRenderMs.toFixed(1)} ms; handler ${sample.event.handlerMs.toFixed(1)} ms`)
    writeFileSync(output,JSON.stringify({piece,action,setup,samples},null,2))
    if(samples.length===1){const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(output.replace(/\.json$/,'-first.png'),Buffer.from(shot.data,'base64'))}
    await page.evaluate('new Promise(r=>setTimeout(r,1000))')
  }
  if(process.argv.includes('--profile'))writeFileSync(output.replace(/\.json$/,'.cpuprofile'),JSON.stringify((await page.send('Profiler.stop')).profile))
  writeFileSync(output,JSON.stringify({piece,action,setup,samples},null,2))
  if(samples.length!==5)throw Error('Expected five successful placements')
}finally{if(page)await page.close();server.close()}
