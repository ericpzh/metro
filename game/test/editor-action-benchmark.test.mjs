import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_OPTIONS, isStairType } from '../src/app/store/catalog.ts'
import { editorActionCases, caseModules, caseSupports } from '../src/app/benchmark/editorActionCases.ts'
import { emptyStation, EXAMPLE_STATION_IDS, referenceStation } from '../src/data/reference-station.ts'
import { moduleEnvelope } from '../src/sim/placement.ts'
import { ROOF_WIDTHS, PILLAR_LENGTHS } from '../src/sim/structures.ts'
import { STAIR_WIDTHS } from '../src/sim/stairs.ts'
import { rampLengthsFor } from '../src/sim/rampLengths.ts'
import { TRACK_RUN_LENGTHS } from '../src/sim/track.ts'
import { LIFT_SIZES } from '../src/sim/lifts.ts'
import { isPsdEndCoverSupport } from '../src/sim/psdEnds.ts'
import { ESCALATOR_WIDTHS } from '../src/sim/escalators.ts'

const cases=editorActionCases(),station=emptyStation()
test('editor action audit covers every palette subtype and every declared demo without duplicate case IDs',()=>{
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length)
  for(const option of MODULE_OPTIONS)assert.ok(cases.some(c=>c.paletteId===option.id),option.id)
  assert.deepEqual(new Set(cases.map(c=>c.category)),new Set(['structural','equipment','decor']))
  for(const demo of EXAMPLE_STATION_IDS){
    const data=referenceStation(demo);assert.ok(data.cells.length&&data.modules.length,demo)
    assert.deepEqual(editorActionCases(data).filter(c=>c.lineId).map(c=>c.lineId),data.lines.map(l=>l.id),demo+' covers every available platform line')
  }
})

test('every module case reaches a real production factory, including compound TVs and settings variants',()=>{
  for(const spec of cases.filter(c=>c.kind==='module')){
    const pieces=caseModules(spec,1000,0,0,'benchmark',station)
    assert.equal(pieces.length,spec.paletteId==='tv-double'?2:1,spec.id)
    assert.equal(new Set(pieces.map(m=>m.id)).size,pieces.length,spec.id)
    for(const mod of pieces){
      const box=moduleEnvelope(mod)
      assert.ok(box,spec.id)
      assert.ok(Object.values(box).every(Number.isFinite),spec.id+' has finite bounds')
    }
  }
  const tvs=caseModules(cases.find(c=>c.id==='tv-double'),0,0,0,'tv',station)
  assert.equal(tvs[1].rot,(tvs[0].rot+2)%4)
  const coverCase=cases.find(c=>c.id==='psd-end-cover')
  const cover=caseModules(coverCase,0,0,0,'cover',station)[0],support=caseSupports(coverCase,0,0,station)[0]
  assert.ok(isPsdEndCoverSupport(cover,support),'cover previews and commits have an actual supporting PSD')
  for(const spec of cases.filter(c=>c.paletteId==='road')){
    const road=caseModules(spec,0,0,0,'road',station)[0]
    assert.equal(road.w,spec.width??6,spec.id+' applies its actual width')
    assert.ok(road.cfg.from&&road.cfg.to,'road cases use the production centreline factory')
  }
})

test('action-row size families and all cut orientations remain in the manifest',()=>{
  for(const id of ['roof-shell','roof-truss','roof-tapered','roof-canopy'])
    assert.deepEqual(cases.filter(c=>c.paletteId===id&&c.width!==undefined).map(c=>c.width),[...ROOF_WIDTHS])
  for(const id of ['pillar-slim','pillar-thick'])
    assert.deepEqual(cases.filter(c=>c.paletteId===id&&c.cfg?.height).map(c=>c.cfg.height),[...PILLAR_LENGTHS])
  for(const {id}of MODULE_OPTIONS.filter(c=>isStairType(c.id)&&c.id!=='stair-block')){
    assert.deepEqual(cases.filter(c=>c.paletteId===id&&c.width!==undefined).map(c=>c.width),[...STAIR_WIDTHS])
    for(const span of ['single','double','triple'])assert.deepEqual(
      cases.filter(c=>c.paletteId===id&&c.settings?.escalatorSpan===span).map(c=>c.settings.rampLength),rampLengthsFor(span,'stair').map(s=>s.id))
  }
  assert.deepEqual(cases.filter(c=>c.paletteId==='bridge'&&c.run).map(c=>c.run),[...TRACK_RUN_LENGTHS])
  assert.deepEqual(cases.filter(c=>c.paletteId==='lift'&&c.settings?.liftSize!==undefined).map(c=>c.settings.liftSize),[...LIFT_SIZES])
  assert.deepEqual(cases.filter(c=>c.rail==='tunnel'&&c.run).map(c=>c.run),[...TRACK_RUN_LENGTHS])
  assert.ok(cases.some(c=>c.rail==='platform'))
  assert.ok(cases.some(c=>c.autoWalls),'auto-wall generation is a structural setting outside MODULE_OPTIONS')
  for(const id of ['escalator','walkway']){
    const widths=cases.filter(c=>c.paletteId===id&&c.width!==undefined)
    assert.deepEqual(widths.map(c=>c.width),ESCALATOR_WIDTHS.filter(w=>w>1))
    for(const spec of widths)assert.equal(caseModules(spec,0,0,0,'width',station)[0].cfg.width,spec.width,spec.id+' reaches the production factory')
  }
  for(const family of ['half-wall','tri-upper','tri-lower'])assert.deepEqual(cases.filter(c=>c.paletteId===family).map(c=>c.shape.side),['n','e','s','w'])
  assert.ok(cases.some(c=>c.ceiling),'suspended ceiling uses the block path too')
})
