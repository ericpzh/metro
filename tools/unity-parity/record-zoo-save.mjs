import { mkdirSync, writeFileSync } from 'node:fs'
import { referenceStation } from '../../game/src/data/reference-station.ts'
import { toData, toState } from '../../game/src/build/model.ts'
import { parse, serialize } from '../../game/src/persistence/save.ts'
import { moduleFootprint } from '../../game/src/sim/placement.ts'
import { exitFootprintCells } from '../../game/src/sim/exits.ts'
import { World } from '../../game/src/sim/world.ts'
import { buildGraph } from '../../game/src/sim/station.ts'

const station = referenceStation('zoo')
const state = toState(station)
const saved = serialize(state, new Date('2020-01-02T03:04:05Z'))
mkdirSync('.preview/unity', { recursive: true })
writeFileSync('.preview/unity/zoo-v1.metro.json', saved)

const world = new World(station, 7654321)
const graph = world.graph
const exit = graph.exits.find(e => e.name === 'B')
const gate = graph.nodeIndex.get('59,18,-15')
const gateRecord = state.modules.find(m => m.id === 'gate-243')
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
// The bounded platform slice retains only immutable obstacle constraints.
// C# constructs walk edges and their costs from committed floor each time.
const inSlice = n => graph.nodeZ[n] === -14 && graph.nodeX[n] >= 50 && graph.nodeX[n] < 81 && graph.nodeY[n] >= -1 && graph.nodeY[n] < 37
const otherGates = new Set(state.modules.filter(m => m.type === 'gate' && m.id !== 'gate-243').map(m => `${m.x},${m.y},${m.z}`))
const selected = Array.from({ length: graph.nodeCount }, (_, i) => i).filter(n => inSlice(n) && !otherGates.has(graph.nodeKey[n]))
const index = new Map(selected.map((n, i) => [n, i]))
const nodes = selected.map(n => {
  const [x, y, z] = graph.nodeKey[n].split(',').map(Number)
  let blocked = 0
  for (const [bit, [dx, dy]] of [[1, [1, 0]], [2, [-1, 0]], [4, [0, 1]], [8, [0, -1]]]) {
    const neighbour = graph.nodeIndex.get(`${x + dx},${y + dy},${z}`)
    if (neighbour === undefined || !index.has(neighbour)) continue
    let allowed = false
    for (let e = graph.adjStart[n]; e < graph.adjStart[n + 1]; e++)
      if (graph.adjTo[e] === neighbour && graph.adjKind[e] === 0) allowed = true
    if (!allowed) blocked |= bit
  }
  return { x, y, z, zone: graph.nodeZone[n], speed: graph.nodeSpeed[n], blocked, gate: n === gate,
    gateMode: n !== gate || gateRecord.cfg.dir === 'both' ? 0 : gateRecord.cfg.dir === 'in' ? 1 : -1 }
})
const sliceStart = [...before].find(n => index.has(n))
const sliceDoor = index.get(door)
if (sliceStart === undefined || sliceDoor === undefined) throw Error('Zoo slice endpoints changed')
const prefix = [...before].slice(0, [...before].indexOf(sliceStart)).map(n => ({
  x: graph.nodeX[n], y: graph.nodeY[n], z: graph.nodeZ[n], zone: graph.nodeZone[n], gate: false,
}))
const footprints = state.modules.map(m => {
  const cells = m.type === 'exit' ? exitFootprintCells(m) : moduleFootprint(m)
  const xs = cells.map(p => p[0]), ys = cells.map(p => p[1])
  return { id: m.id, x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs) + 1, d: Math.max(...ys) - Math.min(...ys) + 1 }
})
const dir = 'unity/Assets/StationDesigner/Zoo'
mkdirSync(dir, { recursive: true })
writeFileSync(dir + '/ZooSave.json', saved)
writeFileSync(dir + '/ZooLayout.json', JSON.stringify({ footprints, path, approach, exit: exit.id, gate: 'gate-243', platform: platform.id,
  nodes, prefix, start: index.get(sliceStart), gateNode: index.get(gate), door: sliceDoor }))
const alternateData = { ...station, cells: station.cells.filter(c => !(c.x === 67 && c.y === 27 && c.z === -15)) }
const alternateWorld = new World(alternateData, 7654321), ag = alternateWorld.graph
const ae = ag.exits.find(e => e.name === 'B').node, agate = ag.nodeIndex.get('59,18,-15')
const ap = ag.platforms.find(p => p.id === 'edge-track-5-left')
const ad = ap.doors.map(id => ag.servers[id].node).reduce((a,b) => Math.abs(ag.nodeX[a]-68) < Math.abs(ag.nodeX[b]-68) ? a : b)
const ab = alternateWorld.path.search(ae, agate, needs), aa = alternateWorld.path.search(agate, ad, needs)
if (!ab || !aa) throw Error('Alternate Zoo fixture is disconnected')
const alternatePath = [...ab,...aa.slice(1)].map(n => ({ x: ag.nodeX[n], y: ag.nodeY[n], z: ag.nodeZ[n], zone: ag.nodeZone[n], gate: n === agate }))
alternatePath.push({ ...alternatePath.at(-1), y: -2.25 })
// Remove four other connecting floors while retaining the same selected
// route. The final landing then disconnects even the full TypeScript graph.
const cutPreparation = ['73,36,-15', '77,14,-15', '78,14,-15', '80,18,-15']
const removed = new Set(['67,27,-15', ...cutPreparation])
function oracleJourney(missing, reopen = false) {
  let data = { ...station, cells: station.cells.filter(c => !missing.has(`${c.x},${c.y},${c.z}`)) }
  if (reopen) {
    const saved = serialize(toState(data), new Date('2020-01-02T03:04:05Z'))
    const loaded = parse(saved)
    if (!loaded.ok) throw Error('Disconnected TypeScript fixture could not reopen: ' + loaded.error)
    data = toData(loaded.state)
  }
  const candidate = new World(data, 7654321), g = candidate.graph
  const start = g.exits.find(e => e.name === 'B').node, end = g.nodeIndex.get('59,18,-15')
  const p = candidate.path.search(start, end, needs)
  return p && Array.from(p, n => g.nodeKey[n])
}
const prepared = oracleJourney(removed)
if (!prepared || JSON.stringify(prepared) !== JSON.stringify(Array.from(ab, n => ag.nodeKey[n])))
  throw Error('The prepared approach must retain the alternate TypeScript route')
removed.add('73,35,-15')
if (oracleJourney(removed, true)) throw Error('The reopened missing connector must disconnect the full TypeScript graph')
const edgeOracle = selected.map(n => {
  const edges = []
  for (let e = graph.adjStart[n]; e < graph.adjStart[n + 1]; e++) {
    const to = index.get(graph.adjTo[e])
    if (to !== undefined && graph.adjKind[e] === 0) edges.push({ to, cost: graph.adjCost[e] })
  }
  return { edges }
})
const alternateEdges = selected.map(n => {
  const a = ag.nodeIndex.get(graph.nodeKey[n]), edges = []
  if (a !== undefined) for (let e = ag.adjStart[a]; e < ag.adjStart[a + 1]; e++) {
    const original = graph.nodeIndex.get(ag.nodeKey[ag.adjTo[e]])
    const to = index.get(original)
    if (to !== undefined && ag.adjKind[e] === 0) edges.push({ to, cost: ag.adjCost[e] })
  }
  return { edges }
})
const fareGraph = buildGraph(station, true)
const fareEdges = selected.map(n => {
  const a = fareGraph.nodeIndex.get(graph.nodeKey[n]), edges = []
  if (a !== undefined) for (let e = fareGraph.adjStart[a]; e < fareGraph.adjStart[a + 1]; e++) {
    const original = graph.nodeIndex.get(fareGraph.nodeKey[fareGraph.adjTo[e]])
    const to = index.get(original)
    if (to !== undefined && fareGraph.adjKind[e] === 0) edges.push({ to, cost: fareGraph.adjCost[e] })
  }
  return { edges }
})
writeFileSync(dir + '/ZooRouteOracle.json', JSON.stringify({ baseline: path, alternate: alternatePath,
  cutPreparation, connector: '73,35,-15', prepared, blocked: true,
  nodes: edgeOracle, alternateNodes: alternateEdges, fareNodes: fareEdges }))
console.log(JSON.stringify({ cells: state.cells.length, modules: state.modules.length, lines: state.lines.length, waypoints: path.length }))
