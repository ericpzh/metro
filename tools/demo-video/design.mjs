// Studio editorial graphics. Real game footage is kept in independent takes.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {ui,videoText} from '../../web/src/i18n.js'
import {gallery} from '../../web/src/artworks.js'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
import {music} from './audio.mjs'
import {authoredSteps,authoredLabel} from './authored-layout.mjs'

export const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const brand=()=>`data:image/png;base64,${readFileSync(resolve('web/src/assets/brand/station-designer-mark.png')).toString('base64')}`
function palette(){const source=readFileSync(resolve('game/src/styles.css'),'utf8');return source.match(/:root\s*\{[\s\S]*?\}/)[0]+source.match(/:root\[data-ui-theme="studio"\]\s*\{[\s\S]*?\}/)[0]}
const css=`
.placement .anchor,.colours .anchor,.blocks .anchor{left:96px;top:88px;width:1000px}.placement .anchor{width:850px}.placement .anchor p{font-size:23px}
[data-id="02-underground"] .anchor{left:auto;right:96px;top:148px;width:820px}
.paired .panelFrame{position:absolute;top:150px;bottom:120px;left:32px;width:1216px;border:1px solid #d8dbce;border-radius:14px;pointer-events:none}.paired .panelFrame.right{left:1312px}.paired .divider{position:absolute;left:1276px;width:8px;top:150px;bottom:120px;background:#f4f3ed;border-left:1px solid #d8dbce;border-right:1px solid #d8dbce}.paired .rapidlabel{left:64px;bottom:132px;width:1152px;min-width:0;padding:16px 25px;gap:20px}.paired .rapidlabel.right{left:1344px}.paired .rapidlabel h1{font-size:46px}.paired .rapidlabel .counter{margin-left:auto;font-size:20px;padding-bottom:12px}.livery{display:flex;gap:12px;align-items:center;color:#687363;font-size:21px;margin-top:6px}.livery i{width:18px;height:18px;border-radius:50%;border:1px solid #303a3020}.native.blocks .anchor,.native.equipment .anchor{top:110px}
.musiccredit{border-top:1px solid #d8dbce;margin-top:30px;padding-top:22px;display:flex;align-items:center;gap:30px}.musiccredit .eyebrow{font-size:19px;letter-spacing:2px}.musiccredit strong{font-size:25px;font-weight:550;display:block}.musiccredit p{font-size:21px;margin-top:5px}
*{box-sizing:border-box}html,body{margin:0;overflow:hidden;background:transparent}
body{color:#303a30;font-family:var(--font);-webkit-font-smoothing:antialiased}.canvas{position:absolute;inset:0;width:2560px;height:1440px;transform-origin:0 0}.scene{position:absolute;inset:0;display:none}.scene.active{display:block}
h1,h2,p{margin:0}h1,h2{font-weight:650;letter-spacing:.01em;line-height:1.5}p{font-size:27px;line-height:1.7;color:#687363}.eyebrow{font-size:22px;letter-spacing:3px;color:#687363}.accent{color:#c94d24}
.card{position:absolute;background:rgba(253,254,249,.96);border:1px solid #d8dbce;border-radius:12px;box-shadow:0 12px 42px #16221a17;padding:34px 40px}.brandmark{width:72px;height:72px;object-fit:contain;background:#303a30;padding:10px;border-radius:12px}.brandrow{display:flex;align-items:center;gap:22px;margin-bottom:20px}.brandrow .eyebrow{line-height:1.6}
.identity{position:absolute;top:62px;right:96px;display:flex;align-items:center;gap:14px;background:#fdfef9ed;border:1px solid #d8dbce;border-radius:32px;padding:13px 25px;color:#53634f;font-size:21px;letter-spacing:2px}.identity i{width:8px;height:8px;border-radius:50%;background:#c94d24}.identity b{font-weight:500;margin-left:8px;padding-left:20px;border-left:1px solid #d8dbce}
.route{position:absolute;bottom:48px;left:50%;transform:translateX(-50%);width:1120px;height:54px;display:flex;align-items:center;justify-content:space-around;border:1px solid #d8dbce;border-radius:30px;background:#fdfef9ed}.stop{display:flex;align-items:center;gap:12px;color:#82907e;font-size:20px;letter-spacing:1px}.stop i{height:7px;width:7px;border-radius:50%;background:#c4cbbd}.stop.current{color:#303a30;font-weight:600}.stop.current i{background:#c94d24;box-shadow:0 0 0 5px #c94d2414}.stop.past i{background:#89947f}
.hero{left:96px;top:134px;width:760px;padding:34px 40px 36px}.hero h1{font-size:86px;margin:5px 0 2px;white-space:nowrap}.hero p{font-size:30px}.hero .brandrow{margin-bottom:14px}.traits{margin-top:22px;display:flex;gap:20px;font-size:21px;color:#687363}.traits span+span:before{content:'·';margin-right:20px;color:#c94d24}
.stationplate{position:absolute;right:96px;bottom:140px;border-left:4px solid #c94d24;padding:15px 25px;background:#fdfef9f0;border-radius:0 9px 9px 0}.stationplate strong{font-size:33px;letter-spacing:5px}.stationplate p{font-size:23px;margin-top:6px}
.anchor{left:96px;top:88px;width:1110px;padding:26px 34px 30px}.anchor h2{font-size:44px;margin:5px 0 3px}.anchor p{font-size:25px}.anchor .eyebrow{font-size:21px;display:flex;align-items:center;gap:16px}.sectionno{color:#c94d24;font:22px var(--mono);padding-right:16px;border-right:1px solid #d8dbce}
.minichapter{position:absolute;left:96px;top:62px;display:flex;align-items:center;gap:18px;padding:14px 25px;background:#fdfef9ed;border:1px solid #d8dbce;border-radius:34px;font-size:22px;color:#53634f}.minichapter b{font:23px var(--mono);color:#c94d24}
.rapidlabel{left:96px;bottom:132px;min-width:500px;max-width:1050px;display:flex;align-items:center;gap:40px;padding:17px 30px 18px;border-left:5px solid #c94d24}.rapidlabel .eyebrow{font-size:20px;letter-spacing:2px}.rapidlabel h1{font-size:53px;white-space:nowrap;line-height:1.5}.rapidlabel .counter{align-self:flex-end;font:22px var(--mono);color:#89947f;white-space:nowrap;padding-bottom:16px;margin-left:15px}.stock .rapidlabel h1{font-size:60px}
.native .anchor{left:280px;top:1050px;width:1030px;padding:25px 32px}.native .anchor h2{font-size:42px}.native .anchor p{font-size:25px}.native .route{left:280px;right:332px;width:auto;transform:none;bottom:64px}.native .demandplate{top:118px;width:1040px}.native .anchor .eyebrow{font-size:20px}
.end{left:96px;top:160px;width:1050px;padding:34px 40px}.end .brandrow strong{font-size:30px;letter-spacing:3px}.end h1{font-size:60px;white-space:nowrap;margin:14px 0 8px}.end .lead{font-size:27px}.actions{display:flex;align-items:center;gap:34px;margin-top:28px}.playbutton{display:flex;align-items:center;gap:26px;border-radius:7px;padding:17px 30px;background:#c94d24;color:white;font-size:29px;letter-spacing:3px}.playbutton:after{content:'';width:0;height:0;border-top:6px solid transparent;border-bottom:6px solid transparent;border-left:10px solid white}.address{font:23px var(--mono);color:#53634f}.address small{display:block;margin-bottom:7px;font:19px var(--font);color:#89947f;letter-spacing:2px}
.english .hero h1{font-size:60px}.english .hero p{font-size:25px}.english .anchor h2{font-size:35px}.english .anchor p{font-size:22px}.english .end h1{font-size:49px}.english .rapidlabel h1{font-size:43px}.english .traits{font-size:18px;gap:12px}.english .traits span+span:before{margin-right:12px}.english .route{width:1390px}.english .native .route{width:auto}.english .stop{font-size:18px;letter-spacing:0}
`
export function graphicHtml(shot,language='zh'){
 const t=ui[language].video,sections=gallery[language].sections,index=sections.findIndex(s=>s.id===shot.section),section=sections[index].label
 const native=['equipment','demand','cube'].includes(shot.kind),rapid=['city','stock','decor'].includes(shot.kind)
 const title=t.headlines[shot.id]??shot.title,note=t.notes[shot.id]??shot.subtitle
 const rail=`<nav class="route">${sections.map((s,i)=>`<div class="stop ${i===index?'current':i<index?'past':''}"><i></i><span>${escape(s.label)}</span></div>`).join('')}</nav>`
 const identity=`<div class="identity"><i></i>${escape(t.real)}<b>${escape(shot.stationName)}</b></div>`
 const mini=`<div class="minichapter"><b>${String(index+1).padStart(2,'0')}</b>${escape(section)}</div>`
 let content=''
 if(shot.kind==='hero')content=`<section class="card hero"><div class="brandrow"><img class="brandmark" src="${brand()}"><div class="eyebrow">${escape(t.demoPair)}<br>${escape(t.real)}</div></div><h1>${escape(ui[language].nav.brand)}</h1><p>${escape(t.intro)}</p><div class="traits">${t.traits.map(x=>`<span>${escape(x)}</span>`).join('')}</div></section><aside class="stationplate"><strong>${escape(shot.stationName)}</strong><p>${escape(ui[language].demos[shot.station].note)}</p></aside>`
 else if(shot.kind==='cta')content=`<section class="card end"><div class="brandrow"><img class="brandmark" src="${brand()}"><strong>${escape(ui[language].nav.brand)}</strong></div><h1>${escape(title)}</h1><p class="lead">${escape(t.beginNote)}</p><div class="actions"><div class="playbutton">${escape(t.begin)}</div><div class="address"><small>${escape(t.visit)}</small>stationdesigner.com</div></div><div class="musiccredit"><div class="eyebrow">${escape(t.musicThanks)}</div><div><strong>《${escape(music.title)}》 · ${escape(music.author)}</strong><p>${escape(t.musicLicense)}</p></div></div></section>`
 else if(shot.panels)content=`${mini}<div class="panelFrame"></div><div class="panelFrame right"></div><div class="divider"></div>${shot.panels.map((p,i)=>`<section class="card rapidlabel ${i?'right':''}"><div><div class="eyebrow">${escape(t.detail)}</div><h1>${escape(p.title)}</h1></div><div class="counter">${String((shot.montageIndex-1)*2+i+1).padStart(2,'0')} / 40</div></section>`).join('')}`
 else if(rapid){const category={city:t.city,stock:t.rolling,decor:t.detail}[shot.kind];content=`${mini}<section class="card rapidlabel"><div><div class="eyebrow">${escape(category)}</div><h1>${escape(shot.title)}</h1>${shot.stock?`<div class="livery"><i style="background:${shot.colour}"></i>${escape(videoText(language,'trainLine',shot.lineNumber))}</div>`:''}</div><div class="counter">${String(shot.montageIndex??1).padStart(2,'0')} / ${String(shot.montageCount??1).padStart(2,'0')}</div></section>`}
 else content=`<section class="card anchor ${shot.kind==='demand'?'demandplate':''}"><div class="eyebrow"><span class="sectionno">${String(index+1).padStart(2,'0')}</span>${escape(section)} · ${escape(shot.stationName)}${shot.playbackRate===8?` · <span class="accent">${escape(t.speedBuild)}</span>`:''}</div><h2>${escape(title)}</h2><p>${escape(note)}</p></section>`
 return `<div class="scene ${native?'native':''} ${rapid?'rapid':''} ${shot.panels?'paired':''} ${shot.kind} ${language==='en'?'english':''}" data-id="${shot.id}">${native?'':identity}${content}${rail}</div>`
}

export async function renderGraphics(output,plan,language='zh',{review=false,width=2560,height=1440}={}){
 const directory=resolve(output,'graphics');mkdirSync(directory,{recursive:true})
 const html=`<!doctype html><html lang="${language}" data-ui-theme="studio"><meta charset="utf-8"><style>${palette()}${css}html,body{width:${width}px;height:${height}px}.canvas{transform:scale(${width/2560},${height/1440})}</style><body><main class="canvas">${plan.map(s=>graphicHtml(s,language)).join('')}</main><script>window.showShot=id=>document.querySelectorAll('.scene').forEach(e=>e.classList.toggle('active',e.dataset.id===id));showShot(${JSON.stringify(plan[0].id)})</script>`
 writeFileSync(resolve(directory,'overlays.html'),html)
 const server=await serveDir(directory,0),audit=[];let page
 try{
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/overlays.html`,profile:resolve(directory,`browser-${process.pid}`),debugPort:18300+process.pid%1000,windowSize:`${width},${height}`,softwareGpu:true})
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
  await page.send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}})
  await waitFor(page.evaluate,'!!window.showShot',{what:'studio graphics'})
  await page.evaluate('document.fonts.ready')
  for(const shot of plan){
   await page.evaluate(`showShot(${JSON.stringify(shot.id)});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
   const result=await page.evaluate(`(()=>{const scene=document.querySelector('.scene.active'),bad=[];for(const e of scene.querySelectorAll('h1,h2,p,.eyebrow,.playbutton,.address,.stop span,.traits span')){const r=e.getBoundingClientRect(),p=e.closest('.card')?.getBoundingClientRect();if(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2||r.x<0||r.right>${width}||r.y<0||r.bottom>${height}||(p&&(r.right>p.right-6||r.bottom>p.bottom-6)))bad.push({text:e.textContent,scroll:[e.scrollWidth,e.scrollHeight],client:[e.clientWidth,e.clientHeight],rect:{x:r.x,y:r.y,w:r.width,h:r.height}})}return {id:scene.dataset.id,text:scene.innerText,bad,images:[...scene.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)}})()`)
   const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(directory,`${shot.id}.png`),Buffer.from(data,'base64'));audit.push(result)
  }
  if(plan.some(s=>s.kind==='placement')){
   const scale=width/2560,w=Math.round(800*scale),h=Math.round(160*scale)
   await page.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false})
   await page.evaluate(`(()=>{document.querySelector('.canvas').style.display='none';const e=document.createElement('section');e.id='placement-card';e.style.cssText='width:800px;height:160px;background:#fdfef9;color:#303a30;border:1px solid #d8dbce;border-left:6px solid #c94d24;border-radius:12px;padding:20px 28px;position:absolute;left:0;top:0;transform-origin:0 0;transform:scale(${scale});overflow:hidden';e.innerHTML='<div style="display:flex;justify-content:space-between;font-size:22px;color:#687363;margin-bottom:7px"><span>${escape(ui[language].video.detail)}</span><span id="placement-count"></span></div><h2 id="placement-name" style="font-size:38px;white-space:nowrap;line-height:1.5"></h2><div id="placement-progress" style="height:4px;background:#c94d24;position:absolute;bottom:0;left:0"></div>';document.body.append(e)})()`)
   const takePath=resolve(output,'takes','montage-placement','take.json'),cards=existsSync(takePath)?JSON.parse(readFileSync(takePath,'utf8')).events.filter(e=>e.card).map(e=>e.card):null
   const labels=[ui[language].video.placementStart,...(cards??[...Object.values(ui[language].video.buildPhases),...authoredSteps.map(i=>authoredLabel(i,language)),ui[language].video.placementComplete])],total=labels.length-1
   for(let i=0;i<labels.length;i++){
    const count=Math.min(total,i)
    // The card names the family, not the variant chosen inside it.
    const name=String(labels[i]).split(' · ')[0]
    await page.evaluate(`(()=>{document.getElementById('placement-name').textContent=${JSON.stringify(name)};document.getElementById('placement-count').textContent='${count} / ${total}';document.getElementById('placement-progress').style.width='${count/total*100}%';return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`)
    const valid=await page.evaluate("(()=>{const e=document.getElementById('placement-name');return e.scrollWidth<=e.clientWidth})()")
    if(!valid)throw Error(`Placement card overflows: ${name}`)
    const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(directory,`placement-card-${String(i).padStart(2,'0')}.png`),Buffer.from(data,'base64'))
   }
  }
 }finally{if(page)await page.close();await new Promise(r=>server.close(r))}
 writeFileSync(resolve(directory,'layout-audit.json'),JSON.stringify(audit,null,2))
 const failed=audit.filter(s=>s.bad.length||!s.images)
 if(failed.length&&!review)throw new Error(`Graphic layout failed: ${JSON.stringify(failed.map(s=>({id:s.id,bad:s.bad})))}`)
 return directory
}
