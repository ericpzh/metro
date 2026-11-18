// Packet D2: the Unity ViewCube adapter is a transport seam, not a renderer. These
// pins keep the bridge vocabulary stable and prove both sync directions without a
// browser: a C# `camera` payload becomes the cube's document basis, and every cube
// action becomes exactly one `camera.*` command.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cameraCommands,
  cameraSnapshotFromState,
  createStationCameraPort,
  createUnityViewCubeAdapter,
  attachViewStateBridge,
  snapFaceKey,
} from '../src/unity-web/cameraAdapter.ts'
import { useStore } from '../src/app/store.ts'

const DOCUMENT_CAMERA = {
  position: [60, 20, -10],
  target: [58, 18, -12],
  right: [1, 0, 0],
  up: [0, 0, 1],
  back: [0, -1, 0],
  fov: 45,
  ortho: false,
  level: -5,
}

function fakePort() {
  const commands = []
  const listeners = new Set()
  return {
    commands,
    send(command) { commands.push(command) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    dispose() { listeners.clear() },
    emit(state) { for (const listener of listeners) listener(state) },
  }
}

test('the C# camera payload becomes the cube document basis', () => {
  const state = cameraSnapshotFromState({ camera: DOCUMENT_CAMERA, view: { level: -5 } })
  assert.deepEqual(state.right, [1, 0, 0])
  assert.deepEqual(state.up, [0, 0, 1])
  assert.deepEqual(state.back, [0, -1, 0])
  assert.equal(state.projection, 'perspective')
  assert.equal(state.fov, 45)
  assert.equal(state.activeLevel, -5, 'level rides with the camera payload')
  // A JSON string, or vectors as {x,y,z}, still parse.
  const text = cameraSnapshotFromState({ camera: JSON.stringify(DOCUMENT_CAMERA) })
  assert.deepEqual(text.up, [0, 0, 1])
  const objects = cameraSnapshotFromState({
    camera: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 }, ortho: true, fov: 60, level: 0 },
  })
  assert.equal(objects.projection, 'orthographic')
  assert.equal(objects.fov, 60)
  assert.equal(objects.activeLevel, 0)
  assert.equal(cameraSnapshotFromState({ view: {} }), null, 'no camera yet is null, not a fake identity')
})

test('cube actions send the contract commands and nothing else', () => {
  const port = fakePort()
  const adapter = createUnityViewCubeAdapter(port)
  assert.equal(adapter.read(), null)

  port.emit({
    right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0], projection: 'perspective', fov: 45, activeLevel: -5,
  })
  const state = adapter.read()
  assert.deepEqual(state.back, [0, -1, 0], 'a published snapshot is readable synchronously')

  adapter.orbit(12, -4)
  adapter.snap([0, 0, 1], 'orthographic')
  adapter.setProjection('orthographic')
  adapter.setFov(67)
  adapter.home()
  adapter.beginHeldPan(1)
  adapter.updateHeldPan(0.016)
  adapter.endHeldPan()

  assert.deepEqual(port.commands, [
    { type: 'camera.orbit', payload: { dx: 12, dy: -4 } },
    { type: 'camera.snap', payload: { face: 'top', direction: [0, 0, 1], projection: 'orthographic' } },
    { type: 'camera.projection', payload: { ortho: true } },
    { type: 'camera.fov', payload: { deg: 67 } },
    { type: 'camera.home', payload: {} },
    { type: 'camera.panHeld', payload: { direction: 1 } },
    { type: 'camera.panHeld', payload: { direction: 0 } },
  ])
  // The update tick is the C# host's job: no bridge traffic for a value it already owns.
  assert.equal(port.commands.filter(command => command.type === 'camera.panHeld').length, 2)
  adapter.dispose()
})

test('face keys name the six cube faces and leave corners to the direction', () => {
  assert.equal(snapFaceKey([0, 0, 1]), 'top')
  assert.equal(snapFaceKey([0, 0, -1]), 'bottom')
  assert.equal(snapFaceKey([1, 0, 0]), 'e')
  assert.equal(snapFaceKey([-1, 0, 0]), 'w')
  assert.equal(snapFaceKey([0, 1, 0]), 'n')
  assert.equal(snapFaceKey([0, -1, 0]), 's')
  assert.match(snapFaceKey([0.577, 0.577, 0.577]), /^dir:/)
})

test('the station port uses the v2 bridge and coalesces identical states', () => {
  let snapshot = { state: {} }
  const sent = []
  const listeners = new Set()
  const bridge = {
    send(type, payload, options) {
      sent.push({ type, payload, options })
      return 'c-1'
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot() { return snapshot },
    onCameraPose() { return () => {} },
  }
  const received = []
  const port = createStationCameraPort(bridge)
  port.subscribe(state => received.push(state))
  assert.equal(sent.length, 0)

  snapshot = { state: { camera: DOCUMENT_CAMERA } }
  for (const listener of listeners) listener()
  for (const listener of listeners) listener()
  assert.equal(received.length, 1, 'the same published state is not re-delivered')
  assert.equal(received[0].activeLevel, -5)

  port.send(cameraCommands.orbit(3, 4))
  port.send(cameraCommands.pan(5, 6))
  port.send(cameraCommands.zoom(120))
  port.send(cameraCommands.viewSet('level', -10))
  assert.deepEqual(sent, [
    { type: 'camera.orbit', payload: { dx: 3, dy: 4 }, options: undefined },
    { type: 'camera.pan', payload: { dx: 5, dy: 6 }, options: undefined },
    { type: 'camera.zoom', payload: { delta: 120 }, options: undefined },
    { type: 'view.set', payload: { key: 'level', value: -10 }, options: undefined },
  ], 'camera/view commands are session-scoped: no expectedRevision is ever passed')
  port.dispose()
})

test('the shared view toggles become view.set commands', () => {
  const port = fakePort()
  const detach = attachViewStateBridge(port)
  const before = useStore.getState()
  const restore = {
    ghost: before.ghostOtherLevels, walls: before.hideWalls, ground: before.hideGround,
    roof: before.hideRoof, surface: before.hideSectionSurface, autoCeiling: before.autoCeiling,
    zones: before.zoneOverlayOn, density: before.overlayOn, section: before.section,
  }
  try {
    const st = useStore.getState()
    st.setGhostOther(!restore.ghost)
    st.setHideWalls(!restore.walls)
    st.setHideGround(!restore.ground)
    st.setHideRoof(!restore.roof)
    st.setHideSectionSurface(!restore.surface)
    st.setAutoCeiling(!restore.autoCeiling)
    st.setZoneOverlay(!restore.zones)
    st.setOverlay(!restore.density)
    st.setSectionOffset(12)
    st.rotateSection()
    assert.equal(useStore.getState().section.offset, 0, 'rotation clears the shell drag offset')
    assert.deepEqual(port.commands.at(-1).payload, {
      key: 'sectionRotate',
      value: useStore.getState().section.orientation.azimuth,
    }, 'Unity rotates around the anchor it seeded')
    const keys = port.commands.filter(command => command.type === 'view.set').map(command => command.payload.key)
    assert.ok(!keys.includes('section') && !keys.includes('sectionAnchor'), 'rotation must never send the shell placeholder anchor')
    for (const key of ['showLevels', 'walls', 'ground', 'roof', 'sectionSurface', 'ceiling', 'zones', 'density', 'sectionOffset', 'sectionRotate']) {
      assert.ok(keys.includes(key), `the toolbar toggle ${key} never reached C#`)
    }
  } finally {
    const st = useStore.getState()
    st.setGhostOther(restore.ghost)
    st.setHideWalls(restore.walls)
    st.setHideGround(restore.ground)
    st.setHideRoof(restore.roof)
    st.setHideSectionSurface(restore.surface)
    st.setAutoCeiling(restore.autoCeiling)
    st.setZoneOverlay(restore.zones)
    st.setOverlay(restore.density)
    st.placeSection(restore.section.anchor)
    st.setSectionOffset(restore.section.offset)
    detach()
  }
})
