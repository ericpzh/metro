import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/app/benchmark/BenchmarkRoute.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/app/benchmark/benchmark.css', import.meta.url), 'utf8')

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

test('the result header action keeps its label on one line and the free-text title takes the shrinking', () => {
  const header = styles.slice(styles.indexOf('.benchmarkResultHeader {'), styles.indexOf('.benchmarkResultHeader p {'))
  assert.match(header, /> div \{ min-width: 0; \}/,
    'the station name and long hardware line are what may shrink')
  assert.match(header, /button \{ flex: 0 0 auto; white-space: nowrap; \}/,
    '???? keeps its four characters on one line instead of breaking after ???')
})
