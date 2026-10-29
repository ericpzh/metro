import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { buildGraph, cellKey } from '../src/sim/station.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { packActivity, unpackActivity, ACTIVITY_DURATION } from '../src/sim/activities.ts'
import { activityStopPlaces } from '../src/sim/activityStops.ts'
import { isSimInertDecorModule } from '../src/sim/decorInert.ts'
import { AgentState } from '../src/sim/types.ts'
import { liftModule, liftExtendedUp } from '../src/sim/lifts.ts'
import { passengerIsChild } from '../src/sim/walking.ts'

function fixture(type='tvm') {
 const data=emptyStation();data.lines=[]
 for(let x=-8;x<=8;x++)for(let y=-4;y<=6;y++)data.cells.push({x,y,z:0,fill:'solid',zone:'unpaid'})
 data.modules=[{id:'machine',type,x:2,y:2,z:0,rot:0,w:1,cfg:type==='bench'?{variant:'steel-1'}:{}},
  {id:'out',type:'exit',x:-5,y:0,z:0,rot:0,cfg:{open:true,inRate:0,headHouse:false,name:'Exit'}}]
 return data
}
function visitor(world,id='machine',x=-1,y=1.5) {
 return world.pool.spawn({origin:'',stops:['stop:'+id],dest:'exit:out'},x,y,1,world.tick)
}

test('activity headings and full timelines survive the existing Float32 stream exactly',()=>{
 for(let kind=1;kind<15;kind++)for(const yaw of [-Math.PI,-.5,0,1,Math.PI])for(const time of [0,2.5,ACTIVITY_DURATION[kind]]){
  const packed=packActivity(kind,time,yaw),wire=new Float32Array([packed])[0],decoded=unpackActivity(wire)
  assert.equal(wire,packed);assert.equal(decoded[0],kind)
  assert.ok(Math.abs(decoded[1]-time)<.004)
  assert.ok(Math.abs(Math.atan2(Math.sin(decoded[2]-yaw),Math.cos(decoded[2]-yaw)))<.013)
 }
 assert.equal(packActivity(0,99,1),0)
})

test('machines have a front approach and block routes through their cabinet in all rotations',()=>{
 for(let rot=0;rot<4;rot++){
  const data=fixture();data.modules[0].rot=rot
  const graph=buildGraph(data),stop=graph.stops.find(s=>s.id==='machine')
  assert.ok(stop?.server>=0)
  assert.equal(graph.nodeIndex.has(cellKey(2,2,0)),false)
  assert.ok(Math.hypot(stop.x-2.5,stop.y-2.5)>.5)
  assert.ok(Math.cos(stop.yaw)*(2.5-stop.x)+Math.sin(stop.yaw)*(2.5-stop.y)>.5)
 }
 for(const type of ['shelf','sink','cubicle','door'])assert.equal(isSimInertDecorModule({...fixture(type).modules[0]}),false)
})

test('one customer owns the whole machine dwell, the line advances, and journeys resume',()=>{
 const world=new World(fixture(),54),people=[visitor(world),visitor(world,'machine',-.5,1.5),visitor(world,'machine',0,1.5)]
 const started=new Map(),finished=new Set();let sawLine=false
 for(let t=0;t<180;t++){
  world.tickOnce()
  const customers=world.pool.live.filter(a=>a.activeStop==='machine')
  assert.ok(customers.length<=1,'machine cannot be double booked during the animation')
  for(const a of customers){
   if(!started.has(a.id))started.set(a.id,world.tick)
   assert.equal(a.state,AgentState.Buying)
   assert.equal(a.activity,3)
  }
  const s=world.graph.servers.find(s=>s.stop?.id==='machine')
  if(s.activeCustomer!==undefined&&s.queue.length)sawLine=true
  for(const a of people)if(started.has(a.id)&&!a.activeStop)finished.add(a.id)
 }
 assert.ok(sawLine);assert.equal(started.size,3);assert.equal(finished.size,3)
 assert.ok(world.metrics.exited>=3)
})

test('unreachable optional errands are skipped and deletion releases a current customer',()=>{
 const data=fixture(),world=new World(data,23),a=visitor(world)
 for(let i=0;i<30&&!a.activeStop;i++)world.tickOnce()
 assert.equal(a.activeStop,'machine')
 world.data={...data,modules:data.modules.filter(m=>m.id!=='machine')};world.rebuild()
 assert.equal(a.activeStop,'');assert.equal(a.activity,0)
 for(let i=0;i<35;i++)world.tickOnce()
 assert.ok(a.dead)
 const missing=visitor(world,'missing')
 for(let i=0;i<35;i++)world.tickOnce()
 assert.ok(missing.dead)
 assert.equal(world.metrics.stuck,0)
})

test('a linked bench has independent seats and nearby toilet visits include a sink',()=>{
 const data=fixture('bench');data.modules[0].w=2;data.modules[0].cfg.variant='seat-2'
 const graph=buildGraph(data),seats=graph.stops.filter(s=>s.kind==='bench')
 assert.equal(seats.length,2);assert.notEqual(seats[0].server,seats[1].server)
 assert.equal(Math.abs(seats[0].x-seats[1].x),1)
 const toilet={id:'wc',type:'cubicle',x:1,y:0,z:0,rot:0,cfg:{}}
 const sink={id:'sink',type:'sink',x:2,y:0,z:0,rot:0,cfg:{}}
 data.modules.push(toilet,sink)
 const world=new World(data,1),origin=world.graph.exits[0].node
 let toiletTrips=0,ordinary=0
 for(let i=0;i<2000;i++){
  const trip=world.sampleTripFromStreet(origin)
  if(trip.stops.includes('stop:wc')){toiletTrips++;assert.ok(trip.stops.includes('stop:sink'))}
  if(!trip.stops.length)ordinary++
 }
 assert.ok(toiletTrips>10);assert.ok(ordinary>1200,'most people continue their journey directly')
 const places=activityStopPlaces(sink,data.modules)
 assert.ok(places[0].y>sink.y+.5)
 assert.ok(Math.sin(places[0].yaw)<-.99,'wash from the open basin side')
})

test('seats and restroom fixtures are reached from their front, never used as walk-through shortcuts',()=>{
 for(const type of ['bench','sink','cubicle'])for(let rot=0;rot<4;rot++){
  const d=fixture(type);d.modules[0].rot=rot
  const g=buildGraph(d),node=g.stops.find(s=>s.id==='machine').node
  assert.equal(g.adjStart[node+1]-g.adjStart[node],1,`${type}/${rot} has only a front access edge`)
 }
})

test('a concourse machine is eligible from a street entrance and an unreachable optional floor is skipped',()=>{
 const d=fixture();d.modules[0].z=-5
 for(let x=-3;x<6;x++)for(let y=-2;y<6;y++)d.cells.push({x,y,z:-5,fill:'solid',zone:'unpaid'})
 const w=new World(d,75),origin=w.graph.exits[0].node
 const requests=Array.from({length:200},()=>w.sampleErrands(origin,true,true))
 assert.ok(requests.filter(stops=>stops.includes('stop:machine')).length>20)
 const a=visitor(w)
 for(let i=0;i<40;i++)w.tickOnce()
 assert.ok(a.dead);assert.equal(w.metrics.stuck,0);assert.ok(w.metrics.exited>0)
})

test('public shopping errands never route somebody to an office or a restroom shell',()=>{
 const d=fixture();d.modules.push(...['store','office','toilet'].map((kind,i)=>({id:kind,type:'shop',x:i*3,y:3,z:0,w:2,h:2,cfg:{kind}})))
 const w=new World(d,17),origin=w.graph.exits[0].node
 const errands=Array.from({length:2000},()=>w.sampleErrands(origin,true,true)).flat()
 assert.ok(errands.includes('stop:store'));assert.ok(!errands.includes('stop:office')&&!errands.includes('stop:toilet'))
})

test('render sampling does not consume routing randomness',()=>{
 const a=new World(fixture(),123),b=new World(fixture(),123)
 for(let i=0;i<4;i++){visitor(a);visitor(b)}
 for(let tick=0;tick<100;tick++){
  a.tickOnce();b.tickOnce()
  const before=a.snapshot(),output=new Float32Array(a.pool.count*6)
  a.writeTransfer(output);a.writeTransfer(output)
  assert.deepEqual(a.snapshot(),before,'render sampling never advances simulation')
  assert.deepEqual(a.snapshot(),b.snapshot())
 }
})

test('a walking gate tap adds no dwell and elevator companions do not repeat the first selection',()=>{
 const world=new World(fixture(),8),a=visitor(world)
 const node=world.graph.exits[0].node
 a.path=Int32Array.of(node,node);a.pathIdx=0;a.vx=1
 world.serve(a,{kind:'gate',waitAccum:0,waitCount:0,exitNode:-1,node})
 assert.equal(a.state,AgentState.Walking);assert.equal(a.timer,0)
 assert.ok([5,6].includes(a.activity));assert.equal(a.activityTotal,2)
 const data=fixture();data.modules.push(liftExtendedUp(liftModule({x:4,y:0,z:0},0,'lift'),5))
 for(let x=2;x<8;x++)for(let y=-2;y<4;y++)data.cells.push({x,y,z:5,fill:'solid'})
 const w=new World(data,91),server=w.graph.servers.find(s=>s.kind==='lift'),car=server.lift
 let identity=100;while(passengerIsChild(identity))identity++
 w.pool.nextId=identity
 const riders=Array.from({length:3},()=>visitor(w))
 for(const person of riders){person.liftBoard=car.stops[0];person.liftDest=car.stops.find(n=>w.graph.nodeZ[n]>w.graph.nodeZ[car.stops[0]]);w.joinServer(person,server.id)}
 w.liftExchange(server,car)
 assert.equal(car.riders.length,3)
 assert.equal(riders.filter(p=>p.activity===8).length,1)
 assert.ok(riders.every(p=>p.state===AgentState.Riding))
 assert.equal(server.queue.length,0)
})
