import test from 'node:test'
import assert from 'node:assert/strict'
import { populationEdit, applyPopulationEdit } from '../src/sim/populationEdit.ts'
import { defaultLine } from '../src/build/rail.ts'
import { createModule } from '../src/build/model.ts'
import { StationGeometry } from '../src/app/stationGeometry.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { getLanguage } from '../src/sim/i18n.ts'
import * as THREE from 'three'
import { World } from '../src/sim/world.ts'
import { PlateSystem } from '../src/render/scene/systems/PlateSystem.ts'
import { periodOf } from '../src/sim/constants.ts'

const fixture = () => ({ name: 'population', seed: 1, cells: [],
  lines: [defaultLine('1', 'up')],
  modules: [{ id: 'exit', type: 'exit', x: 0, y: 0, z: 0, cfg: { name: 'A', inRate: 100, open: true } }],
})

test('population edits retain geometry and reject unrelated or future inputs', () => {
  const before = fixture()
  const after = applyPopulationEdit(before, { lines: [{ id: '1', alightPerTrain: 321 }], exits: [{ id: 'exit', inRate: 432 }] })
  assert.deepEqual(populationEdit(before, after), { lines: [{ id: '1', alightPerTrain: 321 }], exits: [{ id: 'exit', inRate: 432 }] })
  const geometry = new StationGeometry()
  assert.equal(geometry.resolve(before), geometry.resolve(after), 'no ground, solid, floor or thin-wall preparation')
  assert.equal(before.modules[0].cfg.inRate, 100, 'old document is immutable')
  assert.equal(populationEdit(before, before), null, 'language and other refreshes are not suppressed')
  const reject = next => assert.equal(populationEdit(before, next), null)
  reject({ ...after, cells: [] })
  reject({ ...after, futureField: 1 })
  reject({ ...after, lines: [] })
  reject({ ...after, modules: [] })
  for (const patch of [{ cars: 2 }, { futureField: 1 }]) {
    reject({ ...after, lines: [{ ...after.lines[0], ...patch }] })
  }
  for (const patch of [{ bays: 4 }, { futureField: 1 }]) {
    reject({ ...after, modules: [{ ...after.modules[0], cfg: { ...after.modules[0].cfg, ...patch } }] })
  }
  reject({ ...after, modules: [{ ...after.modules[0], x: 1 }] })
  reject({ ...after, modules: [{ ...after.modules[0], type: 'bench' }] })
})

test('timetable, curve, service, peak and calendar edits share the settings path', () => {
  const before = fixture()
  for (const patch of [
    {service:{from:18000,to:82800}},
    {peaks:[{from:25200,to:32400},{from:61200,to:68400}]},
    {demand:{workday:{amPeak:1.2,pmPeak:1.3,sharpness:1}}},
    {calendar:{epoch:{year:2026,month:1,day:5},holidays:[]}},
    {lines:[{...before.lines[0],headwayProfile:{peak:100,offpeak:200,late:300}}]},
  ]) {
    const after = {...before,...patch}
    const edit = populationEdit(before, after)
    assert.ok(edit)
    assert.deepEqual(applyPopulationEdit(before, edit), after)
    const geometry = new StationGeometry()
    assert.equal(geometry.resolve(before), geometry.resolve(after))
  }
})

test('settings update cached demand and dispatch without resetting live simulation', () => {
  const before = fixture()
  const world = new World(before, 1, 7 * 3600)
  const retained = [world.graph,world.path,world.gateTraffic,world.pool,world.doorLoads,world.nodePop,world.cCounts,world.trains]
  const state = [world.rng.state,world.tick,world.simTime]
  const key = [...world.nextDispatch.keys()][0]
  const activePeriod = periodOf(world.simTime,world.day.service,world.day.peaks,world.dayType()==='workday')
  const headway = world.data.lines[0].headwayProfile[activePeriod]
  world.nextDispatch.set(key, world.simTime + 100)
  const profile = Object.fromEntries(['peak','offpeak','late'].map(p=>[p,world.data.lines[0].headwayProfile[p]+60]))
  world.updatePopulation({lines:[],exits:[],headways:[{id:'1',headwayProfile:profile}]})
  assert.equal(world.lineById.get('1').headwayProfile, profile)
  assert.equal(world.nextDispatch.get(key), world.simTime + 160, 'keep dispatch phase while changing cadence')
  assert.equal(world.data.lines[0].headwayProfile[world.metrics.period], headway+60)
  const settings={service:{from:18000,to:82800},peaks:[{from:21600,to:28800},{from:61200,to:68400}],demand:{workday:{amPeak:1.8,pmPeak:1.1,sharpness:1.2},offday:{amPeak:0.8,pmPeak:0.9,sharpness:1}},calendar:{epoch:{year:2026,month:1,day:5},holidays:[]}}
  world.updatePopulation({lines:[],exits:[],settings})
  assert.deepEqual(world.day.service,settings.service)
  assert.deepEqual(world.day.peaks,settings.peaks)
  assert.deepEqual(world.day.workday,settings.demand.workday)
  assert.equal(world.metrics.period,'peak')
  assert.equal(world.dayType(),'workday')
  assert.deepEqual([world.graph,world.path,world.gateTraffic,world.pool,world.doorLoads,world.nodePop,world.cCounts,world.trains],retained)
  assert.deepEqual([world.rng.state,world.tick,world.simTime],state)
  world.nextDispatch.set(key,world.simTime)
  world.updatePopulation({lines:[],exits:[],headways:[{id:'1',headwayProfile:{peak:600,offpeak:600,late:600}}]})
  assert.equal(world.nextDispatch.get(key),world.simTime,'an already-due first train is not postponed by a settings edit')
  world.nextDispatch.set(key,world.simTime+10)
  world.updatePopulation({lines:[],exits:[],headways:[{id:'1',headwayProfile:{peak:60,offpeak:60,late:60}}]})
  assert.equal(world.nextDispatch.get(key),world.simTime,'shortening cadence cannot schedule a departure in the past')
})

test('population patches preserve all unrelated document records and ignore deleted IDs', () => {
  const data = fixture()
  const changed = applyPopulationEdit(data, { lines: [{ id: 'missing', alightPerTrain: 0 }], exits: [{ id: 'missing', inRate: 0 }] })
  assert.equal(changed.cells, data.cells)
  assert.equal(changed.lines[0], data.lines[0])
  assert.equal(changed.modules[0], data.modules[0])
  assert.deepEqual(changed, data)
})

test('paused screen refresh retains the latest acknowledged time and services', () => {
  const plates = new PlateSystem({stationData:fixture()})
  plates.refreshSettings()
  const services=[]
  plates.setSimClock(25200,services)
  let refreshed
  plates.setSimClock=(time,latest)=>{refreshed=[time,latest]}
  plates.refreshSettings()
  assert.equal(refreshed[0],25200)
  assert.equal(refreshed[1],services)
})

test('population metadata keeps the next equipment edit local without touching models or batches', () => {
  const before = fixture()
  const after = applyPopulationEdit(before, {lines:[{id:'1',alightPerTrain:321}],exits:[{id:'exit',inRate:432}]})
  const modules = new ModuleSystem({scene:new THREE.Scene()})
  assert.equal(modules.updatePopulationData(after), false, 'unbuilt scene cannot accept a cache shortcut')
  modules.builtData = before
  modules.builtLanguage = getLanguage()
  const roots = modules.moduleMeshes, batches = modules.batches
  assert.equal(modules.updatePopulationData(after), true)
  assert.equal(modules.moduleMeshes, roots)
  assert.equal(modules.batches, batches)
  assert.equal(modules.hasSameMetadata(after), true)
  const equipment = {...after,modules:[...after.modules,createModule('bench',0,0,0,'bench')]}
  assert.equal(modules.equipmentOnlyChanged(equipment), true, 'population edit does not poison the subsequent placement cache')
  assert.equal(modules.updatePopulationData(equipment), false, 'geometry still takes the ordinary build path')
  const geometry = new StationGeometry()
  const original = geometry.resolve(before)
  assert.equal(geometry.resolve(after), original)
  assert.equal(geometry.resolve(equipment), original)
  modules.builtLanguage = getLanguage() === 'en' ? 'zh' : 'en'
  assert.equal(modules.updatePopulationData(before), false, 'translation still rebuilds')
})

test('secondary terminus edits retain geometry and travel in presentation patches', () => {
  const before = fixture()
  const labels = [{ id: '1', upTerminusEn: 'Wenchong', downTerminusEn: 'Jiaokou' }]
  const after = applyPopulationEdit(before, { lines: [], exits: [], labels })
  assert.deepEqual(populationEdit(before, after), { lines: [], exits: [], labels })
  assert.equal(after.cells, before.cells)
  assert.equal(after.modules[0], before.modules[0])
  assert.equal(JSON.parse(JSON.stringify(after)).lines[0].upTerminusEn, 'Wenchong')
  const cleared = applyPopulationEdit(after, { lines: [], exits: [], labels: [{ id: '1', upTerminusEn: '' }] })
  assert.equal(cleared.lines[0].upTerminusEn, '')
})
