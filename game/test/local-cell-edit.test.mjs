import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyStation } from '../src/data/reference-station.ts'
import { localCellEdit } from '../src/render/localCellEdit.ts'
import { StationGeometry } from '../src/app/stationGeometry.ts'
import { retainedModuleIds, isEquipmentModelEdit } from '../src/render/moduleDependencies.ts'
import { createModule, removeCells, addCells, addWalls } from '../src/build/model.ts'
import { blockIndex } from '../src/sim/blockIndex.ts'
import { rampCellModelInputs } from '../src/render/structuralModelInputs.ts'
import { stairFlights, stairFlightSlides, stairTreadWidth, stairWallSides, stairLandingWalls } from '../src/sim/stairs.ts'
import { DEFAULT_MATERIAL } from '../src/sim/finishes.ts'

const fixture=()=>({...emptyStation(),cells:[{x:-32,y:-32,z:-10,fill:'solid'},{x:32,y:32,z:-10,fill:'solid'},{x:0,y:0,z:-10,fill:'solid'}],modules:[]})
test('commit helpers reuse preview occupancy without mutating it or duplicating candidate cells',()=>{
  const before=fixture(),index=blockIndex(before.cells,before.modules),snapshot=[...index.solid]
  assert.equal(addCells(before.cells,[[1,1,-9],[1,1,-9]],before.modules).changed,1)
  assert.equal(addWalls(before,[[1,1,-9],[1,1,-9]],'n',1).changed,1)
  assert.deepEqual([...index.solid],snapshot)
  assert.equal(blockIndex(before.cells,before.modules),index)
  const hole={...before,cells:[...before.cells,{x:1,y:1,z:0,fill:'void'}]}
  assert.equal(addCells(hole.cells,[[1,1,0]],hole.modules).cells.some(c=>c.x===1&&c.y===1&&c.z===0),false)
  const filled=addWalls(hole,[[1,1,0]],'n',1).state.cells.filter(c=>c.x===1&&c.y===1&&c.z===0)
  assert.equal(filled.length,1);assert.equal(filled[0].fill,'solid')
})
test('bounded ramp signatures equal the full builder inputs for every stair style and rotation',()=>{
  const cells=[]
  for(let x=-22;x<=22;x++)for(let y=-22;y<=22;y++)for(const z of [-10,-9,-8,-6,-5,-4,0])
    if((x*7+y*11+z)%4!==0)cells.push({x,y,z,fill:'solid',finish:{top:'floor.tile'}})
  for(const style of ['straight','right90','left90','right180','left180','leftForward','centerForward','rightForward'])for(let rot=0;rot<4;rot++){
    const mod=createModule('stair-'+style,0,0,-10,style+rot,rot),data={...fixture(),cells,modules:[mod]},flights=stairFlights(mod),slides=stairFlightSlides(mod)
    const floor=cells.find(c=>c.x===mod.from.x&&c.y===mod.from.y&&c.z===mod.from.z)
    const expected=[mod.cfg.finish??floor?.finish?.top??DEFAULT_MATERIAL,
      flights.map((f,i)=>stairWallSides(cells,f.from,f.to,stairTreadWidth(mod),slides[i])),
      flights.slice(1).map((_,i)=>stairLandingWalls(cells,mod,i))]
    assert.deepEqual(rampCellModelInputs(data,mod),expected,style+' rotation '+rot)
  }
})
test('bounded immutable cell deltas share cached verdicts and reject structural/window changes',()=>{
  const before=fixture(),cell={x:0,y:0,z:-9,fill:'solid'},after={...before,cells:[...before.cells,cell]}
  assert.deepEqual(localCellEdit(before,after),{removed:[],added:[cell]})
  assert.equal(localCellEdit(before,after),localCellEdit(before,after))
  assert.deepEqual(localCellEdit(after,before),{removed:[cell],added:[]})
  for(const next of [{...after,modules:[]},{...after,levelBase:1},{...after,storeyHeight:6},
    {...before,cells:[...before.cells,{...cell,z:0}]},{...before,cells:[...before.cells,{...cell,x:500}]},
    {...before,cells:[...before.cells,...Array.from({length:257},(_,i)=>({...cell,x:i}))]}])assert.equal(localCellEdit(before,next),null)
})

test('live tool indexes match fresh occupancy and floor rules through local edits and undo',()=>{
  const cache=new StationGeometry(),before=fixture(),source=JSON.stringify(before)
  const cells=before.cells
  const edits=[before,{...before,cells:[...cells,{x:0,y:0,z:-9,fill:'solid'}]},
    {...before,cells:cells.filter(c=>c.x!==0)},before,
    {...before,cells:[...cells,{x:1,y:1,z:1,fill:'solid'}]},before,
    {...before,cells:[...cells,{x:0,y:0,z:-6,fill:'solid',tags:['suspended-ceiling']}]},before]
  for(const data of edits)assert.deepEqual(cache.resolve(data),new StationGeometry().resolve(data))
  assert.equal(JSON.stringify(before),source,'derived index changes never mutate the station')
})

test('structural tool-index deltas match fresh preparation across holes, duplicates, ground expansion and undo',async()=>{
  const {addEquipment,removeModule}=await import('../src/build/model.ts')
  const cache=new StationGeometry(),base=fixture()
  base.cells=[...base.cells,{x:2,y:2,z:-9,fill:'solid',finish:{top:'floor.track'}},
    {x:2,y:2,z:-9,fill:'void'},{x:0,y:0,z:0,fill:'void'},
    {x:1,y:1,z:1,fill:'solid',tags:['half-wall:n']}]
  const original=JSON.stringify(base),solids=cache.resolve(base).solids,floors=cache.resolve(base).floors
  for(const kind of ['stair-left180','escalator','lift','exit-virtual','door-glass-1','shelf-white-tall']){
    const piece=createModule(kind,0,0,-10,kind)
    assert.ok(piece,kind)
    const placed=addEquipment(base,piece),moved=addEquipment(base,{...piece,x:80,from:piece.from?{...piece.from,x:80}:undefined,to:piece.to?{...piece.to,x:80}:undefined})
    for(const state of [placed,moved,removeModule(moved,kind),base]){
      const result=cache.resolve(state)
      assert.deepEqual(result,new StationGeometry().resolve(state),kind)
      assert.equal(result.solids,solids,'the live occupancy index remains allocated')
      assert.equal(result.floors,floors,'only affected exposed floor keys change')
    }
  }
  assert.equal(JSON.stringify(base),original)
})

test('cell delta caching includes the module-owned street bounds',()=>{
  const before=fixture(),after={...before,cells:[...before.cells,{x:500,y:0,z:-9,fill:'solid'}]}
  const modules=[createModule('bench',1000,0,0,'distant')]
  assert.ok(localCellEdit({...before,modules},{...after,modules}))
  assert.equal(localCellEdit(before,after),null,'the same cells expand a smaller station window')
})

test('block edits retain remote monitors and cell-independent rail signals but invalidate actual monitor supports',()=>{
  const before=fixture()
  before.modules=[createModule('monitor-ceiling',0,0,-7,'monitor'),createModule('rail-signal',0,0,-10,'signal')]
  const remote={...before,cells:[...before.cells,{x:20,y:20,z:-9,fill:'solid'}]}
  assert.deepEqual([...retainedModuleIds(before,remote)].sort(),['monitor','signal'])
  const support={...before,cells:[...before.cells,{x:0,y:0,z:-6,fill:'solid'}]}
  assert.equal(retainedModuleIds(before,support).has('monitor'),false)
  assert.equal(retainedModuleIds(before,support).has('signal'),true)
})

test('nearby ramp edits retain equal wall inputs and invalidate landing finishes and complete walls',()=>{
  const before=fixture(),stair=createModule('stair-straight',0,0,-10,'stair'),escalator=createModule('escalator',2,0,-10,'escalator')
  before.modules=[stair,escalator]
  const nearby={...before,cells:[...before.cells,{x:-1,y:0,z:-9,fill:'solid'}]}
  for(const mod of before.modules){
    assert.deepEqual(rampCellModelInputs(before,mod),rampCellModelInputs(nearby,mod))
    assert.equal(retainedModuleIds(before,nearby).has(mod.id),true)
  }
  const painted={...before,cells:before.cells.map(c=>c.x===0&&c.y===0?{...c,finish:{top:'floor.tile'}}:c)}
  assert.equal(retainedModuleIds(before,painted).has('stair'),false)
  const walls=[]
  for(let y=0;y<=8;y++)for(let z=-9;z<=-4;z++)walls.push({x:-1,y,z,fill:'solid'})
  const walled={...before,cells:[...before.cells,...walls]}
  assert.notDeepEqual(rampCellModelInputs(before,stair),rampCellModelInputs(walled,stair))
  assert.equal(retainedModuleIds(before,walled).has('stair'),false)
})

test('stair blocks add, move and delete without invalidating chunks or nearby ramp models',()=>{
  const before=fixture(),stair=createModule('stair-straight',0,0,-10,'stairs')
  before.modules=[stair]
  const block=createModule('stair-block',2,0,-10,'step')
  const placed={...before,modules:[stair,block]},moved={...before,modules:[stair,{...block,x:3}]}
  const cache=new StationGeometry(),geometry=cache.resolve(before)
  for(const [from,to]of [[before,placed],[placed,moved],[moved,before]]){
    assert.equal(isEquipmentModelEdit(from,to),true,'a small stepped tile changes no chunk input')
    assert.equal(retainedModuleIds(from,to).has(stair.id),true,'real ramps keep their model and wall inputs')
    assert.equal(cache.resolve(to),geometry,'tool indexes remain prepared')
  }
})

test('deleting an unhosted block preserves module identity; deleting a hosting floor still removes its equipment',()=>{
  const before=fixture(),bench=createModule('bench',0,0,-10,'bench')
  before.modules=[bench]
  const added={...before,cells:[...before.cells,{x:5,y:5,z:-9,fill:'solid'}]}
  const deleted=removeCells(added,[[5,5,-9]])
  assert.equal(deleted.modules,added.modules,'a plain delete must enter the same local cell cache as placement')
  assert.deepEqual(deleted.cells,before.cells)
  assert.equal(removeCells(before,[[0,0,-10]]).modules.length,0,'host removal remains structural')
})
