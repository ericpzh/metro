import test from 'node:test'
import assert from 'node:assert/strict'
import { ceilingCells } from '../src/render/ceilingCells.ts'
import { packKey } from '../src/sim/types.ts'

const block = (x, y, z, extra = {}) => ({ x, y, z, fill: 'solid', ...extra })

test('Tianhe Park untagged -11 slab above -15 floor is a ceiling without changing the save', () => {
  // Exact reported neighbourhood from 天河公园.metro (2).json.
  const cells = []
  for (let x = 19; x <= 21; x++) for (let y = -103; y <= -101; y++) {
    for (const z of [-15, -11, -5]) cells.push(block(x, y, z))
  }
  const before = JSON.stringify(cells)
  const result = ceilingCells(cells, 0, 5)
  assert.equal(result.has(packKey(20, -102, -11)), true)
  assert.equal(result.size, 9)
  assert.equal(result.has(packKey(20, -102, -15)), false)
  assert.equal(result.has(packKey(20, -102, -5)), false)
  assert.equal(JSON.stringify(cells), before)
})

test('ceiling inference retains wall tops, low ledges, shaped blocks and unsupported slabs', () => {
  const slab = [block(0, 0, -15), block(0, 0, -11), block(1, 0, -11)]
  const key = packKey(0, 0, -11)
  assert.ok(ceilingCells(slab, 0, 5).has(key))
  for (const z of [-14, -13, -12]) {
    assert.equal(ceilingCells([...slab, block(0, 0, z)], 0, 5).has(key), false)
  }
  assert.equal(ceilingCells(slab.slice(1), 0, 5).has(key), false)
  assert.equal(ceilingCells([block(0, 0, -15), block(0, 0, -13), block(1, 0, -13)], 0, 5).size, 0)
  assert.equal(ceilingCells([block(0, 0, -15), block(0, 0, -12, { tags: ['wall'] }), block(1, 0, -12, { tags: ['wall'] })], 0, 5).size, 0)
  assert.equal(ceilingCells([slab[0], { ...slab[1], tags: ['half-wall:n'] }, slab[2]], 0, 5).has(key), false)
  assert.equal(ceilingCells([block(0, 0, -11, { tags: ['opening-ceiling'] })], 0, 5).has(key), true)
  assert.equal(ceilingCells([block(0, 0, -11, { tags: ['suspended-ceiling'] })], 0, 5).has(key), true)
})

test('untagged stacked upper floors remain structural rather than suspended ceilings', () => {
  for (const [cx, cy] of [[-10, -90], [8, -102]]) {
    const cells = []
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const z of [-15, -11, -10, -5]) cells.push(block(x, y, z))
    }
    const before = JSON.stringify(cells)
    const result = ceilingCells(cells, 0, 5)
    assert.equal(result.size, 0)
    assert.equal(result.has(packKey(cx, cy, -11)), false)
    for (const z of [-15, -10, -5]) assert.equal(result.has(packKey(cx, cy, z)), false)
    assert.equal(JSON.stringify(cells), before)
  }
  // Stacking away from a storey boundary is still ordinary solid geometry.
  assert.equal(ceilingCells([block(0, 0, -15), block(0, 0, -12), block(1, 0, -12), block(0, 0, -11)], 0, 5).size, 0)
})

test('Tianhe -5 floor and ramp-carved upper floor remain outside the always-hidden ceiling pass', () => {
  for (const tags of [undefined, ['opening-ceiling'], ['suspended-ceiling']]) {
    const cells = [-20, -15, -5].map(z => block(97, -99, z, z === -5 ? { tags } : {}))
    cells.push(block(97, -100, -5, { tags: ['opening-ceiling'] }))
    const result = ceilingCells(cells, 0, 5)
    assert.equal(result.has(packKey(97, -99, -5)), false)
    assert.equal(result.has(packKey(97, -100, -5)), false)
  }
})
