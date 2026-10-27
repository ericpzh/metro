// Opt-in browser audit. Calls the same preview/build/store APIs as the editor;
// it deliberately reports API-to-render latency, not DOM pointer/raycast latency.
import { useStore } from '../store.ts'
import { addCells, addFloor, removeFloor, plannedAutoWalls, addWalls, addSuspendedCeiling, addEquipment, addRoadSegment, removeRoadSegment, removeCells, removeModule, type StationState } from '../../build/model.ts'
import { commitTrack } from '../../build/rail.ts'
import { isCeilingHung, isMovableModule, moveCandidate, moduleEnvelope } from '../../sim/placement.ts'
import { isWallMountedType } from '../store/catalog.ts'
import { packKey, type Cell, type Module } from '../../sim/types.ts'
import { blockIndex } from '../../sim/blockIndex.ts'
import { editorActionCases, caseModules, caseSupports, type EditorActionCase } from './editorActionCases.ts'
import type { SceneRenderer } from '../../render/scene.ts'
import type { SceneContextData } from '../../render/scene/systems/SceneSystem.ts'
import type { ChunkSystem } from '../../render/scene/systems/ChunkSystem.ts'
import type { ModuleSystem } from '../../render/scene/systems/ModuleSystem.ts'
import type { LevelSystem } from '../../render/scene/systems/LevelSystem.ts'
import type { CameraSystem } from '../../render/scene/systems/CameraSystem.ts'
import { StationGeometry } from '../stationGeometry.ts'

const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
const settle=async()=>{await frame();await frame()}
// Audit-only structural view: production callers keep these systems private.
type AuditScene=Omit<SceneRenderer,never>&{ctx:SceneContextData;chunks:ChunkSystem;modules:ModuleSystem;level:LevelSystem;cameraSys:CameraSystem;ghostSys:{movingModuleId:string|null}}
const scene=()=>window.__scene! as unknown as AuditScene
type Work=Record<string,{calls:number;ms:number}>
interface Row { action:string; status:string; cpuMs:number; firstRenderMs:number|null; generationMs:number; commits:number; work:Work; error?:string; input?:unknown; cells:number; modules:number; chunkKeyCellVisits?:number; meshedCellVisits?:number; groundTemplateHits?:number }
let installed=false,current:{start:number;render:number|null;work:Work;expected:StationState|null;ready:boolean;expectedMoving?:string|null}|null=null
const errors:string[]=[]
function instrument(){
  if(installed)return
  installed=true
  const s=scene()
  const wrap=(object:object,key:string,label:string)=>{
    const host=object as Record<string, (...args:unknown[])=>unknown>,original=host[key]
    if(typeof original!=='function')throw Error(`Missing stage ${label}`)
    const run=function auditedStage(this:unknown,row:NonNullable<typeof current>,args:unknown[]){
      const t=performance.now();try{return original.apply(this,args)}finally{
        const w=row.work[label]??={calls:0,ms:0};w.calls++;w.ms+=performance.now()-t
        const data=s.ctx.stationData
        if(label==='renderer.render'&&row.ready&&row.render===null&&
          (row.expectedMoving===undefined||s.ghostSys.movingModuleId===row.expectedMoving)&&
          (!row.expected||data?.cells===row.expected.cells&&data.modules===row.expected.modules))row.render=performance.now()-row.start
      }
    }
    host[key]=function(...args){return current?run.call(this,current,args):original.apply(this,args)}
  }
  for(const [host,keys,prefix]of [
    [s,['setStation','setModulePreview','setGhost','setMovingModule'],'scene'],
    [s.chunks,['prepareStation','meshStation'],'chunks'],
    [s.modules,['buildModules','syncBatches','retainedIds','buildModel','clearModules'],'modules'],
    [s.level,['applyLevel'],'level'],[s.renderer,['render'],'renderer'],
  ] as const)for(const key of keys)wrap(host,key,`${prefix}.${key}`)
  wrap(StationGeometry.prototype,'resolve','tools.resolve')
  addEventListener('error',e=>errors.push(e.message))
  addEventListener('unhandledrejection',e=>errors.push(String(e.reason)))
}

async function measure(action:string,invoke:()=>void,commit:boolean,input?:unknown):Promise<Row>{
  const before=useStore.getState(),start=performance.now(),probe={start,render:null as number|null,work:{} as Work,expected:null as StationState|null,ready:false,expectedMoving:undefined as string|null|undefined}
  current=probe
  let cpuMs=0,error:string|undefined
  try{
    invoke();cpuMs=performance.now()-start
    const after=useStore.getState()
    if(commit){if(after.version-before.version!==1)throw Error('Expected exactly one document commit');probe.expected=after.station}
    else if(after.station!==before.station||after.version!==before.version)throw Error('Preview/pickup changed the document')
    if(action==='pickup')probe.expectedMoving=after.moveDraft?.module.id??null
    if(action==='drop')probe.expectedMoving=null
    probe.ready=true
    for(let i=0;i<120&&probe.render===null;i++)await frame()
    if(probe.render===null)throw Error('No matching rendered feedback within 120 frames')
  }catch(e){if(cpuMs===0)cpuMs=performance.now()-start;error=String(e)}finally{current=null}
  const after=useStore.getState(),generationMs=Object.entries(probe.work).filter(([key])=>key==='scene.setModulePreview'||key==='scene.setGhost').reduce((n,[,w])=>n+w.ms,0)
  const chunks=probe.work['chunks.meshStation'] ? {chunkKeyCellVisits:scene().chunks.chunkKeyCellVisits,meshedCellVisits:scene().chunks.meshedCellVisits,groundTemplateHits:scene().chunks.groundTemplateHits} : {}
  return {action,status:error?'error':Math.max(cpuMs,probe.render??Infinity)>=100?'over-budget':'pass',cpuMs,firstRenderMs:probe.render,generationMs,commits:after.version-before.version,work:probe.work,error,input,cells:after.station.cells.length,modules:after.station.modules.length,...chunks}
}

let original:StationState,origin={x:0,y:0}
export async function initialize(){
  instrument()
  original=useStore.getState().station
  origin={x:Math.max(...original.cells.map(c=>c.x),...original.modules.map(m=>m.x))+24,y:0}
  useStore.getState().setPlaying(false)
  return {cases:editorActionCases(original),fixture:{name:original.name,seed:original.seed,cells:original.cells.length,modules:original.modules.length},origin}
}

function coordinates(spec:EditorActionCase,iteration:number){
  // Separate samples exercise actual updates instead of a same-position cache hit.
  return {x:origin.x+iteration*4,y:origin.y,z:spec.ceiling?4:spec.kind==='cell'?1:spec.paletteId==='bridge'?5:0}
}
function pieceCells(spec:EditorActionCase,p:ReturnType<typeof coordinates>):Array<[number,number,number]>{
  if(spec.autoWalls)return [0,1,2].flatMap(dx=>[0,1,2].map(dy=>[p.x+dx,p.y+dy,p.z] as [number,number,number]))
  return Array.from({length:spec.height??1},(_,i)=>[p.x,p.y,p.z+i])
}
function previewCells(spec:EditorActionCase,p:ReturnType<typeof coordinates>):Array<[number,number,number]>{
  const cells=pieceCells(spec,p)
  if(!spec.autoWalls)return cells
  const s=useStore.getState().station
  return [...cells,...plannedAutoWalls(blockIndex(s.cells,s.modules).solid,cells,s.modules)]
}
function addPiece(spec:EditorActionCase,p:ReturnType<typeof coordinates>,mods:Module[]):StationState{
  let state=useStore.getState().station
  if(spec.kind==='module'){
    for(const mod of mods)state=mod.type==='track'?commitTrack(state,mod):mod.type==='road'?addRoadSegment(state,mod):addEquipment(state,mod)
    return state
  }
  const cells=pieceCells(spec,p)
  if(spec.autoWalls)return addFloor(state,cells)
  if(spec.ceiling)return addSuspendedCeiling(state,cells).state
  if(spec.shape||spec.height)return addWalls(state,[[p.x,p.y,p.z]],spec.shape?.side??null,spec.height??1,spec.shape?.kind==='triangle'?{kind:spec.shape.triangle,side:spec.shape.side}:null).state
  return {...state,cells:addCells(state.cells,cells,state.modules).cells}
}

async function prepare(spec:EditorActionCase,count:number){
  scene().setModulePreview(null);scene().setGhost([],'add')
  const cells:Cell[]=[...original.cells]
  // A declared staging bay is added to the complete demo, never substituted for
  // it. Street-window expansion and support preparation are outside timed rows.
  cells.push({x:origin.x-16,y:-16,z:0,fill:'solid'},{x:origin.x+144,y:48,z:0,fill:'solid'})
  const probe=spec.kind==='module'?caseModules(spec,origin.x,0,0,'fixture-probe',original):[]
  if(spec.rail){
    const right=Math.max(origin.x+144,...probe.map(m=>moduleEnvelope(m)?.x1??origin.x))+count*4
    cells.push({x:Math.ceil(right),y:48,z:0,fill:'solid'})
  }
  const hung=probe.some(isCeilingHung),wall=isWallMountedType(spec.factoryId??spec.paletteId)
  for(let x=origin.x-14;x<=origin.x+count*4+18;x++){
    if(hung)for(let y=-6;y<=16;y++)cells.push({x,y,z:5,fill:'solid'})
    if(wall)for(const y of [-1,7])for(let z=1;z<=4;z++)cells.push({x,y,z,fill:'solid'})
  }
  const supports=Array.from({length:count},(_,i)=>[0,8].flatMap(y=>caseSupports(spec,origin.x+i*4,y,original))).flat()
  const state={...original,cells,modules:supports.length?[...original.modules,...supports]:original.modules}
  useStore.getState().cancelMove(false)
  useStore.getState().commit(state)
  useStore.setState({past:[],future:[],tool:'select',activeZ:0,playing:false,hideGround:false,ghostOtherLevels:true,autoCeiling:false,hideWalls:false})
  await settle()
  const s=scene(),cam=s.cameraSys
  cam.controls.enableDamping=false
  const boxes=probe.map(m=>moduleEnvelope(m)).filter(b=>b!==null)
  const x0=Math.min(origin.x,...boxes.map(b=>b.x0)),x1=Math.max(origin.x+count*4,...boxes.map(b=>b.x1))
  const y0=Math.min(0,...boxes.map(b=>b.y0)),y1=Math.max(8,...boxes.map(b=>b.y1)),z1=Math.max(5,...boxes.map(b=>b.z1))
  const distance=Math.max(24,Math.hypot(x1-x0,y1-y0,z1)*1.25),cx=(x0+x1)/2,cy=(y0+y1)/2
  cam.controls.target.set(cx,cy,z1/2)
  cam.camera.position.set(cx+distance*.45,cy-distance*.65,z1/2+distance*.7)
  cam.controls.update();cam.syncOrtho()
  s.setOrtho(false)
  s.requestRender()
  await settle()
  return {supports:{hung,wall,modules:supports},cells:cells.length,modules:state.modules.length,camera:{position:cam.activeCamera().position.toArray(),target:cam.controls.target.toArray()},station:state}
}

export async function runCase(id:string,count=3){
  const spec=editorActionCases(original).find(c=>c.id===id)
  if(!spec)throw Error(`Unknown editor action case ${id}`)
  const fixture=await prepare(spec,count),rows:Array<Row&{iteration:number}>=[]
  for(let iteration=0;iteration<count;iteration++){
    const p=coordinates(spec,iteration),key=`editor-audit:${id}:${iteration}`
    const mods=spec.kind==='module'?caseModules(spec,p.x,p.y,p.z,key,original):[]
    const addRow=async(action:string,invoke:()=>void,commit:boolean,input?:unknown)=>{const row=await measure(action,invoke,commit,input);rows.push({...row,iteration});return row}
    scene().setModulePreview(null);scene().setGhost([],'add');await settle()
    const previewInput:{modules?:Module[];cells?:Array<[number,number,number]>}={}
    await addRow('preview',()=>{
      if(spec.kind==='module'){
        const preview=caseModules(spec,p.x,p.y,p.z,`editor-action-preview:${iteration}`,original)
        previewInput.modules=preview
        scene().setModulePreview(preview.length===1?preview[0]:preview)
      }
      else scene().setGhost(previewCells(spec,p),'add',0x55ddff,spec.shape?new Map(pieceCells(spec,p).map(([x,y,z])=>[packKey(x,y,z),spec.shape!])):undefined)
      previewInput.cells=spec.kind==='cell'?pieceCells(spec,p):undefined
    },false,previewInput)
    const placed=await addRow('place',()=>{
      scene().setModulePreview(null);scene().setGhost([],'add')
      const next=addPiece(spec,p,mods)
      useStore.getState().commit(next)
    },true,{anchor:p})
    if(placed.status==='error'){
      for(const action of ['pickup','move-preview','drop','delete'])rows.push({...placed,action,error:'Placement failed; dependent action was not measured',input:{placementError:placed.error},iteration})
      continue
    }
    const source=useStore.getState().station.modules.find(m=>m.id===key)
    if(source&&isMovableModule(source)){
      await addRow('pickup',()=>useStore.getState().liftModule(key),false,{id:key})
      const at={x:source.x,y:source.y+8,z:spec.paletteId==='psd-end-cover'?0:source.z}
      let candidate=source,reason=''
      const moveInput:{at:typeof at;candidate?:Module;reason?:string}={at}
      await addRow('move-preview',()=>{
        const state=useStore.getState(),aim=moveCandidate(state.station.cells,state.station.modules,source,at,source.rot??0)
        candidate=aim.module;reason=aim.reason;moveInput.candidate=candidate;moveInput.reason=reason
        scene().setModulePreview({...candidate,id:'move-preview'},reason!=='')
        useStore.getState().aimMove(at,candidate,reason)
      },false,moveInput)
      await addRow('drop',()=>{
        scene().setModulePreview(null);useStore.getState().confirmMove()
        const moved=useStore.getState().station.modules.find(m=>m.id===key)
        if(!moved||moved.x!==candidate.x||moved.y!==candidate.y||moved.z!==candidate.z)throw Error(`Drop did not reach the candidate: ${reason||useStore.getState().notice}`)
      },true,{at,reason,component:key,compoundSize:mods.length})
      if(useStore.getState().moveDraft)useStore.getState().cancelMove(false)
    }else{
      for(const action of ['pickup','move-preview','drop'])rows.push({action,iteration,status:'unsupported',cpuMs:0,firstRenderMs:null,generationMs:0,commits:0,work:{},cells:useStore.getState().station.cells.length,modules:useStore.getState().station.modules.length,input:{reason:spec.kind==='cell'?'The editor has no cell Move action':'Production isMovableModule refuses this subtype'}})
    }
    await addRow('delete',()=>{
      if(spec.rail){useStore.getState().removeRail(key);return}
      let next=useStore.getState().station
      if(spec.kind==='module')for(const mod of mods){
        const placed=next.modules.find(m=>m.id===mod.id)
        next=placed?.type==='road'&&placed.cfg.from?removeRoadSegment(next,placed.cfg.from,placed.z,placed.id):removeModule(next,mod.id)
      }
      else next=spec.autoWalls?removeFloor(next,pieceCells(spec,p)):removeCells(next,pieceCells(spec,p))
      useStore.getState().commit(next)
      if(spec.kind==='module'&&useStore.getState().station.modules.some(m=>mods.some(n=>m.id===n.id)))throw Error('Delete left a placed module')
    },true,{ids:mods.map(m=>m.id),cells:spec.kind==='cell'?pieceCells(spec,p):undefined})
    await settle()
  }
  // Untimed replay for the driver's screenshot; never include capture/readback
  // in the action timings or use a frame with all test objects already deleted.
  const p=coordinates(spec,0)
  if(spec.kind==='module'){
    const mods=caseModules(spec,p.x,p.y,p.z,`editor-audit:${id}:screenshot`,original)
    scene().setModulePreview(mods.length===1?mods[0]:mods)
  }else scene().setGhost(previewCells(spec,p),'add',0x55ddff,spec.shape?new Map(pieceCells(spec,p).map(([x,y,z])=>[packKey(x,y,z),spec.shape!])):undefined)
  await settle()
  const {station:_,...metadata}=fixture
  return {id,spec,fixture:metadata,rows,screenshotState:'untimed preview replay',errors:[...errors],glError:scene().renderer.getContext().getError()}
}

export const stages={
  'tools.resolve':'game/src/app/stationGeometry.ts',
  'scene.setModulePreview':'game/src/render/scene/systems/GhostSystem.ts',
  'scene.setGhost':'game/src/render/scene/systems/GhostSystem.ts',
  'scene.setMovingModule':'game/src/render/scene/SceneRenderer.ts',
  'scene.setStation':'game/src/render/scene/SceneRenderer.ts',
  'chunks.prepareStation':'game/src/render/scene/systems/ChunkSystem.ts',
  'chunks.meshStation':'game/src/render/scene/systems/ChunkSystem.ts',
  'modules.buildModules':'game/src/render/scene/systems/ModuleSystem.ts',
  'modules.retainedIds':'game/src/render/moduleDependencies.ts',
  'modules.buildModel':'game/src/render/models.ts',
  'modules.clearModules':'game/src/render/scene/systems/ModuleSystem.ts',
  'modules.syncBatches':'game/src/render/scene/systems/ModuleSystem.ts',
  'level.applyLevel':'game/src/render/scene/systems/LevelSystem.ts',
  'renderer.render':'three.WebGLRenderer.render',
  place:'game/src/build/model/Equipment.ts + game/src/app/store/slices/StationSlice.ts',
  drop:'game/src/app/store/slices/MoveSlice.ts',
  delete:'game/src/build/model/Equipment.ts + game/src/build/model/Cells.ts',
}
