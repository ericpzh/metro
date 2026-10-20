import test from 'node:test'
import assert from 'node:assert/strict'
import { FramePreview } from '../src/app/tools/geometry/framePreview.ts'
import { FrameTask } from '../src/app/frameTask.ts'

test('continuous movement replaces pending work without postponing the next frame', () => {
  const frames = new Map(), draws = []
  let scheduled = 0
  const preview = new FramePreview(run => {
    const id = ++scheduled
    frames.set(id, () => { frames.delete(id); run() })
    return () => frames.delete(id)
  })
  for (let i = 0; i < 100; i++) preview.scheduleLatest(String(i), () => draws.push(i))
  assert.equal(scheduled, 1, 'new targets must not cancel and restart the frame')
  assert.equal(frames.size, 1)
  for (const run of frames.values()) run()
  assert.deepEqual(draws, [99])
  assert.equal(preview.scheduleLatest('99', () => draws.push('duplicate')), false)
  assert.equal(frames.size, 0, 'an unchanged rendered target does no work')
  preview.scheduleLatest('100', () => draws.push(100))
  preview.flush()
  assert.deepEqual(draws, [99, 100])
  assert.equal(frames.size, 0)
  preview.scheduleLatest('101', () => draws.push('cancelled'))
  preview.clear()
  assert.equal(frames.size, 0)
  assert.deepEqual(draws, [99, 100])
  preview.scheduleLatest('101', () => draws.push('new drag'))
  for (const run of frames.values()) run()
  assert.equal(draws.at(-1), 'new drag')
})

test('a coalesced viewport move draws in its existing frame; synchronous release drains do not build a discarded preview', () => {
  let pointerCallback, previewCallback, draws=0, cancelled=0
  const pointer = new FrameTask(run => { pointerCallback=run; return 1 }, () => {})
  const preview = new FramePreview(run => { previewCallback=run; return () => { cancelled++; previewCallback=null } })
  const move = key => () => {
    preview.scheduleLatest(key, () => draws++)
    if (pointer.inAnimationFrame) preview.flush()
  }
  pointer.schedule(move('first'))
  pointerCallback()
  assert.equal(draws,1)
  assert.equal(previewCallback,null,'the second scheduled frame is cancelled after drawing in the current one')
  assert.equal(cancelled,1)
  assert.equal(pointer.inAnimationFrame,false)
  pointer.schedule(move('release'))
  pointer.flush()
  assert.equal(draws,1,'release can cancel the preview before committing without building it first')
  preview.clear()
  assert.equal(previewCallback,null)
})
