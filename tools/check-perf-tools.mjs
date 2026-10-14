import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { withPage } from './browser-harness.mjs'

// Optional local smoke check; Chrome is required, so this is not a CI timing test.
mkdirSync('.preview/perf', { recursive: true })
const page = await withPage({ url: 'data:text/html,<title>Profiling tool check</title>',
  profile: resolve(`.preview/perf/chrome-profiler-check-${process.pid}`), debugPort: 9353 })
try {
  await page.send('Profiler.enable')
  await page.send('Profiler.start')
  await page.evaluate(`function perfWorkload() { const end = performance.now() + 100; let n = 0;
    while (performance.now() < end) n += Math.sqrt(n + 1); return n; } perfWorkload()`)
  console.log('Checking CPU export…')
  const { profile } = await page.send('Profiler.stop')
  assert.ok(profile.nodes.length && profile.samples.length, 'V8 returns real samples')
  await page.send('Tracing.start', { categories: 'blink.user_timing,devtools.timeline', transferMode: 'ReturnAsStream' })
  await page.evaluate(`performance.mark('perf-tool-smoke-check'); perfWorkload()`)
  const complete = page.waitForEvent('Tracing.tracingComplete')
  complete.catch(() => {})
  await page.send('Tracing.end')
  const { stream } = await complete
  console.log('Checking trace stream…')
  const chunks = []
  for (;;) {
    const chunk = await page.send('IO.read', { handle: stream })
    chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data))
    if (chunk.eof) break
  }
  await page.send('IO.close', { handle: stream })
  const trace = JSON.parse(Buffer.concat(chunks).toString())
  assert.ok(trace.traceEvents.some(e => e.name === 'perf-tool-smoke-check'), 'Chrome trace contains the requested marker')
  console.log(`CPU samples: ${profile.samples.length}; trace events: ${trace.traceEvents.length}; profiling tools work`)
} finally { await page.close() }
