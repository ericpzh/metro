// TS oracle for packet G (roads). Reads the shipped Zoo save plus small authored
// fixtures, runs the real sim modules, and emits exactly the values the C# port
// must reproduce. Run from the repository root:
//   node tools/unity-parity/record-station-roads.mjs [--save <path>] [--out <path>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { parse } from '../../game/src/persistence/save.ts'
import { referenceStation } from '../../game/src/data/reference-station.ts'
import { toState } from '../../game/src/build/model.ts'
import { serialize } from '../../game/src/persistence/save.ts'
import { roadLayout, roadPoint, roadInkIntervals, roadHash } from '../../game/src/sim/roads.ts'
import { getRoadDocument, roadEndpoints, roadSnap, roadSegmentAt } from '../../game/src/sim/roadDocument.ts'
import {
  getRoadNetwork, roadSignal, roadJunctionSides, roadEdgePoint, roadEdgeMovements, roadLaneSign,
} from '../../game/src/sim/roadNetwork.ts'
import { RoadTraffic } from '../../game/src/sim/roadTraffic.ts'
import {
  ROAD_NODE_SNAP_RADIUS, ROAD_CROSSWALK_DEPTH, ROAD_STEP,
} from '../../game/src/sim/constants.ts'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const savePath = args.get('--save') ?? 'unity/Assets/StationDesigner/Zoo/ZooSave.json'
const outPath = args.get('--out') ?? 'unity/Assets/StationDesigner/Tests/EditMode/road-oracle.json'

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const point = p => ({ x: p[0], y: p[1] })
const points = list => (list ?? []).map(point)
const round = n => (Number.isFinite(n) ? n : null)

function record(r) {
  const layout = roadLayout(r)
  const ends = roadEndpoints(r)
  return {
    id: r.id, type: r.type, x: r.x, y: r.y, z: r.z, w: r.w, d: r.d, rot: r.rot ?? 0,
    direction: r.cfg?.direction ?? 'one-way',
    hasFrom: Array.isArray(r.cfg?.from), from: Array.isArray(r.cfg?.from) ? point(r.cfg.from) : { x: 0, y: 0 },
    hasTo: Array.isArray(r.cfg?.to), to: Array.isArray(r.cfg?.to) ? point(r.cfg.to) : { x: 0, y: 0 },
    acrossX: layout.acrossX, width: layout.width, length: layout.length,
    lanes: layout.lanes, laneWidth: layout.laneWidth,
    endpoints: points(ends),
  }
}

function graphJson(modules) {
  const doc = getRoadDocument(modules)
  return {
    segments: doc.segments.map(s => ({
      id: s.road.id, sourceId: s.sourceId, fromNode: s.from, toNode: s.to,
      x: s.road.x, y: s.road.y, z: s.road.z, w: s.road.w, d: s.road.d, rot: s.road.rot ?? 0,
      direction: s.road.cfg.direction,
      hasFrom: Array.isArray(s.road.cfg.from), from: Array.isArray(s.road.cfg.from) ? point(s.road.cfg.from) : { x: 0, y: 0 },
      hasTo: Array.isArray(s.road.cfg.to), to: Array.isArray(s.road.cfg.to) ? point(s.road.cfg.to) : { x: 0, y: 0 },
    })),
    nodes: [...doc.nodes.values()].map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z, segments: [...n.segments] })),
  }
}

function networkJson(modules) {
  const net = getRoadNetwork(modules)
  return {
    junctions: net.junctions.map(j => ({ ...j })),
    edges: net.edges.map(e => ({
      road: e.road.id, lane: e.lane, sign: e.sign, axis: e.axis,
      start: point(e.start), end: point(e.end), length: e.length,
      next: [...e.next], junction: e.junction,
      hasControl: !!e.control, control: e.control ? point(e.control) : { x: 0, y: 0 },
    })),
    entries: [...net.entries],
    sides: roadJunctionSides(net).map(s => ({ ...s })),
    laneSigns: net.roads.flatMap(r => Array.from({ length: roadLayout(r).lanes }, (_, lane) => ({
      road: r.id, lane, sign: roadLaneSign(r, lane),
    }))),
    movements: net.edges.map((e, i) => ({ edge: i, turns: roadEdgeMovements(net, e) })),
  }
}

function snapsJson(modules, probes) {
  const doc = getRoadDocument(modules)
  return probes.map(probe => {
    const [x, y, z = 0, radius = ROAD_NODE_SNAP_RADIUS] = probe
    const snap = roadSnap(doc, [x, y], z, radius)
    const at = roadSegmentAt(doc, [x, y], z)
    return {
      probe: { x, y }, z, radius, point: point(snap.point),
      hasNode: !!snap.node, nodeId: snap.node?.id ?? '',
      roadId: snap.road?.id ?? '', atId: at?.road.id ?? '',
    }
  })
}

function inksJson(modules) {
  const out = []
  for (const r of modules.filter(m => m.type === 'road')) {
    const { width, lanes, laneWidth } = roadLayout(r)
    const across = [...new Set([.16, width - .16, width / 2, width / 2 - .13, width / 2 + .13,
      ...Array.from({ length: Math.max(0, lanes - 1) }, (_, i) => (i + 1) * laneWidth)])]
    for (const a of across) for (const margin of [0, ROAD_CROSSWALK_DEPTH + 1.5])
      out.push({ road: r.id, across: a, margin, spans: roadInkIntervals(r, modules, a, margin).map(([lo, hi]) => ({ lo, hi })) })
  }
  return out
}

function trafficJson(modules, seed, times) {
  const net = getRoadNetwork(modules)
  const traffic = new RoadTraffic(net, seed)
  const runs = []
  for (const time of times) {
    traffic.advance(time)
    const cars = traffic.cars.map(c => ({
      id: c.id, edge: c.edge, distance: c.distance, previousEdge: c.previousEdge,
      previousDistance: c.previousDistance, kind: c.kind, size: c.size, held: c.held,
      variant: roadVehicleVariant(c.kind, c.id, seed),
    }))
    const fraction = Math.min(1, Math.max(0, (time - traffic.time) / ROAD_STEP))
    const poses = []
    for (const c of traffic.cars) {
      const previous = net.edges[c.previousEdge]
      let edge = c.edge, distance = c.distance
      if (c.previousEdge === c.edge) distance = c.previousDistance + (c.distance - c.previousDistance) * fraction
      else {
        const travelled = (previous.length - c.previousDistance + c.distance) * fraction
        if (c.previousDistance + travelled < previous.length) { edge = c.previousEdge; distance = c.previousDistance + travelled }
        else distance = c.previousDistance + travelled - previous.length
      }
      const e = net.edges[edge]
      const t = Math.max(0, Math.min(1, distance / e.length))
      const [x, y] = roadEdgePoint(e, t)
      const dx = e.control ? 2 * ((1 - t) * (e.control[0] - e.start[0]) + t * (e.end[0] - e.control[0])) : e.end[0] - e.start[0]
      const dy = e.control ? 2 * ((1 - t) * (e.control[1] - e.start[1]) + t * (e.end[1] - e.control[1])) : e.end[1] - e.start[1]
      poses.push({ id: c.id, edge, kind: c.kind, variant: roadVehicleVariant(c.kind, c.id, seed),
        x, y, z: e.road.z + 1.05, heading: Math.atan2(-dx, dy) })
    }
    runs.push({
      time, trafficTime: traffic.time,
      cars, poses,
      signals: net.junctions.map(j => ({
        junction: j.id, uncontrolled: !!j.uncontrolled, axis: true, time, phase: roadSignal(j, true, time),
      })).concat(net.junctions.map(j => ({
        junction: j.id, uncontrolled: !!j.uncontrolled, axis: false, time, phase: roadSignal(j, false, time),
      }))),
    })
  }
  return runs
}

/** Package-vehicle appearance is stable and never consumes traffic RNG. */
function roadVehicleVariant(kind, id, seed) {
  const alternate = roadHash(`${seed}:vehicle:${id}`) % 2 === 1
  if (kind === 'car') return alternate ? 'sedan' : 'suv'
  if (kind === 'bus') return alternate ? 'bus-mosaic' : 'bus-orange'
  return kind === 'bike' || alternate ? 'bicycle' : 'moped'
}

function section(modules, probes, trafficSeed, trafficTimes) {
  const records = modules.filter(m => m.type === 'road').map(record)
  return {
    records,
    ...graphJson(modules),
    network: networkJson(modules),
    snaps: snapsJson(modules, probes),
    inks: inksJson(modules),
    traffic: trafficSeed === undefined ? [] : trafficJson(modules, trafficSeed, trafficTimes),
  }
}

const saveText = readFileSync(savePath, 'utf8')
const loaded = parse(saveText)
if (!loaded.ok) throw Error(`Zoo save did not parse: ${loaded.error}`)
const zooModules = loaded.state.modules

// Secondary proof: the Tanwei demo is a baked StationData, not a file save, so
// package it through the same referenceStation -> toState -> serialize -> parse
// path A uses. This exercises a real multi-road crossing and an already-split
// segment without adding a second shipped save.
const tanwei = referenceStation('tanwei')
const tanweiSerialized = serialize(toState(tanwei), new Date('2020-01-02T03:04:05Z'))
const tanweiLoaded = parse(tanweiSerialized)
if (!tanweiLoaded.ok) throw Error(`Tanwei demo did not round-trip: ${tanweiLoaded.error}`)
const tanweiModules = tanweiLoaded.state.modules

function between(from, to, z, width, direction, reverse, id) {
  return { id, type: 'road', ...roadBetweenShell(from, to, z, width, direction, reverse) }
}
// Mirror roadBetween without importing it twice: keep the oracle on the real function.
import { roadBetween } from '../../game/src/sim/roadDocument.ts'
function roadBetweenShell(from, to, z, width, direction, reverse) {
  const r = roadBetween(from, to, z, width, direction, reverse, '__shell')
  delete r.id
  return r
}

const crossX = between([0, 0], [40, 0], 0, 6, 'one-way', false, 'cross-x')
const crossY = between([20, -20], [20, 20], 0, 8, 'two-way', false, 'cross-y')
const lower = between([-20, 0], [20, 0], 0, 6, 'one-way', false, 'over-lower')
const upper = between([-20, 0], [20, 0], 4, 6, 'one-way', false, 'over-upper')
const legacy = { id: 'legacy-road', type: 'road', x: 0, y: 0, z: 0, w: 8, d: 30, rot: 0, cfg: { direction: 'one-way' } }
const fractional = between([.5, 2.25], [10.5, 2.25], 0, 6, 'one-way', false, 'frac-road')

const fixtures = [
  {
    name: 'rotated-crossing',
    description: 'One-way horizontal and two-way vertical roads crossing; rotated quarter turns and a controlled junction.',
    modules: [crossX, crossY],
    probes: [[0, 0, 0, 3], [19, 0, 0, 3], [20, 2, 0, 3], [40.4, 0.4, 0, 3], [20, -20, 0, 3]],
    trafficSeed: 4242, trafficTimes: [0, 3.2, 9.9],
  },
  {
    name: 'overpass',
    description: 'Identical rectangles at elevations 0 and 4: a bridge over a road must not create a shared node or junction.',
    modules: [lower, upper],
    probes: [[0, 0, 0, 3], [0, 0, 4, 3], [0, 0, 2, 3]],
    trafficTimes: [],
  },
  {
    name: 'legacy-no-endpoints',
    description: 'Road record with no cfg.from/cfg.to: endpoints derive from the inset rectangle.',
    modules: [legacy],
    probes: [[0, 0, 0, 6], [1, 0, 0, 6], [4, 4, 0, 3], [4, 26, 0, 3]],
    trafficTimes: [],
  },
  {
    name: 'fractional-endpoints',
    description: 'Authored endpoints on half/quarter cells stay fractional; rectangle padding must match roadBetween.',
    modules: [fractional],
    probes: [[.5, 2.25, 0, 3], [10.5, 2.25, 0, 3], [5.5, 4, 0, 3]],
    trafficTimes: [],
  },
]

const rawHashes = ['7654321:kind:0', '7654321:spawn:0', '7654321:0:0', '0:0:0:0:0', '0:16:-3:24:3', '站😀road']
const hashes = rawHashes.map(input => ({ input, hash: roadHash(input) }))
const constants = {
  nodeSnapRadius: ROAD_NODE_SNAP_RADIUS, crosswalkDepth: ROAD_CROSSWALK_DEPTH, step: ROAD_STEP,
  laneWidth: 3, trafficSpacing: 20, trafficDensity: .5, trafficSpeed: 6, trafficCapacity: 192,
  maxCatchup: 60, signalGreen: 12, signalAmber: 3, signalClear: 5, followGap: 2,
}

const oracle = {
  schemaVersion: 1,
  generatedBy: 'tools/unity-parity/record-station-roads.mjs',
  sourceSha,
  source: { save: savePath.replaceAll('\\', '/'), records: zooModules.filter(m => m.type === 'road').length },
  constants, hashes,
  zoo: section(zooModules, [[30, 3, 0, 3], [50, 4, 0, 3], [50, 2.6, 0, 3], [110, 3, 0, 3],
    [27, -9, 0, 3], [33, -9, 0, 3], [50, -10.2, 0, 3], [50, 4, 0, .2]], 7654321, [0, 5.3, 17.7, 41.2]),
  tanwei: section(tanweiModules, [[30, 21, 0, 3], [35, -50, 0, 3], [0, 21, 0, 3], [35, 15, 0, 3],
    [-23, 10, 0, 3], [-23, -2, 0, 3]], 7654321, [0, 10.4, 25.7]),
  fixtures,
}
for (const fixture of fixtures) {
  fixture.expected = section(fixture.modules, fixture.probes, fixture.trafficSeed, fixture.trafficTimes)
  delete fixture.modules
  fixture.input = fixture.name === 'rotated-crossing' ? [crossX, crossY]
    : fixture.name === 'overpass' ? [lower, upper]
    : fixture.name === 'legacy-no-endpoints' ? [legacy] : [fractional]
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(oracle, null, 2) + '\n')
console.log(JSON.stringify({
  out: outPath, sourceSha, zooRoads: oracle.zoo.records.length,
  zooEdges: oracle.zoo.network.edges.length, zooJunctions: oracle.zoo.network.junctions.length,
  tanweiRoads: oracle.tanwei.records.length, tanweiEdges: oracle.tanwei.network.edges.length,
  tanweiJunctions: oracle.tanwei.network.junctions.length,
  fixtures: fixtures.map(f => ({ name: f.name, roads: f.expected.records.length,
    junctions: f.expected.network.junctions.length, edges: f.expected.network.edges.length })),
}))
