import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPlacementTargets } from '../../tools/placement-benchmark-targets.mjs'

test('placement benchmark preserves its five authored targets when extra cells are visible', () => {
  const expected=[[-59,45,0],[-39,62,0],[-19,79,0],[2,96,0],[-76,-35,0]]
  const cells=[[-80,28,0],...expected.slice(0,4),expected[4],[-58,-20,0]]
  const points=cells.map((cell,index)=>({cell,index}))
  const ordered=selectPlacementTargets(points,expected,5)
  assert.deepEqual(ordered.slice(0,5).map(point=>point.cell),expected)
  assert.equal(ordered[5],points[0])
  assert.equal(points[0].cell[0],-80,'input points remain unchanged')
  assert.throws(()=>selectPlacementTargets(points.slice(0,5),expected,5),/targets changed/)
})
