// Plan 28 §4 at the shell boundary: the C# pointer router publishes one normalized **build
// outcome** (`state.edit.notice`) per press/release, and the shell turns its stable code into
// the player's language. A refusal the player cannot see is the defect this pins: an ack
// payload never reaches the shared store, so the code -> sentence mapping here is the whole of
// what the player is told.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noticeKey, noticeText } from '../../game/src/unity-web/editNotices.ts'

test('a blocked candidate names its own code in both languages', () => {
  const occupied = { kind: 'blocked', code: 'occupied', tool: 'module', moduleType: 'bench' }
  assert.equal(noticeText(occupied, 'zh-CN'), '此处已有设备，请另选位置')
  assert.equal(noticeText(occupied, 'en'), 'Equipment already occupies this location')
})

test('a block refusal speaks about blocks, not equipment', () => {
  const blocked = { kind: 'blocked', code: 'occupied', tool: 'block', moduleType: '' }
  assert.match(noticeText(blocked, 'en'), /block already exists/)
  assert.match(noticeText(blocked, 'zh-CN'), /方块/)
})

test('a track-less tunnel and bridge each ask for their own source rail', () => {
  const tunnel = { kind: 'blocked', code: 'no-track', tool: 'tunnel', moduleType: '' }
  const bridge = { kind: 'blocked', code: 'no-track', tool: 'module', moduleType: 'bridge' }
  assert.match(noticeText(tunnel, 'en'), /tunnel connects to its end/)
  assert.match(noticeText(bridge, 'en'), /bridge connects to its end/)
})

test('a floor refusal on the rail tools is about the platform, not equipment', () => {
  const rail = { kind: 'blocked', code: 'floor', tool: 'rail', moduleType: '' }
  assert.match(noticeText(rail, 'en'), /at least three cells wide/)
})

test('a stale gesture and a plain miss stay silent', () => {
  assert.equal(noticeText({ kind: 'stale', code: 'stale-revision' }, 'en'), '')
  assert.equal(noticeText({ kind: 'blocked', code: '', reason: '' }, 'en'), '')
  assert.equal(noticeText(null, 'en'), '')
  assert.equal(noticeText(undefined, 'en'), '')
})

test('a bare protocol code becomes its family wording, never the raw code', () => {
  const bare = { kind: 'blocked', code: 'no-cell', reason: 'no-cell' }
  assert.equal(noticeText(bare, 'en'), 'Cannot place equipment here: choose another location')
  const deliberate = { kind: 'no-op', code: 'no-change', reason: 'no-change' }
  assert.equal(noticeText(deliberate, 'en'), 'Nothing to remove here')
})

test('an unknown code falls back to the host sentence', () => {
  assert.equal(noticeText({ kind: 'blocked', code: 'custom', reason: 'Something specific.' }, 'en'),
    'Something specific.')
})

test('the notice key changes with the outcome and not with a repeated one', () => {
  const a = { kind: 'blocked', code: 'occupied', tool: 'module', moduleType: 'bench' }
  const b = { kind: 'blocked', code: 'occupied', tool: 'module', moduleType: 'shelf' }
  assert.equal(noticeKey(a), noticeKey({ ...a }))
  assert.notEqual(noticeKey(a), noticeKey(b))
  assert.equal(noticeKey(null), '')
})
