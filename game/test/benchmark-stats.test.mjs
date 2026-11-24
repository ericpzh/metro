import test from 'node:test'
import assert from 'node:assert/strict'
import { frameTimeCeilingFor, frameTimePath, summarizeFrameIntervals } from '../src/app/benchmark/benchmarkStats.ts'

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

test('frameTimeCeilingFor picks clean 4-divisible ms bounds while skipping opening sample', () => {
  assert.equal(frameTimeCeilingFor([]), 40)
  // Opening sample frames[0] is ignored just like summarizeFrameIntervals(frames.slice(1)).
  assert.equal(frameTimeCeilingFor([{ interval: 500 }, { interval: 14 }, { interval: 22 }]), 40)
  assert.equal(frameTimeCeilingFor([{ interval: 16 }, { interval: 45.2 }]), 60)
  assert.equal(frameTimeCeilingFor([{ interval: 16 }, { interval: 150 }]), 160)
  assert.equal(frameTimeCeilingFor([{ interval: 16 }, { interval: 1250 }]), 1400)
})

test('frameTimePath emits clamped SVG coordinates for measured frame intervals', () => {
  assert.equal(frameTimePath([], 1000, 260, 40), '')
  const path = frameTimePath([
    { at: 0, interval: 999 }, // skipped opening frame
    { at: 0, interval: 20 },
    { at: 15_000, interval: 40 },
    { at: 30_000, interval: 0 }, // invalid non-positive interval skipped
    { at: 30_000, interval: 80 }, // clamped to maxMs = 40
  ], 1000, 260, 40, 30_000)
  assert.equal(path, 'M0.0,130.0 L500.0,0.0 L1000.0,0.0')
})
