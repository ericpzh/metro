// One timeline drives the chart, time boundaries and demand sliders. SMIL also
// runs in image embeds; opening the SVG allows pointer and keyboard edits.
import { demandSeries, DEMAND_LIMITS, DAY_TYPE_FACTOR, PERIOD_FACTOR, DEMAND_AM_HOUR,
  DEMAND_PM_HOUR, DEMAND_MIDDAY_HOUR, DEMAND_SIGMA, DEMAND_FLOOR, DEMAND_MIDDAY } from '../game/src/sim/demand.ts';
import { n } from './iso.mjs';
import { SHOULDER_OPEN, SHOULDER_CLOSE } from '../game/src/sim/constants.ts';

const KEYS = ['amPeak', 'pmPeak', 'sharpness'];
const LABELS = ['开站时间', '关站时间', '早高峰开始', '早高峰结束', '晚高峰开始', '晚高峰结束'];
const px = hour => 26 + hour / 24 * 416; // DayCurve's current 26 / 38 margins.
const clock = hour => { const m=Math.round(hour*60); return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); };
const times = b => `营业 ${clock(b[0])}–${clock(b[1])} · 早高峰 ${clock(b[2])}–${clock(b[3])} · 晚高峰 ${clock(b[4])}–${clock(b[5])}`;

export function demandAnimation(x, y, w, h, spansBox, capture) {
  if (!capture?.input || !capture?.sliders) throw new Error('recapture UI for slider positions and inflow: node tools/render-ui-shots.mjs');
  const input=capture.input, baseRate=capture.baseRate;
  const bounds=[input.service.from,input.service.to,...input.peaks.flatMap(p=>[p.from,p.to])].map(s=>s/3600);
  const ease=(t,a,b)=>{const v=Math.max(0,Math.min(1,(t-a)/(b-a)));return v*v*(3-2*v);};
  // Boundaries, AM height, PM height, width; hold, then return together.
  const frames=Array.from({length:49},(_,i)=>{
    const t=i/2, reset=1-ease(t,20,24);
    const b=bounds.map((v,j)=>v+(j===0?-1:j===3?1:0)*ease(t,1,4)*reset);
    const knobs={...input.knobs,amPeak:input.knobs.amPeak+.55*ease(t,5,8)*reset,
      pmPeak:input.knobs.pmPeak+.5*ease(t,9,12)*reset,sharpness:input.knobs.sharpness+.5*ease(t,13,16)*reset};
    const rates=demandSeries('holiday',{service:{from:b[0]*3600,to:b[1]*3600},
      peaks:[2,4].map(j=>({from:b[j]*3600,to:b[j+1]*3600})),knobs},15);
    const top=Math.ceil(Math.max(1,...rates)*10)/10+.1;
    return {bounds:b,knobs,top,baseY:97-83/top,points:rates.map((r,j)=>`${n(px(j/4))},${n(97-r/top*83)}`).join(' ')};
  });
  const initial=frames[0], keyTimes=frames.map((_,i)=>String(i/48)).join(';');
  const anim=(attr,values,discrete=false)=>`<animate class="demand-motion" attributeName="${attr}" dur="24s" repeatCount="indefinite" keyTimes="${keyTimes}" values="${values.join(';')}" calcMode="${discrete?'discrete':'linear'}"/>`;
  const readout=(id,values,tx,ty,attrs='')=>`<g id="${id}" ${attrs}>`+[...new Set(values)].map(v=>
    `<text x="${n(tx)}" y="${n(ty)}" opacity="${v===values[0]?1:0}">${v}${anim('opacity',values.map(s=>s===v?'1':'0'),true)}</text>`).join('')+'</g>';
  const svg=[`<svg id="demand-edit-chart" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 480 112" style="touch-action:none">`,
    '<rect width="480" height="112" fill="#0b1b2c"/><rect x="26" y="14" width="416" height="83" fill="#06111d"/>'];
  for(const i of [0,2,4]) svg.push(`<rect id="demand-band-${i}" x="${n(px(bounds[i]))}" y="14" width="${n(px(bounds[i+1])-px(bounds[i]))}" height="83" fill="${i?'#ffc861':'#55b6ff'}" opacity=".14">`
    +anim('x',frames.map(f=>n(px(f.bounds[i]))))+anim('width',frames.map(f=>n(px(f.bounds[i+1])-px(f.bounds[i]))))+'</rect>');
  svg.push(`<line id="demand-baseline" x1="26" x2="442" y1="${n(initial.baseY)}" y2="${n(initial.baseY)}" stroke="#7ea6c9" stroke-dasharray="3 4" opacity=".4">`
    +anim('y1',frames.map(f=>n(f.baseY)))+anim('y2',frames.map(f=>n(f.baseY)))+'</line>',
    `<polyline id="demand-live-line" points="${initial.points}" fill="none" stroke="#55b6ff" stroke-width="1.5">${anim('points',frames.map(f=>f.points))}</polyline>`);
  for(let i=0;i<9;i++) svg.push(`<text x="${n(px(i*3))}" y="108" font-size="6" text-anchor="${i===0?'start':i===8?'end':'middle'}" fill="#7ea6c9">${String(i*3).padStart(2,'0')}</text>`);
  svg.push(readout('demand-top',frames.map(f=>Math.round(f.top*100)+'%'),22,22,'font-size="6" text-anchor="end" fill="#7ea6c9"'),
    '<text x="22" y="97" text-anchor="end" font-size="6" fill="#7ea6c9">0</text>',
    '<text x="446" y="10" font-size="6" fill="#7ea6c9">人/时</text>',
    readout('demand-count-top',frames.map(f=>Math.round(f.top*baseRate).toLocaleString('en-US')),446,22,'font-size="6" fill="#7ea6c9"'),
    `<text id="demand-count-base" x="446" y="${n(initial.baseY+3)}" font-size="6" fill="#7ea6c9">${baseRate.toLocaleString('en-US')}${anim('y',frames.map(f=>n(f.baseY+3)))}</text>`,
    '<text x="446" y="97" font-size="6" fill="#7ea6c9">0</text>');
  bounds.forEach((v,i)=>svg.push(`<g id="demand-grip-${i}" transform="translate(${n(px(v))},0)">`
    +`<animateTransform class="demand-motion" attributeName="transform" type="translate" dur="24s" repeatCount="indefinite" keyTimes="${keyTimes}" values="${frames.map(f=>n(px(f.bounds[i]))+' 0').join(';')}"/>`
    +`<line y1="6" y2="97" stroke="${i<2?'#55b6ff':'#ffc861'}" stroke-width="1" stroke-dasharray="2 3"/><rect x="-3.5" y="3" width="7" height="7" fill="${i<2?'#55b6ff':'#ffc861'}"/>`
    +`<rect data-boundary="${i}" tabindex="0" role="slider" aria-label="${LABELS[i]}" aria-valuemin="0" aria-valuemax="1440" aria-valuenow="${v*60}" x="-7" y="0" width="14" height="97" fill="transparent" style="cursor:ew-resize"/></g>`));
  svg.push('</svg>',`<rect x="${n(spansBox.x)}" y="${n(spansBox.y)}" width="${n(spansBox.w)}" height="${n(spansBox.h)}" fill="#0b1b2c"/>`,
    readout('demand-live-times',frames.map(f=>times(f.bounds)),spansBox.x,spansBox.y+spansBox.h-3,'font-size="11" fill="#8fc4ee"'));
  const sliders=capture.sliders.map((s,i)=>({label:s.label,key:KEYS[i],range:capture.placeBox(s.range),value:capture.placeBox(s.value),limits:DEMAND_LIMITS[KEYS[i]]}));
  sliders.forEach((s,i)=>{
    const r=s.range,v=s.value,left=r.x+6,width=r.w-12,cy=r.y+r.h/2;
    const pos=f=>left+(f.knobs[s.key]-s.limits[0])/(s.limits[1]-s.limits[0])*width;
    svg.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="#0b1b2c"/>`,
      `<rect x="${n(v.x-2)}" y="${n(v.y)}" width="${n(v.w+4)}" height="${n(v.h)}" fill="#0b1b2c"/>`,
      `<rect x="${n(left)}" y="${n(cy-4)}" width="${n(width)}" height="8" rx="4" fill="#444" stroke="#888"/>`,
      `<rect id="demand-slider-fill-${i}" x="${n(left)}" y="${n(cy-4)}" width="${n(pos(initial)-left)}" height="8" rx="4" fill="#55b6ff">${anim('width',frames.map(f=>n(pos(f)-left)))}</rect>`,
      `<circle id="demand-slider-thumb-${i}" cx="${n(pos(initial))}" cy="${n(cy)}" r="9" fill="#55b6ff">${anim('cx',frames.map(f=>n(pos(f))))}</circle>`,
      readout('demand-slider-value-'+i,frames.map(f=>Math.round(f.knobs[s.key]*100)+'%'),v.x+v.w,v.y+v.h*.8,'font-size="14" font-weight="700" text-anchor="end" fill="#d6e7f7"'),
      `<rect data-knob="${i}" tabindex="0" role="slider" aria-label="${s.label}" aria-valuemin="${s.limits[0]*100}" aria-valuemax="${s.limits[1]*100}" aria-valuenow="${initial.knobs[s.key]*100}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="transparent" style="cursor:ew-resize;touch-action:none"/>`);
  });
  // All coefficients are imported from the sim for the standalone SVG's edits.
  const model={am:DEMAND_AM_HOUR,pm:DEMAND_PM_HOUR,mid:DEMAND_MIDDAY_HOUR,sigma:DEMAND_SIGMA,floor:DEMAND_FLOOR,midday:DEMAND_MIDDAY,factors:PERIOD_FACTOR,day:DAY_TYPE_FACTOR.holiday,shoulderOpen:SHOULDER_OPEN/3600,shoulderClose:SHOULDER_CLOSE/3600};
  svg.push(`<script><![CDATA[(() => {
    const root=document.documentElement,chart=document.getElementById('demand-edit-chart');
    let bounds=${JSON.stringify(bounds)},knobs=${JSON.stringify(initial.knobs)},held=null;
    const frames=${JSON.stringify(frames.map(f=>({bounds:f.bounds,knobs:f.knobs})))},sliders=${JSON.stringify(sliders)},model=${JSON.stringify(model)},baseRate=${baseRate};
    const px=${px.toString()},clock=${clock.toString()},times=${times.toString()};
    const text=(id,value)=>{const g=document.getElementById(id),t=g.querySelector('text');g.replaceChildren(t);t.setAttribute('opacity','1');t.textContent=value;};
    const stop=()=>{if(root.hasAttribute('data-demand-interactive'))return;
      const f=frames[Math.min(48,Math.round(root.getCurrentTime()%24*2))];bounds=[...f.bounds];knobs={...f.knobs};
      root.querySelectorAll('.demand-motion').forEach(el=>el.remove());root.setAttribute('data-demand-interactive','');};
    const draw=()=>{
      const gauss=(h,mu,sigma)=>Math.exp(-((h-mu)**2)/(2*sigma*sigma));
      const rates=Array.from({length:97},(_,i)=>{const h=(i/4)%24,s=knobs.sharpness;
        const shape=model.floor+knobs.amPeak*gauss(h,model.am,model.sigma.am*s)+knobs.pmPeak*gauss(h,model.pm,model.sigma.pm*s)+model.midday*gauss(h,model.mid,model.sigma.midday*s);
        const factor=h<bounds[0]||h>=bounds[1]?model.factors.late:((h>=bounds[2]&&h<bounds[3])||(h>=bounds[4]&&h<bounds[5]))?model.factors.peak:(h<model.shoulderOpen||h>=model.shoulderClose)?model.factors.late:model.factors.offpeak;return shape*factor*model.day;});
      const top=Math.ceil(Math.max(1,...rates)*10)/10+.1,by=97-83/top;
      document.getElementById('demand-live-line').setAttribute('points',rates.map((r,i)=>px(i/4)+','+(97-r/top*83)).join(' '));
      const base=document.getElementById('demand-baseline');base.setAttribute('y1',by);base.setAttribute('y2',by);
      text('demand-top',Math.round(top*100)+'%');text('demand-count-top',Math.round(top*baseRate).toLocaleString('en-US'));
      document.getElementById('demand-count-base').setAttribute('y',by+3);text('demand-live-times',times(bounds));
      for(const i of [0,2,4]){const r=document.getElementById('demand-band-'+i);r.setAttribute('x',px(bounds[i]));r.setAttribute('width',px(bounds[i+1])-px(bounds[i]));}
      bounds.forEach((v,i)=>{document.getElementById('demand-grip-'+i).setAttribute('transform','translate('+px(v)+',0)');chart.querySelector('[data-boundary="'+i+'"]').setAttribute('aria-valuenow',Math.round(v*60));});
      sliders.forEach((s,i)=>{const r=s.range,l=r.x+6,v=knobs[s.key],p=l+(v-s.limits[0])/(s.limits[1]-s.limits[0])*(r.w-12);
        document.getElementById('demand-slider-thumb-'+i).setAttribute('cx',p);document.getElementById('demand-slider-fill-'+i).setAttribute('width',p-l);
        text('demand-slider-value-'+i,Math.round(v*100)+'%');root.querySelector('[data-knob="'+i+'"]').setAttribute('aria-valuenow',Math.round(v*100));});};
    const set=(hit,clientX,clientY,delta)=>{stop();
      if(hit.hasAttribute('data-boundary')){const i=Number(hit.dataset.boundary),p=new DOMPoint(clientX,clientY).matrixTransform(chart.getScreenCTM().inverse());
        const v=delta===undefined?(p.x-26)/416*24:bounds[i]+delta/60;
        bounds[i]=Math.max(i%2?bounds[i-1]+.25:0,Math.min(i%2?24:bounds[i+1]-.25,Math.round(v*60)/60));
      }else{const s=sliders[Number(hit.dataset.knob)],p=new DOMPoint(clientX,clientY).matrixTransform(root.getScreenCTM().inverse());
        const v=delta===undefined?s.limits[0]+(p.x-s.range.x-6)/(s.range.w-12)*(s.limits[1]-s.limits[0]):knobs[s.key]+delta/100;
        knobs[s.key]=Math.max(s.limits[0],Math.min(s.limits[1],Math.round(v*100)/100));}draw();};
    root.addEventListener('pointerdown',e=>{const hit=e.target.closest('[data-boundary],[data-knob]');if(!hit)return;held={hit,id:e.pointerId};root.setPointerCapture(e.pointerId);set(hit,e.clientX,e.clientY);e.preventDefault();});
    root.addEventListener('pointermove',e=>{if(held&&held.id===e.pointerId)set(held.hit,e.clientX,e.clientY);});
    const end=e=>{if(!held||held.id!==e.pointerId)return;held=null;if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId);};
    root.addEventListener('pointerup',end);root.addEventListener('pointercancel',end);
    root.addEventListener('keydown',e=>{const hit=e.target.closest('[data-boundary],[data-knob]');if(!hit||!['ArrowLeft','ArrowRight'].includes(e.key))return;
      set(hit,0,0,(e.key==='ArrowRight'?1:-1)*(hit.hasAttribute('data-boundary')?(e.shiftKey?60:15):(e.shiftKey?10:1)));e.preventDefault();});
  })();]]></script>`);
  return svg.join('');
}
