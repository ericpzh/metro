// Plan 16 §5.3 — the street exit fascia and the guidepost plates print the committed
// identity, through the shipping painters.
//
// Two things are pinned here, and they fail independently:
//
//  1. **The painter.** The source's own `exitHeaderCanvas` / `guideFace` /
//     `guideEnglishFace` / `guideExitLetterFace` are driven through a recording 2D context
//     with the Zoo document's facts, so a rename (C → D) or a station name change is
//     visible in the painted words rather than assumed from a key.
//  2. **The port.** `createExitFacePort` answers only `exitFaceRequest`, chunks one PNG
//     per painted key, dedupes the two upper station faces onto one canvas, reports a
//     font wait as pending (never as blank art), and tells C# when the shell's print
//     language changed.
//
// Rasterised PNG evidence (the bytes the EditMode fixture applies) is recorded separately
// by `tools/unity-parity/record-station-exit-faces.mjs`; this file needs no browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { stubCanvas } from '../../game/test/support/stub-canvas.mjs'
import { exitHeaderCanvas } from '../../game/src/render/models/pieces/ExitModel.ts'
import { guideEnglishFace, guideExitLetterFace, guideFace } from '../../game/src/render/models/pieces/StreetDecorModel.ts'
import { getLanguage, setLanguage, t } from '../../game/src/sim/i18n.ts'
import {
  EXIT_FACE_REQUEST_MAX,
  createExitFacePort,
  guideExitLabel,
  isExitFaceRequest,
  paintExitFace,
} from '../../game/src/unity-web/exitFaceProvider.ts'

/* ---------------------------------------------------------------- canvas shim */

/**
 * A `document.createElement('canvas')` shim over `stub-canvas`, recording each canvas's
 * drawing ops. The source painters create their own canvases; the port composes them onto
 * the surface it is given, so a test can read which words were set where.
 */
function installCanvasDocument() {
  const previous = globalThis.document
  const canvases = []
  globalThis.document = {
    documentElement: { lang: 'zh-CN' },
    createElement(tag) {
      if (tag !== 'canvas') return {}
      let context = null
      let ops = null
      const canvas = {
        width: 300,
        height: 150,
        getContext() {
          if (!context) {
            const stub = stubCanvas(canvas.width, canvas.height)
            context = stub.g
            ops = stub.ops
            context.canvas = canvas
          }
          return context
        },
        toDataURL() {
          return 'data:image/png;base64,AAAA'
        },
      }
      Object.defineProperty(canvas, 'recorded', { get: () => ops })
      canvases.push(canvas)
      return canvas
    },
  }
  return {
    canvases,
    lastOps() {
      for (let i = canvases.length - 1; i >= 0; i--) if (canvases[i].recorded) return canvases[i].recorded
      return null
    },
    restore() {
      if (previous === undefined) delete globalThis.document
      else globalThis.document = previous
    },
  }
}

const LINES = [{ id: '5', name: '5号线', nameEn: 'Line 5', colour: '#c70541' }]

const FACTS = {
  key: 'key-c',
  moduleId: 'exit-uncovered-2-258',
  recordType: 'exit',
  painter: 'exitHeader',
  pixels: 0,
  pixelsHigh: 0,
  width: 3.7,
  height: 0.5,
  station: '动物园',
  stationEn: 'Zoo',
  city: 'guangzhou',
  exitName: 'C',
  exitId: 'exit-uncovered-2-258',
  exitFound: true,
  lines: LINES,
  locale: 'zh-CN',
}

function withCanvas(run) {
  const shim = installCanvasDocument()
  try {
    return run(shim)
  } finally {
    shim.restore()
    setLanguage('zh-CN')
  }
}

/* ---------------------------------------------------------------- the painter */

test('the exit fascia prints the exit letter, the station and its English name', () => {
  withCanvas(shim => {
    const canvas = exitHeaderCanvas('动物园', 'C', 'Zoo', 512, { cityStyle: 'guangzhou', lines: LINES }, 1)
    assert.equal(canvas.width, 512)
    assert.equal(canvas.height, 96)
    const words = shim.lastOps().words.map(word => word.text)
    assert.ok(words.includes('C'), 'the exit identifier prints: ' + JSON.stringify(words))
    assert.ok(words.includes('动物园站'), 'the station label prints (站 appended by the source)')
    assert.ok(words.includes('Zoo'), 'the English station name prints')
    assert.ok(words.includes('Guangzhou Metro'), 'the city brand prints')
    assert.ok(words.includes('Entrance'), 'the fixed English entrance caption prints')

    // A different saved `cfg.name` is a different print, not the same placeholder.
    const renamed = exitHeaderCanvas('动物园', 'D', 'Zoo', 512, { cityStyle: 'guangzhou', lines: LINES }, 1)
    const renamedWords = shim.lastOps().words.map(word => word.text)
    assert.ok(renamedWords.includes('D'), 'the renamed identifier prints')
    assert.ok(!renamedWords.includes('C'), 'the old letter is gone')
    assert.notEqual(renamed, canvas)
  })
})

test('the exit fascia follows the city painter and its own resolution', () => {
  withCanvas(shim => {
    // Chengdu prints the source's 4× canvas (`exitHeaderScale`), and its own layout.
    const resolution = { width: 2048, height: 384 }
    const canvas = exitHeaderCanvas('动物园', 'C', 'Zoo', 512, { cityStyle: 'chengdu', lines: LINES }, resolution.width / 512)
    assert.equal(canvas.width, resolution.width)
    assert.equal(canvas.height, resolution.height)
    const words = shim.lastOps().words.map(word => word.text)
    assert.ok(words.includes('动物园站'), 'the station still prints on the city fascia')
    assert.ok(words.includes('5号线') && words.includes('Line 5'), 'Chengdu prints the live line badges')
    assert.ok(!words.includes('Guangzhou Metro'), 'the guangzhou brand is gone: ' + JSON.stringify(words))
  })
})

test('the guidepost letter plate prints the linked exit and the station face follows a rename', () => {
  withCanvas(shim => {
    const letter = guideExitLetterFace('C')
    assert.deepEqual([letter.width, letter.height], [256, 256])
    assert.deepEqual(shim.lastOps().words.map(word => word.text), ['C'], 'the square plate is the exit letter')

    const station = guideFace('动物园', 'C')
    assert.deepEqual([station.width, station.height], [256, 2048])
    assert.deepEqual(shim.lastOps().words.map(word => word.text), ['动', '物', '园'], 'the station face sets one glyph per slot')

    const renamed = guideFace('动物园', 'D')
    assert.deepEqual([renamed.width, renamed.height], [256, 2048], 'the station face geometry is unchanged by the letter')
    assert.deepEqual(shim.lastOps().words.map(word => word.text), ['动', '物', '园'])

    const rear = guideEnglishFace('Zoo')
    assert.deepEqual(shim.lastOps().words.map(word => word.text), ['Zoo'], 'the rear face is the English station name')
    assert.ok(shim.lastOps().rotations.some(angle => Math.abs(angle - Math.PI / 2) < 1e-6), 'the rear face reads downwards')
  })
})

test('the guidepost resolves its link through guideLabels, with the source fallback', () => {
  withCanvas(() => {
    assert.equal(guideExitLabel({ ...FACTS, painter: 'guideExitLetter', exitName: 'C' }), 'C')
    // `guideLabels` strips the Chinese suffix a saved exit name may carry.
    assert.equal(guideExitLabel({ ...FACTS, painter: 'guideExitLetter', exitName: 'C出入口' }), 'C')
    // A saved exit with an empty name prints nothing (the source's own branch) …
    assert.equal(guideExitLabel({ ...FACTS, painter: 'guideExitLetter', exitName: '', exitFound: true }), '')
    // … while a link that names no saved exit falls through to the locale fallback.
    for (const locale of ['zh-CN', 'en']) {
      setLanguage(locale)
      assert.equal(guideExitLabel({ ...FACTS, painter: 'guideExitLetter', exitName: '', exitId: 'gone', exitFound: false }), t('entrance'), locale)
    }
    setLanguage('zh-CN')
  })
})

test('the port paints a plate at the source resolution and the guidepost plate at its baked pixels', () => {
  withCanvas(() => {
    const surface = (width, height) => {
      const stub = stubCanvas(width, height)
      return { width, height, context: stub.g, pngBase64: () => 'ZmFrZQ==' }
    }
    const header = paintExitFace({ ...FACTS, key: 'header-c' }, { createSurface: surface })
    assert.equal(header.width, 512, 'guangzhou fascia width')
    assert.equal(header.height, 96)
    assert.equal(header.painter, 'exitHeader')
    assert.equal(header.pngBase64, 'ZmFrZQ==')

    const upper = paintExitFace({ ...FACTS, key: 'upper', painter: 'guideStationUpper', pixels: 256, pixelsHigh: 277 }, { createSurface: surface })
    assert.equal(upper.width, 256)
    assert.equal(upper.height, 277)
    const letter = paintExitFace({ ...FACTS, key: 'letter', painter: 'guideExitLetter', pixels: 256, pixelsHigh: 256 }, { createSurface: surface })
    assert.equal(letter.width, 256)
    assert.equal(letter.height, 256)

    // A guidepost plate with no baked pixel size cannot be composed onto the UV mapping.
    const unknown = paintExitFace({ ...FACTS, key: 'nopixels', painter: 'guideExitLetter', pixels: 0, pixelsHigh: 0 }, { createSurface: surface })
    assert.equal(unknown.reason, 'unsupported')
    assert.equal(unknown.detail, 'pixels')
  })
})

/* ---------------------------------------------------------------- the port */

function fakeSurface() {
  return (width, height) => {
    const stub = stubCanvas(width, height)
    return { width, height, context: stub.g, pngBase64: () => 'ZmFrZQ==' }
  }
}

function request(faces, options = {}) {
  return JSON.stringify({
    schemaVersion: 2,
    kind: 'exitFaceRequest',
    type: 'exit.requestFace',
    id: 'exit-req-1',
    sessionId: options.sessionId ?? 'session-1',
    revision: options.revision ?? 7,
    payload: { requestId: 'exit-req-1', locale: options.locale ?? 'zh-CN', faces },
  })
}

const upperFacts = { ...FACTS, key: 'upper', moduleId: 'guidepost-399', recordType: 'guidepost', painter: 'guideStationUpper', pixels: 256, pixelsHigh: 277 }
const rearFacts = { ...FACTS, key: 'rear', moduleId: 'guidepost-399', recordType: 'guidepost', painter: 'guideStationRear', pixels: 256, pixelsHigh: 993, exitName: 'C' }

test('the port answers one exitFaceRequest with one chunked PNG per painted key', async () => {
  await withCanvasAsync(async () => {
    const sent = []
    const port = createExitFacePort({
      send: (type, payload) => { sent.push({ type, payload }); return '' },
      createSurface: fakeSurface(),
      ensureFonts: async () => true,
      locale: () => 'zh-CN',
      chunkSize: 4,
    })
    try {
      // The two upper station faces share a key: one canvas, one painted record.
      assert.equal(port.receive(request([upperFacts, { ...upperFacts }, rearFacts])), true)
      await port.whenIdle()
      const chunks = sent.filter(message => message.type === 'exit.faceChunk')
      const ready = sent.filter(message => message.type === 'exit.faceReady')
      assert.equal(ready.length, 1, 'one ready per request')
      const payload = ready[0].payload
      assert.equal(payload.requestId, 'exit-req-1')
      assert.equal(payload.revision, 7)
      assert.equal(payload.sessionId, 'session-1')
      assert.equal(payload.artReady, true)
      assert.deepEqual(payload.painted.map(face => face.key).sort(), ['rear', 'upper'], 'deduped by content key')
      assert.deepEqual(payload.pending, [])
      // `chunkSize` is clamped to at least 1 KiB, so each short fixture PNG is one chunk.
      assert.equal(chunks.length, 2, 'one painted plate, one chunk')
      for (const chunk of chunks) {
        assert.equal(chunk.payload.requestId, 'exit-req-1')
        assert.equal(chunk.payload.count, 1)
        assert.equal(typeof chunk.payload.painter, 'string')
        assert.ok(chunk.payload.width > 0 && chunk.payload.height > 0)
      }
    } finally {
      port.dispose()
    }
  })
})

test('the port ignores every other message shape', () => {
  const port = createExitFacePort({ send: () => '', createSurface: fakeSurface(), ensureFonts: async () => true })
  try {
    assert.equal(isExitFaceRequest(request([])), true)
    assert.equal(port.receive(JSON.stringify({ schemaVersion: 2, kind: 'signRequest', type: 'sign.requestFace', payload: {} })), false)
    assert.equal(port.receive('{'), false)
    assert.equal(port.receive(null), false)
    assert.equal(EXIT_FACE_REQUEST_MAX, 32)
  } finally {
    port.dispose()
  }
})

test('a missing CJK face is reported pending, never painted with a fallback glyph', async () => {
  await withCanvasAsync(async () => {
    const sent = []
    const port = createExitFacePort({
      send: (type, payload) => { sent.push({ type, payload }); return '' },
      createSurface: fakeSurface(),
      ensureFonts: async () => false,
    })
    try {
      port.receive(request([upperFacts]))
      await port.whenIdle()
      assert.equal(sent.filter(message => message.type === 'exit.faceChunk').length, 0, 'no pixels on a font miss')
      const ready = sent.find(message => message.type === 'exit.faceReady')
      assert.equal(ready.payload.artReady, false)
      assert.deepEqual(ready.payload.pending.map(face => face.reason), ['font'])
    } finally {
      port.dispose()
    }
  })
})

test('the port reports the shell language to C# once per change', async () => {
  await withCanvasAsync(async () => {
    const sent = []
    const port = createExitFacePort({
      send: (type, payload) => { sent.push({ type, payload }); return '' },
      createSurface: fakeSurface(),
      ensureFonts: async () => true,
      locale: () => getLanguage(),
    })
    try {
      assert.deepEqual(sent.filter(message => message.type === 'exit.locale').map(message => message.payload.locale), ['zh-CN'],
        'the initial print language is announced on registration')
      setLanguage('en')
      await Promise.resolve()
      await Promise.resolve()
      const locales = sent.filter(message => message.type === 'exit.locale').map(message => message.payload.locale)
      assert.deepEqual(locales, ['zh-CN', 'en'], 'one notice per real switch')
      // A temporary painter switch — the sign painter sets the global language while it
      // draws — must not look like a user switch. Painting an `en` plate on a zh shell
      // restores the language inside the same task, so the deferred notice is a no-op.
      const before = sent.filter(message => message.type === 'exit.locale').length
      setLanguage('zh-CN')
      await Promise.resolve()
      await Promise.resolve()
      const afterShell = sent.filter(message => message.type === 'exit.locale').length
      assert.equal(afterShell, before + 1, 'the real switch back to zh is announced')
      port.receive(request([{ ...upperFacts, locale: 'en' }], { locale: 'en' }))
      await port.whenIdle()
      await Promise.resolve()
      assert.equal(sent.filter(message => message.type === 'exit.locale').length, afterShell,
        'a painter-locale plate prints without a spurious shell notice')
    } finally {
      port.dispose()
      setLanguage('zh-CN')
    }
  })
})

async function withCanvasAsync(run) {
  const shim = installCanvasDocument()
  try {
    return await run(shim)
  } finally {
    shim.restore()
    setLanguage('zh-CN')
  }
}
