import test from 'node:test'
import assert from 'node:assert/strict'
import { clearContactFinishes } from '../src/sim/contactFinishes.ts'
import { toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { useStore } from '../src/app/store.ts'

globalThis.Worker = class { postMessage() {} }

test('touching full blocks lose only their contacting finishes on load and commit', () => {
  const wall = { x: 38, y: -170, z: -2, fill: 'solid', finish: { top: 'wall.enamel', s: 'wall.enamel' } }
  const ceiling = { x: 38, y: -170, z: -1, fill: 'solid', tags: ['suspended-ceiling'], finish: { bottom: 'ceil.baffle', top: 'ceil.baffle' } }
  const loaded = toState({ ...emptyStation(), cells: [wall, ceiling] })
  assert.deepEqual(loaded.cells.map(c => c.finish), [{ s: 'wall.enamel' }, { top: 'ceil.baffle' }])
  assert.equal(wall.finish.top, 'wall.enamel', 'load does not mutate the supplied save')

  const before = useStore.getState()
  try {
    const station = toState({ ...emptyStation(), cells: [wall] })
    useStore.setState({ station, past: [], future: [] })
    useStore.getState().commit({ ...station, cells: [...station.cells, ceiling] })
    assert.deepEqual(useStore.getState().station.cells.map(c => c.finish), [{ s: 'wall.enamel' }, { top: 'ceil.baffle' }])
    useStore.getState().undo()
    assert.equal(useStore.getState().station.cells[0].finish.top, 'wall.enamel')
  } finally { useStore.setState(before) }
})

test('all six directions are cleaned, while partial and void neighbours preserve finishes', () => {
  const faces = { n: 'a', s: 'a', e: 'a', w: 'a', top: 'a', bottom: 'a' }
  const center = { x: 0, y: 0, z: -5, fill: 'solid', finish: faces }
  const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  const cells = [center, ...offsets.map(([x,y,z]) => ({ x, y, z: z - 5, fill: 'solid' }))]
  assert.equal(clearContactFinishes(cells)[0].finish, undefined)
  const partial = [{ ...center }, { x: 1, y: 0, z: -5, fill: 'solid', tags: ['half-wall:w'] }, { x: -1, y: 0, z: -5, fill: 'void' }]
  assert.equal(clearContactFinishes(partial), partial)
})
