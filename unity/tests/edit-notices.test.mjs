// Plan 28 §4 at the shell boundary: the C# pointer router publishes one normalized **build
// outcome** (`state.edit.notice`) per press/release, and the shell turns its stable code into
// the player's language. A refusal the player cannot see is the defect this pins: an ack
// payload never reaches the shared store, so the code -> sentence mapping here is the whole of
// what the player is told.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noticeKey, noticeText } from '../../game/src/unity-web/editNotices.ts'

test('platform placement without a line points to the Lines panel in both languages', () => {
  const outcome = { kind: 'blocked', tool: 'rail', code: 'no-line' }
  assert.equal(noticeText(outcome, 'en'), 'Add a line in the Lines panel before placing a platform.')
  assert.equal(noticeText(outcome, 'zh-CN'), '请先在「线路」中添加一条线路，再放置站台。')
})

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

test('room tool refusals map to localized room messages in both languages', () => {
  const minSize = { kind: 'blocked', code: 'min-size', tool: 'zone', zoneBrush: 'ticket', width: 2, height: 1 }
  assert.match(noticeText(minSize, 'zh-CN'), /3×3.*2×1/)
  assert.match(noticeText(minSize, 'en'), /3×3.*2×1/)

  const clash = { kind: 'blocked', code: 'clash', tool: 'zone', zoneBrush: 'ticket' }
  assert.match(noticeText(clash, 'zh-CN'), /重叠/)
  assert.match(noticeText(clash, 'en'), /cannot overlap/i)

  const noFloor = { kind: 'blocked', code: 'no-floor', tool: 'zone', zoneBrush: 'info' }
  assert.match(noticeText(noFloor, 'zh-CN'), /地面/)
  assert.match(noticeText(noFloor, 'en'), /complete floor/i)

  const track = { kind: 'blocked', code: 'track', tool: 'zone', zoneBrush: 'ticket' }
  assert.match(noticeText(track, 'zh-CN'), /轨道.*房间/)
  assert.match(noticeText(track, 'en'), /rooms on track/i)

  const notFloor = { kind: 'blocked', code: 'not-floor', tool: 'zone', zoneBrush: 'paid' }
  assert.match(noticeText(notFloor, 'zh-CN'), /地板/)
  assert.match(noticeText(notFloor, 'en'), /painted on floors/i)
})
