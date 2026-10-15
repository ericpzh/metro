import test from 'node:test'
import assert from 'node:assert/strict'
import { readTutorialPreference, writeTutorialPreference, TUTORIAL_STORAGE_KEY, TUTORIAL_STEPS } from '../src/app/windows/tutorial/steps.ts'
import { messages } from '../src/sim/i18n/messages.ts'
import { useStore } from '../src/app/store.ts'
import { createStationSlice } from '../src/app/store/slices/StationSlice.ts'
import { createViewSlice } from '../src/app/store/slices/ViewSlice.ts'
import { createSimSlice } from '../src/app/store/slices/SimSlice.ts'

test('startup is an empty station at ground level, ready to build', () => {
  // Own the initial slice state: the one-process runner shares the live store
  // with suites that have already loaded and edited their own stations.
  const args = [() => {}, () => ({}), {}]
  const { station, past } = createStationSlice(...args)
  const { activeZ } = createViewSlice(...args)
  const { playing } = createSimSlice(...args)
  assert.deepEqual(station.cells, [])
  assert.deepEqual(station.modules, [])
  assert.deepEqual(station.lines, [])
  assert.equal(activeZ, station.levelBase)
  assert.equal(playing, false)
  assert.equal(past.length, 0)
})

test('tutorial progress and opt-out survive storage without touching the station', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const document = useStore.getState().station
  assert.deepEqual(readTutorialPreference(storage), { step: 0, hidden: false })
  writeTutorialPreference(storage, { step: 8, hidden: true })
  assert.deepEqual(readTutorialPreference(storage), { step: 8, hidden: true })
  writeTutorialPreference(storage, { step: 16, hidden: false })
  assert.deepEqual(readTutorialPreference(storage), { step: 16, hidden: false })
  assert.equal(useStore.getState().station, document)
})

test('corrupt, stale or blocked storage does not prevent onboarding', () => {
  for (const value of ['bad JSON', 'null', '{}', '{"step":-1}', '{"step":999}', '{"step":2.5}', '{"step":"3","hidden":"true"}']) {
    assert.deepEqual(readTutorialPreference({ getItem: () => value }), { step: 0, hidden: false }, value)
  }
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') } }
  assert.deepEqual(readTutorialPreference(blocked), { step: 0, hidden: false })
  assert.doesNotThrow(() => writeTutorialPreference(blocked, { step: 3, hidden: true }))
  assert.equal(TUTORIAL_STORAGE_KEY, 'metro-game.tutorial.v1')
})

test('every tutorial step has both languages and a spotlight target', () => {
  for (const step of TUTORIAL_STEPS) {
    assert.ok(step.targets.length)
    for (const key of [step.title, step.body]) {
      assert.ok(messages[key].zh.trim(), `${key}: Chinese`)
      assert.ok(messages[key].en.trim(), `${key}: English`)
    }
  }
})
