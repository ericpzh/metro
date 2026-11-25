import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  UI_SCALE_STORAGE_KEY,
  beginUiScaleDrag,
  clampUiScale,
  defaultUiScaleForViewport,
  endUiScaleDrag,
  getUiScale,
  getUiScaleState,
  initUiScale,
  readSavedUiScale,
  resetUiScale,
  setUiScale,
  subscribeUiScale,
  syncUiScaleForViewport,
} from '../src/app/uiScale.ts'

test('defaultUiScaleForViewport maps common resolutions to balanced defaults within 75%–150%', () => {
  assert.equal(UI_SCALE_MIN, 0.75)
  assert.equal(UI_SCALE_MAX, 1.5)
  assert.equal(UI_SCALE_STEP, 0.01)

  assert.equal(defaultUiScaleForViewport(3840, 2160), 1.5)
  assert.equal(defaultUiScaleForViewport(2560, 1440), 1.25)
  assert.equal(defaultUiScaleForViewport(3440, 1440), 1.25)
  assert.equal(defaultUiScaleForViewport(1920, 1080), 1)
  assert.equal(defaultUiScaleForViewport(1920, 950), 1)
  assert.equal(defaultUiScaleForViewport(2560, 1080), 1)
  assert.equal(defaultUiScaleForViewport(1600, 900), 0.9)
  assert.equal(defaultUiScaleForViewport(1536, 864), 0.9)
  assert.equal(defaultUiScaleForViewport(1440, 900), 0.85)
  assert.equal(defaultUiScaleForViewport(1366, 768), 0.85)
  assert.equal(defaultUiScaleForViewport(1280, 720), 0.75)
  assert.equal(defaultUiScaleForViewport(1024, 600), 0.75)
  assert.equal(defaultUiScaleForViewport(800, 600), 0.75)
  assert.equal(defaultUiScaleForViewport(0, 0), 1)
  assert.equal(defaultUiScaleForViewport(Number.NaN, 1080), 1)

  assert.equal(clampUiScale(0.25), 0.75)
  assert.equal(clampUiScale(2.4), 1.5)
  assert.equal(clampUiScale(0.834), 0.83)
  assert.equal(clampUiScale(1.126), 1.13)
  assert.equal(clampUiScale(Number.NaN), 1)
})

test('uiScale supports live continuous drag updates, persists on commit, follows resizes when auto, and resets cleanly', () => {
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  const values = new Map()
  const props = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
  const win = { innerWidth: 2560, innerHeight: 1440, addEventListener() {} }
  const doc = {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: name => props.delete(name),
      },
    },
  }

  try {
    globalThis.localStorage = storage
    globalThis.window = win
    globalThis.document = doc

    assert.equal(readSavedUiScale(storage), null)
    assert.equal(readSavedUiScale({ getItem() { throw Error('denied') } }), null)

    initUiScale()
    assert.equal(getUiScale(), 1.25)
    assert.deepEqual(getUiScaleState(), { scale: 1.25, defaultScale: 1.25, custom: false })
    assert.equal(props.get('--ui-scale'), '1.25')
    assert.equal(doc.documentElement.dataset.uiScale, '125')

    let updates = 0
    const unsubscribe = subscribeUiScale(() => { updates += 1 })

    // Resizing while in auto mode updates both defaultScale and active scale.
    syncUiScaleForViewport(1280, 720)
    assert.deepEqual(getUiScaleState(), { scale: 0.75, defaultScale: 0.75, custom: false })
    assert.equal(props.get('--ui-scale'), '0.75')
    assert.equal(updates, 1)

    // Live drag updates DOM immediately without spamming localStorage until commit.
    beginUiScaleDrag()
    assert.equal(doc.documentElement.dataset.uiScaling, 'true')
    assert.equal(props.get('--ui-scale-drag'), '0.75')

    setUiScale(1.13, { persist: false })
    assert.equal(props.get('--ui-scale'), '1.13')
    assert.equal(doc.documentElement.dataset.uiScale, '113')
    assert.equal(values.has(UI_SCALE_STORAGE_KEY), false)

    endUiScaleDrag()
    assert.equal(doc.documentElement.dataset.uiScaling, undefined)
    assert.equal(props.has('--ui-scale-drag'), false)

    setUiScale(1.13)
    assert.equal(values.get(UI_SCALE_STORAGE_KEY), '1.13')
    assert.deepEqual(getUiScaleState(), { scale: 1.13, defaultScale: 0.75, custom: true })

    syncUiScaleForViewport(3840, 2160)
    assert.deepEqual(getUiScaleState(), { scale: 1.13, defaultScale: 1.5, custom: true })

    // Reloading restores the saved override.
    win.innerWidth = 1920
    win.innerHeight = 1080
    initUiScale()
    assert.deepEqual(getUiScaleState(), { scale: 1.13, defaultScale: 1, custom: true })

    // Resetting clears storage and snaps back to the current viewport default.
    resetUiScale()
    assert.equal(values.has(UI_SCALE_STORAGE_KEY), false)
    assert.deepEqual(getUiScaleState(), { scale: 1, defaultScale: 1, custom: false })
    assert.equal(props.get('--ui-scale'), '1')

    // Corrupt storage falls back safely to resolution default.
    values.set(UI_SCALE_STORAGE_KEY, 'not-a-number')
    initUiScale()
    assert.deepEqual(getUiScaleState(), { scale: 1, defaultScale: 1, custom: false })
    unsubscribe()
  } finally {
    if (prevWindow) Object.defineProperty(globalThis, 'window', prevWindow)
    else delete globalThis.window
    if (prevDocument) Object.defineProperty(globalThis, 'document', prevDocument)
    else delete globalThis.document
    if (prevStorage) Object.defineProperty(globalThis, 'localStorage', prevStorage)
    else delete globalThis.localStorage
  }
})

test('settings menu wires UiScaleSetting across all three UI themes and bilingual catalogue', () => {
  const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  const menu = source('../src/app/windows/topbar/SettingsMenu.tsx')
  const scaleSetting = source('../src/app/windows/topbar/UiScaleSetting.tsx')
  const css = source('../src/styles.css')
  const messages = source('../src/sim/i18n/messages.ts')

  assert.match(menu, /<UiScaleSetting \/>/)
  assert.match(scaleSetting, /<Slider\b/)
  assert.match(scaleSetting, /data-setting="ui-scale"/)
  assert.match(scaleSetting, /data-setting="ui-scale-reset"/)
  assert.match(scaleSetting, /beginUiScaleDrag/)
  assert.match(scaleSetting, /endUiScaleDrag/)
  assert.match(css, /:root\[data-ui-scaling="true"\] \.settingsDropdown/)
  assert.match(css, /\.settingsScale\{/)
  assert.match(css, /:root\[data-ui-theme="site"\] \.settingsAudio,\s*:root\[data-ui-theme="site"\] \.settingsMusic,\s*:root\[data-ui-theme="site"\] \.settingsScale/)
  assert.match(css, /:root\[data-ui-theme="studio"\] \.settingsAudio, :root\[data-ui-theme="studio"\] \.settingsMusic, :root\[data-ui-theme="studio"\] \.settingsScale/)
  assert.match(messages, /ui_scale: \{ zh: '界面缩放', en: 'UI scale' \}/)
  assert.match(messages, /ui_scale_auto: \{ zh: '自动', en: 'Auto' \}/)
  assert.match(messages, /ui_scale_reset: \{ zh: '恢复默认缩放（\{0\}%）', en: 'Reset to default scale \(\{0\}%\)' \}/)
})
