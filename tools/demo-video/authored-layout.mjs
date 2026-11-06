// User-owned save is the source of geometry, placement, materials and signs.
// Replay ordering never edits or regenerates the author's final layout.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parse} from '../../game/src/persistence/save.ts'
import {checkModulePlacements} from '../../game/src/build/validation.ts'
import {paletteIdForModule} from '../../game/src/app/tools/PickTool.ts'
import {MODULE_OPTIONS,moduleLabel} from '../../game/src/app/store/catalog.ts'
import {getLanguage,setLanguage,translate} from '../../game/src/sim/i18n.ts'

export const authoredPath=resolve('video/demo-station.metro.json')
const loaded=parse(readFileSync(authoredPath,'utf8'))
if(!loaded.ok||loaded.droppedCells||loaded.droppedModules)throw Error('Authored demo save must load without repairs')
export const authoredState=loaded.state
export const authoredCamera=JSON.parse(readFileSync(resolve('video/demo-camera.json'),'utf8'))
export const emptyAuthoredState=()=>({...structuredClone(authoredState),cells:[],modules:[]})
export const isFrameModule=m=>['sidewalk','road','glass','exit'].includes(m.type)||(m.type==='fence'&&m.z>1)
export function modulePalette(m){return paletteIdForModule(m)??m.type}
const east=m=>m.x
const moduleOrder=(a,b)=>east(b)-east(a)||a.y-b.y||a.z-b.z||a.id.localeCompare(b.id)

// Group only truly consecutive tiles with the same authored configuration.
// The result retains every original id, orientation, variant and endpoint.
function linearGroups(modules){
 const grouped=[],buckets=new Map()
 for(const m of modules){const alongY=(m.rot??0)%2===1,key=JSON.stringify([m.type,m.z,m.rot,m.cfg,alongY?m.x:m.y]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(m)}
 for(const list of buckets.values()){
  const y=(list[0].rot??0)%2===1,axis=y?'y':'x';list.sort((a,b)=>a[axis]-b[axis]);let run=[]
  for(const m of list){if(run.length&&m[axis]!==run.at(-1)[axis]+1){grouped.push(run);run=[]}run.push(m)}
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
 const buckets=new Map()
 for(const c of authoredState.cells){const key=`${c.z}/${Math.floor(c.x/4)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(c)}
 const cells=[...buckets.values()].sort((a,b)=>a[0].z-b[0].z||Math.max(...b.map(c=>c.x))-Math.max(...a.map(c=>c.x))).map(cells=>({kind:'cells',cells}))
 const structure=authoredState.modules.filter(m=>isFrameModule(m)&&!['sidewalk','fence'].includes(m.type)).sort(moduleOrder).map(m=>({kind:'place',modules:[m],east:m.x}))
 const paving=tileRectangles(authoredState.modules.filter(m=>m.type==='sidewalk'))
 const railings=linearGroups(authoredState.modules.filter(m=>m.type==='fence'&&m.z>1))
 return [...cells,...structure,...paving,...railings.sort((a,b)=>b.east-a.east)]
}
export function authoredEquipmentSteps(){
 const all=authoredState.modules.filter(m=>!isFrameModule(m)),claimed=new Set(),steps=[]
 const runs=linearGroups(all.filter(m=>['fence','tactile'].includes(m.type)))
 for(const run of runs){run.modules.forEach(m=>claimed.add(m.id));steps.push(run)}
 for(const m of all.filter(m=>m.type==='booth')){
  const children=all.filter(n=>n.id!==m.id&&((n.cfg?.auto&&n.x>=m.x&&n.x<m.x+m.w&&n.y>=m.y&&n.y<m.y+m.h)||n.cfg?.boothId===m.id))
  const modules=[m,...children];modules.forEach(n=>claimed.add(n.id));steps.push({kind:'place',modules,east:Math.max(...modules.map(east))})
 }
 for(const m of all){if(claimed.has(m.id))continue;claimed.add(m.id);steps.push({kind:'place',modules:[m],east:m.x})}
 const rank=s=>s.modules[0].type==='tactile'?0:s.modules[0].type==='fence'?2:1
 steps.sort((a,b)=>b.east-a.east||rank(a)-rank(b)||a.modules[0].y-b.modules[0].y||a.modules[0].z-b.modules[0].z)
 // Keep the real lift extension demonstration in its east-to-west position.
 return steps.flatMap(step=>{
  const m=step.modules[0]
  if(m.type!=='lift'||m.cfg.rises?.length!==2)return[step]
  const lower={...m,to:{...m.to,z:m.from.z+m.cfg.rises[0]},cfg:{...m.cfg,rises:[m.cfg.rises[0]]}}
  return[{...step,modules:[lower]},{kind:'extend',modules:[m],east:step.east}]
 })
}
export const authoredSteps=authoredEquipmentSteps()
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
