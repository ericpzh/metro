import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {ExplodedConnections} from '../src/render/explodedConnections.ts'

const levels=[-10,-5,0],offsets=new Map([[-10,0],[-5,20],[0,40]])
const ramp=(type,id=type)=>({id,type,x:0,y:0,z:-10,from:{x:0,y:0,z:-10},to:{x:10,y:0,z:-5},cfg:type==='stair'?{style:'straight',width:2}:{dir:'up'}})
const shifts=()=>levels.map(()=>new THREE.Vector3())

test('every stair, escalator and elevator receives a dashed light-blue seam guide',()=>{
 const lift={id:'lift',type:'lift',x:4,y:8,z:-10,from:{x:4,y:8,z:-10},to:{x:4,y:8,z:0},cfg:{size:3}}
 const modules=[ramp('stair'),ramp('escalator'),lift],before=structuredClone(modules)
 const guide=new ExplodedConnections(modules,levels,offsets,[0,1],shifts())
 assert.deepEqual(guide.connections.map(c=>c.moduleId),['stair','escalator','lift','lift'])
 assert.deepEqual(modules,before)
 assert.ok(guide.lines.material instanceof THREE.LineDashedMaterial)
 assert.equal(guide.lines.material.color.getHex(),0x8ed8ff)
 const liftPoint=guide.connections[2].point
 assert.deepEqual(liftPoint.toArray(),[5.5,9.5,-5])
 for(const c of guide.connections)assert.equal(levels[c.upper]-levels[c.lower],5)
 guide.dispose()
})

test('guide endpoints follow only their own floors, reuse buffers and restore with reset offsets',()=>{
 const moved=shifts(),guide=new ExplodedConnections([ramp('escalator')],levels,offsets,[0,1],moved)
 const position=guide.lines.geometry.getAttribute('position'),distance=guide.lines.geometry.getAttribute('lineDistance')
 const before=Array.from(position.array)
 moved[0].set(10,30,4);guide.update()
 assert.equal(guide.lines.geometry.getAttribute('position'),position)
 assert.equal(guide.lines.geometry.getAttribute('lineDistance'),distance)
 assert.deepEqual(Array.from(position.array).slice(3),before.slice(3))
 assert.ok(Math.abs(position.getX(0)-before[0]-10)<1e-5)
 assert.ok(Math.abs(position.getY(0)-before[1]-30)<1e-5)
 assert.equal(position.getZ(0),before[2]+4)
 for(const v of moved)v.set(0,0,0);guide.update()
 assert.deepEqual(Array.from(position.array),before)
 const raycaster=new THREE.Raycaster(new THREE.Vector3(0,0,10),new THREE.Vector3(0,0,-1))
 assert.deepEqual(raycaster.intersectObject(guide.lines),[],'guides never intercept selection')
 guide.dispose()
})

test('multi-floor turned stairs use their actual flights; missing trays and flat pieces create no guide',()=>{
 const stair=ramp('stair');stair.to={x:10,y:10,z:0};stair.cfg.flights=[{from:stair.from,to:{x:10,y:0,z:-5}},{from:{x:10,y:0,z:-5},to:stair.to}]
 const guide=new ExplodedConnections([stair],levels,offsets,[1,-1],shifts())
 assert.equal(guide.connections.length,2)
 assert.ok(guide.connections[1].point.y>0)
 const absent=new ExplodedConnections([stair],[0],offsets,[1,1],[new THREE.Vector3()])
 assert.equal(absent.connections.length,0)
 const flat=ramp('escalator');flat.to.z=-10
 const same=new ExplodedConnections([flat],levels,offsets,[1,1],shifts())
 assert.equal(same.connections.length,0)
 guide.dispose();absent.dispose();same.dispose()
})
