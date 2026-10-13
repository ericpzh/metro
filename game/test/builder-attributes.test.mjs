import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { activateModuleBuilderShortcut, moduleBuilderAttributes, useStore } from '../src/app/store.ts'

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

test('Tab, Shift+Tab and R dispatch through the module capability list', () => {
  const calls = []
  const state = stateWith({
    toggleEscalatorWidth: () => calls.push('width'),
    toggleEscalatorLength: () => calls.push('length'),
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
