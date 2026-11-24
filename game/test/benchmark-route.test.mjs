import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { benchmarkHrefFor, benchmarkLanguagePath, initialLanguageForRoute, isBenchmarkPath, LANGUAGE_STORAGE_KEY } from '../src/app/languageRoute.ts'

const source = await readFile(new URL('../src/app/benchmark/BenchmarkRoute.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/app/benchmark/benchmark.css', import.meta.url), 'utf8')
const settingsMenu = await readFile(new URL('../src/app/windows/topbar/SettingsMenu.tsx', import.meta.url), 'utf8')

test('the benchmark-selected graphics quality controls the renderer without changing the saved game preference', () => {
  const applyQuality = source.indexOf('useStore.setState({ graphicsQuality: quality, upscalingMode })')
  const mountApp = source.indexOf('setAppMounted(true)', applyQuality)
  assert.notEqual(applyQuality, -1, 'the selected benchmark quality is applied to the store')
  assert.ok(mountApp > applyQuality, 'the selected quality is applied before mounting the renderer')
  assert.doesNotMatch(source, /\.setGraphicsQuality\(quality\)/, 'the benchmark does not persist its temporary choice')
  assert.match(source, /useStore\.setState\(\{ upscalingMode: savedUpscalingMode \}\)/, 'the player FSR preference returns after the measurement')
  assert.match(source, /upscalingMode, view, frames, arrivals, resources, stats/, 'results record the selected FSR mode and resource samples')
  assert.match(source, /'ultra', 'quality', 'balanced', 'performance', 'native'/, 'all four FSR modes and Off are selectable')
  assert.match(source, /benchmarkChoices benchmarkFsrModes/, 'FSR choices use one button row')
})

test('the benchmark opens on the demo station Tianhe Park and labels whichever station runs', () => {
  assert.match(source, /useState<ExampleStationId>\('tianhe'\)/, 'Tianhe Park is the default demo station')
  assert.match(source, /`\$\{remaining\}\$\{copy\.seconds\} · \$\{copy\[stationId\]\}/, 'the running HUD names the selected station')
  assert.doesNotMatch(source, /stationId === 'zoo' \? copy\.zoo : copy\.tanwei/, 'the HUD does not fall back to Tanwei')
})

test('the result header action keeps its label on one line and the free-text title takes the shrinking', () => {
  const header = styles.slice(styles.indexOf('.benchmarkResultHeader {'), styles.indexOf('.benchmarkResultHeader p {'))
  assert.match(header, /> div \{ min-width: 0; \}/,
    'the station name and long hardware line are what may shrink')
  assert.match(header, /button \{ flex: 0 0 auto; white-space: nowrap; \}/,
    '???? keeps its four characters on one line instead of breaking after ???')
})

test('benchmark external routes ignore saved game language overrides while regular game routes keep them', () => {
  const savedBothFlipped = {
    getItem: (key) => key === `${LANGUAGE_STORAGE_KEY}.zh-CN` ? 'en' : key === `${LANGUAGE_STORAGE_KEY}.en` ? 'zh-CN' : null,
  }
  assert.equal(isBenchmarkPath('/game/benchmark'), true)
  assert.equal(isBenchmarkPath('/game/benchmark/en'), true)
  assert.equal(isBenchmarkPath('/game/benchmark/en/'), true)
  assert.equal(isBenchmarkPath('/game/en/benchmark'), true)
  assert.equal(isBenchmarkPath('/game/'), false)

  assert.deepEqual(initialLanguageForRoute('/game/benchmark', savedBothFlipped), { language: 'zh-CN', storageKey: null })
  assert.deepEqual(initialLanguageForRoute('/game/benchmark/en', savedBothFlipped), { language: 'en', storageKey: null })
  assert.deepEqual(initialLanguageForRoute('/game/en/benchmark', savedBothFlipped), { language: 'en', storageKey: null })
  assert.deepEqual(initialLanguageForRoute('/benchmark', savedBothFlipped), { language: 'zh-CN', storageKey: null })
  assert.deepEqual(initialLanguageForRoute('/benchmark/en', savedBothFlipped), { language: 'en', storageKey: null })

  assert.deepEqual(initialLanguageForRoute('/game/', savedBothFlipped), { language: 'en', storageKey: `${LANGUAGE_STORAGE_KEY}.zh-CN` })
  assert.deepEqual(initialLanguageForRoute('/game/en/', savedBothFlipped), { language: 'zh-CN', storageKey: `${LANGUAGE_STORAGE_KEY}.en` })
  assert.deepEqual(initialLanguageForRoute('/game/', null), { language: 'zh-CN', storageKey: `${LANGUAGE_STORAGE_KEY}.zh-CN` })
  assert.deepEqual(initialLanguageForRoute('/game/en/', null), { language: 'en', storageKey: `${LANGUAGE_STORAGE_KEY}.en` })
})

test('benchmark language toggle switches in place, keeps URL synced, and computes target paths cleanly', () => {
  assert.equal(benchmarkLanguagePath('/game/benchmark', 'en'), '/game/benchmark/en')
  assert.equal(benchmarkLanguagePath('/game/benchmark/', 'en'), '/game/benchmark/en')
  assert.equal(benchmarkLanguagePath('/game/benchmark/en', 'zh-CN'), '/game/benchmark')
  assert.equal(benchmarkLanguagePath('/game/benchmark/en/', 'zh-CN'), '/game/benchmark')
  assert.equal(benchmarkLanguagePath('/game/en/benchmark', 'zh-CN'), '/game/benchmark')
  assert.equal(benchmarkLanguagePath('/game/en/benchmark', 'en'), '/game/benchmark/en')
  assert.equal(benchmarkLanguagePath('/benchmark', 'en'), '/benchmark/en')
  assert.equal(benchmarkLanguagePath('/benchmark/en', 'zh-CN'), '/benchmark')

  assert.match(source, /setLanguage\(nextLanguage\)/, 'clicking the toggle directly switches the active language')
  assert.match(source, /window\.history\.replaceState\(null, '', `\$\{languagePath\}\$\{location\.search\}\$\{location\.hash\}`\)/,
    'toggling updates the URL in place so reloads preserve the chosen language')
  assert.match(source, /<a href=\{languagePath\} onClick=\{toggleLanguage\}>\{copy\.language\}<\/a>/,
    'the locale link handles in-place toggling while keeping its href for new-tab navigation')
})

test('settings heading exposes a PiSpeedometerBold benchmark action linking web routes and calling host hook on desktop', () => {
  assert.equal(benchmarkHrefFor('/game/', 'zh-CN'), '/game/benchmark')
  assert.equal(benchmarkHrefFor('/game/en/', 'en'), '/game/benchmark/en')
  assert.equal(benchmarkHrefFor('/game/zoo', 'en'), '/game/benchmark/en')
  assert.equal(benchmarkHrefFor('/game/unity/', 'zh-CN'), '/game/unity/benchmark')
  assert.equal(benchmarkHrefFor('/game/unity/en/', 'en'), '/game/unity/benchmark/en')
  assert.equal(benchmarkHrefFor('/game/unity/tianhe', 'zh-CN'), '/game/unity/benchmark')
  assert.equal(benchmarkHrefFor('/', 'zh-CN'), '/benchmark')
  assert.equal(benchmarkHrefFor('/en/', 'en'), '/benchmark/en')

  assert.match(settingsMenu, /import \{[^}]*PiSpeedometerBold[^}]*\} from 'react-icons\/pi'/)
  assert.match(settingsMenu, /stationHost\?\.openBenchmark/)
  assert.match(settingsMenu, /<PiSpeedometerBold aria-hidden="true" \/>/)
  assert.match(settingsMenu, /href=\{benchmarkHrefFor\(/)
})

test('tutorial stays suppressed whenever benchmark mode is active on web or desktop in-place overlay', async () => {
  const tutorial = await readFile(new URL('../src/app/windows/tutorial/Tutorial.tsx', import.meta.url), 'utf8')
  const unityBenchmark = await readFile(new URL('../src/unity-web/UnityBenchmarkRoute.tsx', import.meta.url), 'utf8')
  assert.match(tutorial, /metroBenchmarkActive/)
  assert.match(tutorial, /metro:benchmark-mode/)
  assert.match(tutorial, /if \(!visible\) return null/)
  assert.match(source, /document\.body\.dataset\.metroBenchmarkActive = 'true'/)
  assert.match(unityBenchmark, /document\.body\.dataset\.metroBenchmarkActive = 'true'/)
  assert.match(unityBenchmark, /stationBridge\.send\('benchmark\.mode', \{ active: true \}\)/)
})

test('all benchmark report pages render the shared FrameTimeChart time series graph', async () => {
  const unityBenchmark = await readFile(new URL('../src/unity-web/UnityBenchmarkRoute.tsx', import.meta.url), 'utf8')
  const chartSource = await readFile(new URL('../src/app/benchmark/FrameTimeChart.tsx', import.meta.url), 'utf8')
  const copySource = await readFile(new URL('../src/app/benchmark/benchmarkCopy.ts', import.meta.url), 'utf8')
  assert.match(source, /<FrameTimeChart frames=\{result\.frames\} arrivals=\{result\.arrivals\} stats=\{result\.stats\} copy=\{copy\}/)
  assert.match(unityBenchmark, /<FrameTimeChart frames=\{result\.frames\} arrivals=\{result\.arrivals\} stats=\{result\.stats\} copy=\{copy\}/)
  assert.match(chartSource, /frameTimeCeilingFor/)
  assert.match(chartSource, /frameTimePath/)
  assert.match(copySource, /frameTimeTitle:/)
  assert.match(copySource, /frameTimeNote:/)
})

test('both Web and Unity benchmark routes expose the Camera tour mode alongside Normal and Exploded', async () => {
  const unityBenchmark = await readFile(new URL('../src/unity-web/UnityBenchmarkRoute.tsx', import.meta.url), 'utf8')
  const copySource = await readFile(new URL('../src/app/benchmark/benchmarkCopy.ts', import.meta.url), 'utf8')
  assert.match(source, /type View = 'regular' \| 'explode' \| 'tour'/)
  assert.match(source, /onClick=\{\(\) => setView\('tour'\)\}>\{copy\.tour\}/)
  assert.match(source, /new CameraTourDriver\(\s*stationId\b/)
  assert.match(source, /scene\.panByScreenFraction\(move\.panRightFrac, move\.panForwardFrac\)/)
  assert.match(unityBenchmark, /type View = 'regular' \| 'explode' \| 'tour'/)
  assert.match(unityBenchmark, /onClick=\{\(\) => setView\('tour'\)\}>\{copy\.tour\}/)
  assert.match(unityBenchmark, /new CameraTourDriver\(\s*stationId\b/)
  assert.match(unityBenchmark, /stationBridge\.send\('camera\.orbit'/)
  assert.match(unityBenchmark, /stationBridge\.send\('camera\.pan'/)
  assert.match(copySource, /tour: 'Camera tour'/)
  assert.match(copySource, /tour: '动态视角'/)
  assert.doesNotMatch(source, /<select\b/, 'Web benchmark avoids native <select> popups')
  assert.doesNotMatch(unityBenchmark, /<select\b/, 'Unity benchmark avoids native <select> popups broken in offscreen WebView2')
  assert.match(source, /benchmarkChoices benchmarkStations/)
  assert.match(unityBenchmark, /benchmarkChoices benchmarkStations/)
})
