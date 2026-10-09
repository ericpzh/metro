import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, assignAdPosters } from '../src/build/model/Equipment.ts'
import { toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { equipmentReason, moduleEnvelope, moduleFootprint, moduleAt, placementBlocked } from '../src/sim/placement.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { buildModule } from '../src/render/models.ts'
import { guideFace, guideEnglishFace, guideLabels, yellowPyramidGeometry, GUIDE_PLAN, GUIDE_YELLOW_PLAN, GUIDE_WIDTH_SCALE, GUIDE_RED_SCALE } from '../src/render/models/pieces/StreetDecorModel.ts'

const data = { name: '植物园', seed: 1, cells: [], modules: [], lines: [] }
test('outdoor decor refuses underground placement and moves, and needs its whole floor', () => {
  for (const type of ['guidepost', 'busstop-short', 'busstop-long']) for (let rot = 0; rot < 4; rot++) {
    const m = createModule(type, 10, 10, 0, type, rot)
    assert.equal(equipmentReason([], [], { ...m, z: -4 }), 'outdoor-below-ground')
    assert.equal(equipmentReason([], [], m), '') // virtual ground
    const raised = { ...m, z: 4 }
    const cells = moduleFootprint(raised).map(([x,y]) => ({x,y,z:4,fill:'solid'}))
    assert.equal(equipmentReason(cells, [], raised), '')
    assert.equal(equipmentReason(cells.slice(1), [], raised), 'floor')
    assert.equal(equipmentReason(cells.map((c,i) => i === cells.length-1 ? {...c,finish:{top:'floor.track'}} : c), [], raised), 'track')
    for (const [x,y] of moduleFootprint(m)) assert.equal(moduleAt([m],x,y,0)?.id,m.id)
    assert.equal(placementBlocked([m],{...m,id:'other'}),true)
  }
})
test('models fit their rotated reservation and stand on the floor', () => {
  const mats = new Proxy({}, {get:(t,k) => t[k] ??= new THREE.MeshStandardMaterial()})
  const ads = { adFace: (slug,w,h) => ({geometry:new THREE.PlaneGeometry(w,h),material:mats.white}) }
  for (const type of ['guidepost', 'busstop-short', 'busstop-long']) for (let rot=0;rot<4;rot++) {
    const m = createModule(type,10,10,0,type,rot)
    const group = buildModule(m,{mats,ads,data,trackCells:new Set(),finish:()=>mats.white})
    const box = new THREE.Box3().setFromObject(group), e=moduleEnvelope(m)
    for (const axis of ['x','y','z']) {
      assert.ok(box.min[axis] >= e[axis+'0']-1e-6, `${type}/${rot} min ${axis}`)
      assert.ok(box.max[axis] <= e[axis+'1']+1e-6, `${type}/${rot} max ${axis}`)
    }
    assert.ok(Math.abs(box.min.z-1)<1e-6)
    const posters=[];group.traverse(o=>{if(o.userData.adPoster)posters.push(o.userData.adPoster)})
    assert.equal(posters.length,type==='guidepost'?0:type==='busstop-short'?1:2)
    if(posters.length===2)assert.equal(posters[0],posters[1])
  }
})
test('pillar resolves station and selected exit names live, including deletion', () => {
  const m = createModule('guidepost',0,0,0,'g');m.cfg.exitId='e'
  const exit = createModule('exit',20,20,0,'e');exit.cfg.name='B'
  assert.deepEqual(guideLabels({...data,modules:[exit]},m),{station:'植物园',exit:'B'})
  exit.cfg.name='D';assert.deepEqual(guideLabels({...data,name:'大学城北站',modules:[exit]},m),{station:'大学城北站',exit:'D'})
  assert.equal(guideLabels(data,m).exit,'入口')
})
test('a guidepost takes the armed exit, or the first one standing', () => {
  const before = useStore.getState()
  try {
    const exits = [
      { id: 'exit-a', type: 'exit', x: 0, y: 0, z: 0, rot: 0, cfg: { name: 'A口' } },
      { id: 'exit-b', type: 'exit', x: 20, y: 20, z: 0, rot: 0, cfg: { name: 'B口' } },
    ]
    const tool = new EquipmentTool({})
    // The armed exit wins, wherever it stands in the list.
    useStore.setState({ station: toState({ name: '导向', seed: 1, cells: [], modules: exits, lines: [] }), guideExitId: 'exit-b' })
    assert.equal(tool.buildPlacementModules('guidepost', [5, 5, 0], 'g1')[0].cfg.exitId, 'exit-b')
    // A stale id (its exit long deleted) falls back to the first exit standing,
    // so the pillar never points at nothing.
    useStore.setState({ guideExitId: 'exit-gone' })
    assert.equal(tool.buildPlacementModules('guidepost', [5, 5, 0], 'g2')[0].cfg.exitId, 'exit-a')
    // With no exits at all the pillar is still placeable: it prints 入口 instead.
    useStore.setState({ station: toState({ name: '导向', seed: 1, cells: [], modules: [], lines: [] }) })
    const bare = tool.buildPlacementModules('guidepost', [5, 5, 0], 'g3')[0]
    assert.equal(bare.cfg.exitId, undefined)
    assert.equal(guideLabels(data, bare).exit, '入口')
  } finally {
    useStore.setState(before)
  }
})
test('exit binding, rotation, shelter variants and frozen ads survive save/load', () => {
  const guide=createModule('guidepost',0,0,0,'g',3);guide.cfg.exitId='exit-b'
  const mods=assignAdPosters([guide,createModule('busstop-short',8,8,0,'b',1),createModule('busstop-long',25,25,4,'c',2)])
  assert.ok(mods[1].cfg.poster);assert.ok(mods[2].cfg.poster)
  const loaded=parse(serialize({...data,modules:mods}))
  assert.equal(loaded.ok,true);assert.deepEqual(loaded.state.modules,mods)
})


test('guidepost uses a fixed-heading yellow triangle with a projecting nose and recessed rear edge without arrows', () => {
  const mats = new Proxy({}, {get:(t,k) => t[k] ??= new THREE.MeshStandardMaterial()})
  const g = buildModule(createModule('guidepost',0,0,0,'g'),{mats,data,trackCells:new Set(),owned:[]})
  for (const name of ['guide-triangular-column','guide-triangular-base']) {
    const pos=g.getObjectByName(name).geometry.attributes.position, corners=new Set()
    for(let i=0;i<pos.count;i++)corners.add(`${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)}`)
    assert.equal(corners.size,3)
  }
  const middle = g.getObjectByName('guide-red-middle')
  middle.geometry.computeBoundingBox()
  assert.ok(Math.abs(middle.geometry.boundingBox.max.y-.07*GUIDE_RED_SCALE)<1e-6,'rear strip stops at yellow base')
  assert.ok(Math.abs(middle.geometry.boundingBox.min.y+.23094*GUIDE_RED_SCALE)<1e-6,'front red fill retains the column nose')
  assert.equal(g.getObjectByName('guide-projecting-arrow'),undefined)
  const collar=g.getObjectByName('guide-yellow-logo-collar')
  assert.equal(collar.rotation.z,0,'yellow section has no independent rotation')
  const yellow=collar.children[0]
  yellow.geometry.computeBoundingBox()
  const box=yellow.geometry.boundingBox
  assert.ok(box.max.x<.2,'yellow rear edge is narrower than the red triangle')
  assert.ok(box.min.y<-.45 && box.min.y>=-.5,'nose extends farther while fitting its cell')
  assert.ok(box.max.y<.11547 && box.max.y>0,'rear base is pulled back close to the red rear face')
  const pos=yellow.geometry.attributes.position
  const tips=[]
  for(let i=0;i<pos.count;i++)if(pos.getY(i)<-.3)tips.push(pos.getZ(i))
  assert.ok(tips.length>0)
  assert.ok(tips.every(z=>Math.abs(z-.22)<1e-6),'single apex is at mid-height: triangular side silhouette')
  assert.ok(yellow.position.z>=2,'logo is in the upper half')
})


test('guide station name precedes exit letter and icon, with ink confined to the upper half', () => {
  const original=globalThis.document, calls=[]
  const ctx=new Proxy({measureText:()=>({width:180,actualBoundingBoxLeft:90,actualBoundingBoxRight:90})}, {get:(t,k)=>t[k] ??= (...args)=>calls.push([k,...args]),set:(t,k,v)=>(t[k]=v,true)})
  globalThis.document={createElement:()=>({getContext:()=>ctx})}
  try {
    guideFace('神舟路站')
    const labels=calls.filter(c=>c[0]==='fillText')
    assert.deepEqual(labels.map(c=>c[1]),['神','舟','路','站'])
    assert.ok(labels.every(c=>c[3]<1024))
    calls.length=0
    guideFace('动物园')
    const station=calls.filter(c=>c[0]==='fillText').slice(0,3)
    assert.ok(station.at(-1)[3]-station[0][3]>=150,'three-character name fills the top panel vertically')
    const faceWidth=Math.hypot(GUIDE_PLAN[1][0]-GUIDE_PLAN[0][0],GUIDE_PLAN[1][1]-GUIDE_PLAN[0][1])
    const scale=calls.find(c=>c[0]==='scale')[1]
    assert.ok(Math.abs(180*scale/256*faceWidth-.18*224/256)<1e-8,'station glyph width matches exit letter ink box')
    calls.length=0
    const english=guideEnglishFace('Zoo')
    assert.deepEqual(calls.find(c=>c[0]==='rotate'),['rotate',Math.PI/2],'English is clockwise, reading top to bottom')
    assert.equal(calls.find(c=>c[0]==='fillText')[1],'Zoo')
    assert.ok(english.height>english.width,'rear artwork respects the narrow face aspect')
  } finally {globalThis.document=original}
})


test('both triangular logo faces map horizontal ink in the outward-facing reading direction', () => {
  for(const side of ['left','right']) {
    const geo=yellowPyramidGeometry(side), p=geo.attributes.position, uv=geo.attributes.uv, n=geo.attributes.normal
    const right=new THREE.Vector3(-n.getY(0),n.getX(0),0)
    // World direction along increasing U must point right for an observer facing the front.
    const du=uv.getX(1)-uv.getX(0)
    if(du!==0) {
      const tangent=new THREE.Vector3(p.getX(1)-p.getX(0),p.getY(1)-p.getY(0),0)
      assert.ok(tangent.dot(right)*du>0,`${side} logo is not mirrored`)
    } else {
      const tangent=new THREE.Vector3(p.getX(2)-p.getX(0),p.getY(2)-p.getY(0),0)
      assert.ok(tangent.dot(right)*(uv.getX(2)-uv.getX(0))>0,`${side} logo is not mirrored`)
    }
  }
})


test('red prism keeps its 30 degree apex at 75% size while the yellow wedge retains its size', () => {
  const [a,tip,b]=GUIDE_PLAN
  const left=new THREE.Vector2(a[0]-tip[0],a[1]-tip[1]).normalize()
  const right=new THREE.Vector2(b[0]-tip[0],b[1]-tip[1]).normalize()
  assert.ok(Math.abs(Math.acos(left.dot(right))*180/Math.PI-30)<1e-6)
  assert.ok(Math.abs((b[0]-a[0])/(.4*GUIDE_RED_SCALE)-GUIDE_WIDTH_SCALE)<1e-8)
  assert.ok(Math.abs((GUIDE_YELLOW_PLAN[2][0]-GUIDE_YELLOW_PLAN[0][0])/.34-GUIDE_WIDTH_SCALE)<1e-8)
  assert.equal(GUIDE_YELLOW_PLAN[1][1],-.49,'projection length is retained')
})


test('guidepost prints the exit identifier without the 口 suffix', () => {
  const mod=createModule('guidepost',0,0,0,'g');mod.cfg.exitId='e'
  const exit=createModule('exit',20,20,0,'e')
  for(const [name,label] of [['B口','B'],['B','B'],['A1口','A1']]) {
    exit.cfg.name=name
    assert.equal(guideLabels({...data,modules:[exit]},mod).exit,label)
    assert.equal(exit.cfg.name,name,'the exit name itself is unchanged')
  }
})


test('train icons retain square geometry on all three differently sized prism faces', () => {
  const mats=new Proxy({}, {get:(t,k)=>t[k]??=new THREE.MeshStandardMaterial()})
  for(let rot=0;rot<4;rot++) {
    const g=buildModule(createModule('guidepost',0,0,0,'g',rot),{mats,data,trackCells:new Set(),owned:[]})
    const icons=g.children.filter(o=>o.name==='guide-square-train-icon')
    assert.equal(icons.length,3)
    for(const icon of icons) {
      const {width,height}=icon.geometry.parameters
      assert.equal(width,height,'square in metres, independent of text texture aspect')
      assert.ok(width>0 && width<=.18)
      assert.ok(icon.position.z-height/2>2,'icon remains in upper half')
    }
  }
})


test('red cross-section is reduced by 25 percent independently of the yellow geometry', () => {
  assert.equal(GUIDE_RED_SCALE,.75)
  assert.ok(Math.abs(GUIDE_PLAN[2][0]-.2*GUIDE_WIDTH_SCALE*.75)<1e-8)
  assert.ok(Math.abs(GUIDE_PLAN[1][1]-(-.23094*.75))<1e-8)
  assert.ok(Math.abs(GUIDE_YELLOW_PLAN[2][0]-.17*GUIDE_WIDTH_SCALE)<1e-8)
  assert.equal(GUIDE_YELLOW_PLAN[1][1],-.49)
})


test('exit letters have a proper square bounding panel on every pillar face', () => {
  const mats=new Proxy({}, {get:(t,k)=>t[k]??=new THREE.MeshStandardMaterial()})
  const g=buildModule(createModule('guidepost',0,0,0,'g'),{mats,data,trackCells:new Set(),owned:[]})
  const letters=g.children.filter(o=>o.name==='guide-square-exit-letter')
  assert.equal(letters.length,3)
  for(const letter of letters) {
    assert.equal(letter.geometry.parameters.width,letter.geometry.parameters.height)
    assert.ok(letter.geometry.parameters.width<=.18)
    assert.ok(letter.position.z>2.49,'letter is above the train icon')
  }
})
