import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { populationEdit, applyPopulationEdit, hasPresentationEdit } from '../src/sim/populationEdit.ts'
import { presentationKeepIds } from '../src/render/presentationEdit.ts'
import { defaultLine } from '../src/build/rail.ts'
import { createModule } from '../src/build/model.ts'

const fixture = () => ({name:'Station',nameEn:'Station',seed:1,cells:[],lines:[defaultLine('1','up'),defaultLine('2','down')],modules:[
  {id:'exit',type:'exit',x:0,y:0,z:0,w:1,h:1,cfg:{name:'A',inRate:100,open:true,headHouse:false}},
  {id:'other',type:'exit',x:2,y:0,z:0,w:1,h:1,cfg:{name:'B',inRate:100,open:true,headHouse:false}},
  {id:'edge1',type:'platform-edge',x:0,y:1,z:0,w:4,cfg:{line:'1'}},
  {id:'edge2',type:'platform-edge',x:0,y:2,z:0,w:4,cfg:{line:'2'}},
  createModule('bench',20,20,0,'bench'),{...createModule('guidepost',0,0,0,'guide'),cfg:{exitId:'exit'}},
  createModule('busstop-short',0,10,0,'bus'),createModule('floor-mark-boarding',0,20,0,'mark'),
]})

test('presentation patches preserve topology and target only artwork-dependent models', () => {
  const before=fixture()
  for(const patch of [{name:'New station'},{nameEn:'New English station'},
    {lines:before.lines.map(l=>l.id==='1'?{...l,name:'New line',colour:'#123456',upTerminus:'East',downTerminus:'West'}:l)},
    {modules:before.modules.map(m=>m.id==='exit'?{...m,cfg:{...m.cfg,name:'C'}}:m)}]) {
    const after={...before,...patch}, edit=populationEdit(before,after)
    assert.ok(edit)
    assert.equal(hasPresentationEdit(edit),true)
    assert.deepEqual(applyPopulationEdit(before,edit),after)
    const keep=presentationKeepIds(before,after,edit)
    assert.ok(keep.has('bench'),'remote geometry always survives')
    if(edit.labels) { assert.ok(!keep.has('edge1'));assert.ok(keep.has('edge2'));assert.ok(keep.has('exit')) }
    if(edit.exits.length) { assert.ok(!keep.has('exit'));assert.ok(keep.has('other'));assert.ok(!keep.has('guide'));assert.ok(keep.has('edge1')) }
  }
  for(const [field,value] of [['stock','D'],['cars',8],['power','catenary'],['direction','down'],['stations',['X']]]) {
    assert.equal(populationEdit(before,{...before,lines:[{...before.lines[0],[field]:value},before.lines[1]]}),null)
  }
  const future={...before,modules:[...before.modules,{id:'future',type:'future-piece',x:0,y:0,z:0,cfg:{}}]}
  const renamed={...future,name:'New'}
  assert.equal(presentationKeepIds(future,renamed,populationEdit(future,renamed)).has('future'),false,'unknown model dependencies retain the conservative rebuild path')
})

test('exit open flag changes new trip selection while retaining existing journeys and routes', () => {
  const data=fixture(); data.modules=data.modules.filter(m=>m.type==='exit');data.lines=[]
  data.cells=[0,2].map(x=>({x,y:0,z:0,fill:'solid'}))
  const world=new World(data,1,7*3600), graph=world.graph, path=world.path
  const existing=world.pool.spawn({origin:'exit:other',stops:[],dest:'exit:exit'},0,0,1,0)
  existing.path=new Int32Array([0]);existing.pathIdx=0
  const rng=world.rng.state
  const after={...data,modules:data.modules.map(m=>m.id==='exit'?{...m,cfg:{...m.cfg,open:false}}:m)}
  const edit=populationEdit(data,after)
  assert.equal(hasPresentationEdit(edit),false)
  world.updatePopulation(edit)
  assert.equal(world.graph,graph);assert.equal(world.path,path);assert.equal(world.rng.state,rng)
  assert.equal(existing.trip.dest,'exit:exit');assert.deepEqual([...existing.path],[0])
  assert.equal(world.pickExitId(),'other','new trips exclude the closed exit')
  let closedRateCalls=0
  world.rng.poissonHour=rate=>{if(rate===100*world.curve(world.metrics.period))closedRateCalls++;return 0}
  world.spawnStreet(world.metrics.period)
  assert.equal(closedRateCalls,1,'only the still-open exit draws arrivals')
  world.updatePopulation({lines:[],exits:[{id:'other',inRate:100,open:false}]})
  assert.equal(world.pickExitId(),'','all closed exits produce no new exit destination')
})

test('restart retains static graph and collision buffers and matches the old full-rebuild reset', () => {
  const data=referenceStation(), fast=new World(data,1234,7*3600), slow=new World(data,1234,7*3600)
  for(let i=0;i<12;i++){fast.tickOnce();slow.tickOnce()}
  const graph=fast.graph, nodes=graph.nodeX, counts=fast.cCounts, density=fast.nodePop
  for(const world of [fast,slow]) {
    world.selectedAgent=123;world.nodePop.fill(7);world.path.cache.set('stale',new Int32Array([0]))
    for(const server of world.graph.servers) {
      server.queue.push(123);server.cooldown=9;server.served=8;server.waitAccum=7;server.waitCount=6;server.lane=1
      if(server.ramp){server.ramp.next=12;if(server.ramp.traffic){server.ramp.traffic.direction=1;server.ramp.traffic.until=1e9}}
      if(server.lift){server.lift.at=1;server.lift.z=999;server.lift.phase='move';server.lift.door=1;server.lift.riders.push(123)}
    }
  }
  const original=slow.rebuild
  slow.rebuild=function(){return original.call(this,false)}
  const tick=fast.tick, time=fast.simTime
  fast.restart();slow.restart()
  assert.equal(fast.graph,graph);assert.equal(fast.graph.nodeX,nodes);assert.equal(fast.cCounts,counts);assert.equal(fast.nodePop,density)
  assert.notEqual(slow.graph,graph)
  assert.equal(fast.tick,tick);assert.equal(fast.simTime,time);assert.equal(fast.selectedAgent,-1)
  assert.equal(fast.pool.count,0);assert.equal(fast.path.cache.size,0);assert.equal(fast.path.pendingCount,0)
  assert.ok(fast.nodePop.every(n=>n===0))
  for(let i=0;i<fast.graph.servers.length;i++) {
    assert.deepEqual(fast.graph.servers[i],slow.graph.servers[i],'server queues, lifts, gates and shared stair traffic reset identically')
  }
  for(let i=0;i<24;i++){fast.tickOnce();slow.tickOnce()}
  assert.deepEqual(fast.snapshot(),slow.snapshot())
  assert.deepEqual(fast.trainRenderState(),slow.trainRenderState())
  assert.deepEqual(fast.liftRenderState(),slow.liftRenderState())
  fast.restart();assert.equal(fast.graph,graph,'repeated restart still reuses topology')
})
