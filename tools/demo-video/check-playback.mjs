// Decode the delivered file in a real browser and seek every editorial scene.
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const output=resolve(process.argv[2]??'.preview/demo-video/zh-studio-2k-v6')
const {plan,settings}=JSON.parse(readFileSync(resolve(output,'manifest.json'),'utf8'))
const server=await serveDir(output,0)
let page
try{
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/review.html`,profile:resolve(output,'playback-browser-'+process.pid),debugPort:19756,windowSize:'1440,1000',softwareGpu:false})
  await waitFor(page.evaluate,"document.querySelector('video')?.readyState>=2",{what:'delivered H.264 video'})
  await page.evaluate("(()=>{const v=document.querySelector('video');v.muted=true;return v.play()})()")
  await waitFor(page.evaluate,"document.querySelector('video').currentTime>1",{tries:30,every:150,what:'real media playback'})
  await page.evaluate("document.querySelector('video').pause()")
  const shots=[]
  for(const shot of plan){
    const state=await page.evaluate(`new Promise((ok,bad)=>{const v=document.querySelector('video');const timer=setTimeout(()=>bad(Error('Seek timed out')),10000);v.addEventListener('seeked',()=>{clearTimeout(timer);ok({time:v.currentTime,width:v.videoWidth,height:v.videoHeight,error:v.error?.message??null,decoded:v.getVideoPlaybackQuality().totalVideoFrames})},{once:true});v.currentTime=${shot.start+shot.seconds/2}})`)
    if(state.error||state.width!==settings.width||state.height!==settings.height)throw Error('Invalid playback for '+shot.id)
    shots.push({id:shot.id,...state})
  }
  writeFileSync(resolve(output,'playback-check.json'),JSON.stringify({played:true,shots,browser:await page.evaluate('navigator.userAgent')},null,2))
  console.log(JSON.stringify({played:true,scenes:shots.length,decoded:shots.at(-1).decoded}))
}finally{if(page)await page.close();await new Promise(r=>server.close(r))}
