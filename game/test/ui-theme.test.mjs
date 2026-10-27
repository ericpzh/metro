import test from 'node:test'
import assert from 'node:assert/strict'
import { readUiTheme, initUiTheme, getUiTheme, setUiTheme, subscribeUiTheme, themeVoidColor } from '../src/app/uiTheme.ts'

test('theme defaults safely, applies immediately, and survives a reload', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  globalThis.localStorage = storage
  globalThis.document = { documentElement: { dataset: {} } }
  assert.equal(readUiTheme(storage), 'blueprint')
  assert.equal(readUiTheme({ getItem() { throw Error('unavailable') } }), 'blueprint')
  initUiTheme()
  let updates = 0
  const unsubscribe = subscribeUiTheme(() => updates++)
  setUiTheme('studio')
  assert.equal(document.documentElement.dataset.uiTheme, 'studio')
  assert.equal(readUiTheme(storage), 'studio')
  initUiTheme()
  assert.equal(getUiTheme(), 'studio')
  assert.equal(updates, 2)
  unsubscribe()
  values.set('metro-game.ui-theme', 'invalid')
  initUiTheme()
  assert.equal(getUiTheme(), 'blueprint')
  assert.equal(themeVoidColor('studio'), 0xf4f3ed)
  assert.equal(themeVoidColor('blueprint'), themeVoidColor('site'))
  delete globalThis.document
  delete globalThis.localStorage
})
