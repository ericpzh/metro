// TypeScript oracle for plan 16 §4: one Zoo Line 5 service's stop.
//
// Runs `game/src/sim/world/World.ts` itself — `tickOnce` → `dispatchTrains` →
// `setTrainState` / `openDoors` / `closeDoors` / `loadAlighting` / `seatAlighter`
// / `stepAlighting` / `stepOut` / `boardRider` / `emptyTrain` — over a compact
// station that carries the **real** Zoo Line 5 service records: line `5` (stock L,
// 6 cars, `alightPerTrain`), track `track-1` (101 m) and platform edge
// `edge-track-1-left` (`side: left`, `cfg.from: track-1`). The surrounding floor is
// generated from the recorded rectangles so both this recorder and the C# fixture
// build the same station from the same data.
//
// Why the real door cadence matters: `sim/station.ts` seats one **door server per
// modelled passenger door** (`doorRunOffsets(line, rail.w)`, 18 for a 6-car L) and
// `World.loadAlighting` fills 2 abreast per doorway per row. The C# port seated one
// server per walkable cell of the edge run and spread the same wave one-per-door,
// so the stop's whole door-local release/boarding order differed.
//
// Recorded, per case:
//   * the station (cells as rectangles, modules, the line exactly as the Zoo save
//     authors it) — payload, not expectation;
//   * per simulation tick: phase + elapsed, both bank targets (`doorSides` from
//     `computeLineAnchors`), per-doorway cabin rows / in-flight / cadence timer /
//     cabin queue — plus the door server's own latch rate and queue;
//   * every step-out crossing (the tick a pair leaves a doorway, its seat and the
//     doorway it lands on), every boarding and every left-behind count;
//   * render samples, separately: `TrainSystem.advanceTrainDoors` /
//     `advanceDoors` ramping the two leaf banks and the PSD toward their binary
//     target at `DOOR_TRAVEL_S`, staged by the real `trainDoorMotion`.
//
// The render samples are *not* simulation ticks: `setTrains` publishes a binary
// `doors-open` (opening/dwell = 1, everything else 0) and the view eases it, so the
// authoritative facts and what a frame draws are recorded apart.
//
// Usage:
//   node tools/unity-parity/record-station-service.mjs [output.json]
//
// Output default: unity/Assets/StationDesigner/Tests/EditMode/station-service-oracle.json
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { World } from '../../game/src/sim/world.ts'
import { trainDoorMotion, TRAIN_DOOR_PLUG_PHASE } from '../../game/src/render/trainDoorMotion.ts'
import { STOCK, trainRatedCapacity } from '../../game/src/sim/stock.ts'
import { DEFAULT_SIM_TIME } from '../../game/src/sim/constants.ts'

const args = process.argv.slice(2)
const output = resolve(args.find(a => !a.startsWith('--')) ?? 'unity/Assets/StationDesigner/Tests/EditMode/station-service-oracle.json')
const zooPath = resolve('unity/Assets/StationDesigner/Demos/zoo.metro.json')

/* ------------------------------------------------------------------- inputs */

/** The view's leaf travel (`TrainSystem.DOOR_TRAVEL_S`): 2 s for a full crossing. */
const DOOR_TRAVEL_S = 2
/** `TrainSystem.advanceTrainDoors` step: `dt * (1000 / stateIntervalMs) / DOOR_TRAVEL_S`. */
const stateIntervalMs = 100
const renderHz = 10
const SEED = 7654321
const LINE_ID = '5'
const RAIL_W = 101
const PLATFORM_DEPTH = 3
const APRON_DEPTH = 3
const EXIT_ID = 'exit-A'
const EXIT_X = 20
const EXIT_Y = PLATFORM_DEPTH + 2

// The line record, exactly as the Zoo save authors Line 5 (alightPerTrain is the
// case's knob; everything else is the document's).
const ZOO_LINE = {
  id: LINE_ID, name: '5号线', colour: '#c70541', stock: 'L', cars: 6, power: 'third-rail', psd: 'full',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 200, terminus: 'through', direction: 'up', travelSign: 1, stations: [], modelScale: 0.98,
}

/** The station every case runs on, as data both sides expand identically. */
function stationSpec({ side = 'left', trackId = 'track-1', edgeId = 'edge-track-1-left', dir = 'up', alightPerTrain = 200 }) {
  return {
    name: 'station-service fixture',
    storeyHeight: 5,
    seed: SEED,
    // Two walkable rectangles: the paid platform strip beside the rail and the
    // unpaid apron the exit stands on. One cell of floor is one walk-graph node.
    cells: [
      { x0: 0, x1: RAIL_W - 1, y0: 0, y1: PLATFORM_DEPTH - 1, z: 0, zone: 'paid', finish: 'floor.granite' },
      { x0: 0, x1: RAIL_W - 1, y0: PLATFORM_DEPTH, y1: PLATFORM_DEPTH + APRON_DEPTH - 1, z: 0, zone: 'unpaid', finish: 'floor.granite' },
    ],
    modules: [
      { id: trackId, type: 'track', x: 0, y: -3, z: 0, w: RAIL_W, d: 3, rot: 0, cfg: { line: LINE_ID, dir, power: 'third-rail' } },
      {
        id: edgeId, type: 'platform-edge', x: 0, y: 0, z: 0, w: RAIL_W, rot: 0,
        cfg: { name: '站台门', line: LINE_ID, dir, side, psd: 'full', from: trackId },
      },
      { id: EXIT_ID, type: 'exit', x: EXIT_X, y: EXIT_Y, z: 0, rot: 0, cfg: { name: 'A', open: true, inRate: 0, headHouse: false, style: 'doorway' } },
    ],
    line: { ...ZOO_LINE, alightPerTrain },
  }
}

/** Expand the recorded rectangles into the `StationData` `buildGraph` reads. */
function stationData(spec) {
  const cells = []
  for (const rect of spec.cells) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      for (let y = rect.y0; y <= rect.y1; y++) {
        cells.push({ x, y, z: rect.z, fill: 'solid', zone: rect.zone, finish: { top: rect.finish } })
      }
    }
  }
  return { name: spec.name, storeyHeight: spec.storeyHeight, seed: spec.seed, cells, modules: spec.modules, lines: [spec.line] }
}

/* ------------------------------------------------------------- the fixture */

/**
 * Queue `perDoor` riders at every doorway of the service before the first tick, so
 * the stop has a deterministic set of boarders that does not depend on street
 * demand or route choice. The riders are ordinary agents in the doorway queue —
 * the same `joinServer` a walking passenger reaches.
 */
function seedRiders(world, key, perDoor) {
  const doors = world.doorsByTrack.get(key) ?? []
  const exit = world.graph.exits[0]
  const seeded = []
  for (const d of doors) {
    const s = world.graph.servers[d]
    for (let k = 0; k < perDoor; k++) {
      const jx = (world.rng.next() - 0.5) * 0.6
      const jy = (world.rng.next() - 0.5) * 0.6
      const a = world.pool.spawn(
        { origin: '', stops: [], dest: exit ? 'exit:' + exit.id : '' },
        world.graph.nodeX[s.node] + jx, world.graph.nodeY[s.node] + jy, world.graph.nodeZ[s.node], world.tick)
      if (!a) continue
      world.joinServer(a, d)
      seeded.push({ id: a.id, door: doors.indexOf(d) })
    }
  }
  return seeded
}

/** The bank mask `computeLineAnchors` derives: bit 0 the consist's local +y, bit 1 its −y. */
function doorSidesOf(world, key) {
  return world.lineAnchors.get(key)?.doorSides ?? 0
}

function cabinPose(world, train) {
  // A doorway whose latch is open (`rate > 0`) is folded into a bitmask so a tick
  // row stays a handful of scalars; the per-doorway detail lives in `doorTimeline`
  // and the event lists below.
  let released = 0
  for (let d = 0; d < train.doors.length; d++) {
    if ((world.graph.servers[train.doors[d]]?.rate ?? 0) > 0) released |= (1 << d)
  }
  const sum = values => values.reduce((total, v) => total + v, 0)
  return {
    state: train.state,
    t: train.t,
    // What `trainRenderState` publishes: binary, opening and dwell only.
    open: train.state === 'opening' || train.state === 'dwell' ? 1 : 0,
    // `train.boarded` is never incremented by the source; the run's boarded count is
    // `metrics.boarded`, and the per-doorway split is `train.boardings`.
    boarded: world.metrics.boarded,
    alighted: train.alighted,
    onboard: train.onboard,
    capacity: train.capacity,
    alightLeft: train.alightLeft,
    alightT: round6(train.alightT),
    rows: sum(train.cabinRows),
    inFlight: sum(train.inFlight),
    cabins: sum(train.cabins.map(c => c.length)),
    queues: sum(train.doors.map(d => world.graph.servers[d]?.queue.length ?? 0)),
    released,
  }
}

const round6 = v => Math.round(v * 1e6) / 1e6

/**
 * Run one stop and record it tick by tick.
 *
 * `ticks` covers the whole choreography (approach 6 + berth 2 + opening 2 + dwell
 * 30 + closing 2 + hold 5 + depart 6 = 53 s) plus a settle window for the crowd the
 * stop put on the platform.
 */
function runCase(name, spec, { ridersPerDoor = 0, ticks = 60 } = {}) {
  const station = stationData(spec)
  const world = new World(station, SEED, { zoneBarriers: false })
  const key = LINE_ID + '|' + spec.modules.find(m => m.type === 'track').id
  const seeded = ridersPerDoor > 0 ? seedRiders(world, key, ridersPerDoor) : []
  const panels = spec.modules.filter(m => m.type === 'platform-edge').map(m => m.id)
  const doorSides = doorSidesOf(world, key)

  const frames = []
  const stepOuts = []
  const boardings = []
  const leftBehind = []
  let dispatchTick = -1
  let dispatchSimTime = -1
  let removedTick = -1
  let prevBoarded = 0
  let prevAlighted = 0
  let prevLeftBehind = 0
  let prevCabins = null
  let prevDoorBoardings = null
  let trainId = -1
  /** `cabinRows` the tick the wave was seated: the stop's per-doorway depth. */
  let doorRows = null

  for (let i = 0; i < ticks; i++) {
    world.tickOnce()
    const train = world.trains[0]
    if (train && dispatchTick < 0) {
      dispatchTick = world.tick
      dispatchSimTime = world.simTime
      trainId = train.id
      prevDoorBoardings = train.boardings.slice()
    }
    if (!train) {
      if (dispatchTick >= 0 && removedTick < 0) removedTick = world.tick
      frames.push({ tick: world.tick, simTime: world.simTime, train: null })
      prevCabins = null
      continue
    }
    if (doorRows === null && train.cabinRows.some(rows => rows > 0)) doorRows = train.cabinRows.slice()

    const pose = cabinPose(world, train)
    frames.push({ tick: world.tick, simTime: world.simTime, train: pose })

    // Every doorway release this tick: the ids that left the cabin queue, in the
    // order `stepAlighting` walked them (reverse queue order, front row only).
    const cabins = train.cabins.map(c => c.slice())
    if (prevCabins) {
      for (let d = 0; d < cabins.length; d++) {
        const before = prevCabins[d] ?? []
        const after = new Set(cabins[d])
        for (let q = before.length - 1; q >= 0; q--) {
          const id = before[q]
          if (after.has(id)) continue
          const a = world.pool.all().get(id)
          if (!a) continue
          // A wave past `CABIN_ALIGHT_MAX_S` (or an emptied consist) drops its queue
          // without a step-out: those riders are still aboard (`trainPhase` 1 and
          // `train` set), so they are not crossings.
          if (a.train !== -1) continue
          stepOuts.push({
            tick: world.tick, id, door: d, row: a.trainRow, file: a.trainFile,
            fromX: round6(a.rideFromX ?? a.x), fromY: round6(a.rideFromY ?? a.y), fromZ: round6(a.rideFromZ ?? a.z),
            toX: round6(a.rideToX ?? a.x), toY: round6(a.rideToY ?? a.y), toZ: round6(a.rideToZ ?? a.z),
            calledAt: world.tick, doorT: round6(train.doorT[d]),
            crossed: a.state === 1,
          })
        }
      }
    }
    if (world.metrics.boarded > prevBoarded) {
      for (let d = 0; d < train.boardings.length; d++) {
        const delta = train.boardings[d] - (prevDoorBoardings?.[d] ?? 0)
        if (delta <= 0) continue
        boardings.push({ tick: world.tick, door: d, count: delta, queueAfter: world.graph.servers[train.doors[d]]?.queue.length ?? 0, rate: round6(world.graph.servers[train.doors[d]]?.rate ?? 0) })
      }
    }
    if (world.metrics.leftBehind > prevLeftBehind) {
      leftBehind.push({
        tick: world.tick, delta: world.metrics.leftBehind - prevLeftBehind, total: world.metrics.leftBehind,
        state: train.state, t: train.t, alightLeft: train.alightLeft,
      })
    }
    prevBoarded = world.metrics.boarded
    prevAlighted = train.alighted
    prevLeftBehind = world.metrics.leftBehind
    prevDoorBoardings = train.boardings.slice()
    prevCabins = cabins
  }

  // The per-doorway stop summary: how deep its cabin queue was, when its first pair
  // left and when the doorway was handed to the boarders. This is the unit the C#
  // port has to reproduce door for door.
  const doorTimeline = []
  if (doorRows) {
    for (let d = 0; d < doorRows.length; d++) {
      let firstRelease = -1
      let released = -1
      let prev = -1
      for (const frame of frames) {
        if (!frame.train) continue
        if (firstRelease < 0 && prev >= 0 && frame.train.cabins < prev) firstRelease = frame.tick
        if (released < 0 && (frame.train.released & (1 << d)) !== 0) released = frame.tick
        prev = frame.train.cabins
      }
      doorTimeline.push({ door: d, rows: doorRows[d], firstReleaseTick: firstRelease, releasedTick: released })
    }
  }

  return {
    name,
    station: spec,
    referenceBootSeconds: DEFAULT_SIM_TIME,
    simSecondsPerTick: 1,
    seed: SEED,
    ridersPerDoor,
    serviceKey: key,
    trainId,
    doorSides,
    // bit 0 = the consist's local +y bank (the source's `plus`), bit 1 = `minus`.
    bankTargets: { plus: doorSides & 1 ? 1 : 0, minus: doorSides & 2 ? 1 : 0 },
    platformEdgeIds: panels,
    doorCount: world.doorsByTrack.get(key)?.length ?? 0,
    doorNodes: (world.doorsByTrack.get(key) ?? []).map(d => {
      const s = world.graph.servers[d]
      return { x: round6(world.graph.nodeX[s.node]), y: round6(world.graph.nodeY[s.node]), z: round6(world.graph.nodeZ[s.node]) }
    }),
    capacity: trainRatedCapacity(ZOO_LINE),
    dispatchTick,
    dispatchSimTime,
    removedTick,
    doorRows: doorRows ?? [],
    seeded,
    doorTimeline,
    ticks: frames,
    stepOuts,
    boardings,
    leftBehind,
    summary: {
      boarded: world.metrics.boarded,
      alighted: world.metrics.alighted,
      leftBehind: world.metrics.leftBehind,
      stepOuts: stepOuts.length,
      boardings: boardings.length,
      doorTimeline,
    },
    prevAlighted,
  }
}

/* ---------------------------------------------------------- render samples */

/**
 * `TrainSystem.setTrains` + `updateTrains` for one stop, at render cadence: the
 * published `doors-open` is binary (opening/dwell), the two banks ramp toward
 * `open && sideBit` at `DOOR_TRAVEL_S`, and every leaf is staged by the real
 * `trainDoorMotion`. The PSD group ramps toward the same binary target.
 */
function renderSamples(caseData) {
  const sides = caseData.doorSides
  const out = []
  const banks = [0, 0]
  let psd = 0
  // The source's own law, at its own cadence: a 60 fps frame, the shared 200 ms
  // state interval, `DOOR_TRAVEL_S` for a full crossing. The ramp is real-time based
  // in the source; the C# presentation reaches the same target through the sim
  // clock's interpolation seam, so the *targets*, the monotonicity and the staging
  // are the comparable facts, not the wall-clock duration.
  const dtPerSample = 1 / 60
  const step = (dtPerSample * (1000 / stateIntervalMs)) / DOOR_TRAVEL_S
  for (const frame of caseData.ticks) {
    const open = frame.train ? frame.train.open : 0
    const targets = [open && (sides & 1) !== 0 ? 1 : 0, open && (sides & 2) !== 0 ? 1 : 0]
    for (let s = 0; s < 60; s++) {
      for (let b = 0; b < 2; b++) {
        const cur = banks[b]
        if (cur === targets[b]) continue
        banks[b] = targets[b] > cur ? Math.min(targets[b], cur + step) : Math.max(targets[b], cur - step)
      }
      if (psd !== open) psd = open > psd ? Math.min(open, psd + step) : Math.max(open, psd - step)
      const staged = trainDoorMotion(banks[0])
      out.push([
        frame.tick,
        round6(psd),
        round6(banks[0]),
        round6(banks[1]),
        targets[0],
        targets[1],
        open,
        round6(staged.slide),
        round6(staged.plug),
      ])
    }
  }
  return out
}

/* --------------------------------------------------------------- the cases */

const UP = { trackId: 'track-1', edgeId: 'edge-track-1-left', side: 'left', dir: 'up' }
const DOWN = { trackId: 'track-5', edgeId: 'edge-track-5-left', side: 'right', dir: 'down' }

const cases = []
const zoo = runCase('zoo-line-5-up', stationSpec({ ...UP, alightPerTrain: 200 }), { ridersPerDoor: 3, ticks: 60 })
cases.push(zoo)
const zero = runCase('zero-alighters', stationSpec({ ...UP, alightPerTrain: 0 }), { ridersPerDoor: 3, ticks: 60 })
cases.push(zero)
const opposite = runCase('opposite-bank', stationSpec({ ...DOWN, alightPerTrain: 200 }), { ridersPerDoor: 3, ticks: 60 })
cases.push(opposite)
const saturated = runCase('saturated-cabin', stationSpec({ ...UP, alightPerTrain: 600 }), { ridersPerDoor: 1, ticks: 60 })
cases.push(saturated)
const idle = runCase('no-riders', stationSpec({ ...UP, alightPerTrain: 200 }), { ridersPerDoor: 0, ticks: 60 })
cases.push(idle)

for (const c of cases) delete c.prevAlighted

const zooBytes = (() => { try { return readFileSync(zooPath) } catch { return null } })()

const outputJson = {
  generatedBy: 'tools/unity-parity/record-station-service.mjs',
  sourceDocument: zooBytes ? zooPath.replaceAll('\\', '/').split('/metro/').pop() : null,
  sourceSha: zooBytes ? createHash('sha256').update(zooBytes).digest('hex') : null,
  lineId: LINE_ID,
  stock: STOCK.L,
  doorTravelSeconds: DOOR_TRAVEL_S,
  plugPhase: TRAIN_DOOR_PLUG_PHASE,
  // `TrainSystem.advanceTrainDoors` law: dt is real seconds, the state post is
  // `stateIntervalMs` real milliseconds, `DOOR_TRAVEL_S` sim seconds per crossing.
  render: { fps: 60, stateIntervalMs },
  doorCentres: (() => {
    // The real cadence the door servers were seated from, for the C# port to check
    // its own derivation against without re-deriving it from the graph.
    const world = new World(stationData(stationSpec({ ...UP })), SEED, { zoneBarriers: false })
    const doors = world.doorsByTrack.get(LINE_ID + '|track-1') ?? []
    return doors.map(d => round6(world.graph.nodeX[world.graph.servers[d].node]))
  })(),
  cases,
}
// One sample row per rendered frame of the `zoo-line-5-up` stop:
// [tick, psd, plus, minus, plusTarget, minusTarget, doorsOpen, slide, plug].
outputJson.renderSamples = renderSamples(zoo)

mkdirSync(dirname(output), { recursive: true })
// Compact: this is machine-read evidence, and the per-tick/per-frame tables are wide.
writeFileSync(output, JSON.stringify(outputJson) + '\n')

console.log(`wrote ${output}`)
console.log(`line ${LINE_ID} stock L cars 6 alightPerTrain ${ZOO_LINE.alightPerTrain} doors ${zoo.doorCount} sides ${zoo.doorSides}`)
for (const c of cases) {
  const s = c.summary
  const first = c.ticks.find(f => f.train)
  console.log(`${c.name}: dispatch ${c.dispatchTick} removed ${c.removedTick} doors ${c.doorCount} sides ${c.doorSides}`)
  console.log(`  stepOuts ${s.stepOuts} boardings ${s.boardings} boarded ${s.boarded} alighted ${s.alighted} leftBehind ${s.leftBehind}`)
  console.log(`  doors: ${c.doorTimeline.map(d => `${d.door}:${d.rows}r/${d.firstReleaseTick}/${d.releasedTick}`).join(' ')}`)
}
