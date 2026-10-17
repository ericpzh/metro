// Per-model geometry inventory; canvas stubs affect printed artwork only.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as THREE from '../game/node_modules/three/build/three.module.js'
import { createModelMaterials, buildModule, disposeObject } from '../game/src/render/models.ts'
import { createModule } from '../game/src/build/model.ts'
import { MODULE_OPTIONS } from '../game/src/app/store/catalog.ts'
import { geometryDetailReady } from '../game/src/render/geometryDetail.ts'
import { modelDetailGeometry } from '../game/src/render/modelDetail.ts'
const canvas=()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:(o,k)=>o[k]??(k==='measureText'?((s)=>({width:String(s??'').length*8})):()=>undefined),set:(o,k,v)=>(o[k]=v,true)})})
globalThis.document={createElement:canvas}
await geometryDetailReady
const mats=createModelMaterials()
const LINE={id:'5',name:'5号线',colour:'#c8102e',stock:'B',cars:6,power:'third-rail',psd:'full',headwayProfile:{peak:150,offpeak:240,late:480},alightPerTrain:420,terminus:'through',direction:'up',upTerminus:'文冲',downTerminus:'滘口',travelSign:1,stations:[]}
const data={name:'动物园',seed:7654321,cells:[],modules:[],lines:[LINE]}
const ads={adFace:(slug,w,h)=>({material:new THREE.MeshBasicMaterial(),geometry:new THREE.PlaneGeometry(w,h),slug}),adWindow:(w,h)=>ads.adFace('a',w,h),load:async()=>{},dispose(){}}
const ctx={mats,ads,data,trackCells:new Set(),tvPlate:()=>new THREE.CanvasTexture(canvas()),signFace:()=>new THREE.MeshBasicMaterial(),finish:()=>mats.steel,preview:false,ownedMats:[]}
const tris=g=>(g.index?.count??g.getAttribute('position')?.count??0)/3

const results=[]
for(const option of MODULE_OPTIONS){
 const mod=createModule(option.id,4,4,0,`bench-${option.id}`,0,undefined,'up','lane',[LINE])
 if(!mod){results.push({id:option.id,low:null,high:null,reason:'createModule returned null'});continue}
 data.modules=[mod];ctx.data=data
 let root
 try{root=buildModule(mod,ctx)}catch(error){results.push({id:option.id,low:null,high:null,reason:String(error)});continue}
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
results.sort((a,b)=>b.high-a.high)
const report={revision:THREE.REVISION,options:MODULE_OPTIONS.length,results};
const output=resolve(process.env.BENCH_OUTPUT??'.preview/perf/model-triangles.json');
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));
writeFileSync(output.replace(/\.json$/,'.md'),['| Equipment / decor model name | Low triangles | High triangles |','|---|---:|---:|',...results.map(r=>'| '+r.id+' | '+r.low+' | '+r.high+' |')].join('\n')+'\n');
console.log(results.length+' palette models: '+output)
