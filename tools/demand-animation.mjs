// The chart is editable when opened as SVG; image embeds show a boundary demo.
import { demandShape, DEFAULT_DEMAND_INPUT, DAY_TYPE_FACTOR, PERIOD_FACTOR } from '../game/src/sim/demand.ts';
import { n } from './iso.mjs';

export function demandAnimation(x, y, w, h, spansBox) {
  const input = DEFAULT_DEMAND_INPUT;
  const values = [input.service.from, input.service.to, ...input.peaks.flatMap(p => [p.from, p.to])].map(s => s / 3600);
  const shape = Array.from({ length: 97 }, (_, i) => demandShape(i / 4));
  const labels = ['开站时间', '关站时间', '早高峰开始', '早高峰结束', '晚高峰开始', '晚高峰结束'];
  const clock = hour => { const m = Math.round(hour * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const px = hour => 26 + hour / 24 * 448;
  const line = (bounds) => {
    const rates = shape.map((s, i) => {
      const hour = i / 4;
      const factor = hour < bounds[0] || hour >= bounds[1] ? PERIOD_FACTOR.late
        : ((hour >= bounds[2] && hour < bounds[3]) || (hour >= bounds[4] && hour < bounds[5])) ? PERIOD_FACTOR.peak : PERIOD_FACTOR.offpeak;
      return s * factor * DAY_TYPE_FACTOR.holiday;
    });
    const top = Math.ceil(Math.max(1, ...rates) * 10) / 10 + .1;
    return { top, points: rates.map((r, i) => `${n(px(i / 4))},${n(97 - r / top * 83)}`).join(' ') };
  };
  const initial = line(values), alternateBounds = values.map((v, i) => v + (i === 0 ? -1 : i === 3 ? 1 : 0));
  const alternate = line(alternateBounds);
  const bands = [0, 2, 4].map(i => `<rect id="demand-band-${i}" class="demand-demo" x="${n(px(values[i]))}" y="14" width="${n(px(values[i + 1]) - px(values[i]))}" height="83" fill="${i ? '#ffc861' : '#55b6ff'}" opacity=".14"${i < 4 ? ` style="animation:demand-band-${i} 12s ease-in-out infinite"` : ''}/>`).join('');
  const grips = values.map((v, i) => `<g id="demand-grip-${i}" class="demand-demo" transform="translate(${n(px(v))},0)"${i === 0 || i === 3 ? ` style="animation:demand-grip-${i} 12s ease-in-out infinite"` : ''}>`
    + `<line x1="0" x2="0" y1="6" y2="97" stroke="${i < 2 ? '#55b6ff' : '#ffc861'}" stroke-width="1" stroke-dasharray="2 3"/>`
    + `<rect x="-3.5" y="3" width="7" height="7" fill="${i < 2 ? '#55b6ff' : '#ffc861'}"/>`
    + `<rect data-boundary="${i}" tabindex="0" role="slider" aria-label="${labels[i]}" aria-valuemin="0" aria-valuemax="1440" aria-valuenow="${v * 60}" x="-7" y="0" width="14" height="97" fill="transparent" style="cursor:ew-resize;touch-action:none"/>`
    + '</g>').join('');
  const css = [0, 2].map(i => `@keyframes demand-band-${i}{0%,100%{x:${n(px(values[i]))}px;width:${n(px(values[i+1])-px(values[i]))}px}40%,60%{x:${n(px(alternateBounds[i]))}px;width:${n(px(alternateBounds[i+1])-px(alternateBounds[i]))}px}}`).join('')
    + [0, 3].map(i => `@keyframes demand-grip-${i}{0%,100%{transform:translate(${n(px(values[i]))}px,0)}40%,60%{transform:translate(${n(px(alternateBounds[i]))}px,0)}}`).join('');
  const svg = `<style>${css}@keyframes demand-alt{0%,20%,80%,100%{opacity:0}40%,60%{opacity:1}}@keyframes demand-reference{0%,20%,80%,100%{opacity:1}40%,60%{opacity:0}}svg[data-demand-interactive] .demand-demo{animation:none!important}</style>`
    + `<svg id="demand-edit-chart" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 480 112" style="touch-action:none">`
    + '<rect width="480" height="112" fill="#0b1b2c"/>'
    + '<rect x="26" y="14" width="448" height="83" fill="#06111d"/>' + bands
    + `<line id="demand-baseline" x1="26" x2="474" y1="${n(97 - 83 / initial.top)}" y2="${n(97 - 83 / initial.top)}" stroke="#7ea6c9" stroke-dasharray="3 4" opacity=".4"/>`
    + `<polyline id="demand-live-line" class="demand-demo" style="animation:demand-reference 12s ease-in-out infinite" points="${initial.points}" fill="none" stroke="#55b6ff" stroke-width="1.5"/>`
    + `<g class="demand-demo" style="animation:demand-alt 12s ease-in-out infinite;opacity:0"><rect x="26" y="14" width="448" height="83" fill="#0b1b2c" fill-opacity=".15"/><polyline points="${alternate.points}" fill="none" stroke="#55b6ff" stroke-width="1.5"/></g>`
    + Array.from({ length: 9 }, (_, i) => `<text x="${n(px(i * 3))}" y="108" font-size="6" text-anchor="middle" fill="#7ea6c9">${String(i * 3).padStart(2, '0')}</text>`).join('')
    + `<text id="demand-top" x="22" y="22" text-anchor="end" font-size="6" fill="#7ea6c9">${Math.round(initial.top * 100)}%</text><text x="22" y="97" text-anchor="end" font-size="6" fill="#7ea6c9">0</text>`
    + grips + '</svg>'
    + `<rect x="${n(spansBox.x)}" y="${n(spansBox.y)}" width="${n(spansBox.w)}" height="${n(spansBox.h)}" fill="#0b1b2c"/>`
    + `<text id="demand-live-times" x="${n(spansBox.x)}" y="${n(spansBox.y + spansBox.h - 3)}" font-size="11" fill="#8fc4ee">营业 ${clock(values[0])}–${clock(values[1])} · 早高峰 ${clock(values[2])}–${clock(values[3])} · 晚高峰 ${clock(values[4])}–${clock(values[5])}</text>`;
  const script = `<script><![CDATA[(() => {
    const root = document.documentElement, chart = document.getElementById('demand-edit-chart');
    root.setAttribute('data-demand-interactive', '');
    const bounds = ${JSON.stringify(values)}, shape = ${JSON.stringify(shape)};
    const factors = ${JSON.stringify(PERIOD_FACTOR)}, day = ${DAY_TYPE_FACTOR.holiday};
    const px = hour => 26 + hour / 24 * 448;
    const clock = hour => { const m = Math.round(hour * 60); return String(Math.floor(m / 60)).padStart(2,'0') + ':' + String(m % 60).padStart(2,'0'); };
    const draw = () => {
      for (const i of [0,2,4]) { const r = document.getElementById('demand-band-' + i); r.setAttribute('x',px(bounds[i])); r.setAttribute('width',px(bounds[i+1])-px(bounds[i])); }
      bounds.forEach((v,i) => { document.getElementById('demand-grip-'+i).setAttribute('transform','translate('+px(v)+',0)'); const hit = chart.querySelector('[data-boundary="'+i+'"]'); hit.setAttribute('aria-valuenow',Math.round(v*60)); hit.setAttribute('aria-valuetext',clock(v)); });
      const rates = shape.map((s,i) => { const h=i/4; const f=h<bounds[0]||h>=bounds[1]?factors.late:((h>=bounds[2]&&h<bounds[3])||(h>=bounds[4]&&h<bounds[5]))?factors.peak:factors.offpeak; return s*f*day; });
      const top=Math.ceil(Math.max(1,...rates)*10)/10+.1;
      document.getElementById('demand-live-line').setAttribute('points',rates.map((r,i)=>px(i/4)+','+(97-r/top*83)).join(' '));
      const base=document.getElementById('demand-baseline'); base.setAttribute('y1',97-83/top); base.setAttribute('y2',97-83/top);
      document.getElementById('demand-top').textContent=Math.round(top*100)+'%';
      document.getElementById('demand-live-times').textContent='营业 '+clock(bounds[0])+'–'+clock(bounds[1])+' · 早高峰 '+clock(bounds[2])+'–'+clock(bounds[3])+' · 晚高峰 '+clock(bounds[4])+'–'+clock(bounds[5]);
    };
    chart.querySelectorAll('.demand-demo').forEach(el => { if (el.style.animation.includes('demand-alt')) el.style.opacity='0'; });
    let held=null, pointer=null;
    const set = (i,v) => { const low=i%2?bounds[i-1]+.25:0, high=i%2?24:bounds[i+1]-.25; bounds[i]=Math.max(low,Math.min(high,Math.round(v*60)/60)); draw(); };
    chart.addEventListener('pointerdown',e=>{ const hit=e.target.closest('[data-boundary]'); if(!hit)return; held=Number(hit.dataset.boundary); pointer=e.pointerId; chart.setPointerCapture(pointer); e.preventDefault(); });
    chart.addEventListener('pointermove',e=>{ if(held===null||e.pointerId!==pointer)return; const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(chart.getScreenCTM().inverse()); set(held,(p.x-26)/448*24); });
    const end=e=>{ if(e.pointerId!==pointer)return; held=null; if(chart.hasPointerCapture(pointer))chart.releasePointerCapture(pointer); pointer=null; };
    chart.addEventListener('pointerup',end); chart.addEventListener('pointercancel',end);
    chart.addEventListener('keydown',e=>{ const hit=e.target.closest('[data-boundary]'); if(!hit||!['ArrowLeft','ArrowRight'].includes(e.key))return; const i=Number(hit.dataset.boundary); set(i,bounds[i]+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.25)); e.preventDefault(); });
    draw();
  })();]]></script>`;
  return svg + script;
}
