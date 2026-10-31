import test from 'node:test'
import assert from 'node:assert/strict'
import { explodedPassengerSupport,filterExplodedPassengers } from '../src/render/explodedPassengers.ts'
import { explodedView } from '../src/render/explodedView.ts'
import { readFileSync } from 'node:fs'

const data={cells:[{x:2,y:3,z:0,fill:'solid'},{x:2,y:3,z:1,fill:'solid'},{x:2,y:3,z:-10,fill:'solid'}],modules:[],levelBase:0}

test('hidden street pedestrians and unsupported roof walkers are omitted; raised and underground floors stay live',()=>{
  const support=explodedPassengerSupport(data,new Map(),[0,1])
  const poses=new Float32Array([
    2.5,3.5,1,1,0,101,
    2.5,3.5,2,1,0,102,
    20,30,-4,1,0,103,
    2.5,3.5,-9,1,0,104,
    20,30,-9,6,0,105,
  ])
  const count=filterExplodedPassengers(poses,5,support)
  assert.equal(count,3)
  assert.deepEqual([poses[5],poses[11],poses[17]],[102,104,105],'identity and original ordering survive compaction')
})

test('passengers remain supported along authored stairs and inside lift shafts',()=>{
  const support=explodedPassengerSupport({...data,modules:[
    {id:'stair',type:'stair',x:0,y:0,z:-10,from:{x:0,y:0,z:-10},to:{x:8,y:0,z:-5},cfg:{}},
    {id:'lift',type:'lift',x:20,y:20,z:-10,from:{x:20,y:20,z:-10},to:{x:20,y:20,z:-5},cfg:{}},
  ]},new Map([[-10,0],[-5,0]]),[0,1])
  const poses=new Float32Array([4.5,.5,-6.5,1,0,1,20.5,20.5,-6.5,1,0,2])
  assert.equal(filterExplodedPassengers(poses,2,support),2)
})

test('a tunnel roof cap is omitted while its intermediate stair landing remains',()=>{
  const slab=z=>Array.from({length:400},(_,i)=>({x:i%20,y:Math.floor(i/20),z,fill:'solid'}))
  const result=explodedView({cells:[...slab(-10),...slab(-5)],modules:[
    {id:'rail',type:'track',x:0,y:10,z:-10,w:20,d:1,cfg:{tunnel:true}},
    {id:'stairs',type:'stair',x:0,y:0,z:-5,from:{x:0,y:0,z:-5},to:{x:8,y:0,z:0},cfg:{}},
  ],levelBase:0})
  const roof=result.data.cells.filter(c=>c.z===-5)
  assert.ok(roof.length>0&&roof.length<25,'only the small landing area survives')
  assert.equal(result.data.cells.filter(c=>c.z===-10).length,400)
})

test('roof rings and their wall-mounted fittings do not survive as a false mezzanine',()=>{
  const cells=Array.from({length:400},(_,i)=>({x:i%20,y:Math.floor(i/20),z:-5,fill:'solid'}))
  for(let z=-4;z<=-2;z++) cells.push({x:15,y:15,z,fill:'solid',tags:['wall']})
  const result=explodedView({cells,modules:[
    {id:'rail',type:'track',x:0,y:10,z:-10,w:20,d:1,cfg:{tunnel:true}},
    {id:'stairs',type:'stair',x:0,y:0,z:-5,from:{x:0,y:0,z:-5},to:{x:8,y:0,z:0},cfg:{}},
    {id:'hanging',type:'cctv',x:15,y:15,z:-3,cfg:{}},
  ],levelBase:0})
  assert.ok(result.data.cells.length>0,'actual stair landing stays')
  assert.ok(!result.data.cells.some(c=>c.x===15),'roof column outside the landing is removed, even with solid above')
  assert.ok(!result.data.modules.some(m=>m.id==='hanging'),'fitting does not float after its roof ring disappears')
})

for (const base of [0,2]) test(`solid infill above a platform survives roof, ceiling and near-wall cuts (base ${base})`,()=>{
  const cells=[]
  for(let x=0;x<12;x++) for(let y=0;y<10;y++) cells.push({x,y,z:base-20,fill:'solid'})
  // Two five-metre sections of concrete beside the actual open transfer room.
  // The foreground mass has no usable floor/headroom and no room labels.
  const mass=[]
  for(let x=6;x<12;x++) for(let y=0;y<4;y++) for(let z=base-15;z<base-5;z++) {
    if(x===8&&y===2) continue // A real shaft must stay empty.
    mass.push({x,y,z,fill:'solid'})
  }
  cells.push(...mass)
  for(let x=0;x<4;x++) for(let y=5;y<10;y++) {
    cells.push({x,y,z:base-15,fill:'solid'}, {x,y,z:base-11,fill:'solid'},
      {x,y,z:base-10,fill:'solid'}, {x,y,z:base-6,fill:'solid'})
  }
  // A neighbouring exposed tunnel roof still disappears, as do real ceilings.
  cells.push({x:20,y:0,z:base-15,fill:'solid'})
  const source={cells,modules:[
    {id:'rail',type:'track',x:0,y:0,z:base-20,w:12,d:3,cfg:{tunnel:true}},
  ],levelBase:base}
  const before=structuredClone(source),result=explodedView(source),[dx,dy]=result.direction
  const shown=new Set(result.data.cells.map(c=>`${c.x},${c.y},${c.z}`))
  const movedKey=c=>{
    const offset=result.offsets.get(Math.floor((c.z-base)/5)*5+base)
    return `${c.x+dx*offset},${c.y+dy*offset},${c.z}`
  }
  for(const c of mass) assert.ok(shown.has(movedKey(c)),`continuous concrete remains at ${c.x},${c.y},${c.z}`)
  assert.ok(!shown.has(movedKey({x:20,y:0,z:base-15})),'exposed roof is not infill')
  for(const z of [base-11,base-6]) assert.ok(!shown.has(movedKey({x:1,y:6,z})),'room ceiling is removed')
  for(let z=base-15;z<base-5;z++) assert.ok(!shown.has(movedKey({x:8,y:2,z})),'no concrete is invented in the shaft')
  const plans=new Map()
  for(const c of result.data.cells) {
    const band=Math.floor((c.z-base)/5)*5+base,plan=plans.get(band)??new Set()
    plan.add(`${c.x},${c.y}`);plans.set(band,plan)
  }
  const occupied=new Set()
  for(const plan of plans.values()) for(const key of plan) {
    assert.ok(!occupied.has(key),'retained concrete sections do not overlap another tray')
    occupied.add(key)
  }
  assert.deepEqual(source,before,'the presentation leaves the save untouched')
})

test('an unlabelled enclosed transfer room survives at the same height as a tunnel roof',()=>{
  const cells=[]
  for(let x=0;x<20;x++) for(let y=0;y<10;y++) {
    cells.push({x:x<10?x:x+1,y,z:-15,fill:'solid'})
    if(x<10 && !(x===5&&y===5)) cells.push({x,y,z:-11,fill:'solid'})
  }
  const source={cells,modules:[
    {id:'rail',type:'track',x:10,y:0,z:-20,w:10,d:3,cfg:{tunnel:true}},
    {id:'stairs',type:'stair',x:0,y:0,z:-15,from:{x:0,y:0,z:-15},to:{x:0,y:8,z:-10},cfg:{}},
  ],levelBase:0}
  const before=structuredClone(source),result=explodedView(source)
  const offset=result.offsets.get(-15),[dx,dy]=result.direction
  const floors=result.data.cells.filter(c=>c.z===-15)
  assert.equal(floors.length,100,'the full room floor stays; the adjoining exposed roof disappears')
  assert.ok(floors.every(c=>c.x-dx*offset<10))
  assert.ok(!result.data.cells.some(c=>c.z===-11),'the overhead ceiling stays hidden')
  assert.deepEqual(source,before)
})

test('Tanwei tunnel cap cleanup preserves its usable raised decks',()=>{
  const source=JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json',import.meta.url)))
  const result=explodedView(source)
  const oldCap=source.cells.filter(c=>c.z===-5&&c.fill==='solid').length
  assert.ok(result.data.cells.filter(c=>c.z===-5).length<oldCap*.25,'broad tunnel cap is not presented as an empty floor')
  const offset=result.offsets.get(-5),[dx,dy]=result.direction
  assert.ok(!result.data.cells.some(c=>c.z===-5&&c.x===25+dx*offset&&c.y===-9+dy*offset),'covered roof ring outside the actual mezzanine disappears')
  for(const x of [11,16,21]) assert.ok(result.frontWalls.some(c=>c.z===-5&&c.x===x+dx*offset&&c.y===-2+dy*offset),'front wall foundation hides with its upper courses')
  for(const z of [1,6,11]) assert.ok(result.data.cells.filter(c=>c.z===z).length>500,'usable raised deck remains without exterior foundations')
})

test('ground rooms retain floors, furnishings and passengers while outdoor pillars and paving disappear',()=>{
  const source={cells:[
    {x:0,y:0,z:0,fill:'solid'},
    {x:10,y:0,z:0,fill:'solid',zone:'restricted'},
    {x:11,y:0,z:0,fill:'solid',room:'toilet'},
  ],modules:[
    {id:'outdoor',type:'pillar',x:0,y:0,z:0,cfg:{height:11}},
    {id:'indoor',type:'pillar',x:10,y:0,z:0,cfg:{height:3}},
    {id:'sink',type:'sink',x:11,y:0,z:0,cfg:{}},
    {id:'exit',type:'exit',x:2,y:0,z:0,cfg:{}},
  ],levelBase:0}
  const before=structuredClone(source), result=explodedView(source)
  assert.deepEqual(source,before)
  assert.deepEqual(result.data.cells.map(c=>c.x),[10,11])
  assert.deepEqual(result.data.modules.map(m=>m.id),['indoor','sink','exit'])
  const support=explodedPassengerSupport(result.data,result.offsets,result.direction)
  const poses=new Float32Array([.5,.5,1,1,0,1,10.5,.5,1,1,0,2,11.5,.5,1,1,0,3])
  assert.equal(filterExplodedPassengers(poses,3,support),2)
  assert.deepEqual([poses[5],poses[11]],[2,3])
})

test('Tanwei retains authored ground rooms and fixtures without detached bridge piers',()=>{
  const source=JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json',import.meta.url)))
  const result=explodedView(source), offset=result.offsets.get(0),[dx,dy]=result.direction
  const keys=new Set(result.data.cells.map(c=>`${c.x},${c.y},${c.z}`))
  const rooms=source.cells.filter(c=>c.fill==='solid'&&c.z===0&&(c.room||c.zone==='restricted'))
  assert.ok(rooms.length>500,'real room footprint is exercised')
  for(const c of rooms) assert.ok(keys.has(`${c.x+dx*offset},${c.y+dy*offset},0`),'room floor or wall base survives')
  const ids=new Set(result.data.modules.map(m=>m.id))
  for(const m of source.modules.filter(m=>m.type==='pillar'&&m.z===0&&m.cfg.bridgeId)) assert.ok(!ids.has(m.id),'detached bridge pier disappears')
  for(const type of ['cubicle','sink','desk','electrical-cabinet']) {
    const fixtures=source.modules.filter(m=>m.z===0&&m.type===type)
    assert.ok(fixtures.length>0)
    for(const m of fixtures) assert.ok(ids.has(m.id),`${type} remains inside its room`)
  }
})

test('above-ground room footprints exclude connected support beams, remote utility pads and their fittings',()=>{
  const cells=Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),z:6,fill:'solid',zone:'unpaid'}))
  for(let x=5;x<20;x++) cells.push({x,y:2,z:6,fill:'solid'})
  cells.push({x:30,y:30,z:20,fill:'solid'})
  const source={cells,modules:[
    {id:'seat',type:'bench',x:2,y:2,z:6,cfg:{}},
    {id:'remote-ac',type:'ac-unit',x:30,y:30,z:20,cfg:{}},
    {id:'remote-stair',type:'stair',x:18,y:2,z:0,from:{x:18,y:2,z:0},to:{x:18,y:2,z:6},cfg:{}},
    {id:'remote-exit',type:'exit',x:18,y:2,z:0,cfg:{}},
  ],levelBase:0}
  const before=structuredClone(source),result=explodedView(source)
  assert.deepEqual(source,before)
  assert.deepEqual(result.levels,[5],'no extra story for rooftop machinery')
  assert.ok(result.data.cells.every(c=>c.x<=5),'support beam cannot make exterior foundations into a room')
  assert.deepEqual(result.data.modules.map(m=>m.id),['seat'])
  assert.equal(result.data.cells.filter(c=>c.zone==='unpaid').length,25)
})

test('Tanwei has no roomless upper stories or detached exterior access stair',()=>{
  const source=JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json',import.meta.url)))
  const result=explodedView(source),ids=new Set(result.data.modules.map(m=>m.id))
  assert.deepEqual(result.levels,[-10,-5,0,5,10])
  assert.ok(!ids.has('stair-straight-9711'))
  assert.ok(!ids.has('exit-virtual-1108'))
  assert.ok(result.data.cells.every(c=>c.z<15),'roof utility fragments do not get their own trays')
})
