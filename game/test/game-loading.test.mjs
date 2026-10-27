import test from 'node:test'
import assert from 'node:assert/strict'
import { showGameLoading, failGameLoading } from '../src/app/gameLoading.ts'

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
