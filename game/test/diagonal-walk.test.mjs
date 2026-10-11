import test from 'node:test'
import assert from 'node:assert/strict'
import {buildGraph,PathFinder} from '../src/sim/station.ts'
import {WALK_SPEED} from '../src/sim/constants.ts'
const needs={stepFree:false,luggage:false}
const floor=(x,y,zone='unpaid',z=4)=>({x,y,z,fill:'solid',zone,finish:{top:'floor.granite'}})
const square=()=>[floor(0,0),floor(1,0),floor(0,1),floor(1,1)]
const graph=(cells,modules=[],zones=false)=>buildGraph({name:'diagonal',seed:1,cells,modules,lines:[]},zones)
const node=(g,x,y,z=4)=>g.nodeIndex.get(`${x},${y},${z}`)
const edge=(g,x,y,nx,ny)=> {
 const a=node(g,x,y),b=node(g,nx,ny)
 if(a===undefined||b===undefined)return -1
 for(let e=g.adjStart[a];e<g.adjStart[a+1];e++)if(g.adjTo[e]===b)return e
 return -1
}

test('open floor routes diagonally with physical distance cost in both directions',()=> {
 const g=graph(square())
 for(const [x,y,nx,ny]of [[0,0,1,1],[1,1,0,0],[1,0,0,1],[0,1,1,0]]) {
  const e=edge(g,x,y,nx,ny)
  assert.ok(e>=0)
  assert.ok(Math.abs(g.adjCost[e]-Math.SQRT2/WALK_SPEED)<1e-6)
 }
 const path=new PathFinder(g).astar(node(g,0,0),node(g,1,1),needs)
 assert.deepEqual(Array.from(path),[node(g,0,0),node(g,1,1)])
 const plate=[]
 for(let x=0;x<6;x++)for(let y=0;y<4;y++)plate.push(floor(x,y))
 const larger=graph(plate)
 const route=new PathFinder(larger).astar(node(larger,0,0),node(larger,5,3),needs)
 assert.equal(route.length,6,'five moves replace the old eight cardinal moves')
})

test('diagonal cost uses the two endpoint finishes rather than assuming granite', () => {
 const cells=square();cells.find(c=>c.x===1&&c.y===1).finish.top='floor.concrete'
 const g=graph(cells), e=edge(g,0,0,1,1)
 assert.ok(e>=0)
 assert.ok(Math.abs(g.adjCost[e]-Math.SQRT2/(WALK_SPEED*0.95))<1e-6, 'one granite and one 0.9-speed concrete endpoint average to 0.95')
})

test('diagonals cannot cut past missing floor, holes, walls or unequal floor heights',()=> {
 for(const side of [[1,0],[0,1]]) {
  const clear=square().filter(c=>c.x!==side[0]||c.y!==side[1])
  for(const additions of [[],[{...floor(...side),fill:'void'}],[floor(...side),floor(...side,'unpaid',5)],[floor(...side,'unpaid',3)]]) {
   const g=graph([...clear,...additions])
   assert.equal(edge(g,0,0,1,1),-1)
   assert.equal(edge(g,1,1,0,0),-1)
  }
 }
})

test('diagonals respect enforced fare barriers even when their endpoints share a zone',()=> {
 const cells=square();cells.find(c=>c.x===1&&c.y===0).zone='paid'
 assert.equal(edge(graph(cells,[],true),0,0,1,1),-1,'cannot cross the paid corner')
 assert.ok(edge(graph(cells),0,0,1,1)>=0,'disabled fare line keeps clear floor open')
 cells.find(c=>c.x===1&&c.y===1).zone='paid'
 assert.equal(edge(graph(cells,[],true),0,0,1,1),-1,'cannot bypass an ungated fare line')
})

test('turnstiles retain cardinal approaches and cannot be skirted diagonally',()=> {
 const cells=[]
 for(let x=0;x<5;x++)for(let y=0;y<5;y++)cells.push(floor(x,y))
 const g=graph(cells,[{id:'gate',type:'gate',x:2,y:2,z:4,cfg:{dir:'both'}}])
 const gate=node(g,2,2)
 assert.ok(gate!==undefined)
 let count=0
 for(let e=g.adjStart[gate];e<g.adjStart[gate+1];e++) {
  const j=g.adjTo[e];count++
  assert.ok(g.nodeX[j]===g.nodeX[gate]||g.nodeY[j]===g.nodeY[gate])
 }
 assert.ok(count>0,'the gate lane remains reachable')
 assert.equal(edge(g,1,1,2,2),-1)
 assert.equal(edge(g,1,2,2,3),-1,'adjacent diagonal cannot skim the gate corner')
})
