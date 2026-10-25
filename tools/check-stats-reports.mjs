// Reproducible browser coverage for the public feedback board. It runs the real
// stats Worker against an isolated, temporary local D1 and leaves dev data alone.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPage, waitFor } from './browser-harness.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const state = mkdtempSync(join(repo, 'stats', '.wrangler', 'reports-browser-'))
const previewScript = join(repo, 'stats', 'scripts', 'preview.mjs')
const previewLogs = []
let preview
let page

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const { port } = server.address()
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return port
}

function tailLogs() { return previewLogs.join('').slice(-5000) }

try {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  preview = spawn(process.execPath, [previewScript, '--port', String(port)], {
    cwd: repo,
    env: { ...process.env, STATS_STATE_DIR: join(state, 'd1'), STATS_RUNTIME_TEMP: join(state, 'runtime-tmp') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  preview.stdout.setEncoding('utf8').on('data', chunk => previewLogs.push(chunk))
  preview.stderr.setEncoding('utf8').on('data', chunk => previewLogs.push(chunk))

  let ready = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (preview.exitCode !== null) throw new Error(`stats preview exited early\n${tailLogs()}`)
    try {
      const response = await fetch(base + '/stats/api/v1/health')
      if (response.ok) { ready = true; break }
    } catch { /* worker is starting */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  assert.ok(ready, `stats preview did not become ready\n${tailLogs()}`)

  page = await withPage({
    url: base + '/stats/en/report',
    profile: join(state, 'chrome-profile'),
    debugPort: await freePort(),
  })
  await waitFor(page.evaluate, `document.querySelector('#report-list')?.getAttribute('aria-busy') === 'false'`)

  const title = `Browser report ${crypto.randomUUID()} <img src=x onerror=alert(1)>`
  await page.evaluate(`
    document.getElementById('report-add').click();
    document.querySelector('[name="title"]').value = ${JSON.stringify(title)};
    document.querySelector('[name="details"]').value = 'Browser check with literal <script>markup</script>.';
    document.getElementById('report-form').requestSubmit();
  `)
  await waitFor(page.evaluate, `document.querySelector('#report-status').textContent === 'Submitted. Thank you!'`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.report-body img, .report-body script').length`), 0)
  assert.equal(await page.evaluate(`document.querySelector('.report-body h2')?.textContent`), title)

  await page.evaluate(`document.querySelector('.vote:not(:disabled)').click()`)
  await waitFor(page.evaluate, `document.querySelector('.vote[aria-pressed="true"] strong')?.textContent === '1'`)

  for (const [locale, path] of [['en', '/stats/en/report'], ['zh', '/stats/report']]) {
    await page.send('Page.navigate', { url: base + path })
    await waitFor(page.evaluate, `document.querySelector('#report-list')?.getAttribute('aria-busy') === 'false' && document.querySelector('.vote[aria-pressed="true"]') !== null`)
    assert.ok(await page.evaluate(`document.documentElement.lang === ${JSON.stringify(locale === 'en' ? 'en' : 'zh-CN')}`))
    for (const width of [1280, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false })
      assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `${locale} ${width}px page overflowed`)
      await page.evaluate(`document.getElementById('report-add').click()`)
      assert.ok(await page.evaluate(`document.querySelector('#report-form').getBoundingClientRect().right <= innerWidth`), `${locale} ${width}px form overflowed`)
      await page.evaluate(`document.getElementById('report-cancel').click()`)
    }
  }
  console.log('Stats reports browser check passed: real local Worker/D1, create, safe rendering, vote persistence, both languages, and 390/1280px layouts.')
} catch (error) {
  console.error(error)
  if (previewLogs.length) console.error(tailLogs())
  process.exitCode = 1
} finally {
  if (page) await page.close()
  if (preview?.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(preview.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      preview.kill('SIGTERM')
    }
  }
  rmSync(state, { recursive: true, force: true })
}
