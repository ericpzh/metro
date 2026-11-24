// The worker's select-a-passenger message (§9.5, §7.6).
//
// `World.routeOf` is pure — `agent-route.test.mjs` pins that — but the *worker*
// is what a click actually reaches, and there the preview has to be posted
// without stepping the world. Stepping it would make watching a passenger
// advance the clock they are walking on: a sim that moves because it is being
// looked at, which is the one thing the observation contract forbids.
//
// The worker is a module with a `self` context, so it is driven here the way the
// browser drives it: a stub context whose `postMessage` records frames and whose
// `setInterval` the test fires by hand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CALENDAR, simTimeAtDate } from '../src/sim/clock.ts'
import { stationEdit } from '../src/sim/stationEdit.ts'

const frames = []
const listeners = []
let timerFn = null
const builds = new Map()
let nextBuild = 0
function flushBuild() {
  const callbacks = [...builds.values()]
  builds.clear()
  for (const fn of callbacks) fn()
}
globalThis.self = {
  setTimeout: fn => { builds.set(++nextBuild, fn); return nextBuild },
  clearTimeout: id => builds.delete(id),
  postMessage: (msg) => frames.push(msg),
  addEventListener: (type, fn) => listeners.push([type, fn]),
  setInterval: (fn) => {
    timerFn = fn
    return 1
  },
  clearInterval: () => {},
}

const { referenceStation } = await import('../src/data/reference-station.ts')
await import('../src/sim/worker.ts')

/** Deliver one message to the worker, the way `postMessage` would. */
function post(msg) {
  for (const [type, fn] of listeners) if (type === 'message') fn({ data: msg })
}
const lastState = () => frames.filter((f) => f.type === 'state').pop()

test('population edits keep graph, crowd, queues and clock, including a pending build', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data = referenceStation()
  let installed
  const originalRebuild = World.prototype.rebuild
  World.prototype.rebuild = function (...args) { installed = this; return originalRebuild.apply(this, args) }
  try {
    post({ type: 'init', data, seed: 1234, playing: false, speed: 1 })
    const world = installed
    const graph = world.graph, pool = world.pool, doors = world.doorLoads
    const tick = lastState().metrics.tick
    const line = data.lines[0], exit = data.modules.find(m => m.type === 'exit')
    const edit = { lines: [{ id: line.id, alightPerTrain: 123 }], exits: [{ id: exit.id, inRate: 456 }] }
    let rebuilds = 0
    World.prototype.rebuild = function (...args) { rebuilds++; return originalRebuild.apply(this, args) }
    const frameCount = frames.length
    post({ type: 'population', edit })
    assert.equal(frames.length, frameCount, 'paused demand edit clones no crowd frame and requests no redraw')
    assert.equal(rebuilds, 0)
    assert.equal(world.graph, graph)
    assert.equal(world.pool, pool)
    assert.equal(world.doorLoads, doors)
    assert.equal(lastState().metrics.tick, tick)
    assert.equal(world.lineById.get(line.id).alightPerTrain, 123, 'future train arrivals read the updated line index')
    assert.equal(world.data.modules.find(m => m.id === exit.id).cfg.inRate, 456, 'street spawns read the updated exit')
    post({ type: 'build', data: { ...data, name: 'pending structural edit' } })
    post({ type: 'population', edit })
    assert.equal(rebuilds, 0, 'population message does not flush topology work')
    flushBuild()
    assert.equal(rebuilds, 1)
    assert.equal(world.data.name, 'pending structural edit')
    assert.equal(world.lineById.get(line.id).alightPerTrain, 123)
    assert.equal(world.data.modules.find(m => m.id === exit.id).cfg.inRate, 456)
    assert.equal(lastState().metrics.tick, tick)
    post({ type: 'build', data })
    post({ type: 'population', edit })
    post({ type: 'init', data, seed: 1234, playing: false, speed: 1 })
    flushBuild()
    assert.equal(world.data.lines[0].alightPerTrain, line.alightPerTrain, 'loading cancels the pending edit')
  } finally { World.prototype.rebuild = originalRebuild }
})

post({ type: 'init', data: referenceStation(), seed: 1234, startSeconds: 6.5 * 3600 })
const first = lastState()
assert.ok(first, 'the worker posted its first frame')

test('service settings acknowledge changed forecasts without stepping or flushing a pending graph build', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data=referenceStation()
  const original=World.prototype.rebuild
  let world, rebuilds=0
  World.prototype.rebuild=function(...args){world=this;rebuilds++;return original.apply(this,args)}
  try {
    post({type:'init',data,seed:1,playing:false,speed:1})
    const graph=world.graph, tick=world.tick
    rebuilds=0
    const edit={lines:[],exits:[],headways:[{id:data.lines[0].id,headwayProfile:{peak:120,offpeak:240,late:360}}],settings:{service:{from:18000,to:82800}}}
    post({type:'build',data:{...data,name:'pending'}})
    const count=frames.length
    post({type:'population',edit})
    assert.equal(frames.length,count+1,'paused forecast updates are acknowledged')
    assert.equal(world.tick,tick)
    assert.equal(world.graph,graph)
    assert.equal(rebuilds,0)
    assert.deepEqual(world.day.service,edit.settings.service)
    flushBuild()
    assert.equal(rebuilds,1)
    assert.deepEqual(world.data.service,edit.settings.service)
    assert.deepEqual(world.lineById.get(data.lines[0].id).headwayProfile,edit.headways[0].headwayProfile)
    post({type:'control',playing:true,speed:1})
    const runningTick=world.tick
    post({type:'population',edit:{lines:[],exits:[],settings:{service:{from:21600,to:72000}}}})
    assert.equal(world.tick,runningTick,'running settings updates never advance the clock either')
  } finally {World.prototype.rebuild=original}
})

test('selecting a passenger while the sim runs does not step it', () => {
  post({ type: 'control', playing: true, speed: 1 })
  const before = lastState().metrics.tick

  // Fire the clock: the sim advances under its own interval, as it should.
  timerFn()
  const stepped = lastState().metrics.tick
  assert.equal(stepped, before + 1, 'a running clock ticks on its own interval')

  // Now the click. The selection is a preview: it must not be another tick.
  post({ type: 'selectAgent', id: 1, token: 7 })
  assert.equal(lastState().metrics.tick, stepped, 'watching a passenger does not advance the simulation')

  // And the route still reaches the renderer, on the tick that was coming anyway.
  timerFn()
  const frame = lastState()
  assert.equal(frame.metrics.tick, stepped + 1, 'the next tick carries on from where the clock was')
  assert.equal(frame.routeToken, 7, 'and answers the newest selection')
})

test('a paused sim is told about the selection at once, still without stepping', () => {
  post({ type: 'control', playing: false, speed: 1 })
  const held = lastState().metrics.tick
  const n = frames.length
  post({ type: 'selectAgent', id: -1, token: 8 })
  assert.equal(frames.length, n + 1, 'a paused sim has no stream, so the frame is posted now')
  const frame = lastState()
  assert.equal(frame.metrics.tick, held, 'and posting it stepped nothing')
  assert.equal(frame.routeToken, 8)
  assert.equal(frame.routeAgent, -1, 'nobody is selected')
  assert.equal(frame.route.length, 0, 'so the preview line is empty')
})

test('a paused seek moves the clock and posts at once, stepping nothing', () => {
  // The 时刻 window's calendar pick (§7.9's scrub): the clock moves, the station
  // and the crowd stay. `World.seek` itself — the dropped dispatch schedule and
  // the day type that follows — is pinned in `demand.test.mjs`; this is the
  // worker half of the path, posted straight away because a paused sim has no
  // stream to carry it later.
  post({ type: 'control', playing: false, speed: 1 })
  const held = lastState().metrics.tick
  const n = frames.length

  const saturday = simTimeAtDate({ year: 2026, month: 1, day: 10 }, DEFAULT_CALENDAR.epoch, 8 * 3600)
  post({ type: 'seek', seconds: saturday })
  assert.equal(frames.length, n + 1, 'a paused sim has no stream, so the moved clock is posted now')
  const frame = lastState()
  assert.equal(frame.metrics.simTime, saturday, 'the clock moved')
  assert.equal(frame.metrics.tick, held, 'and moving it stepped nothing')
})

test('cosmetic builds acknowledge edits without rebuilding routes; speed and topology still rebuild', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data = { name: 'test', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: -4, fill: 'solid', finish: { top: 'floor.tile' } }] }
  post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
  const original = World.prototype.rebuild
  let rebuilds = 0
  World.prototype.rebuild = function (...args) { rebuilds++; return original.apply(this, args) }
  try {
    const tick = lastState().metrics.tick, count = frames.length
    const painted = { ...data, cells: [{ ...data.cells[0], finish: { top: 'floor.tile', n: 'wall.enamel' } }] }
    post({ type: 'build', data: painted })
    assert.equal(rebuilds, 0, 'side color leaves routing/server state intact')
    assert.equal(frames.length, count + 1, 'paused renderer receives the acknowledgement immediately')
    assert.equal(lastState().metrics.tick, tick)
    const slow = { ...painted, cells: [{ ...painted.cells[0], finish: { top: 'floor.concrete' } }] }
    post({ type: 'build', data: slow })
    assert.equal(rebuilds, 0, 'topology work is deferred out of the build message')
    flushBuild()
    assert.equal(rebuilds, 1, 'changed walking speed rebuilds the graph')
    post({ type: 'build', data: { ...slow, cells: [...slow.cells, { x: 1, y: 0, z: -4, fill: 'solid' }] } })
    flushBuild()
    assert.equal(rebuilds, 2, 'structural edits rebuild the graph')
  } finally { World.prototype.rebuild = original }
})

test('inert decor builds skip routing while a bench stop still rebuilds', async () => {
  const { World } = await import('../src/sim/world.ts')
  const { createModule } = await import('../src/build/model.ts')
  const data = { name: 'test', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: -4, fill: 'solid' }] }
  post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
  const original = World.prototype.rebuild
  let rebuilds = 0
  World.prototype.rebuild = function (...args) { rebuilds++; return original.apply(this, args) }
  try {
    const sticker = createModule('tactile-guide', 0, 0, -4, 'sticker')
    post({ type: 'build', data: { ...data, modules: [sticker] } })
    assert.equal(rebuilds, 0, 'a floor sticker draws without walking')
    const urinal = createModule('urinal', 1, 0, -4, 'urinal')
    post({ type: 'build', data: { ...data, modules: [sticker, urinal] } })
    assert.equal(rebuilds, 0, 'a wall urinal does not rebuild routing')
    const bench = createModule('bench', 1, 0, -4, 'bench')
    post({ type: 'build', data: { ...data, modules: [sticker, urinal, bench] } })
    flushBuild()
    assert.equal(rebuilds, 1, 'a bench stop still rebuilds the graph')
  } finally { World.prototype.rebuild = original }
})

test('sidewalk, lawn and tree builds keep routes and paused simulation untouched', async () => {
  const { World } = await import('../src/sim/world.ts')
  const { createModule } = await import('../src/build/model.ts')
  const data = { name: 'outside', seed: 1, modules: [], lines: [], cells: [{ x: 0, y: 0, z: 0, fill: 'solid' }] }
  post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
  const original = World.prototype.rebuild
  let rebuilds = 0
  World.prototype.rebuild = function (...args) { rebuilds++; return original.apply(this, args) }
  try {
    const tick = lastState().metrics.tick
    // A 树木 is planting, not an obstacle (§9.5): its tile stays walkable, so a
    // planting is the same bargain as the tiles and props around it.
    for (const type of ['sidewalk', 'lawn', 'tree']) {
      post({ type: 'build', data: { ...data, modules: [createModule(type, 0, 0, 0, type)] } })
      assert.equal(rebuilds, 0, `a ${type} placement needs no new routes`)
      assert.equal(lastState().metrics.tick, tick)
    }
  } finally { World.prototype.rebuild = original }
})

test('functional edit bursts install only the latest snapshot without advancing the clock', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data = { name: 'burst', seed: 1, modules: [], lines: [], cells: [] }
  post({ type: 'init', data, seed: 1, playing: true, speed: 1 })
  const original = World.prototype.rebuild
  const installed = []
  World.prototype.rebuild = function (...args) { installed.push(this.data); return original.apply(this, args) }
  try {
    const tick = lastState().metrics.tick
    let latest
    for (let x = 0; x < 20; x++) {
      latest = { ...data, cells: [{ x, y: 0, z: -5, fill: 'solid' }] }
      post({ type: 'build', data: latest })
    }
    // An inert edit joins pending topology, it must not discard that edit.
    latest = { ...latest, name: 'latest' }
    post({ type: 'build', data: latest })
    assert.equal(installed.length, 0)
    assert.equal(builds.size, 1, 'one bounded task, even during continuous edits')
    timerFn()
    assert.equal(lastState().metrics.tick, tick + 1, 'old coherent world continues to tick')
    flushBuild()
    assert.deepEqual(installed, [latest])
    assert.equal(lastState().metrics.tick, tick + 1, 'installing the graph is not a simulation tick')
    assert.equal(builds.size, 0)
    // Undo back to the applied document avoids rebuilding intermediate layouts.
    post({ type: 'build', data })
    post({ type: 'build', data: latest })
    flushBuild()
    assert.equal(installed.length, 1, 'a reverted burst needs no graph rebuild')
    post({ type: 'build', data })
    post({ type: 'init', data: { ...data, name: 'replacement' }, seed: 2, playing: false, speed: 1 })
    const count = installed.length
    flushBuild()
    assert.equal(installed.length, count, 'loading cancels stale queued edits')
  } finally { World.prototype.rebuild = original }
})

test('compact station edits apply in order against a pending build and cancel on load', async () => {
  const { World } = await import('../src/sim/world.ts')
  const data = { name: 'base', seed: 1, modules: [], lines: [], cells: [] }
  const original = World.prototype.rebuild
  const installed = []
  World.prototype.rebuild = function (...args) { installed.push(this.data); return original.apply(this, args) }
  try {
    post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
    installed.length = 0
    const first = { ...data, cells: [{ x: 1, y: 0, z: -5, fill: 'solid' }] }
    const second = { ...first, cells: [...first.cells, { x: 2, y: 0, z: -5, fill: 'solid' }] }
    post({ type: 'build', data: first })
    post({ type: 'build-edit', edit: stationEdit(first, second) })
    assert.equal(builds.size, 1)
    assert.deepEqual(installed, [], 'the graph still belongs to the installed snapshot')
    flushBuild()
    assert.deepEqual(installed, [second], 'the splice retained the pending first cell')

    post({ type: 'build-edit', edit: stationEdit(second, first) })
    post({ type: 'init', data, seed: 1, playing: false, speed: 1 })
    const count = installed.length
    flushBuild()
    assert.equal(installed.length, count)
    assert.deepEqual(installed.at(-1), data)
  } finally { World.prototype.rebuild = original }
})

test('topology rebuilds publish fresh graph coordinates before density with matching generation and revision', async () => {
  const { CrowdSystem } = await import('../src/render/scene/systems/CrowdSystem.ts')
  const { SceneContextData } = await import('../src/render/scene/systems/SceneSystem.ts')
  const THREE = await import('three')

  const base = {
    name: 'density-base',
    seed: 1,
    modules: [],
    lines: [],
    cells: [
      { x: 0, y: 0, z: -5, fill: 'solid' },
      { x: 1, y: 0, z: -5, fill: 'solid' },
    ],
  }
  const grown = {
    ...base,
    cells: [...base.cells, { x: 2, y: 0, z: -5, fill: 'solid' }],
  }
  const shiftedSameCount = {
    ...base,
    cells: [
      { x: 10, y: 0, z: -5, fill: 'solid' },
      { x: 11, y: 0, z: -5, fill: 'solid' },
    ],
  }
  const otherStation = {
    name: 'density-other',
    seed: 2,
    modules: [],
    lines: [],
    cells: [{ x: -4, y: 3, z: -5, fill: 'solid' }],
  }

  const blob = new THREE.MeshBasicMaterial()
  const crowd = new CrowdSystem(new SceneContextData(new THREE.Scene(), { blob }, {}))
  const m4 = new THREE.Matrix4()
  const overlayPositions = () => {
    const out = []
    if (!crowd.overlay) return out
    for (let i = 0; i < crowd.overlay.count; i++) {
      crowd.overlay.getMatrixAt(i, m4)
      out.push([m4.elements[12], m4.elements[13], Math.round(m4.elements[14] * 100) / 100])
    }
    return out
  }

  try {
    post({ type: 'densityDemand', enabled: true })
    const start0 = frames.length
    post({ type: 'init', data: base, seed: 1, playing: false, speed: 1 })
    const initMsgs = frames.slice(start0)
    const ready0 = initMsgs.find(m => m.type === 'ready')
    const state0 = initMsgs.find(m => m.type === 'state')
    assert.ok(ready0 && state0)
    assert.ok(initMsgs.indexOf(ready0) < initMsgs.indexOf(state0), 'graph installs before its first density sample')
    assert.equal(state0.stationGen, ready0.stationGen)
    assert.equal(state0.graphRev, ready0.graphRev)
    assert.equal(state0.density.length, ready0.nodeCount)
    crowd.setDensity(ready0.nodes, state0.density, true)
    assert.ok(overlayPositions().some(([x, y, z]) => x === 0.5 && y === 0.5 && z === -3.94))

    // 1) Paused edit that changes node count.
    const start1 = frames.length
    post({ type: 'build', data: grown })
    flushBuild()
    const grownMsgs = frames.slice(start1)
    const ready1 = grownMsgs.find(m => m.type === 'ready')
    const state1 = grownMsgs.find(m => m.type === 'state')
    assert.ok(ready1 && state1, 'topology rebuild publishes fresh graph and state')
    assert.ok(grownMsgs.indexOf(ready1) < grownMsgs.indexOf(state1), 'fresh graph precedes its density sample')
    assert.equal(ready1.stationGen, ready0.stationGen)
    assert.equal(ready1.graphRev, ready0.graphRev + 1)
    assert.equal(state1.stationGen, ready1.stationGen)
    assert.equal(state1.graphRev, ready1.graphRev)
    assert.ok(ready1.nodeCount > ready0.nodeCount)
    assert.equal(state1.density.length, ready1.nodeCount)
    crowd.setDensity(ready1.nodes, state1.density, true)
    assert.ok(overlayPositions().some(([x, y, z]) => x === 2.5 && y === 0.5 && z === -3.94), 'added node draws at new coordinate')

    // 2) Undo back to base.
    const startUndo = frames.length
    post({ type: 'build', data: base })
    flushBuild()
    const undoMsgs = frames.slice(startUndo)
    const readyUndo = undoMsgs.find(m => m.type === 'ready')
    const stateUndo = undoMsgs.find(m => m.type === 'state')
    assert.ok(readyUndo && stateUndo)
    assert.equal(readyUndo.graphRev, ready1.graphRev + 1)
    assert.equal(stateUndo.graphRev, readyUndo.graphRev)
    assert.equal(readyUndo.nodeCount, ready0.nodeCount)

    // 3) Redo / edit that moves nodes while preserving exact nodeCount.
    const startMove = frames.length
    post({ type: 'build', data: shiftedSameCount })
    flushBuild()
    const moveMsgs = frames.slice(startMove)
    const readyMove = moveMsgs.find(m => m.type === 'ready')
    const stateMove = moveMsgs.find(m => m.type === 'state')
    assert.ok(readyMove && stateMove)
    assert.ok(moveMsgs.indexOf(readyMove) < moveMsgs.indexOf(stateMove))
    assert.equal(readyMove.nodeCount, readyUndo.nodeCount, 'node count is preserved')
    assert.equal(readyMove.graphRev, readyUndo.graphRev + 1, 'graph revision still increments')
    assert.equal(stateMove.graphRev, readyMove.graphRev)
    crowd.setDensity(readyMove.nodes, stateMove.density, true)
    const movedPos = overlayPositions()
    assert.ok(movedPos.some(([x, y, z]) => x === 10.5 && y === 0.5 && z === -3.94), 'moved nodes draw at new coordinates')
    assert.ok(!movedPos.some(([x, y, z]) => x === 0.5 && y === 0.5 && z === -3.94), 'old coordinates are gone')

    // 4) Station switch increments stationGen and resets graphRev.
    const startSwitch = frames.length
    post({ type: 'init', data: otherStation, seed: 2, playing: false, speed: 1 })
    const switchMsgs = frames.slice(startSwitch)
    const readySwitch = switchMsgs.find(m => m.type === 'ready')
    const stateSwitch = switchMsgs.find(m => m.type === 'state')
    assert.ok(readySwitch && stateSwitch)
    assert.ok(switchMsgs.indexOf(readySwitch) < switchMsgs.indexOf(stateSwitch))
    assert.ok(readySwitch.stationGen > readyMove.stationGen)
    assert.equal(readySwitch.graphRev, 1)
    assert.equal(stateSwitch.stationGen, readySwitch.stationGen)
    assert.equal(stateSwitch.graphRev, 1)
    crowd.setDensity(readySwitch.nodes, stateSwitch.density, true)
    assert.ok(overlayPositions().some(([x, y, z]) => x === -3.5 && y === 3.5 && z === -3.94))
  } finally {
    post({ type: 'densityDemand', enabled: false })
    crowd.dispose()
    blob.dispose()
  }
})

test('density demand sends density-only while paused and waits for next scheduled tick during 1x playback', () => {
  const data = referenceStation()
  post({ type: 'densityDemand', enabled: false })
  post({ type: 'init', data, seed: 7, playing: false, speed: 1 })
  const ready = frames.filter(m => m.type === 'ready').pop()
  const pausedTick = lastState().metrics.tick

  // Enabling while paused sends a density-only sample without stepping or posting a state frame.
  const beforePaused = frames.length
  post({ type: 'densityDemand', enabled: true })
  const pausedMsgs = frames.slice(beforePaused)
  assert.equal(pausedMsgs.length, 1)
  assert.equal(pausedMsgs[0].type, 'density', 'paused refresh is density-only')
  assert.equal(pausedMsgs[0].stationGen, ready.stationGen)
  assert.equal(pausedMsgs[0].graphRev, ready.graphRev)
  assert.equal(pausedMsgs[0].density.length, ready.nodeCount)
  assert.equal(lastState().metrics.tick, pausedTick, 'paused density refresh does not advance the world')

  // Playback at 1x starting with density disabled: enabling, disabling, and re-enabling
  // midway through an interpolation posts no extra frame, density sample, or tick.
  post({ type: 'densityDemand', enabled: false })
  post({ type: 'control', playing: true, speed: 1 })
  timerFn()
  const midTick = lastState().metrics.tick
  assert.equal(lastState().density.length, 0, 'density starts omitted while off at 1x')
  const beforeToggle = frames.length
  post({ type: 'densityDemand', enabled: true })
  post({ type: 'densityDemand', enabled: false })
  post({ type: 'densityDemand', enabled: true })
  assert.equal(frames.length, beforeToggle, 'enabling, disabling, and re-enabling density during 1x playback delivers no extra motion sample or density message')
  assert.equal(lastState().metrics.tick, midTick, 'and advances no extra tick')

  // The next scheduled tick attaches density to its regular state frame.
  timerFn()
  const nextFrame = lastState()
  assert.equal(nextFrame.metrics.tick, midTick + 1)
  assert.equal(nextFrame.stationGen, ready.stationGen)
  assert.equal(nextFrame.graphRev, ready.graphRev)
  assert.equal(nextFrame.density.length, ready.nodeCount)

  // Disabling omits density on the following scheduled tick.
  post({ type: 'densityDemand', enabled: false })
  timerFn()
  const omitted = lastState()
  assert.equal(omitted.metrics.tick, midTick + 2)
  assert.equal(omitted.density.length, 0)
  post({ type: 'control', playing: false, speed: 1 })
})
