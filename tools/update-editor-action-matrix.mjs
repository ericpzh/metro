// Maintain a per-action latest-measurement index and its human-readable matrix.
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const references=resolve('.agents/skills/metro-repo/references')
const indexPath=resolve(references,'editor-action-matrix.jsonl')
const matrixPath=resolve(references,'editor-action-matrix.md')
const keyOf=(row)=>JSON.stringify([row.demo,row.case,row.action])
const compact=(row)=>({status:row.status,iteration:row.iteration,cpuMs:row.cpuMs??null,
  firstRenderMs:row.firstRenderMs??null,...(row.error?{error:row.error}:{})})
const escape=(s)=>String(s).replaceAll('|','\\|').replace(/[\r\n]+/g,' ')
const number=(n)=>Number.isFinite(n)?n.toFixed(2):'—'

function readIndex() {
  const [head,...old]=readFileSync(indexPath,'utf8').trim().split(/\r?\n/).map(JSON.parse)
  if(head._meta?.schema===1&&Array.isArray(head._meta.captures))
    return {captures:head._meta.captures,rows:new Map(old.map(row=>[keyOf(row),row]))}
  if(!head._meta?.fullMatrix)throw Error('Matrix bootstrap requires a complete baseline')
  const capture={id:'baseline',generatedAt:'2026-10-26T15:47:14.925Z',sourceHash:head._meta.sourceHash,
    buildHash:head._meta.buildHash,scriptHash:head._meta.scriptHash,samples:head._meta.samplesPerCase,
    label:'Original full inventory',report:'.preview/perf/target-100-full-final/report.json',
    environments:head._meta.demos.map(({demo,environment})=>({demo,...environment}))}
  const rows=new Map()
  for(const r of old){
    const k=keyOf(r),existing=rows.get(k)
    if(existing)existing.measurements.push(compact(r))
    else rows.set(k,{demo:r.demo,case:r.case,action:r.action,category:r.spec?.category??'unknown',fixture:r.fixture??null,capture:'baseline',measurements:[compact(r)]})
  }
  return {captures:[capture],rows}
}

function render(captures,rows) {
  const used=new Set(rows.map(row=>row.capture)),active=captures.filter(c=>used.has(c.id))
    .sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt))
  const labels=new Map(active.map((capture,i)=>[capture.id,`R${i+1}`]))
  const timed=[],other=[]
  for(const row of rows){
    const times=row.measurements.map(m=>m.firstRenderMs).filter(Number.isFinite)
    if(times.length===row.measurements.length&&row.measurements.every(m=>m.status==='pass'||m.status==='over-budget')){
      const cpus=row.measurements.map(m=>m.cpuMs).filter(Number.isFinite)
      const max=Math.round(Math.max(...times)*100)/100
      timed.push({...row,max,cpu:cpus.length?Math.max(...cpus):null})
    }else other.push(row)
  }
  timed.sort((a,b)=>b.max-a.max||keyOf(a).localeCompare(keyOf(b)))
  other.sort((a,b)=>keyOf(a).localeCompare(keyOf(b)))
  const above=timed.filter(r=>r.max>100),within=timed.filter(r=>r.max<=100)
  const captureById=new Map(active.map(c=>[c.id,c]))
  const observed=r=>r.observedAt??captureById.get(r.capture).generatedAt
  const header='| Demo | Case | Action | Max first render | Max CPU | Samples | Capture | Observed (UTC) |\n| --- | --- | --- | ---: | ---: | ---: | --- | --- |'
  const rowText=r=>`| ${escape(r.demo)} | ${escape(r.case)} | ${escape(r.action)} | ${number(r.max)} ms | ${number(r.cpu)} ms | ${r.measurements.length} | ${labels.get(r.capture)} | ${escape(observed(r))} |`
  const lines=['# Editor action matrix: latest measurements','',
    'Each row is the latest completed capture for that demo, case and action. Times are the maximum across its samples, rounded to 0.01 ms and sorted by first-render time. Groups use the displayed precision. A focused capture replaces only the actions it actually measured; capture labels show which rows came from different runs. Older reports without per-case timestamps show the run start time. The 100 ms budget is strictly less than 100 ms, so a value exactly equal to 100 ms is in the ≤100 ms group but does not pass the budget.','',
    `Latest index: **${rows.length} actions**, ${above.length} above 100 ms, ${within.length} at or below 100 ms, and ${other.length} without a complete timing. API-to-first-render measurements do not include pointer dispatch, compositor presentation or GPU completion. See [performance.md](performance.md) for methodology and historical analysis.`, '',
    '## Captures','', '| Capture | Generated (UTC) | Scope | Samples per case | Source SHA-256 | Build SHA-256 | Raw report |','| --- | --- | --- | ---: | --- | --- | --- |',
    ...active.map(c=>`| ${labels.get(c.id)} | ${escape(c.generatedAt)} | ${escape(c.label)} | ${c.samples} | \`${c.sourceHash}\` | \`${c.buildHash}\` | ${escape(c.report)} |`),'',
    'The machine-readable [latest index](editor-action-matrix.jsonl) includes individual samples, statuses, capture metadata, fixture and environment details. Earlier full inventories remain available in benchmark reports and repository history.','',
    `## Above 100 ms (${above.length})`,'',header,...above.map(rowText),'',
    `## At or below 100 ms (${within.length})`,'',header,...within.map(rowText),'',
    `## Unsupported or incomplete (${other.length})`,'',
    '| Demo | Case | Action | Status | Capture | Observed (UTC) |','| --- | --- | --- | --- | --- | --- |',
    ...other.map(r=>`| ${escape(r.demo)} | ${escape(r.case)} | ${escape(r.action)} | ${escape([...new Set(r.measurements.map(m=>m.error?`${m.status}: ${m.error}`:m.status))].join('; '))} | ${labels.get(r.capture)} | ${escape(observed(r))} |`),'']
  return lines.join('\n')
}

export function updateEditorActionMatrix(report,reportPath) {
  if(report.schema!==2||!report.complete||report.profiled||report.driver!=='production-api-to-render'||report.fatalError)
    throw Error('Only a complete, unprofiled production action report can update the matrix')
  if(!report.generatedAt||!report.sourceHash||!report.buildHash||!report.reports?.length)throw Error('Missing report attribution')
  if(report.reports.some(r=>typeof r.environment?.gpu!=='string'||/swiftshader|llvmpipe|software rasterizer/i.test(r.environment.gpu)))
    throw Error('The latest matrix requires a hardware-rendered capture')
  const state=readIndex(),id=`${report.generatedAt}|${report.sourceHash}|${report.buildHash}|${report.scriptHash}`
  const label=report.scope.fullMatrix?'Full inventory':`Focused: ${(report.scope.caseFilter??[]).join(', ')||report.scope.demos.join(', ')}`
  const capture={id,generatedAt:report.generatedAt,sourceHash:report.sourceHash,buildHash:report.buildHash,scriptHash:report.scriptHash,
    updaterHash:report.matrixUpdaterHash,samples:report.samples,label,report:reportPath,scope:report.scope,host:report.host,
    environments:report.reports.map(({demo,demoHash,fixture,origin,environment})=>({demo,demoHash,fixture,origin,...environment}))}
  const grouped=new Map()
  for(const demo of report.reports){
    if(demo.cases.length!==demo.expectedCases)throw Error(`Incomplete cases for ${demo.demo}`)
    for(const c of demo.cases){
      const observedAt=c.capturedAt??report.generatedAt
      if(!Number.isFinite(Date.parse(observedAt)))throw Error(`Invalid observation time for ${demo.demo}/${c.id}`)
      if(report.scope.fullMatrix){
        const actions=new Set(c.rows.map(row=>row.action))
        if(['preview','place','pickup','move-preview','drop','delete'].some(action=>!actions.has(action)))
          throw Error(`Incomplete actions for ${demo.demo}/${c.id}`)
      }
      for(const sample of c.rows){
        const row={demo:demo.demo,case:c.id,action:sample.action,category:c.spec?.category??demo.manifest?.find(s=>s.id===c.id)?.category??'unknown',fixture:c.fixture??null,capture:id,observedAt,measurements:[]}
        const k=keyOf(row),group=grouped.get(k)??row
        group.measurements.push(compact(sample));grouped.set(k,group)
      }
    }
  }
  if(!grouped.size)throw Error('Empty report')
  // A complete newer inventory supersedes cases that left the manifest. A
  // later focused measurement survives even when an older full run is imported.
  if(report.scope.fullMatrix)for(const [key,row]of state.rows){
    const old=state.captures.find(c=>c.id===row.capture)
    if(report.scope.demos.includes(row.demo)&&!grouped.has(key)&&(!old||(row.observedAt??old.generatedAt)<=capture.generatedAt))state.rows.delete(key)
  }
  for(const [key,row]of grouped){
    if(row.measurements.length!==report.samples)throw Error(`Incomplete samples for ${key}`)
    const previous=state.rows.get(key),old=state.captures.find(c=>c.id===previous?.capture)
    if(!old||(previous.observedAt??old.generatedAt)<=row.observedAt)state.rows.set(key,row)
  }
  state.captures=state.captures.filter(c=>c.id!==id).concat(capture)
  const rows=[...state.rows.values()].sort((a,b)=>keyOf(a).localeCompare(keyOf(b)))
  const active=new Set(rows.map(row=>row.capture));state.captures=state.captures.filter(c=>active.has(c.id))
  const index=[JSON.stringify({_meta:{schema:1,captures:state.captures}}),...rows.map(row=>JSON.stringify(row))].join('\n')+'\n'
  const markdown=render(state.captures,rows)
  // Both outputs are fully generated before either is replaced.
  writeFileSync(indexPath+'.tmp',index);writeFileSync(matrixPath+'.tmp',markdown)
  renameSync(indexPath+'.tmp',indexPath);renameSync(matrixPath+'.tmp',matrixPath)
  return {actions:rows.length,captures:state.captures.length}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw Error('Usage: node tools/update-editor-action-matrix.mjs <report.json>')
  const path=resolve(process.argv[2]),report=JSON.parse(readFileSync(path,'utf8'))
  console.log(updateEditorActionMatrix(report,relative(process.cwd(),path).replaceAll('\\','/')))
}
