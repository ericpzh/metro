import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { createModelMaterials,disposeModelMaterials,setDoorsSides } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'
await geometryDetailReady

test('Tanwei raised platforms remain visible at 10 m even with stale ceiling tags', async () => {
  const { readFileSync } = await import('node:fs')
  const demo = JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json', import.meta.url), 'utf8'))
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => material, outline: material }, {}, {})
  ctx.detailEnabled = false
  const chunks = new ChunkSystem(ctx), level = new LevelSystem(ctx)
  level.chunks = chunks
  level.modules = { restoreMovingModule() {}, moduleMeshes: new THREE.Group(), syncBatches() {} }
  level.trains = { trainGroup: new THREE.Group() }
  const targets = [[15, 2], [22, -5]]
  try {
    for (const tag of [undefined, 'opening-ceiling', 'suspended-ceiling']) {
      const cells = demo.cells.map(c => c.z === 11 && targets.some(([x,y]) => c.x === x && c.y === y)
        ? { ...c, tags: tag ? [tag] : undefined } : c)
      chunks.prepareStation({ ...demo, cells }); chunks.meshStation(); ctx.scene.updateMatrixWorld(true)
      for (const z of [5, 10, 15, 10]) for (const on of [false, true]) {
        level.setLevel(z, false); level.setAutoCeiling(on)
        if (z !== 10) continue
        for (const [x,y] of targets) {
          const ray = new THREE.Raycaster(new THREE.Vector3(x+.5,y+.5,13), new THREE.Vector3(0,0,-1))
          const hits = ray.intersectObjects(chunks.chunkMeshes.filter(m => m.visible))
          assert.ok(hits.some(h => Math.abs(h.point.z-12)<1e-6), `${x},${y},11 visible at 10 m, ceiling=${on}, tag=${tag}`)
        }
      }
    }
  } finally { chunks.disposeChunks(); material.dispose() }
})

test('Hide ceiling preserves Tianhe -5 floor through level changes and ramp ceiling tags', async () => {
  const { emptyStation } = await import('../src/data/reference-station.ts')
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => material, outline: material }, {}, {})
  ctx.detailEnabled = false
  const chunks = new ChunkSystem(ctx), level = new LevelSystem(ctx)
  level.chunks = chunks
  level.modules = { restoreMovingModule() {}, moduleMeshes: new THREE.Group(), syncBatches() {} }
  level.trains = { trainGroup: new THREE.Group() }
  const ray = new THREE.Raycaster(new THREE.Vector3(97.5, -98.5, -3), new THREE.Vector3(0, 0, -1))
  try {
    for (const tags of [undefined, ['opening-ceiling'], ['suspended-ceiling']]) {
      const cells = [-20, -15, -5].map(z => ({ x: 97, y: -99, z, fill: 'solid', ...(z === -5 ? { tags } : {}) }))
      cells.push({ x: 97, y: -100, z: -5, fill: 'solid', tags: ['opening-ceiling'] })
      chunks.prepareStation({ ...emptyStation(), cells }); chunks.meshStation(); ctx.scene.updateMatrixWorld(true)
      for (const z of [-10, -5, 0, -5]) for (const on of [false, true]) {
        level.setLevel(z, false); level.setAutoCeiling(on)
        if (z !== -5) continue
        const hits = ray.intersectObjects(chunks.chunkMeshes.filter(m => m.visible))
        assert.ok(hits.some(h => Math.abs(h.point.z + 4) < 1e-6), `active floor survives ceiling=${on}, tags=${tags}`)
      }
    }
  } finally { chunks.disposeChunks(); material.dispose() }
})

test('untagged Tianhe ceiling uses the independently hideable mesh pass and invalidates after support edits', async () => {
  const { emptyStation } = await import('../src/data/reference-station.ts')
  const material = new THREE.MeshBasicMaterial()
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => material, outline: material }, {}, {})
  const chunks = new ChunkSystem(ctx)
  const cells = []
  for (let x = 19; x <= 21; x++) for (let y = -103; y <= -101; y++) {
    for (const z of [-15, -11, -5]) cells.push({ x, y, z, fill: 'solid' })
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(20.5, -101.5, -8), new THREE.Vector3(0, 0, -1))
  const install = cells => { chunks.prepareStation({ ...emptyStation(), cells }); chunks.meshStation(); ctx.scene.updateMatrixWorld(true) }
  const hitCeiling = () => chunks.chunkMeshes.filter(m => m.userData.suspendedCeiling && ray.intersectObject(m).length)
  try {
    install(cells)
    assert.ok(hitCeiling().length > 0, 'reported slab is in the pass Hide ceiling switches off')
    install([...cells, ...[-14, -13, -12].map(z => ({ x: 20, y: -102, z, fill: 'solid' }))])
    assert.equal(hitCeiling().length, 0, 'wall support restores the ordinary block pass after an edit')
  } finally { chunks.disposeChunks(); material.dispose() }
})

test('ground-window-only updates preserve authored chunks and match fresh meshing on expansion and shrink',async()=>{
  const {emptyStation}=await import('../src/data/reference-station.ts')
  const material=new THREE.MeshBasicMaterial()
  const make=()=>new ChunkSystem(new SceneContextData(new THREE.Scene(),{finish:()=>material,outline:material},{},{}))
  const actual=make(),fresh=make()
  const cells=[{x:0,y:0,z:-5,fill:'solid'},{x:32,y:32,z:-5,fill:'solid'}]
  const before={...emptyStation(),cells,modules:[]},after={...before,modules:[{id:'edge',type:'bench',x:40,y:20,z:0,cfg:{}}]}
  const snapshot=chunks=>chunks.chunkMeshes.map(m=>JSON.stringify({level:m.userData.levelZ,ground:!!m.userData.ground,
    attributes:Object.fromEntries(Object.entries(m.geometry.attributes).map(([k,a])=>[k,Array.from(a.array)])),indices:Array.from(m.geometry.index.array)})).sort()
  try{
    actual.prepareStation(before);actual.meshStation()
    const original=actual.chunkMeshes.filter(m=>!m.userData.ground),buffers=original.map(m=>m.geometry)
    let disposed=0;buffers.forEach(g=>g.addEventListener('dispose',()=>disposed++))
    for(const data of [after,before]){
      const structural = [actual.ctx.thinSides,actual.ctx.hiddenCells,actual.ctx.trackCellSet,actual.ctx.slopeCuts]
      actual.prepareStation(data,undefined,true);actual.meshStation(true)
      fresh.prepareStation(data);fresh.meshStation()
      assert.deepEqual(actual.ctx.solid,fresh.ctx.solid)
      assert.deepEqual(actual.ctx.finishes,fresh.ctx.finishes)
      assert.deepEqual([actual.ctx.thinSides,actual.ctx.hiddenCells,actual.ctx.trackCellSet,actual.ctx.slopeCuts],structural)
      assert.deepEqual(snapshot(actual),snapshot(fresh),'local ground pass must match full geometry including edge halos')
      assert.ok(original.every(m=>actual.chunkMeshes.includes(m)))
      assert.equal(disposed,0,'authored geometry stays uploaded')
      assert.ok(actual.chunkKeyCellVisits<fresh.chunkKeyCellVisits,'only boundary ground chunks are hashed')
    }
  }finally{actual.disposeChunks();fresh.disposeChunks();material.dispose()}
})

test('unbatched moving equipment keeps mesh identity, exact picks and original disposal ownership',()=>{
  const root=new THREE.Group(),geometry=new THREE.SphereGeometry(1,48,24),material=new THREE.MeshStandardMaterial()
  const wing=new THREE.Mesh(geometry,material),hidden=wing.clone(),batched=wing.clone()
  hidden.visible=false;batched.layers.set(BATCH_SOURCE_LAYER);root.add(wing,hidden,batched)
  const ray=new THREE.Raycaster(new THREE.Vector3(.2,.1,4),new THREE.Vector3(0,0,-1)),raycast=wing.raycast
  const hits=ray.intersectObject(wing).map(h=>h.point.toArray()),matrix=wing.matrix
  const detail=new SourceGeometryDetail();detail.apply(root,false);assert.equal(wing.geometry,geometry)
  detail.apply(root,true);const far=wing.geometry;assert.notEqual(far,geometry)
  assert.equal(hidden.geometry,geometry);assert.equal(batched.geometry,geometry)
  assert.equal(wing.matrix,matrix);assert.deepEqual(ray.intersectObject(wing).map(h=>h.point.toArray()),hits)
  assert.equal(wing.geometry,far)
  detail.restore();assert.equal(wing.geometry,geometry);assert.equal(wing.raycast,raycast)
  let disposed=0;far.addEventListener('dispose',()=>disposed++)
  geometry.dispose();assert.equal(disposed,1);material.dispose()
})

test('chunk detail keeps original ray hits and restores shared full geometry before release',()=>{
  const ctx=new SceneContextData(new THREE.Scene(),{},{},{}),chunks=new ChunkSystem(ctx)
  const near=new THREE.SphereGeometry(1,48,24),mesh=new THREE.Mesh(near,new THREE.MeshBasicMaterial())
  const ray=new THREE.Raycaster(new THREE.Vector3(.2,.1,4),new THREE.Vector3(0,0,-1))
  const fullHits=ray.intersectObject(mesh).map(h=>h.point.toArray())
  const originalCast=mesh.raycast
  chunks.setGeometryDetail(mesh,false);chunks.setGeometryDetail(mesh,true)
  const far=mesh.geometry;assert.notEqual(far,near)
  assert.deepEqual(ray.intersectObject(mesh).map(h=>h.point.toArray()),fullHits)
  assert.equal(mesh.geometry,far,'picking restores the drawn approximation')
  chunks.setGeometryDetail(mesh,false);assert.equal(mesh.geometry,near)
  chunks.setGeometryDetail(mesh,true)
  let farDisposal=0,nearDisposal=0
  far.addEventListener('dispose',()=>farDisposal++);near.addEventListener('dispose',()=>nearDisposal++)
  chunks.chunkMeshes=[mesh];chunks.releaseChunks()
  assert.equal(mesh.geometry,near);assert.equal(mesh.raycast,originalCast)
  assert.equal(farDisposal,1);assert.equal(nearDisposal,1)
  chunks.disposeChunks();mesh.material.dispose()
})

test('other-floor train geometry reduces without changing doors, and Low quality stays reduced in Hide UI',()=>{
  const previous=globalThis.document
  globalThis.document={createElement:()=>{const c={width:0,height:0};const {g}=stubCanvas();g.canvas=c;c.getContext=()=>g;return c}}
  let mats,trains
  try {
    mats=createModelMaterials()
    const ctx=new SceneContextData(new THREE.Scene(),{},mats,{})
    trains=new TrainSystem(ctx);trains.level={applyGroupLevel(g){g.visible=true}}
    trains.setTrains(new Float32Array([0,0,1,1,0,0,0x336699,1,0,1]))
    const group=trains.trainGroup.children[0],details=trains.details.get(group),swapped=details.filter(d=>d.far)
    assert.ok(swapped.length>0)
    assert.ok(swapped.every(d=>d.near instanceof THREE.BufferGeometry&&d.far instanceof THREE.BufferGeometry))
    setDoorsSides(group,.5,0);group.updateMatrixWorld(true)
    const doors=group.userData.doors.map(d=>d.position.toArray())
    ctx.activeZ=4;trains.updateGeometryDetail()
    assert.ok(swapped.every(d=>d.mesh.geometry===d.far))
    assert.deepEqual(group.userData.doors.map(d=>d.position.toArray()),doors)
    ctx.hideUI=true;ctx.graphicsQuality='low';trains.updateGeometryDetail()
    assert.ok(swapped.every(d=>d.mesh.geometry===d.far),'Hide UI preserves the chosen Low quality')
    ctx.hideUI=false;trains.updateGeometryDetail();assert.ok(swapped.every(d=>d.mesh.geometry===d.far))
    ctx.detailEnabled=false;trains.updateGeometryDetail();assert.ok(swapped.every(d=>d.mesh.geometry===d.near))
    let disposed=0;swapped.forEach(d=>d.far.addEventListener('dispose',()=>disposed++))
    trains.dispose();assert.equal(disposed,swapped.length,'every prepared approximation is released exactly once')
  } finally {trains?.dispose();if(mats)disposeModelMaterials(mats);globalThis.document=previous}
})


test('PSD base wins the platform block volume; no-screen restores it and invalidates chunk reuse', async () => {
 const { emptyStation }=await import('../src/data/reference-station.ts')
 const { rotateLocal }=await import('../src/sim/track.ts')
 for(const side of ['left','right'])for(const rot of [0,1,2,3]) {
  const material=new THREE.MeshStandardMaterial()
  const ctx=new SceneContextData(new THREE.Scene(),{finish:()=>material,outline:material},{},{})
  const chunks=new ChunkSystem(ctx)
  const edge={id:'edge',type:'platform-edge',x:15,y:15,z:4,w:2,rot,cfg:{line:'1',side,psd:'half'}}
  const [runX,runY]=rotateLocal(rot,1,0)
  const cells=[0,1].map(i=>({x:edge.x+i*runX,y:edge.y+i*runY,z:4,fill:'solid'}))
  const data={...emptyStation(),cells,modules:[edge]}
  const toward=side==='right'?1:-1
  const hit=(i,across)=> {
   const [dx,dy]=rotateLocal(rot,i,toward*across)
   for(const mesh of chunks.chunkMeshes)mesh.updateMatrixWorld(true)
   return new THREE.Raycaster(new THREE.Vector3(edge.x+.5+dx,edge.y+.5+dy,8),new THREE.Vector3(0,0,-1)).intersectObjects(chunks.chunkMeshes)
  }
  try {
   chunks.prepareStation(data,cells);chunks.meshStation()
   const geometries=chunks.chunkMeshes.map(m=>m.geometry)
   for(const i of [0,1]) {
    assert.equal(hit(i,.34).length,0,'the complete block column under the frame is cut out')
    assert.ok(hit(i,.18).some(h=>Math.abs(h.point.z-5)<1e-6),'yellow line keeps its platform foundation')
   }
   chunks.prepareStation({...data,modules:[{...edge,cfg:{...edge.cfg,psd:'full'}}]},cells);chunks.meshStation()
   assert.deepEqual(chunks.chunkMeshes.map(m=>m.geometry),geometries,'same base footprint retains identical chunks')
   chunks.prepareStation({...data,modules:[{...edge,cfg:{...edge.cfg,psd:'none'}}]},cells);chunks.meshStation()
   for(const i of [0,1])assert.ok(hit(i,.34).some(h=>Math.abs(h.point.z-5)<1e-6),'no PSD restores the full platform block')
   assert.ok(chunks.chunkMeshes.every(m=>!geometries.includes(m.geometry)),'removing a PSD cannot reuse a carved chunk')
  } finally {chunks.disposeChunks();material.dispose()}
 }
})


test('Tanwei wall sides survive hidden suspended ceilings and neighbour retagging across chunks', async () => {
  const { readFileSync } = await import('node:fs')
  const { LevelSystem } = await import('../src/render/scene/systems/LevelSystem.ts')
  const demo = JSON.parse(readFileSync(new URL('../src/data/tanwei-station.json', import.meta.url), 'utf8'))
  const material = new THREE.MeshBasicMaterial()
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => material, outline: material }, {}, {})
  ctx.activeZ = -5
  const chunks = new ChunkSystem(ctx), level = new LevelSystem(ctx)
  level.chunks = chunks
  level.modules = { moduleMeshes: new THREE.Group(), syncBatches() {}, restoreMovingModule() {} }
  level.trains = { trainGroup: new THREE.Group() }
  const wall = demo.cells.find(c => c.x === 16 && c.y === 6 && c.z === -1)
  const ceilings = demo.cells.filter(c => c.x === 16 && [5, 7].includes(c.y) && c.z === -1)
  assert.equal(ceilings.length, 2)
  const sideHit = (x, y, dx, dy) => {
    ctx.scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, -.5), new THREE.Vector3(dx, dy, 0), 0, .75)
    return ray.intersectObjects(chunks.chunkMeshes.filter(m => m.visible && !m.userData.suspendedCeiling)).length > 0
  }
  const install = cells => { chunks.prepareStation({ ...demo, cells, modules: [] }); chunks.meshStation(); ctx.levelKey = ''; level.applyLevel() }
  try {
    install([wall, ...ceilings])
    level.setAutoCeiling(true)
    assert.ok(sideHit(16.5, 5.5, 0, 1), 'south wall face remains behind hidden Tanwei ceiling')
    assert.ok(sideHit(16.5, 7.5, 0, -1), 'north wall face remains behind hidden Tanwei ceiling')
    const geometry = chunks.chunkMeshes.map(m => m.geometry)
    level.setAutoCeiling(false)
    assert.ok(chunks.chunkMeshes.filter(m => m.userData.suspendedCeiling).every(m => m.visible))
    level.setAutoCeiling(true)
    assert.deepEqual(chunks.chunkMeshes.map(m => m.geometry), geometry, 'toggle never remeshes or allocates geometry')
    // The second report points at the back of this stepped wall. Its exposed
    // ledge at y=12 was missing its top beneath a hidden ceiling at z=-1.
    const strip = demo.cells.filter(c => c.x === 18 && c.y >= 11 && c.y <= 14 && c.z >= -5 && c.z <= 0)
    install(strip)
    ctx.scene.updateMatrixWorld(true)
    const ledge = new THREE.Raycaster(new THREE.Vector3(18.5, 12.5, -.5), new THREE.Vector3(0, 0, -1), 0, .75)
    const ledgeHits = ledge.intersectObjects(chunks.chunkMeshes.filter(m => m.visible && !m.userData.suspendedCeiling))
    assert.ok(ledgeHits.some(h => Math.abs(h.point.z + 1) < 1e-6), 'Tanwei ledge top beneath the hidden ceiling closes the wall volume')
    const oblique = new THREE.Raycaster(new THREE.Vector3(18.5, 12.1, -.25), new THREE.Vector3(0, .4, -.75).normalize(), 0, 3)
    assert.ok(oblique.intersectObjects(chunks.chunkMeshes.filter(m => m.visible && !m.userData.suspendedCeiling)).some(h => Math.abs(h.point.z + 1) < 1e-6), 'view from -y hits the ledge instead of seeing inside the wall')
    // West neighbour is across the x=16 chunk boundary: only its tag changes.
    const west = { x: 15, y: 6, z: -1, fill: 'solid' }
    install([wall, west])
    assert.equal(sideHit(15.5, 6.5, 1, 0), false, 'ordinary shared sides stay culled')
    install([wall, { ...west, tags: ['suspended-ceiling'] }])
    assert.ok(sideHit(15.5, 6.5, 1, 0), 'retagging invalidates the neighbouring cached wall chunk')
    install([wall, west])
    assert.equal(sideHit(15.5, 6.5, 1, 0), false, 'restoring a solid neighbour culls the side again')
    install([wall, { ...west, x: 17, tags: ['suspended-ceiling'] }])
    assert.ok(sideHit(17.5, 6.5, -1, 0), 'east wall side also survives a hidden ceiling')
  } finally { chunks.disposeChunks(); material.dispose() }
})

test('stair opening upper-floor lining follows the -10 storey across edits at a chunk seam', async () => {
  const { emptyStation } = await import('../src/data/reference-station.ts')
  const material = new THREE.MeshBasicMaterial({side: THREE.DoubleSide})
  const ctx = new SceneContextData(new THREE.Scene(), {finish:()=>material, outline:material}, {}, {})
  ctx.detailEnabled=false
  const chunks=new ChunkSystem(ctx), level=new LevelSystem(ctx)
  level.chunks=chunks
  level.modules={restoreMovingModule(){},moduleMeshes:new THREE.Group(),syncBatches(){}}
  level.trains={trainGroup:new THREE.Group()}
  const cells=[]
  for(const x of [79,80])for(const z of [-15,-11,-10])cells.push({x,y:-101,z,fill:'solid'})
  const ray=new THREE.Raycaster(new THREE.Vector3(80.5,-100.5,-9),new THREE.Vector3(0,0,-1))
  const upperRay=new THREE.Raycaster(new THREE.Vector3(79.5,-100.5,-9),new THREE.Vector3(0,0,-1))
  try {
    for(const next of [cells,cells.filter(c=>!(c.x===80&&c.z===-10)),cells]) {
      chunks.prepareStation({...emptyStation(),cells:next});chunks.meshStation();ctx.scene.updateMatrixWorld(true)
      level.setLevel(-15,false);level.setAutoCeiling(false)
      const hits=ray.intersectObjects(chunks.chunkMeshes.filter(m=>m.visible))
      assert.ok(hits.length)
      assert.ok(hits.every(h=>h.point.z<=-14),'upper floor and its lining cannot obstruct the lower editing floor')
      level.setLevel(-10,false)
      assert.ok(upperRay.intersectObjects(chunks.chunkMeshes.filter(m=>m.visible)).some(h=>h.point.z===-9),'upper floor remains available on its own storey')
    }
  }finally{chunks.disposeChunks();material.dispose()}
})
