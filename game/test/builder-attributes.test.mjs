import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { activateModuleBuilderShortcut, isStraightStairType, moduleBuilderAttributes, useStore } from '../src/app/store.ts'

function stateWith(actions = {}) {
  return { ...useStore.getState(), ...actions }
}

test('module attributes use the shared priority and first two variant shortcuts', () => {
  const state = stateWith()
  const escalator = moduleBuilderAttributes('escalator', state)
  assert.deepEqual(escalator.map(({ kind }) => kind), ['rotation', 'width', 'length', 'span', 'direction'])
  assert.deepEqual(escalator.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab', undefined, undefined])

  const curtain = moduleBuilderAttributes('curtain-wall', state)
  assert.deepEqual(curtain.map(({ kind }) => kind), ['rotation', 'width', 'height'])
  assert.deepEqual(curtain.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab'])
})

test('the 自动步道 carries the escalator’s two shared tabs and its own level lengths', () => {
  const state = stateWith()
  const walkway = moduleBuilderAttributes('walkway', state)
  assert.deepEqual(walkway.map(({ kind }) => kind), ['rotation', 'width', 'length', 'direction'])
  assert.deepEqual(walkway.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab', undefined])
  // 短 at the catalogue default (30 m) and only three sizes, not the escalator's four.
  assert.equal(walkway.at(-2).label, '短')
  const labels = ['short', 'medium', 'long'].map((walkwayLength) => moduleBuilderAttributes('walkway', stateWith({ walkwayLength })).at(-2).label)
  assert.deepEqual(labels, ['短', '中', '长'])

  const calls = []
  const cycles = stateWith({
    toggleEscalatorWidth: () => calls.push('width'),
    cycleWalkwayLength: () => calls.push('length'),
    cycleEscalatorDir: () => calls.push('direction'),
    rotateModule: () => calls.push('rotation'),
  })
  for (const key of ['Tab', 'Shift+Tab']) assert.equal(activateModuleBuilderShortcut('walkway', cycles, key), true)
  assert.equal(activateModuleBuilderShortcut('walkway', cycles, 'R'), true)
  assert.deepEqual(calls, ['width', 'length', 'rotation'], 'Tab takes the width, Shift+Tab the level length')
})

test('every staircase but the 楼梯块 carries the run length tile, and so does the 扶梯', () => {
  const state = stateWith()
  // A straight stair climbs its chosen rise in one flight; a turning stair
  // splits it into two flights with the platform at half the rise. Both read the
  // one armed length, so a bank of 扶梯 and 楼梯 is built to one size.
  for (const type of ['stair-straight', 'stair', 'stair-right180', 'stair-left90', 'stair-centerForward']) {
    const stair = moduleBuilderAttributes(type, state)
    assert.deepEqual(stair.map(({ kind }) => kind), ['rotation', 'width', 'length'], type)
    assert.deepEqual(stair.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab'], type)
    assert.equal(stair.at(-1).label, '长', 'the run length tile is named 长 at the catalogue default')
  }
  // A 楼梯块 is a half-height block with no run at all: it keeps its own height tile.
  assert.deepEqual(moduleBuilderAttributes('stair-block', state).map(({ kind }) => kind), ['rotation', 'height'])

  // A 扶梯 has a second family beside the length: 单层 / 双层.
  const spanTile = moduleBuilderAttributes('escalator', state).find((a) => a.kind === 'span')
  assert.equal(spanTile.label, '单层', 'a fresh escalator is single-storey')
  const double = moduleBuilderAttributes('escalator', stateWith({ escalatorSpan: 'double' }))
  assert.equal(double.find((a) => a.kind === 'span').label, '双层')
  assert.equal(double.find((a) => a.kind === 'length').label, '超长', 'the double family defaults to 超长 10 m')

  // 电梯's floor interval is its first tile (Tab), the housing its second.
  const lift = moduleBuilderAttributes('lift', state)
  assert.deepEqual(lift.map(({ kind }) => kind), ['rotation', 'length', 'style'])
  assert.deepEqual(lift.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab'])
  // The tile names the rung, never the metres: the mark carries the size.
  assert.equal(lift[1].label, '中')
  assert.equal(moduleBuilderAttributes('lift', stateWith({ liftInterval: 7 }))[1].label, '超长')
})

test('the straight-stair predicate answers for the palette ids the rail arms', () => {
  // The rail folds a folder open and the tool guards the length by the **id** it is
  // armed with, before any module exists, so the predicate has to answer for a
  // palette id exactly as for the module type that id builds (`stair-*` ids are
  // matched as text, bare `stair` is what the room builder places).
  for (const id of ['stair', 'stair-straight']) assert.equal(isStraightStairType(id), true, id)
  for (const id of ['stair-block', 'stair-left90', 'stair-right180', 'stair-centerForward', 'escalator', 'lift']) {
    assert.equal(isStraightStairType(id), false, id)
  }
})

test('the stair length tile names the five sizes and cycles through them', () => {
  const state = stateWith()
  const tile = (rampLength) => moduleBuilderAttributes('stair-straight', stateWith({ rampLength })).at(-1)
  assert.deepEqual(['ultra-short', 'short', 'medium', 'long', 'ultra-long'].map((id) => tile(id).label), ['超短', '短', '中', '长', '超长'])
  // Tab walks 超短 → 短 → 中 → 长 → 超长 and wraps; the escalator beside it stays
  // on its own four-rung family, so a stair's 超长 arms 长 on the 扶梯.
  useStore.setState({ moduleType: 'stair-straight', rampLength: 'ultra-short' })
  for (const next of ['short', 'medium', 'long', 'ultra-long', 'ultra-short']) {
    useStore.getState().cycleRampLength()
    assert.equal(useStore.getState().rampLength, next)
  }
  useStore.setState({ rampLength: 'ultra-long', moduleType: 'escalator', escalatorSpan: 'single' })
  assert.equal(moduleBuilderAttributes('escalator', useStore.getState()).find((a) => a.kind === 'length').label, '长')
  useStore.getState().cycleRampLength()
  assert.equal(useStore.getState().rampLength, 'ultra-short', 'the escalator cycle starts again at its own 超短')
  useStore.setState(state)
  const calls = []
  const cycles = stateWith({
    cycleStairWidth: () => calls.push('width'),
    cycleRampLength: () => calls.push('length'),
  })
  for (const key of ['Tab', 'Shift+Tab']) assert.equal(activateModuleBuilderShortcut('stair-straight', cycles, key), true)
  assert.deepEqual(calls, ['width', 'length'], 'Tab takes the width, Shift+Tab the run length, through the one list')
})

test('Tab, Shift+Tab and R dispatch through the module capability list', () => {
  const calls = []
  const state = stateWith({
    toggleEscalatorWidth: () => calls.push('width'),
    cycleRampLength: () => calls.push('length'),
    rotateModule: () => calls.push('rotation'),
  })
  assert.equal(activateModuleBuilderShortcut('escalator', state, 'Tab'), true)
  assert.equal(activateModuleBuilderShortcut('escalator', state, 'Shift+Tab'), true)
  assert.equal(activateModuleBuilderShortcut('escalator', state, 'R'), true)
  assert.deepEqual(calls, ['width', 'length', 'rotation'])

  const slimPillar = moduleBuilderAttributes('pillar-slim', state)
  assert.equal(slimPillar[0].kind, 'position')
  assert.equal(slimPillar[0].shortcut, 'R', 'R moves the slim pillar across its in-cell positions')

  // 电梯: Tab is the floor interval, Shift+Tab the housing.
  const liftCalls = []
  const liftState = stateWith({
    cycleLiftInterval: () => liftCalls.push('interval'),
    cycleLiftStyle: () => liftCalls.push('style'),
    rotateModule: () => liftCalls.push('rotation'),
  })
  assert.equal(activateModuleBuilderShortcut('lift', liftState, 'Tab'), true)
  assert.equal(activateModuleBuilderShortcut('lift', liftState, 'Shift+Tab'), true)
  assert.deepEqual(liftCalls, ['interval', 'style'])
})

test('all width action tiles use the shared width glyph and the shell delegates module keys', () => {
  const actions = fs.readFileSync(new URL('../src/app/rail/actions/ActionRow.tsx', import.meta.url), 'utf8')
  const shell = fs.readFileSync(new URL('../src/app/windows/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(actions, /<DimensionArt vertical=/)
  assert.match(actions, /<StoreyArt double=\{state\.escalatorSpan === 'double'\}/)
  const structure = fs.readFileSync(new URL('../src/app/rail/menus/StructurePanel.tsx', import.meta.url), 'utf8')
  assert.match(structure, /DimensionArt selected=\{TRACK_RUN_LENGTHS\.indexOf\(bridgeLength/)
  const rail = fs.readFileSync(new URL('../src/app/rail/folders/RailFolder.tsx', import.meta.url), 'utf8')
  assert.match(rail, /DimensionArt selected=\{TRACK_RUN_LENGTHS\.indexOf\(tunnelLength/)
  assert.match(shell, /activateModuleBuilderShortcut\(st\.moduleType, st, 'R'\)/)
  assert.match(shell, /activateModuleBuilderShortcut\(st\.moduleType, st, e\.shiftKey \? 'Shift\+Tab' : 'Tab'\)/)
})

 test('dimension marks track every size as its builder action cycles', async () => {
  const { dimensionSelection } = await import('../src/app/rail/shared/dimensionSelection.ts')
  for (const [type, kind, key, values] of [
    ['road', 'width', 'roadWidth', [6,12,18,24]],
    ['curtain-wall', 'height', 'curtainHeight', [2,3,4]],
    ['pillar', 'length', 'pillarLength', [2,3,4,5,6]],
    ['walkway', 'length', 'walkwayLength', ['short','medium','long']],
    ['lift', 'length', 'liftInterval', [3,4,5,6,7]],
    ['bridge', 'length', 'bridgeLength', [4,16,32,64,128]],
    ['psd-end', 'height', 'psdEndHeight', ['half','full']],
  ]) values.forEach((value, selected) => assert.deepEqual(dimensionSelection(kind, type, stateWith({ [key]: value })), { selected, count: values.length }))
  // A 楼梯 has five rungs; a 扶梯 marks the 长 it will build when the shared
  // setting is the stair-only 超长.
  assert.deepEqual(dimensionSelection('length', 'stair-straight', stateWith({ rampLength: 'ultra-long' })), { selected: 4, count: 5 })
  assert.deepEqual(dimensionSelection('length', 'escalator', stateWith({ escalatorSpan: 'single', rampLength: 'ultra-long' })), { selected: 3, count: 4 })
  assert.equal(dimensionSelection('direction', 'road', stateWith()), undefined)
 })
