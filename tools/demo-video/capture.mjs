import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { loadExampleStation, waitFor } from '../browser-harness.mjs'
import { command } from './media.mjs'
import {stageDocument} from './fixtures.mjs'
import {prepareMontage,startMontage} from './montage.mjs'
import {prepareEditing as prepareEmptyEditing,editingAction} from './editing.mjs'
import {prepareExtraView,extraViewAction} from './views.mjs'
import {prepareTianheFlythrough,flyTianhe,waitForTianheConcourseCrowd} from './tianhe.mjs'
import {ui} from '../../web/src/i18n.js'
import {prepareInterior,interiorAction} from './interior.mjs'
import {prepareAuthored,authoredAction} from './authored-shot.mjs'

const twoFrames = 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
const cinematicCSS = `
body[data-video-clean] .app>.main { display:block!important; height:100vh!important; width:100vw!important }
body[data-video-clean] .app { display:block!important; height:100vh!important }
body[data-video-clean] .app>:not(.main),body[data-video-clean] .sideShell,
body[data-video-clean] .viewNav,body[data-video-clean] .buildMeasure { display:none!important }
body[data-video-clean] .stage { width:100vw!important;height:100vh!important;position:relative!important }
body[data-video-clean] .viewport { width:100%!important;height:100%!important }
body[data-video-clean] .stage>:not(canvas) { display:none!important }
body[data-video-clean] .app>.explodedViewer { display:block!important }
body[data-video-clean] .explodedToolbar,body[data-video-clean] .explodedLevels { visibility:hidden!important }
body[data-video-clean] .explodedViewer canvas { position:absolute!important;inset:0!important;width:100%!important;height:100%!important }
body[data-video-clean] .explodedViewer { padding:0!important;gap:0!important }
body[data-video-locale="zh"] .stationNameEnglish { display:none!important }
body[data-video-locale="zh"] .bottombar>.metric:nth-last-child(2) { display:none!important }
body[data-video-cube] .viewNavShell { transform:scale(1.7);transform-origin:top right;z-index:8 }
body[data-video-locale] .viewOrthoBtn { display:none!important }
`

export async function prepareShot(page, shot,settings={language:'zh'}) {
  await page.evaluate(`(()=>{window.__videoMotionToken=(window.__videoMotionToken??0)+1;window.__videoOrbit=null;window.__videoFocus=null;document.body.dataset.videoLocale=${JSON.stringify(settings.language)};document.body.removeAttribute('data-video-clean');document.body.removeAttribute('data-video-cube');__metro.getState().setExplodedView(false)})()`)
  await page.evaluate("window.__videoInteriorToken=(window.__videoInteriorToken??0)+1;document.getElementById('video-placement-label')?.remove()")
  if(!settings.reuseStation){
    if(shot.station==='empty'){
      const doc=stageDocument(shot,shot.stationName,ui[settings.language].nav.brand)
      await page.evaluate(`(()=>{const s=__metro.getState();s.setPlaying(false);s.newStation();s.commit({...__metro.getState().station,...${JSON.stringify(doc)}})})()`)
      await waitFor(page.evaluate,`__scene.ctx.stationData?.name===${JSON.stringify(doc.name)}&&${doc.modules[0]?`__scene.ctx.stationData.modules.some(m=>m.id===${JSON.stringify(doc.modules[0].id)})`:'__scene.ctx.stationData.modules.length===0'}`,{what:'empty recording stage'})
    }else await loadExampleStation(page, shot.station)
  }
  // Select the game's default Blueprint theme through its normal setting action.
  // Each click gets a render before the next so its React closure is current.
  for (let i=0;i<3;i++) {
    if (await page.evaluate("document.documentElement.dataset.uiTheme==='blueprint'")) break
    await page.evaluate("[...document.querySelectorAll('button.settingsAction')].at(-1)?.click()")
    await page.evaluate(twoFrames)
  }
  if (!await page.evaluate("document.documentElement.dataset.uiTheme==='blueprint'")) throw new Error('Blueprint theme action missing')
  await page.evaluate(`(() => {
    const s=__metro.getState();s.setPlaying(false);s.setSpeed(1);s.setGraphicsQuality('high');s.setUpscalingMode('native');
    s.setEdgeScrolling(false);s.setTool('select');s.select(null);s.setNotice(null);s.setTimePanel(false);s.setChartsPanel(false);
    s.setHideUI(false);s.setGhostOther(false);s.setAutoCeiling(true);s.setHideRoof(true);s.setHideGround(true);s.setHideWalls(false);
    s.setCutaway(false);s.setHideSectionSurface(true);s.setActiveZ(${shot.level ?? (shot.station === 'zoo' ? -15 : 10)});
    let style=document.getElementById('video-presentation');if(!style){style=document.createElement('style');style.id='video-presentation';document.head.append(style)}
    style.textContent=${JSON.stringify(cinematicCSS)};
    if(!${['blocks', 'equipment', 'demand','cube'].includes(shot.kind)})document.body.setAttribute('data-video-clean','');
    window.__videoScene=__scene;window.__videoErrors=[];
    if(!window.__videoErrorHandlers){window.__videoErrorHandlers=true;addEventListener('error',e=>__videoErrors.push(e.message));addEventListener('unhandledrejection',e=>__videoErrors.push(String(e.reason)))}
  })()`)
  await sleep(700)
  await page.evaluate("document.querySelector('.tutorialActions .ghost')?.click()")
  if (shot.city) {
    await page.evaluate(`__metro.getState().setCityStyle(${JSON.stringify(shot.city)})`)
    await sleep(900)
  }
  if (shot.stock&&!shot.stage) {
    await page.evaluate(`(()=>{const s=__metro.getState();s.updateLine(s.station.lines[0].id,{stock:${JSON.stringify(shot.stock)},cars:${shot.stock === 'D' ? 8 : shot.stock === 'A' ? 6 : 4},power:${JSON.stringify(['A', 'D'].includes(shot.stock) ? 'catenary' : 'third-rail')}})})()`)
    await sleep(1000)
  }
  if(shot.kind==='placement')await prepareAuthored(page,shot,settings.language)
  else if(['blocks','colours'].includes(shot.kind))await prepareInterior(page,shot,settings.language)
  else if(shot.stage)await prepareMontage(page,shot,settings.bridgeStartX)
  else if(['section','cube'].includes(shot.kind))await prepareExtraView(page,shot)
  else if(shot.view==='flythrough')await prepareTianheFlythrough(page,shot)
  else if (shot.view === 'exploded') {
    await page.evaluate(`__metro.getState().setExplodedView(true)`)
    await waitFor(page.evaluate, `document.querySelector('.explodedViewer')?.dataset.equipped==='true'&&!!window.__benchmarkScene?.explodedLayout`, { tries: 200, what: 'fully equipped exploded view' })
    await frameExploded(page,shot.station)
  } else if (shot.view === 'exterior') {
    await page.evaluate(`(()=>{const s=__metro.getState();s.setHideUI(true);s.setHideGround(false);s.setHideRoof(false);const c=__scene.cameraSys;c.setOrtho(false);c.setFov(55);c.controls.enableDamping=false;c.controls.target.set(12,2,8);c.camera.position.copy(c.controls.target).add(new c.camera.position.constructor(32,-38,72));c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender()})()`)
  } else if (shot.view === 'entrance') {
    await page.evaluate(`(()=>{
      const s=__metro.getState();s.setActiveZ(0);s.setHideUI(false);s.setHideGround(false);s.setGhostOther(false);s.setHideRoof(false);
      const m=s.station.modules.find(m=>m.type==='exit'&&!m.cfg.style&&m.z===0);
      if(!m)throw Error('No covered ground entrance for city montage');window.__videoFocus=m;
      s.commit({...s.station,modules:s.station.modules.map(p=>p.id===m.id?{...p,cfg:{...p.cfg,covered:true}}:p)});
      const c=__scene.cameraSys;c.setOrtho(false);c.controls.target.set(m.x+.5,m.y+1,m.z+2.3);
      c.camera.position.set(m.x+11,m.y+16,m.z+9);c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
    })()`)
  } else if (shot.view === 'platform') {
    await page.evaluate(`(()=>{const s=__metro.getState();s.setActiveZ(${shot.station === 'zoo' ? -15 : 10});s.setGhostOther(false);s.setHideUI(false);s.setHideRoof(true);s.setHideWalls(${shot.station !== 'zoo'});s.setAutoCeiling(true);s.setSpeed(64);s.setPlaying(true)})()`)
    const z = shot.station === 'zoo' ? -15 : 11
    await waitFor(page.evaluate, `(()=>{if((__metro.getState().metrics?.population??0)<150)return false;const b=__scene.trains.lastBuffer;for(let i=0;i<b.length;i+=10)if(Math.abs(b[i+2]-(${z}))<1&&b[i+5]>.5)return true;return false})()`, { tries: 180, every: 250, what: `${shot.id} real train at open doors` })
    await page.evaluate(`__metro.getState().setPlaying(false);__metro.getState().setSpeed(${shot.kind === 'stock' ? 1 : 4})`)
    await page.evaluate(`(()=>{
      const s=__metro.getState(),track=s.station.modules.find(m=>m.type==='track'&&!m.cfg.tunnel&&!m.cfg.bridge&&m.z===${z});
      if(!track)throw Error('No platform track');window.__videoFocus=track;
      const c=__scene.cameraSys;c.setOrtho(false);
      const x=track.x+(${shot.kind === 'stock' ? 7 : 42}),y=track.y+4;
      c.controls.target.set(x,y,track.z+1.6);c.camera.position.set(x+${shot.kind === 'stock' ? 18 : 30},y+${shot.kind === 'stock' ? 22 : 34},track.z+${shot.kind === 'stock' ? 12 : 21});
      if(${shot.kind === 'stock'}){
        const b=__scene.trains.lastBuffer,lengths=[22,19.5,19,20.1,16.8];
        for(let i=0;i<b.length;i+=10)if(Math.abs(b[i+2]-(${z}))<1&&b[i+5]>.5){
          const head=b[i]+lengths[b[i+4]|0]*b[i+3]*.98/2;
          c.controls.target.set(head-4,b[i+1],track.z+1.7);c.camera.position.set(head+18,b[i+1]+23,track.z+10);break;
        }
      }
      c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
    })()`)
  } else if (shot.view === 'editor') {
    await page.evaluate(`(()=>{const s=__metro.getState();s.setActiveZ(0);s.setHideGround(false);s.setGhostOther(false);s.setAutoWalls(false);
      const c=__scene.cameraSys;c.setOrtho(false);c.controls.target.set(72,28,.5);c.camera.position.set(86,8,24);c.camera.lookAt(c.controls.target);c.controls.update();__scene.setGridVisible(false);__scene.requestRender();
    })()`)
  } else if (shot.view === 'detail') {
    await page.evaluate(`(()=>{
      const s=__metro.getState(),type=${JSON.stringify(shot.focusType)},m=s.station.modules.find(m=>m.id===${JSON.stringify(shot.focusId)});
      if(!m)throw Error('Decor fixture missing: '+type);window.__videoFocus=m;
      s.setActiveZ(Math.floor(m.z/5)*5);s.setHideGround(m.z<0);s.setAutoCeiling(true);s.setHideWalls(true);s.setGhostOther(false);s.setHideUI(false);
      const c=__scene.cameraSys;c.setOrtho(false);c.controls.minDistance=4;
      const Vector=c.camera.position.constructor,Box=__scene.ctx.bounds.constructor,root=__scene.modules.moduleMeshes.children.find(g=>g.userData.moduleId===m.id);
      let center=new Vector(m.x+.5,m.y+.5,m.z+1),extent=2;
      if(root){root.updateWorldMatrix(true,true);const box=new Box().setFromObject(root),size=box.getSize(new Vector());if(!box.isEmpty()){box.getCenter(center);extent=Math.max(size.x,size.y,size.z)}}
      const angle=(m.rot??0)*Math.PI/2,front=['vending','tvm','shelf','checkout','bin','extinguisher','ac-unit','cctv'].includes(type)?-1:1,normal=new Vector(-Math.sin(angle)*front,Math.cos(angle)*front,0),side=new Vector(Math.cos(angle),Math.sin(angle),0);
      let distance=Math.max(4.5,Math.min(23,extent*2.2));
      c.controls.target.copy(center);c.camera.position.copy(center).addScaledVector(normal,distance*.85).addScaledVector(side,distance*.25);c.camera.position.z+=distance*.45;
      if(type==='light'){s.setAutoCeiling(false);c.camera.position.copy(center).addScaledVector(normal,2.8);c.camera.position.z-=2.1}
      if(type==='cctv'){c.controls.minDistance=.5;c.camera.position.copy(center).addScaledVector(normal,1.4).addScaledVector(side,.4);c.camera.position.z-=.5}
      if(type==='tactile'){c.camera.position.copy(center).add(new Vector(1,-1,3))}
      if(type==='linemap'){c.camera.position.copy(center).addScaledVector(normal,3.8);c.camera.position.z+=.15}
      if(['sign','clock','tv'].includes(type)&&m.ceilingAnchored){s.setActiveZ(Math.floor((m.z-1)/5)*5)}
      c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
    })()`)
  } else if (shot.view === 'demand' && shot.station === 'tianhe') {
    await page.evaluate(`(() => {
      const s=__metro.getState(),c=__scene.cameraSys;
      s.setActiveZ(-5);s.setHideWalls(true);s.setOrtho(false);
      c.setOrtho(false);c.setFov(46);c.controls.enableDamping=false;
      c.controls.target.set(-2,-44,-4);c.camera.position.set(27,-96,32);
      c.controls.update();__scene.requestRender();
    })()`)
  } else if (shot.view === 'floor' || shot.view === 'demand') {
    await page.evaluate(`(()=>{const s=__metro.getState();s.setActiveZ(${shot.station === 'zoo' ? -15 : 5});s.setHideUI(false);s.setGhostOther(false);s.setHideWalls(true);
      const c=__scene.cameraSys;c.setPreset('iso');c.controls.target.set(${shot.station === 'zoo' ? '65,15,-14' : '0,4,6'});c.camera.position.set(${shot.station === 'zoo' ? '95,-20,25' : '35,-40,38'});c.camera.lookAt(c.controls.target);c.controls.update();__scene.setGridVisible(false);__scene.requestRender();
    })()`)
  }
  if (!shot.stage&&shot.view!=='flythrough'&&!['blocks', 'equipment', 'train', 'stock', 'decor','cube','section'].includes(shot.kind)) {
    await page.evaluate(`__metro.getState().setSpeed(${settings.reuseStation?4:64});__metro.getState().setPlaying(true)`)
    if(shot.kind==='demand'&&shot.station==='tianhe')await waitForTianheConcourseCrowd(page)
    else if(!settings.reuseStation)await sleep(4500)
    await page.evaluate(`__metro.getState().setSpeed(4)`)
  }
  if (shot.kind === 'demand') await page.evaluate(`__metro.getState().setTimePanel(true)`)
  if (shot.kind==='equipment') await prepareEmptyEditing(page, shot)
  await sleep(600)
  if(!['blocks','equipment','demand'].includes(shot.kind))await page.evaluate('__videoScene.setVoidColor(0xf4f3ed,0xf4f3ed)')
  await page.evaluate('__videoScene.setGridVisible(false);__videoScene.requestRender()')
  await page.evaluate(twoFrames)
  return page.evaluate(`(()=>{const s=__metro.getState(),v=__videoScene,gl=v.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {station:s.station.name,activeZ:s.activeZ,stage:${JSON.stringify(shot.stage??null)},city:s.station.cityStyle,seed:s.station.seed,cells:s.station.cells.length,modules:s.station.modules.length,
      stock:s.station.lines.map(l=>l.stock),quality:s.graphicsQuality,simTime:s.metrics?.simTime,population:s.metrics?.population,theme:document.documentElement.dataset.uiTheme,
      gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),browser:navigator.userAgent,
      camera:v.cameraSys.camera.position.toArray(),target:v.cameraSys.controls.target.toArray(),orbit:window.__videoOrbit??null,focus:window.__videoFocus??null,
      documentVersion:s.version,framesRendered:v.framesRendered,trainPoses:Array.from(v.trains.lastBuffer),
      exploded:v.explodedLayout?.levels.map((level,i)=>({level,visible:v.explodedLayout.floorVisible[i],walls:v.explodedLayout.wallsVisible[i],shift:v.explodedLayout.shifts[i].toArray()}))??null,
      hideWalls:s.hideWalls,concoursePassengers:${shot.kind==='demand'}?window.__videoConcoursePassengers??null:null}})()`)
}

async function frameExploded(page, station) {
  const zoo = station === 'zoo'
  const hidden = zoo ? [-5,0] : [-5]
  // Offsets are fractions of the viewport in the exploded view's drag plane.
  const offsets = zoo ? { '-20': [.045,-.015], '-15': [.05,0], '-10': [-.32,-.095] }
    : { '-10': [.04,-.045], 0:[-.02,.065], 5:[-.02,.025], 10:[-.02,-.085] }
  await page.evaluate(`(() => {
    const view = window.__videoScene = __benchmarkScene, c = view.cameraSys, layout = view.explodedLayout;
    const Vector = c.camera.position.constructor, canvas = view.renderer.domElement;
    view.settleExplodedCamera();
    c.controls.enableDamping = false;
    view.setHideWalls(false);
    const offsets = ${JSON.stringify(offsets)};
    layout.levels.forEach((level, i) => {
      view.setExplodedFloorVisibility(i, !${JSON.stringify(hidden)}.includes(level), true);
      const [dx,dy] = offsets[level] ?? [0,0];
      if (dx || dy) view.moveExplodedFloor(i, dx * canvas.clientWidth, dy * canvas.clientHeight);
    });
    const camera = c.activeCamera();
    camera.updateMatrixWorld(true);
    const projected = new view.ctx.bounds.constructor();
    layout.floorBounds.forEach((bounds, i) => {
      if (!layout.floorVisible[i] || bounds.isEmpty()) return;
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z])
            projected.expandByPoint(new Vector(x,y,z).add(layout.shifts[i]).project(camera));
    });
    const center = projected.getCenter(new Vector());
    const size = projected.getSize(new Vector());
    const pan = new Vector(center.x,center.y,0).unproject(camera).sub(new Vector(0,0,0).unproject(camera));
    c.controls.target.add(pan);
    c.camera.position.add(pan);
    c.controls.update();
    c.syncOrtho();
    c.zoomBy(Math.max(size.x / ${zoo ? 2.62 : 2.72}, size.y / ${zoo ? 2.16 : 2.25}));
    view.requestRender();
  })()`)
}

async function prepareEditing(page, shot) {
  await page.evaluate(`(()=>{
    const s=__metro.getState();s.setPlaying(false);s.setTool('block');
    window.__videoBefore={cells:s.station.cells.length,modules:s.station.modules.length};
    const scene=__scene,c=scene.cameraSys,rect=scene.renderer.domElement.getBoundingClientRect(),Vector=c.camera.position.constructor;
    window.__videoPoint=(x,y,z)=>{const v=new Vector(x,y,z).project(c.activeCamera());return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}};
    window.__videoEditPoints=[__videoPoint(69.5,26.5,0),__videoPoint(75.5,30.5,0)];
  })()`)
  if (shot.kind === 'equipment') {
    const points = await page.evaluate('__videoEditPoints')
    await page.evaluate('window.__videoOldCells=new Set(__metro.getState().station.cells.map(c=>[c.x,c.y,c.z].join(",")))')
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...points[0]})
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',buttons:1,clickCount:1})
    await page.evaluate(twoFrames)
    for(let i=1;i<=12;i++){
      const t=i/12
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points[0].x+(points[1].x-points[0].x)*t,y:points[0].y+(points[1].y-points[0].y)*t,button:'left',buttons:1})
      await page.evaluate(twoFrames)
    }
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...points[1],button:'left',buttons:0,clickCount:1})
    await page.evaluate(twoFrames)
    await page.evaluate(`(()=>{const s=__metro.getState();window.__videoEquipmentPoints=s.station.cells.filter(c=>!__videoOldCells.has([c.x,c.y,c.z].join(','))).map(c=>__videoPoint(c.x+.5,c.y+.5,c.z+1));s.setTool('module');s.setModuleType('bench-steel-1');window.__videoBefore={cells:s.station.cells.length,modules:s.station.modules.length}})()`)
    if (!await page.evaluate('__videoEquipmentPoints.length>0')) throw new Error('Equipment shot needs the preceding floor patch')
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 400 })
}

export async function shotAction(page, shot, recordStart) {
  if(shot.kind==='placement')return authoredAction(page,shot,recordStart,await page.evaluate('document.body.dataset.videoLocale'))
  if(['blocks','colours'].includes(shot.kind))return interiorAction(page,shot,recordStart,await page.evaluate('document.body.dataset.videoLocale'))
  if(shot.spin){await startMontage(page,shot);return []}
  if(['blocks','equipment'].includes(shot.kind))return editingAction(page,shot,recordStart)
  if(['cube','section'].includes(shot.kind))return extraViewAction(page,shot,recordStart)
  if(shot.view==='flythrough')return flyTianhe(page,shot,recordStart)
  const events = []
  const at = async seconds => sleep(Math.max(0, recordStart + seconds * 1000 - performance.now()))
  const cue = file => events.push({ at: (performance.now() - recordStart) / 1000, file })
  const mouse = (type, point, extra = {}) => page.send('Input.dispatchMouseEvent', { type, ...point, ...extra })
  if (shot.orbit) await page.evaluate(`(()=>{
    const scene=__videoScene,c=scene.cameraSys,start=performance.now(),duration=${shot.seconds * 1000},angle=${shot.orbit};
    const p=c.camera.position.clone().sub(c.controls.target),target=c.controls.target.clone(),axis=new p.constructor(0,0,1);
    function animate(now){const t=Math.min(1,(now-start)/duration),ease=t*t*(3-2*t);c.camera.position.copy(p).applyAxisAngle(axis,angle*ease).multiplyScalar(1+${(shot.zoomEnd??.975)-1}*ease).add(target);c.camera.lookAt(target);c.controls.update();scene.requestRender();if(t<1)requestAnimationFrame(animate)}
    requestAnimationFrame(animate);
  })()`)
  if (['train', 'stock'].includes(shot.kind)) await page.evaluate('__metro.getState().setPlaying(true)')
  if (shot.kind === 'blocks') {
    const points = await page.evaluate('__videoEditPoints')
    await at(.5); await mouse('mouseMoved', points[0]); await sleep(200)
    await mouse('mousePressed', points[0], { button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 24; i++) {
      await at(.8 + i / 14)
      const t = i / 24
      await mouse('mouseMoved', { x: points[0].x + (points[1].x - points[0].x) * t, y: points[0].y + (points[1].y - points[0].y) * t }, { button: 'left', buttons: 1 })
    }
    await mouse('mouseReleased', points[1], { button: 'left', buttons: 0, clickCount: 1 }); cue('place.wav')
    await at(3.8)
    const change = await page.evaluate('({before:__videoBefore,after:{cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length}})')
    if (change.after.cells <= change.before.cells) throw new Error('Recorded block drag did not add real station cells')
    events.push({ at: 3.8, action: 'block-drag', ...change })
  } else if (shot.kind === 'equipment') {
    // Find a visible, supported tile in this actual demo, then verify acceptance.
    const points = await page.evaluate('__videoEquipmentPoints')
    await at(.5)
    let accepted = false
    for (const p of points) {
      await mouse('mouseMoved', p); await sleep(220)
      await mouse('mousePressed', p, { button: 'left', buttons: 1, clickCount: 1 })
      await mouse('mouseReleased', p, { button: 'left', buttons: 0, clickCount: 1 })
      accepted = await page.evaluate('__metro.getState().station.modules.length>__videoBefore.modules')
      if (accepted) { cue('place.wav'); break }
      if ((performance.now() - recordStart) / 1000 > 4) break
    }
    if (!accepted) throw new Error('Recorded equipment placement was not accepted')
    events.push({ at: (performance.now() - recordStart) / 1000, action: 'equipment-placed' })
    await mouse('mouseMoved', { x: 500, y: 90 })
  } else if (shot.kind === 'demand') {
    const slider = await page.evaluate(`(()=>{const e=document.querySelector('.knob input[type=range]'),r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height,value:Number(e.value)}:null})()`)
    if (!slider) throw new Error('Demand slider missing')
    await at(.35)
    const p = { x: slider.x + slider.w * .58, y: slider.y + slider.h / 2 }
    await mouse('mouseMoved', p); await mouse('mousePressed', p, { button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 15; i++) { await at(.35 + i / 16); await mouse('mouseMoved', { x: p.x + slider.w * .22 * i / 15, y: p.y }, { button: 'left', buttons: 1 }) }
    await mouse('mouseReleased', { x: p.x + slider.w * .22, y: p.y }, { button: 'left', buttons: 0, clickCount: 1 }); cue('select.wav')
    await at(2.15); await page.evaluate('__metro.getState().setTimePanel(false)')
    events.push({ at: 2.15, action: 'demand-adjusted', value: await page.evaluate('Object.values(__metro.getState().station.demand).map(v=>v.amPeak)') })
  }
  return events
}

export async function screenshot(page, output, recorder, settings) {
  mkdirSync(resolve(output, '..'), { recursive: true })
  await page.evaluate('(()=>{(__videoScene??__scene).requestRender();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()')
  const source = `${output}.jpg`
  await recorder.still({ output: source, width: settings.width, height: settings.height,
    render: () => page.evaluate('(__videoScene??__scene).requestRender()') })
  await command('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',source,'-frames:v','1',output])
}
