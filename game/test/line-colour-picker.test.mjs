import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CITY_STYLES,
  CITY_STYLE_IDS,
  DEFAULT_CITY_STYLE,
  cityLineColourPresets,
} from '../src/sim/cityStyles.ts'
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  isLightHexColour,
  normalizeHexColour,
  presetBadgeLabel,
  presetTitle,
  rgbToHex,
} from '../src/app/windows/inspector/lineColourUtils.ts'

test('cityLineColourPresets covers every city without duplicate hex entries and preserves aliases', () => {
  for (const city of CITY_STYLE_IDS) {
    const presets = cityLineColourPresets(city)
    const table = CITY_STYLES[city].lineColours
    assert.ok(presets.length > 0, `${city} should expose predefined line colours`)

    const seen = new Set()
    for (const preset of presets) {
      assert.match(preset.colour, /^#[0-9a-f]{6}$/, `${city}:${preset.id} colour must be lowercase hex`)
      assert.equal(seen.has(preset.colour), false, `${city} must deduplicate colour ${preset.colour}`)
      seen.add(preset.colour)
      assert.equal(preset.ids[0], preset.id)
      for (const id of preset.ids) {
        assert.equal(table[id]?.toLowerCase(), preset.colour)
      }
    }

    for (const [id, raw] of Object.entries(table)) {
      const hex = raw.toLowerCase()
      const match = presets.find((p) => p.colour === hex)
      assert.ok(match, `${city} table entry ${id} (${hex}) must appear in presets`)
      assert.ok(match.ids.includes(id), `${city} preset for ${hex} must retain alias ${id}`)
    }
  }

  // Unknown/omitted city falls back to the default city palette.
  assert.deepEqual(cityLineColourPresets(undefined), cityLineColourPresets(DEFAULT_CITY_STYLE))

  // Representative city alias collapses.
  const shenzhen2 = cityLineColourPresets('shenzhen').find((p) => p.id === '2')
  assert.deepEqual(shenzhen2?.ids, ['2', '8'])

  const chongqing0 = cityLineColourPresets('chongqing').find((p) => p.id === '0')
  assert.deepEqual(chongqing0?.ids, ['0', '环', '环线'])
  assert.equal(presetBadgeLabel(chongqing0, 'zh-CN'), '环')
  assert.equal(presetBadgeLabel(chongqing0, 'en'), '0')

  const shanghaiPujiang = cityLineColourPresets('shanghai').find((p) => p.id === 'Pujiang')
  assert.equal(presetBadgeLabel(shanghaiPujiang, 'zh-CN'), '浦江')
  assert.equal(presetBadgeLabel(shanghaiPujiang, 'en'), 'Pujiang')
  assert.match(presetTitle(shanghaiPujiang, 'zh-CN'), /浦江线.*#B5B5B6/)
  assert.match(presetTitle(shanghaiPujiang, 'en'), /Pujiang.*#B5B5B6/)
})

test('hex / RGB / HSV conversions round-trip accurately and normalize user hex input', () => {
  assert.equal(normalizeHexColour('#00679E'), '#00679e')
  assert.equal(normalizeHexColour('  00679e '), '#00679e')
  assert.equal(normalizeHexColour('#f0a'), '#ff00aa')
  assert.equal(normalizeHexColour('abc'), '#aabbcc')
  assert.equal(normalizeHexColour(''), null)
  assert.equal(normalizeHexColour('#12345'), null)
  assert.equal(normalizeHexColour('#gggggg'), null)

  assert.deepEqual(hexToRgb('#00679e'), { r: 0, g: 103, b: 158 })
  assert.equal(rgbToHex(0, 103, 158), '#00679e')
  assert.equal(rgbToHex(-10, 300, 128), '#00ff80')

  const samples = [
    '#000000',
    '#ffffff',
    '#808080',
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#edcf3b',
    '#00679e',
    '#c70541',
    '#230b55',
    '#80bc28',
  ]
  for (const sample of samples) {
    const hsv = hexToHsv(sample)
    assert.equal(hsvToHex(hsv.h, hsv.s, hsv.v), sample, `HSV round-trip failed for ${sample}`)
  }

  assert.equal(isLightHexColour('#edcf3b'), true)
  assert.equal(isLightHexColour('#fcd600'), true)
  assert.equal(isLightHexColour('#ffffff'), true)
  assert.equal(isLightHexColour('#00679e'), false)
  assert.equal(isLightHexColour('#c70541'), false)
  assert.equal(isLightHexColour('#230b55'), false)
})

test('LineCard uses the pure-DOM LineColourPicker bound to station.cityStyle instead of native color input', () => {
  const cardSrc = readFileSync(new URL('../src/app/windows/inspector/LineCard.tsx', import.meta.url), 'utf8')
  const pickerSrc = readFileSync(new URL('../src/app/windows/inspector/LineColourPicker.tsx', import.meta.url), 'utf8')

  assert.match(cardSrc, /useStore\(\(s\) => s\.station\.cityStyle\)/)
  assert.match(cardSrc, /<LineColourPicker\b/)
  assert.doesNotMatch(cardSrc, /type=["']color["']/)

  assert.match(pickerSrc, /popover="auto"/)
  assert.match(pickerSrc, /cityLineColourPresets\(/)
  assert.match(pickerSrc, /beginPointerDrag\(/)
  assert.match(pickerSrc, /getUiScale\(/)
})
