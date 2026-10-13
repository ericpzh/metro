// Reference service counters: envelope, accessible notch, glazing and service apertures.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { equipmentReason, moduleEnvelope } from '../src/sim/placement.ts'
import { buildModule } from '../src/render/models.ts'
const EPS = 1e-6
const near = (a, b) => Math.abs(a - b) < EPS
const booth = (kind, w = 4, h = 3, x = 0, y = 0, z = 0, front = 0) => ({id:'booth',type:'booth',x,y,z,w,h,cfg:{kind,front}})
function build(mod) {
  const mats = new Proxy({}, {get:(t,k)=>(t[k]??=new THREE.MeshStandardMaterial({name:String(k)}))})
  const owned = []
  const group = buildModule(mod,{mats,data:{name:'t',cells:[],modules:[],lines:[]},trackCells:new Set(),finish:()=>mats.steel,owned})
  group.updateMatrixWorld(true)
  const boxes = []
  group.traverse(o=>{if(o.isMesh)boxes.push({mesh:o,mat:o.material,box:new THREE.Box3().setFromObject(o)})})
  return {mats,group,boxes,owned}
}
const covers = (boxes,x,y,z) => boxes.some(({box:b})=>x>=b.min.x-EPS&&x<=b.max.x+EPS&&y>=b.min.y-EPS&&y<=b.max.y+EPS&&z>=b.min.z-EPS&&z<=b.max.z+EPS)

test('both counters and their overhead frames stay within the reserved cells and height',()=>{
  for(const kind of ['ticket','info'])for(const [w,h] of [[3,3],[4,4],[5,3],[3,6],[6,4]]) {
    const mod=booth(kind,w,h,-5,7,-4)
    const {boxes}=build(mod)
    const e=moduleEnvelope(mod)
    const union=new THREE.Box3()
    for(const {box:b,mat} of boxes) {
      assert.ok(b.min.x>=e.x0-EPS&&b.max.x<=e.x1+EPS,`${kind} ${mat.name} x`)
      assert.ok(b.min.y>=e.y0-EPS&&b.max.y<=e.y1+EPS,`${kind} ${mat.name} y`)
      assert.ok(b.min.z>=e.z0-EPS&&b.max.z<=e.z1+EPS,`${kind} ${mat.name} z`)
      union.union(b)
    }
    assert.ok(near(union.min.x,e.x0)&&near(union.max.x,e.x1))
    assert.ok(near(union.min.y,e.y0)&&near(union.max.y,e.y1))
  }
})
test('information counter has a lowered central surface with open space above it',()=>{
  const {group,mats,boxes}=build(booth('info'))
  assert.equal(boxes.filter(b=>b.mat===mats.glass).length,0)
  const ray=new THREE.Raycaster(new THREE.Vector3(2,0.25,3),new THREE.Vector3(0,0,-1))
  const hit=ray.intersectObjects(group.children,true)[0]
  assert.ok(hit)
  assert.ok(near(hit.point.z,1.8),'accessible counter is 0.80 m above the floor')
  const shoulder=new THREE.Raycaster(new THREE.Vector3(0.8,0.25,3),new THREE.Vector3(0,0,-1)).intersectObjects(group.children,true)[0]
  assert.ok(near(shoulder.point.z,2.1),'shoulder remains 1.10 m above floor')
})
test('ticket glass encloses the sides and leaves a real transfer aperture at each service bay',()=>{
  const {boxes,mats}=build(booth('ticket'))
  const screens=boxes.filter(b=>b.mat===mats.glass)
  assert.ok(covers(screens,0.04,1.5,2.5),'west pane')
  assert.ok(covers(screens,3.96,1.5,2.5),'east pane')
  assert.ok(covers(screens,2,2.96,2.5),'back pane')
  for(const x of [1.04,2.96]) {
    assert.ok(covers(screens,x,0.04,2.5),'front service glazing')
    assert.ok(!covers(boxes,x,0.04,2.12),'clear gap above the countertop')
  }
})
test('both overhead frames leave the staff bay open with no built-in banner',()=>{
  for(const kind of ['info','ticket']) {
    const {boxes,owned}=build(booth(kind))
    assert.ok(!covers(boxes,2,1.5,3.25),'no solid roof across staff bay')
    const signs=boxes.filter(b=>b.mat.name==='booth-service-sign')
    assert.equal(signs.length,0,'the player supplies an editable sign')
    assert.equal(owned.length,0,'no hard-coded banner texture is allocated')
  }
})
test('an editable customer-service sign can hang inside either booth type',()=>{
  for(const kind of ['info','ticket']) {
    const mod=booth(kind)
    const sign={id:'service-sign',type:'sign',x:1,y:1,z:0,rot:0,cfg:{mount:'ceiling',front:[
      {id:'service',kind:'icon',icon:'customer-service',x:0.3,y:0.2,scale:1,side:'both'},
    ],back:[]}}
    assert.equal(equipmentReason([{x:1,y:1,z:4,fill:'solid'}],[mod],sign),'',kind)
  }
})
test('counter geometry follows translated room coordinates',()=>{
  for(const kind of ['info','ticket']) {
    const a=build(booth(kind)).boxes
    const b=build(booth(kind,4,3,11,-8,-4)).boxes
    assert.equal(a.length,b.length)
    for(let i=0;i<a.length;i++)for(const axis of ['min','max']) {
      const expected=a[i].box[axis].clone().add(new THREE.Vector3(11,-8,-4))
      assert.ok(expected.distanceTo(b[i].box[axis])<EPS)
    }
  }
})

test('counter desktops face the selected front and stay inside a rectangular footprint',()=>{
  const w=5,h=4,x=-3,y=7,z=-2
  const centerX=x+w/2,centerY=y+h/2
  for(const kind of ['ticket','info'])for(const front of [0,1,2,3]) {
    const mod=booth(kind,w,h,x,y,z,front)
    const {boxes,mats}=build(mod)
    const desktop=boxes.filter(({mat})=>mat===mats.black)
    assert.ok(desktop.length>0,`${kind} keeps its desktop screens`)
    const point=desktop.reduce((sum,{box})=>sum.add(box.getCenter(new THREE.Vector3())),new THREE.Vector3()).multiplyScalar(1/desktop.length)
    const edgeDistance=front===0?Math.abs(point.y-y):front===1?Math.abs(point.x-(x+w)):front===2?Math.abs(point.y-(y+h)):Math.abs(point.x-x)
    assert.ok(edgeDistance<0.6,`${kind} desktop faces front ${front} (distance ${edgeDistance})`)
    const bounds=new THREE.Box3()
    for(const {box} of boxes)bounds.union(box)
    assert.ok(bounds.min.x>=x-EPS&&bounds.max.x<=x+w+EPS,`${kind} front ${front} fits x`)
    assert.ok(bounds.min.y>=y-EPS&&bounds.max.y<=y+h+EPS,`${kind} front ${front} fits y`)
  }
})

test('information header trim and fascia never overlap in volume', () => {
  const { boxes, mats } = build(booth('info'))
  const header = boxes.filter(({ box, mat }) =>
    box.min.z > 3 && [mats.white, mats.darkSteel, mats.gateRed, mats.headlight].includes(mat))
  for (let i = 0; i < header.length; i++) {
    for (let j = i + 1; j < header.length; j++) {
      const a = header[i].box, b = header[j].box
      const overlap = ['x', 'y', 'z'].map(axis =>
        Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]))
      assert.ok(overlap.some(span => span <= EPS),
        `${header[i].mat.name} and ${header[j].mat.name} share header volume`)
    }
  }
})
