import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStore } from 'zustand/vanilla'
import { UPSCALING_SCALE } from '../src/render/upscaling.ts'
import { readUpscalingMode } from '../src/app/upscaling.ts'
import { createViewSlice } from '../src/app/store/slices/ViewSlice.ts'

test('FSR presets use their published scale ratios and Native is the default', () => {
  assert.deepEqual(UPSCALING_SCALE, {
    native: 1, ultra: 1 / 1.3, quality: 1 / 1.5, balanced: 1 / 1.7, performance: 0.5,
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
  } })
  try {
    assert.equal(readUpscalingMode(), 'native')
    const store = createStore((...args) => ({ ...createViewSlice(...args), version: 4 }))
    store.getState().setUpscalingMode('quality')
    assert.equal(values.get('metro-game.upscaling'), 'quality')
    assert.equal(store.getState().version, 4, 'a render preference does not edit the station')
    assert.equal(createStore((...args) => createViewSlice(...args)).getState().upscalingMode, 'quality')
    for (const mode of ['ultra', 'balanced', 'performance']) {
      values.set('metro-game.upscaling', mode)
      assert.equal(readUpscalingMode(), mode)
    }
    values.set('metro-game.upscaling', 'invalid')
    assert.equal(readUpscalingMode(), 'native')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked') } })
    assert.equal(readUpscalingMode(), 'native')
    store.getState().setUpscalingMode('native')
    assert.equal(store.getState().upscalingMode, 'native')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})

test('both game views route the shared setting to the renderer', () => {
  const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  const editor = source('../src/app/Viewport.tsx')
  const exploded = source('../src/app/windows/ExplodedView.tsx')
  const menu = source('../src/app/windows/topbar/SettingsMenu.tsx')
  assert.match(editor, /scene\.setUpscalingMode\(useStore\.getState\(\)\.upscalingMode\)/)
  assert.match(editor, /sceneRef\.current\?\.setUpscalingMode\(upscalingMode\)/)
  assert.match(exploded, /scene\.setUpscalingMode\(useStore\.getState\(\)\.upscalingMode\)/)
  assert.match(exploded, /renderer\.current\?\.setUpscalingMode\(upscalingMode\)/)
  assert.match(menu, /const upscalingModes = \['native', 'ultra', 'quality', 'balanced', 'performance'\]/)
  assert.match(menu, /setUpscalingMode\(upscalingModes\[\(upscalingModes\.indexOf\(upscalingMode\)\+1\)%upscalingModes\.length\]\)/)
  assert.match(menu, /<PiGraphicsCard aria-hidden="true"\s*\/>/)
  assert.match(menu, /className="settingsToggleGrid"/)
  assert.doesNotMatch(menu, /<select/)
  const messages = source('../src/sim/i18n/messages.ts')
  for (const [key, label] of Object.entries({ upscaling: 'FSR 设置', upscaling_ultra: '超高', upscaling_quality: '质量', upscaling_balanced: '平衡', upscaling_performance: '性能' })) {
    assert.match(messages, new RegExp(`${key}: \\{ zh: '${label}'`))
  }
  assert.match(menu, /upscalingMode === 'native' \? t\('share_stats_off'\)/)
})
