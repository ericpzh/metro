import { mkdirSync, writeFileSync } from 'node:fs'
import { referenceStation } from '../../game/src/data/reference-station.ts'
import { toState } from '../../game/src/build/model.ts'
import { serialize } from '../../game/src/persistence/save.ts'
import { moduleFootprint } from '../../game/src/sim/placement.ts'
import { exitFootprintCells } from '../../game/src/sim/exits.ts'
import { World } from '../../game/src/sim/world.ts'

const station = referenceStation('zoo')
const state = toState(station)
const saved = serialize(state, new Date('2020-01-02T03:04:05Z'))
mkdirSync('.preview/unity', { recursive: true })
writeFileSync('.preview/unity/zoo-v1.metro.json', saved)

const world = new World(station, 7654321)
const graph = world.graph
const exit = graph.exits.find(e => e.name === 'B')
const gate = graph.nodeIndex.get('59,18,-15')
const platform = graph.platforms.find(p => p.id === 'edge-track-5-left')
const doors = platform.doors.map(id => graph.servers[id].node)
const door = doors.reduce((a, b) => Math.abs(graph.nodeX[a] - 68) < Math.abs(graph.nodeX[b] - 68) ? a : b)
const needs = { stepFree: false, luggage: false }
const before = world.path.search(exit.node, gate, needs)
const after = world.path.search(gate, door, needs)
const approach = graph.nodeKey[before.at(-2)].split(',').map(Number)
if (String(approach) !== '59,19,-15' || before.at(-1) !== gate || after[0] !== gate || after.at(-1) !== door)
  throw Error('Authored Zoo service route changed')
const path = [...before, ...after.slice(1)].map(n => ({
  x: graph.nodeX[n], y: graph.nodeY[n], z: graph.nodeZ[n], zone: graph.nodeZone[n], gate: n === gate,
}))
path.push({ ...path.at(-1), y: -2.25 })
const footprints = state.modules.map(m => {
  const cells = m.type === 'exit' ? exitFootprintCells(m) : moduleFootprint(m)
  const xs = cells.map(p => p[0]), ys = cells.map(p => p[1])
  return { id: m.id, x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs) + 1, d: Math.max(...ys) - Math.min(...ys) + 1 }
})
const dir = 'unity/Assets/StationDesigner/Zoo'
mkdirSync(dir, { recursive: true })
writeFileSync(dir + '/ZooSave.json', saved)
writeFileSync(dir + '/ZooLayout.json', JSON.stringify({ footprints, path, approach, exit: exit.id, gate: 'gate-243', platform: platform.id }))
console.log(JSON.stringify({ cells: state.cells.length, modules: state.modules.length, lines: state.lines.length, waypoints: path.length }))
