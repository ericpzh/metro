import test from 'node:test'
import assert from 'node:assert/strict'
import { solidCellsInBounds } from '../src/sim/solidCellIndex.ts'
import { boxesOverlap } from '../src/sim/placement.ts'

const boxFor = c => ({ x0:c.x, x1:c.x+1, y0:c.y, y1:c.y+1, z0:c.z, z1:c.z+1 })
test('roof cell queries retain every actual collision across bucket boundaries and heights', () => {
  const cells = []
  for (const x of [-17,-16,-1,0,15,16,17]) for (const y of [-17,-1,0,16]) for (const z of [-5,0,1,5]) cells.push({x,y,z,fill:'solid'})
  cells.push({x:0,y:0,z:0,fill:'void'})
  for (const x of [-17.5,-16,0,15.5,16]) for (const z of [-5,0.25,1,5]) {
    const box = {x0:x,x1:x+1.5,y0:-1,y1:1,z0:z,z1:z+0.25}
    const expected = cells.filter(c => c.fill === 'solid' && boxesOverlap(box,boxFor(c)))
    const actual = [...solidCellsInBounds(cells,box)].filter(c => boxesOverlap(box,boxFor(c)))
    assert.deepEqual(new Set(actual), new Set(expected))
  }
  const broad = {x0:-10_000,x1:10_000,y0:-10_000,y1:10_000,z0:-10,z1:10}
  assert.equal([...solidCellsInBounds(cells,broad)].length,cells.length-1,'broad imports keep their solid cells')
  const next = [...cells,{x:0,y:0,z:2,fill:'solid'}]
  const overhead = {x0:0,x1:1,y0:0,y1:1,z0:2,z1:2.25}
  assert.equal([...solidCellsInBounds(cells,overhead)].length,0)
  assert.equal([...solidCellsInBounds(next,overhead)].length,1,'immutable replacement invalidates the index')
})
