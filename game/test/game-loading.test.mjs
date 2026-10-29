import test from 'node:test'
import assert from 'node:assert/strict'
import { showGameLoading, failGameLoading, openSaveWithLoading } from '../src/app/gameLoading.ts'

test('loading shell can be shown, dismissed and report a load failure in the active language', () => {
  const screen = { hidden: true }
  const detail = { textContent: '' }
  globalThis.document = {
    documentElement: { lang: 'en' },
    getElementById: id => id === 'game-loading' ? screen : id === 'loading-detail' ? detail : null,
  }
  showGameLoading(true)
  assert.equal(screen.hidden, false)
  failGameLoading()
  assert.match(detail.textContent, /could not load/)
  document.documentElement.lang = 'zh-CN'
  failGameLoading()
  assert.match(detail.textContent, /刷新/)
  showGameLoading(false)
  assert.equal(screen.hidden, true)
  delete globalThis.document
})

test('opening a save paints the shell before reading, and keeps it until the new frame', async () => {
  const screen = { hidden: true }, title = {}, detail = {}
  const frames = []
  globalThis.document = { documentElement: { lang: 'en' }, getElementById: id => ({ 'game-loading': screen, 'loading-title': title, 'loading-detail': detail })[id] }
  globalThis.requestAnimationFrame = cb => frames.push(cb)
  let opened = false
  const pending = openSaveWithLoading({ text: async () => { assert.equal(screen.hidden, false); return 'save' } }, text => { opened = text === 'save'; return true }, () => assert.fail('read failed'))
  assert.equal(screen.hidden, false)
  assert.match(title.textContent, /Loading saved station/)
  assert.equal(opened, false)
  frames.shift()()
  assert.equal(opened, false)
  frames.shift()()
  await pending
  assert.equal(opened, true)
  assert.equal(screen.hidden, false)
  showGameLoading(false) // viewport's first rendered frame
  assert.equal(screen.hidden, true)
  delete globalThis.document
  delete globalThis.requestAnimationFrame
})

test('invalid or unreadable saves dismiss the loading shell', async () => {
  const screen = { hidden: true }
  globalThis.document = { documentElement: { lang: 'zh-CN' }, getElementById: id => id === 'game-loading' ? screen : null }
  globalThis.requestAnimationFrame = cb => queueMicrotask(cb)
  await openSaveWithLoading({ text: async () => 'invalid' }, () => false, () => assert.fail('read failed'))
  assert.equal(screen.hidden, true)
  let failed = false
  await openSaveWithLoading({ text: async () => { throw new Error('read error') } }, () => assert.fail('opened'), () => { failed = true })
  assert.equal(failed, true)
  assert.equal(screen.hidden, true)
  delete globalThis.document
  delete globalThis.requestAnimationFrame
})
