// 回到默认视角 — the home view, and the ways in (`app/viewHome.ts`).
//
// The action is small and the promises around it are the whole point, so they are
// what the test pins:
//
// * **Home is a camera move and one store write.** 显示其他层, 隐藏天花板, 剖切, 隐藏UI
//   and 隐藏墙壁 are the player's own settings; a home view that quietly rewrote one
//   is what once made the ⌂ button read as broken, so the test drives the action over
//   a store with those flags flipped and checks they come back untouched.
// * **The projection that goes with the preset is written.** An iso *perspective*
//   home with an ortho flag left on is a view the rail disagrees with: the preset and
//   the flag are one write (`Viewport.onPreset` writes the same pair for `1`–`5`).
// * **Ctrl+H and the button are one action.** Two copies of "iso + perspective" is a
//   second place for the home view to change, so the ⌂ button, the shell's key and the
//   `metro:home` hand-over between them are read back from the sources, the way
//   `test/scene-wiring.test.mjs` reads the systems' wiring.
//
// The store is the real one — zustand with no view attached (`test/README.md`) — and
// the scene is a one-method stand-in: `goHomeView` reads nothing else off it. The
// flags the test flips are put back afterwards, because the suite can be run with
// every file in one process (the sandbox's `spawn EPERM` fallback in
// `test/README.md`), where one file's leftovers are the next file's defaults.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { goHomeView } from '../src/app/viewHome.ts'
import { useStore } from '../src/app/store.ts'
import { DEFAULT_FOV, FOV_MAX_DEG, FOV_MIN_DEG } from '../src/render/scene/systems/CameraSystem.ts'
import { cameraRig } from './support/camera-rig.mjs'

/** The camera calls a home view may make, recorded. */
function stubScene() {
  const calls = []
  return {
    calls,
    setPreset: (name) => calls.push(`preset:${name}`),
    setFov: (deg) => calls.push(`fov:${deg}`),
  }
}

/** The display settings a home view must leave alone, as one comparable record. */
const DISPLAY_FLAGS = ['ghostOtherLevels', 'autoCeiling', 'cutaway', 'hideUI', 'hideWalls']

function displayFlags() {
  const st = useStore.getState()
  return Object.fromEntries(DISPLAY_FLAGS.map((k) => [k, st[k]]))
}

function restoreDisplayFlags(flags, ortho) {
  const st = useStore.getState()
  st.setGhostOther(flags.ghostOtherLevels)
  st.setAutoCeiling(flags.autoCeiling)
  st.setCutaway(flags.cutaway)
  st.setHideUI(flags.hideUI)
  st.setHideWalls(flags.hideWalls)
  st.setOrtho(ortho)
}

test('the home view is the iso preset in perspective, and it touches nothing else', () => {
  const st = useStore.getState()
  const wasOrtho = st.ortho
  // Each display setting pushed off its default, so a stray write would show up in
  // the comparison below.
  st.setGhostOther(false)
  st.setAutoCeiling(false)
  st.setCutaway(true)
  st.setHideUI(true)
  st.setHideWalls(true)
  st.setOrtho(true)
  const was = displayFlags()
  try {
    const scene = stubScene()
    goHomeView(scene)

    assert.deepEqual(
      scene.calls,
      ['preset:iso', `fov:${DEFAULT_FOV}`],
      'home is the isometric build view through the lens the camera opens with',
    )
    assert.equal(useStore.getState().ortho, false, 'and a perspective one, whatever the rail showed')
    assert.deepEqual(displayFlags(), was, 'the level slicing and the overlays are the player’s own settings')
  } finally {
    restoreDisplayFlags(was, wasOrtho)
  }
})

test('home puts a lens the player widened back to the default', () => {
  // The point of resetting 视场角 is that it is the one camera setting a player can leave
  // the view in: a home that kept a 120° wide-angle would be "wherever I was". Driven
  // through the **real** camera rig rather than a recorder, so the reset is the lens
  // actually moving and not a call that happened to be made.
  const { cam } = cameraRig()
  cam.setFov(FOV_MAX_DEG)
  assert.equal(cam.fov(), FOV_MAX_DEG, 'the rig did not widen first')
  // And a lens at the *long* end too: home is the default, not "the other end".
  cam.setFov(FOV_MIN_DEG)
  assert.equal(cam.fov(), FOV_MIN_DEG)
  cam.setFov(FOV_MAX_DEG)

  goHomeView({ setPreset: (name) => cam.setPreset(name), setFov: (deg) => cam.setFov(deg) })

  assert.equal(cam.fov(), DEFAULT_FOV, `home left the lens at ${cam.fov()}°`)
})

test('a missing scene is not a crash', () => {
  // The ⌂ button and the key can both fire before the renderer exists (an unmounted
  // viewport, a lost frame): the action is a no-op, not a throw.
  assert.doesNotThrow(() => goHomeView(null))
})

test('a station switch returns to the home view against the fresh bounds', () => {
  const src = (p) => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
  // The switch signal: all three document switches move it, nothing else does —
  // the epoch counts 打开存档 / 示例车站 / 新建, never edits. Pinned here beside
  // the home action because the viewport below is what reads it.
  const slice = src('app/store/slices/StationSlice.ts')
  for (const action of ['loadFromText', 'newStation', 'loadReference']) {
    assert.match(
      slice,
      new RegExp(action + '[\\s\\S]*?stationEpoch: get\\(\\)\\.stationEpoch \\+ 1'),
      `${action} moves the switch signal`,
    )
  }
  assert.equal(
    slice.match(/stationEpoch: get\(\)\.stationEpoch \+ 1/g)?.length ?? 0,
    3,
    'only the three switches move the signal — commit, undo and redo leave it alone',
  )
  // The viewport rebuilds the meshes, then homes on a switch — after `setStation`,
  // so the iso distance is measured off the fresh bounds — and leaves the camera
  // on an edit.
  const viewport = src('app/Viewport.tsx')
  assert.match(viewport, /stationEpoch !== homeEpochRef\.current/, 'the rebuild tells a switch from an edit by the epoch')
  assert.match(viewport, /goHomeView\(scene\)/, 'and a switch runs the one home action, after setStation')
})

test('Ctrl+H, the ⌂ button and the metro:home hand-over are one action', () => {
  const src = (p) => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
  // The shell owns the keyboard, the viewport owns the scene, and the two meet at
  // `metro:home` — the same split `metro:preset` / `metro:frame` use.
  const shell = src('app/windows/AppShell.tsx')
  assert.match(shell, /if \(ck === 'h'\) \{[\s\S]*?metro:home/, 'Ctrl+H asks for the home view')
  const viewport = src('app/Viewport.tsx')
  assert.match(viewport, /const onHome = \(\): void => goHomeView\(scene\)/, 'the viewport runs it on the live scene')
  assert.match(viewport, /window\.addEventListener\('metro:home', onHome\)/, 'and listens for the hand-over')
  assert.match(viewport, /window\.removeEventListener\('metro:home', onHome\)/, 'and lets it go on unmount')
  // Both ways in call the one definition, so neither can drift: the button does not
  // keep a copy of "iso + perspective" beside it.
  const cube = src('app/ViewCube.tsx')
  assert.match(cube, /const goHome = \(\): void => \{\s*goHomeView\(sceneRef\.current\)/, 'the ⌂ button calls the same action')
  assert.doesNotMatch(cube, /setPreset\('iso'\)/, 'and does not keep its own copy of the home view')
})
