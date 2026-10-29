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

  const save = JSON.stringify({ format: 'metro-save', formatVersion: 1, static: { cells: [], modules: [], lines: [] } })
  await page.evaluate(`
    document.getElementById('report-share').click();
    document.querySelector('[name="title"]').value = 'Shared browser station';
    document.querySelector('[name="details"]').value = 'A station shared from the browser.';
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(save)}], 'station.json', { type: 'application/json' }));
    document.querySelector('[name="saveFile"]').files = transfer.files;
    document.getElementById('report-form').requestSubmit();
  `)
  await waitFor(page.evaluate, `document.querySelectorAll('.report-body a[download]').length === 1`)
  assert.equal(await page.evaluate(`fetch(document.querySelector('.report-body a[download]').href).then(r => r.text())`), save)
  assert.ok(await page.evaluate(`document.querySelector('.report-body a[download]').parentElement.textContent.includes('station.json')`))
  assert.ok(await page.evaluate(`fetch(document.querySelector('.report-body a[download]').href).then(r => r.headers.get('Content-Disposition').includes("filename*=UTF-8''station.json"))`))
  await page.evaluate(`Promise.all([
    { title: '中文报告', details: '这里是一个中文问题报告。' },
    { title: '中英文报告', details: '这里有中文说明 and English details for the issue.' },
    { title: '12345', details: '1234567890 1234567890' },
  ].map(post => fetch('/stats/api/v1/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'bug', ...post }) }).then(r => { if (!r.ok) throw new Error('Seed failed: ' + r.status) })))`)
  for (const [language, expected, excluded] of [
    ['zh', ['中文报告', '中英文报告'], ['Shared browser station', '12345']],
    ['en', ['Shared browser station', '中英文报告'], ['中文报告', '12345']],
    ['all', ['中文报告', '中英文报告', 'Shared browser station', '12345'], []],
  ]) {
    await page.evaluate(`document.getElementById('report-language').value = ${JSON.stringify(language)}; document.getElementById('report-language').dispatchEvent(new Event('change'))`)
    await waitFor(page.evaluate, `document.querySelector('#report-list').getAttribute('aria-busy') === 'false'`)
    const titles = await page.evaluate(`Array.from(document.querySelectorAll('.report-body h2'), el => el.textContent)`)
    for (const title of expected) assert.ok(titles.includes(title), `${language} should show ${title}`)
    for (const title of excluded) assert.ok(!titles.includes(title), `${language} should hide ${title}`)
  }
  // A filtered-out first API page still offers Load more and advances by the
  // unfiltered result count, so matching posts on later pages remain reachable.
  await page.evaluate(`
    window.originalFetch = window.fetch;
    window.fetch = (url, ...args) => {
      if (String(url).startsWith('/stats/api/v1/reports?')) {
        const offset = Number(new URL(url, location.href).searchParams.get('offset'));
        const issue = offset === 0 ? { title: 'English example', details: 'English details here' } : { title: '中文报告', details: '更多中文内容' };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, issues: Array.from({ length: offset === 0 ? 40 : 1 }, (_, i) => ({ ...issue, id: String(i), type: 'bug', createdAt: new Date().toISOString(), votes: 0, voted: false })), hasMore: offset === 0 }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return window.originalFetch(url, ...args);
    };
    document.getElementById('report-language').value = 'zh';
    document.getElementById('report-language').dispatchEvent(new Event('change'));
  `)
  await waitFor(page.evaluate, `document.querySelector('#report-list').getAttribute('aria-busy') === 'false' && !document.getElementById('report-more').hidden`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.report-row').length`), 0)
  await page.evaluate(`document.getElementById('report-more').click()`)
  await waitFor(page.evaluate, `document.querySelector('.report-body h2')?.textContent === '中文报告'`)
  await page.evaluate(`window.fetch = window.originalFetch; document.getElementById('report-language').value = 'all'`)

  await page.evaluate(`document.getElementById('report-filter').value = 'share'; document.getElementById('report-filter').dispatchEvent(new Event('change'))`)
  await waitFor(page.evaluate, `document.querySelector('#report-list').getAttribute('aria-busy') === 'false' && document.querySelector('.report-kind')?.textContent === 'Shared save'`)

  for (const [locale, path] of [['en', '/stats/en/report'], ['zh', '/stats/report']]) {
    await page.send('Page.navigate', { url: base + path })
    await waitFor(page.evaluate, `document.querySelector('#report-list')?.getAttribute('aria-busy') === 'false' && document.querySelector('.vote[aria-pressed="true"]') !== null`)
    assert.ok(await page.evaluate(`document.documentElement.lang === ${JSON.stringify(locale === 'en' ? 'en' : 'zh-CN')}`))
    for (const width of [1280, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false })
      assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `${locale} ${width}px page overflowed`)
      assert.ok(await page.evaluate(`Math.abs(document.getElementById('report-add').getBoundingClientRect().top - document.getElementById('report-share').getBoundingClientRect().top) < 1`), `${locale} ${width}px actions wrapped apart`)
      await page.evaluate(`document.getElementById('report-add').click()`)
      assert.ok(await page.evaluate(`document.querySelector('#report-form').getBoundingClientRect().right <= innerWidth`), `${locale} ${width}px form overflowed`)
      await page.evaluate(`document.getElementById('report-cancel').click()`)
    }
  }
  console.log('Stats reports browser check passed: real local Worker/D1, create, save sharing, language filters and pagination, safe rendering, vote persistence, both languages, and 390/1280px layouts.')
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
