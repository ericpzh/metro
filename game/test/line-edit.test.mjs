// The 线路 panel's edits, and the document paths that open a station.
//
// `app/store/slices/LineSlice.ts` is a thin panel layer over three player commands —
// 新建线路 (`addLine`), `updateLine` and 删除线路 (`removeLine`) — and all three are
// fan-outs. A line owns its rolling stock and its tracks' sizing, so a 供电 switch or
// a 屏蔽门 全高/半高 switch has to reach every `track` bound to the line
// (`setLinePower` and `regenerateRailEdges` in `build/rail.ts`) and every screen door
// derived from those tracks, and 删除线路 has to take the line, its tracks, its doors
// and any tunnel shell with it as **one** undo step. None of that throws when it
// breaks: the panel would show the new 供电 mode over rails still cut for the old one,
// or a delete would strand tracks bound to a line that no longer exists.
//
// `app/store/slices/StationSlice.ts` is the same story for the document itself —
// 新建 / 打开示例车站 / 打开存档 (`newStation`, `loadReference`, `loadFromText`) and the
// undo stack every edit pushes onto. `pushPast` is the memory cap: a depth limit alone
// would hold forty snapshots of an 11 000-cell build for the session, so a large
// document trades depth for a ceiling — and it must always drop the *oldest* frame,
// never the newest, or the last Ctrl+Z would land somewhere the player has never been.
//
// The worker is plumbing: `loadSim`/`rebuildSim` (`app/store/slices/SimSlice.ts`) reach
// it through `ensureClient`, and Node has no `Worker` global, so the harness stands a
// recording stub in its place. The document edits under test never wait on a reply.
import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore } from '../src/app/store.ts'
import { refreshTrackForSelection } from '../src/app/windows/inspector/refreshPlatform.ts'
import { initSim, selectSimAgent, setFrameHandler, setRouteHandler, subscribeFrame } from '../src/app/store/slices/SimSlice.ts'
import { defaultLine, makeTrack, placeRail, placeTunnel, trackPieceForLine } from '../src/build/rail.ts'
import { toState, toStateRepairing, createModule } from '../src/build/model.ts'
// The same module record `referenceStation()` clones, so damaging it for one test
// damages the document 打开示例车站 really reads (and the fixture is put back after).
import demoJson from '../src/data/demo-station.json' with { type: 'json' }
import { REFERENCE_BOOT, referenceStation } from '../src/data/reference-station.ts'
import { lineColourFor } from '../src/data/line-colours.ts'
import { SAVE_VERSION, serialize } from '../src/persistence/save.ts'
import { DEFAULT_CALENDAR, simTimeAtDate } from '../src/sim/clock.ts'
import { SIM_DAY } from '../src/sim/constants.ts'

/* --------------------------------------------------------------- the harness */

/** Every message the store posted into the worker, oldest first. */
const workerInbox = []
/** The stub the store opened, so a test can deliver a frame back to it. */
let workerStub = null

globalThis.Worker = class {
  constructor() {
    this.onmessage = null
    workerStub = this
  }
  postMessage(message) {
    workerInbox.push(message)
  }
}

const st = () => useStore.getState()

/** A row of platform floor: walkable, exposed, nothing built above it. */
function floorRow(x0, x1, y) {
  const out = []
  for (let x = x0; x <= x1; x++) out.push({ x, y, z: 0, fill: 'solid', finish: { top: 'floor.granite' } })
  return out
}

/** Put a document in the store with no history, as a fresh load leaves it. */
function load(data, rest = {}) {
  useStore.setState({
    station: toState(data),
    past: [],
    future: [],
    notice: null,
    version: 0,
    selected: null,
    railLineId: '',
    activeZ: 0,
    ...rest,
  })
}

const line = (id) => st().station.lines.find((l) => l.id === id)
const tracksOf = (id) => st().station.modules.filter((m) => m.type === 'track' && m.cfg.line === id)
const edgesOf = (id) => st().station.modules.filter((m) => m.type === 'platform-edge' && m.cfg.line === id)

test('equipment history retains the immutable document and restores it after later edits',()=>{
  load({ ...referenceStation(), modules: [] })
  const before=st().station
  st().commit({...before,modules:[createModule('bench',0,0,0,'new')]})
  assert.equal(st().past.at(-1),before,'equipment commits must not clone every authored cell')
  const placed=st().station
  st().commit({...placed,modules:placed.modules.map(m=>({...m,x:2}))})
  assert.equal(before.modules.length,0)
  assert.equal(placed.modules[0].x,0)
  st().undo();assert.equal(st().station,placed)
  st().undo();assert.equal(st().station,before)
  st().redo();assert.equal(st().station.modules[0].x,0)
})

test('bounded block and shaped-cell history retains immutable frames through delete, undo and redo',()=>{
  load({...referenceStation(),modules:[]})
  const before=st().station,source=JSON.stringify(before)
  const xs=before.cells.map(c=>c.x),ys=before.cells.map(c=>c.y)
  const x=Math.floor((Math.min(...xs)+Math.max(...xs))/2),y=Math.floor((Math.min(...ys)+Math.max(...ys))/2)
  const cell={x,y,z:13,fill:'solid',tags:['half-wall:n']}
  st().commit({...before,cells:[...before.cells,cell]})
  const placed=st().station
  assert.equal(st().past.at(-1),before,'one block must not copy every unrelated cell')
  st().commit({...placed,cells:placed.cells.filter(c=>c!==cell)})
  assert.equal(st().past.at(-1),placed)
  assert.equal(JSON.stringify(before),source)
  st().undo();assert.equal(st().station,placed)
  st().undo();assert.equal(st().station,before)
  st().redo();assert.deepEqual(st().station.cells.at(-1),cell)
})

test('structural history preserves exact immutable documents through stair edits and repeated undo/redo',async()=>{
  const {addEquipment,removeModule}=await import('../src/build/model.ts')
  load({...referenceStation(),modules:[]})
  const before=st().station,original=JSON.stringify(before)
  const piece=createModule('stair-left180',0,0,0,'history-stair')
  st().commit(addEquipment(before,piece))
  const placed=st().station,saved=JSON.stringify(placed)
  assert.equal(st().past.at(-1),before)
  st().commit(removeModule(placed,piece.id))
  const deleted=st().station
  assert.equal(st().past.at(-1),placed)
  for(let i=0;i<2;i++){
    st().undo();assert.equal(st().station,placed)
    st().undo();assert.equal(st().station,before)
    st().redo();assert.equal(st().station,placed)
    st().redo();assert.equal(st().station,deleted)
  }
  assert.equal(JSON.stringify(before),original)
  assert.equal(JSON.stringify(placed),saved)
})

test('population controls send only numbers and preserve undo/redo', () => {
  const data = { name: 'demand', seed: 1, cells: [], lines: [defaultLine('1', 'up')],
    modules: [{id:'exit',type:'exit',x:0,y:0,z:0,cfg:{name:'A',inRate:100,open:true}}] }
  load(data)
  initSim(data, 1)
  const old = line('1').alightPerTrain
  const cells = st().station.cells, modules = st().station.modules
  st().updateLine('1', {alightPerTrain:123})
  assert.equal(st().station.cells, cells)
  assert.equal(st().station.modules, modules)
  assert.deepEqual(workerInbox.at(-1), {type:'population',edit:{lines:[{id:'1',alightPerTrain:123}],exits:[]}})
  st().undo()
  assert.equal(workerInbox.at(-1).type, 'population', 'settings undo never sends the full station')
  assert.equal(st().station.cells, cells, 'history retains immutable geometry identity')
  assert.equal(line('1').alightPerTrain, old)
  st().redo()
  assert.equal(workerInbox.at(-1).type, 'population')
  assert.equal(line('1').alightPerTrain, 123)
  const s = st().station
  st().commit({...s,modules:s.modules.map(m=>m.type==='exit'?{...m,cfg:{...m.cfg,inRate:456}}:m)})
  assert.deepEqual(workerInbox.at(-1), {type:'population',edit:{lines:[],exits:[{id:'exit',inRate:456}]}})
  assert.equal(st().station.modules[0].cfg.inRate, 456)
  st().undo()
  assert.equal(st().station.modules[0].cfg.inRate, 100)
  st().redo()
  assert.equal(st().station.modules[0].cfg.inRate, 456)
})

test('unchanged line patches, missing lines and same-document commits do no work', () => {
  const data={name:'no-op',seed:1,cells:[],modules:[],lines:[defaultLine('1','up')]}
  load(data)
  const s=st().station, v=st().version, messages=workerInbox.length
  st().updateLine('1',{headwayProfile:{...s.lines[0].headwayProfile}})
  st().updateLine('1',{name:s.lines[0].name,alightPerTrain:s.lines[0].alightPerTrain})
  st().updateLine('missing',{alightPerTrain:123})
  st().commit(s)
  assert.equal(st().station,s)
  assert.equal(st().version,v)
  assert.equal(workerInbox.length,messages)
  assert.equal(st().past.length,0)
})

test('metadata and exit policy history preserve the structural view revision', () => {
  load({name:'View revision',seed:1,cells:[],modules:[{id:'exit',type:'exit',x:0,y:0,z:0,cfg:{name:'A',inRate:100,open:true}}],lines:[defaultLine('1','up')]})
  const geometry=st().geometryVersion, version=st().version
  st().renameStation('Renamed')
  st().updateLine('1',{colour:'#123456',name:'Line',upTerminus:'East',downTerminus:'West'})
  const s=st().station
  st().commit({...s,modules:s.modules.map(m=>({...m,cfg:{...m.cfg,open:false}}))})
  st().undo();st().redo()
  assert.equal(st().geometryVersion,geometry,'artwork and policy do not wake zone/move effects')
  assert.equal(st().version,version+5,'history and autosave still see every edit')
  st().commit({...st().station,cells:[{x:0,y:0,z:0,fill:'solid'}]})
  assert.equal(st().geometryVersion,geometry+1)
  st().undo();assert.equal(st().geometryVersion,geometry+2,'structural undo wakes geometry-dependent effects')
})

/** Every block a tunnel raised around itself, whatever track it belongs to. */
const shellCells = () => st().station.cells.filter((c) => c.tags?.some((t) => t.startsWith('tunnel-shell:'))).length

/**
 * Two lines: line 1 is a platform rail beside a floor row with a 隧道 run grown off
 * its end (the shape the 隧道 tool makes), line 2 sits two rows away with a rail of
 * its own. Line 2's 供电 is third-rail as well, so a switch on line 1 has to be
 * carried deliberately rather than matched by accident.
 */
function twoLines() {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1), ...floorRow(0, 5, 3), ...floorRow(0, 5, 4)]
  let s = toState({
    name: '线路测试',
    seed: 7,
    cells,
    modules: [],
    lines: [defaultLine('1', 'up', 'third-rail'), defaultLine('2', 'down', 'third-rail')],
  })
  s = placeRail(s, { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const platform = s.modules.find((m) => m.type === 'track')
  s = placeTunnel(s, platform.id, 4)
  s = placeRail(s, { x0: 0, y0: 4, x1: 5, y1: 4, z: 0 }, { lineId: '2', dir: 'down', power: 'third-rail' })
  return s
}

/**
 * The same pair of lines, but line 1's tunnel run stands clear of its platform rail
 * (built by `makeTrack` instead of `placeTunnel`, which always grows a run off a
 * platform rail's own end — the case the 车型 / 编组 test at the foot of this file
 * pins).
 */
function twoLinesClearTunnel() {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1), ...floorRow(0, 5, 3), ...floorRow(0, 5, 4)]
  let s = toState({
    name: '线路测试',
    seed: 7,
    cells,
    modules: [],
    lines: [defaultLine('1', 'up', 'third-rail'), defaultLine('2', 'down', 'third-rail')],
  })
  s = placeRail(s, { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  s = placeRail(s, { x0: 0, y0: 4, x1: 5, y1: 4, z: 0 }, { lineId: '2', dir: 'down', power: 'third-rail' })
  const tunnel = makeTrack({ id: 'tunnel-1', lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 6, z: 0, w: 4, d: 1, tunnel: true })
  return { ...s, modules: [...s.modules, tunnel] }
}

/* ------------------------------------------------------------ 新建线路 */

test('addLine makes the new line the one the rail tool binds, in its 广州地铁 colour', () => {
  load({ name: '线路测试', seed: 7, cells: [], modules: [], lines: [] }, { railDir: 'down' })
  st().addLine()
  const made = line('1')
  assert.equal(st().station.lines.length, 1, 'one line was added')
  assert.equal(made.id, '1', 'a fresh id, numbered from one')
  assert.equal(made.name, '1号线')
  assert.equal(made.colour, lineColourFor('1'), 'the colour is read from data/line-colours.ts, not invented')
  assert.equal(made.colour, '#edcf3b', '一号线 is born wearing the real 广州地铁 yellow')
  assert.equal(made.cars, 6, 'six cars is the B-stock default `defaultLine` builds')
  assert.equal(made.stock, 'B')
  assert.equal(made.power, 'third-rail')
  assert.equal(made.psd, 'full', 'a new line is born on the 全高 屏蔽门')
  assert.equal(made.direction, 'down', 'the new line runs the 上行 / 下行 the rail tool is set to')
  assert.equal(st().railLineId, '1', 'and it becomes what the rail tool binds')
  assert.equal(st().notice, '已新建 1号线，铺轨时自动绑定')
  assert.equal(st().past.length, 1, 'adding a line is one Ctrl+Z')
})

test('addLine numbers past the ids the document already holds', () => {
  load({ name: '线路测试', seed: 7, cells: [], modules: [], lines: [] })
  st().addLine()
  st().addLine()
  assert.deepEqual(st().station.lines.map((l) => l.id), ['1', '2'], 'a second new line is 2号线')
  assert.equal(st().railLineId, '2', 'and the last one added is the one the tool binds')

  // `lines.length + 1` is 3 and line 3 is already taken, so the search walks on.
  load({
    name: '线路测试',
    seed: 7,
    cells: [],
    modules: [],
    lines: [defaultLine('1', 'up', 'third-rail'), defaultLine('3', 'up', 'third-rail')],
  })
  st().addLine()
  assert.deepEqual(st().station.lines.map((l) => l.id), ['1', '3', '4'])
  assert.equal(st().railLineId, '4')
})

/* ------------------------------------------------------------ updateLine */

test('updateLine lands 名字 / 颜色 / 上行终点 / 下行终点 / 车型 / 编组 / 下车 on the line', () => {
  load(twoLines())
  st().updateLine('1', {
    name: '五号线',
    colour: '#c70541',
    upTerminus: '文冲',
    downTerminus: '滘口',
    stock: 'L',
    cars: 4,
    alightPerTrain: 900,
  })
  const l = line('1')
  assert.equal(l.name, '五号线')
  assert.equal(l.colour, '#c70541', 'the line colour is whatever the picker set, not the sign palette')
  assert.equal(l.upTerminus, '文冲', '上行终点 is what an 上行 screen prints')
  assert.equal(l.downTerminus, '滘口', '下行终点 is what a 下行 one prints')
  assert.equal(l.stock, 'L')
  assert.equal(l.cars, 4)
  assert.equal(l.alightPerTrain, 900, 'a patch that sets the whole-train total is left alone')
  assert.equal(line('2').name, '2号线', 'the other line is untouched')
  // A one-field edit leaves the rest of the record standing.
  st().updateLine('1', { name: '五号线（东延）' })
  assert.equal(line('1').colour, '#c70541')
  assert.deepEqual([line('1').upTerminus, line('1').downTerminus], ['文冲', '滘口'])
  assert.equal(st().past.length, 2, 'each accepted edit is one undo frame')
})

test('the 编组 snap holds a train on 2/3/4/6/8 cars and carries the per-car 下车 over', () => {
  load(twoLines())
  assert.equal(line('1').cars, 6, 'a fresh line is six cars')
  assert.equal(line('1').alightPerTrain, 200, 'and 200 下车 for the whole train')
  st().updateLine('1', { cars: 4 })
  assert.equal(line('1').cars, 4)
  assert.equal(line('1').alightPerTrain, 133, '200 over six cars is 133 over four: the chips keep the per-car load')
  st().updateLine('1', { cars: 3 })
  assert.equal(line('1').cars, 3)
  assert.equal(line('1').alightPerTrain, 100, 'three is on the menu, so it lands as drawn')
  st().updateLine('1', { cars: 0 })
  assert.equal(line('1').cars, 2, 'a zero-car train is not a train: it snaps to the bottom of the menu')
  assert.equal(line('1').alightPerTrain, 67, 'and the per-car figure follows the snap')
  st().updateLine('1', { cars: 99 })
  assert.equal(line('1').cars, 8, 'eight cars is the top of the menu')
  assert.equal(line('1').alightPerTrain, 268)
  st().updateLine('1', { cars: 5 })
  assert.equal(line('1').cars, 4, 'five snaps to the nearest menu entry')
  assert.equal(line('1').alightPerTrain, 134)
})

test('a 行车间隔 edit clamps leg by leg and keeps the legs it did not touch', () => {
  load(twoLines())
  st().updateLine('1', { headwayProfile: { peak: 90, offpeak: 300, late: 480 } })
  assert.deepEqual(line('1').headwayProfile, { peak: 90, offpeak: 300, late: 480 })
  st().updateLine('1', { headwayProfile: { peak: 20, offpeak: 9999, late: 480 } })
  assert.deepEqual(
    line('1').headwayProfile,
    { peak: 60, offpeak: 1200, late: 480 },
    'below the consist cycle and past a night service both clamp into range',
  )
})

test('updateLine with an id the document does not hold is a no-op', () => {
  load(twoLines())
  st().updateLine('nope', { name: '不存在的线路' })
  assert.deepEqual(st().station.lines.map((l) => l.name), ['1号线', '2号线'], 'no line was touched')
  assert.equal(st().past.length, 0, 'a stale card does not spend an undo frame')
  assert.equal(st().version, 0, 'and does not version an unchanged document')
})

test('a 供电 switch reaches every track bound to the line and no other line', () => {
  load(twoLines())
  const platform = tracksOf('1').find((t) => !t.cfg.tunnel)
  const tunnel = tracksOf('1').find((t) => t.cfg.tunnel)
  assert.ok(platform, 'the fixture laid a platform rail for line 1')
  assert.ok(tunnel, 'and a tunnel run off its end')
  assert.ok(tracksOf('1').every((t) => t.cfg.power === 'third-rail'), 'both start on the third rail')

  st().updateLine('1', { power: 'catenary' })
  assert.equal(line('1').power, 'catenary')
  for (const t of tracksOf('1')) assert.equal(t.cfg.power, 'catenary', `${t.id} is re-cut for the line 供电`)
  assert.equal(tracksOf('2')[0].cfg.power, 'third-rail', 'line 2 keeps its own 供电')
  assert.equal(line('2').power, 'third-rail', 'and its own line record')
  assert.equal(edgesOf('1').length, 1, 'the screen doors stay bound to the line')
})

test('a 屏蔽门 全高 / 半高 / 无 switch re-derives every screen door on the line', () => {
  load(twoLines())
  const before = edgesOf('1')
  assert.equal(before.length, 1, 'the platform rail derived one screen run')
  assert.ok(before.every((e) => e.cfg.psd === 'full'), 'a line is born on the 全高 screen')

  st().updateLine('1', { psd: 'half' })
  assert.equal(line('1').psd, 'half')
  assert.deepEqual(edgesOf('1').map((e) => e.id), before.map((e) => e.id), 'the same doors, re-derived — not a second set')
  assert.ok(edgesOf('1').every((e) => e.cfg.psd === 'half'), 'each screen reads 全高 / 半高 off its line')
  assert.ok(edgesOf('2').every((e) => e.cfg.psd === 'full'), 'line 2 keeps the height its screens were cut with')

  st().updateLine('1', { psd: 'none' })
  assert.equal(line('1').psd, 'none')
  assert.ok(edgesOf('1').every((e) => e.cfg.psd === 'none'))
  assert.ok(edgesOf('2').every((e) => e.cfg.psd === 'full'))
  st().undo()
  assert.equal(line('1').psd, 'half')
  assert.ok(edgesOf('1').every((e) => e.cfg.psd === 'half'))
  st().redo()
  assert.ok(edgesOf('1').every((e) => e.cfg.psd === 'none'))

  // The re-derivation hangs off `patch.psd`, so a 名字 edit must not touch the doors.
  const edge = edgesOf('1')[0]
  st().updateLine('1', { name: '另起名字' })
  assert.equal(edgesOf('1')[0], edge, 'a 名字 edit does not re-derive the screen doors')
})

test('a 车型 / 编组 edit re-cuts platform lengths and preserves tunnel run lengths', () => {
  load(twoLinesClearTunnel())
  const platformId = tracksOf('1').find((t) => !t.cfg.tunnel).id
  assert.equal(tracksOf('1').find((t) => t.cfg.tunnel).w, 4, 'the tunnel run was hand-sized at four metres')

  st().updateLine('1', { stock: 'A' })
  assert.equal(trackPieceForLine(line('1')).w, 130, 'A stock, six 22 m cars at the shared train scale')
  assert.equal(
    tracksOf('1').find((t) => t.id === platformId).w,
    130,
    'the platform rail is re-cut to the scaled consist the line now runs',
  )
  assert.equal(tracksOf('1').find((t) => t.cfg.tunnel).w, 4, 'a tunnel is hand-sized, so a consist edit leaves it')
  assert.equal(tracksOf('1').find((t) => t.cfg.tunnel).d, 3, 'the tunnel keeps enough width for the new stock')
  assert.deepEqual(edgesOf('1').map((e) => e.cfg.from), [platformId], 'and its screen doors were re-derived from the new run')
  assert.equal(tracksOf('2')[0].w, 6, 'another line keeps its own rails')

  st().updateLine('1', { cars: 4 })
  assert.equal(trackPieceForLine(line('1')).w, 87, 'four scaled 21.75 m A cars')
  assert.equal(tracksOf('1').find((t) => t.id === platformId).w, 87, 'a 编组 edit re-cuts the same rail again')
  assert.equal(tracksOf('1').find((t) => t.cfg.tunnel).w, 4)
  st().updateLine('1', {stock:'D', cars:8})
  assert.deepEqual(trackPieceForLine(line('1')), {w:158, d:4})
  assert.ok(tracksOf('1').some(t => t.id === platformId), 'a neighbouring rail refusing the wider bed cannot delete the original')
  st().removeLine('2')
  st().updateLine('1', {stock:'D', cars:8})
  assert.equal(tracksOf('1').find(t => t.id === platformId).d, 4, 'the 3.3 m D body fits inside a widened platform bed')
  assert.equal(tracksOf('1').find(t => t.cfg.tunnel).d, 4, 'the tunnel bore also widens for the D body')
})

test('a wider stock expands tunnel shells and bridge beds without changing their run lengths', () => {
  const data = twoLinesClearTunnel()
  const bridge = makeTrack({ id: 'bridge-1', lineId: '1', dir: 'up', power: 'catenary', rot: 0, x: 0, y: 20, z: 3, w: 16, d: 3, bridge: true })
  load({ ...data, modules: [...data.modules, bridge] })

  st().updateLine('1', { stock: 'D', cars: 8 })

  const tunnel = tracksOf('1').find((t) => t.cfg.tunnel)
  const widenedBridge = tracksOf('1').find((t) => t.cfg.bridge)
  assert.equal(tunnel.w, 4, 'the hand-sized tunnel keeps its authored run length')
  assert.equal(tunnel.d, 4, 'its bore widens to fit D stock')
  assert.equal(widenedBridge.w, 16, 'the bridge keeps its authored run length')
  assert.equal(widenedBridge.d, 4, 'its deck and railings widen with D stock')
  const piers = st().station.modules.filter((m) => m.type === 'pillar' && m.cfg.bridgeId === widenedBridge.id)
  assert.equal(piers.length, 2, 'the bridge keeps one generated pier per complete eight-metre bay')
  assert.ok(piers.every((m) => m.y === 22), 'the generated piers recenter under the wider deck')
  const shellTag = `tunnel-shell:${tunnel.id}`
  assert.ok(st().station.cells.some((c) => c.x === 0 && c.y === 6 && c.z === 4 && c.tags?.includes(shellTag)), 'the ceiling follows the widened bore')
  assert.ok(st().station.cells.some((c) => c.x === 0 && c.y === 5 && c.z === 1 && c.tags?.includes(shellTag)), 'the first side wall remains at the bore edge')
  assert.ok(st().station.cells.some((c) => c.x === 0 && c.y === 10 && c.z === 1 && c.tags?.includes(shellTag)), 'the opposite side wall moves with the bore')
  assert.equal(st().station.cells.some((c) => c.x === 0 && c.y === 7 && c.z === 1 && c.tags?.includes(shellTag)), false, 'the old narrow side wall is removed')
})

/* ------------------------------------------------------------ 删除线路 */

test('removeLine takes the line, its tracks, its doors and its tunnel shell as one Ctrl+Z', () => {
  load(twoLines())
  assert.equal(tracksOf('1').length, 2, 'a platform rail and the tunnel run off its end')
  assert.equal(edgesOf('1').length, 1, 'with the screen doors derived from the platform rail')
  assert.ok(shellCells() > 0, 'and the shell blocks the bore raised')

  st().removeLine('1')
  assert.equal(line('1'), undefined, 'the line is gone')
  assert.deepEqual(st().station.lines.map((l) => l.id), ['2'], 'and line 2 is not')
  assert.equal(tracksOf('1').length, 0, 'every track bound to the line goes with it')
  assert.equal(edgesOf('1').length, 0, 'and every screen door derived from those tracks')
  assert.equal(shellCells(), 0, 'and the tunnel shell those tracks raised')
  assert.equal(tracksOf('2').length, 1, 'line 2 keeps its rail')
  assert.equal(edgesOf('2').length, 1, 'and its doors')
  assert.equal(st().notice, '已删除线路 1号线，连同 2 段轨道')
  assert.equal(st().past.length, 1, 'the line and both its tracks are one undo frame, not three')

  st().undo()
  assert.deepEqual(st().station.lines.map((l) => l.id), ['1', '2'], 'one Ctrl+Z puts the line back')
  assert.equal(tracksOf('1').length, 2, 'and both of its tracks')
  assert.equal(edgesOf('1').length, 1, 'and the doors derived from them')
  assert.ok(shellCells() > 0, 'and the shell the tunnel raised')

  // A line with no tracks is simply dropped: the notice claims nothing it did not do.
  load({ name: '线路测试', seed: 7, cells: [], modules: [], lines: [defaultLine('1', 'up', 'third-rail')] })
  st().removeLine('1')
  assert.equal(st().notice, '已删除线路 1号线')
  assert.deepEqual(st().station.lines, [], 'the roster is empty again')
})

test('removeLine repoints the rail tool and drops a selection standing on a deleted track', () => {
  load(twoLines(), { railLineId: '1' })
  st().select({ kind: 'module', key: tracksOf('1')[0].id, label: '轨道' })
  st().removeLine('1')
  assert.equal(st().railLineId, '2', 'the rail tool falls back to a line that still exists')
  assert.equal(st().selected, null, 'a selection on a track that is gone cannot stay')

  // A selection somewhere else is none of the deleted line's business.
  load(twoLines(), { railLineId: '1' })
  const kept = tracksOf('2')[0].id
  st().select({ kind: 'module', key: kept, label: '轨道' })
  st().removeLine('1')
  assert.equal(st().selected?.key, kept, 'a selection on another line survives the delete')

  // And with no line left there is nothing for the rail tool to bind.
  load(twoLines(), { railLineId: '1' })
  st().removeLine('1')
  st().removeLine('2')
  assert.equal(st().railLineId, '', 'an empty roster leaves the rail tool bound to nothing')
})

test('removeLine with an id the document does not hold changes nothing', () => {
  load(twoLines())
  const before = st().station
  st().removeLine('nope')
  assert.equal(st().station, before, 'the document object is the one it already was')
  assert.equal(st().past.length, 0, 'nothing landed on the undo stack')
  assert.equal(st().notice, null, 'and no toast was raised')
})

/* ------------------------------------------------------------ the undo stack */

test('commit pushes the document as it was, and undo / redo walk it both ways', () => {
  load({ name: '线路测试', seed: 7, cells: floorRow(0, 1, 0), modules: [], lines: [] })
  const first = st().station
  const version = st().version

  st().commit({ ...first, name: '第二步' })
  assert.equal(st().station.name, '第二步')
  assert.equal(st().past.length, 1, 'the document the edit replaced is the frame')
  assert.equal(st().past[0].name, '线路测试')
  assert.equal(st().past[0], first, 'immutable metadata history retains geometry identity')
  assert.equal(st().version, version + 1, 'a commit is a new document version')
  assert.deepEqual(st().future, [])

  st().undo()
  assert.equal(st().station.name, '线路测试', 'undo restores the frame')
  assert.equal(st().past.length, 0)
  assert.equal(st().future.length, 1, 'and the state it walked out of waits on the redo side')
  assert.equal(st().future[0].name, '第二步')

  st().redo()
  assert.equal(st().station.name, '第二步')
  assert.equal(st().future.length, 0)
  assert.equal(st().past.length, 1)
  assert.equal(st().past[0].name, '线路测试', 'a redo is undoable in turn')
})

test('undo and redo with nothing to walk are not edits, and a new edit drops the redo branch', () => {
  load({ name: '线路测试', seed: 7, cells: floorRow(0, 1, 0), modules: [], lines: [] })
  const before = st().station
  const version = st().version
  st().undo()
  st().redo()
  assert.equal(st().station, before, 'empty stacks leave the document alone')
  assert.equal(st().version, version, 'and do not burn a version')
  assert.equal(st().notice, null, 'nor raise a toast')

  st().commit({ ...before, name: 'A' })
  st().commit({ ...st().station, name: 'B' })
  st().undo()
  assert.equal(st().future.length, 1, 'the redo branch is one deep')
  st().commit({ ...st().station, name: 'C' })
  assert.deepEqual(st().future, [], 'a new edit drops the branch that was ahead')
  assert.equal(st().past.length, 2, 'and the edits behind it still stand')
  assert.equal(st().station.name, 'C')
})

test('a small station keeps all forty undo frames', () => {
  load({ name: '线路测试', seed: 7, cells: [...floorRow(0, 1, 0), ...floorRow(0, 1, 1)], modules: [], lines: [] })
  const cost = st().station.cells.length + st().station.modules.length * 4
  assert.equal(cost, 4, 'the snapshot cost is `cells + 4 x modules`: a 2 x 2 slab and no modules')
  for (let i = 1; i <= 50; i++) st().commit({ ...st().station, name: `step-${i}` })
  assert.equal(st().past.length, 40, 'UNDO_MAX_FRAMES is the binding limit here, not the 120 000 budget')
  assert.equal(st().past[0].name, 'step-10', 'the ten oldest frames were dropped')
  assert.equal(st().past[39].name, 'step-49', 'and the newest frame is kept')
})

test('a large station trades undo depth for the memory budget, and never drops the newest', () => {
  load({ name: '线路测试', seed: 7, cells: [], modules: [], lines: [] })
  st().loadReference()
  const cost = st().station.cells.length + st().station.modules.length * 4
  const frames = Math.min(40, Math.floor(120000 / cost))
  assert.ok(frames > 1 && frames < 11, `the shipped demo costs ${cost} a snapshot, so the memory budget binds before eleven edits`)
  for (let i = 1; i <= 11; i++) st().commit({ ...st().station, name: `step-${i}` })
  assert.equal(st().past.length, frames, 'the budget, not the forty-frame depth, is the binding limit')
  assert.equal(st().past[frames - 1].name, 'step-10', 'the newest frame is the one the cap may never drop')
  assert.equal(st().past[0].name, `step-${11 - frames}`, 'the oldest frames are the ones that go')
  assert.equal(st().past[frames - 1].cells.length, st().station.cells.length, 'and a kept frame is the whole document')
})

/* ------------------------------------------------- 新建 / 打开 / 改名 / 存档 */
test('newStation opens an empty 未命名车站 and keeps the station that was open one Ctrl+Z away', () => {
  load(twoLines(), { activeZ: -8 })
  const before = workerInbox.length
  st().newStation()
  assert.equal(st().station.name, '未命名车站')
  assert.equal(st().station.storeyHeight, 5, 'a new station opens on the five-metre grid')
  assert.equal(st().station.seed, 7654321, 'the fixed new-station seed')
  // A new station is an empty document: the street is an infinite implicit
  // plane (only holes are stored), so there is no seed of blocks to lay.
  assert.equal(st().station.cells.length, 0, 'no cells are laid down: the street is virtual')
  assert.equal(st().station.modules.length, 0)
  assert.deepEqual(st().station.lines, [])
  assert.equal(st().activeZ, 0, 'and the view comes up to grade')
  assert.equal(st().selected, null)
  assert.equal(st().notice, null, '新建 says nothing: the empty canvas is the message')
  assert.equal(st().past.length, 1, 'the station that was open is one Ctrl+Z away')
  assert.deepEqual(st().future, [], 'and there is no redo branch')
  const boot = workerInbox[before]
  assert.equal(boot.type, 'init', 'a station switch re-initialises the worker rather than rebuilding into it')
  assert.deepEqual(boot.data.cells, [])
  assert.equal(boot.seed, 7654321)
  assert.equal(boot.playing, false, 'a new station opens paused')
  st().undo()
  assert.deepEqual(st().station.lines.map((l) => l.id), ['1', '2'], 'Ctrl+Z brings the old document back')
})

test('loadReference opens the shipped 动物园 demo un-repaired, at its own boot time', () => {  load({ name: '线路测试', seed: 7, cells: floorRow(0, 1, 0), modules: [], lines: [] })
  const before = workerInbox.length
  st().loadReference()
  const expected = toStateRepairing(referenceStation())
  assert.equal(expected.droppedCells + expected.droppedModules, 0, 'the demo is baked clean, so nothing has to be repaired')
  assert.equal(st().station.name, '动物园')
  assert.deepEqual(st().station.lines.map((l) => [l.id, l.name]), [['5', '5号线']], 'the demo is 广州地铁 5号线')
  assert.equal(st().station.cells.length, expected.state.cells.length, 'it loads cell for cell')
  assert.equal(st().station.modules.length, expected.state.modules.length)
  assert.equal(st().activeZ, -20, 'it opens on the deepest built level, like a regular station')
  assert.equal(st().selected, null)
  assert.equal(st().notice, null, 'nothing was dropped, so there is no 修复 toast')
  assert.equal(st().past.length, 1, 'the station that was open is one Ctrl+Z away')
  const boot = workerInbox[before]
  assert.equal(boot.type, 'init')
  assert.equal(boot.startSeconds, REFERENCE_BOOT.startSeconds, 'the demo boots at 06:30, the service opening — the same clock a fresh load gets')
  assert.equal(boot.warmup, 0, 'a cold boot: no warmup crowd to walk in with')
  assert.equal(boot.data.lines[0].id, '5')
  // The demo must land on the same storey when the identical document comes in
  // through 打开存档; the example path is not allowed its own opening altitude.
  st().loadFromText(serialize(expected.state))
  assert.equal(st().activeZ, -20, 'the same document opened as a save lands on the same level')
})

test('Tanwei loads both authored lines, resets the view, and preserves undo across demo switches', () => {
  st().loadReference()
  const epoch = st().stationEpoch
  const before = workerInbox.length
  const expected = referenceStation('tanwei')
  st().loadReference('tanwei')
  assert.equal(st().station.name, '坦尾')
  assert.deepEqual(st().station.lines.map((l) => l.id), ['5', '6'])
  assert.equal(st().station.cells.length, expected.cells.length)
  assert.equal(st().station.modules.length, expected.modules.length)
  assert.equal(st().activeZ, -10, 'it opens on its deepest built level, like a regular station')
  assert.equal(st().stationEpoch, epoch + 1)
  assert.equal(st().selected, null)
  assert.equal(st().moveDraft, null)
  assert.equal(workerInbox[before].type, 'init')
  assert.equal(workerInbox[before].warmup, 0)
  assert.equal(workerInbox[before].startSeconds, REFERENCE_BOOT.startSeconds)
  st().undo()
  assert.equal(st().station.name, '动物园')
  st().redo()
  assert.equal(st().station.name, '坦尾')
  expected.cells.length = 0
  assert.ok(referenceStation('tanwei').cells.length > 0, 'edits cannot mutate the shipped document')
})

test('loadReference says so when the demo it opened had to be repaired', () => {
  // The shipped demo is guarded clean (`test/demo.test.mjs`), so `toStateRepairing`
  // only has something to drop when the file itself is damaged: the same repair
  // `打开存档` runs, reported with the same counts and a demo-shaped wording. The
  // harness damages the loaded JSON module for the one call and truncates it back, so
  // every other test still sees the demo as it ships.
  const cells = demoJson.cells.length
  const modules = demoJson.modules.length
  demoJson.cells.push({ x: 1.5, y: 0, z: 0, fill: 'solid' })
  demoJson.modules.push({ id: 'off-grid', type: 'gate', x: 2.5, y: 3, z: 0, cfg: { dir: 'both' } })
  try {
    load({ name: '线路测试', seed: 7, cells: [], modules: [], lines: [] })
    st().loadReference()
    assert.equal(st().notice, '示例车站修复时移除 2 个网格外方块', 'cells and modules are counted together')
    assert.equal(st().station.name, '动物园', 'the demo still opens')
    assert.equal(st().station.cells.some((c) => !Number.isInteger(c.x)), false, 'the off-grid block is not in the document')
    assert.equal(st().station.modules.some((m) => m.id === 'off-grid'), false, 'and neither is the off-grid module')
  } finally {
    demoJson.cells.length = cells
    demoJson.modules.length = modules
  }
  assert.equal(referenceStation().cells.length, cells, 'the demo module is left exactly as it shipped')
})

test('renameStation trims the top-bar draft, ignores a blank name and never commits twice', () => {
  load(twoLines())
  const version = st().version
  st().renameStation('   ')
  assert.equal(st().station.name, '线路测试', 'a blank title is not a name')
  assert.equal(st().past.length, 0, 'so the blur that produced it is not an undo frame')
  st().renameStation('  动物园  ')
  assert.equal(st().station.name, '动物园', 'the draft is trimmed before it lands')
  assert.equal(st().past.length, 1)
  st().renameStation('动物园')
  assert.equal(st().past.length, 1, 'renaming to the name the station already has is not an edit')
  assert.equal(st().version, version + 1, 'and only the one real rename advanced the document')
})

/** `saveToFile` is the one action here that needs a browser: a Blob and a clicked
 *  link. The harness stands a two-line `document` and a recording
 *  `URL.createObjectURL` in for it, collects the Blob the download would carry, and
 *  puts the globals back before the next test. */
async function saveToText() {
  const realDocument = globalThis.document
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  const clicked = []
  let blob = null
  globalThis.document = { createElement: () => ({ href: '', download: '', click() { clicked.push(this.download) } }) }
  URL.createObjectURL = (b) => {
    blob = b
    return 'blob:line-edit-test'
  }
  URL.revokeObjectURL = () => clicked.push('revoked')
  try {
    st().saveToFile()
    return { text: await blob.text(), clicked }
  } finally {
    globalThis.document = realDocument
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  }
}

test('saveToFile writes the live document, and loadFromText opens it back with the 打开 notice', async () => {
  load({ name: '存档测试', seed: 7, cells: floorRow(0, 1, 0), modules: [], lines: [defaultLine('1', 'up', 'third-rail')] })
  const { text, clicked } = await saveToText()
  assert.equal(st().notice, '已保存')
  assert.deepEqual(clicked, ['存档测试.metro.json', 'revoked'], 'the download is named after the station, and the object URL is released')
  const doc = JSON.parse(text)
  assert.equal(doc.format, 'metro-save')
  assert.equal(doc.formatVersion, SAVE_VERSION, 'the store writes the version the loader reads')
  assert.equal(doc.name, '存档测试')
  assert.equal(doc.seed, 7)
  assert.equal(doc.static.cells.length, 2)
  assert.deepEqual(doc.static.lines.map((l) => l.id), ['1'], 'the lines travel with the cells')

  // Open it into a different station: what was open goes onto the undo stack.
  load({ name: '别的车站', seed: 1, cells: [], modules: [], lines: [] })
  st().setNotice('旧的提示')
  st().loadFromText(text)
  assert.equal(st().station.name, '存档测试')
  assert.equal(st().station.cells.length, 2)
  assert.deepEqual(st().station.lines.map((l) => l.id), ['1'])
  assert.equal(st().notice, '已打开（存档 v1）', 'the load replaces an earlier toast, and says which version it read')
  assert.equal(st().selected, null, 'nothing stays selected across a load')
  assert.equal(st().past.length, 1, 'the station that was open is one Ctrl+Z away')
  assert.deepEqual(st().future, [], 'and a load drops the redo branch')

  // `parse` accepts any string as a name, so a save can arrive carrying an empty
  // one: the download falls back to `station.metro.json` rather than `.metro.json`.
  load({ name: '', seed: 7, cells: [], modules: [], lines: [] })
  const unnamed = await saveToText()
  assert.deepEqual(unnamed.clicked, ['station.metro.json', 'revoked'])
  assert.equal(JSON.parse(unnamed.text).name, '', 'and the empty name is what the save carries')
})

test('a save carrying blocks off the 1 m grid is repaired on open, and the notice counts them', async () => {
  load({ name: '存档测试', seed: 7, cells: floorRow(0, 1, 0), modules: [], lines: [] })
  const { text } = await saveToText()
  const doc = JSON.parse(text)
  // Nothing in the game can mint a block off the grid — a save is the only way one
  // arrives — so `toState` drops it rather than refusing the file, and the count
  // travels back out for the 打开 notice.
  doc.static.cells.push({ x: 1.5, y: 0, z: 0, fill: 'solid' })
  doc.static.modules.push({ id: 'off-grid', type: 'gate', x: 2.5, y: 3, z: 0, cfg: { dir: 'both' } })
  load({ name: '别的车站', seed: 1, cells: [], modules: [], lines: [] })
  st().loadFromText(JSON.stringify(doc))
  assert.equal(st().notice, '已打开（存档 v1）：修复时移除 2 个网格外方块', 'cells and modules are counted together')
  assert.equal(st().station.name, '存档测试', 'the rest of the save still opens')
  assert.equal(st().station.cells.length, 2, 'the off-grid cell is gone')
  assert.equal(st().station.modules.length, 0, 'and so is the off-grid module')
  assert.ok(st().station.cells.every((c) => Number.isInteger(c.x) && Number.isInteger(c.y) && Number.isInteger(c.z)), 'every block that did load is on the grid')
})

test('a save that cannot be trusted is refused whole, and the open station is untouched', () => {
  load(twoLines())
  const before = st().station
  const frames = st().past.length
  st().loadFromText('{ not json')
  assert.equal(st().notice, '文件损坏')
  st().loadFromText(JSON.stringify({ format: 'other' }))
  assert.equal(st().notice, '不是车站存档')
  st().loadFromText(JSON.stringify({ format: 'metro-save', formatVersion: SAVE_VERSION + 1, static: { cells: [] } }))
  assert.equal(st().notice, '存档版本过新，请先更新游戏', 'a save from a later game is refused, not half-migrated')
  st().loadFromText(JSON.stringify({ format: 'metro-save', formatVersion: SAVE_VERSION }))
  assert.equal(st().notice, '缺少车站数据')
  assert.equal(st().station, before, 'none of the four attempts moved the document')
  assert.equal(st().past.length, frames, 'nor the undo stack')
  assert.equal(st().station.lines.length, 2, 'and both lines are still there')
})

test('refreshing a selected platform regenerates only that platform’s screen doors', () => {
  const data = twoLines()
  const platform = data.modules.find((m) => m.type === 'track' && m.cfg.line === '1' && !m.cfg.tunnel)
  assert.ok(platform)
  load({ ...data, cells: data.cells.filter((c) => c.y !== 0) }, { selected: { kind: 'module', key: platform.id, label: '站台' } })
  st().regenRail(platform.id)
  assert.equal(edgesOf('1').length, 0, 'the selected platform no longer has floor for doors')
  assert.equal(edgesOf('2').length, 1, 'the other platform’s screen door remains untouched')
})

test('the inspector resolves a selected screen door to its platform, but not to a tunnel', () => {
  const data = twoLines()
  const platform = data.modules.find((m) => m.type === 'track' && m.cfg.line === '1' && !m.cfg.tunnel)
  const screenDoor = data.modules.find((m) => m.type === 'platform-edge' && m.cfg.from === platform.id)
  const tunnel = data.modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  assert.ok(platform && screenDoor && tunnel)
  assert.equal(refreshTrackForSelection(data.modules, platform)?.id, platform.id, 'a selected platform refreshes itself')
  assert.equal(refreshTrackForSelection(data.modules, screenDoor)?.id, platform.id, 'a selected screen door refreshes its owning platform')
  assert.equal(refreshTrackForSelection(data.modules, tunnel), undefined, 'tunnel doors are not a platform refresh target')
})

test('station switches move stationEpoch, edits do not — the viewport homes on the epoch', async () => {
  load(twoLines())
  const epoch = st().stationEpoch
  st().commit({ ...st().station, name: '改名' })
  assert.equal(st().stationEpoch, epoch, 'an edit is not a switch')
  st().undo()
  assert.equal(st().stationEpoch, epoch, 'nor is undo')
  st().redo()
  assert.equal(st().stationEpoch, epoch, 'nor redo')
  st().newStation()
  assert.equal(st().stationEpoch, epoch + 1, '新建 is a switch')
  st().loadReference()
  assert.equal(st().stationEpoch, epoch + 2, '示例车站 is a switch')
  const { text } = await saveToText()
  st().loadFromText(text)
  assert.equal(st().stationEpoch, epoch + 3, '打开存档 is a switch')
  const refused = st().stationEpoch
  st().loadFromText('{ not json')
  assert.equal(st().stationEpoch, refused, 'a refused file moves nothing, not even the epoch')
})

/* ------------------------------------------------------- the rail re-cut trap */

test('a refused consist resize preserves the platform rail and screens beside its own tunnel', () => {
  load(twoLines())
  const platform = tracksOf('1').find((t) => !t.cfg.tunnel)
  assert.equal(edgesOf('1').length, 1, 'the fixture has the rail, its doors and its tunnel run')
  st().updateLine('1', { cars: 4 })
  assert.equal(st().station.modules.some((m) => m.id === platform.id), true, 'the platform rail survives the refused resize')
  assert.equal(edgesOf('1').length, 1, 'its screen doors survive too')
  assert.equal(tracksOf('1').length, 2, 'both the platform and the hand-sized tunnel survive')
  st().undo()
  assert.equal(st().station.modules.some((m) => m.id === platform.id), true, 'undo also preserves the rail')
})

/* --------------------------------------------------------- the route preview */

test('the newest selection survives a stale frame, and clears itself when the passenger is gone', () => {
  // `selectSimAgent` asks the worker for one passenger's remaining walk, and the
  // worker echoes the request's token on every frame. The token is the whole
  // handshake: frames already in flight when the click happened name the passenger
  // selected *before*, or nobody, and acting on one clears the selection the moment
  // it is made (or flashes the last passenger's line).
  load(twoLines())
  const frames = []
  const routes = []
  setFrameHandler((...args) => frames.push(args))
  setRouteHandler((points, id) => routes.push([points, id]))
  // Opening the worker is what wires the message handler: the slice builds it lazily.
  initSim(st().station, 1)
  const worker = workerStub
  assert.ok(worker, 'the store opened its worker')

  selectSimAgent(7)
  const token = workerInbox.filter((m) => m.type === 'selectAgent').pop().token
  st().select({ kind: 'agent', key: '7', label: '行人 #7' })

  /** One frame the worker would post, with only the fields the handler reads. */
  const frame = (routeToken, routeAgent, route = new Float32Array(0)) => ({
    type: 'state',
    count: 0,
    agents: new Float32Array(0),
    density: new Float32Array(0),
    trains: new Float32Array(0),
    lifts: new Float32Array(0),
    intervalMs: 200,
    metrics: { simTime: 0 },
    route,
    routeAgent,
    routeToken,
    // An empty record with no reset: a frame that has no new minute to report.
    history: new Float32Array(0),
    historyFrom: 0,
    historyReset: false,
    historyStart: 0,
    historyStep: 60,
  })

  // A frame built before the click: it answers an older request and names nobody.
  worker.onmessage({ data: frame(token - 1, -1) })
  assert.equal(routes.length, 0, 'a stale frame is not drawn')
  assert.equal(st().selected?.kind, 'agent', 'and does not clear the selection it predates')
  assert.equal(frames.length, 1, 'but the crowd frame itself still lands')

  // The worker's answer, with the passenger in the world.
  const points = new Float32Array([0, 0, 1, 4, 0, 1])
  worker.onmessage({ data: frame(token, 7, points) })
  assert.equal(routes.length, 1, 'the answering frame is drawn')
  assert.equal(routes[0][0], points, 'with the waypoints the worker sent')
  assert.equal(routes[0][1], 7)

  // And the answer that says the passenger has left the station.
  worker.onmessage({ data: frame(token, -1) })
  assert.equal(st().selected, null, 'the selection follows the passenger out of the world')
  assert.equal(routes[1][1], -1, 'and the scene is told to put the line away')
})

/* --------------------------------------------------------- the authored day */

test('a secondary simulation view replays the latest frame, preserves the viewport and unsubscribes', () => {
  initSim(st().station, 1)
  const main = [], secondary = []
  setFrameHandler((...args) => main.push(args))
  const frame = {type:'state',count:0,agents:new Float32Array(0),density:new Float32Array(0),
    trains:new Float32Array(0),lifts:new Float32Array(0),intervalMs:200,metrics:{simTime:100},
    trainServices:[],history:new Float32Array(0),historyFrom:0,historyReset:false,historyStart:0,historyStep:60}
  workerStub.onmessage({data:frame})
  const stop = subscribeFrame((...args) => secondary.push(args))
  assert.equal(main.length,1)
  assert.equal(secondary.length,1,'paused opening immediately receives the latest state')
  assert.equal(secondary[0][1],frame.agents,'subscription shares immutable input buffers')
  workerStub.onmessage({data:frame})
  assert.equal(main.length,2)
  assert.equal(secondary.length,2)
  stop()
  workerStub.onmessage({data:frame})
  assert.equal(main.length,3)
  assert.equal(secondary.length,2,'closing releases the secondary callback')
  initSim(st().station, 2)
  const stopFresh = subscribeFrame(() => assert.fail('a new station must not replay the previous crowd'))
  stopFresh()
  setFrameHandler(null)
})

test('the 时刻 panel writes the day into the document, and a no-op keystroke writes nothing', () => {
  // The three day actions are the only way 营业时间 / 高峰时段 / 客流曲线 reach the
  // document. Each repairs its input through the same normalizer the loader uses, and
  // each has to stay quiet when a keystroke repairs to what is already there — an edit
  // that changed nothing must not push an undo frame or rebuild the worker's graph.
  load(twoLines())
  const frames = st().past.length
  const version = st().version
  const day = st().station.service
  assert.deepEqual(day, { from: 6.5 * 3600, to: 23.5 * 3600 }, 'a station with no authored day runs the shipped window')

  st().setServiceWindow(7 * 3600, 22 * 3600)
  assert.deepEqual(st().station.service, { from: 7 * 3600, to: 22 * 3600 })
  assert.equal(st().version, version + 1, 'a real edit bumps the version')
  assert.equal(st().past.length, frames + 1, 'and is one Ctrl+Z away')
  {
    const build = workerInbox[workerInbox.length - 1]
    assert.equal(build.type, 'population', 'and reaches the worker as a settings patch')
    assert.deepEqual(build.edit.settings.service, { from: 7 * 3600, to: 22 * 3600 })
  }

  const settled = workerInbox.length
  st().setServiceWindow(7 * 3600, 22 * 3600)
  assert.equal(st().version, version + 1, 'the same window again is not an edit')
  assert.equal(workerInbox.length, settled, 'and rebuilds nothing')

  // A peak window is edited by index, and the window beside it comes along untouched.
  const before = st().station.peaks
  st().setPeakWindow(0, 8 * 3600, 10 * 3600)
  assert.deepEqual(st().station.peaks[0], { from: 8 * 3600, to: 10 * 3600 })
  assert.deepEqual(st().station.peaks[1], before[1], 'the 晚高峰 is untouched')
  {
    const build = workerInbox[workerInbox.length - 1]
    assert.equal(build.edit.settings.peaks[0].from, 8 * 3600)
    assert.deepEqual(build.edit.settings.peaks[1], before[1])
  }
  const peakFrames = st().past.length
  st().setPeakWindow(0, 8 * 3600, 10 * 3600)
  assert.equal(st().past.length, peakFrames, 'and the same window again is not an edit')

  // A knob is a patch on one of the two saved curves, clamped to its slider and
  // rounded to the slider's grain.
  const knobs = { ...st().station.demand.workday }
  st().setDemandKnobs('workday', { amPeak: 1.5 })
  assert.equal(st().station.demand.workday.amPeak, 1.5)
  assert.equal(st().station.demand.workday.pmPeak, knobs.pmPeak, 'the other knobs keep their values')
  assert.equal(st().station.demand.workday.sharpness, knobs.sharpness)
  assert.deepEqual(st().station.demand.offday, { amPeak: 0.35, pmPeak: 0.4, sharpness: 1.5 }, 'the offday curve is untouched')
  st().setDemandKnobs('workday', { amPeak: 99 })
  assert.ok(st().station.demand.workday.amPeak <= 2.5, 'a knob past its slider is the slider’s end')
  const knobFrames = st().past.length
  st().setDemandKnobs('workday', { amPeak: st().station.demand.workday.amPeak })
  assert.equal(st().past.length, knobFrames, 'a patch that changes nothing is not an edit')
})

/* --------------------------------------------------------- the calendar pick */

test('seekToDate keeps the time of day: picking a date runs that day, not its midnight', () => {
  // The 时刻 window's calendar pick (§7.9's scrub): the store keeps the time of
  // day and posts a `seek`, the worker moves its clock there. `World.seek`
  // itself is pinned in `demand.test.mjs`; this is the path the click travels.
  load({ name: 'seek测试', seed: 7, cells: [], modules: [], lines: [] })
  initSim(st().station, st().station.seed)
  // Monday 2026-01-05 at 07:30, the morning peak: the clock the crowd is on.
  st().setMetrics({ simTime: 4 * SIM_DAY + 7.5 * 3600 })
  workerInbox.length = 0

  st().seekToDate({ year: 2026, month: 1, day: 10 })
  const msg = workerInbox.pop()
  assert.equal(msg.type, 'seek')
  assert.equal(
    msg.seconds,
    9 * SIM_DAY + 7.5 * 3600,
    'Saturday 2026-01-10 at the same 07:30 — `simTimeAtDate` with the kept time of day',
  )
  assert.equal(
    msg.seconds,
    simTimeAtDate({ year: 2026, month: 1, day: 10 }, DEFAULT_CALENDAR.epoch, 7.5 * 3600),
  )
})

test('a sim that has not reported a frame yet seeks to midnight', () => {
  load({ name: 'seek测试', seed: 7, cells: [], modules: [], lines: [] })
  initSim(st().station, st().station.seed)
  st().setMetrics(null)
  assert.equal(st().metrics, null, 'no frame has landed')
  workerInbox.length = 0

  st().seekToDate({ year: 2026, month: 1, day: 10 })
  const msg = workerInbox.pop()
  assert.equal(msg.type, 'seek')
  assert.equal(msg.seconds, 9 * SIM_DAY, 'day 9 at 00:00: there was no time of day to keep')
})

test('the date is read against the station’s own epoch, not the shipped one', () => {
  load({
    name: 'seek测试',
    seed: 7,
    cells: [],
    modules: [],
    lines: [],
    calendar: { epoch: { year: 2026, month: 3, day: 1 }, holidays: [], workdays: [] },
  })
  assert.deepEqual(st().station.calendar.epoch, { year: 2026, month: 3, day: 1 })
  initSim(st().station, st().station.seed)
  st().setMetrics({ simTime: 3600 })
  workerInbox.length = 0

  st().seekToDate({ year: 2026, month: 3, day: 5 })
  const msg = workerInbox.pop()
  assert.equal(msg.seconds, 4 * SIM_DAY + 3600, 'four days after the station’s own day 0, time kept')
})

test('seeking is not an edit: no undo frame, no document version', () => {
  load({ name: 'seek测试', seed: 7, cells: [], modules: [], lines: [] })
  initSim(st().station, st().station.seed)
  const before = st().station
  const version = st().version
  st().setMetrics({ simTime: 3600 })
  workerInbox.length = 0

  st().seekToDate({ year: 2026, month: 1, day: 10 })
  assert.equal(st().station, before, 'the document is untouched')
  assert.equal(st().version, version, 'so there is nothing to undo')
  assert.equal(st().past.length, 0)
})


test('both station names edit together and survive undo, redo and file reload', async () => {
  load(twoLines())
  st().renameStation('  动物园 ', ' Zoo ')
  assert.equal(st().station.name, '动物园')
  assert.equal(st().station.nameEn, 'Zoo')
  assert.equal(st().past.length, 1)
  st().undo()
  assert.equal(st().station.name, '线路测试')
  assert.equal(st().station.nameEn, '')
  st().redo()
  assert.equal(st().station.nameEn, 'Zoo')
  st().renameStation('动物园', 'Zoo')
  assert.equal(st().past.length, 1)
  st().renameStation('新站')
  assert.equal(st().station.nameEn, 'Zoo', 'Chinese-only rename preserves English')
  const { text } = await saveToText()
  st().renameStation('新站', '')
  assert.equal(st().station.nameEn, '', 'English can be cleared')
  st().loadFromText(text)
  assert.equal(st().station.nameEn, 'Zoo')
})
