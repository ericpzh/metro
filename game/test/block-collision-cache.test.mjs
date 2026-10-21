import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceStation } from '../src/data/reference-station.ts'
import { createModule } from '../src/build/model.ts'
import { checkBlockCells } from '../src/build/validation.ts'
import { MAX_DRAG_CELLS } from '../src/sim/constants.ts'
import { blockIndex } from '../src/sim/blockIndex.ts'
import { blockReason, equipmentBlockingCell, moduleBlockedCells, moduleEnvelope, boxesOverlap } from '../src/sim/placement.ts'
import { rampBodyBoxes } from '../src/sim/openings.ts'
import { hangerBoxes } from '../src/sim/hangers.ts'
import { canopyBodyBoxes } from '../src/sim/structures.ts'

function originalBlockers(modules, x, y, z) {
  if (!moduleBlockedCells(modules, z).has(`${x},${y},${z}`)) return []
  const cell = {x0:x,y0:y,z0:z,x1:x+1,y1:y+1,z1:z+1}
  return modules.filter(m => {
    const envelope = moduleEnvelope(m)
    const boxes = m.type === 'hanger' ? hangerBoxes(m)
      : m.type === 'roof' && m.cfg.variant === 'canopy' ? canopyBodyBoxes(m)
      : m.type === 'stair' && !m.cfg.block ? rampBodyBoxes(m)
      : envelope ? [envelope] : []
    return boxes.some(box => boxesOverlap(box, cell))
  })
}

const rectangle = (width, height) => Array.from({length:width*height},(_,i)=>[i%width,Math.floor(i/width),1])

test('blocked drag snapshots reuse exact witnesses and only check newly covered positions', () => {
  let reads = 0
  const distant = Array.from({length:1200},(_,i) => {
    const module = createModule('bench', 1000+i*3, 1000, 0, 'distant-'+i)
    return new Proxy(module,{get(target,key){ if(key==='type') reads++; return target[key] }})
  })
  const blocker = {id:'blocker',type:'booth',x:0,y:0,z:0,w:64,h:64,cfg:{kind:'ticket',stocked:true}}
  const station = {cells:[],modules:[blocker,...distant]}
  const first = checkBlockCells(station, rectangle(20,20))
  assert.equal(first.blockedCells.length,400)
  assert.deepEqual(first.colliderIds,['blocker'])
  assert.ok(reads<100000,'cold refusal must prepare modules once, not once per blocked cell: '+reads)
  const before = reads
  const index = blockIndex(station.cells,station.modules), witness = blockReason(station.cells,station.modules,3,3,1,index)
  for(let i=0;i<100;i++) assert.equal(blockReason(station.cells,station.modules,3,3,1,index),witness)
  const growing = checkBlockCells(station,rectangle(21,20))
  assert.equal(growing.blockedCells.length,420)
  assert.equal(reads,before,'growing into 20 new blocked cells must not rescan unrelated geometry')
  checkBlockCells(station,rectangle(10,10))
  const cleared = {...station,modules:distant}
  assert.equal(checkBlockCells(cleared,rectangle(21,20)).blockedCells.length,0,'removing the witness invalidates red cells')
  assert.equal(checkBlockCells(station,rectangle(21,20)).blockedCells.length,420,'another snapshot never changes the original verdict')
  const filled = {...station,cells:[{x:3,y:3,z:1,fill:'solid'}]}
  assert.equal(checkBlockCells(filled,[[3,3,1]]).blockedCells.length,0,'new cells invalidate the snapshot and held solids are skipped')
})

test('blocker buckets preserve original exact geometry and document order on both shipped demos', () => {
  for(const id of ['zoo','tanwei']) {
    const {modules} = referenceStation(id)
    const candidates = modules.filter(m=>['booth','gate','stair','hanger','roof','tvm','glass'].includes(m.type)).slice(0,35)
    for(const m of candidates) for(const [dx,dy,dz] of [[0,0,1],[-1,0,1],[1,1,2],[0,0,0]]) {
      const x=Math.floor(m.x+dx),y=Math.floor(m.y+dy),z=Math.floor(m.z+dz)
      assert.deepEqual(equipmentBlockingCell(modules,x,y,z).map(m=>m.id),originalBlockers(modules,x,y,z).map(m=>m.id),`${id} at ${x},${y},${z}`)
    }
  }
})

test('block verdicts remember accepted/opening/track cells, invalidate by immutable arrays, and bound retention', () => {
  const cells = [], modules = [], index = blockIndex(cells,modules)
  const accepted = blockReason(cells,modules,-17,-16,1,index)
  assert.equal(accepted.ok,true)
  assert.equal(blockReason(cells,modules,-17,-16,1,index),accepted)
  const track = [{x:0,y:0,z:1,fill:'solid',finish:{top:'floor.track'}}]
  const trackIndex = blockIndex(track,modules)
  assert.equal(blockReason(track,modules,0,0,1,trackIndex).reason,'track')
  assert.equal(blockReason(cells,modules,0,0,1,index).ok,true)
  const exit = createModule('exit-covered-2',0,0,0,'exit')
  const exits = [exit], exitIndex = blockIndex(cells,exits)
  let opening
  for(let x=-2;x<10&&!opening;x++) for(let y=-2;y<10&&!opening;y++) {
    const check = blockReason(cells,exits,x,y,0,exitIndex)
    if(check.reason==='opening') opening = check
  }
  assert.ok(opening)
  assert.equal(blockReason(cells,exits,...opening.cell,exitIndex),opening)
  for(let x=0;x<2*MAX_DRAG_CELLS+4;x++) blockReason(cells,modules,x,50,1,index)
  assert.equal(index.checks.size,2*MAX_DRAG_CELLS)
  assert.equal(blockReason(cells,modules,-17,-16,1,index).ok,true,'an evicted verdict is checked again')
})


test('broad imported blocker bounds avoid a huge bucket grid and keep document order', () => {
  const track = {id:'broad',type:'track',x:-32768,y:0,z:0,w:65553,d:1,rot:0,cfg:{}}
  const bench = createModule('bench',0,0,-1,'bench')
  const modules = [track,bench]
  assert.deepEqual(equipmentBlockingCell(modules,0,0,0).map(m=>m.id),originalBlockers(modules,0,0,0).map(m=>m.id))
  assert.deepEqual(equipmentBlockingCell(modules,0,0,0).map(m=>m.id),['broad','bench'])
})
