// Reference service counters: envelope, accessible notch, glazing and service apertures.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { moduleEnvelope } from '../src/sim/placement.ts'
import { buildModule } from '../src/render/models.ts'
const EPS = 1e-6
const near = (a, b) => Math.abs(a - b) < EPS
const booth = (kind, w = 4, h = 3, x = 0, y = 0, z = 0) => ({id:'booth',type:'booth',x,y,z,w,h,cfg:{kind}})
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
test('both overhead frames leave the staff bay open and keep printed signs ahead of the fascia',()=>{
  for(const kind of ['info','ticket']) {
    const {boxes,owned}=build(booth(kind))
    assert.ok(!covers(boxes,2,1.5,3.25),'no solid roof across staff bay')
    const signs=boxes.filter(b=>b.mat.name==='booth-service-sign')
    assert.equal(signs.length,2)
    assert.ok(owned.includes(signs[0].mat),'sign material follows module disposal')
    const front=signs.find(b=>near(b.box.min.y,0.004))
    assert.ok(front)
    assert.ok(!covers(boxes.filter(b=>b!==front),2,0.004,3.245),'sign is not buried in header')
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
