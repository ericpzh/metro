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

test('Tanwei tunnel cap cleanup preserves its usable raised decks',()=>{
  const source=JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json',import.meta.url)))
  const result=explodedView(source)
  const oldCap=source.cells.filter(c=>c.z===-5&&c.fill==='solid').length
  assert.ok(result.data.cells.filter(c=>c.z===-5).length<oldCap*.25,'broad tunnel cap is not presented as an empty floor')
  for(const z of [1,6,11]) assert.ok(result.data.cells.filter(c=>c.z===z).length>1000,'usable raised deck remains')
})
