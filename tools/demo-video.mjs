// Rebuild → real browser recordings → synchronized audio → H.264/AAC delivery.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'
import { timeline, validatePlan, storyboard, VIDEO_SECONDS } from './demo-video/plan.mjs'
import { prepareShot, shotAction, screenshot } from './demo-video/capture.mjs'
import { connectRecorder } from './demo-video/record.mjs'
import { command, encodeTake, editVideo, validateVideo } from './demo-video/media.mjs'
import { renderGraphics } from './demo-video/design.mjs'
import { ui } from '../web/src/i18n.js'
import {exportDemoSave} from './demo-video/save.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(repo)
const argv = process.argv.slice(2)
const arg = (key, fallback) => { const i = argv.indexOf(`--${key}`); return i < 0 ? fallback : argv[i + 1] }
const has = key => argv.includes(`--${key}`)
const language = arg('lang', 'zh')
const settings = { language, theme: 'blueprint', videoTheme:'studio', width: Number(arg('width', '2560')), height: Number(arg('height', '1440')), fps: 30, gpu: arg('gpu', 'hardware') }
if (!['hardware', 'software'].includes(settings.gpu) || !Number.isInteger(settings.width) || !Number.isInteger(settings.height) || settings.width % 2 || settings.height % 2 || settings.width < 640 || settings.height < 360) throw new Error('Invalid capture settings')
const output = resolve(arg('output', `.preview/demo-video/${language}-studio-2k-v6`))
mkdirSync(output, { recursive: true })
const plan = timeline(language); validatePlan(plan)
writeFileSync(resolve(output, 'storyboard.md'), storyboard(plan,language))
writeFileSync(resolve(output, 'timeline.json'), JSON.stringify(plan, null, 2))
console.log(`Storyboard: ${resolve(output, 'storyboard.md')} (${plan.length} scenes, ${VIDEO_SECONDS} seconds)`)
if (has('plan')) process.exit(0)
await command('ffmpeg', ['-version'])
await command('ffprobe', ['-version'])
if(has('design-only')){
  const graphics=await renderGraphics(output,plan,language,{review:true,width:settings.width,height:settings.height})
  const previews=resolve(output,'design-preview');mkdirSync(previews,{recursive:true})
  for(const shot of plan){
    const still=resolve(output,'takes',shot.id,'before.png')
    if(!existsSync(still))continue
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',still,'-i',resolve(graphics,`${shot.id}.png`),'-filter_complex','[0:v][1:v]overlay=0:0:format=auto','-frames:v','1',resolve(previews,`${shot.id}.png`)])
  }
  console.log(`Design preview: ${previews}`)
  process.exit(0)
}
if (!has('skip-build') && !has('edit-only')) {
  const npm = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  console.log('Building the current game…')
  await command(process.execPath, [npm, '--prefix', 'game', 'run', 'build'])
}
if (!existsSync(resolve('game/dist/index.html'))) throw new Error('Build the game before recording')

function fileHashes(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    const file = resolve(directory, e.name)
    return e.isDirectory() ? fileHashes(file) : [{ file: file.slice(repo.length + 1).replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }]
  })
}
const sources = [...fileHashes(resolve('game/dist')), ...fileHashes(resolve('tools/demo-video')),
  ...['tools/demo-video.mjs', 'video/demo-station.metro.json','video/demo-camera.json','web/src/artworks.js', 'web/src/i18n.js', 'game/src/data/demo-station.json', 'game/src/data/tanwei-station.json','.agents/skills/metro-repo/references/performance.md'].map(file => ({ file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }))]
const sourceHash = createHash('sha256').update(JSON.stringify(sources)).digest('hex')
const gitRevision = (await command('git', ['rev-parse', 'HEAD'], { capture: true })).stdout.trim()
const gameBuild=JSON.parse(readFileSync(resolve('game/dist/editor-benchmark-build.json'),'utf8'))
mkdirSync(resolve(output,'sources'),{recursive:true})
writeFileSync(resolve(output,'sources',`${sourceHash}.json`),JSON.stringify({sourceHash,gitRevision,gameBuild,sources,settings},null,2))
const takes = []
let page, recorder, server
async function captureOne(shot,directory,captureSettings,key,reuseStation=false){
  mkdirSync(directory,{recursive:true})
  const fixture=await prepareShot(page,shot,{...captureSettings,reuseStation})
  writeFileSync(resolve(directory,'fixture.json'),JSON.stringify(fixture,null,2))
  if(shot.station==='empty')writeFileSync(resolve(directory,'stage.json'),JSON.stringify(await page.evaluate('(()=>{const s=__metro.getState().station;return{name:s.name,nameEn:s.nameEn,seed:s.seed,storeyHeight:s.storeyHeight,levelBase:s.levelBase,cityStyle:s.cityStyle,cells:s.cells,modules:s.modules,lines:s.lines}})()'),null,2))
  await screenshot(page,resolve(directory,'before.png'),recorder,captureSettings)
  if(has('stills')){
    const errors=await page.evaluate('window.__videoErrors??[]');if(errors.length)throw Error(errors.join('; '))
    return {id:shot.id,fixture,settings:captureSettings,catalogueId:shot.catalogueId}
  }
  let events
  const recording=await recorder.take({directory,seconds:shot.captureSeconds,width:captureSettings.width,height:captureSettings.height,action:async start=>{events=await shotAction(page,shot,start)}})
  events=events.map(e=>({...e,sourceAt:e.at,at:e.at/shot.playbackRate}))
  const motion=shot.spin||shot.kind==='placement'?await page.evaluate('window.__videoMotionLog'):null
  await screenshot(page,resolve(directory,'after.png'),recorder,captureSettings)
  if(shot.station==='empty')writeFileSync(resolve(directory,'after-stage.json'),JSON.stringify(await page.evaluate('(()=>{const s=__metro.getState().station;return{name:s.name,nameEn:s.nameEn,seed:s.seed,storeyHeight:s.storeyHeight,levelBase:s.levelBase,cityStyle:s.cityStyle,cells:s.cells,modules:s.modules,lines:s.lines}})()'),null,2))
  if(shot.kind==='placement')exportDemoSave(await page.evaluate('__metro.getState().station'),output,captureSettings.language)
  const errors=await page.evaluate('window.__videoErrors??[]')
  if(errors.length)throw Error(`Game errors in ${shot.id}: ${errors.join('; ')}`)
  console.log(`Encoding ${shot.id}: ${recording.frames} recorded frames`)
  await encodeTake(directory,shot,captureSettings)
  const take={id:shot.id,key,sourceHash,gameBuild,seconds:shot.seconds,playbackRate:shot.playbackRate,settings:captureSettings,fixture,recording,motion,events,errors,catalogueId:shot.catalogueId,capturedAt:new Date().toISOString()}
  writeFileSync(resolve(directory,'take.json'),JSON.stringify(take,null,2));return take
}
async function setViewport(width,height){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
}
async function capturePair(shot,directory,key){
  const panelSettings={...settings,width:settings.width/2},panels=[]
  if(!Number.isInteger(panelSettings.width)||panelSettings.width%2)throw Error('Paired delivery width must be divisible by four')
  await setViewport(panelSettings.width,panelSettings.height)
  try{
    for(let i=0;i<2;i++){
      const child={...shot,...shot.panels[i],panels:undefined,panelCapture:true,id:`${shot.id}-${i===0?'left':'right'}`}
      console.log(`Framing ${child.id}: ${child.catalogueId}`)
      panels.push(await captureOne(child,resolve(directory,i===0?'left':'right'),panelSettings,key))
    }
  }finally{await setViewport(settings.width,settings.height)}
  for(const still of has('stills')?['before']:['before','after'])await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',resolve(directory,'left',`${still}.png`),'-i',resolve(directory,'right',`${still}.png`),'-filter_complex','hstack=inputs=2','-frames:v','1',resolve(directory,`${still}.png`)])
  const fixture={...panels[0].fixture,paired:true,orbit:shot.spin}
  writeFileSync(resolve(directory,'fixture.json'),JSON.stringify(fixture,null,2))
  if(has('stills'))return {id:shot.id,fixture,panels}
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',resolve(directory,'left','raw.mp4'),'-i',resolve(directory,'right','raw.mp4'),'-filter_complex','hstack=inputs=2,setsar=1','-an','-t',String(shot.seconds),'-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p',resolve(directory,'raw.mp4')])
  const take={id:shot.id,key,sourceHash,gameBuild,seconds:shot.seconds,playbackRate:shot.playbackRate,settings,fixture,panels,motion:panels[0].motion,events:[],errors:[],capturedAt:new Date().toISOString()}
  writeFileSync(resolve(directory,'take.json'),JSON.stringify(take,null,2));return take
}
try {
  if (!has('edit-only')) {
    server = await serveDir(resolve('game/dist'), 0)
    const port = 19600 + process.pid % 1000
    page = await withPage({ url: `http://127.0.0.1:${server.address().port}/${language === 'en' ? 'en' : ''}`,
      profile: resolve(output, `browser-${process.pid}`), debugPort: port, windowSize: `${settings.width},${settings.height}`, softwareGpu: settings.gpu === 'software' })
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('metro-game.tutorial.v1',JSON.stringify({step:0,hidden:true}));addEventListener('error',e=>(window.__videoErrors??=[]).push(e.message));addEventListener('unhandledrejection',e=>(window.__videoErrors??=[]).push(String(e.reason)));` })
    await page.send('Emulation.setDeviceMetricsOverride', { width: settings.width, height: settings.height, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.reload')
    await waitFor(page.evaluate, '!!window.__scene&&!!window.__metro', { what: 'production game shell' })
    await page.evaluate(`document.body.dataset.videoLocale=${JSON.stringify(language)}`)
    recorder = await connectRecorder(port)
  }
  const selected = arg('scene', '').split(',').filter(Boolean)
  let previousShot=null
  for (const shot of plan) {
    if (selected.length && !selected.includes(shot.id)) continue
    const directory = resolve(output, 'takes', shot.id)
    mkdirSync(directory, { recursive: true })
    const metaPath = resolve(directory, 'take.json')
    const key = createHash('sha256').update(JSON.stringify({ sourceHash, settings, shot })).digest('hex')
    if (has('edit-only') || (has('resume') && existsSync(metaPath) && JSON.parse(readFileSync(metaPath, 'utf8')).key === key)) {
      if (!existsSync(metaPath) || !existsSync(resolve(directory, 'raw.mp4'))) throw new Error(`Missing captured take: ${shot.id}`)
      const take = JSON.parse(readFileSync(metaPath, 'utf8'))
      if (take.seconds !== shot.seconds) throw new Error(`Take duration changed; recapture ${shot.id}`)
      if((take.playbackRate??1)!==shot.playbackRate||(take.fixture.stage??null)!==(shot.stage??null))throw Error(`Take stage/playback changed; recapture ${shot.id}`)
      if(shot.spin&&(take.fixture.orbit?.from!==shot.spin.from||take.fixture.orbit?.to!==shot.spin.to))throw Error(`Take camera arc changed; recapture ${shot.id}`)
      if(shot.panels&&JSON.stringify(take.panels?.map(p=>p.catalogueId))!==JSON.stringify(shot.panels.map(p=>p.catalogueId)))throw Error(`Paired models changed; recapture ${shot.id}`)
      if(take.settings.language!==settings.language||take.fixture.theme!==settings.theme||take.settings.width!==settings.width||take.settings.height!==settings.height)throw new Error(`Take language/theme/resolution changed; recapture ${shot.id}`)
      takes.push(take); console.log(`Reusing ${shot.id}`); continue
    }
    console.log(`Framing ${shot.id} (${shot.station}, ${shot.seconds}s)…`)
    const reuseStation=(previousShot?.stage==='city'&&shot.stage==='city')
    const take=shot.panels?await capturePair(shot,directory,key):await captureOne(shot,directory,settings,key,reuseStation)
    previousShot=shot
    if (has('stills')) { console.log(`Still: ${resolve(directory, 'before.png')}`); continue }
    takes.push(take)
  }
} finally {
  recorder?.close()
  if (page) await page.close()
  if (server) await new Promise(r => server.close(r))
}
if (has('stills') || has('capture-only') || arg('scene', '')) process.exit(0)
console.log('Editing picture and mixing music, ambience and action cues…')
const final = await editVideo(output, plan, takes, settings)
console.log('Checking delivery duration, codecs and audio levels…')
const validation = await validateVideo(final,VIDEO_SECONDS,settings)
const manifest = { sourceHash, gitRevision, gameBuild, sources, settings, plan, takes, validation, generatedAt: new Date().toISOString() }
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
const select=plan.map(s=>`eq(n,${Math.floor((s.start+s.seconds/2)*settings.fps)})`).join('+')
await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', final, '-vf', `select='${select}',scale=480:270,tile=5x${Math.ceil(plan.length/5)}:nb_frames=${plan.length}:padding=8:color=0xf4f3ed`, '-frames:v', '1', resolve(output, 'contact-sheet.jpg')])
await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','1','-i',final,'-frames:v','1',resolve(output,'poster.jpg')])
const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const videoName = final.split(/[\\/]/).at(-1)
const copy=ui[language].video
writeFileSync(resolve(output, 'review.html'), `<!doctype html><html lang="${language}"><meta charset="utf-8"><title>${copy.title}</title><style>body{margin:40px auto;max-width:1200px;background:#f4f3ed;color:#303a30;font:16px 'Microsoft YaHei',system-ui}video{width:100%;border:1px solid #d8dbce;border-radius:12px}button{margin:5px;padding:10px 14px;background:#fdfef9;color:inherit;border:1px solid #d8dbce;border-radius:7px;cursor:pointer}button:hover{border-color:#c94d24}a{color:#c94d24}img{width:100%;border-radius:12px}</style><h1>${copy.title}</h1><video id="demo" src="${videoName}" controls poster="poster.jpg"></video><p>${plan.map(s => `<button onclick="demo.currentTime=${s.start};demo.play()">${s.start} · ${escape(s.title)}</button>`).join('')}</p><p><a href="storyboard.md">${copy.scenePlan}</a> · <a href="manifest.json">${copy.provenance}</a> · <a href="CREDITS.md">${copy.credits}</a></p><img src="contact-sheet.jpg" alt="${copy.contact}">`)
console.log(`Finished: ${final}\nReview: ${resolve(output, 'review.html')}\n${JSON.stringify(validation)}`)
