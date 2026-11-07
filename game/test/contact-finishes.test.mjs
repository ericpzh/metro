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
  const block = { ...ceiling, tags: undefined }
  const loaded = toState({ ...emptyStation(), cells: [wall, block] })
  assert.deepEqual(loaded.cells.map(c => c.finish), [{ s: 'wall.enamel' }, { top: 'ceil.baffle' }])
  assert.equal(wall.finish.top, 'wall.enamel', 'load does not mutate the supplied save')

  const before = useStore.getState()
  try {
    const station = toState({ ...emptyStation(), cells: [wall] })
    useStore.setState({ station, past: [], future: [] })
    useStore.getState().commit({ ...station, cells: [...station.cells, block] })
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
  const partial = [{ ...center }, { x: 1, y: 0, z: -5, fill: 'solid', tags: ['half-wall:n'] }, { x: -1, y: 0, z: -5, fill: 'void' }]
  assert.equal(clearContactFinishes(partial), partial)
})


test('covered thin-wall and corner faces clear without losing exposed inset faces', () => {
  for (const [side, dx, dy, inner] of [['n',0,1,'s'], ['e',1,0,'w'], ['s',0,-1,'n'], ['w',-1,0,'e']]) {
    const panel = { x:0, y:0, z:-5, fill:'solid', tags:[`half-wall:${side}`], finish:{ [side]:'wall.enamel', [inner]:'wall.enamel', top:'wall.enamel' } }
    const full = { x:dx, y:dy, z:-5, fill:'solid' }
    const ceiling = { x:0, y:0, z:-4, fill:'solid' }
    const [cleaned] = clearContactFinishes([panel, full, ceiling])
    assert.deepEqual(cleaned.finish, { [inner]:'wall.enamel' })
    assert.equal(panel.finish.top, 'wall.enamel')
  }
  const corner = { x:0, y:0, z:-5, fill:'solid', tags:['half-corner:n'], finish:{ n:'wall.enamel', e:'wall.enamel', top:'wall.enamel' } }
  const cleaned = clearContactFinishes([corner, { x:0,y:1,z:-5,fill:'solid' }, { x:1,y:0,z:-5,fill:'solid' }, { x:0,y:0,z:-4,fill:'solid' }])[0]
  assert.deepEqual(cleaned.finish, { e:'wall.enamel' }, 'the inset east face stays visible')
})

test('wedge slopes and partially covered faces retain finishes; covered bases and ends clear', () => {
  for (const triangle of ['upper', 'lower']) for (const side of ['n','e','s','w']) {
    const slope = triangle === 'upper' ? 'top' : 'bottom'
    const base = triangle === 'upper' ? 'bottom' : 'top'
    const dz = triangle === 'upper' ? -1 : 1
    const wedge = { x:0,y:0,z:-5,fill:'solid',tags:[`tri-${triangle}:${side}`],finish:{ [base]:'a', [slope]:'b', [side]:'c' } }
    const offset = { n:[0,1], e:[1,0], s:[0,-1], w:[-1,0] }[side]
    const cells = [wedge, { x:0,y:0,z:-5+dz,fill:'solid' }, { x:offset[0],y:offset[1],z:-5,fill:'solid' }]
    assert.deepEqual(clearContactFinishes(cells)[0].finish, { [slope]:'b' }, `${triangle} ${side}`)
  }
  const full = { x:0,y:0,z:-5,fill:'solid',finish:{top:'a'} }
  const partial = { x:0,y:0,z:-4,fill:'solid',tags:['half-wall:n'] }
  assert.equal(clearContactFinishes([full,partial])[0].finish.top, 'a')
})

test('matching thin-wall contacts clean both faces and partial overlap keeps the larger face', () => {
  const panel = { x:0,y:0,z:-5,fill:'solid',tags:['half-wall:n'],finish:{e:'a'} }
  const same = { x:1,y:0,z:-5,fill:'solid',tags:['half-wall:n'],finish:{w:'b'} }
  assert.deepEqual(clearContactFinishes([panel,same]).map(c => c.finish), [undefined,undefined])
  const cappedPanel = { ...panel, finish:{top:'a'} }
  const corner = { x:0,y:0,z:-4,fill:'solid',tags:['half-corner:n'],finish:{bottom:'b'} }
  const [a,b] = clearContactFinishes([cappedPanel,corner])
  assert.equal(a.finish.top, 'a', 'part of the panel top remains visible')
  assert.equal(b.finish, undefined, 'the smaller corner bottom is fully covered')
})


test('suspended ceilings preserve finishes at contact on load and commit', () => {
  for (const tag of [undefined, 'half-wall:n', 'half-corner:n', 'tri-lower:n']) {
    const wall = { x:0,y:0,z:-5,fill:'solid', ...(tag ? { tags:[tag] } : {}), finish:{top:'wall.enamel'} }
    const ceiling = { x:0,y:0,z:-4,fill:'solid',tags:['suspended-ceiling'],finish:{bottom:'ceil.baffle'} }
    const cells = [wall,ceiling]
    assert.equal(clearContactFinishes(cells), cells)
    const loaded = toState({ ...emptyStation(), cells })
    assert.deepEqual(loaded.cells.map(c => c.finish), [wall.finish,ceiling.finish], String(tag))
    const before = useStore.getState()
    try {
      const station = toState({ ...emptyStation(), cells:[wall] })
      useStore.setState({ station, past:[], future:[] })
      useStore.getState().commit({ ...station, cells:[...station.cells,ceiling] })
      assert.deepEqual(useStore.getState().station.cells.map(c => c.finish), [wall.finish,ceiling.finish])
      useStore.getState().undo()
      assert.deepEqual(useStore.getState().station.cells[0].finish, wall.finish)
    } finally { useStore.setState(before) }
  }
})


test('cut-face cleanup happens on load and commit and undo restores the finish', () => {
  const panel = { x:0,y:0,z:-5,fill:'solid',tags:['half-wall:n'],finish:{top:'wall.enamel',s:'wall.enamel'} }
  const block = { x:0,y:0,z:-4,fill:'solid',finish:{bottom:'wall.enamel'} }
  const expected = [{s:'wall.enamel'}, {bottom:'wall.enamel'}]
  assert.deepEqual(toState({ ...emptyStation(), cells:[panel,block] }).cells.map(c => c.finish), expected)
  const before = useStore.getState()
  try {
    const station = toState({ ...emptyStation(), cells:[panel] })
    useStore.setState({ station, past:[], future:[] })
    useStore.getState().commit({ ...station, cells:[...station.cells,block] })
    assert.deepEqual(useStore.getState().station.cells.map(c => c.finish), expected)
    useStore.getState().undo()
    assert.deepEqual(useStore.getState().station.cells[0].finish, panel.finish)
  } finally { useStore.setState(before) }
})

test('touching suspended ceilings retain both finishes', () => {
  const cells = [
    { x:0,y:0,z:-5,fill:'solid',tags:['suspended-ceiling'],finish:{e:'ceil.baffle'} },
    { x:1,y:0,z:-5,fill:'solid',tags:['suspended-ceiling'],finish:{w:'ceil.baffle'} },
  ]
  assert.equal(clearContactFinishes(cells), cells)
  assert.deepEqual(toState({ ...emptyStation(), cells }).cells.map(c => c.finish), cells.map(c => c.finish))
})
