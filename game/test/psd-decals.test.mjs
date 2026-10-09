// Printed safety vinyl on the platform face of the glass (§5.9).
//
// `PsdDecals.ts` is pure canvas calls, so the recording context in
// `support/stub-canvas.mjs` pins what each decal prints: the ink order (ground
// first, wording over it), the bilingual warning lines, and the arrow's white
// ring-and-head. A decal that printed nothing — or the wrong language — would
// look exactly like a slow frame, and nothing else in the suite fails.
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawPsdArrow, drawPsdBand, drawPsdDoorBand, drawPsdWarning } from '../src/render/models/pieces/PsdDecals.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

test('the fixed-pane band prints mind-the-gap bilingual in red over yellow', () => {
  const { g, ops } = stubCanvas()
  drawPsdBand(g)
  assert.deepEqual(ops.filled.slice(0, 2), ['#b52630', '#f5d62c'], 'red band with a yellow foot strip, ground first')
  const texts = ops.words.map((w) => w.text)
  assert.ok(texts.includes('注意站台与列车之间的空隙'))
  assert.ok(texts.includes('Mind the gap between train and platform'))
})

test('the door band prints the same warning on a yellow ground', () => {
  const { g, ops } = stubCanvas()
  drawPsdDoorBand(g)
  assert.deepEqual(ops.filled.slice(0, 2), ['#f5d62c', '#b52630'], 'yellow door leaf with a red foot strip')
  const texts = ops.words.map((w) => w.text)
  assert.ok(texts.includes('注意站台与列车之间的空隙'))
  assert.ok(texts.includes('Mind the gap'))
})

test('the warning placard prints the door-safety lines over yellow', () => {
  const { g, ops } = stubCanvas()
  drawPsdWarning(g)
  assert.equal(ops.filled[0], '#f8d923', 'yellow caution ground first')
  const texts = ops.words.map((w) => w.text)
  for (const text of ['灯闪铃响，勿上下车。', '冲门危险，顾己及人。', 'Stand clear of closing doors', '小心！别碰我！', 'CAUTION! Do not touch']) {
    assert.ok(texts.includes(text), text)
  }
  assert.ok(ops.filled.includes('#ffffff'), 'the caution eyes print white')
})

test('the opening arrow is a white ring with a filled head', () => {
  for (const sign of [1, -1]) {
    const { g, ops } = stubCanvas()
    drawPsdArrow(g, sign)
    assert.ok(ops.stroked.includes('#ffffff'), 'the ring strokes white')
    assert.ok(ops.arcs.some((a) => a.r === 115), 'one full ring')
    assert.ok(ops.filled.includes('#ffffff'), 'the head fills white')
  }
})
