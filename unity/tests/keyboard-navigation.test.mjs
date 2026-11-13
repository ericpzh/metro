// Plan 13 §1: the Unity entry's held keyboard navigation (`keyboardNavigation.ts`).
//
// The Three entry's scene reads its own key set; the Unity entry has no scene in the
// page, so a held key must become a held *intent* on the bridge exactly once per
// change, and must be released by anything that can lose the key event. These are the
// semantics `app/Viewport.tsx` + `CameraSystem.ts` define for the browser game.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachKeyboardNavigation, isTypingTarget, planarIntent } from '../../game/src/unity-web/keyboardNavigation.ts'

function fakeTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    count(type) { return (listeners.get(type) ?? []).length },
  }
}

function keyEvent(key, { ctrl = false, meta = false, shift = false, alt = false, target = { tagName: 'DIV' } } = {}) {
  return { key, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, altKey: alt, target, preventDefault() {} }
}

function harness(options = {}) {
  const sent = []
  const port = { send: command => sent.push(command), subscribe: () => () => {}, dispose() {} }
  const keys = fakeTarget()
  const host = fakeTarget()
  const doc = fakeTarget()
  host.document = doc
  const detach = attachKeyboardNavigation(port, { keyTarget: keys, hostTarget: host, ...options })
  return { sent, port, keys, host, doc, detach }
}

const planar = (sent) => sent.filter(command => command.type === 'camera.panPlanarHeld')
const vertical = (sent) => sent.filter(command => command.type === 'camera.panHeld')

test('a held WASD key sends one bounded intent, not one frame per repeat', () => {
  const { sent, keys } = harness()
  keys.dispatch('keydown', keyEvent('w'))
  assert.deepEqual(sent, [{ type: 'camera.panPlanarHeld', payload: { right: 0, forward: 1, fast: false } }])
  keys.dispatch('keydown', keyEvent('w'))
  keys.dispatch('keydown', keyEvent('w'))
  assert.equal(sent.length, 1, 'a key repeat is the same intent')
  keys.dispatch('keydown', keyEvent('d'))
  assert.deepEqual(sent.at(-1).payload, { right: 1, forward: 1, fast: false })
  keys.dispatch('keyup', keyEvent('w'))
  assert.deepEqual(sent.at(-1).payload, { right: 1, forward: 0, fast: false })
  keys.dispatch('keyup', keyEvent('d'))
  assert.deepEqual(sent.at(-1).payload, { right: 0, forward: 0, fast: false }, 'release stops the pan')
})

test('Shift speeds the held pan and Shift+W pans nothing', () => {
  const { sent, keys } = harness()
  keys.dispatch('keydown', keyEvent('w'))
  keys.dispatch('keydown', keyEvent('Shift'))
  assert.deepEqual(sent.at(-1).payload, { right: 0, forward: 1, fast: true })
  keys.dispatch('keyup', keyEvent('Shift'))
  assert.deepEqual(sent.at(-1).payload, { right: 0, forward: 1, fast: false })
  keys.dispatch('keyup', keyEvent('w'))

  sent.length = 0
  // Shift+W is the rail folder ladder's own key; it must not also shove the camera.
  keys.dispatch('keydown', keyEvent('W', { shift: true }))
  assert.deepEqual(sent, [])
})

test('Ctrl+Q / Ctrl+E pan vertically; plain Q/E and Alt+letter do not', () => {
  const { sent, keys } = harness()
  keys.dispatch('keydown', keyEvent('q'))
  keys.dispatch('keydown', keyEvent('e'))
  assert.deepEqual(vertical(sent), [], 'plain Q/E is the storey step, owned by AppShell')

  keys.dispatch('keydown', keyEvent('e', { ctrl: true }))
  assert.deepEqual(vertical(sent).at(-1), { type: 'camera.panHeld', payload: { direction: 1, fast: false } })
  keys.dispatch('keyup', keyEvent('e', { ctrl: true }))
  assert.deepEqual(vertical(sent).at(-1).payload, { direction: 0, fast: false })

  // Releasing the modifier is a release of the hold, even while E is still down.
  keys.dispatch('keydown', keyEvent('q', { ctrl: true }))
  assert.equal(vertical(sent).at(-1).payload.direction, -1)
  keys.dispatch('keyup', keyEvent('Control'))
  assert.equal(vertical(sent).at(-1).payload.direction, 0)

  sent.length = 0
  keys.dispatch('keydown', keyEvent('w', { alt: true }))
  assert.deepEqual(sent, [], 'Alt+letter folds a folder and never moves the camera')
})

test('a typing field and an owning dialog keep the keyboard', () => {
  const { sent, keys } = harness()
  keys.dispatch('keydown', keyEvent('w', { target: { tagName: 'INPUT' } }))
  keys.dispatch('keydown', keyEvent('w', { target: { tagName: 'TEXTAREA' } }))
  assert.deepEqual(sent, [])
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true)
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false)
  assert.equal(isTypingTarget(null), false)

  let blocked = true
  const guarded = harness({ blocked: () => blocked })
  guarded.keys.dispatch('keydown', keyEvent('w'))
  assert.deepEqual(guarded.sent, [], 'an open editor owns the keyboard')
  blocked = false
  guarded.keys.dispatch('keydown', keyEvent('w'))
  assert.equal(guarded.sent.length, 1)
})

test('blur, a hidden tab and unmount release whatever was held', () => {
  const { sent, keys, host, doc, detach } = harness()
  keys.dispatch('keydown', keyEvent('w'))
  host.dispatch('blur')
  assert.deepEqual(sent.at(-1).payload, { right: 0, forward: 0, fast: false }, 'blur stops the pan')

  sent.length = 0
  keys.dispatch('keydown', keyEvent('a'))
  assert.deepEqual(sent.at(-1).payload, { right: -1, forward: 0, fast: false })
  doc.dispatch('visibilitychange', { visibilityState: 'visible' })
  assert.equal(sent.length, 1, 'a visible tab keeps the hold')
  doc.dispatch('visibilitychange', { visibilityState: 'hidden' })
  assert.deepEqual(sent.at(-1).payload, { right: 0, forward: 0, fast: false }, 'a hidden tab releases the hold')

  sent.length = 0
  keys.dispatch('keydown', keyEvent('s'))
  keys.dispatch('keydown', keyEvent('e', { ctrl: true }))
  detach()
  assert.deepEqual(planar(sent).at(-1).payload, { right: 0, forward: 0, fast: false })
  assert.deepEqual(vertical(sent).at(-1).payload, { direction: 0, fast: false })
  sent.length = 0
  keys.dispatch('keydown', keyEvent('w'))
  assert.deepEqual(sent, [], 'a detached player listens to nothing')
})

test('the intent is the source axis pair', () => {
  assert.deepEqual(planarIntent(new Set()), { right: 0, forward: 0, fast: false })
  assert.deepEqual(planarIntent(new Set(['w', 'a'])), { right: -1, forward: 1, fast: false })
  assert.deepEqual(planarIntent(new Set(['s', 'd', 'shift'])), { right: 1, forward: -1, fast: true })
})
