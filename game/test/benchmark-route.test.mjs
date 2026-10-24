import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/app/benchmark/BenchmarkRoute.tsx', import.meta.url), 'utf8')

test('the benchmark-selected graphics quality controls the renderer without changing the saved game preference', () => {
  const applyQuality = source.indexOf('useStore.setState({ graphicsQuality: quality })')
  const mountApp = source.indexOf('setAppMounted(true)', applyQuality)
  assert.notEqual(applyQuality, -1, 'the selected benchmark quality is applied to the store')
  assert.ok(mountApp > applyQuality, 'the selected quality is applied before mounting the renderer')
  assert.doesNotMatch(source, /\.setGraphicsQuality\(quality\)/, 'the benchmark does not persist its temporary choice')
})
