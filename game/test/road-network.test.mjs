import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {getRoadNetwork,roadEdgePoint,roadSignal,roadLaneSign,roadEdgeMovements} from '../src/sim/roadNetwork.ts'
import {roadLaneMovements,roadDriverLaneOrder} from '../src/sim/roadLaneMovements.ts'
import {roadLayout,roadPoint} from '../src/sim/roads.ts'
import {roadArrowMarking} from '../src/render/models/pieces/RoadArrowMarking.ts'
import {RoadTraffic} from '../src/sim/roadTraffic.ts'
import {ROAD_TRAFFIC_CAPACITY,ROAD_FOLLOW_GAP} from '../src/sim/constants.ts'
import {TrafficLightModel} from '../src/render/models/pieces/TrafficLightModel.ts'
import {RoadModel} from '../src/render/models/pieces/RoadModel.ts'
import {createModule,addEquipment,toState} from '../src/build/model.ts'
import {emptyStation} from '../src/data/reference-station.ts'
import {serialize,parse} from '../src/persistence/save.ts'
import {equipmentReason} from '../src/sim/placement.ts'
const a={id:'a',type:'road',x:0,y:-40,z:0,rot:0,w:6,d:86,cfg:{direction:'two-way'}}
const b={...a,id:'b',x:-40,y:0,w:86,d:6,rot:1}

test('crossroads derive directed lanes, continuous turn connectors and boundary-only entries',()=>{
  const n=getRoadNetwork([a,b])
  assert.equal(n.junctions.length,1);assert.equal(n.entries.length,4)
  const turns=n.edges.filter(e=>e.control)
  assert.equal(turns.length,8)
  for(const e of n.edges) for(const next of e.next) assert.deepEqual(e.end,n.edges[next].start)
  for(const e of turns) {
    const p=roadEdgePoint(e,.5)
    assert.ok(p[0]>=0&&p[0]<=6&&p[1]>=0&&p[1]<=6)
    assert.equal(e.next.length,1)
  }
  const t=getRoadNetwork([a,{...b,w:46}])
  assert.equal(t.entries.length,3)
  const halfT=getRoadNetwork([a,{...b,w:43}])
  assert.equal(halfT.entries.length,3)
  const entry=halfT.edges[halfT.entries.find(i=>halfT.edges[i].road.id==='b')]
  assert.equal(entry.next.length,2,'a T ending at the centre can turn into either receiving direction')
  assert.equal(getRoadNetwork([a,{...b,z:4}]).junctions.length,0)
  const clustered=getRoadNetwork([a,b,{...b,id:'c',y:5}])
  assert.equal(clustered.junctions.length,1,'touching crossing rectangles share one reservation and signal phase')
  for(const e of clustered.edges)for(const next of e.next)assert.deepEqual(e.end,clustered.edges[next].start)
  const one=getRoadNetwork([{...a,cfg:{direction:'one-way'}},b])
  assert.ok(one.edges.filter(e=>e.road.id==='a').every(e=>e.sign===1))
})

test('topology cache does no work on repeated reads; parallel seams and duplicate paving share one queue',()=>{
  let scans=0
  const modules=new Proxy([a,b],{get(target,key,receiver){if(key==='filter')scans++;return Reflect.get(target,key,receiver)}})
  const n=getRoadNetwork(modules)
  for(let i=0;i<1000;i++)assert.equal(getRoadNetwork(modules),n)
  assert.equal(scans,1,'no document filtering or pair search per frame')
  assert.equal(getRoadNetwork([...modules]),n,'decor edits preserve traffic topology and live cars')
  getRoadNetwork([{...a,id:'thumbnail'}])
  assert.equal(getRoadNetwork([...modules]),n,'a palette thumbnail cannot evict the live topology')
  assert.notEqual(getRoadNetwork([a,{...b,w:90}]),n)
  const joined=getRoadNetwork([{...a,d:40},{...a,id:'extension',y:0,d:46},a])
  assert.equal(joined.edges.length,2);assert.equal(joined.entries.length,2)
  assert.ok(joined.edges.every(e=>e.length===86))
  for(let i=0;i<9;i++)getRoadNetwork([{...a,id:`cache-${i}`}])
  assert.notEqual(getRoadNetwork([...modules]),n,'strong topology history is bounded and evicts old entries')
  assert.equal(getRoadNetwork(modules),n,'immutable document caches retain their own live topology')
})

test('signals never release conflicting axes, retain amber and all-red clearance',()=>{
  const j=getRoadNetwork([a,b]).junctions[0],seen=new Set()
  for(let time=0;time<80;time+=.1) {
    const x=roadSignal(j,true,time),y=roadSignal(j,false,time)
    assert.ok(x==='red'||y==='red');seen.add(x);seen.add(y)
  }
  assert.deepEqual(seen,new Set(['red','amber','green']))
})

test('seeded network traffic turns, queues without overlap, reserves each junction and stays bounded',()=>{
  const n=getRoadNetwork([a,b]),traffic=new RoadTraffic(n,42),other=new RoadTraffic(n,42)
  let turns=0,waits=0
  traffic.advance(0);other.advance(0)
  for(let tick=1;tick<=2400;tick++) {
    const old=new Map(traffic.cars.map(c=>[c.id,[c.edge,c.distance]]))
    traffic.advance(tick/10);other.advance(tick/10)
    assert.deepEqual(traffic.cars,other.cars)
    assert.ok(traffic.cars.length<=ROAD_TRAFFIC_CAPACITY)
    const junctionCars=traffic.cars.filter(c=>n.edges[c.edge].junction>=0)
    assert.ok(junctionCars.length<=1,'conflicting turns never share the crossing')
    turns+=junctionCars.filter(c=>n.edges[c.edge].control).length
    for(const c of traffic.cars) {
      const before=old.get(c.id)
      if(before&&before[0]===c.edge&&before[1]===c.distance)waits++
    }
    for(let edge=0;edge<n.edges.length;edge++) {
      const cars=traffic.cars.filter(c=>c.edge===edge).sort((x,y)=>x.distance-y.distance)
      for(let i=1;i<cars.length;i++) assert.ok(cars[i].distance-cars[i-1].distance>=(cars[i].size+cars[i-1].size)/2+ROAD_FOLLOW_GAP-1e-6,'same-lane bodies retain a following gap')
    }
  }
  assert.ok(turns>0);assert.ok(waits>0)
  const paused=structuredClone(traffic.cars);traffic.advance(240);assert.deepEqual(traffic.cars,paused)
  traffic.advance(1000000);assert.ok(traffic.cars.length<=ROAD_TRAFFIC_CAPACITY)
  traffic.advance(0);other.advance(0);assert.deepEqual(traffic.cars,other.cars)
  const saturated=new RoadTraffic(getRoadNetwork([{...a,w:120,d:2000}]),42)
  saturated.advance(0);assert.equal(saturated.cars.length,ROAD_TRAFFIC_CAPACITY,'a large road cannot grow instance or simulation work beyond 192 cars')
  saturated.advance(1);assert.ok(saturated.cars.length<=ROAD_TRAFFIC_CAPACITY)
})

test('road junctions generate roadside poles and zebra ink; traffic-light decor places, saves and picks',()=>{
  const white=new THREE.MeshStandardMaterial({color:'white'}),darkSteel=new THREE.MeshStandardMaterial(),steel=darkSteel,black=darkSteel,ledGreen=darkSteel
  const mats={white,darkSteel,steel,black,ledGreen},owned=[]
  const ctx={data:{modules:[a,b]},mats,owned}
  const g=new RoadModel(ctx).build(a)
  assert.equal(g.userData.roadSignals.length,2)
  assert.ok(g.children.some(o=>o.name==='road-crosswalk'))
  for(const light of g.children.filter(o=>o.name==='road-traffic-light')) assert.ok(light.position.x<0||light.position.x>6,'pole stands beside pavement')
  const mod=createModule('traffic-light',10,10,0,'light')
  assert.equal(equipmentReason([],[],mod),'')
  const model=new TrafficLightModel(ctx).build(mod),box=new THREE.Box3().setFromObject(model)
  assert.ok(box.max.z-box.min.z>=3.45&&box.max.z-box.min.z<=3.51)
  const state=addEquipment(toState(emptyStation()),mod),saved=parse(serialize(state))
  assert.ok(saved.ok);assert.equal(saved.state.modules[0].type,'traffic-light')
  for(const root of [g,model])root.traverse(o=>o.geometry?.dispose())
  for(const m of new Set([...Object.values(mats),...owned]))m.dispose()
})

test('generated signal lenses face every incoming approach in all four road rotations',()=>{
  const darkSteel=new THREE.MeshStandardMaterial(),white=new THREE.MeshStandardMaterial()
  const mats={white,darkSteel,steel:darkSteel,black:darkSteel,ledGreen:darkSteel},owned=[]
  for(let rot=0;rot<4;rot++) {
    const vertical=rot%2===0
    const main={...a,id:'main',rot,x:vertical?0:-40,y:vertical?-40:0,w:vertical?6:86,d:vertical?86:6}
    const cross={...b,id:'cross',rot:vertical?1:0,x:vertical?-40:0,y:vertical?0:-40,w:vertical?86:6,d:vertical?6:86}
    const modules=[main,cross],network=getRoadNetwork(modules),expected=[]
    const seen=new Set()
    for(const edge of network.edges) {
      if(edge.junction>=0)continue
      const connector=edge.next.map(i=>network.edges[i]).find(next=>next.junction>=0)
      if(!connector)continue
      const key=`${connector.junction}:${edge.axis}:${edge.sign}`
      if(seen.has(key))continue
      seen.add(key)
      expected.push(edge.axis?new THREE.Vector3(0,-edge.sign,0):new THREE.Vector3(-edge.sign,0,0))
    }
    const actual=modules.flatMap(road=>new RoadModel({data:{modules},mats,owned}).build(road).children
      .filter(o=>o.name==='road-traffic-light')
      .map(light=>new THREE.Vector3(0,-1,0).applyQuaternion(light.quaternion)))
    assert.equal(actual.length,expected.length,`rotation ${rot}: one signal per incoming approach`)
    const remaining=[...actual]
    for(const direction of expected) {
      const index=remaining.findIndex(v=>v.distanceTo(direction)<1e-6)
      assert.notEqual(index,-1,`rotation ${rot}: signal faces ${direction.toArray()}`)
      remaining.splice(index,1)
    }
  }
  for(const m of new Set([white,darkSteel,...owned]))m.dispose()
})

test('a bus spanning short road links retains and releases every junction reservation',()=>{
  const n=getRoadNetwork([a,b,{...b,id:'nearby-crossing',y:12}]),traffic=new RoadTraffic(n,42)
  traffic.advance(0)
  for(let tick=1;tick<1800;tick++) {
    traffic.advance(tick/10)
    for(const [junction,id] of traffic.locks) {
      const owner=traffic.cars.find(c=>c.id===id)
      assert.ok(owner&&(owner.held===junction||owner.tails.some(t=>t.junction===junction)), 'no orphaned lock when the front enters another junction before the tail clears')
    }
  }
})

test('two-way lanes keep right-hand traffic at all four rotations; one-way half turns reverse',()=>{
  for(let rot=0;rot<4;rot++) {
    const r={...a,rot,w:rot%2?86:12,d:rot%2?12:86},layout=roadLayout(r)
    const centre=roadPoint(r,layout.width/2,layout.length/2)
    for(let lane=0;lane<layout.lanes;lane++) {
      const sign=roadLaneSign(r,lane),p=roadPoint(r,(lane+.5)*layout.laneWidth,layout.length/2)
      const right=layout.acrossX?[sign,0]:[0,-sign]
      assert.ok((p[0]-centre[0])*right[0]+(p[1]-centre[1])*right[1]>0,'each driver occupies the right half of the yellow centreline')
    }
    const one={...r,cfg:{direction:'one-way'}}
    assert.equal(roadLaneSign(one,0),rot>=2?-1:1)
  }
  assert.equal(getRoadNetwork([{...a,d:40,rot:0},{...a,id:'half-turn',y:0,d:46,rot:2}]).edges.length,2,'opposite drawing rotations share a continuous two-way road')
})

test('lane permissions give outer lanes turns, all lanes straight, and share odd T middle lanes',()=>{
  const all=['left','straight','right']
  assert.deepEqual(roadLaneMovements(0,1,all),all)
  assert.deepEqual(roadLaneMovements(0,3,all),['left','straight'])
  assert.deepEqual(roadLaneMovements(1,3,all),['straight'])
  assert.deepEqual(roadLaneMovements(2,3,all),['straight','right'])
  for(let index=0;index<4;index++) assert.deepEqual(roadLaneMovements(index,4,['left','right']),index<2?['left']:['right'])
  assert.deepEqual(roadLaneMovements(1,3,['left','right']),['left','right'])
  for(let index=0;index<3;index++)assert.deepEqual(roadLaneMovements(index,3,['right']),['right'])
})

test('the actual crossing and T connectors enforce the arrows for every incoming lane',()=>{
  for(let rot=0;rot<4;rot++) for(const t of [false,true]) {
    const axis=rot%2===0
    const main={...a,id:'main',rot,x:axis?0:-40,y:axis?-40:0,w:axis?18:(t?40:86),d:axis?(t?40:86):18}
    // A T stem terminates at the near edge of the cross street, with overlap.
    if(t) {if(axis)main.d=49;else main.w=49}
    const cross={...a,id:'cross',rot:axis?1:0,x:axis?-40:0,y:axis?0:-40,w:axis?98:18,d:axis?18:98}
    const network=getRoadNetwork([main,cross])
    const approach=network.edges.filter(e=>e.junction<0&&e.road.id==='main'&&e.sign===1&&e.next.some(n=>network.edges[n].junction>=0))
      .sort((l,r)=>(l.lane-r.lane)*roadDriverLaneOrder(axis,1))
    assert.equal(approach.length,3)
    for(let i=0;i<3;i++) {
      const expected=t?(i===0?['left']:i===1?['left','right']:['right']):(i===0?['left','straight']:i===1?['straight']:['right','straight'])
      assert.deepEqual([...roadEdgeMovements(network,approach[i])].sort(),[...expected].sort())
    }
  }
})

test('preview arrows show each lane direction without rebuilding topology; stop lines cover incoming halves only',()=>{
  const white=new THREE.MeshStandardMaterial({color:'white'}),darkSteel=new THREE.MeshStandardMaterial(),mats={white,darkSteel,steel:darkSteel,black:darkSteel,ledGreen:darkSteel},owned=[]
  for(let rot=0;rot<4;rot++) {
    const axis=rot%2===0,r={...a,id:'main',rot,x:axis?0:-40,y:axis?-40:0,w:axis?12:86,d:axis?86:12}
    const cross={...b,id:'cross',rot:axis?1:0,x:axis?-40:0,y:axis?0:-40,w:axis?86:6,d:axis?6:86}
    const modules=[r,cross]
    const model=new RoadModel({data:{modules},mats,owned}).build(r)
    assert.equal(model.userData.roadStopLines.length,2)
    for(const stop of model.userData.roadStopLines) {
      assert.equal(stop.width,6,'each stop line spans two incoming 3 m lanes')
      const offset=stop.across-(axis?r.x:r.y)
      assert.equal(offset,axis?(stop.sign>0?9:3):(stop.sign>0?3:9))
    }
    assert.equal(model.userData.roadArrows.length,4)
    for(const arrow of model.userData.roadArrows)assert.ok(arrow.turns.includes('straight'))
    const noTopology=new Proxy(modules,{get(target,key,receiver){if(key==='filter')throw Error('preview must not prepare topology');return Reflect.get(target,key,receiver)}})
    const preview=new RoadModel({data:{modules:noTopology},mats,owned,preview:true}).build(r)
    assert.equal(preview.userData.roadArrows.length,4)
    for(const arrow of preview.userData.roadArrows)assert.equal(arrow.sign,roadLaneSign(r,arrow.lane))
    for(const root of [model,preview])root.traverse(o=>o.geometry?.dispose())
  }
  const arrow=roadArrowMarking(white,['left','straight','right'],0,0,0,true,1)
  arrow.geometry.computeBoundingBox()
  assert.ok(arrow.geometry.boundingBox.min.x<-1&&arrow.geometry.boundingBox.max.x>1)
  assert.ok(arrow.geometry.boundingBox.max.y>=1.49)
  const normals=arrow.geometry.getAttribute('normal')
  for(let i=0;i<normals.count;i++)assert.ok(normals.getZ(i)>.99,'paint faces upward on every branch')
  arrow.geometry.dispose()
  for(const material of new Set([white,darkSteel,...owned]))material.dispose()
})
