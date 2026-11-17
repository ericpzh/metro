// Plan 30 §4 — a station-name inscription's glyphs are the six approved hands.
//
// Two things are pinned here, and they fail independently:
//
//  1. **The manifest.** `sim/calligraphyFonts.ts` is the one table of approved faces:
//     the web palette's `CALLIGRAPHY_STYLES[].family`, a weight and an italic per
//     hand, the resolved-face verdict, and the version that Unity folds into its
//     texture-cache key. The C# constant must match the TypeScript one, or a shell
//     could serve pixels painted under another manifest.
//  2. **The port.** `createCalligraphyFacePort` answers only `calligraphyRequest`,
//     paints through the shipping `drawCalligraphyPanel` at the plate's own pixels,
//     applies the Unity plate's measured orientation once, chunks the PNG in the
//     shared 48 KiB slices, deduplicates in-flight keys, reports a face the machine
//     does not have, and waits for fonts rather than minting a fallback glyph.
//
// No browser is needed: the painter is driven through a recording 2D context. The
// local evidence that the faces are installed on this machine (and that
// `document.fonts.check` cannot tell a missing system face) is recorded in the task
// report, not in this suite.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stubCanvas } from '../../game/test/support/stub-canvas.mjs'
import {
  CALLIGRAPHY_FONT_MANIFEST,
  CALLIGRAPHY_FONT_VERSION,
  CALLIGRAPHY_LAST_RESORT_FAMILY,
  describeCalligraphyResolution,
  resolveCalligraphyFace,
} from '../../game/src/sim/calligraphyFonts.ts'
import { CALLIGRAPHY_STYLES } from '../../game/src/sim/calligraphy.ts'
import { PX_PER_METRE, calligraphyPlate } from '../../game/src/render/calligraphyFace.ts'
import {
  CALLIGRAPHY_FACE_REQUEST_MAX,
  calligraphyFaceFactsOf,
  createCalligraphyFacePort,
  isCalligraphyRequest,
  paintCalligraphyFace,
} from '../../game/src/unity-web/calligraphyFaceProvider.ts'

const root = join(import.meta.dirname, '../..')
const APPROVED = ['kai', 'xing', 'li', 'wei', 'hei', 'song']
const ALL_PRESENT = () => ({ checked: true, measured: true })
const ALL_MISSING = () => ({ checked: true, measured: false })

test('the C# native fallback mirrors the manifest weight/italic and the web treatment', () => {
  // The browser paints the approved face; Unity's headless fallback cannot (it has one
  // scene font), but its bold/italic and its ink/strike/tracking/stretch must still be
  // the same hand, or a smoke would print a different inscription from a player.
  const csharp = readFileSync(join(root, 'unity/Assets/StationDesigner/Runtime/App/Views/StationCalligraphyArtwork.cs'), 'utf8')
  const pattern = /\["(\w+)"\]\s*=\s*Spec\("(\w+)",\s*(true|false),\s*(true|false),\s*([\d.]+)f,\s*([\d.]+)f,\s*([\d.]+)f,\s*"([^"]+)"\)/g
  const seen = new Set()
  for (const match of csharp.matchAll(pattern)) {
    const [, key, specKey, bold, italic, strike, tracking, stretch, ink] = match
    assert.equal(key, specKey)
    const face = CALLIGRAPHY_FONT_MANIFEST[key]
    const spec = CALLIGRAPHY_STYLES[key]
    assert.ok(face && spec, `${key}: the C# table names an approved hand`)
    assert.equal(bold === 'true', face.weight === '700', `${key}: 700 is bold, 400 is not`)
    assert.equal(italic === 'true', face.italic, `${key}: the lean matches the manifest`)
    assert.equal(Number(strike), spec.strike, `${key}: the second strike is the web's`)
    assert.equal(Number(tracking), spec.tracking, `${key}: the tracking is the web's`)
    assert.equal(Number(stretch), spec.stretch, `${key}: the stretch is the web's`)
    assert.equal(ink.toLowerCase(), spec.ink.toLowerCase(), `${key}: the ink is the web's`)
    seen.add(key)
  }
  assert.deepEqual([...seen].sort(), [...APPROVED].sort(), 'the C# fallback table covers all six hands')
})

/* ---------------------------------------------------------------- surfaces */

/**
 * A canvas surface over `stub-canvas` that records the font strings the painter set
 * and the transforms an oriented copy applied. `options.png` is the encoded payload
 * (a string or a function of the surface index); `options.noImage` withholds the
 * drawable so the orientation step must fail rather than ship unmirrored pixels.
 */
function surfaceFactory(options = {}) {
  const created = []
  const factory = (width, height) => {
    const stub = stubCanvas(width, height)
    const fonts = []
    let font = stub.g.font
    Object.defineProperty(stub.g, 'font', {
      configurable: true,
      get: () => font,
      set: (value) => { font = String(value); fonts.push(font) },
    })
    const transforms = []
    const images = []
    stub.g.translate = (x, y) => { transforms.push({ op: 'translate', x, y }) }
    stub.g.scale = (x, y) => { transforms.push({ op: 'scale', x, y }) }
    stub.g.drawImage = (image, x, y, w, h) => { images.push({ image, x, y, w, h }) }
    const png = typeof options.png === 'function' ? options.png(created.length) : (options.png ?? 'ZmFrZQ==')
    const record = {
      width, height, fonts, transforms, images, png,
      get words() { return stub.ops.words },
      get rotations() { return stub.ops.rotations },
    }
    const surface = {
      width,
      height,
      context: stub.g,
      image: options.noImage ? undefined : { surface: created.length },
      pngBase64: () => png,
    }
    created.push({ surface, record })
    return surface
  }
  return { factory, created }
}

const FACE = {
  key: 'calligraphy|动物园||wei|h|4x1|calligraphy-fonts/1',
  moduleId: 'calligraphy-wei-h-365',
  text: '动物园',
  english: 'Zoo',
  style: 'wei',
  axis: 'h',
  w: 4,
  h: 1,
  showEnglish: false,
  mirrorU: false,
  flipV: false,
}

function request(faces, options = {}) {
  return JSON.stringify({
    schemaVersion: 2,
    kind: 'calligraphyRequest',
    type: 'calligraphy.requestFace',
    id: options.id ?? 'calligraphy-req-1',
    sessionId: options.sessionId ?? 'session-1',
    revision: options.revision ?? 7,
    payload: {
      requestId: options.id ?? 'calligraphy-req-1',
      locale: options.locale ?? 'zh-CN',
      faces,
    },
  })
}

/* ---------------------------------------------------------------- manifest */

test('the manifest is the approved stacks, weights and italics, unversioned copy-paste', () => {
  assert.match(CALLIGRAPHY_FONT_VERSION, /^calligraphy-fonts\/\d+$/, 'a monotone manifest version')
  assert.equal(CALLIGRAPHY_LAST_RESORT_FAMILY, 'Noto Sans SC')
  const stacks = new Set()
  for (const style of APPROVED) {
    const face = CALLIGRAPHY_FONT_MANIFEST[style]
    const spec = CALLIGRAPHY_STYLES[style]
    assert.equal(face.style, style)
    assert.equal(face.family, spec.family, `${style}: the palette prints the manifest's stack`)
    assert.equal(face.weight, spec.weight, `${style}: the palette sets the manifest's weight`)
    assert.equal(face.italic, spec.italic, `${style}: the palette leans like the manifest`)
    // The approved families are the named ones in order; the generic tail is not a hand.
    assert.ok(face.families.length >= 3, `${style}: a stack of real faces`)
    assert.equal(face.families[0], face.family.split(',')[0].trim().replaceAll('"', ''))
    for (const generic of ['serif', 'sans-serif', 'cursive']) assert.ok(!face.families.includes(generic), `${style}: ${generic} is the fallback, not an approved hand`)
    assert.ok(['serif', 'sans-serif', 'cursive'].includes(face.fallback))
    assert.ok(!face.fallback.startsWith('"'), 'the fallback is the generic tail')
    stacks.add(face.family)
  }
  assert.equal(stacks.size, 6, 'each hand names its own stack, not one shared stack')
  assert.equal(CALLIGRAPHY_FONT_MANIFEST.kai.families[0], 'KaiTi')
  assert.equal(CALLIGRAPHY_FONT_MANIFEST.xing.italic, true, '行书 is the one leaning hand')
  assert.equal(CALLIGRAPHY_FONT_MANIFEST.wei.weight, '700')
  assert.equal(CALLIGRAPHY_FONT_MANIFEST.hei.weight, '700')
  // The Unity texture cache keys on this exact string; a skew would serve stale pixels.
  const csharp = readFileSync(join(root, 'unity/Assets/StationDesigner/Runtime/App/Views/StationCalligraphyArtwork.cs'), 'utf8')
  const pinned = /public const string FontVersion = "([^"]+)"/.exec(csharp)
  assert.ok(pinned, 'StationCalligraphyArtwork.FontVersion exists')
  assert.equal(pinned[1], CALLIGRAPHY_FONT_VERSION,
    'the C# manifest version must equal CALLIGRAPHY_FONT_VERSION: bump both together')
})

test('resolution reports the face the environment could prove, and only then a miss', () => {
  // One approved family present: that is the face, even if the first is not.
  const wei = resolveCalligraphyFace('wei', (family) => ({
    checked: true,
    measured: family === 'STXinwei',
  }))
  assert.equal(wei.resolved, 'STXinwei')
  assert.equal(wei.missing, false)
  assert.equal(wei.detectable, true)
  StringAssertionContains(describeCalligraphyResolution(wei), 'style=wei face=STXinwei missing=0')

  // None present: the paint falls through to the deliberate last resort and says so.
  const missing = resolveCalligraphyFace('kai', ALL_MISSING)
  assert.equal(missing.resolved, '')
  assert.equal(missing.missing, true)
  assert.equal(missing.fallback, 'serif')
  StringAssertionContains(describeCalligraphyResolution(missing), 'face=fallback:serif missing=1')

  // `document.fonts.check` alone cannot prove a system face: report it as undetectable,
  // not as a miss (the painter must not claim what it cannot see).
  const checkOnly = resolveCalligraphyFace('li', () => ({ checked: true, measured: null }))
  assert.equal(checkOnly.resolved, 'LiSu', 'a check-only true names the first family')
  assert.equal(checkOnly.detectable, false)
  assert.equal(checkOnly.missing, false)

  // No probe at all (headless): no claim either way.
  const blind = resolveCalligraphyFace('song')
  assert.equal(blind.detectable, false)
  assert.equal(blind.missing, false)
  assert.equal(blind.resolved, '')
})

// A tiny local helper so the assertions read like the other suites without pulling
// in a matcher library.
function StringAssertionContains(value, needle) {
  assert.equal(value.includes(needle), true, `"${value}" should contain "${needle}"`)
}

/* ----------------------------------------------------------------- painting */

test('the painter draws the committed glyphs with the approved face, at the plate resolution', () => {
  const kai = surfaceFactory()
  const painted = paintCalligraphyFace({ ...FACE, style: 'kai' }, {
    createSurface: kai.factory,
    probe: ALL_PRESENT,
  })
  assert.equal(painted.key, FACE.key)
  assert.equal(painted.width, calligraphyPlate({ w: 4, h: 1 }).width)
  assert.equal(painted.height, calligraphyPlate({ w: 4, h: 1 }).height)
  const words = kai.created[0].record.words.map(word => word.text)
  assert.deepEqual([...new Set(words)], ['动', '物', '园'], 'one print per character, never the panel text as one run')
  assert.equal(kai.created[0].record.fonts.length > 0, true, 'the painter set a font')
  for (const font of kai.created[0].record.fonts) {
    assert.match(font, /400 \d+(?:\.\d+)?px "KaiTi", "STKaiti"/, `楷书 prints its own stack: ${font}`)
  }
  // The plate's pixels are the panel's metres at `PX_PER_METRE`, not a preview size.
  assert.equal(kai.created[0].record.width, 4 * PX_PER_METRE)
  assert.equal(kai.created[0].record.height, PX_PER_METRE)

  const wei = surfaceFactory()
  paintCalligraphyFace({ ...FACE, style: 'wei' }, { createSurface: wei.factory, probe: ALL_PRESENT })
  for (const font of wei.created[0].record.fonts) assert.match(font, /^700 \d/, `魏碑 is bold: ${font}`)
  assert.match(wei.created[0].record.fonts[0], /"STXinwei"/)

  const xing = surfaceFactory()
  paintCalligraphyFace({ ...FACE, style: 'xing', axis: 'v', h: 2.6 }, { createSurface: xing.factory, probe: ALL_PRESENT })
  for (const font of xing.created[0].record.fonts) assert.match(font, /^italic 400 \d/, `行书 leans: ${font}`)
  assert.match(xing.created[0].record.fonts[0], /"STXingkai"/)
})

test('the English line prints only when the module opts in', () => {
  const without = surfaceFactory()
  paintCalligraphyFace({ ...FACE, showEnglish: false }, { createSurface: without.factory, probe: ALL_PRESENT })
  assert.equal(without.created[0].record.words.some(word => word.text === 'Zoo'), false, 'no gloss without the opt-in')

  const withEnglish = surfaceFactory()
  paintCalligraphyFace({ ...FACE, showEnglish: true }, { createSurface: withEnglish.factory, probe: ALL_PRESENT })
  assert.equal(withEnglish.created[0].record.words.some(word => word.text === 'Zoo'), true, 'the opt-in prints the English name')
})

test('a mirrored or flipped plate is composed once before encoding', () => {
  const mirrored = surfaceFactory({ png: index => index === 1 ? 'b3JpZW50ZWQ=' : 'dW5vcmllbnRlZA==' })
  const painted = paintCalligraphyFace({ ...FACE, mirrorU: true }, { createSurface: mirrored.factory, probe: ALL_PRESENT })
  assert.equal(mirrored.created.length, 2, 'the mirror copies the painted plate onto a second surface')
  assert.deepEqual(mirrored.created[1].record.transforms, [
    { op: 'translate', x: 4 * PX_PER_METRE, y: 0 },
    { op: 'scale', x: -1, y: 1 },
  ])
  assert.equal(mirrored.created[1].record.images.length, 1, 'one draw of the painted plate')
  assert.equal(mirrored.created[1].record.images[0].image, mirrored.created[0].surface.image)
  assert.equal(painted.pngBase64, 'b3JpZW50ZWQ=', 'the encoded PNG is the oriented copy')
  assert.equal(painted.width, mirrored.created[0].record.width, 'orientation never changes the plate size')

  const flipped = surfaceFactory()
  paintCalligraphyFace({ ...FACE, flipV: true }, { createSurface: flipped.factory, probe: ALL_PRESENT })
  assert.deepEqual(flipped.created[1].record.transforms, [
    { op: 'translate', x: 0, y: PX_PER_METRE },
    { op: 'scale', x: 1, y: -1 },
  ])

  // A surface with no drawable cannot be oriented: report it, never ship the wrong plate.
  const blind = surfaceFactory({ noImage: true })
  const unsupported = paintCalligraphyFace({ ...FACE, flipV: true }, { createSurface: blind.factory, probe: ALL_PRESENT })
  assert.equal(unsupported.reason, 'unsupported')
  assert.equal(unsupported.detail, 'orientation')
})

test('a hand the machine does not have still paints, but is reported missing', () => {
  const factory = surfaceFactory()
  const painted = paintCalligraphyFace({ ...FACE, style: 'li' }, { createSurface: factory.factory, probe: ALL_MISSING })
  assert.equal('reason' in painted, false, 'the fallback still produces an inscription')
  assert.equal(painted.resolution.missing, true)
  assert.equal(painted.resolution.resolved, '')
  assert.equal(factory.created[0].record.words.length > 0, true, 'the last resort still prints the characters')
})

/* --------------------------------------------------------------------- port */

test('the port ignores every message it does not own', () => {
  const port = createCalligraphyFacePort({ send: () => '', createSurface: surfaceFactory().factory, ensureFonts: async () => true })
  try {
    assert.equal(isCalligraphyRequest(request([FACE])), true)
    assert.equal(isCalligraphyRequest(JSON.stringify({ schemaVersion: 2, kind: 'signRequest', type: 'sign.requestFace', payload: {} })), false)
    assert.equal(isCalligraphyRequest('{'), false)
    assert.equal(isCalligraphyRequest(null), false)
    assert.equal(port.receive(JSON.stringify({ schemaVersion: 2, kind: 'signRequest', payload: {} })), false)
    assert.equal(port.receive('{'), false)
    assert.equal(port.receive(null), false)
    assert.equal(port.receive(JSON.stringify({ schemaVersion: 2, kind: 'calligraphyRequest', payload: {} })), true,
      'a calligraphy request with no faces is consumed, not forwarded to the reducer')
  } finally {
    port.dispose()
  }
})

test('the port answers one request with bounded chunked PNGs and a completion', async () => {
  const sent = []
  const png = 'A'.repeat(2500)
  const chunkSize = 1024
  const factory = surfaceFactory({ png })
  const port = createCalligraphyFacePort({
    send: (type, payload) => { sent.push({ type, payload }); return '' },
    createSurface: factory.factory,
    ensureFonts: async () => true,
    probeFonts: ALL_PRESENT,
    locale: () => 'zh-CN',
    chunkSize,
  })
  try {
    assert.equal(port.chunkSize, chunkSize, 'the slice size is the shell\'s (clamped to at least 1 KiB)')
    assert.equal(port.fontVersion, CALLIGRAPHY_FONT_VERSION)
    // Two identical keys are one plate: one paint, one painted record.
    port.receive(request([FACE, { ...FACE }]))
    await port.whenIdle()
    const chunks = sent.filter(message => message.type === 'calligraphy.faceChunk')
    const ready = sent.filter(message => message.type === 'calligraphy.faceReady')
    assert.equal(ready.length, 1, 'one completion per request')
    assert.equal(chunks.length, Math.ceil(png.length / chunkSize), `a ${png.length}-character PNG is ${Math.ceil(png.length / chunkSize)} slices`)
    assert.equal(factory.created.length, 1, 'the repeated key painted once')
    for (const [index, chunk] of chunks.entries()) {
      assert.equal(chunk.payload.requestId, 'calligraphy-req-1')
      assert.equal(chunk.payload.revision, 7)
      assert.equal(chunk.payload.sessionId, 'session-1')
      assert.equal(chunk.payload.key, FACE.key, 'the key is opaque and echoed verbatim')
      assert.equal(chunk.payload.index, index)
      assert.equal(chunk.payload.count, chunks.length)
      assert.equal(chunk.payload.width, 4 * PX_PER_METRE)
      assert.equal(chunk.payload.height, PX_PER_METRE)
    }
    assert.equal(chunks.map(chunk => chunk.payload.data).join(''), png, 'the slices reassemble to the encoded PNG')
    const payload = ready[0].payload
    assert.equal(payload.requestId, 'calligraphy-req-1')
    assert.equal(payload.manifestVersion, CALLIGRAPHY_FONT_VERSION, 'every completion names the manifest it painted under')
    assert.equal(payload.artReady, true)
    assert.deepEqual(payload.pending, [])
    assert.equal(payload.painted.length, 1)
    assert.equal(payload.painted[0].resolvedFamily, 'STXinwei', '魏碑 reports the face it actually used')
    assert.equal(payload.painted[0].missingFace, false)
    assert.equal(payload.painted[0].chunks, Math.ceil(png.length / chunkSize))
    assert.match(payload.painted[0].resolution, /style=wei face=STXinwei/)
  } finally {
    port.dispose()
  }
})

test('a request is bounded to the provider batch size', async () => {
  const sent = []
  const factory = surfaceFactory()
  const port = createCalligraphyFacePort({
    send: (type, payload) => { sent.push({ type, payload }); return '' },
    createSurface: factory.factory,
    ensureFonts: async () => true,
    probeFonts: ALL_PRESENT,
  })
  try {
    const faces = Array.from({ length: CALLIGRAPHY_FACE_REQUEST_MAX + 8 }, (_, index) => ({
      ...FACE, key: FACE.key + '#' + index, moduleId: 'module-' + index,
    }))
    port.receive(request(faces))
    await port.whenIdle()
    const ready = sent.find(message => message.type === 'calligraphy.faceReady')
    assert.equal(ready.payload.painted.length, CALLIGRAPHY_FACE_REQUEST_MAX,
      'one message never carries more than the provider batch bound')
    assert.equal(factory.created.length, CALLIGRAPHY_FACE_REQUEST_MAX)
  } finally {
    port.dispose()
  }
})

test('a face reported pending for fonts is never painted with a fallback glyph', async () => {
  const sent = []
  const factory = surfaceFactory()
  const port = createCalligraphyFacePort({
    send: (type, payload) => { sent.push({ type, payload }); return '' },
    createSurface: factory.factory,
    ensureFonts: async () => false,
    probeFonts: ALL_PRESENT,
  })
  try {
    port.receive(request([FACE]))
    await port.whenIdle()
    assert.equal(sent.filter(message => message.type === 'calligraphy.faceChunk').length, 0, 'no pixels on a font miss')
    const ready = sent.find(message => message.type === 'calligraphy.faceReady')
    assert.equal(ready.payload.artReady, false, 'an answered request is not necessarily final art')
    assert.deepEqual(ready.payload.pending.map(face => face.reason), ['font'])
    assert.equal(factory.created.length, 0, 'nothing was rasterised')
  } finally {
    port.dispose()
  }
})

test('in-flight work is deduplicated by key across requests, and only in flight', async () => {
  const sent = []
  const factory = surfaceFactory()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const port = createCalligraphyFacePort({
    send: (type, payload) => { sent.push({ type, payload }); return '' },
    createSurface: factory.factory,
    ensureFonts: () => gate.then(() => true),
    probeFonts: ALL_PRESENT,
  })
  try {
    port.receive(request([FACE], { id: 'calligraphy-req-a' }))
    port.receive(request([FACE], { id: 'calligraphy-req-b' }))
    release(true)
    await port.whenIdle()
    const ready = sent.filter(message => message.type === 'calligraphy.faceReady')
    assert.deepEqual(ready.map(message => message.payload.requestId).sort(), ['calligraphy-req-a', 'calligraphy-req-b'],
      'both requests are completed, each under its own id')
    assert.equal(ready.every(message => message.payload.painted.length === 1), true)
    assert.equal(factory.created.length, 1, 'the second request awaited the first paint instead of rasterising twice')
    assert.equal(sent.filter(message => message.type === 'calligraphy.faceChunk').length, 2,
      'each request still receives its own chunked pixels')
    // Deduplication is in-flight only: a later request paints again (a fresh save can
    // legitimately re-ask after the C# cache was dropped).
    port.receive(request([FACE], { id: 'calligraphy-req-c' }))
    await port.whenIdle()
    assert.equal(factory.created.length, 2)
  } finally {
    port.dispose()
  }
})

test('the request parser normalises legacy axes and hands like the source', () => {
  const facts = calligraphyFaceFactsOf({ key: 'k', w: '3', h: '1', text: '动物园', style: 'nonsense', axis: 'x' })
  assert.equal(facts.style, 'kai', 'an unknown hand is 楷书')
  assert.equal(facts.axis, 'h', 'an unknown axis is 横排')
  assert.equal(facts.w, 3)
  assert.equal(calligraphyFaceFactsOf({ id: 'legacy-id', w: 1, h: 1 }).key, 'legacy-id', 'a legacy record may carry id instead of key')
  assert.equal(calligraphyFaceFactsOf({ key: 'k', w: 0, h: 1 }), null, 'a panel with no width is unusable')
  assert.equal(calligraphyFaceFactsOf({ w: 1, h: 1 }), null, 'a face with no key cannot be matched to a plate')
})
