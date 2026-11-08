// Editorial timing is independent of capture mechanics. Copy stays in the site's
// existing bilingual catalogues, so new site wording flows into the next render.
import { gallery } from '../../web/src/artworks.js'
import { ui } from '../../web/src/i18n.js'
import { tForLanguage } from '../../game/src/sim/i18n.ts'
import { CITY_STYLE_IDS } from '../../game/src/sim/cityStyles.ts'
import {GUANGZHOU_LINE_COLOURS} from '../../game/src/sim/cityStyles.ts'
import {decorCatalogue,catalogueLabel} from './catalogue.mjs'

export const VIDEO_SECONDS=72
export const montageSweep=(index,count,degrees,origin=0)=>({from:origin+index*degrees/count,to:origin+(index+1)*degrees/count})
export const decorShots=decorCatalogue
export const decorPairs=Array.from({length:decorCatalogue.length/2},(_,i)=>decorCatalogue.slice(i*2,i*2+2))

export const shots = [
  { id: '01-reveal', station: 'tanwei', seconds: 2.4, kind: 'hero', section: 'overview', copy: 'hero', view: 'exterior', orbit: -.06 },
  { id: '02-underground', station: 'zoo', seconds: 3.2, kind: 'scenic', section: 'overview', copy: '02', view: 'exploded', orbit: .06 },
  { id: '03-interchange', station: 'tanwei', seconds: 3.2, kind: 'scenic', section: 'overview', copy: '13', view: 'exploded', orbit: -.06 },
  { id: '04-boarding', station: 'zoo', seconds: 4, kind: 'train', section: 'trains', copy: '12', view: 'platform', orbit: .035 },
  { id: '05-rolling', station: 'tanwei', seconds: 3, kind: 'train', section: 'trains', copy: '11', view: 'platform', orbit: -.04 },
  { id: '05-tianhe-flythrough', station: 'tianhe', seconds: 8.1, kind: 'train', section: 'trains', copy: '12', view: 'flythrough', simSpeed: 4 },
  { id: '08-section-tianhe', station: 'tianhe', seconds: 6, kind: 'section', section: 'building', copy: '09', view: 'section' },
  { id: '08-cube',station:'zoo',seconds:4.8,kind:'cube',section:'building',copy:'09',view:'cube',orbit:0 },
  { id: '09-demand', station: 'tanwei', seconds: 3, kind: 'demand', section: 'simulation', copy: '06', view: 'demand', orbit: 0 },
  { id:'montage-placement',station:'empty',stage:'placement',seconds:23.5,playbackRate:8,kind:'placement',section:'building',copy:'04',view:'showcase',orbit:0 },
  ...CITY_STYLE_IDS.map((city,i) => ({ id: `city-${city}`, station: 'empty', stage:'city',seconds: .4, kind: 'city', section: 'overview', copy: '01', city, view: 'entrance', spin:montageSweep(i,8,180,-90) })),
  ...['A', 'B', 'C', 'D', 'L'].map((stock,i) => ({ id: `stock-${stock}`, station: 'empty',stage:'bridge', seconds: .8, kind: 'stock', section: 'trains', copy: '11', stock,lineNumber:String(i+1),colour:GUANGZHOU_LINE_COLOURS[String(i+1)], view: 'bridge', spin:montageSweep(i,5,150,15) })),
  { id: '10-play', station: 'tanwei', seconds: 3.6, kind: 'cta', section: 'simulation', copy: 'footer', view: 'exterior', orbit: .22,zoomEnd:1.45 },
]

export function timeline(language = 'zh') {
  if (!['en', 'zh'].includes(language)) throw new Error('Language must be en or zh')
  let start = 0
  return shots.map(shot => {
    const t = ui[language], group = gallery[language].sections.find(s => s.id === shot.section)
    const art = gallery[language].artworks.find(a => a.id === shot.copy)
    let title = art?.title ?? ({ hero: t.hero.line1, footer: t.footer.buildTitle }[shot.copy])
    if (shot.city) title = tForLanguage(language === 'en' ? 'en' : 'zh-CN', `city_${shot.city}`)
    if (shot.stock) title = tForLanguage(language === 'en' ? 'en' : 'zh-CN', 'type_value', shot.stock)
    const panels=shot.panels?.map(p=>({...p,title:catalogueLabel(p,language)}))
    if (panels) title=panels.map(p=>p.title).join(' × ')
    if (!['city','stock','decor'].includes(shot.kind)) title = t.video.headlines[shot.id] ?? title
    const result = { ...shot,panels, start, end: Math.round((start + shot.seconds)*30)/30, title,
      label: group.label, stationName: shot.city?t.demos.zoo.name:t.demos[shot.station]?.name??t.video.stages[shot.stage??'empty'],
      subtitle: shot.kind === 'hero' ? t.hero.line2 : shot.kind === 'cta' ? 'stationdesigner.com' : t.demos[shot.station]?.line??t.video.stages[shot.stage??'empty'],
      playbackRate:shot.playbackRate??1,captureSeconds:shot.seconds*(shot.playbackRate??1) }
    if(['city','stock','decor'].includes(shot.kind)){const group=shots.filter(s=>s.kind===shot.kind);result.montageIndex=group.findIndex(s=>s.id===shot.id)+1;result.montageCount=group.length}
    start = result.end
    return result
  })
}

export function validatePlan(plan) {
  if (plan.at(-1)?.end !== VIDEO_SECONDS) throw new Error(`The demo must be exactly ${VIDEO_SECONDS} seconds`)
  if (new Set(plan.map(s => s.id)).size !== plan.length) throw new Error('Duplicate scene ID')
  if (!['zoo','tanwei','tianhe'].every(id=>plan.some(s=>s.station===id))) throw new Error('All three demo stations are required')
  const sectionsShots=plan.filter(shot=>shot.kind==='section')
  if (sectionsShots.length!==1||sectionsShots[0].station!=='tianhe') throw new Error('The section shot must feature Tianhe Park')
  const sections = [...new Set(plan.map(s => s.section))]
  if (sections.join(',') !== gallery.en.sections.map(s => s.id).join(',')) throw new Error('Scene order drifted from the website')
  for (const shot of plan) if (!shot.title || !shot.label || shot.seconds <= 0) throw new Error(`Invalid scene ${shot.id}`)
  for(const shot of plan.filter(s=>['city','stock'].includes(s.kind)))if(shot.seconds!==(shot.kind==='stock'?.8:.4))throw new Error(`Incorrect montage timing: ${shot.id}`)
  const closing=plan.slice(plan.findIndex(s=>s.kind==='placement'),-1)
  if(closing.some(s=>!['placement','city','stock'].includes(s.kind)))throw Error('All montages must be grouped immediately before the finale')
  for(const kind of ['city','stock','decor']){const group=plan.filter(s=>s.kind===kind);for(let i=1;i<group.length;i++)if(group[i-1].spin.to!==group[i].spin.from)throw Error(`Camera angle resets in ${kind}`)}
  for(const shot of plan)if(Math.abs(shot.seconds*30-Math.round(shot.seconds*30))>1e-8)throw new Error(`Scene is not frame-aligned: ${shot.id}`)
}

export function storyboard(plan,language='zh') {
  const copy=ui[language].video.storyboard
  return `# ${copy.title}\n\n${copy.intro}\n\n| ${copy.columns.join(' | ')} |\n|---|---|---|---|\n`+
    plan.map(s=>`| ${s.start}–${s.end} ${copy.unit} | ${s.stationName} · ${copy.views[s.view]} | ${s.title} | ${copy.kinds[s.kind]} |`).join('\n')+
    `\n\n${copy.audio}\n\n${copy.capture}\n`
}
