// Real production gesture: plant a row of 树木 on the street and measure every
// stage of the interaction (hover ghost, press commit, worker response). The
// control pieces (`PIECE=bin` inert prop, `PIECE=lawn` surface tile) run the
// same gesture on the same fixture.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {serveDir,withPage,waitFor,loadExampleStation} from './browser-harness.mjs'

const piece=process.env.PIECE??'tree'
const count=Number(process.env.COUNT??4)
const output=resolve(process.env.BENCH_OUTPUT??`.preview/perf/tree-${piece}.json`)
mkdirSync(dirname(output),{recursive:true})
const server=await serveDir(resolve('game/dist'),0)
let page,profile
try {
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(`.preview/perf/tree-chrome-${process.pid}`),debugPort:9411,softwareGpu:process.env.METRO_BROWSER_GPU!=='hardware',windowSize:'1440,1000'})
  await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'game'})
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  if(process.env.BENCH_STATION) await page.evaluate(`window.__metro.getState().loadFromText(${JSON.stringify(readFileSync(process.env.BENCH_STATION,'utf8'))})`)
  else await loadExampleStation(page)
  const fixture=await page.evaluate(`(async()=>{
    const store=window.__metro,s=store.getState(),scene=window.__scene
    s.setActiveZ(0);store.setState({tool:'module',moduleType:${JSON.stringify(piece)},moduleRot:0,playing:false})
    const maxX=s.station.modules.reduce((hi,m)=>Math.max(hi,m.x+(m.w??1)-1),s.station.cells.reduce((hi,c)=>Math.max(hi,c.x),0))
    const empty=(x,y)=>!s.station.modules.some(m=>m.z===0&&x>=m.x&&x<m.x+(m.w??1)&&y>=m.y&&y<m.y+(m.d??1))
    const line=([x0,y0],[dx,dy],n)=>{const out=[];for(let i=0;i<n;i++){let x=x0+dx*i,y=y0+dy*i;while(!empty(x,y))y++;out.push([x,y,0])}return out}
    // bare street inside the generated ground window. SKIP_LAWN=1 drops the
    // pre-laid tiles, so a row that steps outward widens the drawn plane itself:
    // the one case where an inert prop still needs the ground and its graph.
    const skipLawn=${process.env.SKIP_LAWN === '1'}
    window.__tbRows={bare:line([maxX+4,0],skipLawn?[2,0]:[0,2],${count})}
    // a second row: tiles the player laid first, then planted on
    if(!skipLawn){
      const tiles=line([maxX+4,30],[0,2],${count})
      s.commit({...s.station,modules:[...s.station.modules,...tiles.map(([x,y,z],i)=>({id:'bench-lawn-'+i,type:'lawn',x,y,z,rot:0,cfg:{}}))]})
      window.__tbRows.lawn=tiles
    }
    window.__tbRowsRef=window.__tbRows
    scene.setPreset('plan');scene.setOrtho(true);scene.cameraSys.controls.enableDamping=false
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    window.__tb={samples:[],sceneCalls:[],errors:[],commits:0,phase:'idle',notices:[],previews:[]}
    addEventListener('error',e=>__tb.errors.push(e.message));addEventListener('unhandledrejection',e=>__tb.errors.push(String(e.reason)))
    let last=store.getState().metrics
    store.subscribe(st=>{if(st.metrics!==last){last=st.metrics;if(__tb.lastEditAt)__tb.lastMetricsAt=performance.now()}})
    const commit=store.getState().commit;store.setState({commit:(...args)=>{__tb.commits++;return commit(...args)}})
    const notice=store.getState().setNotice;store.setState({setNotice:(...args)=>{__tb.notices.push({phase:__tb.phase,text:String(args[0])});return notice(...args)}})
    const preview=scene.setModulePreview
    scene.setModulePreview=function(mods,...rest){const list=mods?(Array.isArray(mods)?mods:[mods]):[];__tb.previews.push({phase:__tb.phase,mods:list.length,types:list.map(m=>m.type).join(','),blocked:Boolean(rest[0])});return preview.call(this,mods,...rest)}
    for(const [object,key] of [[scene,'pickModule'],[scene,'setStation'],[scene.chunks,'meshStation'],[scene.modules,'buildModules']]){
      const original=object[key]
      object[key]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{const stat=__tb.sceneCalls[key]??={calls:0,ms:0};stat.calls++;stat.ms+=performance.now()-t}}
    }
    const Vector=scene.cameraSys.activeCamera().position.constructor
    // Aim *and* pick-verify one row against the camera as it is right now: the
    // screen points are only meaningful for the pose they were computed in.
    window.__tbAim=async(label)=>{const cells=__tbRowsRef[label],cam=scene.cameraSys,mid=cells[Math.floor(cells.length/2)]
      cam.controls.target.set(mid[0],mid[1],1);cam.camera.position.set(mid[0],mid[1],240);cam.controls.update()
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      const c=cam.activeCamera();c.updateMatrixWorld(true)
      const rect=scene.renderer.domElement.getBoundingClientRect()
      const points=cells.map(([x,y,z])=>{const v=new Vector(x+.5,y+.5,z+1).project(c);return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}})
      const hits=points.map((p,i)=>{const hit=scene.pick(p.x,p.y,0);return hit?{want:cells[i],cell:hit.cell,solid:hit.solid}:null})
      return {points,hits}}
    // Aim at one cell: the delete pass needs the piece under the pointer, not a row.
    window.__tbAimCell=async([x,y,z])=>{const cam=scene.cameraSys
      cam.controls.target.set(x,y,1);cam.camera.position.set(x,y,240);cam.controls.update()
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      const c=cam.activeCamera();c.updateMatrixWorld(true)
      const rect=scene.renderer.domElement.getBoundingClientRect()
      const v=new Vector(x+.5,y+.5,z+1).project(c)
      const point={x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}
      return {point,moduleId:scene.pickModule(point.x,point.y)}}
    return {name:s.station.name,cells:s.station.cells.length,modules:s.station.modules.length,seed:s.station.seed,maxX,rows:Object.fromEntries(Object.entries(window.__tbRows).map(([k,v])=>[k,v.length])),
      browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
      gpu:(()=>{const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)})(),
      draws:scene.renderer.info.render.calls,triangles:scene.renderer.info.render.triangles}
  })()`)
  const event=async(phase,method,params)=>{
    await page.evaluate(`__tb.phase=${JSON.stringify(phase)};__tb.lastEditAt=performance.now();__tb.lastMetricsAt=null;__tb.start=performance.now()`)
    await page.send(method,params)
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const row=await page.evaluate(`({twoRafMs:performance.now()-__tb.start,workerMs:__tb.lastMetricsAt?__tb.lastMetricsAt-__tb.lastEditAt:null,work:JSON.parse(JSON.stringify(__tb.sceneCalls))})`)
    await page.evaluate(`__tb.sceneCalls={}`)
    const sample={phase,...row}
    await page.evaluate(`__tb.samples.push(${JSON.stringify(sample)})`)
    return sample
  }
  if(process.env.BENCH_PROFILE==='1'){await page.send('Profiler.enable');await page.send('Profiler.start')}
  const aims={}
  for(const label of Object.keys(fixture.rows)){
    const aim=await page.evaluate(`__tbAim(${JSON.stringify(label)})`)
    aims[label]=aim
    for(let i=0;i<aim.points.length;i++){
      const p=aim.points[i]
      await event(`${label}:${i}:hover`,'Input.dispatchMouseEvent',{type:'mouseMoved',...p})
      await event(`${label}:${i}:down`,'Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1})
      await event(`${label}:${i}:up`,'Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1})
    }
  }
  if(process.env.BENCH_PROFILE==='1')profile=(await page.send('Profiler.stop')).profile
  // The delete pass: the inert fast path is the same one that once left a deleted
  // piece drawing until reload, so lift one tree back out through the real tool and
  // read the drawn geometry, not the document.
  let deleted=null
  if(process.env.DELETE==='1'){
    const cells=await page.evaluate(`__tbRowsRef[${JSON.stringify(Object.keys(fixture.rows).at(-1))}]`)
    const last=cells[cells.length-1]
    await page.evaluate(`__metro.setState({tool:'delete'})`)
    const at=await page.evaluate(`__tbAimCell(${JSON.stringify(last)})`)
    await event('delete:hover','Input.dispatchMouseEvent',{type:'mouseMoved',...at.point})
    await event('delete:down','Input.dispatchMouseEvent',{type:'mousePressed',...at.point,button:'left',buttons:1,clickCount:1})
    await event('delete:up','Input.dispatchMouseEvent',{type:'mouseReleased',...at.point,button:'left',buttons:0,clickCount:1})
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    deleted={target:last,pointedModuleId:at.moduleId,...await page.evaluate(`({pieces:__metro.getState().station.modules.filter(m=>m.type===${JSON.stringify(piece)}).length,notice:__metro.getState().notice,draws:__scene.renderer.info.render.calls,triangles:__scene.renderer.info.render.triangles,allTrees:__metro.getState().station.modules.filter(m=>m.type==='tree').length,moduleMeshes:__scene.modules.moduleMeshes.children.filter(g=>typeof g.userData.moduleId==='string').length})`)}
  }
  const status=await page.evaluate(`({modules:__metro.getState().station.modules.length,placed:__metro.getState().station.modules.filter(m=>m.type===${JSON.stringify(piece)}).length,draws:__scene.renderer.info.render.calls,triangles:__scene.renderer.info.render.triangles,shaderFailures:__scene.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,errors:__tb.errors,commits:__tb.commits,notices:__tb.notices,previews:__tb.previews,samples:__tb.samples})`)
  const report={piece,count,fixture,aims,status,deleted,profiled:!!profile,hardwareGpu:process.env.METRO_BROWSER_GPU==='hardware'}
  writeFileSync(output,JSON.stringify(report,null,2))
  if(profile)writeFileSync(output.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile))
  const fmt=(s)=>`${s.phase.padEnd(16)} twoRaf ${s.twoRafMs.toFixed(0).padStart(5)} ms  metrics ${s.workerMs===null?'    -':s.workerMs.toFixed(0).padStart(5)} ms  ${Object.entries(s.work).map(([k,v])=>`${k}:${v.calls}x${v.ms.toFixed(1)}`).join(' ')}`
  console.log(JSON.stringify({piece,env:{name:fixture.name,cells:fixture.cells,modules:fixture.modules,gpu:fixture.gpu},end:{modules:status.modules,placed:status.placed,draws:status.draws,triangles:status.triangles,beforeDraws:fixture.draws,beforeTriangles:fixture.triangles,commits:status.commits,errors:status.errors}},null,2))
  for(const s of status.samples)console.log(fmt(s))
  for(const [label,aim] of Object.entries(aims))console.log(`aim ${label.padEnd(6)}`,aim.hits.map(h=>h?`${h.solid?'solid':'air  '}[${h.cell}]`:'miss').join(' '))
  console.log('previews:',status.previews.map(p=>`${p.phase} mods=${p.mods} ${p.types} blocked=${p.blocked}`).join(' | '))
  if(deleted)console.log('delete:',JSON.stringify(deleted))
} finally {await page?.close();server.close()}
