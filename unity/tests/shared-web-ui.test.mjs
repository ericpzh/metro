import test from 'node:test'
import assert from 'node:assert/strict'
import { zooBridge } from '../../game/src/unity-web/bridge.ts'
import { attachUnityUI } from '../../tools/unity-web/unity-ui-pack.mjs'

test('bridge forwards named commands and clears state when the player is removed', () => {
  const calls = [], updates = []
  const unsubscribe = zooBridge.subscribe(() => updates.push(zooBridge.getSnapshot()))
  zooBridge.register({ SendMessage: (...args) => calls.push(args) })
  zooBridge.receive({ tool: 'Floor', level: -15, running: false, queued: 0, boarded: 0, message: 'ready' })
  zooBridge.send({ type: 'level', value: -15 })
  zooBridge.send({ type: 'open', value: '{"save":true}' })
  zooBridge.unregister()
  zooBridge.send({ type: 'run' })
  unsubscribe()
  assert.deepEqual(calls, [
    ['ZooPlayable', 'BrowserCommand', '{"type":"level","value":"-15"}'],
    ['ZooPlayable', 'BrowserCommand', '{"type":"open","value":"{\\"save\\":true}"}'],
  ])
  assert.equal(updates.length, 3)
  assert.deepEqual(zooBridge.getSnapshot(), { ready: false, snapshot: null })
})

test('host resolves manifest assets and handles either initialization order', () => {
  const html = '<head></head><body><script>createUnityInstance(canvas, config, (progress) => { }).then((unityInstance) => { })</script></body>'
  const output = attachUnityUI(html, { css: 'UI/assets/ui.css', entry: 'UI/assets/ui.js' }, '/game/_unity')
  assert.match(output, /\/game\/_unity\/UI\/assets\/ui\.css/)
  assert.match(output, /\/game\/_unity\/UI\/assets\/ui\.js/)
  assert.match(output, /if \(window\.metroUnityInstance\)/)
  assert.match(output, /metroUnityUIReady\?\.\(unityInstance\)/)
})
