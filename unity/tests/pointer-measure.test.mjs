import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MEASURE_OFFSET,
  measurePosition,
  measureText,
  wantsMeasure,
} from '../../game/src/unity-web/pointerMeasure.ts'

// The pointer's drag size label (plan 27 §7). The C# publishes `cells.measure` as the
// footprint in metres; this module owns the wording and the show/hide rule, so the presenter
// only has to draw what it decides.

test('a live cell plan with a footprint wants a label', () => {
  assert.equal(wantsMeasure({ kind: 'add', measure: { length: 3, width: 4 } }), true)
  assert.equal(wantsMeasure({ kind: 'delete', measure: { length: 1, width: 1 } }), true)
  assert.equal(wantsMeasure({ kind: 'wall', measure: { length: 2, width: 1 } }), true)
})

test('a preview with no plan, or no measured footprint, stays unlabelled', () => {
  assert.equal(wantsMeasure(null), false)
  assert.equal(wantsMeasure({}), false)
  assert.equal(wantsMeasure({ kind: 'add' }), false)
  assert.equal(wantsMeasure({ kind: 'add', measure: { length: 0, width: 4 } }), false)
  assert.equal(wantsMeasure({ kind: 'module-run', measure: { length: 2, width: 1 } }), false)
})

test('the wording is length then width, in whole metres', () => {
  assert.equal(measureText({ kind: 'add', measure: { length: 3, width: 4 } }, 'zh'), '3 × 4 米')
  assert.equal(measureText({ kind: 'add', measure: { length: 3, width: 4 } }, 'en'), '3 × 4 m')
  assert.equal(measureText({ kind: 'add', measure: { length: 2.4, width: 1.6 } }, 'en'), '2 × 2 m')
  assert.equal(measureText({ kind: 'add' }, 'en'), '')
})

test('the label sits just off the pointer, inside the canvas', () => {
  const at = measurePosition(100, 50, { left: 10, top: 20 })
  assert.deepEqual(at, { left: 100 - 10 + MEASURE_OFFSET.x, top: 50 - 20 + MEASURE_OFFSET.y })
  assert.deepEqual(measurePosition(100, 50, null), {
    left: 100 + MEASURE_OFFSET.x,
    top: 50 + MEASURE_OFFSET.y,
  })
})
