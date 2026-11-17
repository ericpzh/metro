// Plan 29 §5: the ViewCube follows the rendered camera at camera-frame cadence. The Unity
// host samples the camera it actually applied after `StationViewRig.Tick` and publishes a
// small sequenced pose; the shared camera port keeps the newest and hands it to the widget
// once per animation frame, so a drag's cube moves with the frame instead of at the 100 ms
// general state interval. A stale state or ack camera can never roll it back.
//
// A fake bridge and a manual animation-frame queue stand in for the player and the
// browser; the production `cameraAdapter.ts` is the code under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStationCameraPort, createUnityViewCubeAdapter } from '../../game/src/unity-web/cameraAdapter.ts'

function installFrames() {
  const previous = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  const queue = []
  globalThis.requestAnimationFrame = callback => { queue.push(callback); return queue.length }
  globalThis.cancelAnimationFrame = id => { if (id > 0) queue[id - 1] = null }
  return {
    flush() {
      while (queue.length) {
        const callback = queue.shift()
        if (callback) callback()
      }
    },
    restore() {
      globalThis.requestAnimationFrame = previous.raf
      globalThis.cancelAnimationFrame = previous.caf
    },
  }
}

const camera = (back, sequence) => ({
  right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, back], fov: 45, ortho: false, level: 0,
  ...(sequence === undefined ? {} : { sequence }),
})

function fakeBridge(initialState = {}) {
  const subscribers = new Set()
  const poseListeners = new Set()
  const sent = []
  let state = initialState
  const bridge = {
    getSnapshot: () => ({ state }),
    subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener) },
    onCameraPose: listener => { poseListeners.add(listener); return () => poseListeners.delete(listener) },
    send: (type, payload) => sent.push({ type, payload }),
  }
  return {
    bridge, sent,
    setState(next) {
      state = next
      for (const listener of [...subscribers]) listener()
    },
    pose(payload, sequence) {
      for (const listener of [...poseListeners]) listener(payload, sequence)
    },
  }
}

test('the cube applies the newest host pose once per animation frame', () => {
  const frames = installFrames()
  const fake = fakeBridge()
  const port = createStationCameraPort(fake.bridge)
  const adapter = createUnityViewCubeAdapter(port)
  const seen = []
  const stop = adapter.subscribe(state => seen.push(state.back[2]))
  try {
    fake.pose(camera(0.1), 1)
    fake.pose(camera(0.2), 2)
    fake.pose(camera(0.3), 3)
    assert.equal(seen.length, 0, 'poses wait for the animation frame')
    frames.flush()
    assert.deepEqual(seen, [0.3], 'one redraw for the whole frame, with the latest pose')
    fake.pose(camera(0.4), 4)
    frames.flush()
    assert.deepEqual(seen, [0.3, 0.4])
  } finally {
    stop()
    adapter.dispose()
    port.dispose()
    frames.restore()
  }
})

test('an older pose or an untagged state camera never rolls the cube back', () => {
  const frames = installFrames()
  const fake = fakeBridge()
  const port = createStationCameraPort(fake.bridge)
  const adapter = createUnityViewCubeAdapter(port)
  const seen = []
  const stop = adapter.subscribe(state => seen.push(state.back[2]))
  try {
    fake.pose(camera(0.6), 6)
    frames.flush()
    assert.deepEqual(seen, [0.6])
    // A late pose from before the current one is dropped (the network may reorder).
    fake.pose(camera(0.2), 3)
    frames.flush()
    assert.deepEqual(seen, [0.6], 'the older sequence is ignored')
    // The 100 ms state feed still knows the camera, but without a sequence it is older than
    // the pose channel and must not move the cube backwards.
    fake.setState({ camera: camera(0.1) })
    assert.deepEqual(seen, [0.6], 'an untagged state camera cannot supersede a pose')
    // A tagged, newer state camera (an ack or a state reply built after the pose) is taken.
    fake.setState({ camera: camera(0.7, 7) })
    assert.deepEqual(seen, [0.6, 0.7])
  } finally {
    stop()
    adapter.dispose()
    port.dispose()
    frames.restore()
  }
})

test('a cube drag is accumulated into one orbit command per frame', () => {
  const frames = installFrames()
  const fake = fakeBridge({ camera: camera(0, 0) })
  const port = createStationCameraPort(fake.bridge)
  const adapter = createUnityViewCubeAdapter(port)
  try {
    adapter.orbit(2, 0)
    adapter.orbit(3, 1)
    adapter.orbit(-1, 0)
    assert.equal(fake.sent.length, 0, 'nothing is sent before the frame')
    frames.flush()
    assert.deepEqual(fake.sent, [{ type: 'camera.orbit', payload: { dx: 4, dy: 1 } }],
      'the whole travel of the frame is one command, never one per pointer move')
    adapter.orbit(1, 0)
    adapter.dispose()
    frames.flush()
    assert.equal(fake.sent.length, 1, 'a disposed adapter drops its queued orbit')
  } finally {
    port.dispose()
    frames.restore()
  }
})
