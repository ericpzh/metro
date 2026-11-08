// Authored recording stages are ordinary game documents, never demo edits.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {emptyStation} from '../../game/src/data/reference-station.ts'
import {createModule} from '../../game/src/build/model.ts'
import {ui} from '../../web/src/i18n.js'
import {structuralBase,colouredBase} from './interior.mjs'

const zoo=JSON.parse(readFileSync(resolve('game/src/data/demo-station.json'),'utf8'))
const tanwei=JSON.parse(readFileSync(resolve('game/src/data/tanwei-station.json'),'utf8'))
const source=[...zoo.modules,...tanwei.modules]
const point=(p,dx,dy,dz)=>p?{...p,x:p.x+dx,y:p.y+dy,z:p.z+dz}:p
function moved(original,x=0,y=0,z=0,id='video-focus'){
 const m=structuredClone(original),dx=x-m.x,dy=y-m.y,dz=z-m.z
 m.id=id;m.x=x;m.y=y;m.z=z
 if(m.from)m.from=point(m.from,dx,dy,dz)
 if(m.to)m.to=point(m.to,dx,dy,dz)
 if(m.cfg.flights)m.cfg.flights=m.cfg.flights.map(f=>({...f,from:point(f.from,dx,dy,dz),to:point(f.to,dx,dy,dz)}))
 return m
}
export function stageDocument(shot,name,brand){
 const doc=emptyStation(name)
 if(shot.stage==='colours')return structuralBase(name)
 if(shot.stage==='placement')return doc
 if(shot.stage==='city'){
  doc.name=ui.zh.demos.zoo.name;doc.nameEn=ui.en.demos.zoo.name
  doc.modules=[{id:'video-focus',type:'exit',x:0,y:0,z:0,rot:0,cfg:{name:'A口',covered:true,bays:2,inRate:0,open:false}},
   {id:'video-guide',type:'guidepost',x:4,y:3,z:0,rot:0,cfg:{exitId:'video-focus'}}]
  // The head-house is built around the runs under it: two down escalators,
  // one per bay, descend through the opened wellway toward the mouth. Their
  // lower landings are below the plaza, so only the top of each run reads
  // through the glass — the entrance looks inhabited rather than an empty box.
  for(const [i,column] of [0,1].entries())doc.modules.push({
   id:`video-escalator-${i}`,type:'escalator',storeyHeight:5,x:column,y:-9,z:-5,rot:0,
   from:{x:column,y:0,z:0},to:{x:column,y:-9,z:-5},cfg:{incline:30,dir:'down'}
  })
  doc.cityStyle=shot.city
 }else if(shot.stage==='bridge'){
  const power=['D','L'].includes(shot.stock)?'catenary':'third-rail'
  const line={...structuredClone(zoo.lines[0]),id:shot.lineNumber,name,stock:shot.stock,cars:shot.stock==='D'?8:6,power,colour:shot.colour,alightPerTrain:0,travelSign:1,headwayProfile:{peak:90,offpeak:90,late:90}}
  doc.lines=[line]
  doc.modules=[{id:'video-bridge',type:'track',x:-600,y:-1,z:15,rot:0,w:1200,d:3,cfg:{line:shot.lineNumber,dir:'up',power,bridge:true,bridgeRailing:'railing',catenaryStyle:'gantry'}}]
 }else if(shot.stage==='equipment'){
  if(shot.panels)return stageDocument({...shot,...shot.panels[0],panels:undefined},name,brand)
  if(shot.catalogueId){
   const mid=(shot.spin.from+shot.spin.to)/2*Math.PI/180
   const ramp=shot.catalogueId.startsWith('stair')||shot.catalogueId==='escalator'
   const rotation=ramp&&Math.abs(Math.cos(mid))>Math.abs(Math.sin(mid))?1:0
   const m=createModule(shot.catalogueId,0,0,0,'video-focus',rotation)
   if(!m)throw Error(`Unsupported catalogue fixture: ${shot.catalogueId}`)
   if(['shelf','urinal','sink','cubicle','cctv','vending','tvm','checkout','ac-unit','electrical-cabinet','extinguisher'].includes(m.type))m.rot=((Math.round((180-(shot.spin.from+shot.spin.to)/2)/90)%4)+4)%4
   if(m.type==='urinal')m.rot=(m.rot+2)%4
   if(m.type==='tree')m.rot=0
   if(m.type==='walkway'){m.to={x:12,y:0,z:0};m.cfg.width=2}
   if(m.type==='roof'){m.w=4;m.d=4}
   if(m.type==='exit')m.cfg={...m.cfg,name:'A口',inRate:0,open:false}
   doc.modules=[m];return doc
  }
  const template=shot.focusType==='walkway'?{type:'walkway',x:0,y:0,z:0,rot:0,from:{x:0,y:0,z:0},to:{x:12,y:0,z:0},cfg:{dir:'up',width:2}}:shot.focusType==='fence'?{type:'fence',x:0,y:0,z:0,w:6,rot:0,cfg:{variant:'glass'}}:source.find(m=>m.id===shot.focusId)
  if(!template)throw Error(`Showcase fixture missing: ${shot.focusId}`)
  const m=moved(template)
  if(m.type==='escalator'){m.rot=0;m.from={x:0,y:0,z:0};m.to={x:0,y:9,z:5}}
  if(!['stair','escalator','lift'].includes(m.type))m.rot=0
  if(['vending','tvm','shelf','checkout','ac-unit','booth'].includes(m.type))m.rot=2
  if(m.type==='exit')m.cfg={...m.cfg,name:'A口',covered:true,open:false,inRate:0}
  if(m.type==='lift'){m.to.z=10;m.cfg.rises=[5,5]}
  if(m.type==='roof')m.z=5
  if(m.type==='linemap')m.cfg.mount='stand'
  if(m.type==='billboard')m.cfg.variant='large'
  if(m.type==='calligraphy'){doc.name=brand;delete m.ceilingAnchored}
  doc.modules=[m]
  if(m.type==='calligraphy')for(let x=-1;x<(m.w??6)+1;x++)for(let z=0;z<5;z++)doc.cells.push({x,y:-1,z,fill:'solid'})
  if(m.type==='calligraphy'){
   // Turn the mounted inscription and its backing together toward the late arc.
   m.x=0;m.y=-1;m.rot=3
   doc.cells=doc.cells.map(c=>({...c,x:c.y,y:-c.x-1}))
  }
  if(['gate','tvm','vending','bench','shelf'].includes(m.type)){
   const copies=m.type==='gate'?4:2,step=m.type==='bench'?3:1.6
   for(let i=1;i<copies;i++)doc.modules.push(moved(m,i*step,0,0,`video-focus-${i}`))
  }
  if(m.type==='guidepost')doc.modules.push({id:m.cfg.exitId,type:'exit',x:40,y:40,z:0,rot:0,cfg:{name:'A口',covered:true,bays:2,inRate:0,open:false}})
  if(m.type==='sign')doc.lines=structuredClone(zoo.lines)
 }
 return doc
}
