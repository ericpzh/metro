import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const outDir = resolve('.preview/perf/menu-thumbnails')
mkdirSync(outDir, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
const page = await withPage({
  url: `http://127.0.0.1:${server.address().port}/`,
  profile: resolve(outDir, `chrome-${process.pid}`),
  debugPort: Number(process.env.BENCH_PORT ?? (9400 + process.pid % 1000)),
})

try {
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', { what: 'initial game render' })
  const ready = await page.evaluate(`(() => {
    const result = { readyMs: performance.now(), longTasks: [] }
    const observer = new PerformanceObserver(list => result.longTasks.push(...list.getEntries().map(entry => ({ startMs: entry.startTime, durationMs: entry.duration }))))
    observer.observe({ type: 'longtask', buffered: true })
    window.__menuThumbnailBench = { result, observer }
    return result.readyMs
  })()`)
  const opened = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('.folderHead')].find(node => node.textContent.includes('设备'))
    if (!button) throw Error('equipment folder button is missing')
    button.click()
    return performance.now()
  })()`)
  await page.evaluate(`(() => {
    const image = document.querySelector('img[src*="module-thumbnails/"]')
    if (!image) throw Error('equipment thumbnails did not mount')
    image.scrollIntoView({ block: 'center', behavior: 'instant' })
  })()`)
  await waitFor(page.evaluate, 'document.querySelectorAll(\'img[src*="module-thumbnails/"]\').length >= 20', {
    what: 'menu thumbnail elements mounted',
    tries: 240,
    every: 40,
  })
  await waitFor(page.evaluate, '[...document.querySelectorAll(\'img[src*="module-thumbnails/"]\')].some(img => img.complete && img.naturalWidth > 0)', {
    what: 'first menu thumbnail loaded',
    tries: 240,
    every: 40,
  })
  const report = await page.evaluate(`(() => {
    const { result, observer } = window.__menuThumbnailBench
    observer.disconnect()
    const images = [...document.querySelectorAll('img[src*="module-thumbnails/"]')]
    return { ...result, thumbnailsReadyMs: performance.now(), thumbnailCount: images.length, loadedThumbnailCount: images.filter(img => img.complete && img.naturalWidth > 0).length, failedThumbnailCount: images.filter(img => img.complete && img.naturalWidth === 0).length }
  })()`)
  report.folderOpenedMs = opened
  report.thumbnailWorkMs = report.thumbnailsReadyMs - opened
  report.initialReadyMs = ready
  writeFileSync(resolve(outDir, `${Date.now()}-${process.pid}.json`), JSON.stringify(report, null, 2))
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(outDir, `${Date.now()}-${process.pid}.png`), Buffer.from(screenshot.data, 'base64'))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await page.close()
  server.close()
}
