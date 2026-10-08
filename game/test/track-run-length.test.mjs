import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore } from '../src/app/store.ts'
import { makeBridge, makeTrack, makeTunnel } from '../src/build/rail.ts'
import { TRACK_RUN_LENGTHS, trackRunLengthLabel } from '../src/sim/track.ts'

test('tunnel and bridge cycle through the same five named run lengths', () => {
  assert.deepEqual(TRACK_RUN_LENGTHS, [4, 16, 32, 64, 128])
  const labels = ['超短', '短', '中', '长', '超长']
  const source = makeTrack({ id: 'source', lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 0, z: 0, w: 4, d: 3 })
  const st = useStore.getState()
  st.setTunnelLength(4)
  st.setStructureOptions({ bridgeLength: 4 })
  for (let i = 0; i < TRACK_RUN_LENGTHS.length; i++) {
    const length = TRACK_RUN_LENGTHS[i]
    assert.equal(useStore.getState().tunnelLength, length)
    assert.equal(useStore.getState().bridgeLength, length)
    assert.equal(trackRunLengthLabel(length), labels[i])
    assert.equal(makeTunnel(source, 1, useStore.getState().tunnelLength, 'tunnel').w, length)
    assert.equal(makeBridge(source, 1, useStore.getState().bridgeLength, 'bridge').w, length)
    useStore.getState().cycleTunnelLength()
    useStore.getState().cycleBridgeLength()
  }
  assert.equal(useStore.getState().tunnelLength, 4)
  assert.equal(useStore.getState().bridgeLength, 4)
  st.setTunnelLength(30)
  st.setStructureOptions({ bridgeLength: 30 })
  assert.equal(useStore.getState().tunnelLength, 32)
  assert.equal(useStore.getState().bridgeLength, 32)
})
