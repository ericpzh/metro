// Capture registered, transparent source poses for offline interpolation.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const angle=Number(process.argv[2]??2),elevation=process.argv[3]??'normal',raw=process.argv.includes('--raw');
if(![0,2,4,8].includes(angle)||!['low','normal','high'].includes(elevation)||(angle!==2&&elevation!=='normal'))throw Error('Unsupported angle/elevation');
const out=resolve('.preview/human-candidates/sprite-frames',`${angle}-${elevation}${raw?'-raw':''}`);mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4294);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4294/candidates.html?mode=sprite&candidate=valid-Asian_F_3_Casual',profile:resolve('.preview/.chrome-sprite-frames'),debugPort:9424,windowSize:'1200,900'});
 await waitFor(page.evaluate,'window.__candidatePreview?.ready && window.__candidatePreview.spriteReady',{tries:120,every:250});
 await page.evaluate(`(()=>{for(const [selector,value] of [['#sprite-angle','${angle}'],['#sprite-elevation','${elevation}']]){const e=document.querySelector(selector);e.value=value;e.dispatchEvent(new Event('change'))}window.__candidatePreview.setSpriteSource(true)})()`);
 const moments=[],shirtLeft=elevation==='high'?230:angle===4?235:230,shirtRight=elevation==='high'?280:angle===4?300:315;
 for(let frame=0;frame<16;frame++){
  moments.push(await page.evaluate(`(()=>{const e=document.querySelector('#sprite-timeline');e.value=${frame};e.dispatchEvent(new Event('input'));const a=document.querySelector('#sprite-canvas').getContext('2d').getImageData(0,0,512,512).data;let xsum=0,ysum=0,n=0;const shirt=[],rowCounts=new Array(300).fill(0);for(let y=140;y<300;y++)for(let x=210;x<335;x++){const i=(y*512+x)*4,v=(a[i]+a[i+1]+a[i+2])/3;if(a[i+3]>225&&v>115&&v<190){if(y<285){xsum+=x;ysum+=y;n++}if(y>=145&&x>=${shirtLeft}&&x<${shirtRight})shirt.push(y);if(x>=220&&x<325)rowCounts[y]++}}let hem=0;for(let y=145;y<300;y++)if(rowCounts[y]>=25)hem=y;return {x:xsum/n,y:ysum/n,n,lo:shirt[Math.floor(shirt.length*.05)],hi:${angle===4?'hem':'shirt[Math.floor(shirt.length*.95)]'}}})()`));
 }
 if(moments.some(m=>m.n<500||!Number.isFinite(m.x)||!Number.isFinite(m.y)))throw Error('Unable to locate the shirt consistently');
 // Normal and low views use a shared torso/foot calibration. The overhead
 // study retains its foreshortened projection instead of stretching it upright.
 const median=key=>moments.map(m=>m[key]).sort((a,b)=>a-b)[8],target={x:median('x'),y:median('y'),lo:elevation==='high'?median('lo'):158,hi:elevation==='high'?median('hi'):angle===4?264:258},offsets=moments.map(m=>({x:Math.round(Math.max(-15,Math.min(15,target.x-m.x))),y:Math.round(Math.max(-15,Math.min(15,target.y-m.y)))})),correctTorso=!raw;
 const feet=[];await page.evaluate('window.__spritePoseFrames=[]');
 for(let frame=0;frame<16;frame++){
  const {x,y}=offsets[frame],{lo,hi}=moments[frame];
  feet.push(await page.evaluate(`(()=>{const e=document.querySelector('#sprite-timeline');e.value=${frame};e.dispatchEvent(new Event('input'));const src=document.querySelector('#sprite-canvas'),c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');if(${correctTorso}){const lo=${lo},hi=${hi},targetLo=${target.lo},targetHi=${target.hi},anchor=targetLo-15;for(let dy=0;dy<512;dy++){let sy=dy;if(dy>=anchor&&dy<targetLo)sy=anchor+(dy-anchor)*(lo-anchor)/(targetLo-anchor);else if(dy>=targetLo&&dy<targetHi)sy=lo+(dy-targetLo)*(hi-lo)/(targetHi-targetLo);else if(dy>=targetHi)sy=hi+(dy-targetHi);if(sy>=0&&sy<511)ctx.drawImage(src,0,sy,512,1,${x},dy,512,1)}}else ctx.drawImage(src,${x},${y});window.__spritePoseFrames[${frame}]=c;const a=ctx.getImageData(0,0,512,512).data,counts=new Array(512).fill(0);let total=0;for(let py=${target.hi}+12;py<512;py++)for(let px=100;px<410;px++)if(a[(py*512+px)*4+3]>220){counts[py]++;total++}let seen=0;for(let py=${target.hi}+12;py<512;py++){seen+=counts[py];if(seen>=total*.99)return py}return 0})()`));
 }
 if(correctTorso&&feet.some(foot=>foot<=target.hi+20))throw Error('Unable to locate the feet consistently');
 const targetFoot=elevation==='high'?[...feet].sort((a,b)=>a-b)[8]:475,legScales=feet.map(foot=>correctTorso?Math.max(.85,Math.min(1.2,(targetFoot-target.hi)/(foot-target.hi))):1);
 for(let frame=0;frame<16;frame++){
  const scale=legScales[frame];
  const data=await page.evaluate(`(()=>{const src=window.__spritePoseFrames[${frame}],c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d'),hip=${target.hi};if(${correctTorso}){ctx.drawImage(src,0,0,512,hip,0,0,512,hip);ctx.drawImage(src,0,hip,512,512-hip,0,hip,512,(512-hip)*${scale})}else ctx.drawImage(src,0,0);return c.toDataURL('image/png').split(',')[1]})()`);
  const buffer=Buffer.from(data,'base64');for(let cycle=0;cycle<3;cycle++)writeFileSync(resolve(out,`${String(cycle*16+frame).padStart(3,'0')}.png`),buffer);
 }
 writeFileSync(resolve(out,'registration.json'),JSON.stringify({target,moments,offsets,feet,targetFoot,legScales,method:correctTorso?'fixed head, torso registration and image-space lower-body length normalization':'integer translation to median shirt centroid; no per-frame scaling'},null,2));console.log(out,JSON.stringify({target,targetFoot,feet,legScales}));
}finally{await page?.close();server.close()}
