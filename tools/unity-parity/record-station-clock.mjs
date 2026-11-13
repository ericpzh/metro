// TypeScript oracle for packet C's station clock and session time semantics.
//
// Reads a **non-Zoo** station document (the baked `StationData` a save normalizes
// to), applies the authored-day override the C# fixture uses, and emits the clock
// state every step of an elapsed schedule should land on â€” computed with
// `game/src/sim/clock.ts` itself (`stampAt`, `dayAt`, `simTimeAtDate`,
// `clockHandAngles`) plus `demandRate`, so the expected values are the source's
// answer and not a second implementation of it.
//
// The schedule mirrors `StationSimulationSession.Advance`: speed multiplies
// **ticks per real second**, one tick is `SIM_SECONDS_PER_TICK` simulated seconds,
// the scheduler caps one call at 64 whole ticks and drops the excess, and pause /
// seek / restart drop the fractional remainder. Every step's end state is recorded.
//
// Usage:
//   node tools/unity-parity/record-station-clock.mjs [output.json]
//       [--document game/src/data/tanwei-station.json]
//       [--no-override]
//
// Output default: unity/Assets/StationDesigner/Tests/EditMode/station-clock-oracle.json
// (the EditMode test reads it from `Application.dataPath`, like `rng-oracle.json`).
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  clockHandAngles,
  DEFAULT_CALENDAR,
  dayAt,
  normalizeCalendar,
  normalizePeaks,
  normalizeService,
  secondsOfClock,
  simTimeAtDate,
  stampAt,
} from '../../game/src/sim/clock.ts'
import { demandRate, normalizeDayDemand } from '../../game/src/sim/demand.ts'
import { buildGraph, PathFinder } from '../../game/src/sim/station.ts'
import { floorSpeed } from '../../game/src/sim/finishes.ts'
import { DEFAULT_SIM_TIME, SIM_SECONDS_PER_TICK } from '../../game/src/sim/constants.ts'

const args = process.argv.slice(2)
const output = resolve(args.find(a => !a.startsWith('--')) ?? 'unity/Assets/StationDesigner/Tests/EditMode/station-clock-oracle.json')
const documentPath = resolve(args.includes('--document') ? args[args.indexOf('--document') + 1] : 'game/src/data/tanwei-station.json')
const override = !args.includes('--no-override')

/** The authored-day override: proves the session reads the document, not the defaults. */
const OVERRIDE = {
  service: { from: 5 * 3600, to: 23 * 3600 },
  // 06:00â€“08:30 and 17:00â€“18:30 â€” deliberately not the shipped 07:30/17:30 pair.
  peaks: [{ from: 6 * 3600, to: 8 * 3600 + 30 * 60 }, { from: 17 * 3600, to: 18 * 3600 + 30 * 60 }],
  demand: {
    workday: { amPeak: 1.2, pmPeak: 0.9, sharpness: 0.8 },
    offday: { amPeak: 0.4, pmPeak: 0.5, sharpness: 1.4 },
  },
}

const sourceBytes = readFileSync(documentPath)
const source = JSON.parse(sourceBytes.toString('utf8'))
const raw = override ? {
  ...source,
  service: OVERRIDE.service,
  peaks: OVERRIDE.peaks,
  demand: OVERRIDE.demand,
  calendar: {
    ...(source.calendar ?? DEFAULT_CALENDAR),
    // A Monday the weekday rule would call å·¥ä½œæ—¥, listed as éžå·¥ä½œæ—¥ â€” the calendar
    // field is document data, so this must move the day type.
    holidays: [...new Set([...(source.calendar?.holidays ?? DEFAULT_CALENDAR.holidays), '2026-01-05'])],
  },
} : source

/** The authored day, normalized the way the app's load path normalizes it. */
const day = {
  service: normalizeService(raw.service),
  peaks: normalizePeaks(raw.peaks),
  ...normalizeDayDemand(raw.demand),
  calendar: normalizeCalendar(raw.calendar),
}

const workdayAt = (simTime, input) => dayAt(simTime, input.calendar).dayType === 'workday'
/** `demandRate` reads the flat DemandInput, while the oracle's `input` nests the two curves. */
const demandInput = input => ({ service: input.service, peaks: input.peaks, workday: input.demand.workday, offday: input.demand.offday })

/** One authored-day input as the C# `StationDayData` fixture reads it. Payload, not expectation. */
const dayJson = {
  service: { from: day.service.from, to: day.service.to },
  peaks: day.peaks.map(p => ({ from: p.from, to: p.to })),
  demand: {
    workday: { amPeak: day.workday.amPeak, pmPeak: day.workday.pmPeak, sharpness: day.workday.sharpness },
    offday: { amPeak: day.offday.amPeak, pmPeak: day.offday.pmPeak, sharpness: day.offday.sharpness },
  },
  calendar: {
    epoch: { year: day.calendar.epoch.year, month: day.calendar.epoch.month, day: day.calendar.epoch.day },
    holidays: day.calendar.holidays,
  },
}

/* ------------------------------------------------------- session arithmetic */

const MAX_TICKS_PER_FRAME = 64

/**
 * The source's `SimulationScheduler`: `pending += elapsed * speed`, whole ticks up to
 * the cap, and the fractional remainder kept (`pending -= floor(pending)` â€” which also
 * drops the ticks past the cap, exactly as the C# scheduler does).
 */
class Scheduler {
  pending = 0
  advance(elapsedSeconds, speed) {
    this.pending += elapsedSeconds * speed
    const available = Math.min(Math.floor(this.pending), MAX_TICKS_PER_FRAME)
    this.pending -= Math.floor(this.pending)
    return Math.max(0, available)
  }
  reset() { this.pending = 0 }
}

/** A session run: what `StationSimulationSession` does, with the clock's own TS functions. */
class ClockRun {
  constructor(startSimTime, input) {
    this.input = input
    this.simTime = startSimTime
    this.tick = 0
    this.playing = false
    this.speed = 1
    this.scheduler = new Scheduler()
  }
  setPlaying(playing) {
    if (playing === this.playing) return
    this.playing = playing
    this.scheduler.reset()
  }
  setSpeed(speed) {
    if (speed === this.speed) return
    this.speed = speed
    this.scheduler.reset()
  }
  advance(seconds) {
    if (!this.playing || !(seconds > 0)) return 0
    const ticks = this.scheduler.advance(seconds, this.speed)
    this.tick += ticks
    this.simTime += ticks * SIM_SECONDS_PER_TICK
    return ticks
  }
  seekSim(simTime) {
    this.simTime = simTime
    this.scheduler.reset()
  }
  seekDate(date) {
    const timeOfDay = ((Math.floor(this.simTime) % 86400) + 86400) % 86400
    this.simTime = simTimeAtDate(date, this.input.calendar.epoch, timeOfDay)
    this.scheduler.reset()
  }
  restart() { this.scheduler.reset() }
}

function frameOf(run, label) {
  const input = run.input
  const stamp = stampAt(run.simTime, input.calendar, input.service, input.peaks)
  const hands = clockHandAngles(run.simTime)
  return {
    label,
    ticksTotal: run.tick,
    simTime: run.simTime,
    dayIndex: stamp.dayIndex,
    dateKey: stamp.dateKey,
    weekday: stamp.weekday,
    dayType: stamp.dayType,
    period: stamp.period,
    isOpen: stamp.isOpen,
    peak: stamp.period === 'peak',
    timeOfDay: stamp.timeOfDay,
    dayFraction: stamp.dayFraction,
    clock: stamp.clock,
    clockSeconds: stamp.clockSeconds,
    hourHand: hands.hour,
    minuteHand: hands.minute,
    demandRate: demandRate(run.simTime, workdayAt(run.simTime, input), demandInput(input)),
  }
}

/** Run a schedule and record the frame after every step. */
function scenario(name, startSimTime, steps, dayOverride = null) {
  const run = new ClockRun(startSimTime, dayOverride ?? dayJson)
  const frames = [frameOf(run, 'start')]
  for (const [index, step] of steps.entries()) {
    if (step.op === 'seekDate') run.seekDate({ year: step.year, month: step.month, day: step.day })
    else if (step.op === 'seekSim') run.seekSim(step.simTime)
    else if (step.op === 'restart') run.restart()
    else {
      run.setPlaying(step.playing)
      run.setSpeed(step.speed)
      run.advance(step.seconds)
    }
    frames.push(frameOf(run, step.label ?? `step-${index}`))
  }
  // Always emit the day this scenario runs (never JSON null): Unity's JsonUtility turns a
  // null class field into a default-constructed instance instead of null, and a zeroed day
  // would read as a station open for a quarter of an hour at midnight.
  return { name, startSimTime, input: dayOverride ?? dayJson, steps, frames }
}

const play = (label, speed, seconds, playing = true) => ({ op: 'play', label, playing, speed, seconds })
const seekDate = (label, year, month, dayOfMonth) => ({ op: 'seekDate', label, year, month, day: dayOfMonth })
const restart = label => ({ op: 'restart', label })

/** 2026-01-05 is a Monday â€” a workday by weekday, a holiday in this document's list. */
const MONDAY = { year: 2026, month: 1, day: 5 }
const TUESDAY = { year: 2026, month: 1, day: 6 }
const SATURDAY = { year: 2026, month: 1, day: 10 }

const scenarios = [
  // Cold boot: REFERENCE_BOOT is 06:30 and there is no warmup.
  scenario('cold-boot', DEFAULT_SIM_TIME, []),

  // One real second at each multiplier. 1 s at 64Ã— is exactly the scheduler's cap.
  scenario('speeds', DEFAULT_SIM_TIME, [
    play('1x', 1, 1),
    play('4x', 4, 1),
    play('16x', 16, 1),
    play('64x', 64, 1),
  ]),

  // Pause: a paused Advance steps nothing and banks nothing; resuming keeps the
  // remainder only from the resumed call.
  scenario('pause', DEFAULT_SIM_TIME, [
    play('running-16x', 16, 2),
    play('paused-5s', 16, 5, false),
    play('resumed-16x', 16, 0.5),
  ]),

  // Midnight rollover: 64Ã— for one second starts 30 s before midnight of day 4.
  scenario('midnight', simTimeAtDate(MONDAY, day.calendar.epoch, 23 * 3600 + 59 * 60 + 30), [
    play('cross-midnight', 64, 1),
  ]),

  // The document's own day types: a listed Monday holiday, a plain Tuesday and a
  // Saturday, each read at 08:00 â€” inside this document's morning peak window.
  scenario('weekday-holiday', simTimeAtDate(MONDAY, day.calendar.epoch, 8 * 3600), [
    play('listed-holiday', 1, 1),
    seekDate('tuesday', TUESDAY.year, TUESDAY.month, TUESDAY.day),
    play('workday-peak', 1, 1),
    seekDate('saturday', SATURDAY.year, SATURDAY.month, SATURDAY.day),
    play('offday-no-peak', 1, 1),
  ]),

  // Service close: the window shuts at 23:00 in this document, and the clock keeps
  // running across it.
  scenario('service-close', simTimeAtDate(TUESDAY, day.calendar.epoch, 22 * 3600 + 59 * 60 + 30), [
    play('last-open-second', 1, 1),
    play('closed', 1, 60),
  ]),

  // Restart: the clock keeps its instant and the tick counter keeps counting.
  scenario('restart', DEFAULT_SIM_TIME, [
    play('before-restart', 4, 2),
    restart('restart'),
    play('after-restart', 1, 1),
  ]),

  // Seek: forward onto a date, then backwards before the epoch. The time of day is
  // carried across, which is the æ—¶åˆ» window's calendar pick.
  scenario('seek', DEFAULT_SIM_TIME, [
    play('tick-before-seek', 4, 1),
    seekDate('forward', 2026, 1, 10),
    seekDate('before-epoch', 2025, 12, 25),
  ]),

  // The scheduler's documented cap: one Advance call spends at most 64 whole ticks
  // and drops the excess, so a 300 s call at 1× advances 64 simulated seconds.
  scenario('tick-cap', DEFAULT_SIM_TIME, [
    play('one-long-call', 1, 300),
    play('next-call-keeps-only-the-remainder', 1, 0.5),
  ]),

  // A service window that reaches the end of the day, walked through midnight: the
  // station is shut after 23:59 and stays shut on the next day's 00:00. Stepped in
  // fifty-second calls, which is what a real frame loop looks like.
  scenario('wrap-service', simTimeAtDate(TUESDAY, day.calendar.epoch, 23 * 3600 + 58 * 60), [
    play('through-midnight-1', 1, 50),
    play('through-midnight-2', 1, 50),
    play('through-midnight-3', 1, 50),
    play('through-midnight-4', 1, 50),
    play('through-midnight-5', 1, 50),
    play('through-midnight-6', 1, 50),
  ], {
    ...dayJson,
    service: { from: normalizeService({ from: 22 * 3600, to: 23 * 3600 + 59 * 60 }).from, to: normalizeService({ from: 22 * 3600, to: 23 * 3600 + 59 * 60 }).to },
  }),

  // A disconnected document (no lines, modules or cells) still advances the clock:
  // this schedule is the one the C# test runs against an empty document.
  scenario('disconnected', DEFAULT_SIM_TIME, [
    play('disconnected-16x', 16, 1),
    play('disconnected-64x', 64, 0.5),
  ]),
]

/* --------------------------------------------------------- normalization pins */

const normalizeServiceCase = (from, to) => {
  const span = normalizeService({ from, to })
  return { from: span.from, to: span.to }
}
const normalizePeaksCase = raw => normalizePeaks(raw).map(p => ({ from: p.from, to: p.to }))
const normalizeCalendarCase = raw => {
  const calendar = normalizeCalendar(raw)
  return {
    epoch: { year: calendar.epoch.year, month: calendar.epoch.month, day: calendar.epoch.day },
    holidays: calendar.holidays,
  }
}
const knobs = k => ({ amPeak: k.amPeak, pmPeak: k.pmPeak, sharpness: k.sharpness })

const normalization = {
  serviceInverted: normalizeServiceCase(10 * 3600, 9 * 3600),
  serviceOutOfRange: normalizeServiceCase(-100, 99 * 3600),
  serviceAtDayEnd: normalizeServiceCase(25 * 3600, 25 * 3600),
  peaksCrossed: normalizePeaksCase([{ from: 8 * 3600, to: 20 * 3600 }, { from: 9 * 3600, to: 10 * 3600 }]),
  peaksSqueezed: normalizePeaksCase([{ from: 6 * 3600, to: 23 * 3600 + 59 * 60 }, { from: 17 * 3600, to: 19 * 3600 }]),
  calendarClamped: normalizeCalendarCase({ epoch: { year: 2026, month: 2, day: 30 }, holidays: ['2026-01-01', 'not-a-date', '2026-1-1'] }),
  calendarMissingList: normalizeCalendarCase({ epoch: { year: 2026, month: 1, day: 1 } }),
  demandRounded: knobs(normalizeDayDemand({ workday: { amPeak: 2.567, pmPeak: -1, sharpness: 9 }, offday: { amPeak: 0.4, pmPeak: 0.5, sharpness: 1.4 } }).workday),
  // Only the two that parse; the null cases are asserted directly in C# because a
  // JSON `null` and a JSON `0` are the same thing to Unity's JsonUtility.
  secondsOfClock: {
    open: secondsOfClock('05:00'),
    lastMinute: secondsOfClock('23:59'),
  },
}

/* ------------------------------------------------------------ adapter checks */

// The C4 adapter is pure TS; exercise it here so `node --check`-style verification
// covers the React-facing mapping too (the game's own typecheck covers its types).
const adapter = await import('../../game/src/unity-web/simulationAdapter.ts')
const sent = []
const port = adapter.createSimulationPort({ send: command => sent.push(command) })
const checks = []
const check = (name, condition, detail) => {
  checks.push({ name, ok: !!condition, detail: condition ? undefined : detail })
  if (!condition) throw new Error(`adapter check failed: ${name} :: ${detail}`)
}
check('no session means no control', port.unavailableReason('play') === 'no-session', port.unavailableReason('play'))
check('send before connect is dropped', port.send({ type: 'sim.play', payload: { playing: true } }) === false && sent.length === 0, `sent=${sent.length}`)
const clock = scenarios[0].frames[0]
port.receiveClock({
  simTimeSeconds: clock.simTime, dayIndex: clock.dayIndex, playing: true, speed: 4,
  serviceOpen: clock.isOpen, peak: clock.peak,
  period: clock.period, dateKey: clock.dateKey, weekday: clock.weekday, dayType: clock.dayType,
  timeOfDaySeconds: clock.timeOfDay, dayFraction: clock.dayFraction,
  clock: clock.clock, clockSeconds: clock.clockSeconds,
  hourHandDegrees: clock.hourHand, minuteHandDegrees: clock.minuteHand,
  tick: clock.ticksTotal, service: dayJson.service, peaks: dayJson.peaks,
  demandRate: clock.demandRate,
}, {
  clock: true, play: true, speed: true, seek: true, restart: true, serviceWindow: true,
  trains: true, doors: true, escalators: true, lifts: true,
  crowd: false, gates: false, queues: false, boarding: false,
})
check('a connected session drives play/speed/seek/restart', ['play', 'speed', 'seek', 'restart'].every(a => port.unavailableReason(a) === null), JSON.stringify(port.getState().capabilities))
check('day edits stay unavailable until the host commits them', port.unavailableReason('serviceWindow') === 'day-edit-unavailable', port.unavailableReason('serviceWindow'))
check('play sends sim.play', port.send({ type: 'sim.play', payload: { playing: true } }) && sent.at(-1).type === 'sim.play', JSON.stringify(sent.at(-1)))
check('speed sends sim.speed', port.send({ type: 'sim.speed', payload: { speed: 16 } }) && sent.at(-1).payload.speed === 16, JSON.stringify(sent.at(-1)))

// Store mapping: only playing/speed/unityClock are written — never a metric.
let state = {
  playing: false, speed: 1, unityClock: null,
  station: { calendar: { epoch: dayJson.calendar.epoch } },
  metrics: null,
}
const writes = []
const store = {
  getState: () => state,
  setState: partial => { writes.push(partial); state = { ...state, ...partial } },
}
adapter.applyUnityClock(store, { simTimeSeconds: 23400, dayIndex: 0, playing: true, speed: 16, serviceOpen: true, peak: false })
check('applyUnityClock writes playing/speed/unityClock only', writes.length === 1 && Object.keys(writes[0]).sort().join(',') === 'playing,speed,unityClock', JSON.stringify(writes))
check('unityClock is seconds since day zero', state.unityClock === 23400 && state.playing === true && state.speed === 16, JSON.stringify(state))
check('a null clock is ignored', (() => { adapter.applyUnityClock(store, { simTimeSeconds: Number.NaN, dayIndex: 0, playing: false, speed: 1, serviceOpen: false, peak: false }); return writes.length === 1 })())
check('stationClockOf prefers the TS run', adapter.stationClockOf({ metrics: { simTime: 100 }, unityClock: 23400 }) === 100, 'metrics first')
check('stationClockOf falls back to Unity', adapter.stationClockOf({ metrics: null, unityClock: 23400 }) === 23400, 'unity fallback')
check('stationClockOf prints nothing when neither reports', adapter.stationClockOf({ metrics: null, unityClock: null }) === null, 'no invented 0:00')

// Commands through the store actions: seek keeps the time of day and sends seconds.
sent.length = 0
const actions = adapter.simulationStoreActions(port, store)
actions.setPlaying(true)
actions.setSpeed(64)
actions.setSpeed(3) // unsupported speed is not a command
actions.restartSim()
actions.seekToDate({ year: 2026, month: 1, day: 10 })
check('setPlaying/setSpeed/restart send sim.* commands', sent.map(c => c.type).join(',') === 'sim.play,sim.speed,sim.restart,sim.seek', JSON.stringify(sent.map(c => c.type)))
const seek = sent.at(-1)
const expectedSeek = simTimeAtDate({ year: 2026, month: 1, day: 10 }, dayJson.calendar.epoch, clock.timeOfDay)
check('seek keeps the time of day', seek.payload.simTimeSeconds === expectedSeek, `${seek.payload.simTimeSeconds} != ${expectedSeek}`)
// The seek's own reply carries the new instant: that is what the panel then prints.
adapter.applyUnityClock(store, { simTimeSeconds: expectedSeek, dayIndex: 9, playing: true, speed: 64, serviceOpen: clock.isOpen, peak: clock.peak })
check('station clock reads one number for the panel', adapter.stationClockOf(state) === expectedSeek, String(adapter.stationClockOf(state)))
port.disconnect()
check('disconnect clears the clock', port.getState().clock === null && port.getState().connected === false, JSON.stringify(port.getState().connected))
check('disconnected controls disable again', port.unavailableReason('play') === 'no-session', port.unavailableReason('play'))
console.log(`adapter checks: ${checks.length}/${checks.length} passed`)
/* -------------------------------------------------------------- route oracle */

// A **non-Zoo** fixture built in code: the plaza is the generated street, a fence
// fare line with two gates separates it, a closed fence pen is disconnected, and a
// basement room is reached by one descending escalator. Everything the C# walk-graph
// builder claims to port appears here; everything it reports unported does not.
const routeDocument = (() => {
  const cells = []
  const modules = []
  let id = 0
  const mod = (type, x, y, z, extra = {}) => {
    const m = { id: `${type}-${++id}`, type, x, y, z, rot: 0, cfg: {}, ...extra }
    modules.push(m)
    return m
  }
  // The authored paid patch: a 3 x 3 slab that replaces generated ground and carries
  // the paid zone (a generated cell is always 站外).
  for (let x = 5; x <= 7; x++) for (let y = 4; y <= 6; y++)
    cells.push({ x, y, z: 0, fill: 'solid', zone: 'paid', finish: { top: 'floor.granite' } })
  // The fare line: a fence run along y = 0 with two gates, at x = 1 and x = 7.
  for (let x = 0; x <= 8; x++) if (x !== 1 && x !== 7) mod('fence', x, 0, 0)
  mod('gate', 1, 0, 0, { cfg: { dir: 'in', door: 'lane' } })
  mod('gate', 7, 0, 0, { cfg: { dir: 'both', door: 'lane' } })
  // A closed fence pen around (12, 10): walkable floor with no way in.
  for (const [x, y] of [[11, 9], [12, 9], [13, 9], [11, 10], [13, 10], [11, 11], [12, 11], [13, 11]]) mod('fence', x, y, 0)
  // A bare portal (no head-house walls) and a pillar and a road: three more whole-cell
  // obstacle families.
  mod('exit', 2, -3, 0, { cfg: { name: 'A', open: true, headHouse: false, style: 'doorway' } })
  mod('pillar', 7, 3, 0, { cfg: { height: 1 } })
  mod('road', 0, 6, 0, { w: 3, d: 2, cfg: { dir: 'x' } })
  // Two basement rooms served by one escalator. Both sit below the street so the
  // escalator carves no grade opening (that derived-station-floor family is reported
  // unported rather than half-ported); the plaza has no way down, which is the
  // disconnected case at station scale.
  for (let x = 2; x <= 5; x++) for (let y = 4; y <= 8; y++)
    if (!(x === 2 && y === 4)) cells.push({ x, y, z: -5, fill: 'solid', zone: 'paid', finish: { top: 'floor.granite' } })
  for (let x = 2; x <= 5; x++) for (let y = 4; y <= 8; y++)
    if (!(x === 2 && y === 4)) cells.push({ x, y, z: -10, fill: 'solid', zone: 'paid', finish: { top: 'floor.granite' } })
  mod('escalator', 3, 6, -5, {
    from: { x: 3, y: 6, z: -5 }, to: { x: 3, y: 6, z: -10 },
    cfg: { dir: 'down', incline: 30, width: 1 },
  })
  return { name: 'route fixture', storeyHeight: 5, seed: 1, cells, modules, lines: [] }
})()

const zoneIndexByName = { none: 0, outside: 1, unpaid: 2, paid: 3, platform: 4, restricted: 5 }
const routeGraph = buildGraph(routeDocument)
const graphNodeKey = i => routeGraph.nodeKey[i]
const graphNodes = []
for (let i = 0; i < routeGraph.nodeCount; i++) {
  graphNodes.push({
    key: routeGraph.nodeKey[i], x: routeGraph.nodeX[i], y: routeGraph.nodeY[i], z: routeGraph.nodeZ[i],
    speed: routeGraph.nodeSpeed[i], zone: routeGraph.nodeZone[i],
  })
}
// Flat, stable comparison order: source, destination, kind, cost. (A flat list rather
// than an array of arrays: Unity's JsonUtility reads nested object arrays reliably,
// jagged arrays less so.)
const graphEdges = []
for (let i = 0; i < routeGraph.nodeCount; i++) {
  for (let e = routeGraph.adjStart[i]; e < routeGraph.adjStart[i + 1]; e++) {
    graphEdges.push({ from: i, to: routeGraph.adjTo[e], kind: routeGraph.adjKind[e], cost: routeGraph.adjCost[e], server: routeGraph.adjServer[e] })
  }
}
graphEdges.sort((a, b) => a.from - b.from || a.to - b.to || a.kind - b.kind || a.cost - b.cost)
const routeProbes = [
  { name: 'plaza-to-paid-through-near-gate', start: '4,-3,0', goal: '6,5,0', needs: { stepFree: false, luggage: false } },
  { name: 'plaza-through-west-gate', start: '4,-3,0', goal: '0,3,0', needs: { stepFree: false, luggage: false } },
  { name: 'disconnected-pen-has-no-route', start: '4,-3,0', goal: '12,10,0', needs: { stepFree: false, luggage: false } },
  { name: 'basement-unreachable-from-plaza', start: '4,-3,0', goal: '4,7,-5', needs: { stepFree: false, luggage: false } },
  { name: 'lower-room-via-escalator', start: '4,7,-5', goal: '4,7,-10', needs: { stepFree: false, luggage: false } },
  { name: 'step-free-lower-room-unreachable', start: '4,7,-5', goal: '4,7,-10', needs: { stepFree: true, luggage: false } },
]
const routeResults = []
const finder = new PathFinder(routeGraph)
for (const probe of routeProbes) {
  const start = routeGraph.nodeIndex.get(probe.start)
  const goal = routeGraph.nodeIndex.get(probe.goal)
  if (start === undefined || goal === undefined) throw new Error(`route probe endpoint missing: ${probe.name}`)
  const path = finder.search(start, goal, probe.needs)
  routeResults.push({
    name: probe.name, start: probe.start, goal: probe.goal, needs: probe.needs,
    found: path !== null,
    keys: path === null ? [] : [...path].map(graphNodeKey),
    cost: path === null ? -1 : [...path].slice(1).reduce((sum, node, index) => {
      const from = path[index]
      let best = Infinity
      for (let e = routeGraph.adjStart[from]; e < routeGraph.adjStart[from + 1]; e++) {
        if (routeGraph.adjTo[e] === node && routeGraph.adjCost[e] < best) best = routeGraph.adjCost[e]
      }
      return sum + best
    }, 0),
  })
}

// The same fixture in the plain facts shape `StationSessionDocument` reads.
const routeDocumentFacts = {
  stationId: routeDocument.name,
  levelBase: 0,
  lines: routeDocument.lines.map(line => ({ id: line.id, direction: line.direction, headwayPeak: line.headwayProfile.peak, headwayOffpeak: line.headwayProfile.offpeak, headwayLate: line.headwayProfile.late })),
  cells: routeDocument.cells.map(cell => ({ x: cell.x, y: cell.y, z: cell.z, solid: cell.fill === 'solid', zone: zoneIndexByName[cell.zone ?? 'none'] ?? 0, speed: floorSpeed(cell) })),
  modules: routeDocument.modules.map(m => ({
    id: m.id, type: m.type, x: m.x, y: m.y, z: m.z, rot: m.rot ?? 0,
    width: m.w ?? m.cfg?.width ?? 1, depth: m.d ?? 1, height: m.cfg?.height ?? 1,
    lineId: m.cfg?.line ?? null, name: m.cfg?.name ?? null, headHouse: m.cfg?.style !== 'doorway' && m.cfg?.style !== 'virtual',
    dir: m.cfg?.dir ?? null, side: m.cfg?.side ?? null, railId: m.cfg?.from ?? null,
    gateDir: m.cfg?.dir === 'in' ? 1 : m.cfg?.dir === 'out' ? -1 : 0,
    gateOpen: true, gateHasLane: m.type === 'gate' ? (m.cfg?.door ?? 'lane') === 'lane' : false,
    tunnel: m.cfg?.tunnel ?? false, bridge: m.cfg?.bridge ?? false, block: m.cfg?.block ?? false,
    hasEndpoints: !!m.from,
    fromX: m.from?.x ?? 0, fromY: m.from?.y ?? 0, fromZ: m.from?.z ?? 0,
    toX: m.to?.x ?? 0, toY: m.to?.y ?? 0, toZ: m.to?.z ?? 0,
    runLength: 0,
  })),
}

const routeOracle = {
  generatedBy: 'tools/unity-parity/record-station-clock.mjs',
  graphVersion: routeGraph.version,
  nodeCount: routeGraph.nodeCount,
  stationArea: routeGraph.stationArea,
  levelsZ: routeGraph.levelsZ,
  nodes: graphNodes,
  edges: graphEdges,
  servers: routeGraph.servers.map(s => ({ id: s.id, kind: s.kind, node: s.node, exitNode: s.exitNode, rate: s.rate, ride: s.ride, batch: s.batch, cycle: s.cycle, gateMode: s.gateMode === 'in' ? 1 : s.gateMode === 'out' ? -1 : 0 })),
  platforms: routeGraph.platforms.map(p => ({ id: p.id, line: p.line, doors: p.doors.length, cells: p.cells.length })),
  exits: routeGraph.exits.map(e => ({ id: e.id, node: e.node, name: e.name })),
  routes: routeResults,
  document: routeDocumentFacts,
}
const outputJson = {
  generatedBy: 'tools/unity-parity/record-station-clock.mjs',
  sourceSha: sourceBytes ? createHash('sha256').update(sourceBytes).digest('hex') : null,
  sourceDocument: documentPath.replaceAll('\\', '/').split('/metro/').pop(),
  dayOverridden: override,
  referenceBootSeconds: DEFAULT_SIM_TIME,
  simSecondsPerTick: SIM_SECONDS_PER_TICK,
  maxTicksPerFrame: MAX_TICKS_PER_FRAME,
  input: dayJson,
  normalization,
  adapterChecks: checks.map(c => c.name),
  scenarios,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(outputJson, null, 2) + '\n')
const routeOutput = output.replace(/station-clock-oracle\.json$/, 'station-route-oracle.json')
writeFileSync(routeOutput, JSON.stringify(routeOracle) + '\n')

const cold = scenarios[0].frames[0]
console.log(`wrote ${output}`)
console.log(`source ${outputJson.sourceDocument} sha256=${outputJson.sourceSha}`)
console.log(`cold boot ${cold.clockSeconds} ${cold.dateKey} ${cold.dayType} ${cold.period} open=${cold.isOpen} daylight=${cold.dayFraction}`)
for (const item of scenarios) {
  const last = item.frames[item.frames.length - 1]
  console.log(`${item.name}: ${item.frames.length - 1} steps -> tick ${last.ticksTotal} simTime ${last.simTime} ${last.clockSeconds} ${last.period} open=${last.isOpen}`)
}




