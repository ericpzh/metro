import {existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {serialize,parse} from '../../game/src/persistence/save.ts'
import {authoredFrameSteps,authoredSteps,authoredCamera,modulePalette} from './authored-layout.mjs'

export function exportDemoSave(station,output,language='zh'){
 const state={...station}
 const raw=serialize(state),wire=JSON.parse(raw),loaded=parse(raw)
 if(!loaded.ok||loaded.droppedCells||loaded.droppedModules||wire.static.cells.length!==state.cells.length||wire.static.modules.length!==state.modules.length)throw Error('Demo save lost geometry during the native save/load round trip')
 const text=JSON.stringify(wire,null,2)+'\n',snapshot=resolve(output,'demo-station.metro.json')
 mkdirSync(output,{recursive:true});writeFileSync(snapshot,text)
 const authoring=resolve('video/demo-station.metro.json'),mapping=resolve(output,'demo-station-replay.json')
 // The user owns the working copy. Recording may refresh its own snapshot,
 // but must never replace an existing working save or its original ID map.
 if(!existsSync(authoring)){
  mkdirSync(dirname(authoring),{recursive:true});writeFileSync(authoring,text)
 }
 const actions=[...authoredFrameSteps().map(s=>({...s,phase:'frame'})),...authoredSteps.map(s=>({...s,phase:'equipment'}))].map((s,index)=>({index,phase:s.phase,action:s.kind,east:s.east,cells:s.cells?.map(c=>[c.x,c.y,c.z]),catalogueId:s.modules?.length?modulePalette(s.modules[0]):undefined,moduleIds:s.modules?.map(m=>m.id)}))
 writeFileSync(mapping,JSON.stringify({format:'metro-video-replay',version:2,save:authoring,camera:authoredCamera,actions},null,2)+'\n')
 const result={snapshot,authoring,mapping,cells:state.cells.length,modules:state.modules.length,roundTrip:{ok:true,droppedCells:0,droppedModules:0}}
 writeFileSync(resolve(output,'save-check.json'),JSON.stringify(result,null,2))
 return result
}
