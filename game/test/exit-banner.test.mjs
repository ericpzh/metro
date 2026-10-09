import test from 'node:test'
import assert from 'node:assert/strict'
import { stubCanvas } from './support/stub-canvas.mjs'
import { exitHeaderCanvas } from '../src/render/models/pieces/ExitModel.ts'

test('exit banner prints saved English below Chinese in white on red', () => {
  const original = globalThis.document
  try {
    for (const english of ['Zoo', 'A Very Long English Station Name', '']) {
      const { g, ops } = stubCanvas(512, 96)
      globalThis.document = { createElement: () => ({ getContext: () => g }) }
      exitHeaderCanvas('动物园站', 'C1口', english)
      assert.equal(ops.filled[0], '#c22f28')
      assert.ok(ops.words.every((w) => w.colour === '#ffffff'))
      assert.ok(ops.texts.includes('广州地铁'))
      assert.ok(ops.texts.includes('C1'))
      const chinese = ops.words.find((w) => w.text === '动物园站')
      assert.ok(chinese, 'station suffix is not duplicated')
      if (english) {
        const word = ops.words.find((w) => w.text === english)
        assert.equal(word.x, chinese.x)
        assert.ok(word.y > chinese.y)
        assert.ok(word.size < chinese.size)
      } else assert.equal(chinese.y, 48)
    }
  } finally { globalThis.document = original }
})
