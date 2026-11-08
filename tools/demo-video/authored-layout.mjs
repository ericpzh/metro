// User-owned save is the source of geometry, placement, materials and signs.
// Replay ordering never edits or regenerates the author's final layout.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parse} from '../../game/src/persistence/save.ts'
import {checkModulePlacements} from '../../game/src/build/validation.ts'
import {paletteIdForModule} from '../../game/src/app/tools/PickTool.ts'
import {MODULE_OPTIONS,moduleLabel,supportsLinePlacement} from '../../game/src/app/store/catalog.ts'
import {lineRunRotation,lineSpan} from '../../game/src/app/tools/geometry/linePlacement.ts'
import {getLanguage,setLanguage,translate} from '../../game/src/sim/i18n.ts'

export const authoredPath=resolve('video/demo-station.metro.json')
const loaded=parse(readFileSync(authoredPath,'utf8'))
if(!loaded.ok||loaded.droppedCells||loaded.droppedModules)throw Error('Authored demo save must load without repairs')
export const authoredState=loaded.state
export const authoredCamera=JSON.parse(readFileSync(resolve('video/demo-camera.json'),'utf8'))
export const emptyAuthoredState=()=>({...structuredClone(authoredState),cells:[],modules:[]})
export const isFrameModule=m=>['sidewalk','lawn','road','glass','exit'].includes(m.type)
export function modulePalette(m){return paletteIdForModule(m)??m.type}
const east=m=>m.x
const moduleOrder=(a,b)=>east(b)-east(a)||a.y-b.y||a.z-b.z||a.id.localeCompare(b.id)

// Group only truly consecutive tiles with the same authored configuration.
// The result retains every original id, orientation, variant and endpoint.
function linearGroups(modules){
 const grouped=[],buckets=new Map()
 for(const m of modules){const alongY=(m.rot??0)%2===1,key=JSON.stringify([m.type,m.z,m.rot,m.cfg,alongY?m.x:m.y]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(m)}
 for(const list of buckets.values()){
  const first=list[0],alongY=(first.rot??0)%2===1,axis=alongY?'y':'x';list.sort((a,b)=>a[axis]-b[axis]);let run=[]
  const tile=['fence','tactile'].includes(first.type),pitch=tile?1:lineSpan([first],alongY?1:0)
  const turns=!tile&&lineRunRotation(first.rot??0,alongY?1:0,lineSpan([first],0),lineSpan([first],1))!==(first.rot??0)
  for(const m of list){if(run.length&&(turns||m[axis]!==run.at(-1)[axis]+pitch)){grouped.push(run);run=[]}run.push(m)}
  if(run.length)grouped.push(run)
 }
 return grouped.map(modules=>({kind:modules.length>1?'drag':'place',modules,east:Math.max(...modules.map(east))}))
}
function tileRectangles(modules){
 const have=new Map(modules.map(m=>[`${m.x},${m.y},${m.z}`,m])),runs=[]
 while(have.size){
  const first=[...have.values()].sort(moduleOrder)[0],z=first.z;let x0=first.x,x1=first.x,y0=first.y,y1=first.y
  while(have.has(`${x0-1},${y0},${z}`))x0--
  while(Array.from({length:x1-x0+1},(_,i)=>have.has(`${x0+i},${y1+1},${z}`)).every(Boolean))y1++
  const parts=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=`${x},${y},${z}`;parts.push(have.get(key));have.delete(key)}
  runs.push({kind:'rectangle',modules:parts,east:x1})
 }
 return runs
}
export function authoredFrameSteps(){
 const base=authoredState.levelBase, top=base+authoredState.storeyHeight
 const cells=[
  {kind:'floor',cells:authoredState.cells.filter(c=>c.z<=base)},
  {kind:'wall',cells:authoredState.cells.filter(c=>c.z>base&&c.z<top)},
  {kind:'deck',cells:authoredState.cells.filter(c=>c.z>=top)},
 ]
 const structure=authoredState.modules.filter(m=>isFrameModule(m)&&!['sidewalk','lawn'].includes(m.type)).sort(moduleOrder).map(m=>({kind:'place',modules:[m],east:m.x}))
 const overrides=authoredState.modules.filter(m=>m.type==='lawn').sort(moduleOrder)
 const temporary=overrides.map(m=>({...m,id:`video-paving-${m.id}`,type:'sidewalk',cfg:{}}))
 const paving=tileRectangles([...authoredState.modules.filter(m=>m.type==='sidewalk'),...temporary])
 return [...cells,...structure,...paving,...overrides.map((m,i)=>({kind:'surface-override',modules:[m],replaces:temporary[i].id}))]
}

export function authoredWallRuns(walls) {
 if(!walls.length)return []
 const columns=new Map(), z=authoredState.levelBase+1, height=authoredState.storeyHeight-1
 for(const c of walls){
  const key=`${c.x},${c.y}`
  columns.set(key,(columns.get(key)??0)+1)
 }
 const points=walls.map(c=>[c.x,c.y])
 const [west,east]=[Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[0]))]
 const [south,north]=[Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[1]))]
 const line=(first,last,make)=>Array.from({length:last-first+1},(_,i)=>make(first+i))
 const sides=[line(south,north,y=>[west,y]),line(west+1,east-1,x=>[x,north]),
  line(south,north,y=>[east,y]),line(west+1,east-1,x=>[x,south])]
 const occupied=sides.filter(run=>run.filter(p=>columns.has(p.join(','))).length>run.length/2)
 const build=occupied.map(run=>({kind:'wall-drag',columns:run.map(p=>[...p,z])}))
 const carve=[]
 for(const side of occupied){
  let opening=[]
  for(const p of side){
   if(columns.get(p.join(','))!==height)opening.push([...p,z])
   else if(opening.length){carve.push({kind:'wall-carve',columns:opening});opening=[]}
  }
  if(opening.length)carve.push({kind:'wall-carve',columns:opening})
 }
 return [...build,...carve]
}

export function authoredDragSeconds(step) {
 const first=step.modules[0],last=step.modules.at(-1)
 const blocks=1+Math.max(Math.abs(last.x-first.x),Math.abs(last.y-first.y))
 return .32*blocks/3
}
export function authoredEquipmentSteps(){
 const all=authoredState.modules.filter(m=>!isFrameModule(m)),claimed=new Set(),steps=[]
 for(const m of all.filter(m=>m.type==='booth')){
  const children=all.filter(n=>n.id!==m.id&&((n.cfg?.auto&&n.x>=m.x&&n.x<m.x+m.w&&n.y>=m.y&&n.y<m.y+m.h)||n.cfg?.boothId===m.id))
  const modules=[m,...children];modules.forEach(n=>claimed.add(n.id));steps.push({kind:'place',modules,east:Math.max(...modules.map(east))})
 }
 const groupedTypes=['tactile','gate','fence']
 const rows=linearGroups(all.filter(m=>!claimed.has(m.id)&&(groupedTypes.includes(m.type)||supportsLinePlacement(modulePalette(m)))))
 for(const row of rows){
  const type=row.modules[0].type
  row.batch=type==='fence'&&row.modules[0].cfg?.variant==='iron'?'roadside-fence':groupedTypes.includes(type)?type:undefined
  row.modules.forEach(m=>claimed.add(m.id))
  steps.push(row)
 }
 for(const m of all){if(claimed.has(m.id))continue;claimed.add(m.id);steps.push({kind:'place',modules:[m],east:m.x})}
 // Leave the ticket machines exposed for their drag before closing the concourse with glass.
 const groupRank={'roadside-fence':0,tactile:1,gate:2,fence:5}
 const rank=step=>{
  if(step.batch)return groupRank[step.batch]
  if(step.modules[0].type==='tvm')return 4
  return step.east>=21?3:6
 }
 const westFence=s=>s.batch==='fence'&&s.east<5
 steps.sort((a,b)=>rank(a)-rank(b)||Number(westFence(b))-Number(westFence(a))||b.east-a.east||a.modules[0].y-b.modules[0].y||a.modules[0].z-b.modules[0].z)
 // Keep the real lift extension demonstration in its east-to-west position.
 return steps.flatMap(step=>{
  const m=step.modules[0]
  if(m.type!=='lift'||m.cfg.rises?.length!==2)return[step]
  const lower={...m,to:{...m.to,z:m.from.z+m.cfg.rises[0]},cfg:{...m.cfg,rises:[m.cfg.rises[0]]}}
  return[{...step,modules:[lower]},{kind:'extend',modules:[m],east:step.east}]
 })
}
export const authoredSteps=authoredEquipmentSteps()
export function authoredSchedule(captureSeconds) {
 const weight=s=>s.batch ? .58 : s.kind==='extend' ? 2.5 : s.kind==='drag' ? 1.5 : 1
 let when=authoredCamera.frameSeconds
 const unit=(captureSeconds-when-authoredCamera.endingHoldSeconds)/authoredSteps.reduce((n,s)=>n+weight(s),0)
 return authoredSteps.map(step=>{
  const duration=unit*weight(step), slot={step,when,duration}
  when+=duration
  return slot
 })
}
export function authoredLabel(step,language){
 const m=step.modules[0],previous=getLanguage()
 try{setLanguage(language==='en'?'en':'zh-CN');const id=modulePalette(m),option=MODULE_OPTIONS.find(o=>o.id===id),family=translate(moduleLabel(m)),detail=option?translate(option.label):family;return family===detail||detail.includes(family)?detail:`${family} · ${detail}`}finally{setLanguage(previous)}
}
export function validateAuthoredReplay(){
 let state={...structuredClone(authoredState),modules:authoredState.modules.filter(isFrameModule)},validated=0
 for(const step of authoredSteps){
  if(step.kind==='extend'){state={...state,modules:state.modules.map(m=>m.id===step.modules[0].id?step.modules[0]:m)};continue}
  for(const m of step.modules){
   const check=checkModulePlacements(state,[{id:m.id,module:m}])
   if(check.refused.size)throw Error(`Authored placement ${m.id}: ${[...check.refused.values()]}`)
   state={...state,modules:[...state.modules,m]};validated++
  }
 }
 const expected=new Map(authoredState.modules.map(m=>[m.id,m]))
 if(state.modules.length!==expected.size||state.modules.some(m=>JSON.stringify(m)!==JSON.stringify(expected.get(m.id))))throw Error('Authored replay differs from supplied save')
 return{state,steps:authoredSteps,validated}
}
