// Per-model geometry inventory for the three published tables in
// `.agents/skills/metro-repo/references/performance.md`:
//   * equipment/decor — one model per palette option, built and batched exactly as
//     the renderer draws it (authored Low preferred, bounded-error fallback);
//   * trains — one consist per stock class, batched through the real train path;
//   * passengers — the baked crowd atlas's own per-variant records.
// Canvas stubs affect printed artwork only. The JSON and Markdown go to ignored
// `.preview/perf/`; update the performance reference after changing models or the
// detail policy.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as THREE from '../game/node_modules/three/build/three.module.js'
import { equipmentLowBudget } from './equipment-low-budgets.mjs'
import { createModelMaterials, buildModule, buildTrain, disposeObject, disposeModelMaterials } from '../game/src/render/models.ts'
import { createModule } from '../game/src/build/model.ts'
import { MODULE_OPTIONS } from '../game/src/app/store/catalog.ts'
import { geometryDetailReady } from '../game/src/render/geometryDetail.ts'
import { modelDetailGeometry } from '../game/src/render/modelDetail.ts'
import { batchStaticParts } from '../game/src/render/batchStaticModule.ts'
import { batchTrainDoors, batchTrainTransparent } from '../game/src/render/trainBatches.ts'
import { trainDetails, trainDrawnTriangles } from '../game/src/render/trainDetail.ts'
import { tvPairSlot } from '../game/src/sim/tvs.ts'
import { STOCK_CLASSES } from '../game/src/sim/stock.ts'
const canvas=()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:(o,k)=>o[k]??(k==='measureText'?((s)=>({width:String(s??'').length*8})):()=>undefined),set:(o,k,v)=>(o[k]=v,true)})})
globalThis.document={createElement:canvas}
await geometryDetailReady
const mats=createModelMaterials()
const LINE={id:'5',name:'5号线',colour:'#c8102e',stock:'B',cars:6,power:'third-rail',psd:'full',headwayProfile:{peak:150,offpeak:240,late:480},alightPerTrain:420,terminus:'through',direction:'up',upTerminus:'文冲',downTerminus:'滘口',travelSign:1,stations:[]}
const data={name:'动物园',seed:7654321,cells:[],modules:[],lines:[LINE]}
const ads={adFace:(slug,w,h)=>({material:new THREE.MeshBasicMaterial(),geometry:new THREE.PlaneGeometry(w,h),slug}),adWindow:(w,h)=>ads.adFace('a',w,h),load:async()=>{},dispose(){}}
const ctx={mats,ads,data,trackCells:new Set(),tvPlate:()=>new THREE.CanvasTexture(canvas()),signFace:()=>new THREE.MeshBasicMaterial(),finish:()=>mats.steel,preview:false,ownedMats:[]}
const tris=g=>(g.index?.count??g.getAttribute('position')?.count??0)/3
const table=(header,rows)=>['| '+header.join(' | ')+' |','|'+header.map((_,i)=>i===0?'---':'---:').join('|')+'|',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n')+'\n'
const output=(name)=>resolve(process.env.BENCH_OUTPUT?dirname(process.env.BENCH_OUTPUT):'.preview/perf',name)

/* --------------------------------------------------------------- equipment */
const results=[]
for(const option of MODULE_OPTIONS){
 const mod=createModule(option.id==='tv-double'?'tv':option.id,4,4,0,`bench-${option.id}`,0,undefined,'up','lane',[LINE])
 if(!mod){results.push({id:option.id,low:null,high:null,reason:'createModule returned null'});continue}
 const pair=option.id==='tv-double'?[mod,{...mod,id:mod.id+'-back',rot:2}]:[mod]
 data.modules=pair;ctx.data=data;ctx.tvPairSlot=id=>tvPairSlot(id,data.modules)
 let root
 try{root=pair.length===2?new THREE.Group().add(...pair.map(item=>buildModule(item,ctx))):buildModule(mod,ctx)}catch(error){results.push({id:option.id,low:null,high:null,reason:String(error)});continue}
 if(!root){results.push({id:option.id,low:0,high:0});continue}
 root.updateMatrixWorld(true)
 let high=0,low=0,parts=0
 root.traverseVisible(o=>{
  if(!o.isMesh||o.isBatchedMesh||o.isSkinnedMesh||Array.isArray(o.material))return
  const count=o.isInstancedMesh?o.count:1; const near=tris(o.geometry)*count;high+=near;parts++
  let reduced=null
  if(o.userData.staticInstances){reduced=o.userData.staticFarGeometry??o.userData.staticDetailGeometry??null}
  else reduced=modelDetailGeometry(o)
  low+=tris(reduced??o.geometry)*count
 })
 results.push({id:option.id,label:option.label,parts,low:Math.round(low),high:Math.round(high),type:mod.type})
 disposeObject(root)
}
if(results.some(result=>result.reason))throw new Error(JSON.stringify(results.filter(result=>result.reason)))
const missingLow=results.filter(result=>result.high>10 && !(result.low>0 && result.low<result.high))
if(missingLow.length)throw new Error(`Palette models over ten triangles require reduced Low geometry: ${JSON.stringify(missingLow)}`)
for(const row of results) {
 const budget=equipmentLowBudget(row.id,row.high)
 if(row.low>budget.limit)throw new Error(`${row.id}: ${row.low}/${row.high} triangles exceeds Low budget ${budget.limit}`)
 row.lowBudget=budget.limit;row.lowException=budget.reason
}
results.sort((a,b)=>b.high-a.high)
let out=output('model-triangles.json')
mkdirSync(dirname(out),{recursive:true})
writeFileSync(out,JSON.stringify({revision:THREE.REVISION,options:MODULE_OPTIONS.length,results},null,2))
writeFileSync(out.replace(/\.json$/,'.md'),table(['Equipment / decor model name','Low triangles','High triangles'],results.map(r=>[r.id,r.low,r.high])))
writeFileSync(output('equipment-lod-exceptions.md'),table(['Equipment / decor model name','Low / High','Minimum-shape exception'],results.filter(r=>r.low>=r.high*.1).map(r=>[r.id,`${r.low} / ${r.high}`,r.lowException])))
console.log(results.length+' palette models: '+out)

/* ------------------------------------------------------------------ trains */
const CAR_COUNTS={D:8,A:8,B:6,C:6,L:6}
const trains=[]
try{
 for(const stock of STOCK_CLASSES){
  for(const cars of [CAR_COUNTS[stock],CAR_COUNTS[stock]-2]){
   const group=buildTrain(mats,{x:0,y:0,z:0,cars,stock,doorsOpen:false,colour:'#c8102e',dirSign:1,yaw:0})
   try{
    // The renderer's own path: static batching, door banks, sorted glass, then
    // every prepared detail swap applied at once.
    batchStaticParts(group,new Set(group.userData.doors),true)
    batchTrainDoors(group)
    batchTrainTransparent(group)
    group.updateMatrixWorld(true)
    const details=trainDetails(group), high=trainDrawnTriangles(group)
    for(const detail of details)detail.apply(true)
    const low=trainDrawnTriangles(group)
    for(const detail of details)detail.apply(false)
    if(trainDrawnTriangles(group)!==high)throw new Error(`${stock}-${cars}: restoring full geometry changed the draw`)
    trains.push({model:`${stock}-${cars}`,stock,cars,low,high,swaps:details.length})
   } finally{disposeObject(group)}
  }
 }
} catch(error){disposeModelMaterials(mats);throw error}
trains.sort((a,b)=>b.high-a.high)
if(trains.some(row=>!(row.low>0 && row.low<=Math.floor(row.high*.1))))throw new Error('Train inventory exceeds the 10% Low budget')
out=output('train-triangles.json')
writeFileSync(out,JSON.stringify({revision:THREE.REVISION,results:trains},null,2))
writeFileSync(out.replace(/\.json$/,'.md'),table(['Train model','Low triangles','High triangles'],trains.map(r=>[r.model,r.low,r.high])))
console.log(trains.length+' consists: '+out)

/* -------------------------------------------------------------- passengers */
disposeModelMaterials(mats)
const human=JSON.parse(readFileSync(new URL('../game/src/assets/passenger-approved.json',import.meta.url),'utf8'))
if(human.lowTriangles===undefined)throw new Error('Passenger atlas has no baked Low topology; run npm run bake:passengers')
const passengers=human.library.map(model=>({model:model.id,low:model.lowTriangles,high:model.triangles}))
 .sort((a,b)=>b.high-a.high)
if(passengers.some(row=>row.high>10 && !(row.low>0 && row.low<row.high)))throw new Error('Passenger inventory contains a missing Low variant')
out=output('passenger-triangles.json')
writeFileSync(out,JSON.stringify({revision:THREE.REVISION,atlas:{vertices:human.vertices,corners:human.corners,lowCorners:human.lowCorners,triangles:human.triangles,lowTriangles:human.lowTriangles},results:passengers},null,2))
writeFileSync(out.replace(/\.json$/,'.md'),table(['Passenger model','Low triangles','High triangles'],passengers.map(r=>[r.model,r.low,r.high])))
console.log(passengers.length+' passenger variants: '+out)
