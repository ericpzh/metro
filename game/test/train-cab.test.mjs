import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as D_PROFILE from '../src/render/models/pieces/DTrainShell.ts'
import { carShellAt, curveCarDoor } from '../src/render/models/pieces/CarShellProfile.ts'
import { cabSkinGeometry } from '../src/render/models/pieces/CabSkin.ts'
import { cabShellGeometry } from '../src/render/models/pieces/TrainShell.ts'
import { buildCab } from '../src/render/models/pieces/CabModel.ts'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject, setDoorsSides } from '../src/render/models.ts'
import { STOCK, STOCK_CLASSES } from '../src/sim/stock.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
function withKit(run) {
  const previous = globalThis.document
  globalThis.document = {createElement(){const c={width:0,height:0};const {g}=stubCanvas();g.canvas=c;c.getContext=()=>g;return c}}
  const mats=createModelMaterials()
  try {run(mats)} finally {disposeModelMaterials(mats);globalThis.document=previous}
}

test('curved door geometry caches exact inputs with independent disposable outputs and bounded eviction',()=>{
  const original=THREE.MathUtils.lerp,material=new THREE.MeshBasicMaterial(),meshes=[]
  let interpolations=0
  THREE.MathUtils.lerp=(...args)=>{interpolations++;return original(...args)}
  const make=(z=1.12345)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.63,.031,1.91),material)
    mesh.position.z=z;curveCarDoor(mesh,2.812345,1);meshes.push(mesh);return mesh
  }
  try{
    const cold=make();assert.ok(interpolations>0)
    interpolations=0
    const warm=make();assert.equal(interpolations,0,'a repeated part performs no curve interpolation')
    assert.notEqual(cold.geometry,warm.geometry)
    assert.deepEqual(cold.geometry.attributes.position.array,warm.geometry.attributes.position.array)
    const wanted=warm.geometry.attributes.position.array.slice()
    cold.geometry.attributes.position.array.fill(0);cold.geometry.dispose()
    assert.deepEqual(warm.geometry.attributes.position.array,wanted,'editing or disposing another consist cannot damage its geometry')
    for(let i=0;i<70;i++)make(1.12345+i*.001)
    interpolations=0;make();assert.ok(interpolations>0,'old inputs leave the bounded cache')
  }finally{THREE.MathUtils.lerp=original;for(const mesh of meshes)disposeObject(mesh);material.dispose()}
})

test('D Low windshield stays above the coarse crown and solid rubber surround',()=>withKit(mats=>{
 const root=buildTrain(mats,{x:0,y:0,z:0,stock:'D',cars:1,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
 const originals=[]
 try {
  root.traverse(p=>{if(p.isMesh&&p.userData.lowDetailGeometry){originals.push([p,p.geometry]);p.geometry=p.userData.lowDetailGeometry}})
  root.updateMatrixWorld(true)
  for(const cab of root.children.filter(p=>p.name==='streamlined-cab')) {
   const glass=cab.getObjectByName('d-cab-windscreen'),positions=glass.geometry.attributes.position
   for(const row of [4,8,12])for(const column of [4,9,14]) {
    const first=(row*18+column)*6,index=glass.geometry.index
    const p=new THREE.Vector3()
    for(let i=0;i<3;i++)p.add(new THREE.Vector3().fromBufferAttribute(positions,index.getX(first+i)))
    p.multiplyScalar(1/3)
    const origin=cab.localToWorld(p.clone().add(new THREE.Vector3(3,0,0)))
    const direction=new THREE.Vector3(-1,0,0).transformDirection(cab.matrixWorld)
    const hit=new THREE.Raycaster(origin,direction).intersectObject(cab)[0]
    assert.equal(hit?.object?.name,glass.name,`Low windshield sample ${row},${column} is unobstructed`)
   }
  }
 } finally {for(const [mesh,geometry]of originals)mesh.geometry=geometry;disposeObject(root)}
}))
test('A/B/C/L fronts rake inward at the roof while their square rear seams and couplers stay fixed',()=>withKit(mats=>{
 for(const cls of ['A','B','C','L']) for(const outward of [-1,1]) {
  const root=new THREE.Group();buildCab(root,mats,STOCK[cls],0,outward,true);root.updateMatrixWorld(true)
  try {
   const ray=z=>new THREE.Raycaster(new THREE.Vector3(outward*4,-.4,z),new THREE.Vector3(-outward,0,0)).intersectObjects(root.children)[0]
   const high=ray(2.6), low=ray(1.8)
   assert.ok(high&&low)
   assert.ok(outward*(low.point.x-high.point.x)>.10,`${cls} upper front is recessed from lower front`)
   const shell=root.getObjectByName('cab-shell'), p=shell.geometry.attributes.position
   let seam=0
   for(let i=0;i<p.count;i++) {
    const v=shell.localToWorld(new THREE.Vector3().fromBufferAttribute(p,i))
    if(Math.abs(outward*v.x+2)<1e-5)seam++
   }
   assert.ok(seam>20,'rear cut remains at the body seam')
   const mark=root.getObjectByName(`${cls.toLowerCase()}-cab-mark`), box=new THREE.Box3().setFromObject(mark)
   assert.equal(mark.position.y,0)
   assert.ok(box.max.y-box.min.y<=.241&&box.max.z-box.min.z<=.281)
   const coupler=root.children.find(p=>p.geometry?.type==='ConeGeometry')
   assert.equal(coupler.position.x,outward*.79)
   if(cls==='C') {
    const door=new THREE.Box3().setFromObject(root.getObjectByName('c-cab-front-door-frame'))
    assert.ok(door.max.y<box.min.y||door.min.y>box.max.y,'door clears centered logo')
    assert.ok(door.max.y-door.min.y<.70)
   } else for(const side of [-1,1]) {
    const prefix=cls.toLowerCase(), find=name=>root.children.find(p=>p.name===`${prefix}-${name}`&&Math.sign(p.position.y)===side)
    const door=new THREE.Box3().setFromObject(find('crew-door-frame'))
    const glass=new THREE.Box3().setFromObject(find('cab-side-window'))
    assert.ok(door.max.z-door.min.z>1.79)
    assert.ok(glass.min.x>=door.min.x&&glass.max.x<=door.max.x)
    assert.ok(glass.min.z>door.min.z&&glass.max.z<door.max.z)
    assert.ok(find('crew-door-handle')&&find('crew-door-sill'))
   }
  }finally{disposeObject(root)}
 }
}))
test('Beijing lettering is 50% larger and vertically centred on both headlight pairs',()=>withKit(mats=>{
 assert.ok(mats.trainMark.alphaTest>0 && mats.trainMark.alphaTest<.1,'empty atlas pixels discard before depth writes while preserving antialiased lettering')
 for(const cls of ['A','B','C','L'])for(const outward of [-1,1]){
  const root=new THREE.Group();buildCab(root,mats,STOCK[cls],0,outward,true);root.updateMatrixWorld(true)
  try {
   const standard=root.getObjectByName(`${cls.toLowerCase()}-cab-mark`),beijing=root.getObjectByName(`${cls.toLowerCase()}-beijing-cab-mark`)
   const a=new THREE.Box3().setFromObject(standard),b=new THREE.Box3().setFromObject(beijing)
   assert.ok(Math.abs((b.max.y-b.min.y)/(a.max.y-a.min.y)-1.5)<1e-6)
   assert.ok(Math.abs((b.max.z-b.min.z)/(a.max.z-a.min.z)-1.5)<1e-6)
   const lamps=root.children.filter(m=>m.name==='cab-round-light')
   const centre=lamps.reduce((sum,m)=>sum+new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).z,0)/lamps.length
   assert.ok(Math.abs(b.getCenter(new THREE.Vector3()).z-centre)<1e-6)
   const chengdu=root.getObjectByName(`${cls.toLowerCase()}-chengdu-cab-mark`)
   for(const [mesh,lo,hi] of [[standard,0,1/3],[beijing,1/3,2/3],[chengdu,2/3,1]]) {
    const uv=mesh.geometry.attributes.uv
    for(let i=0;i<uv.count;i++)assert.ok(uv.getX(i)>=lo-1e-7&&uv.getX(i)<=hi+1e-7,'each footprint samples its own city artwork')
   }
  }finally{disposeObject(root)}
 }
}))

for(const city of ['chengdu','chongqing'])test(`${city} logos sit over the coloured strip on A/B/C/L at both ends and both detail levels`,()=>withKit(mats=>{
 for(const cls of ['A','B','C','L'])for(const outward of [-1,1]) {
  const root=new THREE.Group();buildCab(root,mats,STOCK[cls],0,outward,true,mats.trainTrim,city==='chongqing'?mats.trainMark:undefined);root.updateMatrixWorld(true)
  try {
   const mark=root.getObjectByName(`${cls.toLowerCase()}-${city}-cab-mark`)
   const paint=root.children.filter(m=>['cab-shell','cab-face-paint','cab-livery-paint'].includes(m.name)),original=paint.map(m=>m.geometry)
   assert.ok(Math.abs(new THREE.Box3().setFromObject(mark).getCenter(new THREE.Vector3()).z-.99)<1e-6)
   for(const low of [false,true]) {
    paint.forEach((m,i)=>m.geometry=low?m.userData.lowDetailGeometry:original[i])
    for(const y of [-.12,0,.12])for(const z of [.95,1.03]) {
     const hit=new THREE.Raycaster(new THREE.Vector3(outward*4,y,z),new THREE.Vector3(-outward,0,0)).intersectObjects(paint)[0]
     assert.equal(hit?.object.name,'cab-livery-paint',`${cls} ${outward} ${low?'Low':'High'}: lettering has coloured paint behind it`)
    }
   }
   paint.forEach((m,i)=>m.geometry=original[i])
  }finally{disposeObject(root)}
 }
}))

for(const city of ['chengdu','chongqing'])test(`D ${city} logos follow the coloured livery ring at both ends and both detail levels`,()=>withKit(mats=>{
 const root=buildTrain(mats,{x:0,y:0,z:0,cars:1,stock:'D',doorsOpen:false,colour:'#a4343a',dirSign:1,yaw:0})
 root.updateMatrixWorld(true)
 try {
  const marks=[];root.traverse(m=>{if(m.name===`d-${city}-cab-mark`)marks.push(m)})
  assert.equal(marks.length,2)
  for(const mark of marks) {
   const paint=mark.parent.children.filter(m=>['d-cab-livery','d-cab-mask','d-cab-gold-trim'].includes(m.name)),original=paint.map(m=>m.geometry),originalMark=mark.geometry
   for(const low of [false,true]) {
    paint.forEach((m,i)=>m.geometry=low?m.userData.lowDetailGeometry:original[i])
    mark.geometry=low?mark.userData.lowDetailGeometry:originalMark
    mark.geometry.computeBoundingBox();const point=city==='chongqing'?new THREE.Vector3().fromBufferAttribute(mark.geometry.attributes.position,Math.floor(mark.geometry.attributes.position.count/2)):mark.geometry.boundingBox.getCenter(new THREE.Vector3())
    const origin=mark.parent.localToWorld(point.clone().add(new THREE.Vector3(3,0,0))),direction=new THREE.Vector3(-1,0,0).transformDirection(mark.parent.matrixWorld)
    const ray=new THREE.Raycaster(origin,direction),back=ray.intersectObjects(paint)[0],decal=ray.intersectObject(mark)[0]
    assert.equal(back?.object.name,'d-cab-livery',`${city} ${low?'Low':'High'} at ${point.toArray()}`)
    assert.ok(decal&&decal.distance<back.distance,'the front-facing logo stays visible above the paint')
   }
   paint.forEach((m,i)=>m.geometry=original[i])
   mark.geometry=originalMark
  }
 }finally{disposeObject(root)}
}))

test('D Beijing lettering follows the curved lamp centre at both cab ends',()=>withKit(mats=>{
 const root=buildTrain(mats,{x:0,y:0,z:0,cars:1,stock:'D',doorsOpen:false,colour:'#a4343a',dirSign:1,yaw:0})
 root.updateMatrixWorld(true)
 try {
  const marks=[];root.traverse(m=>{if(m.name==='d-beijing-cab-mark')marks.push(m)})
  assert.equal(marks.length,2)
  for(const mark of marks){
   const lamps=new THREE.Box3();for(const child of mark.parent.children)if(['d-headlight','d-taillight'].includes(child.name))lamps.union(new THREE.Box3().setFromObject(child,true))
   const bounds=new THREE.Box3().setFromObject(mark,true)
   const delta=bounds.getCenter(new THREE.Vector3()).z-lamps.getCenter(new THREE.Vector3()).z
   assert.ok(Math.abs(delta)<.001,`D centre offset ${delta}`)
  }
 }finally{disposeObject(root)}
}))

test('every stock has two surface-fitted articulated wipers with authored Low geometry and single disposal',()=>withKit(mats=>{
 for(const stock of STOCK_CLASSES) {
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:1,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  const parts=[];root.traverse(p=>{if(p.isMesh&&p.name.startsWith('cab-wiper-'))parts.push(p)})
  assert.equal(parts.length,6,`${stock} pivot, arm and blade at both ends`)
  root.updateMatrixWorld(true)
  const pivots=parts.filter(p=>p.name==='cab-wiper-pivot')
  for(const pivot of pivots) {
    const cab=stock==='D'?pivot.parent:root
    const panes=[];cab.traverse(p=>{if(p.isMesh&&(p.name.includes('windscreen')||stock==='A'&&p.material===mats.trainGlass&&Math.abs(p.position.y)<.01))panes.push(p)})
    const pivotBox=new THREE.Box3().setFromObject(pivot)
    const sameEnd=panes.filter(p=>stock==='D'||Math.sign(p.position.x)===Math.sign(pivot.position.x))
    assert.ok(sameEnd.length)
    for(const pane of sameEnd)assert.ok(pivotBox.max.z<new THREE.Box3().setFromObject(pane).min.z,`${stock}: entire pivot is below the glass (${pivotBox.max.z} < ${new THREE.Box3().setFromObject(pane).min.z})`)
  }
  const counts=new Map()
  for(const part of parts) {
   assert.ok(part.userData.lowDetailGeometry)
   for(const geometry of [part.geometry,part.userData.lowDetailGeometry]) {
    counts.set(geometry,0);geometry.addEventListener('dispose',()=>counts.set(geometry,counts.get(geometry)+1))
    geometry.computeBoundingBox()
    assert.ok(geometry.boundingBox.max.z-geometry.boundingBox.min.z<1)
   }
  }
  if(stock==='D')for(const cab of root.children.filter(p=>p.name==='streamlined-cab')) {
   const blade=cab.getObjectByName('cab-wiper-blade')
   for(const t of [0,.25,.5,.75,1]) {
    const p=blade.geometry.parameters.path.getPoint(t)
    cab.updateMatrixWorld(true)
    const origin=cab.localToWorld(p.clone()), direction=new THREE.Vector3(-1,0,0).transformDirection(cab.matrixWorld)
    const hit=new THREE.Raycaster(origin,direction).intersectObject(cab.getObjectByName('d-cab-windscreen'))[0]
    assert.ok(hit&&hit.distance<.1,'D blade follows the curved windshield')
   }
  }
  disposeObject(root)
  for(const count of counts.values())assert.equal(count,1)
 }
}))


test('black face and lower colour are disjoint paint sections of the white shell in High and Low',()=>{
 const area=geometry=>{
  const p=geometry.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let total=0
  for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);total+=b.sub(a).cross(c.sub(a)).length()/2}return total
 }
 for(const width of [2.6,2.8,3])for(const segments of [1,5]){
  const original=cabShellGeometry(width,segments), skins=cabSkinGeometry(width,segments)
  try{
   assert.ok(Math.abs(skins.reduce((n,g)=>n+area(g),0)-area(original))<1e-5,'paint partitions conserve the original surface area without overlapping backing faces')
   const mesh=new THREE.Mesh(original,new THREE.MeshBasicMaterial())
   mesh.updateMatrixWorld(true)
   for(const skin of skins.slice(1)) {
    const p=skin.attributes.position
    for(let i=0;i<p.count;i+=17){
     const point=new THREE.Vector3().fromBufferAttribute(p,i)
     const hit=new THREE.Raycaster(new THREE.Vector3(4,point.y,point.z),new THREE.Vector3(-1,0,0)).intersectObject(mesh)[0]
     assert.ok(hit&&Math.abs(hit.point.x-point.x)<1e-5,'paint lies exactly on the existing white shell')
    }
   }
   mesh.material.dispose()
  }finally{original.dispose();skins.forEach(g=>g.dispose())}
 }
})

test('cab headlights keep smooth circular lenses in High and Low',()=>withKit(mats=>{
 const root=new THREE.Group();buildCab(root,mats,STOCK.B,0,1,true)
 try{
  for(const lens of root.children.filter(p=>p.name==='cab-round-light'))for(const geometry of [lens.geometry,lens.userData.lowDetailGeometry]){
   const p=geometry.attributes.position,angles=new Set()
   for(let i=0;i<p.count;i++){
    const point=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(lens.matrix)
    const y=point.y-lens.position.y,z=point.z-lens.position.z
    if(Math.abs(Math.hypot(y,z)-.085)<1e-5)angles.add(Math.atan2(z,y).toFixed(4))
   }
   assert.ok(angles.size>=24,'even Low has at least 24 segments around each round light')
  }
 }finally{disposeObject(root)}
}))


test('A/B/C/L passenger sides, lower skirts and roofs meet both cab cuts with the same cross-section in High and Low',()=>withKit(mats=>{
 for(const stock of ['A','B','C','L']){
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:2,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  const skins=root.children.filter(p=>['cab-shell','cab-face-paint','cab-livery-paint','car-roof','car-side-skin'].includes(p.name))
  const original=new Map(skins.map(p=>[p,p.geometry]))
  try{
   for(const low of [false,true]){
    for(const part of skins)part.geometry=low?(part.userData.lowDetailGeometry??original.get(part)):original.get(part)
    root.updateMatrixWorld(true)
    for(const end of [-1,1])for(const side of [-1,1])for(const z of [.50,.60,.75,2.75,2.85,3.05]){
     const seam=end*(STOCK[stock].length-2)
     const hits=[-.01,.01].map(dx=>new THREE.Raycaster(new THREE.Vector3(seam+dx,side*4,z),new THREE.Vector3(0,-side,0)).intersectObjects(skins)[0])
     assert.ok(hits.every(Boolean),`${stock} closes both sides of the seam at ${z}`)
     assert.ok(Math.abs(hits[0].point.y-hits[1].point.y)<1e-4,`${stock} has no roof/skirt step at ${z}`)
    }
   }
   assert.equal(root.children.filter(p=>p.material===mats.white&&p.position.z===.72).length,0,'floating white skirt blocks are removed')
   if(stock==='C')for(const light of root.children.filter(p=>p.name==='cab-round-light')){
    const box=new THREE.Box3().setFromObject(light)
    assert.ok(box.min.z>.86&&box.max.z<1.12,'all four lower lamps fit inside the coloured band')
    const door=root.children.find(p=>p.name==='c-cab-front-door'&&Math.sign(p.position.x)===Math.sign(light.position.x))
    assert.ok(box.max.z<new THREE.Box3().setFromObject(door).min.z,'lights clear the evacuation door')
   }
  }finally{for(const [part,geometry]of original)part.geometry=geometry;disposeObject(root)}
 }
}))

test('A/B/C/L front lower paint uses the consist line colour at both cab ends',()=>withKit(mats=>{
 for(const stock of ['A','B','C','L']){
  const colour='#287db2'
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:2,doorsOpen:false,colour,dirSign:1,yaw:0})
  try{
   const expected=new THREE.Color(colour)
   const bands=root.children.filter(p=>p.name==='cab-livery-paint')
   assert.equal(bands.length,2,`${stock} has a line-coloured band on each cab`)
   for(const band of bands)assert.ok(band.material.color.equals(expected),`${stock} front strip matches ${colour}`)
  }finally{disposeObject(root)}
 }
}))


test('A/B/C/L moving door leaves and thin perimeter seals follow the body skirt in both banks, rotations and LODs',()=>withKit(mats=>{
 for(const stock of ['A','B','C','L']){
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:1,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  const leaves=root.children.filter(p=>p.name==='passenger-curved-door')
  const selected=[-1,1].map(side=>leaves.find(p=>Math.sign(p.position.y)===side))
  const original=new Map();for(const leaf of selected)leaf.traverse(p=>{if(p.isMesh)original.set(p,p.geometry)})
  try{
   for(const low of [false,true]){
    for(const [part,geometry]of original)part.geometry=low?part.userData.lowDetailGeometry:geometry
    for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const open of [0,1]){
     root.rotation.z=angle;setDoorsSides(root,open,open);root.updateMatrixWorld(true)
     for(const leaf of selected){
      const side=Math.sign(leaf.position.y),x=leaf.position.x
      for(const z of [.60,.70,.85,1.3]){
       const origin=root.localToWorld(new THREE.Vector3(x,side*4,z))
       const direction=new THREE.Vector3(0,-side,0).transformDirection(root.matrixWorld)
       const hit=new THREE.Raycaster(origin,direction).intersectObject(leaf,false)[0]
       assert.ok(hit,'curved leaf stays closed across its lower panel')
       const point=root.worldToLocal(hit.point)
       assert.ok(Math.abs(Math.abs(point.y)-carShellAt(STOCK[stock].width,z,low).y-open*.06)<1e-4,'door is flush with the skin when closed and clears it after plugging out')
      }
      const kick=leaf.children.find(p=>p.name==='train-door-perimeter-seal')
      assert.deepEqual(leaf.children.filter(p=>p.material===mats.rubber),[kick],'only the thin perimeter remains; no broad black kick panel')
      if(!low){
       const p=kick.geometry.attributes.position;let lower=Infinity,upper=0
       for(let i=0;i<p.count;i++){
        const z=p.getZ(i)+kick.position.z+leaf.position.z,y=Math.abs(p.getY(i)+kick.position.y+leaf.position.y)
        if(z<.61)lower=Math.min(lower,y);if(z>.83)upper=Math.max(upper,y)
       }
       assert.ok(lower<upper-.12,'rubber perimeter curves inward with the leaf')
      }
     }
    }
   }
  }finally{for(const [part,geometry]of original)part.geometry=geometry;disposeObject(root)}
 }
}))


test('A/B/L crew doors and windows stay upright rectangular planes independently of the nose rake',()=>withKit(mats=>{
 for(const stock of ['A','B','L'])for(const outward of [-1,1]){
  const root=new THREE.Group();buildCab(root,mats,STOCK[stock],0,outward,true)
  try{
   for(const part of root.children.filter(p=>p.name.includes('-crew-')||p.name===`${stock.toLowerCase()}-cab-side-window`)){
    const p=part.geometry.attributes.position,box=new THREE.Box3().setFromBufferAttribute(p),top=[],bottom=[]
    for(let i=0;i<p.count;i++){
     if(Math.abs(p.getZ(i)-box.max.z)<1e-5)top.push(p.getX(i))
     if(Math.abs(p.getZ(i)-box.min.z)<1e-5)bottom.push(p.getX(i))
    }
    assert.ok(Math.abs(Math.min(...top)-Math.min(...bottom))<1e-5&&Math.abs(Math.max(...top)-Math.max(...bottom))<1e-5,'top and bottom edges share their x extents')
    assert.ok(box.max.y-box.min.y<.11,'crew fittings remain flat in the side plane')
   }
  }finally{disposeObject(root)}
 }
}))


test('compact forward A/B/L crew doors clear the entire nearest passenger leaf opening sweep',()=>withKit(mats=>{
 for(const stock of ['A','B','L'])for(const dirSign of [-1,1]){
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:2,doorsOpen:false,colour:'#287db2',dirSign,yaw:0})
  try{
   for(const open of [0,.5,1]){
    setDoorsSides(root,open,open);root.updateMatrixWorld(true)
    for(const end of [-1,1])for(const side of [-1,1]){
     const crew=root.children.find(p=>p.name===`${stock.toLowerCase()}-crew-door-frame`&&Math.sign(p.position.x)===end&&Math.sign(p.position.y)===side)
     const nearest=root.userData.doors.filter(p=>Math.sign(p.position.y)===side).sort((a,b)=>end*(b.position.x-a.position.x))[0]
     const a=new THREE.Box3().setFromObject(crew),b=new THREE.Box3().setFromObject(nearest)
     const gap=end>0?a.min.x-b.max.x:b.min.x-a.max.x
     assert.ok(gap>.10,`${stock} crew door clears fully opening leaf by at least 10 cm (${gap})`)
    }
   }
  }finally{disposeObject(root)}
 }
}))


test('all passenger doors slide shut before seating flush, with sealed centre joins',()=>withKit(mats=>{
 for(const stock of STOCK_CLASSES) {
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:1,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  try {
   const leaves=root.userData.doors
   assert.ok(leaves.length>0)
   const widths=leaves.map(p=>{p.geometry.computeBoundingBox();return p.geometry.boundingBox.clone()})
   setDoorsSides(root,0,0)
   for(let i=0;i+1<leaves.length;i+=2) {
    const a=leaves[i],b=leaves[i+1]
    if(a.name==='d-passenger-single-door'||b.name==='d-passenger-single-door')continue
    if(a.userData.side!==b.userData.side)continue
    assert.ok(Math.abs(a.position.x+widths[i].max.x-b.position.x-widths[i+1].min.x)<1e-6,'closed leaves meet with no air gap')
   }
   // Closing from fully open: lateral travel finishes first, then the plug seats.
   for(const t of [1,.6,.18,.09,0]) {
    setDoorsSides(root,t,0)
    for(const leaf of leaves) {
     if(leaf.userData.side<0){assert.equal(leaf.position.x,leaf.userData.closedX);assert.equal(leaf.position.y,leaf.userData.closedY);continue}
     if(t<=.18)assert.equal(leaf.position.x,leaf.userData.closedX,'leaves stay together throughout inward seating')
     if(t>=.18)assert.ok(Math.abs(leaf.position.y-leaf.userData.closedY-leaf.userData.plugTravel)<1e-8,'longitudinal slide happens outside the skin')
     if(t===0)assert.equal(leaf.position.y,leaf.userData.closedY)
    }
   }
   // A/B/C/L paint lies exactly on the curved shell; D uses its own curved profile.
   if(stock==='D') {
    const {dHalfWidth}=D_PROFILE
    for(const leaf of leaves){const p=leaf.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(Math.abs(p.getY(i))-dHalfWidth(p.getZ(i)))<1e-6,'D painted door closes flush with its curved outer skin')}
   }
  } finally {disposeObject(root)}
 }
}))


test('every passenger leaf has its own continuous rubber perimeter that follows both motion phases',()=>withKit(mats=>{
 for(const stock of STOCK_CLASSES){
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:1,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  try{
   for(const leaf of root.userData.doors){
    const seal=leaf.children.find(p=>p.name==='train-door-perimeter-seal'||p.userData.doorPerimeter)
    assert.ok(seal,`${stock}: each leaf has a perimeter`);assert.equal(seal.material,mats.rubber)
    seal.geometry.computeBoundingBox();leaf.geometry.computeBoundingBox()
    const a=seal.geometry.boundingBox,b=leaf.geometry.boundingBox
    assert.ok(a.min.x<=b.min.x+.001&&a.max.x>=b.max.x-.001&&a.min.z<=b.min.z+.001&&a.max.z>=b.max.z-.001,'rubber reaches all four leaf edges')
    for(const t of [0,.09,.5,1]){setDoorsSides(root,t,t);assert.equal(seal.parent,leaf)}
   }
  }finally{disposeObject(root)}
 }
}))
