import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import localWorker from '../../tools/unity-web/local-worker.mjs'
import { attachUnityUI } from '../../tools/unity-web/unity-ui-pack.mjs'
import { stageUnityDeploy, validatePublicPack } from '../../tools/unity-web/stage-deploy.mjs'
import { benchmarkLanguagePath, initialLanguageForRoute, isBenchmarkPath, LANGUAGE_STORAGE_KEY } from '../../game/src/app/languageRoute.ts'

const repo = resolve(import.meta.dirname, '../..')

function createUnityMockEnv(assetPrefix = '/game/unity') {
  const html = '<!DOCTYPE html><html lang="en-us"><head><link rel="stylesheet" href="/game/_unity/UI/assets/app.css"></head><body><script>var buildUrl = "/game/_unity/Build"; window.metroUnityUiBase = \'/game/_unity/UI/\';</script></body></html>'
  const manifest = {
    splitFiles: {
      'Build/web-Release.wasm': {
        parts: ['Build/web-Release.wasm.brpart0', 'Build/web-Release.wasm.brpart1'],
        bytes: 6,
        encoding: 'br',
      },
    },
  }
  return {
    ASSET_PREFIX: assetPrefix,
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname
        if (pathname === '/') return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
        if (pathname === '/UI/assets/app.css') return new Response('body{}', { status: 200, headers: { 'content-type': 'text/css' } })
        if (pathname === '/manifest.json') return Response.json(manifest)
        if (pathname === '/Build/web-Release.wasm.brpart0') return new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d]), { status: 200 })
        if (pathname === '/Build/web-Release.wasm.brpart1') return new Response(new Uint8Array([0x01, 0x00]), { status: 200 })
        return new Response('Not found', { status: 404 })
      },
    },
  }
}

test('Worker routes /game/unity and /game/unity/benchmark[/en], rewrites asset base, and streams split assets', async () => {
  const env = createUnityMockEnv('/game/unity')

  const redirects = [
    ['https://stationdesigner.com/game/unity', 'https://stationdesigner.com/game/unity/'],
    ['https://stationdesigner.com/game/unity/en', 'https://stationdesigner.com/game/unity/en/'],
    ['https://stationdesigner.com/game/unity/benchmark/', 'https://stationdesigner.com/game/unity/benchmark'],
    ['https://stationdesigner.com/game/unity/benchmark/en/', 'https://stationdesigner.com/game/unity/benchmark/en'],
    ['https://stationdesigner.com/game/unity/zoo/', 'https://stationdesigner.com/game/unity/zoo'],
    ['https://stationdesigner.com/game/unity/en/tianhe/', 'https://stationdesigner.com/game/unity/en/tianhe'],
  ]
  for (const [input, expected] of redirects) {
    const res = await localWorker.fetch(new Request(input), env)
    assert.equal(res.status, 308, `expected 308 for ${input}`)
    assert.equal(res.headers.get('location'), expected)
  }

  const benchZh = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/benchmark'), env)
  assert.equal(benchZh.status, 200)
  const benchZhHtml = await benchZh.text()
  assert.match(benchZhHtml, /<html lang="zh-CN">/)
  assert.match(benchZhHtml, /\/game\/unity\/_unity\/UI\/assets\/app\.css/)
  assert.match(benchZhHtml, /var buildUrl = "\/game\/unity\/_unity\/Build"/)
  assert.doesNotMatch(benchZhHtml, /\/game\/_unity\//)

  const benchEn = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/benchmark/en'), env)
  assert.equal(benchEn.status, 200)
  assert.match(await benchEn.text(), /<html lang="en">/)

  const direct = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/UI/assets/app.css'), env)
  assert.equal(direct.status, 200)
  assert.equal(await direct.text(), 'body{}')

  const splitWasm = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/Build/web-Release.wasm'), env)
  assert.equal(splitWasm.status, 200)
  assert.equal(splitWasm.headers.get('content-type'), 'application/wasm')
  assert.equal(splitWasm.headers.get('content-encoding'), 'br')
  assert.equal(splitWasm.headers.get('vary'), 'Accept-Encoding')
  assert.equal(splitWasm.headers.get('content-length'), '6')
  assert.deepEqual([...new Uint8Array(await splitWasm.arrayBuffer())], [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00])

  const outside = await localWorker.fetch(new Request('https://stationdesigner.com/game/benchmark'), env)
  assert.equal(outside.status, 404)
})

test('benchmark language route helpers isolate /game/unity/benchmark from saved game preferences', () => {
  const flipped = {
    getItem: key => key === `${LANGUAGE_STORAGE_KEY}.zh-CN` ? 'en' : key === `${LANGUAGE_STORAGE_KEY}.en` ? 'zh-CN' : null,
  }
  assert.equal(isBenchmarkPath('/game/unity/benchmark'), true)
  assert.equal(isBenchmarkPath('/game/unity/benchmark/en'), true)
  assert.equal(isBenchmarkPath('/game/unity/en/benchmark'), true)
  assert.equal(isBenchmarkPath('/game/unity/'), false)

  assert.deepEqual(initialLanguageForRoute('/game/unity/benchmark', flipped), { language: 'zh-CN', storageKey: null })
  assert.deepEqual(initialLanguageForRoute('/game/unity/benchmark/en', flipped), { language: 'en', storageKey: null })
  assert.equal(benchmarkLanguagePath('/game/unity/benchmark', 'en'), '/game/unity/benchmark/en')
  assert.equal(benchmarkLanguagePath('/game/unity/benchmark/en', 'zh-CN'), '/game/unity/benchmark')
  assert.equal(benchmarkLanguagePath('/game/unity/en/benchmark', 'zh-CN'), '/game/unity/benchmark')
})

test('UnityBenchmarkRoute and wrangler config wire the Unity WebGL benchmark cleanly without LOD/FSR stubs', () => {
  const routeSource = readFileSync(join(repo, 'game/src/unity-web/UnityBenchmarkRoute.tsx'), 'utf8')
  assert.match(routeSource, /stationBridge\.send\('station\.openDemo', \{ id: stationId \}\)/)
  assert.match(routeSource, /stationBridge\.send\('camera\.zoom', \{ factor: 2 \/ 3 \}\)/)
  assert.match(routeSource, /stationBridge\.send\('camera\.snap', \{ face: 'dir:-1,1,1', direction: \[-1, 1, 1\], projection: 'perspective' \}\)/)
  assert.match(routeSource, /stationBridge\.send\('sim\.speed', \{ speed: SPEED \}\)/)
  assert.match(routeSource, /stationBridge\.send\('sim\.play', \{ playing: true \}\)/)
  assert.match(routeSource, /setLanguage\(nextLanguage\)/)
  assert.match(routeSource, /window\.history\.replaceState\(null, '', `\$\{languagePath\}\$\{location\.search\}\$\{location\.hash\}`\)/)
  assert.doesNotMatch(routeSource, /benchmarkFsrModes|graphicsQuality|upscalingMode/, 'unsupported Three.js LOD/FSR toggles are omitted')

  const wranglerText = readFileSync(join(repo, 'unity/wrangler.jsonc'), 'utf8')
  assert.match(wranglerText, /"stationdesigner\.com\/game\/unity"/)
  assert.match(wranglerText, /"stationdesigner\.com\/game\/unity\/\*"/)
  assert.match(wranglerText, /"ASSET_PREFIX":\s*"\/game\/unity"/)
  assert.match(wranglerText, /"main":\s*"\.\.\/tools\/unity-web\/local-worker\.mjs"/)

  const html = attachUnityUI(
    '<!DOCTYPE html><html lang="en-us"><head><title>x</title></head><body><script>createUnityInstance(canvas, config, (progress) => {}).then((unityInstance) => {}).catch((message) => { alert(message); })</script></body></html>',
    { entry: 'UI/assets/station.js', css: 'UI/assets/unity-ui.css' },
    '/game/_unity',
  )
  assert.match(html, /isBenchmark = path\.endsWith\('\/benchmark'\) \|\| path\.endsWith\('\/benchmark\/en'\)/)
  assert.match(html, /window\.__metroUnityDownloadProgress = progress/)
  assert.match(html, /window\.__metroUnityLoadError =/)
})

test('stage-deploy refuses local-only soft-human packs, stages public packs, and Brotli-compresses split bundles', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'metro-unity-stage-'))
  try {
    const publicPack = join(sandbox, 'public-pack')
    mkdirSync(join(publicPack, 'Build'), { recursive: true })
    const rawData = Buffer.from('metro-station-data-'.repeat(4000))
    writeFileSync(join(publicPack, 'Build/web-Release.data.part0'), rawData.subarray(0, 30000))
    writeFileSync(join(publicPack, 'Build/web-Release.data.part1'), rawData.subarray(30000))
    writeFileSync(join(publicPack, 'index.html'), '<html></html>')
    writeFileSync(join(publicPack, 'manifest.json'), JSON.stringify({
      sourceSha: 'a'.repeat(40),
      splitFiles: {
        'Build/web-Release.data': {
          parts: ['Build/web-Release.data.part0', 'Build/web-Release.data.part1'],
          bytes: rawData.length,
        },
      },
      files: [],
    }))
    writeFileSync(join(publicPack, 'provenance.json'), JSON.stringify({ Scene: 'Assets/StationDesigner/Scenes/StationGameLocal.unity', Head: 'a'.repeat(40) }))

    const validated = validatePublicPack(publicPack)
    assert.equal(validated.scene, 'Assets/StationDesigner/Scenes/StationGameLocal.unity')

    const stagedOut = join(sandbox, 'dist-web')
    const staged = stageUnityDeploy(sandbox, publicPack, stagedOut)
    assert.equal(staged.outDir, stagedOut)
    assert.equal(readFileSync(join(stagedOut, 'index.html'), 'utf8'), '<html></html>')
    assert.equal(existsSync(join(stagedOut, 'Build/web-Release.data.part0')), false, 'raw uncompressed part removed')
    const stagedManifest = JSON.parse(readFileSync(join(stagedOut, 'manifest.json'), 'utf8'))
    const brEntry = stagedManifest.splitFiles['Build/web-Release.data']
    assert.equal(brEntry.encoding, 'br')
    assert.ok(brEntry.bytes < rawData.length, 'Brotli shrinks data payload')
    const reassembled = Buffer.concat(brEntry.parts.map(p => readFileSync(join(stagedOut, p))))
    assert.equal(reassembled.length, brEntry.bytes)
    assert.equal(brotliDecompressSync(reassembled).equals(rawData), true, 'Brotli parts decompress losslessly')

    const localOnlyPack = join(sandbox, 'local-only-pack')
    mkdirSync(localOnlyPack, { recursive: true })
    writeFileSync(join(localOnlyPack, 'index.html'), '<html></html>')
    writeFileSync(join(localOnlyPack, 'manifest.json'), JSON.stringify({ sourceSha: 'a'.repeat(40), files: [] }))
    writeFileSync(join(localOnlyPack, 'provenance.json'), JSON.stringify({ Scene: 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity', Head: 'a'.repeat(40) }))
    assert.throws(() => validatePublicPack(localOnlyPack), /Refusing to stage non-public scene/)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
