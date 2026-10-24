import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeFrameIntervals } from '../src/app/benchmark/benchmarkStats.ts'

test('benchmark FPS uses submitted frame intervals and the slowest one percent', () => {
  const stats = summarizeFrameIntervals([10, 10, 10, 100, 0, Number.NaN])
  assert.deepEqual(stats, {
    averageFps: 1000 / 32.5,
    onePercentLowFps: 10,
    worstFrameMs: 100,
  })
})

test('benchmark FPS returns no summary when there are no valid submitted intervals', () => {
  assert.equal(summarizeFrameIntervals([]), null)
  assert.equal(summarizeFrameIntervals([0, -1, Number.NaN, Infinity]), null)
})
