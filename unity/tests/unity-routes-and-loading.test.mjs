// Unity route resolution, Cloudflare `/game/unity/*` Worker validation, `#game-loading`
// inline progress/error handoff, and UnityBenchmarkRoute helpers/contracts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { demoStationForPath, gamePathFor } from '../../game/src/app/demoRoute.ts'
import { languageForPath } from '../../game/src/sim/i18n.ts'
import { benchmarkHrefFor, LANGUAGE_STORAGE_KEY } from '../../game/src/app/languageRoute.ts'
import { tutorialAutoDisabled, tutorialStepsFor } from '../../game/src/app/windows/tutorial/steps.ts'
import { frameTimeCeilingFor, frameTimePath, summarizeFrameIntervals } from '../../game/src/app/benchmark/benchmarkStats.ts'
import localWorker from '../../tools/unity-web/local-worker.mjs'
import { attachUnityUI } from '../../tools/unity-web/unity-ui-pack.mjs'

const repo = resolve(import.meta.dirname, '../..')

test('demoRoute, i18n, benchmarkHrefFor and tutorialAutoDisabled resolve every /game/unity/* path', () => {
  const demos = ['zoo', 'tanwei', 'tianhe']
  for (const id of demos) {
    assert.equal(demoStationForPath(`/game/unity/${id}`), id)
    assert.equal(demoStationForPath(`/game/unity/${id}/`), id)
    assert.equal(demoStationForPath(`/game/unity/en/${id}`), id)
    assert.equal(demoStationForPath(`/game/unity/en/${id}/`), id)

    assert.equal(gamePathFor(`/game/unity/${id}`), '/game/unity/')
    assert.equal(gamePathFor(`/game/unity/${id}/`), '/game/unity/')
    assert.equal(gamePathFor(`/game/unity/en/${id}`), '/game/unity/en/')
    assert.equal(gamePathFor(`/game/unity/en/${id}/`), '/game/unity/en/')

    assert.equal(languageForPath(`/game/unity/${id}`), 'zh-CN')
    assert.equal(languageForPath(`/game/unity/en/${id}`), 'en')

    assert.equal(benchmarkHrefFor(`/game/unity/${id}`, 'zh-CN'), '/game/unity/benchmark')
    assert.equal(benchmarkHrefFor(`/game/unity/${id}`, 'en'), '/game/unity/benchmark/en')
    assert.equal(benchmarkHrefFor(`/game/unity/en/${id}`, 'zh-CN'), '/game/unity/benchmark')
    assert.equal(benchmarkHrefFor(`/game/unity/en/${id}`, 'en'), '/game/unity/benchmark/en')

    assert.equal(tutorialAutoDisabled(`/game/unity/${id}`), false)
    assert.equal(tutorialAutoDisabled(`/game/unity/en/${id}`), false)
  }

  for (const path of ['/game/unity/', '/game/unity/en/', '/game/unity/benchmark', '/game/unity/benchmark/en']) {
    assert.equal(demoStationForPath(path), null, `${path} is not a demo route`)
  }
  assert.equal(languageForPath('/game/unity/'), 'zh-CN')
  assert.equal(languageForPath('/game/unity/en/'), 'en')
  assert.equal(languageForPath('/game/unity/benchmark'), 'zh-CN')
  assert.equal(languageForPath('/game/unity/benchmark/en'), 'en')

  assert.equal(benchmarkHrefFor('/game/unity/', 'zh-CN'), '/game/unity/benchmark')
  assert.equal(benchmarkHrefFor('/game/unity/', 'en'), '/game/unity/benchmark/en')
  assert.equal(benchmarkHrefFor('/game/unity/en/', 'zh-CN'), '/game/unity/benchmark')
  assert.equal(benchmarkHrefFor('/game/unity/en/', 'en'), '/game/unity/benchmark/en')

  assert.equal(tutorialAutoDisabled('/game/unity/'), false)
  assert.equal(tutorialAutoDisabled('/game/unity/en/'), false)
  assert.equal(tutorialAutoDisabled('/game/unity/benchmark'), true)
  assert.equal(tutorialAutoDisabled('/game/unity/benchmark/'), true)
  assert.equal(tutorialAutoDisabled('/game/unity/benchmark/en'), true)
  assert.equal(tutorialAutoDisabled('/game/unity/benchmark/en/'), true)
})

test('local-worker validates /game/unity/* routes, serves canonical HTML, redirects slashes, and 404s unknown paths', async () => {
  const template = '<!DOCTYPE html><html lang="en-us"><head><link rel="stylesheet" href="/game/_unity/UI/assets/ui.css"></head><body><script>window.metroUnityAudioBase = \'/game/_unity/UI/audio/\'; var buildUrl = "/game/_unity/Build";</script></body></html>'
  const env = {
    ASSET_PREFIX: '/game/unity',
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname
        if (pathname === '/') return new Response(template, { status: 200, headers: { 'content-type': 'text/html' } })
        return new Response('Not found', { status: 404 })
      },
    },
  }
  const fetchRoute = path => localWorker.fetch(new Request(`https://stationdesigner.com${path}`), env)

  const okRoutes = [
    ['/game/unity/', 'zh-CN'],
    ['/game/unity/en/', 'en'],
    ['/game/unity/zoo', 'zh-CN'],
    ['/game/unity/tanwei', 'zh-CN'],
    ['/game/unity/tianhe', 'zh-CN'],
    ['/game/unity/en/zoo', 'en'],
    ['/game/unity/en/tanwei', 'en'],
    ['/game/unity/en/tianhe', 'en'],
    ['/game/unity/benchmark', 'zh-CN'],
    ['/game/unity/benchmark/en', 'en'],
  ]
  for (const [path, expectedLang] of okRoutes) {
    const res = await fetchRoute(path)
    assert.equal(res.status, 200, `expected 200 for ${path}`)
    const html = await res.text()
    assert.match(html, new RegExp(`<html lang="${expectedLang}">`), `${path} sets <html lang="${expectedLang}">`)
    assert.match(html, /\/game\/unity\/_unity\/UI\/assets\/ui\.css/, `${path} rewrites asset prefix`)
    assert.match(html, /\/game\/unity\/_unity\/UI\/audio\//, `${path} rewrites audio prefix`)
    assert.doesNotMatch(html, /\/game\/_unity\//, `${path} leaves no unrewritten /game/_unity prefix`)
  }

  const redirects = [
    ['/game/unity', 'https://stationdesigner.com/game/unity/'],
    ['/game/unity/index.html', 'https://stationdesigner.com/game/unity/'],
    ['/game/unity/en', 'https://stationdesigner.com/game/unity/en/'],
    ['/game/unity/en/index.html', 'https://stationdesigner.com/game/unity/en/'],
    ['/game/unity/zoo/', 'https://stationdesigner.com/game/unity/zoo'],
    ['/game/unity/tanwei/?q=1', 'https://stationdesigner.com/game/unity/tanwei?q=1'],
    ['/game/unity/tianhe/', 'https://stationdesigner.com/game/unity/tianhe'],
    ['/game/unity/en/zoo/', 'https://stationdesigner.com/game/unity/en/zoo'],
    ['/game/unity/en/tanwei/', 'https://stationdesigner.com/game/unity/en/tanwei'],
    ['/game/unity/en/tianhe/', 'https://stationdesigner.com/game/unity/en/tianhe'],
    ['/game/unity/benchmark/', 'https://stationdesigner.com/game/unity/benchmark'],
    ['/game/unity/benchmark/en/', 'https://stationdesigner.com/game/unity/benchmark/en'],
  ]
  for (const [path, location] of redirects) {
    const res = await fetchRoute(path)
    assert.equal(res.status, 308, `expected 308 for ${path}`)
    assert.equal(res.headers.get('location'), location, `redirect target for ${path}`)
  }

  const missingPaths = [
    '/game/unity/nonexistent',
    '/game/unity/nonexistent/',
    '/game/unity/en/missing.js',
    '/game/unity/en/nonexistent',
    '/game/unity/zoo/assets/game.js',
    '/game/unity/benchmark/extra',
    '/game/unity//zoo',
    '/game/unity/assets/game.js',
  ]
  for (const path of missingPaths) {
    const res = await fetchRoute(path)
    assert.equal(res.status, 404, `unknown route ${path} must return 404, not 200 HTML`)
  }
})

function runInlineLoadingScript({ pathname, storage = {}, initialLang = 'zh-CN' }) {
  const baseHtml = '<!DOCTYPE html><html lang="en-us"><head><title>x</title></head><body><script>createUnityInstance(canvas, config, (progress) => {}).then((unityInstance) => {}).catch((message) => { alert(message); })</script></body></html>'
  const attached = attachUnityUI(baseHtml, { entry: 'UI/assets/station.js', css: 'UI/assets/style.css' }, '/game/_unity')
  const match = /<div id="game-loading"[\s\S]*?<\/div>\s*<script>([\s\S]*?)<\/script>/.exec(attached)
  assert.ok(match, 'inline #game-loading bootstrap script must be embedded by attachUnityUI')

  const styleMap = new Map()
  const screen = {
    hidden: false,
    dataset: {},
    style: {
      setProperty(k, v) { styleMap.set(k, v) },
      getPropertyValue(k) { return styleMap.get(k) ?? '' },
      removeProperty(k) { styleMap.delete(k) },
    },
  }
  const title = { textContent: '正在准备车站' }
  const detail = { textContent: '正在加载游戏并构建车站，请稍候。' }
  const documentElement = { lang: initialLang, dataset: {} }
  const document = {
    documentElement,
    getElementById(id) {
      if (id === 'game-loading') return screen
      if (id === 'loading-title') return title
      if (id === 'loading-detail') return detail
      return null
    },
  }
  const errors = []
  const windowObj = {}
  const sandbox = {
    window: windowObj,
    document,
    location: { pathname },
    localStorage: {
      getItem: key => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    },
    console: { error: err => errors.push(err) },
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(match[1], context)
  const makeError = message => vm.runInContext(`new Error(${JSON.stringify(message)})`, context)
  return { window: windowObj, document, screen, title, detail, styleMap, errors, makeError }
}

test('inline #game-loading script resolves locale, tracks determinate progress, and locks on failure', () => {
  // English route with no stored override resolves to 'en' and updates bilingual copy.
  const enRun = runInlineLoadingScript({ pathname: '/game/unity/en/' })
  assert.equal(enRun.document.documentElement.lang, 'en')
  assert.equal(enRun.title.textContent, 'Preparing your station')
  assert.match(enRun.detail.textContent, /Loading the game/)
  assert.equal(enRun.screen.hidden, false)

  // Stored LANGUAGE_STORAGE_KEY overrides the route locale on regular game pages.
  const overridden = runInlineLoadingScript({
    pathname: '/game/unity/en/',
    storage: { [`${LANGUAGE_STORAGE_KEY}.en`]: 'zh-CN', 'metro-game.ui-theme': 'studio' },
  })
  assert.equal(overridden.document.documentElement.lang, 'zh-CN')
  assert.equal(overridden.document.documentElement.dataset.uiTheme, 'studio')
  assert.equal(overridden.title.textContent, '正在准备车站')

  // Progress < 0.9 sets determinate mode and normalized `--loading-progress`.
  enRun.window.__metroUnityProgress(0.45)
  assert.equal(enRun.window.__metroUnityDownloadProgress, 0.45)
  assert.equal(enRun.screen.dataset.determinate, 'true')
  assert.equal(enRun.styleMap.get('--loading-progress'), '50%')

  enRun.window.__metroUnityProgress(0.5)
  assert.equal(enRun.window.__metroUnityDownloadProgress, 0.5)
  assert.equal(enRun.screen.dataset.determinate, 'true')
  assert.equal(enRun.styleMap.get('--loading-progress'), '56%')

  // Progress >= 0.9 clears data-determinate so the bar sweeps while Wasm compiles/boots.
  enRun.window.__metroUnityProgress(0.95)
  assert.equal(enRun.window.__metroUnityDownloadProgress, 0.95)
  assert.equal(enRun.screen.dataset.determinate, undefined)

  // Failure unhides `#game-loading`, sets `data-failed="true"`, prints localized copy, and blocks later progress.
  enRun.screen.hidden = true
  enRun.window.__metroUnityFail(enRun.makeError('WebGL context lost'))
  assert.equal(enRun.window.__metroUnityLoadError, 'WebGL context lost')
  assert.equal(enRun.screen.hidden, false)
  assert.equal(enRun.screen.dataset.failed, 'true')
  assert.equal(enRun.screen.dataset.determinate, undefined)
  assert.match(enRun.detail.textContent, /could not load/i)

  enRun.window.__metroUnityProgress(0.45)
  assert.equal(enRun.screen.dataset.determinate, undefined, 'failed loading screen blocks later progress updates')
  assert.equal(enRun.styleMap.get('--loading-progress'), '56%', 'progress CSS var stays frozen after failure')

  // Chinese failure message.
  overridden.window.__metroUnityFail('download aborted')
  assert.equal(overridden.screen.dataset.failed, 'true')
  assert.match(overridden.detail.textContent, /游戏加载失败/)

  // Benchmark routes hide #game-loading immediately and stay locale-isolated from storage.
  const benchEn = runInlineLoadingScript({
    pathname: '/game/unity/benchmark/en',
    storage: { [`${LANGUAGE_STORAGE_KEY}.en`]: 'zh-CN' },
  })
  assert.equal(benchEn.document.documentElement.lang, 'en')
  assert.equal(benchEn.screen.hidden, true)
  benchEn.window.__metroUnityFail(benchEn.makeError('bench fail'))
  assert.equal(benchEn.window.__metroUnityLoadError, 'bench fail')
  assert.equal(benchEn.screen.hidden, true, 'benchmark failure keeps #game-loading hidden so benchmark UI reports it')
})

test('UnityBenchmarkRoute pins Tianhe default, desktop onExit, benchmark mode signals, and frame stats helpers', () => {
  const routeSource = readFileSync(join(repo, 'game/src/unity-web/UnityBenchmarkRoute.tsx'), 'utf8')
  const mainSource = readFileSync(join(repo, 'game/src/unity-web/main.tsx'), 'utf8')

  assert.match(routeSource, /useState<ExampleStationId>\('tianhe'\)/, 'Unity benchmark defaults to Tianhe Park')
  assert.match(routeSource, /onExit\?: \(\) => void/, 'UnityBenchmarkRoute supports desktop onExit callback')
  assert.match(routeSource, /\{onExit && <button type="button" onClick=\{exitToGame\}>\{copy\.backToGame\}<\/button>\}/)
  assert.match(mainSource, /desktop: desktopOverlay,/, 'main.tsx exposes desktopOverlay on StationHost for desktop-specific UI')
  assert.equal(tutorialStepsFor({ desktop: true }).at(-1)?.title, 'tutorial_examples', 'desktop Unity tutorial ends at example stations without the browser GPU step')
  assert.equal(tutorialStepsFor({ desktop: false }).at(-1)?.title, 'tutorial_gpu', 'browser tutorial retains the browser GPU step')
  assert.match(mainSource, /onExit=\{desktop \? exitBenchmark : undefined\}/, 'main.tsx wires desktop exitBenchmark')
  assert.match(mainSource, /document\.body\.dataset\.metroBenchmarkActive = 'true'/)
  assert.match(mainSource, /new CustomEvent\('metro:benchmark-mode', \{ detail: \{ active: true \} \}\)/)
  assert.match(routeSource, /document\.body\.dataset\.metroBenchmarkActive = 'true'/)
  assert.match(routeSource, /new CustomEvent\('metro:benchmark-mode', \{ detail: \{ active: true \} \}\)/)
  assert.match(routeSource, /function parseNativeFrames\(raw: unknown\): FrameSample\[\]/)
  assert.match(routeSource, /function fpsCeilingFor\(frames: FrameSample\[\]\): number[\s\S]*?\[120, 180, 240, 360, 480\]/)
  assert.match(routeSource, /function graphPath\(frames: FrameSample\[\], width: number, height: number, maxFps: number\): string/)
  assert.match(routeSource, /function resourcePath\(samples: ResourceSample\[\], metric: 'cpu' \| 'gpu' \| 'ram'/)
  assert.match(routeSource, /<FrameTimeChart frames=\{result\.frames\} arrivals=\{result\.arrivals\} stats=\{result\.stats\} copy=\{copy\}/)
  assert.match(routeSource, /type View = 'regular' \| 'explode' \| 'tour'/)
  assert.match(routeSource, /new CameraTourDriver\(\s*stationId\b/)
  assert.doesNotMatch(routeSource, /<select\b/, 'offscreen WebView2 desktop overlay cannot display native OS <select> popups')
  assert.match(routeSource, /benchmarkChoices benchmarkStations/, 'station selector renders pure-DOM buttons')

  // Verify shared summarizeFrameIntervals & frame-time chart helpers across high-FPS native desktop & WebGL intervals.
  const desktopStats = summarizeFrameIntervals([4, 4, 4, 8, Number.NaN, 0])
  assert.deepEqual(desktopStats, {
    averageFps: 1000 / 5,
    onePercentLowFps: 125,
    worstFrameMs: 8,
  })
  assert.equal(summarizeFrameIntervals([0, -5, Number.POSITIVE_INFINITY]), null)
  assert.equal(frameTimeCeilingFor([{ interval: 100 }, { interval: 14 }, { interval: 38.9 }]), 40)
  assert.equal(frameTimeCeilingFor([{ interval: 10 }, { interval: 45.3 }]), 60)
  assert.equal(frameTimePath([{ at: 0, interval: 500 }, { at: 0, interval: 20 }, { at: 30_000, interval: 40 }], 1000, 260, 40), 'M0.0,130.0 L1000.0,0.0')
})
