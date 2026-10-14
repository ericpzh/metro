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
  assert.deepEqual(escalator.map(({ kind }) => kind), ['rotation', 'width', 'length', 'direction'])
  assert.deepEqual(escalator.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab', undefined])

  const curtain = moduleBuilderAttributes('curtain-wall', state)
  assert.deepEqual(curtain.map(({ kind }) => kind), ['rotation', 'width', 'height'])
  assert.deepEqual(curtain.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab'])
})

test('a 单跑楼梯 carries the same four run lengths a 扶梯 does, and only that shape does', () => {
  const state = stateWith()
  // 单跑楼梯 — 直跑楼梯 tile and the bare `stair` the room builder places — is the one
  // stair whose length the player chooses, with the escalator's own sizes: 超短 / 短 /
  // 中 / 长 as the width tile's neighbour (Tab = width, Shift+Tab = length).
  for (const type of ['stair-straight', 'stair']) {
    const stair = moduleBuilderAttributes(type, state)
    assert.deepEqual(stair.map(({ kind }) => kind), ['rotation', 'width', 'length'], type)
    assert.deepEqual(stair.map(({ shortcut }) => shortcut), ['R', 'Tab', 'Shift+Tab'], type)
    assert.equal(stair.at(-1).label, '中', 'the run length tile is named 中 at the catalogue default')
  }
  // A 双跑 / 转角楼梯 is the fixed footprint its turn is drawn at, and a 楼梯块 is a
  // half-height block with no run at all: neither grows a length tile.
  for (const type of ['stair-right180', 'stair-left90', 'stair-centerForward']) {
    assert.deepEqual(moduleBuilderAttributes(type, state).map(({ kind }) => kind), ['rotation', 'width'], type)
  }
  assert.deepEqual(moduleBuilderAttributes('stair-block', state).map(({ kind }) => kind), ['rotation', 'height'])
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

test('the length tile names the four sizes and cycles through them', () => {
  const state = stateWith()
  const tile = (rampLength) => moduleBuilderAttributes('stair-straight', stateWith({ rampLength })).at(-1)
  assert.deepEqual(['ultra-short', 'short', 'medium', 'long'].map((id) => tile(id).label), ['超短', '短', '中', '长'])
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
})

test('all width action tiles use the shared width glyph and the shell delegates module keys', () => {
  const actions = fs.readFileSync(new URL('../src/app/rail/actions/ActionRow.tsx', import.meta.url), 'utf8')
  const shell = fs.readFileSync(new URL('../src/app/windows/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(actions, /attribute\.kind === 'width' \? <RiExpandWidthFill \/>/)
  assert.match(shell, /activateModuleBuilderShortcut\(st\.moduleType, st, 'R'\)/)
  assert.match(shell, /activateModuleBuilderShortcut\(st\.moduleType, st, e\.shiftKey \? 'Shift\+Tab' : 'Tab'\)/)
})
