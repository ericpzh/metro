// TypeScript oracle for shared crowd-routing policy, topology decomposition,
// coarse A*, and rolling 16-step local step parity between Three.js (game/src/sim/)
// and Unity (unity/Assets/StationDesigner/Runtime/Sim/).
//
// Usage:
//   node tools/unity-parity/record-crowd-routing.mjs [output.json]
//
// Output default: unity/Assets/StationDesigner/Tests/EditMode/crowd-routing-oracle.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  floorDiv,
  hash32Init,
  hash32Jitter,
  hash32Mix,
  hash32Tile,
  octantOf,
  packSectorKey,
  packTileKey,
  scoreTileMs,
  shortestOctantDifference,
  toMs,
} from '../../game/src/sim/sparsePolicy.ts'
import { buildSparseTopology } from '../../game/src/sim/sparseGraph.ts'
import { SparseRouter } from '../../game/src/sim/sparseRouter.ts'
import { buildGraph } from '../../game/src/sim/station.ts'
import { floorSpeed } from '../../game/src/sim/finishes.ts'

const output = resolve(
  process.argv[2] ?? 'unity/Assets/StationDesigner/Tests/EditMode/crowd-routing-oracle.json',
)

const toMsVectors = [
  0, 0.0004, 0.0005, 0.0014, 0.0015, 0.7462686567164178, 1.0553832425354032,
  1 / 1.34, Math.SQRT2 / 1.34, 12.3455, 600, -1,
].map(seconds => ({ seconds, ms: toMs(seconds) }))

const floorDivVectors = [
  [-33, 16], [-32, 16], [-17, 16], [-16, 16], [-15, 16], [-1, 16],
  [0, 16], [1, 16], [15, 16], [16, 16], [17, 16], [32, 16],
].map(([a, b]) => ({ a, b, result: floorDiv(a, b) }))

const packTileVectors = [
  [-17, -16, -2], [-1, -1, 0], [0, 0, 0], [15, 16, 18], [16, 16, 18], [120, -45, 7],
].map(([tx, ty, tz2]) => ({
  tx,
  ty,
  tz2,
  tileKey: packTileKey(tx, ty, tz2),
  sectorKey: packSectorKey(floorDiv(tx, 16), floorDiv(ty, 16), tz2),
}))

const hashVectors = [
  { seed: 42, agentId: 1, segSeq: 0, tx: 16, ty: 5, tz2: 20, k: 0 },
  { seed: 42, agentId: 1, segSeq: 0, tx: 16, ty: 5, tz2: 20, k: 1 },
  { seed: 42, agentId: 2, segSeq: 3, tx: -5, ty: -17, tz2: -2, k: 0 },
  { seed: 7654321, agentId: 99, segSeq: 12, tx: 48, ty: 31, tz2: 10, k: 2 },
].map(v => {
  const hInit = hash32Init(v.seed)
  const hMix = hash32Mix(hInit, v.agentId)
  const hTile = hash32Tile(v.seed, v.tx, v.ty, v.tz2)
  const jitter = hash32Jitter(v.seed, v.agentId, v.segSeq, v.tx, v.ty, v.tz2)
  return { ...v, hInit, hMix, hTile, jitter }
})

const octantVectors = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [0, 0],
].map(([dx, dy]) => ({ dx, dy, oct: octantOf(dx, dy) }))

const scoreVectors = [
  { edgeCostMs: 746, remainingMs: 8200, direct: 0, adjSum: 0, adjCnt: 8, otherClaims: 0, heading: 0, moveOct: 0, seed: 42, agentId: 1, segSeq: 0, tx: 16, ty: 5, tz2: 20, useDensity: true, useBias: true, useClaims: true },
  { edgeCostMs: 1055, remainingMs: 7900, direct: 1, adjSum: 3, adjCnt: 8, otherClaims: 2, heading: 0, moveOct: 1, seed: 42, agentId: 2, segSeq: 1, tx: 16, ty: 6, tz2: 20, useDensity: true, useBias: true, useClaims: true },
  { edgeCostMs: 746, remainingMs: 8200, direct: 2, adjSum: 5, adjCnt: 5, otherClaims: 1, heading: 0, moveOct: 3, seed: 42, agentId: 7, segSeq: 4, tx: -3, ty: 12, tz2: 0, useDensity: true, useBias: true, useClaims: true },
  { edgeCostMs: 746, remainingMs: 8200, direct: 2, adjSum: 5, adjCnt: 5, otherClaims: 1, heading: 0, moveOct: 3, seed: 42, agentId: 7, segSeq: 4, tx: -3, ty: 12, tz2: 0, useDensity: false, useBias: true, useClaims: false },
  { edgeCostMs: 746, remainingMs: 8200, direct: 0, adjSum: 0, adjCnt: 0, otherClaims: 1, heading: -1, moveOct: 5, seed: 7654321, agentId: 15, segSeq: 2, tx: 22, ty: 9, tz2: 20, useDensity: true, useBias: false, useClaims: true },
].map(v => ({
  ...v,
  octDiff: shortestOctantDifference(v.heading, v.moveOct),
  scoreMs: scoreTileMs(
    v.edgeCostMs, v.remainingMs, v.direct, v.adjSum, v.adjCnt, v.otherClaims,
    v.heading, v.moveOct, v.seed, v.agentId, v.segSeq, v.tx, v.ty, v.tz2,
    { useDensity: v.useDensity, useBias: v.useBias, useClaims: v.useClaims },
  ),
}))

// Deterministic multi-sector fence-split fixture on z=9 (cell floor z=9, node z=10)
const cells = []
for (let y = 0; y < 12; y++) {
  for (let x = 0; x < 32; x++) {
    cells.push({ x, y, z: 9, fill: 'solid', zone: 'unpaid' })
  }
}
// Block middle of the x=15 -> x=16 seam with solid wall blocks at y=5..6 on z=10
// so the sector border splits into 2 separate contiguous crossing runs (y=0..4 and y=7..11).
cells.push({ x: 15, y: 5, z: 10, fill: 'solid', zone: 'unpaid' })
cells.push({ x: 15, y: 6, z: 10, fill: 'solid', zone: 'unpaid' })
cells.push({ x: 16, y: 5, z: 10, fill: 'solid', zone: 'unpaid' })
cells.push({ x: 16, y: 6, z: 10, fill: 'solid', zone: 'unpaid' })

const stationData = {
  cells,
  modules: [],
  lines: [],
}
const graph = buildGraph(stationData, { floorSpeed, street: false })
const seed = 42
const topo = buildSparseTopology(graph, seed, null).topology

const nodeCoord = n => [
  Math.round(graph.nodeX[n] - 0.5),
  Math.round(graph.nodeY[n] - 0.5),
  Math.round(graph.nodeZ[n] - 1),
]
const findNode = (x, y, z) => {
  for (let n = 0; n < graph.nodeCount; n++) {
    const [nx, ny, nz] = nodeCoord(n)
    if (nx === x && ny === y && nz === z) return n
  }
  return -1
}

const startNode = findNode(2, 5, 9)
const goalNode = findNode(29, 5, 9)
const crowdNode = findNode(3, 5, 9)

const router = new SparseRouter(graph, seed)
router.captureCostSnapshot(null)
const coarseStart = router.startCoarseSearch(startNode, goalNode, { stepFree: false, luggage: false }, -1, 0, 1)
let itin = coarseStart.status === 'ready' ? coarseStart.itinerary : null
if (coarseStart.status === 'pending') {
  const stepped = router.stepCoarseJobNow(coarseStart.jobId, 20000, 80000)
  itin = stepped?.result ?? null
}
if (!itin) throw new Error('Oracle fixture coarse search did not complete')

// Warm fields and record rolling 16-step waypoints (next tiles after startNode)
const walker1 = router.createWalker(goalNode, 0)
walker1.itinerary = itin
const a1 = { id: 1, path: new Int32Array(0), pathIdx: 0 }
let r1 = router.refillWalker(a1, walker1, 1, startNode, 0)
if (r1 === 'pending') {
  router.routeTick([], 1, () => -1, null, () => {}, () => {}, () => {})
  r1 = router.refillWalker(a1, walker1, 1, startNode, 0)
}
const seg1Free = Array.from(a1.path, n => nodeCoord(n))

// Now place a standing body at (3, 5, 9) and refill a fresh walker id=2 from startNode
router.occupancy.clear()
router.occupancy.add(crowdNode)
const walker2 = router.createWalker(goalNode, 0)
walker2.itinerary = itin
const a2 = { id: 2, path: new Int32Array(0), pathIdx: 0 }
router.refillWalker(a2, walker2, 1, startNode, 0)
const seg2Crowded = Array.from(a2.path, n => nodeCoord(n))

const floorTz2 = 18
const floorSectorKeys = [...topo.sectors.values()]
  .filter(s => s.tz2 === floorTz2)
  .map(s => s.sectorKey)
  .sort((a, b) => a - b)
const floorSectorSet = new Set(floorSectorKeys)
const floorRegions = topo.regions
  .filter(r => floorSectorSet.has(r.sectorKey))
  .map(r => ({
    regionKey: r.regionKey,
    sectorKey: r.sectorKey,
    tileCount: r.nodes.length,
    sampleTileKey: r.sampleTileKey,
  }))
  .sort((a, b) => a.regionKey - b.regionKey)
const floorRegionSet = new Set(floorRegions.map(r => r.regionKey))
const floorCrossings = topo.crossings
  .filter(c => floorRegionSet.has(c.fromRegionKey) && floorRegionSet.has(c.toRegionKey))
  .map(c => ({
    stableKey: c.stableKey,
    fromRegionKey: c.fromRegionKey,
    toRegionKey: c.toRegionKey,
    edgeCount: c.fromNodes.length,
    repFromKey: c.repFromKey,
    repToKey: c.repToKey,
    repCostMs: c.repCostMs,
  }))
  .sort((a, b) => (a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0))

const oracle = {
  seed,
  toMsVectors,
  floorDivVectors,
  packTileVectors,
  hashVectors,
  octantVectors,
  scoreVectors,
  fixture: {
    width: 32,
    height: 12,
    floorZ: 9,
    wallBlocks: [
      [15, 5, 10], [15, 6, 10], [16, 5, 10], [16, 6, 10],
    ],
    sectorCount: floorSectorKeys.length,
    regionCount: floorRegions.length,
    crossingCount: floorCrossings.length,
    sectorKeys: floorSectorKeys,
    regions: floorRegions,
    crossings: floorCrossings,
    startCoord: [2, 5, 9],
    goalCoord: [29, 5, 9],
    crowdCoord: [3, 5, 9],
    coarseTotalCostMs: itin.totalCostMs,
    coarseStepCount: itin.steps.length,
    coarseSteps: itin.steps.map(s => ({
      isCrossing: s.kind === 'crossing',
      fromKey: s.fromKey,
      toKey: s.toKey,
      costMs: s.costMs,
    })),
    seg1Free,
    seg2Crowded,
  },
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(oracle, null, 2) + '\n', 'utf8')
console.log(
  `Wrote ${output}: sectors=${oracle.fixture.sectorCount} regions=${oracle.fixture.regionCount} ` +
  `crossings=${oracle.fixture.crossingCount} coarseCostMs=${oracle.fixture.coarseTotalCostMs} ` +
  `seg1Len=${seg1Free.length} seg2Len=${seg2Crowded.length}`,
)
