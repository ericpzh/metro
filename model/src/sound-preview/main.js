import './style.css';
import {SoundEngine} from './audio.js';
import {EFFECTS as effects} from './effects.js';
import {sanitizeMix, spatialMix} from './spatial.js';
import {setupMusic} from './music.js';
import {SPEEDS,TACTICS,sanitizeTactics,defaultTactics,ambientPolicy,trainPass} from './ambient.js';
const $=id=>document.getElementById(id);
const audio=new SoundEngine();
const music=setupMusic({ready,engine:audio});
let mix=sanitizeMix(null);
try {mix=sanitizeMix(JSON.parse(localStorage.getItem('metro-sound-study')));}catch{}
const listener={x:0,y:8,z:12,bearing:0};
const sources=[
 {id:'crowd',label:'Passengers',color:'#78866b',x:-15,y:-6,z:0,reference:12,radius:95,file:'crowd.mp3'},
 {id:'train',label:'Train',color:'#64869b',x:0,y:-8,z:25,reference:10,radius:130,file:'train.mp3'},
 {id:'traffic',label:'Traffic',color:'#ac8d5c',x:15,y:0,z:-35,reference:14,radius:150,file:'traffic.mp3'},
];
const scenarios=[
 {name:'Quiet concourse',detail:'A small crowd in the concourse. Train and street layers are absent.',weights:[.45,0,0],camera:[0,8,12]},
 {name:'Rush hour',detail:'A busy concourse, passing train, and distant street traffic.',weights:[1,.85,.6],camera:[0,8,12]},
 {name:'Platform arrival',detail:'At platform level, a moving train dominates with passengers nearby.',weights:[.55,1,.15],camera:[0,-5,20]},
 {name:'Street entrance',detail:'Traffic at the surface, with the station sounding farther below.',weights:[.3,.3,1],camera:[12,3,-25]},
];
let scene=1,playing=false,starting=false,run=0,sequenceRun=0;
let speed=1,solo=null,travel=0,tactics=defaultTactics();
try{tactics=sanitizeTactics(JSON.parse(localStorage.getItem('metro-sound-tactics-v2')));}catch{}
function saveTactics(){try{localStorage.setItem('metro-sound-tactics-v2',JSON.stringify(tactics));}catch{}}
function policy(id){return ambientPolicy(tactics[id][speed],speed);}
function applyTactics(){for(const s of sources)audio.loops.get(s.id)?.setPolicy(policy(s.id));updateSpatial();}
function drawTactics(){
 $('speeds').innerHTML=SPEEDS.map(value=>`<button data-speed="${value}" aria-pressed="${value===speed}">${value}×</button>`).join('');
 $('speeds').querySelectorAll('button').forEach(button=>button.onclick=()=>{speed=Number(button.dataset.speed);drawTactics();applyTactics();});
 $('tactics').innerHTML=sources.map(s=>`<tr><th scope="row">${s.label}<button class="solo" data-solo="${s.id}" aria-pressed="${solo===s.id}" aria-label="Solo ${s.label}">Solo</button></th>${SPEEDS.map(value=>`<td class="${value===speed?'active-speed':''}"><select data-tactic="${s.id}" data-at-speed="${value}" aria-label="${s.label} tactic at ${value}×">${TACTICS.map(t=>`<option value="${t.id}" ${tactics[s.id][value]===t.id?'selected':''}>${t.label}</option>`).join('')}</select></td>`).join('')}</tr>`).join('');
 $('tactics').querySelectorAll('select').forEach(select=>select.onchange=()=>{tactics[select.dataset.tactic][select.dataset.atSpeed]=select.value;saveTactics();drawTactics();applyTactics();});
 $('tactics').querySelectorAll('[data-solo]').forEach(button=>button.onclick=()=>{solo=solo===button.dataset.solo?null:button.dataset.solo;drawTactics();updateSpatial();});
 $('tactic-details').innerHTML=sources.map(s=>{const tactic=TACTICS.find(t=>t.id===tactics[s.id][speed]);return `<p><strong>${s.label} · ${speed}×</strong><span>${tactic.detail}</span></p>`;}).join('');
}
document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>{
 const preset=button.dataset.preset,defaults=defaultTactics();
 for(const s of sources)tactics[s.id][speed]=preset==='game'?defaults[s.id][speed]:preset==='skip'?(s.id==='train'?'skip':defaults[s.id][speed]):preset;
 saveTactics();drawTactics();applyTactics();
});
function replayPass(){travel=0;audio.loops.get('train')?.replay();updateSpatial();}
$('replay-pass').onclick=replayPass;
$('replay-pass').before($('ambience'));
function status(text){$('status').textContent=text;}
function fail(error){status(`Audio unavailable: ${error.message}. Try Enable audio again.`);console.error(error);}
async function ready(){await audio.enable(mix);$('enable').textContent='✓ Audio enabled';}
$('enable').onclick=()=>ready().then(()=>status('Ready. Tap an interaction or play a scene.')).catch(fail);
function persist(){try{localStorage.setItem('metro-sound-study',JSON.stringify(mix));}catch{}audio.apply(mix);}
function drawMixer(){
 $('mixer').innerHTML=Object.entries(mix).map(([id,v])=>`<div class="mixer-row"><label class="mix-title"><input type="checkbox" data-enable="${id}" ${v.enabled?'checked':''}>${({master:'Master volume',effects:'Interaction effects',ambience:'Ambient sound',crowd:'Passengers',train:'Trains',traffic:'Traffic'})[id]}</label><output id="${id}-value">${Math.round(v.volume*100)}%</output><input aria-label="${id} volume" type="range" min="0" max="100" value="${v.volume*100}" data-volume="${id}"></div>`).join('');
 $('mixer').querySelectorAll('[data-enable]').forEach(el=>el.onchange=()=>{mix[el.dataset.enable].enabled=el.checked;persist();});
 $('mixer').querySelectorAll('[data-volume]').forEach(el=>el.oninput=()=>{mix[el.dataset.volume].volume=Number(el.value)/100;$(el.dataset.volume+'-value').textContent=el.value+'%';persist();});
}
drawMixer();$('reset').onclick=()=>{mix=sanitizeMix(null);drawMixer();persist();};
$('settings-toggle').onclick=()=>{const hidden=$('settings').hidden=!$('settings').hidden;$('settings-toggle').setAttribute('aria-expanded',String(!hidden));document.querySelector('.workspace').classList.toggle('settings-hidden',hidden);};
$('effects').innerHTML=effects.map(({name,icon,hint,label},i)=>`<article class="effect"><button class="effect-play" data-effect="${i}" aria-label="Play ${name}"><span>${icon}</span>${name} <small>▶</small></button><p>${hint}</p><div class="chosen-sound">${label}</div></article>`).join('');
async function effect(i){
 const epoch=audio.epoch;await ready();if(epoch!==audio.epoch)return;await audio.play(effects[i].file,'effects',{epoch});
 $('last-action').textContent=effects[i].name;$('last-detail').textContent=effects[i].hint;$('block-icon').textContent=effects[i].icon;
 status(`${effects[i].name} · ${effects[i].label}`);
}
$('effects').querySelectorAll('button').forEach(button=>button.onclick=()=>effect(Number(button.dataset.effect)).catch(fail));
$('sequence').onclick=async()=>{const token=++sequenceRun;try{await ready();for(const i of [0,3,1,2,4,5]){if(token!==sequenceRun)return;await effect(i);await new Promise(r=>setTimeout(r,450));}}catch(error){fail(error);}};
function stop(){++run;++sequenceRun;playing=false;starting=false;music.stop();audio.stop();$('ambience').textContent='▶ Play scene';status('All sounds stopped.');}
$('stop').onclick=stop;
$('scenarios').innerHTML=scenarios.map((s,i)=>`<button data-scene="${i}" aria-pressed="${i===scene}">${s.name}</button>`).join('');
$('scenarios').querySelectorAll('button').forEach(button=>button.onclick=()=>{
 scene=Number(button.dataset.scene);const c=scenarios[scene].camera;[listener.x,listener.y,listener.z]=c;
 $('height').value=listener.y;updateScene();updateSpatial();
});
function updateScene(){
 $('scenario-description').textContent=scenarios[scene].detail;
 $('scenarios').querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===scene)));
}
updateScene();
$('ambience').onclick=async()=>{
 if(playing||starting){stop();return;}
 audio.stop();
 starting=true;const token=++run;$('ambience').textContent='■ Cancel loading';status('Loading local field recordings…');
 try{
  await ready();if(token!==run)return;
  // Install only after every buffer is ready; cancellation cannot leak a late loop.
  await Promise.all(sources.map(s=>audio.load(s.file)));if(token!==run)return;
  for(const s of sources){const voice=await audio.ambient(s.file,s.id,policy(s.id));if(token!==run){voice?.stop();return;}}
  travel=0;
  playing=true;starting=false;$('ambience').textContent='■ Stop scene';updateSpatial();status('Scene playing. Move the camera to change what you hear.');
 }catch(error){if(token===run){stop();fail(error);}}
};
const svgNS='http://www.w3.org/2000/svg';
sources.forEach(s=>{
 const group=document.createElementNS(svgNS,'g');group.id='marker-'+s.id;
 group.innerHTML=`<circle r="32" fill="${s.color}" opacity=".12"/><circle r="7" fill="${s.color}"/><text x="14" y="-8">${s.label.toUpperCase()}</text>`;
 $('source-markers').append(group);
});
$('sources').innerHTML=sources.map(s=>`<div><span class="dot" style="background:${s.color}"></span><strong>${s.label}</strong><span id="distance-${s.id}"></span><meter id="level-${s.id}" min="0" max="1" value="0" aria-label="${s.label} distance gain"></meter></div>`).join('');
function updateSpatial(){
 const pass=trainPass(travel,$('motion').checked);sources[1].x=pass.x;
 $('pass-status').textContent=`${speed}× simulation · ${pass.phase} · ${travel.toFixed(1)} simulated seconds${solo?' · Solo '+sources.find(s=>s.id===solo).label:''}`;
 const px=x=>380+x*7.6,pz=z=>175+z*3.5;
 $('listener').setAttribute('transform',`translate(${px(listener.x)} ${pz(listener.z)})`);
 $('heading').setAttribute('transform',`rotate(${-listener.bearing*180/Math.PI})`);
 $('height-value').textContent=`${listener.y} m`;$('bearing-value').textContent=`${Math.round(listener.bearing*180/Math.PI)}°`;
 sources.forEach((s,i)=>{
  const spatial=spatialMix(listener,s,s),gain=spatial.gain*scenarios[scene].weights[i]*(s.id==='train'?pass.gain:1)*(solo&&solo!==s.id?0:1)*(policy(s.id).mode==='mute'?0:1);
  const voice=audio.loops.get(s.id);
  if(voice){const t=audio.context.currentTime;voice.tick();voice.level.gain.setTargetAtTime(gain*.65,t,s.id==='train'?.015:.08);voice.pan.pan.setTargetAtTime(spatial.pan,t,.025);}
  $('marker-'+s.id).setAttribute('transform',`translate(${px(s.x)} ${pz(s.z)})`);
  $('distance-'+s.id).textContent=`${spatial.distance.toFixed(1)} m · ${Math.round(gain*100)}%`;
  $('level-'+s.id).value=gain;
 });
}
$('height').oninput=()=>{listener.y=Number($('height').value);updateSpatial();};
$('bearing').oninput=()=>{listener.bearing=Number($('bearing').value)*Math.PI/180;updateSpatial();};
$('motion').onchange=updateSpatial;
function move(event){const rect=$('map').getBoundingClientRect();listener.x=Math.max(-50,Math.min(50,((event.clientX-rect.left)/rect.width*760-380)/7.6));listener.z=Math.max(-50,Math.min(50,((event.clientY-rect.top)/rect.height*350-175)/3.5));updateSpatial();}
$('map').onpointerdown=event=>{if(event.button!==0)return;$('map').setPointerCapture(event.pointerId);move(event);};
$('map').onpointermove=event=>{if($('map').hasPointerCapture(event.pointerId))move(event);};
// Keyboard alternative to map drag; the visible controls cover height and bearing.
$('map').setAttribute('tabindex','0');$('map').setAttribute('aria-label','Camera sound map. Drag or use arrow keys to move the camera by two metres.');
$('map').onkeydown=event=>{const d={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[event.key];if(d){event.preventDefault();listener.x=Math.max(-50,Math.min(50,listener.x+d[0]));listener.z=Math.max(-50,Math.min(50,listener.z+d[1]));updateSpatial();}};
let last=0;
function frame(now){const dt=Math.min((now-last)/1000,.25);last=now;if(playing){if($('motion').checked)travel+=dt*speed;updateSpatial();}requestAnimationFrame(frame);}
drawTactics();requestAnimationFrame(frame);updateSpatial();
const recordingInfo=[
 ['crowd','Station crowd','mrrap4food','619010','A recorded station bed; voices and transport can overlap. Use as a crowd-area source, not individual passengers.'],
 ['train','Subway / underground','Syphon64','135209','A Glasgow subway recording. For this preview it loops; a final arrival/departure should use edited one-shot regions.'],
 ['traffic','Light street traffic','ViaTorci','66794','A roadside recording with passing vehicles. A broad road source is more convincing than a source on every car.'],
];
$('recordings').innerHTML=recordingInfo.map(([id,title,author,soundId,description])=>`<article><p class="eyebrow">FIELD RECORDING / CC0</p><h3>${title}</h3><p>${description}</p><button data-recording="${id}">▶ Audition recording</button><a href="https://freesound.org/people/${author}/sounds/${soundId}/" target="_blank" rel="noreferrer">${author} / Freesound ↗</a><small id="duration-${id}">HQ MP3 preview · local copy</small></article>`).join('');
$('recordings').querySelectorAll('button').forEach(button=>button.onclick=async()=>{try{stop();const epoch=audio.epoch;await ready();if(epoch!==audio.epoch)return;await audio.play(button.dataset.recording+'.mp3',button.dataset.recording,{gain:.65,epoch});status('Auditioning '+button.dataset.recording+' recording, centered. Stop all ends playback.');}catch(error){fail(error);}});
document.querySelectorAll('[data-sample]').forEach(button=>button.onclick=async()=>{try{const epoch=audio.epoch;await ready();if(epoch===audio.epoch){await audio.play(button.dataset.sample,'effects',{epoch});status('Auditioning concrete footstep.');}}catch(error){fail(error);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();audio.context?.suspend();}});
