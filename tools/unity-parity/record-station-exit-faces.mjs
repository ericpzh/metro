// Record the exit-fascia and guidepost-plate artwork the shipping painters print for
// the committed Zoo document (plan 16 §5.3).
//
// The Unity packet never paints: `exitFaceProvider.ts` composes the source's own
// `exitHeaderCanvas` / `guideFace` / `guideEnglishFace` / `guideExitLetterFace` and sends
// the PNG. This recorder runs that painter in a real browser (headless Chrome via
// `tools/browser-harness.mjs`, served by Vite so the TypeScript is the shipping source),
// for the Zoo identity and for the rename/locale variants the EditMode test asserts.
//
// It writes:
//   `.preview/unity/exit-faces/*.png`                       one PNG per printed plate
//   `.preview/unity/exit-faces/evidence.json`               the facts, keys, sha256 and ink
//   `unity/Assets/StationDesigner/Tests/EditMode/station-exit-faces-oracle.json`
//                                                           the EditMode fixture (base64)
//
// The fixture's `key` is the **same content hash C# mints** (`ExitFaceFacts.KeyOf`), so a
// passing EditMode bind proves the two sides agree on the plate identity, not just that a
// texture arrived.
//
// Usage: node tools/unity-parity/record-station-exit-faces.mjs [--check]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPage, waitFor } from '../browser-harness.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const gameDir = join(root, 'game')
const pageName = 'exit-face-fixture.tmp.html'
const pagePath = join(gameDir, pageName)
const outDir = join(root, '.preview/unity/exit-faces')
const oraclePath = join(root, 'unity/Assets/StationDesigner/Tests/EditMode/station-exit-faces-oracle.json')

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>exit face fixture</title></head>
<body><script type="module">
import { paintExitFace } from '/src/unity-web/exitFaceProvider.ts'
window.__paintExitFace = facts => paintExitFace(facts)
const warm = async () => {
  if (document.fonts) {
    // The source painters set 256 px faces; a cold page that paints before the CJK
    // family is in hand rasterises a fallback glyph and the PNG bytes drift.
    for (const font of ['16px "Microsoft YaHei"', '30px "Microsoft YaHei"', '256px "Microsoft YaHei"',
      'bold 256px "Microsoft YaHei"', '16px Arial', 'bold 40px Arial']) {
      await document.fonts.load(font).catch(() => {})
    }
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 256
    const g = canvas.getContext('2d')
    g.font = 'bold 256px "Microsoft YaHei"'
    g.fillText('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789动物园站出入口', 0, 200)
    await document.fonts.ready
  }
  window.__fontsReady = document.fonts ? document.fonts.check('bold 256px "Microsoft YaHei"') : true
  window.__ready = true
}
warm()
</script></body></html>
`

/** `ExitFaceFacts.KeyOf`'s content text, field for field (plan 16 §5.3). */
function keyText(facts) {
  const number = value => String(Number(Number(value).toFixed(4)))
  const lines = []
  let text = 'exit-face/1'
  text += '\npainter=' + facts.painter
  text += '\nstation=' + (facts.station ?? '')
  text += '\nstationEn=' + (facts.stationEn ?? '')
  text += '\ncity=' + (facts.city ?? '')
  text += '\nexit=' + (facts.exitName ?? '')
  text += '\nexitId=' + (facts.exitId ?? '')
  text += '\nexitFound=' + (facts.exitFound === false ? '0' : '1')
  text += '\nlocale=' + (facts.locale ?? '')
  text += '\npixels=' + facts.pixels + 'x' + facts.pixelsHigh
  text += '\nplate=' + number(facts.width) + 'x' + number(facts.height)
  if (facts.painter === 'exitHeader') {
    for (const line of facts.lines ?? []) lines.push(`${line.id ?? ''}/${line.name ?? ''}/${line.nameEn ?? ''}/${line.colour ?? ''}`)
    lines.sort()
    text += '\nlines=' + lines.join(';')
  }
  return text
}

const contentKey = facts => createHash('sha256').update(keyText(facts), 'utf8').digest('hex')

/** The evidence row for one recorded plate, without the bulk base64. */
function fileOf(row) {
  if (!row) return null
  return {
    id: row.id,
    painter: row.facts.painter,
    moduleId: row.facts.moduleId,
    plateMetres: [row.facts.width, row.facts.height],
    pixels: [row.width, row.height],
    key: row.key,
    sha256: row.sha256,
    ink: Number(row.ink.toFixed(6)),
    png: join(outDir, row.png),
  }
}

function zooFacts() {
  const save = JSON.parse(readFileSync(join(root, 'unity/Assets/StationDesigner/Demos/zoo.metro.json'), 'utf8'))
  const modules = save.static.modules ?? []
  const lines = (save.static.lines ?? [])
    .map(line => ({ id: line.id ?? '', name: line.name ?? '', nameEn: line.nameEn ?? '', colour: line.colour ?? '' }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const exits = new Map(modules.filter(module => module.type === 'exit').map(module => [module.id, module]))
  const base = {
    station: save.name ?? '',
    stationEn: save.nameEn ?? '',
    city: save.city ?? '',
    lines,
  }
  const header = (exit, exitName, locale = 'zh-CN') => ({
    ...base,
    moduleId: exit.id,
    recordType: 'exit',
    painter: 'exitHeader',
    pixels: 0,
    pixelsHigh: 0,
    width: 3.7,
    height: 0.5,
    exitName,
    exitId: exit.id,
    exitFound: true,
    locale,
  })
  const guide = (guidepost, exit, painter, pixels, pixelsHigh, width, height, locale = 'zh-CN') => ({
    ...base,
    moduleId: guidepost.id,
    recordType: 'guidepost',
    painter,
    pixels,
    pixelsHigh,
    width,
    height,
    exitName: exit ? exit.cfg.name || '' : '',
    exitId: guidepost.cfg.exitId || '',
    exitFound: Boolean(exit),
    locale,
  })
  const exitC = exits.get('exit-uncovered-2-258')
  const exitB = exits.get('exit-uncovered-2-398')
  const guidepostC = modules.find(module => module.id === 'guidepost-399')
  const guidepostB = modules.find(module => module.id === 'guidepost-400')
  const renamed = { ...exitC, id: 'exit-uncovered-2-258', cfg: { ...exitC.cfg, name: 'D' } }
  return {
    station: { name: save.name ?? '', nameEn: save.nameEn ?? '', city: save.city ?? '' },
    exitC, exitB, guidepostC, guidepostB, renamed,
    rows: [
      { id: 'zoo-exit-258-header-c', facts: header(exitC, exitC.cfg.name) },
      { id: 'zoo-exit-398-header-b', facts: header(exitB, exitB.cfg.name) },
      { id: 'zoo-guidepost-399-station-upper', facts: guide(guidepostC, exitC, 'guideStationUpper', 256, 277, 0.268972, 0.54) },
      { id: 'zoo-guidepost-399-station-rear', facts: guide(guidepostC, exitC, 'guideStationRear', 256, 993, 0.1392304, 0.54) },
      { id: 'zoo-guidepost-399-exit-letter', facts: guide(guidepostC, exitC, 'guideExitLetter', 256, 256, 0.18, 0.18) },
      // The third (rear) triangular face carries a narrower square plate: the source's
      // `min(squareSize, edge * .7)` rule, 0.0975 m rather than 0.18 m.
      { id: 'zoo-guidepost-399-exit-letter-rear', facts: guide(guidepostC, exitC, 'guideExitLetter', 256, 256, 0.09746128, 0.09746128) },
      { id: 'zoo-guidepost-400-station-upper', facts: guide(guidepostB, exitB, 'guideStationUpper', 256, 277, 0.268972, 0.54) },
      { id: 'zoo-guidepost-400-station-rear', facts: guide(guidepostB, exitB, 'guideStationRear', 256, 993, 0.1392304, 0.54) },
      { id: 'zoo-guidepost-400-exit-letter', facts: guide(guidepostB, exitB, 'guideExitLetter', 256, 256, 0.18, 0.18) },
      { id: 'zoo-guidepost-400-exit-letter-rear', facts: guide(guidepostB, exitB, 'guideExitLetter', 256, 256, 0.09746128, 0.09746128) },
      { id: 'rename-exit-258-header-d', facts: header(renamed, 'D') },
      { id: 'rename-guidepost-399-station-upper-d', facts: guide(guidepostC, renamed, 'guideStationUpper', 256, 277, 0.268972, 0.54) },
      { id: 'rename-guidepost-399-station-rear-d', facts: guide(guidepostC, renamed, 'guideStationRear', 256, 993, 0.1392304, 0.54) },
      { id: 'rename-guidepost-399-exit-letter-d', facts: guide(guidepostC, renamed, 'guideExitLetter', 256, 256, 0.18, 0.18) },
      { id: 'rename-guidepost-399-exit-letter-rear-d', facts: guide(guidepostC, renamed, 'guideExitLetter', 256, 256, 0.09746128, 0.09746128) },
      { id: 'locale-en-exit-258-header-c', facts: header(exitC, exitC.cfg.name, 'en') },
      { id: 'locale-en-guidepost-399-exit-letter-c', facts: guide(guidepostC, exitC, 'guideExitLetter', 256, 256, 0.18, 0.18, 'en') },
      { id: 'locale-en-guidepost-399-exit-letter-rear-c', facts: guide(guidepostC, exitC, 'guideExitLetter', 256, 256, 0.09746128, 0.09746128, 'en') },
    ],
  }
}

async function main() {
  const check = process.argv.includes('--check')
  const fixture = zooFacts()
  mkdirSync(outDir, { recursive: true })

  // Vite serves game/ so the page can import the shipping TypeScript directly.
  const { createServer } = await import(new URL('../../game/node_modules/vite/dist/node/index.js', import.meta.url).href)
  writeFileSync(pagePath, PAGE)
  const server = await createServer({
    root: gameDir,
    configFile: false,
    logLevel: 'silent',
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
  })
  await server.listen()
  const url = server.resolvedUrls.local[0].replace(/\/$/, '') + '/' + pageName
  const rows = []
  let page
  try {
    page = await withPage({
      url,
      profile: join(outDir, 'chrome-profile'),
      debugPort: 9343,
      windowSize: '900,700',
    })
    // The tab is opened on a URL that Vite rewrites while it transforms the page; wait for
    // the module to have run (and its font warm-up to finish) before evaluating.
    await waitFor(page.evaluate, 'window.__ready === true', { tries: 160, every: 250, what: 'the exit-face fixture page' })
    const fonts = await page.evaluate('({ ready: window.__fontsReady, check: document.fonts ? document.fonts.check(\'bold 256px "Microsoft YaHei"\') : true })')
    if (!fonts || fonts.check !== true) throw new Error('the CJK face did not load in the recorder page: ' + JSON.stringify(fonts))
    for (const row of fixture.rows) {
      const key = contentKey(row.facts)
      const facts = { ...row.facts, key }
      const paint = async () => {
        const painted = await page.evaluate(`(async () => {
          const facts = ${JSON.stringify(facts)}
          return await window.__paintExitFace(facts)
        })()`)
        if (!painted || !painted.pngBase64) throw new Error(row.id + ': the painter returned no PNG: ' + JSON.stringify(painted))
        const bytes = Buffer.from(painted.pngBase64, 'base64')
        return { painted, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
      }
      const first = await paint()
      // A plate recorded while the CJK family was still landing rasterises a fallback
      // glyph; the fixture must be a stable print, so the same facts are painted twice.
      const again = await paint()
      if (first.sha256 !== again.sha256) {
        throw new Error(row.id + ': the painter is not deterministic (' + first.sha256.slice(0, 12) + ' vs ' + again.sha256.slice(0, 12) + ')')
      }
      const { painted, bytes, sha256 } = first
      const pngName = row.id + '.png'
      // A check run must leave the pinned fixture and its evidence images as one set.
      if (!check) writeFileSync(join(outDir, pngName), bytes)
      rows.push({
        id: row.id,
        facts,
        key,
        width: painted.width,
        height: painted.height,
        ink: painted.ink,
        locale: painted.locale,
        sha256,
        bytes: bytes.length,
        png: pngName,
        pngBase64: painted.pngBase64,
      })
    }
  } finally {
    if (page) await page.close()
    await server.close()
    rmSync(pagePath, { force: true })
  }

  const oracle = {
    format: 'metro-station-exit-faces',
    formatVersion: 1,
    source: 'tools/unity-parity/record-station-exit-faces.mjs',
    station: fixture.station,
    rows,
  }
  const byId = new Map(rows.map(row => [row.id, row]))
  const identity = {
    exits: [
      {
        exitId: 'exit-uncovered-2-258', letter: 'C', guidepostId: 'guidepost-399',
        fascia: fileOf(byId.get('zoo-exit-258-header-c')),
        guidepostLetter: fileOf(byId.get('zoo-guidepost-399-exit-letter')),
        guidepostStationFace: fileOf(byId.get('zoo-guidepost-399-station-upper')),
      },
      {
        exitId: 'exit-uncovered-2-398', letter: 'B', guidepostId: 'guidepost-400',
        fascia: fileOf(byId.get('zoo-exit-398-header-b')),
        guidepostLetter: fileOf(byId.get('zoo-guidepost-400-exit-letter')),
        guidepostStationFace: fileOf(byId.get('zoo-guidepost-400-station-upper')),
      },
    ],
    rename: {
      exitId: 'exit-uncovered-2-258', before: 'C', after: 'D',
      fascia: {
        before: fileOf(byId.get('zoo-exit-258-header-c')),
        after: fileOf(byId.get('rename-exit-258-header-d')),
        keyChanged: byId.get('zoo-exit-258-header-c').key !== byId.get('rename-exit-258-header-d').key,
        pixelsChanged: byId.get('zoo-exit-258-header-c').sha256 !== byId.get('rename-exit-258-header-d').sha256,
      },
      guidepostLetter: {
        before: fileOf(byId.get('zoo-guidepost-399-exit-letter')),
        after: fileOf(byId.get('rename-guidepost-399-exit-letter-d')),
        keyChanged: byId.get('zoo-guidepost-399-exit-letter').key !== byId.get('rename-guidepost-399-exit-letter-d').key,
        pixelsChanged: byId.get('zoo-guidepost-399-exit-letter').sha256 !== byId.get('rename-guidepost-399-exit-letter-d').sha256,
      },
    },
    locale: {
      from: 'zh-CN', to: 'en',
      fascia: {
        zh: fileOf(byId.get('zoo-exit-258-header-c')),
        en: fileOf(byId.get('locale-en-exit-258-header-c')),
        keyChanged: byId.get('zoo-exit-258-header-c').key !== byId.get('locale-en-exit-258-header-c').key,
        // The Guangzhou fascia's copy is bilingual by construction (`printed_*` strings and
        // the hardcoded zh station suffix), so the reprint is a fresh upload of the same ink.
        pixelsIdentical: byId.get('zoo-exit-258-header-c').sha256 === byId.get('locale-en-exit-258-header-c').sha256,
      },
      guidepostLetter: {
        zh: fileOf(byId.get('zoo-guidepost-399-exit-letter')),
        en: fileOf(byId.get('locale-en-guidepost-399-exit-letter-c')),
        keyChanged: byId.get('zoo-guidepost-399-exit-letter').key !== byId.get('locale-en-guidepost-399-exit-letter-c').key,
        pixelsIdentical: byId.get('zoo-guidepost-399-exit-letter').sha256 === byId.get('locale-en-guidepost-399-exit-letter-c').sha256,
      },
    },
  }
  if (!check) writeFileSync(join(outDir, 'evidence.json'), JSON.stringify({
    ...oracle,
    rows: rows.map(({ pngBase64, ...row }) => row),
    identity,
  }, null, 2))
  const fixtureText = JSON.stringify(oracle, null, 1)
  if (check) {
    if (!existsSync(oraclePath)) {
      console.error('station-exit-faces-oracle.json is missing; run without --check')
      process.exitCode = 1
      return
    }
    // The identity (facts + content keys) must match exactly: a changed dependency is a
    // stale fixture. The rasterised PNG bytes are environment-sensitive (headless Chrome
    // font/canvas antialiasing varies by host), so a byte drift is reported, not failed:
    // the EditMode test compares the plate it applies against the pinned bytes, and the
    // painter's words are pinned deterministically by `unity/tests/exit-face.test.mjs`.
    const existing = JSON.parse(readFileSync(oraclePath, 'utf8'))
    const identity = rows => JSON.stringify(rows.map(({ id, key, facts }) => ({ id, key, facts })))
    if (identity((existing.rows ?? [])) !== identity(rows)) {
      console.error('station-exit-faces-oracle.json is stale (facts or content keys changed); re-run without --check')
      process.exitCode = 1
      return
    }
    const drifted = []
    for (const row of rows) {
      const before = (existing.rows ?? []).find(value => value.id === row.id)
      if (before && before.sha256 !== row.sha256) drifted.push(row.id)
    }
    if (drifted.length > 0) {
      console.warn('exit-face PNG bytes differ on this host (pinned fixture kept): ' + drifted.join(', '))
    }
  } else {
    writeFileSync(oraclePath, fixtureText)
  }
  const summary = rows.map(row => `${row.id}=${row.width}x${row.height}/${row.ink.toFixed(3)} ${row.sha256.slice(0, 12)}`).join(' ')
  console.log(`EXIT_FACES_OK ${rows.length} plates ${summary}`)
  console.log(`fixture ${oraclePath}`)
  console.log(`evidence ${join(outDir, 'evidence.json')}`)
}

await main()
