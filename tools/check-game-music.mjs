// Isolated browser audit of the real music component/service, without station/GPU work.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createServer} from '../game/node_modules/vite/dist/node/index.js'
import {withPage,waitFor} from './browser-harness.mjs'
const output=resolve('.preview/perf/game-music'),fixture=resolve('game/.preview/music')
mkdirSync(output,{recursive:true});mkdirSync(fixture,{recursive:true})
writeFileSync(resolve(fixture,'index.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';
import{MusicSetting}from'/src/app/windows/topbar/MusicSetting.tsx';
import{gameMusic}from'/src/app/gameMusic.ts';import{setAudioVolume}from'/src/app/audioSettings.ts';
import{useLanguage,setLanguage}from'/src/app/i18n.ts';import'/src/styles.css';
history.replaceState({},'','/en/');setLanguage('en');
window.media=[];const Original=Audio;window.Audio=class extends Original{constructor(){super();media.push(this)}};
window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
window.music=gameMusic;window.setLanguage=setLanguage;window.setAudioVolume=setAudioVolume;
gameMusic.mount();function App(){useLanguage();return React.createElement('div',{className:'settingsMenu',style:{position:'fixed',right:'16px',top:'30px',width:'min(320px, calc(100vw - 32px))'}},React.createElement('div',{className:'settingsDropdown',style:{position:'static',minWidth:0}},React.createElement(MusicSetting)))}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`)
const server=await createServer({configFile:false,root:resolve('game'),server:{host:'127.0.0.1',port:0}})
await server.listen();let page
try{
 page=await withPage({url:`${server.resolvedUrls.local[0]}.preview/music/index.html`,profile:resolve(output,'browser-'+Date.now()),debugPort:9393,windowSize:'1000,800'})
 await waitFor(page.evaluate,`!!document.querySelector('.settingsMusic input')`)
 const gesture=async expression=>{const r=await page.send('Runtime.evaluate',{expression,userGesture:true,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
 const report={initial:await page.evaluate(`({players:media.length,paused:music.getSnapshot().paused})`)}
 assert.equal(report.initial.players,0)
 assert.ok(await page.evaluate(`document.querySelector('.settingsMusicLabel').getBoundingClientRect().bottom<=document.querySelector('.settingsMusicRow').getBoundingClientRect().top`))
 await gesture(`document.querySelector('.settingsMusic button').click()`)
 // Default is enabled: first toggle pauses, second starts.
 await gesture(`if(music.getSnapshot().paused)document.querySelector('.settingsMusic button').click()`)
 await waitFor(page.evaluate,`media.length===1 && !media[0].paused && media[0].readyState>=2`)
 report.playing=await page.evaluate(`({file:media[0].src,duration:media[0].duration,volume:media[0].volume})`)
 assert.ok(report.playing.duration>200,'full recording, not the 90-second audition')
 assert.equal(report.playing.volume,.25)
 await gesture(`document.querySelector('.settingsMusic button').click()`)
 assert.equal(await page.evaluate('media[0].paused'),true)
 report.pausedPosition=await page.evaluate('media[0].currentTime')
 await gesture(`document.querySelector('.settingsMusic button').click()`)
 await waitFor(page.evaluate,'!media[0].paused')
 await page.evaluate(`document.querySelector('.settingsMusic input').focus()`)
 for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:'Home',code:'Home'})
 await waitFor(page.evaluate,'media[0].paused && media[0].volume===0')
 for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:'End',code:'End'})
 await waitFor(page.evaluate,'!media[0].paused && media[0].volume===1')
 await gesture(`media[0].currentTime=media[0].duration-.2`)
 await waitFor(page.evaluate,`music.getSnapshot().track===1 && !media[0].paused`)
 report.advance=await page.evaluate('media[0].src')
 const hover=await page.evaluate(`(()=>{document.activeElement.blur();const r=document.querySelector('.settingsMusicRow').getBoundingClientRect();return{x:r.x+10,y:r.y+r.height/2}})()`)
 await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover})
 report.credits=await page.evaluate(`({visible:getComputedStyle(document.querySelector('.musicCreditsPanel')).display,links:document.querySelectorAll('.musicCreditsPanel a').length,left:document.querySelector('.musicCreditsPanel').getBoundingClientRect().left})`)
 assert.equal(await page.evaluate(`document.querySelectorAll('.settingsMusic button').length`),1);assert.equal(await page.evaluate(`document.querySelector('.musicCreditsPanel').textContent.includes('Dream Culture')`),false);assert.equal(await page.evaluate(`document.querySelector('.musicCreditsPanel').textContent.includes('Converted to MP3')`),false);
 assert.equal(report.credits.visible,'block');assert.equal(report.credits.links,2);assert.ok(report.credits.left>=0)
 await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(output,'settings.png'),Buffer.from(r.data,'base64')))
 await page.evaluate(`setLanguage('zh-CN')`)
 await waitFor(page.evaluate,`document.querySelector('.settingsMusic input').getAttribute('aria-label')==='音乐音量'`)
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 report.mobile=await page.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,right:document.querySelector('.settingsMusicRow').getBoundingClientRect().right,width:innerWidth})`);assert.equal(report.mobile.overflow,false);assert.ok(report.mobile.right<=report.mobile.width)
 await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(output,'mobile.png'),Buffer.from(r.data,'base64')))
 await gesture(`document.querySelector('.settingsMusic button').click()`)
 report.preferences=await page.evaluate(`({volume:JSON.parse(localStorage.getItem('metro-game.audio')).music,paused:localStorage.getItem('metro-game.music-paused')})`)
 assert.equal(report.preferences.volume,1);assert.equal(report.preferences.paused,'true')
 report.errors=await page.evaluate('errors');assert.deepEqual(report.errors,[])
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await page?.close();await server.close()}
