import test from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from 'zustand/vanilla'
import '../src/app/store.ts'
import { createStationSlice } from '../src/app/store/slices/StationSlice.ts'
import { AUTOSAVE_KEY, AUTOSAVE_INTERVAL_MS, readAutosave, watchAutosave } from '../src/app/autosave.ts'

const originalWorker = globalThis.Worker
test.before(() => { globalThis.Worker = class { postMessage() {} } })
test.after(() => { globalThis.Worker = originalWorker })

function fixture() {
  const values = new Map()
  let writes = 0
  let full = false
  const storage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      if (full) throw Error('quota')
      writes++
      values.set(key, value)
    },
  }
  const store = createStore(createStationSlice)
  const autosave = watchAutosave(store, storage)
  return { store, storage, autosave, values, writes: () => writes, setFull: value => { full = value } }
}

test('autosave flushes committed edits once, including undo/redo, and ignores transient state', () => {
  const f = fixture()
  assert.equal(AUTOSAVE_INTERVAL_MS, 10_000)
  f.autosave.flush()
  f.store.getState().setNotice('notice')
  f.autosave.flush()
  assert.equal(f.writes(), 0)
  f.store.getState().renameStation('First')
  f.store.getState().renameStation('Latest')
  assert.equal(f.writes(), 0, 'edits wait for the interval')
  f.autosave.flush()
  assert.equal(readAutosave(f.storage).name, 'Latest')
  f.autosave.flush()
  assert.equal(f.writes(), 1, 'unchanged document is not serialized again')
  f.store.getState().undo()
  f.autosave.flush()
  assert.equal(readAutosave(f.storage).name, 'First')
  f.store.getState().redo()
  f.autosave.flush()
  assert.equal(readAutosave(f.storage).name, 'Latest')
  f.autosave.unsubscribe()
})

test('new, imported and demo stations immediately replace a pending autosave', () => {
  const f = fixture()
  f.store.getState().renameStation('Old')
  f.autosave.flush()
  const imported = f.values.get(AUTOSAVE_KEY)
  f.store.getState().renameStation('Pending')
  f.store.getState().newStation()
  assert.equal(readAutosave(f.storage).name, f.store.getState().station.name)
  f.store.getState().loadFromText(imported)
  assert.equal(readAutosave(f.storage).name, 'Old')
  f.store.getState().loadReference()
  assert.equal(readAutosave(f.storage).name, f.store.getState().station.name)
  const before = f.values.get(AUTOSAVE_KEY)
  f.store.getState().loadFromText('bad')
  assert.equal(f.values.get(AUTOSAVE_KEY), before, 'failed imports preserve the current save')
  f.autosave.flush()
  assert.equal(f.values.get(AUTOSAVE_KEY), before, 'no stale pending station survives the switch')
  f.autosave.unsubscribe()
})

test('quota failures retry; failed station replacement invalidates the old save', () => {
  const f = fixture()
  f.store.getState().renameStation('Old')
  f.autosave.flush()
  f.setFull(true)
  f.store.getState().newStation()
  assert.equal(readAutosave(f.storage), null)
  assert.doesNotThrow(f.autosave.flush)
  f.setFull(false)
  f.autosave.flush()
  assert.equal(readAutosave(f.storage).name, f.store.getState().station.name)
  for (const text of ['bad', 'null', '{}']) {
    f.values.set(AUTOSAVE_KEY, text)
    assert.equal(readAutosave(f.storage), null)
  }
  assert.equal(readAutosave({ getItem() { throw Error('blocked') } }), null)
  f.autosave.unsubscribe()
})
