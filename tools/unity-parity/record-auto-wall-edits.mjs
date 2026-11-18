import { readFileSync, writeFileSync } from 'node:fs'
import { addFloor, removeFloor } from '../../game/src/build/model/Floors.ts'
import { emptyStation } from '../../game/src/data/reference-station.ts'
import { parse, serialize } from '../../game/src/persistence/save.ts'

const out = new URL('../../unity/Assets/StationDesigner/Tests/EditMode/auto-wall-edits-oracle.json', import.meta.url)
const zoo = new URL('../../unity/Assets/StationDesigner/Demos/zoo.metro.json', import.meta.url)
const key = ({ x, y, z }) => `${x},${y},${z}`
const floor = (x, y, z) => ({ x, y, z, fill: 'solid', tags: ['auto-floor'] })
const wall = (x, y, z) => ({ x, y, z, fill: 'solid', tags: ['auto-wall'] })
const range = n => Array.from({ length: n }, (_, i) => i)

const ring = range(3).flatMap(x => range(3).flatMap(y => [
  floor(x, y, -5),
  ...(x === 1 && y === 1 ? [] : range(5).map(i => wall(x, y, -4 + i))),
]))
ring[1] = { ...ring[1], tags: ['auto-wall', 'fixture'], finish: { w: 'wall.enamel' }, custom: { keep: true } }
const remote = range(8).flatMap(y => [floor(20, y, -10), wall(20, y, -5)])
const zooRead = parse(readFileSync(zoo, 'utf8'))
if (!zooRead.ok) throw new Error('Zoo save could not be parsed')

function edits(before, after, keyOf) {
  const prior = new Map(before.map(r => [keyOf(r), r]))
  const next = new Map(after.map(r => [keyOf(r), r]))
  return {
    removed: [...prior.keys()].filter(k => !next.has(k)).sort(),
    written: after.filter(r => JSON.stringify(prior.get(keyOf(r))) !== JSON.stringify(r)),
  }
}

const cases = [
  { name: 'remote strip and interior hole', cells: [...ring, ...remote], targets: [[1, 1, -5]] },
  { name: 'last floor between storeys', cells: [
    floor(0, 0, -7), ...range(5).map(i => wall(0, 0, -6 + i)),
    floor(4, 0, -12), wall(4, 0, -7), floor(3, 0, -2), wall(3, 0, -1),
  ], levelBase: 3, targets: [[0, 0, -7]] },
  { name: 'shared courses on overlapping levels', cells: [
    floor(0, 0, -8), floor(0, 0, -6), ...[-7, -5, -4, -3, -2, -1].map(z => wall(0, 0, z)),
    floor(3, 0, -11), wall(3, 0, -10),
  ], levelBase: 2, targets: [[0, 0, -8], [3, 0, -11]] },
  { name: 'adjacent addition', add: true, cells: [
    floor(0, 0, -5), ...range(5).map(i => wall(0, 0, -4 + i)),
  ], targets: [[1, 0, -5]] },
  { name: 'removed equipment frees a course', cells: [
    floor(0, 0, -5), floor(0, 0, -4), floor(1, 0, -5),
  ], modules: [{ id: 'bench-1', type: 'bench', x: 0, y: 0, z: -4, rot: 0, cfg: {} }],
  targets: [[0, 0, -4], [1, 0, -5]] },
  { name: 'track coverage and platform doors', cells: [
    floor(0, 0, -5),
    ...[[-1, 0], [0, -1], [0, 1]].map(([x, y]) => ({ x, y, z: -5, fill: 'solid' })),
    floor(3, 0, -5), floor(5, 0, -5),
  ], modules: [
    { id: 'track', type: 'track', x: 1, y: 0, z: -5, w: 1, d: 1, rot: 0, cfg: {} },
    { id: 'psd', type: 'platform-edge', x: 3, y: 0, z: -5, w: 1, d: 1, rot: 0, cfg: {} },
  ], targets: [[5, 0, -5]] },
  { name: 'Zoo', demo: 'zoo', targets: [[48, 5, -15]] },
]
for (const fixture of cases) {
  const before = fixture.demo ? zooRead.state : {
    ...emptyStation(), storeyHeight: 5, levelBase: fixture.levelBase ?? 0,
    cells: fixture.cells, modules: fixture.modules ?? [],
  }
  const after = (fixture.add ? addFloor : removeFloor)(before, fixture.targets)
  const reopened = parse(serialize(after, new Date(0)))
  if (!reopened.ok) throw new Error(`Could not reopen ${fixture.name}`)
  // The Unity transaction normalizes covered finishes at commit time.
  fixture.cellChanges = edits(before.cells, after.cells, key)
  fixture.moduleChanges = edits(before.modules, after.modules, m => m.id)
  fixture.reopenedCellChanges = edits(before.cells, reopened.state.cells, key)
}
const json = '[\n' + cases.map(f => '  ' + JSON.stringify(f)).join(',\n') + '\n]\n'
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== json) throw new Error('Auto-wall oracle is stale')
} else {
  writeFileSync(out, json)
}
