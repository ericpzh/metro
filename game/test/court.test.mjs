import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { equipmentReason, moduleEnvelope, moduleFootprint } from '../src/sim/placement.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { MODULE_FAMILIES, familyOptions, folderTiles, decorCategoryForId } from '../src/app/store/catalog.ts'

for (const variant of ['pickleball', 'badminton']) test(`${variant} is one supported, rotatable ground decoration with persistent net variant`, () => {
  for (const rot of [0, 1, 2, 3]) {
    const id = `court-${variant}`
    const court = createModule(id, 4, 8, -4, id, rot)
    assert.equal(court.type, 'court')
    assert.equal(court.cfg.variant, variant)
    assert.equal(decorCategoryForId(id), 'outside')
    const footprint = moduleFootprint(court)
    assert.equal(footprint.length, 98)
    const cells = footprint.map(([x, y]) => ({ x, y, z: -4, fill: 'solid' }))
    assert.equal(equipmentReason(cells, [], court), '')
    assert.equal(equipmentReason(cells.slice(1), [], court), 'floor')
    const bounds = moduleEnvelope(court)
    assert.equal(bounds.x1 - bounds.x0, rot % 2 ? 7 : 14)
    assert.equal(bounds.y1 - bounds.y0, rot % 2 ? 14 : 7)
    assert.ok(Math.abs(bounds.z1 - bounds.z0 - (variant === 'badminton' ? 1.6 : .97)) < 1e-8)
    const state = toState({ ...emptyStation(), cells, modules: [court] })
    const loaded = parse(serialize(state))
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.state.modules, toState(state).modules)
  }
})


import * as THREE from 'three'
import { CourtModel } from '../src/render/models/pieces/CourtModel.ts'
test('both rendered courts include open mesh nets and stay inside rotated placement bounds', () => {
  const material = new THREE.MeshStandardMaterial()
  for (const variant of ['pickleball', 'badminton']) for (const rot of [0, 1, 2, 3]) {
    const court = createModule(`court-${variant}`, 4, 8, -4, 'court', rot)
    const model = new CourtModel({ mats: { white: material, darkSteel: material } }).build(court)
    assert.ok(model.getObjectByName('court-net-mesh').isLineSegments)
    assert.equal(model.children.filter(c => c.name === 'net-post').length, 2)
    assert.equal(model.children.filter(c => c.name === 'court-marking').length, variant === 'badminton' ? 12 : 8)
    const box = new THREE.Box3().setFromObject(model), reserved = moduleEnvelope(court)
    for (const axis of ['x','y','z']) {
      assert.ok(box.min[axis] >= reserved[`${axis}0`] - 1e-6)
      assert.ok(box.max[axis] <= reserved[`${axis}1`] + 1e-6)
    }
  }
})

test('ballfields group outside while courts and dividers accept supported surfaces at every elevation', () => {
  for (const variant of ['pickleball', 'badminton', 'divider']) for (const z of [-12, -4, 0, 6]) for (const rot of [0, 1, 2, 3]) {
    const id = `court-${variant}`
    const module = createModule(id, 0, 0, z, id, rot)
    const footprint = moduleFootprint(module)
    const cells = footprint.map(([x, y]) => ({ x, y, z, fill: 'solid' }))
    assert.equal(decorCategoryForId(id), 'outside')
    assert.equal(equipmentReason(cells, [], module), '', `${id} at ${z}/${rot}`)
    const pavers = footprint.map(([x, y], i) => ({ id: `paver-${i}`, type: 'sidewalk', x, y, z, rot: 0, cfg: {} }))
    assert.equal(equipmentReason(cells, pavers, module), '', 'raised paving is supported too')
  }
})

test('portable divider has a fabric panel and stable feet within its 2 × 1 m bay', () => {
  const material = new THREE.MeshStandardMaterial()
  for (const rot of [0, 1, 2, 3]) {
    const module = createModule('court-divider', 4, 8, -4, 'divider', rot)
    const model = new CourtModel({ mats: { darkSteel: material } }).build(module)
    assert.ok(model.getObjectByName('divider-fabric'))
    assert.equal(model.children.filter(c => c.name === 'divider-foot').length, 2)
    const box = new THREE.Box3().setFromObject(model), reserved = moduleEnvelope(module)
    for (const axis of ['x','y','z']) {
      assert.ok(box.min[axis] >= reserved[`${axis}0`] - 1e-6)
      assert.ok(box.max[axis] <= reserved[`${axis}1`] + 1e-6)
    }
  }
})


test('one outside ballfield tile owns both courts and the portable divider', () => {
  const family = MODULE_FAMILIES.find(f => f.key === 'court')
  assert.deepEqual(familyOptions(family).map(o => o.id), ['court-pickleball', 'court-badminton', 'court-divider'])
  assert.equal(folderTiles('decor', 'outside').filter(t => t.anchor === '__court').length, 1)
  assert.equal(folderTiles('decor', 'floor').filter(t => t.anchor === '__court').length, 0)
})

test('a portable divider may stand on court paint but cannot pass through its net', () => {
  const court = createModule('court-pickleball', 0, 0, -4, 'field')
  const cells = moduleFootprint(court).map(([x,y]) => ({x,y,z:-4,fill:'solid'}))
  const divider = createModule('court-divider', 2, 2, -4, 'divider')
  assert.equal(equipmentReason(cells, [court], divider), '')
  assert.equal(equipmentReason(cells, [divider], court), '')
  assert.equal(equipmentReason(cells, [court], { ...divider, x: 6 }), 'occupied')
})

import { useStore } from '../src/app/store.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { LONG_PRESS_MS } from '../src/app/tools/geometry/pointer.ts'

test('portable dividers drag in both axes/directions, preview without edits, and undo as one run', () => {
  for (const [sx, sy, ex, ey] of [[0,0,5,0],[5,0,0,0],[0,0,0,5],[0,5,0,0]]) {
    useStore.setState({ station: toState(emptyStation()), past: [], future: [], tool: 'module', moduleType: 'court-divider', moduleRot: 0, selected: null })
    const drag = { current: null }
    let preview = []
    const scene = { setModulePreview() {}, setFencePreview(mods) { preview = mods ?? [] }, setGhost() {}, setCollisionHighlight() {}, setCursor() {} }
    const tool = new EquipmentTool({ scene: () => scene, drag, hover: {current:null}, pickModule: () => null })
    const event = (x,y,button=0) => ({clientX:x*20,clientY:y*20,button,buttons:button===2?2:1,hit:{cell:[x,y,0],place:[x,y,1],solid:true},preventDefault(){}})
    const before = useStore.getState().station
    tool.onDown(event(sx,sy))
    assert.ok(drag.current.fence)
    drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
    tool.onMove(event(ex,ey))
    tool.multiPlace.flushPreview()
    assert.equal(useStore.getState().station, before)
    assert.equal(preview.length,3)
    const expected = preview.map(m => [m.x,m.y,m.rot])
    tool.onUp(event(ex,ey))
    assert.equal(useStore.getState().past.length,1)
    assert.deepEqual(useStore.getState().station.modules.map(m => [m.x,m.y,m.rot]), expected)
    const footprints = useStore.getState().station.modules.flatMap(moduleFootprint).map(([x,y])=>`${x},${y}`)
    assert.equal(new Set(footprints).size,6,'no overlapping two-metre screens')
    tool.onDown(event(sx,sy,2))
    drag.current.downTime = performance.now() - LONG_PRESS_MS - 1
    tool.onMove(event(ex,ey,2))
    tool.onUp(event(ex,ey,2))
    assert.equal(useStore.getState().station.modules.length,0)
    useStore.getState().undo()
    assert.equal(useStore.getState().station.modules.length,3)
  }
})

test('both net edges and top tapes meet their post centres', () => {
  const material = new THREE.MeshStandardMaterial()
  for (const variant of ['pickleball','badminton']) {
    const module = createModule(`court-${variant}`,0,0,0,'field')
    const model = new CourtModel({mats:{white:material,darkSteel:material}}).build(module)
    const net = model.getObjectByName('court-net-mesh')
    net.geometry.computeBoundingBox()
    const bounds = net.geometry.boundingBox
    const poles = model.children.filter(c=>c.name==='net-post').sort((a,b)=>a.position.y-b.position.y)
    assert.ok(Math.abs(bounds.min.y-poles[0].position.y)<1e-6)
    assert.ok(Math.abs(bounds.max.y-poles[1].position.y)<1e-6)
    for (const tape of model.children.filter(c=>c.name==='net-top-tape')) {
      const length = tape.geometry.parameters.height
      const end = new THREE.Vector3(0,Math.sign(tape.position.y-3)*length/2,0).applyEuler(tape.rotation).add(tape.position)
      const pole = poles[tape.position.y<3?0:1]
      assert.ok(Math.abs(end.y-pole.position.y)<1e-6)
      assert.ok(Math.abs(end.x-pole.position.x)<1e-6)
    }
  }
})

import { DeleteTool } from '../src/app/tools/DeleteTool.ts'
test('Delete tool drags a straight divider run, preserves courts and floors, and undoes once', () => {
  for (const rot of [0,1]) {
    const dividers = [0,2,4].map((n,i)=>createModule('court-divider',rot?0:n,rot?n:0,0,`divider-${i}`,rot))
    const court = createModule('court-pickleball',10,10,0,'field')
    const state = toState(emptyStation())
    useStore.setState({station:{...state,modules:[...dividers,court]},past:[],future:[],tool:'delete',moduleType:'court-pickleball',selected:null})
    const drag={current:null}
    const scene={setModulePreview(){},setFencePreview(){},setGhost(){},setCollisionHighlight(){},setCursor(){}}
    const ctx={scene:()=>scene,drag,hover:{current:null},pickModule:()=>dividers[0].id}
    const tool=new DeleteTool(ctx)
    const event=(x,y)=>({clientX:x*20,clientY:y*20,button:0,buttons:1,hit:{cell:[x,y,0],place:[x,y,1],solid:true},preventDefault(){}})
    const floors=useStore.getState().station.cells
    tool.onDown(event(0,0))
    assert.equal(drag.current.tileType,'court-divider')
    drag.current.downTime=performance.now()-LONG_PRESS_MS-1
    const end=event(rot?0:5,rot?5:0)
    tool.onMove(end)
    assert.equal(useStore.getState().station.modules.length,4,'preview leaves document intact')
    tool.onUp(end)
    assert.deepEqual(useStore.getState().station.modules,[court])
    assert.equal(useStore.getState().station.cells,floors)
    assert.equal(useStore.getState().past.length,1)
    useStore.getState().undo()
    assert.equal(useStore.getState().station.modules.length,4)
  }
})

test('right-drag divider deletion highlights whole models from either footprint cell, never floor blocks', () => {
  for (const rot of [0,1,2,3]) {
    const dividers=[0,2,4].map((n,i)=>createModule('court-divider',rot%2?0:n,rot%2?n:0,0,`divider-${i}`,rot%2))
    const state=toState(emptyStation())
    useStore.setState({station:{...state,modules:dividers},past:[],future:[],tool:'module',moduleType:'court-divider',selected:null})
    const drag={current:null}
    let models=[], blocks=[], cursor='unset', blocked=false
    const scene={setModulePreview(m,b){models=m??[];blocked=b},setFencePreview(){},setGhost(c){blocks=c},setCollisionHighlight(){},setCursor(c){cursor=c}}
    const tool=new EquipmentTool({scene:()=>scene,drag,hover:{current:null},pickModule:()=>null})
    const event=n=>({clientX:(rot%2?0:n)*20,clientY:(rot%2?n:0)*20,button:2,buttons:2,hit:{cell:[rot%2?0:n,rot%2?n:0,0],place:[0,0,1],solid:true},preventDefault(){}})
    const reverse=rot>=2,start=reverse?5:1,end=reverse?1:5
    tool.onDown(event(start))
    assert.deepEqual(models.map(m=>m.id),[reverse?'divider-2':'divider-0'])
    assert.equal(blocked,true)
    assert.deepEqual(blocks,[])
    assert.equal(cursor,null)
    drag.current.downTime=performance.now()-LONG_PRESS_MS-1
    tool.onMove(event(end))
    assert.deepEqual(new Set(models.map(m=>m.id)),new Set(dividers.map(m=>m.id)))
    assert.deepEqual(blocks,[])
    assert.equal(cursor,null)
    assert.equal(useStore.getState().station.modules.length,3)
    tool.onUp(event(end))
    assert.equal(useStore.getState().station.modules.length,0)
    assert.equal(useStore.getState().past.length,1)
  }
})
