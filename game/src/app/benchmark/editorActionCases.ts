// Shared by the production-browser audit and its completeness regression.
// Catalogue entries are automatic; finite action-row settings are explicit.
import { MODULE_OPTIONS, isDecorType, isStairType } from '../store/catalog.ts'
import { createModule } from '../../build/model.ts'
import type { ModuleBuildSettings } from '../../build/model/Equipment.ts'
import { ROOF_WIDTHS, PILLAR_LENGTHS } from '../../sim/structures.ts'
import { STAIR_WIDTHS } from '../../sim/stairs.ts'
import { rampLengthsFor } from '../../sim/rampLengths.ts'
import { WALKWAY_LENGTHS } from '../../sim/walkways.ts'
import { LIFT_INTERVALS, LIFT_SIZES } from '../../sim/lifts.ts'
import { GATE_DOORS } from '../../sim/gates.ts'
import { ESCALATOR_WIDTHS } from '../../sim/escalators.ts'
import { TRACK_RUN_LENGTHS } from '../../sim/track.ts'
import { roadBetween } from '../../sim/roadDocument.ts'
import { snapPsdEndCover } from '../../sim/psdEnds.ts'
import { defaultLine, makeTrack, trackPieceForLine } from '../../build/rail.ts'
import type { Module, CellShape, GateDoor, StationData } from '../../sim/types.ts'

export interface EditorActionCase {
  id: string
  paletteId: string
  category: 'structural' | 'equipment' | 'decor'
  kind: 'module' | 'cell'
  factoryId?: string
  width?: number
  run?: number
  rot?: number
  door?: GateDoor
  dir?: 'up' | 'down'
  settings?: ModuleBuildSettings
  cfg?: Record<string, unknown>
  shape?: CellShape
  height?: number
  ceiling?: boolean
  autoWalls?: boolean
  rail?: 'platform' | 'tunnel'
  lineId?: string
}

export function editorActionCases(data?:StationData): EditorActionCase[] {
  const cases: EditorActionCase[] = MODULE_OPTIONS.map(option=>({
    id:option.id,paletteId:option.id,kind:'module',
    category:option.type==='roof'||option.type==='pillar'||option.id==='bridge'||option.id==='stair-block'
      ?'structural':isDecorType(option.id)?'decor':'equipment',
  }))
  const add=(base:EditorActionCase,suffix:string,patch:Partial<EditorActionCase>)=>cases.push({...base,...patch,id:`${base.id}/${suffix}`})
  for(const base of [...cases]){
    const id=base.paletteId
    if(id.startsWith('roof-'))for(const width of ROOF_WIDTHS)add(base,`width=${width}`,{width})
    if(id.startsWith('pillar-'))for(const height of PILLAR_LENGTHS)add(base,`height=${height}`,{cfg:{height}})
    if(id==='pillar-slim')for(let position=0;position<9;position++)add(base,`position=${position}`,{rot:position})
    if(id==='roof')for(const plateSnap of ['lower','upper'])add(base,`snap=${plateSnap}`,{cfg:{plateSnap}})
    if(isStairType(id)&&id!=='stair-block'){
      for(const width of STAIR_WIDTHS)add(base,`width=${width}`,{width})
      for(const span of ['single','double','triple'] as const)for(const {id:length}of rampLengthsFor(span,'stair'))
        add(base,`span=${span};length=${length}`,{settings:{escalatorSpan:span,rampLength:length}})
    }
    if(id==='escalator'){
      for(const width of ESCALATOR_WIDTHS)if(width>1)add(base,width===2?'wide':`width=${width}`,{width})
      add(base,'down',{dir:'down'})
      for(const span of ['single','double','triple'] as const)for(const {id:length}of rampLengthsFor(span))
        add(base,`span=${span};length=${length}`,{settings:{escalatorSpan:span,rampLength:length}})
    }
    if(id==='walkway'){
      for(const width of ESCALATOR_WIDTHS)if(width>1)add(base,width===2?'wide':`width=${width}`,{width})
      add(base,'down',{dir:'down'})
      for(const {id:length}of WALKWAY_LENGTHS)add(base,`length=${length}`,{settings:{walkwayLength:length}})
    }
    if(id==='lift'){
      for(const size of LIFT_SIZES)add(base,`size=${size}`,{settings:{liftSize:size}})
      for(const {interval}of LIFT_INTERVALS)add(base,`interval=${interval}`,{settings:{liftInterval:interval}})
      add(base,'steel',{cfg:{style:'steel'}})
    }
    if(id==='gate'||id==='gate-new')for(const door of GATE_DOORS)add(base,`door=${door}`,{door})
    if(id.startsWith('bench-')||id.startsWith('door-'))add(base,'wide',{factoryId:id.replace(/-1$/,'-2')})
    if(id==='stair-block')add(base,'half-height',{width:.5})
    if(id.startsWith('hanger-'))for(const width of [4,6,8])add(base,`length=${width}`,{width})
    if(id==='curtain-wall'){
      for(const width of [1,2,3,4])add(base,`width=${width}`,{width})
      for(const curtainHeight of [2,3,4] as const)add(base,`height=${curtainHeight}`,{settings:{curtainHeight}})
    }
    if(id==='light-rectangular')for(let position=0;position<9;position++)add(base,`position=${position}`,{cfg:{position}})
    if(id==='psd-end')add(base,'full',{cfg:{psd:'full'}})
    if(id==='bridge'){
      for(const run of TRACK_RUN_LENGTHS)add(base,`length=${run}`,{run})
      for(const bridgeRailing of ['railing','sound-barrier-half','sound-barrier'])add(base,`railing=${bridgeRailing}`,{cfg:{bridgeRailing}})
    }
    if(id==='road'){
      for(const width of [6,12,18,24])add(base,`width=${width}`,{width})
      add(base,'one-way',{cfg:{direction:'one-way'}})
    }
  }
  cases.push({id:'block',paletteId:'block',kind:'cell',category:'structural'},
    {id:'wall',paletteId:'wall',kind:'cell',category:'structural',height:4},
    {id:'suspended-ceiling',paletteId:'block',kind:'cell',category:'structural',ceiling:true})
  cases.push({id:'block/auto-walls',paletteId:'block',kind:'cell',category:'structural',autoWalls:true})
  const platform:EditorActionCase={id:'platform',paletteId:'__platform',kind:'module',category:'structural',rail:'platform'}
  const tunnel:EditorActionCase={id:'tunnel',paletteId:'__tunnel',kind:'module',category:'structural',rail:'tunnel'}
  cases.push(platform,tunnel)
  for(const dir of ['up','down'] as const)add(platform,`direction=${dir}`,{dir})
  for(const catenaryStyle of ['canopy','gantry'])add(platform,`catenary=${catenaryStyle}`,{cfg:{power:'catenary',catenaryStyle}})
  for(const line of data?.lines??[])add(platform,`line=${line.id}`,{lineId:line.id})
  for(const run of TRACK_RUN_LENGTHS)add(tunnel,`length=${run}`,{run})
  for(const side of ['n','e','s','w'] as const){
    cases.push({id:`half-wall/${side}`,paletteId:'half-wall',kind:'cell',category:'structural',shape:{kind:'half',side}})
    for(const triangle of ['upper','lower'] as const)cases.push({id:`tri-${triangle}/${side}`,paletteId:`tri-${triangle}`,kind:'cell',category:'structural',shape:{kind:'triangle',triangle,side}})
  }
  return cases
}

export function caseModules(spec:EditorActionCase,x:number,y:number,z:number,id:string,lines:StationData):Module[]{
  const factory=spec.factoryId??spec.paletteId
  if(spec.rail){
    const line=lines.lines.find(l=>l.id===spec.lineId)??lines.lines[0]??defaultLine('1','up','third-rail')
    const size=trackPieceForLine(line)
    return [makeTrack({id,x,y,z,rot:spec.rot??0,lineId:line.id,dir:spec.dir??line.direction,power:spec.cfg?.power==='catenary'?'catenary':line.power,
      w:spec.rail==='tunnel'?spec.run??32:size.w,d:size.d,tunnel:spec.rail==='tunnel',catenaryStyle:spec.cfg?.catenaryStyle==='gantry'?'gantry':'canopy'})]
  }
  if(factory==='road')return [roadBetween([x,y],[x,y+12],z,spec.width??6,spec.cfg?.direction==='one-way'?'one-way':'two-way',false,id)]
  const make=(type:string,key:string,rot=spec.rot??0)=>{
    const mod=createModule(type,x,y,z,key,rot,spec.width,spec.dir??'up',spec.door??'lane',lines,undefined,{storeyHeight:5,...spec.settings})
    if(!mod)throw Error(`No production factory for ${spec.id}`)
    const result={...mod,cfg:{...mod.cfg,...spec.cfg}} as Module
    if(result.type==='track'){
      result.w=spec.run??32;result.cfg.line=lines.lines[0]?.id??result.cfg.line
    }
    if(result.type==='psd-end'&&result.cfg.variant==='cover'){
      const support=caseSupports(spec,x,y,lines)[0]!
      const cover=snapPsdEndCover(result,[support],lines.lines,support.id)
      if(!cover)throw Error('PSD cover fixture did not snap to its support')
      return cover
    }
    return result
  }
  // The double TV is one compound placement, not a missing model/factory.
  return factory==='tv-double'?[make('tv',id),make('tv',`${id}:back`,2)]:[make(factory,id)]
}

export function caseSupports(spec:EditorActionCase,x:number,y:number,lines:StationData):Module[]{
  if(spec.paletteId!=='psd-end-cover')return []
  return [{id:`editor-audit:cover-support:${x}:${y}`,type:'platform-edge',x,y,z:0,rot:0,w:1,
    storeyHeight:5,cfg:{name:'Benchmark support',line:lines.lines[0]?.id??'1',dir:'up',side:'left',psd:'full'}}]
}
