import test from 'node:test'
import assert from 'node:assert/strict'
import { explodedView, explodedPoses, explodedLiftPoses, EXPLODED_LIFT_ABSENT } from '../src/render/explodedView.ts'
import { ExplodedLayout } from '../src/render/explodedLayout.ts'
import * as THREE from 'three'
import { stubCanvas } from './support/stub-canvas.mjs'
import { moduleFootprint } from '../src/sim/placement.ts'
import { readFileSync } from 'node:fs'

const slab = z => Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), z, fill: 'solid' }))
const station = (cells, modules = []) => ({ cells, modules, levelBase: 0, lines: [], name: 'Test', seed: 1 })

test('exploded floors are opaque owned footprints, separated horizontally without editing the source', () => {
  const input = station([...slab(-10), ...slab(-5)])
  const before = structuredClone(input)
  const { data, levels } = explodedView(input)
  assert.deepEqual(input, before)
  // Furnish the top tray to distinguish a usable story from a bare roof cap.
  const equipped = explodedView(station(input.cells, [{ id: 'seat', type: 'bench', x: 2, y: 2, z: -5 }]))
  assert.deepEqual(equipped.levels, [-10, -5])
  const lower = equipped.data.cells.filter(c => c.z === -10)
  const upper = equipped.data.cells.filter(c => c.z === -5)
  assert.equal(lower.length, 25)
  assert.equal(upper.length, 25)
  assert.deepEqual(upper.map(c => c.x),lower.map(c => c.x),'longitudinal alignment remains fixed')
  const lowerTiles = new Set(lower.map(c=>`${c.x},${c.y}`))
  assert.ok(upper.filter(c=>lowerTiles.has(`${c.x},${c.y}`)).length <= 0)
  assert.ok(upper[0].y-lower[0].y <= 8,'separation follows the short floor dimension')
  assert.equal(data.cells.length, 50, 'unfurnished stories remain visible')
  assert.deepEqual(levels, [-10, -5])
})

test('front perimeter remains visible and is classified separately from internal partitions', () => {
  const walls = [{x:4,y:2,z:-9}, {x:2,y:0,z:-9}, {x:0,y:2,z:-9}, {x:2,y:4,z:-9}, {x:2,y:2,z:-9}]
    .map(c => ({...c, fill:'solid', tags:['wall']}))
  const {data,frontWalls} = explodedView(station([...slab(-10), ...walls]))
  const result=data.cells
  assert.equal(result.filter(c => c.z === -9).length, 5)
  assert.deepEqual(frontWalls.map(c=>[c.x,c.y]),[[4,2],[2,0]])
  const dx = result[0].x
  assert.ok(result.some(c => c.x === dx && c.y === dx + 2 && c.z === -9))
})

test('the entire thickness of a near wall is available to the hide control, including missing bases', () => {
  const cells = Array.from({length:120},(_,i)=>({x:i%12,y:Math.floor(i/12),z:-10,fill:'solid'}))
  for (let x=0;x<12;x++) for (let y=0;y<10;y++) for(let z=-9;z<=-7;z++) {
    if(y<=2||y===9||x===0||x>=9) cells.push({x,y,z,fill:'solid',tags:['wall']})
  }
  // Missing bases must not leave another floating course of the same front wall.
  cells.push({x:12,y:5,z:-8,fill:'solid',tags:['wall']})
  const {data,frontWalls}=explodedView(station(cells))
  const hidden=new Set(frontWalls)
  assert.equal(data.cells.filter(c=>!hidden.has(c)&&c.z>-10&&(c.y<=2||c.x>=9)).length,0)
  assert.ok(frontWalls.length>0)
  assert.ok(data.cells.some(c=>c.z>-10&&c.x===0&&c.y===5),'back enclosure survives')
})

test('ground-level modules retain only exits, keeping underground and elevated equipment', () => {
  const modules = [
    {id:'exit',type:'exit',x:0,y:0,z:0,cfg:{}},
    ...['fence','guidepost','cctv','ac-unit','bench'].map((type,i)=>({id:type,type,x:i,y:0,z:0,cfg:{}})),
    {id:'raised',type:'bench',x:0,y:0,z:1,cfg:{}},
    {id:'below',type:'bench',x:0,y:0,z:-5,cfg:{}},
    {id:'above',type:'bench',x:0,y:0,z:5,cfg:{}},
  ]
  const {data}=explodedView(station([...slab(-5),...slab(0),...slab(5)],modules))
  assert.deepEqual(data.modules.map(m=>m.id),['exit','raised','below','above'])
})

test('ceiling tiles, roof modules and outdoor context are absent; ramps preserve both endpoints', () => {
  const ramp = {id:'ramp',type:'stair',x:1,y:1,z:-10,from:{x:1,y:1,z:-10},to:{x:1,y:9,z:-5},cfg:{}}
  const input = station([...slab(-10), ...slab(-5).map(c => ({...c,tags:['suspended-ceiling']}))],
    [ramp, {id:'roof',type:'roof',x:1,y:1,z:0}, {id:'tree',type:'tree',x:100,y:100,z:0}])
  const before = structuredClone(input)
  const { data } = explodedView(input)
  assert.deepEqual(input, before)
  assert.equal(data.modules.length, 1)
  assert.equal(data.cells.length, 25)
  const moved = data.modules[0]
  assert.equal(moved.from.x - ramp.from.x, moved.x - ramp.x)
  assert.equal(moved.to.y - moved.from.y, 8)
  assert.equal(moved.to.z - moved.from.z, 5)
})

test('empty presentation is finite and floor bands follow the authored baseline', () => {
  assert.deepEqual(explodedView(station([])).levels, [])
  const input = {...station(slab(2)), levelBase:2}
  assert.deepEqual(explodedView(input).levels, [2])
})

test('legacy untagged ceiling courses disappear while rear wall courses remain', () => {
  const result = explodedView(station([...slab(-10), ...slab(-6),
    {x:0,y:4,z:-6,fill:'solid',tags:['wall']}])).data
  assert.equal(result.cells.filter(c => c.z === -6).length, 1)
})

test('exposed earth caps disappear, preserving finished floors and supporting wall cells', () => {
  const soil = {fill:'solid',finish:{top:'floor.soil',bottom:'ceil.baffle'}}
  const input = station([...slab(-10),{...soil,x:20,y:20,z:-5},
    {...soil,x:30,y:30,z:-5},{x:30,y:30,z:-4,fill:'solid',tags:['wall']},
    {x:40,y:40,z:-5,fill:'solid',finish:{top:'floor.concrete',bottom:'ceil.baffle'}}])
  const {data} = explodedView(input)
  assert.equal(data.cells.filter(c=>c.finish?.top==='floor.soil').length,1)
  assert.ok(data.cells.some(c=>c.finish?.top==='floor.concrete'))
})

test('a lift is split into one bounded shaft per occupied story', () => {
  const lift = {id:'lift',type:'lift',x:1,y:1,z:-10,from:{x:1,y:1,z:-10},to:{x:1,y:1,z:0},cfg:{}}
  const input = station([...slab(-10), ...slab(-5)], [lift])
  const {data} = explodedView(input)
  assert.equal(data.modules.length, 2)
  assert.deepEqual(data.modules.map(m => [m.from.z,m.to.z]), [[-10,-5],[-5,0]])
  assert.notEqual(data.modules[0].y, data.modules[1].y)
  assert.deepEqual(lift.to, {x:1,y:1,z:0})
})

test('story spacing includes full equipment footprints, even without authored slabs', () => {
  const shops = [-10,-5].map((z,i) => ({id:`shop-${i}`,type:'shop',x:0,y:0,z,w:80,h:3,cfg:{kind:'store'}}))
  const {data} = explodedView(station([], shops))
  const lower = new Set(moduleFootprint(data.modules[0]).map(([x,y])=>`${x},${y}`))
  const upper = moduleFootprint(data.modules[1])
  assert.ok(upper.filter(([x,y])=>lower.has(`${x},${y}`)).length<=0)
  assert.equal(data.modules[0].x,data.modules[1].x)
  assert.ok(data.modules[1].y-data.modules[0].y<=6)
})

for (const fixture of ['demo-station', 'tanwei-station']) {
  test(`${fixture}: every retained stair flight moves with its story, including half landings`, () => {
    const input = JSON.parse(readFileSync(new URL(`../src/data/${fixture}.json`, import.meta.url)))
    const before = structuredClone(input)
    const {data} = explodedView(input)
    let flights = 0
    for (const source of input.modules.filter(m => m.type === 'stair' && m.cfg.flights)) {
      const moved = data.modules.find(m => m.id === source.id)
      if (!moved) continue // Exterior-only access is intentionally absent from the presentation.
      const dx = moved.x-source.x, dy = moved.y-source.y
      for (let i=0;i<source.cfg.flights.length;i++) {
        for (const end of ['from','to']) {
          const old = source.cfg.flights[i][end], actual = moved.cfg.flights[i][end]
          assert.deepEqual(actual, {...old,x:old.x+dx,y:old.y+dy}, `${source.id} ${i} ${end}`)
        }
        flights++
      }
    }
    assert.ok(flights > 0)
    assert.deepEqual(input,before)
  })
}

test('irregular floor boundaries interlock without reserving their empty bounding boxes', () => {
  const cells = [-10,-5].flatMap(z => Array.from({length:40},(_,x) => ({x,y:40-x,z,fill:'solid'})))
  const {data,offsets} = explodedView(station(cells))
  assert.ok(offsets.get(-5)-offsets.get(-10)<=1,'one tile exposes this thin diagonal floor')
  const lower = new Set(data.cells.filter(c=>c.z===-10).map(c=>`${c.x},${c.y}`))
  assert.ok(data.cells.filter(c=>c.z===-5&&lower.has(`${c.x},${c.y}`)).length<=0)
})

test('four L-shaped floors nest diagonally without covering any other floor', () => {
  const cells=[]
  for (const z of [-20,-15,-10,-5]) for(let x=0;x<30;x++) for(let y=0;y<30;y++) {
    if(x<5||y<5) cells.push({x,y,z,fill:'solid'})
  }
  const input=station(cells), before=structuredClone(input)
  const result=explodedView(input)
  assert.deepEqual(result.levels,[-20,-15,-10,-5])
  assert.deepEqual(result.direction,[1,1])
  assert.deepEqual([...result.offsets.values()],[0,5,10,15],'use the empty corner rather than a full 30 m arm per tray')
  const seen=new Set()
  for(const c of result.data.cells) {
    const key=`${c.x},${c.y}`
    assert.ok(!seen.has(key),'no floor tile is covered by another storey')
    seen.add(key)
  }
  assert.equal(result.data.cells.length,cells.length)
  assert.deepEqual(input,before)
  const poses=new Float32Array([-1,-2,-14,1,0,1])
  const moved=explodedPoses(poses,6,result.offsets,0,0,undefined,false,result.direction)
  assert.deepEqual([...moved],[4,3,-14,1,0,1],'live passengers follow both diagonal coordinates')
})

test('floor boundaries ignore remote props and allow a small measurable overlap', () => {
  const wide = z => Array.from({length:2000},(_,i)=>({x:i%100,y:Math.floor(i/100),z,fill:'solid'}))
  const input = station([...wide(-10),...wide(-5)], [{id:'remote',type:'bench',x:400,y:400,z:-5,cfg:{}}])
  const result = explodedView(input)
  assert.deepEqual(result.direction,[0,1])
  assert.equal(result.offsets.get(-5),20,'20-tile width with no overlap')
  const lower = new Set(result.data.cells.filter(c=>c.z===-10).map(c=>`${c.x},${c.y}`))
  assert.equal(result.data.cells.filter(c=>c.z===-5&&lower.has(`${c.x},${c.y}`)).length,0)
})

test('raised Tanwei-style floors define the tray even when the nominal base has only a few blocks', () => {
  const cells = [0,5,10].flatMap(z => [
    {x:0,y:0,z,fill:'solid'},
    ...Array.from({length:2000},(_,i)=>({x:i%100,y:Math.floor(i/100),z:z+1,fill:'solid',finish:{top:'floor.concrete'}})),
  ])
  const {data,offsets,direction}=explodedView(station(cells))
  assert.deepEqual(direction,[0,1])
  assert.equal(offsets.get(5),20)
  assert.equal(offsets.get(10),40)
  for(const z of [1,6,11]) assert.equal(data.cells.filter(c=>c.z===z).length,2000,'exposed floor edge tiles are retained')
})

test('Tanwei retains and offsets its labelled usable concrete floors at 1, 6 and 11 metres', () => {
  const source = JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json',import.meta.url)))
  const solid = new Set(source.cells.filter(c=>c.fill==='solid').map(c=>`${c.x},${c.y},${c.z}`))
  const result = explodedView(source)
  const shown = new Set(result.data.cells.map(c=>`${c.x},${c.y},${c.z}`))
  for (const z of [1,6,11]) {
    const floors = source.cells.filter(c=>c.z===z&&c.fill==='solid'&&c.finish?.top==='floor.concrete'&&
      (c.room||['paid','unpaid','platform','restricted'].includes(c.zone))&&
      !solid.has(`${c.x},${c.y},${c.z+1}`)&&!c.tags?.some(t=>t.includes('wall')||t==='opening-ceiling'||t==='suspended-ceiling'))
    assert.ok(floors.length>100)
    const offset=result.offsets.get(z-1)
    for(const c of floors) assert.ok(shown.has(`${c.x+result.direction[0]*offset},${c.y+result.direction[1]*offset},${z}`))
  }
  assert.ok(result.offsets.get(5)>result.offsets.get(0))
  assert.ok(result.offsets.get(10)>result.offsets.get(5))
})

test('live poses use tray offsets without changing worker buffers or allocating each frame', () => {
  const offsets = new Map([[-10,20],[-5,40]])
  const source = new Float32Array([2,3,-9,1,0,123, 4,5,-4,2,0,124])
  const before = source.slice(), target = new Float32Array(source.length)
  assert.equal(explodedPoses(source,6,offsets,0,0,target),target)
  assert.deepEqual([...target],[22,23,-9,1,0,123,44,45,-4,2,0,124])
  assert.deepEqual(source,before)
  const across = explodedPoses(source,6,offsets,0,0,new Float32Array(source.length),false,[0,1])
  assert.deepEqual([...across],[2,23,-9,1,0,123,4,45,-4,2,0,124],'live passengers follow the same short-axis shift')
  const train = new Float32Array([2,3,-5.1,6,0,0,0,1,0,0])
  assert.equal(explodedPoses(train,10,offsets,0,0,new Float32Array(10),true)[0],42)
})

test('live lift cabin belongs to one tray, including the terminal landing', () => {
  const offsets = new Map([[-10,20],[-5,40]])
  for (const cabin of [-9,-4,1]) {
    const source = new Float32Array([2,3,-10,0,cabin,.5,3])
    const out = explodedLiftPoses(source,offsets)
    assert.equal(out.length,14)
    const present = [0,7].filter(i => !(out[i+6]&EXPLODED_LIFT_ABSENT))
    assert.equal(present.length,1)
    assert.equal(out[present[0]+4],cabin)
    assert.equal(out[present[0]],cabin===-9?22:42)
    assert.deepEqual([...source],[2,3,-10,0,cabin,.5,3])
    const across = explodedLiftPoses(source,offsets,[0,1])
    assert.equal(across[0],2)
    assert.equal(across[1],23)
  }
})

test('furnishings cannot create a floor or affect the structure packing', () => {
  const cells = [...slab(-10), ...slab(-5)]
  const bare = explodedView(station(cells))
  const furnished = explodedView(station(cells, [
    { id: 'on-floor', type: 'bench', x: 2, y: 2, z: -10 },
    { id: 'remote', type: 'bench', x: 100, y: 100, z: -20 },
  ]))
  assert.deepEqual(furnished.levels, bare.levels)
  assert.deepEqual(furnished.offsets, bare.offsets)
  assert.deepEqual(furnished.direction, bare.direction)
  assert.ok(furnished.data.modules.some(module => module.id === 'on-floor'))
})

test('ExplodedLayout applies the floor current wall visibility to deferred wall meshes and keeps tray placement intact', () => {
  const layout = new ExplodedLayout([-10])
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x888888 })
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcccccc })
  const structure = new THREE.Group()
  structure.userData.levelZ = -10
  const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.2), floorMat)
  slabMesh.position.set(0, 0, -10)
  slabMesh.userData.wall = false
  structure.add(slabMesh)

  const deferred = new THREE.Group()
  deferred.userData.levelZ = -10
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3), wallMat)
  wallMesh.position.set(0, 0, -8)
  wallMesh.userData.wall = true
  deferred.add(wallMesh)

  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  camera.position.set(0, -10, -8)
  camera.lookAt(0, 0, -8)
  camera.updateMatrixWorld()

  try {
    // 1) Publish initial structure frame, move the tray, then hide walls before deferred equipment flushes.
    layout.generate([structure], [], 0, undefined, false)
    layout.shifts[0].set(3, -2, 0)
    layout.setVisibility(0, true, false)

    // 2) Stage and flush deferred wall equipment while walls are hidden.
    layout.generate([deferred], [], 0, undefined, true)
    assert.equal(layout.hasPending(), true)
    while (!layout.flushPendingStep(100)) { /* drain */ }

    const wallDraws = layout.floors[0].children.filter(m => m.userData.wall === true)
    assert.equal(wallDraws.length, 1)
    assert.equal(wallDraws[0].visible, false, 'deferred wall mesh initializes hidden from owning tray')

    // Ray aimed through the shifted wall above the slab misses when walls are hidden.
    camera.position.set(3, -10, -8)
    camera.lookAt(3, -2, -8)
    camera.updateMatrixWorld()
    assert.equal(layout.pick(0, 0, camera), null, 'hidden deferred wall mesh is excluded from picks')

    // 3) Restoring walls reveals the deferred wall mesh and makes it pickable without moving the tray.
    layout.setVisibility(0, true, true)
    assert.equal(wallDraws[0].visible, true, 'showing walls restores deferred wall meshes')
    assert.deepEqual(layout.shifts[0].toArray(), [3, -2, 0], 'tray placement is unchanged')
    assert.equal(layout.pick(0, 0, camera), 0, 'restored wall mesh is pickable again')
  } finally {
    layout.dispose()
    slabMesh.geometry.dispose()
    wallMesh.geometry.dispose()
    floorMat.dispose()
    wallMat.dispose()
  }
})

test('ExplodedLayout preserves separate draw boundaries for transparent untextured and textured surfaces', () => {
  const prevDoc = globalThis.document
  const mkCanvas = (w = 32, h = 16) => {
    const node = { width: w, height: h }, { g } = stubCanvas(w, h)
    g.canvas = node; node.getContext = () => g
    return node
  }
  globalThis.document = { createElement: () => mkCanvas() }

  const layout = new ExplodedLayout([-10])
  const group = new THREE.Group()
  group.userData.levelZ = -10
  const untexA = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5, depthWrite: false })
  const untexB = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5, depthWrite: false })
  const untexMid = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5, depthWrite: false })
  const texA = new THREE.CanvasTexture(mkCanvas())
  const texB = new THREE.CanvasTexture(mkCanvas())
  const texMatA = new THREE.MeshBasicMaterial({ map: texA, transparent: true, opacity: 0.5, depthWrite: false })
  const texMatB = new THREE.MeshBasicMaterial({ map: texB, transparent: true, opacity: 0.5, depthWrite: false })
  const opaqueA = new THREE.MeshStandardMaterial({ color: 0x224466, roughness: 0.5 })
  const opaqueB = new THREE.MeshStandardMaterial({ color: 0x224466, roughness: 0.5 })

  const meshes = [
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), untexA),
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), untexMid),
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), untexB),
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), texMatA),
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), texMatB),
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), opaqueA),
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), opaqueB),
  ]
  meshes.forEach((m, i) => { m.position.set(i * 2, 0, -9); group.add(m) })

  try {
    layout.generate([group], [], 0, undefined, false)
    // 5 transparent meshes must remain 5 independent draws + 2 opaque identical materials merge into 1 = 6 total.
    const transparentDraws = layout.floors[0].children.filter(m => m.material.transparent)
    const opaqueDraws = layout.floors[0].children.filter(m => !m.material.transparent)
    assert.equal(transparentDraws.length, 5, 'separately owned untextured and textured transparent surfaces keep separate draws')
    assert.equal(opaqueDraws.length, 1, 'opaque untextured surfaces still canonicalize and merge')
  } finally {
    layout.dispose()
    meshes.forEach(m => m.geometry.dispose())
    ;[untexA, untexB, untexMid, texMatA, texMatB, opaqueA, opaqueB].forEach(m => m.dispose())
    texA.dispose(); texB.dispose()
    globalThis.document = prevDoc
  }
})
