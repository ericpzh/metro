import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MODULE_OPTIONS } from '../game/src/app/store/catalog.ts'
import { createModule } from '../game/src/build/model.ts'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/preview-audit/before.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(`.preview/perf/preview-audit-chrome-${process.pid}`), debugPort: 10000 + process.pid % 40000, softwareGpu: false })
  await waitFor(page.evaluate, '!!(window.__scene && window.__metro?.getState().metrics)')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await loadExampleStation(page, process.env.BENCH_DEMO ?? 'tanwei')
  await page.evaluate('new Promise(r=>setTimeout(r,2000))')
  const setup = await page.evaluate(`(async()=>{
    const store=window.__metro,scene=window.__scene,ghost=scene.ghostSys;
    store.setState({playing:false,tool:'module'});
    window.__audit={rows:[],errors:[],station:store.getState().station,documents:new WeakMap(),nextDocument:0};
    const logError=console.error;
    console.error=(...args)=>{__audit.errors.push(args.map(String).join(' ').slice(0,4096));logError(...args)};
    addEventListener('error',e=>__audit.errors.push(e.message));
    addEventListener('unhandledrejection',e=>__audit.errors.push(String(e.reason)));
    const original=ghost.previewDocument.resolve;
    ghost.previewDocument.resolve=function(...args){const t=performance.now(),data=original.apply(this,args);if(__audit.current){__audit.current.documentMs=(__audit.current.documentMs??0)+performance.now()-t;__audit.current.copiedDocument=data.modules!==args[0].modules;__audit.current.removedOrigin=args[2]!==null;if(!__audit.documents.has(data.modules))__audit.documents.set(data.modules,++__audit.nextDocument);__audit.current.documentId=__audit.documents.get(data.modules)}return data};
    const preview=scene.setModulePreview;
    scene.setModulePreview=function(...args){const t=performance.now();try{return preview.apply(this,args)}finally{if(__audit.current){__audit.current.previewMs=(__audit.current.previewMs??0)+performance.now()-t;__audit.current.submissions=(__audit.current.submissions??0)+1;__audit.current.candidates=args[0]?(Array.isArray(args[0])?args[0].length:1):0}}};
    for(const name of ['setGhost','setFaceGhost','setFencePreview','setCollisionHighlight']){
      const original=scene[name];scene[name]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{if(__audit.current){const stages=__audit.current.stages??={};stages[name]=(stages[name]??0)+performance.now()-t}}};
    }
    const rect=scene.renderer.domElement.getBoundingClientRect(),points=[];
    for(let row=3;row<8;row++)for(let col=3;col<8;col++){
      const p={x:rect.left+rect.width*col/10,y:rect.top+rect.height*row/10};
      const hit=scene.pick(p.x,p.y,store.getState().activeZ);if(hit?.solid)points.push({...p,cell:hit.cell});
    }
    if(points.length<2)throw Error('missing targets');
    return {points:points.slice(0,2),name:store.getState().station.name,modules:store.getState().station.modules.length};
  })()`)
  await page.send('Profiler.enable'); await page.send('Profiler.start')
  for (const option of MODULE_OPTIONS) {
    const pieces = [0,1].map(x => createModule(option.id, x, 0, 0, 'audit-preview', 0))
    for(let iteration=0;iteration<2;iteration++) {
      await page.evaluate(`(()=>{__audit.current={id:${JSON.stringify(option.id)},path:'model',iteration:${iteration}};__scene.setModulePreview(${JSON.stringify(pieces[iteration])});__audit.rows.push(__audit.current);__audit.current=null})()`)
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    }
    await page.evaluate(`__metro.setState({tool:'module',moduleType:${JSON.stringify(option.id)}});__scene.setModulePreview(null)`)
    for(let iteration=0;iteration<2;iteration++) {
      await page.evaluate(`__audit.current={id:${JSON.stringify(option.id)},path:'pointer',iteration:${iteration}};__audit.eventAt=performance.now()`)
      const point=setup.points[iteration]
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y})
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await page.evaluate(`__audit.current.twoRafMs=performance.now()-__audit.eventAt;__audit.rows.push(__audit.current);__audit.current=null`)
    }
  }
  for (const tool of ['rail','tunnel','block','wall','paint','zone','pick','delete','select']) {
    await page.evaluate(`__metro.setState({tool:${JSON.stringify(tool)},zoneBrush:'paid'})`)
    for(let iteration=0;iteration<2;iteration++) {
      await page.evaluate(`__audit.current={id:${JSON.stringify(tool)},path:'tool-hover',iteration:${iteration}};__audit.eventAt=performance.now()`)
      const point=setup.points[iteration]
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y})
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await page.evaluate(`__audit.current.twoRafMs=performance.now()-__audit.eventAt;__audit.rows.push(__audit.current);__audit.current=null`)
    }
  }
  for(const [tool,moduleType,brush] of [['block'],['wall'],['module','fence'],['module','tactile-warning'],['module','roof'],['module','stair-block'],['module','road'],['paint'],['zone',undefined,'paid'],['zone',undefined,'ticket']]) {
    const id=moduleType??brush??tool
    await page.evaluate(`__metro.setState({tool:${JSON.stringify(tool)},moduleType:${JSON.stringify(moduleType??'bench')},zoneBrush:${JSON.stringify(brush??'paid')}})`)
    for(const [phase,point,type,extra] of [
      ['hover',setup.points[0],'mouseMoved',{}],
      ['down',setup.points[0],'mousePressed',{button:'left',buttons:1,clickCount:1}],
      ['move',setup.points[1],'mouseMoved',{button:'left',buttons:1}],
    ]) {
      await page.evaluate(`__audit.current={id:${JSON.stringify(id)},path:'drag',phase:${JSON.stringify(phase)}};__audit.eventAt=performance.now()`)
      if(phase==='move') await page.evaluate('new Promise(r=>setTimeout(r,200))')
      await page.send('Input.dispatchMouseEvent',{type,...point,...extra})
      await page.evaluate('new Promise(r=>setTimeout(r,100))')
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await page.evaluate(`__audit.current.twoRafMs=performance.now()-__audit.eventAt;__audit.rows.push(__audit.current);__audit.current=null`)
    }
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...setup.points[1],button:'left',clickCount:1})
    await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
    await page.evaluate(`if(__metro.getState().station!==__audit.station)throw Error('drag cancel changed station')`)
  }
  for(const type of ['bench','glass','tactile','stair','tv','gate','exit']) {
    const id=await page.evaluate(`__metro.getState().station.modules.find(m=>m.type===${JSON.stringify(type)})?.id`)
    if(!id)continue
    await page.evaluate(`__metro.getState().liftModule(${JSON.stringify(id)});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
    const carried=await page.evaluate('!!__metro.getState().moveDraft')
    if(!carried)throw Error('move fixture could not lift '+type)
    for(let iteration=0;iteration<2;iteration++) {
      await page.evaluate(`__audit.current={id:${JSON.stringify(type)},path:'move-hover',iteration:${iteration}};__audit.eventAt=performance.now()`)
      const point=setup.points[iteration]
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y})
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await page.evaluate(`__audit.current.twoRafMs=performance.now()-__audit.eventAt;__audit.rows.push(__audit.current);__audit.current=null`)
    }
    await page.evaluate(`__metro.getState().cancelMove();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
    await page.evaluate(`if(__metro.getState().station!==__audit.station)throw Error('move cancel changed station')`)
  }
  const profile=await page.send('Profiler.stop')
  writeFileSync(output+'.cpuprofile',JSON.stringify(profile.profile))
  const result=await page.evaluate(`(()=>{if(__metro.getState().station!==__audit.station)throw Error('preview changed station');return{rows:__audit.rows,errors:__audit.errors}})()`)
  writeFileSync(output,JSON.stringify({setup,...result},null,2))
  if(result.errors.length)throw Error(JSON.stringify(result.errors))
  console.log(JSON.stringify({options:MODULE_OPTIONS.length,copies:result.rows.filter(r=>r.copiedDocument&&!r.removedOrigin).map(r=>r.id),moves:result.rows.filter(r=>r.path==='move-hover'),slowest:result.rows.toSorted((a,b)=>(b.previewMs??0)-(a.previewMs??0)).slice(0,12)},null,2))
} finally { await page?.close(); server.close() }
