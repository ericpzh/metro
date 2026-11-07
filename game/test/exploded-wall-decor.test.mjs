import test from 'node:test'
import assert from 'node:assert/strict'
import { explodedView } from '../src/render/explodedView.ts'
import { moduleLevels } from '../src/render/scene/systems/SceneSystem.ts'

const slab = z => Array.from({length:25}, (_, i) => ({x:i%5,y:Math.floor(i/5),z,fill:'solid'}))

test('wall art follows the storey containing its visible panel when its anchor is below the floor', () => {
  const art = {id:'map',type:'linemap',x:2,y:2,z:-10.01,rot:0,w:2,cfg:{mount:'wall'}}
  const source = {cells:[...slab(-15),...slab(-10)],modules:[art],levelBase:0,lines:[],name:'Test',seed:1}
  const result = explodedView(source)
  const owner = moduleLevels(art,0)[0]
  assert.equal(owner,-10)
  assert.notEqual(result.offsets.get(owner),result.offsets.get(-15))
  const moved = result.data.modules.find(m=>m.id===art.id)
  assert.ok(moved)
  assert.equal(moved.x, art.x + result.direction[0]*result.offsets.get(owner))
  assert.equal(moved.y, art.y + result.direction[1]*result.offsets.get(owner))
})
