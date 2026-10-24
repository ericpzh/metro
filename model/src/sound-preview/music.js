export function setupMusic({ready, engine}) {
 const root=document.getElementById('music-tracks'), player=document.getElementById('music-player');
 const now=document.getElementById('music-now');
 let tracks=[], current=-1, token=0, node;
 player.volume=.35;
 async function play(index) {
  const request=++token;
  try {
   player.pause();
   await ready();
   if(request!==token)return;
   if(!node){node=engine.context.createMediaElementSource(player);node.connect(engine.buses.master);}
   current=(index+tracks.length)%tracks.length;
   const track=tracks[current];
   player.src=new URL('./sounds/music/'+track.file,document.baseURI).href;
   now.textContent=`${track.title} · ${track.author}`;
   root.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===current)));
   await player.play();
  } catch(error) {if(request===token)now.textContent=`Could not play this preview: ${error.message}. Try again or open the source.`;}
 }
 function stop(){++token;player.pause();}
 player.onended=()=>{if(document.getElementById('music-cycle').checked)void play(current+1);};
 player.onerror=()=>{now.textContent='Music unavailable. Try another track or open its source link.';};
 document.getElementById('music-start').onclick=()=>void play(current<0?0:current);
 document.getElementById('music-next').onclick=()=>{if(tracks.length)void play(current+1);};
 fetch(new URL('./sounds/music/manifest.json',document.baseURI)).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(data=>{
  tracks=data;
  for(const [i,track] of tracks.entries()){
   const card=document.createElement('article');
   const title=document.createElement('h3');title.textContent=track.title;
   const description=document.createElement('p');description.textContent=track.description;
   const button=document.createElement('button');button.textContent='▶ Preview';button.setAttribute('aria-label','Preview '+track.title);button.setAttribute('aria-pressed','false');button.onclick=()=>void play(i);
   const source=document.createElement('a');source.href=track.source;source.target='_blank';source.rel='noreferrer';source.textContent='Full track / source ↗';
   const credit=document.createElement('small');credit.textContent=track.credit;
   const license=document.createElement('a');license.href=track.licenseUrl;license.target='_blank';license.rel='noreferrer';license.textContent=track.license+(track.license==='CC0'?' · credit optional':' · credit required');
   card.append(title,description,button,source,license,credit);root.append(card);
  }
  document.getElementById('music-start').disabled=false;document.getElementById('music-next').disabled=false;
 }).catch(()=>{now.textContent='Music collection could not load. Refresh to try again.';});
 return {stop};
}
