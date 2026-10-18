// Deploy the **production** stats Worker and apply its D1 schema.
//
//   npm run deploy:stats
//
// Order matters:
//   1. `node --check` the Worker entry.
//   2. Apply stats/schema.sql to the production `metro-stats` D1 database
//      (`--remote`). It is idempotent, so repeat deploys are safe.
//   3. `wrangler deploy` the base (production) environment, which attaches the
//      `stationdesigner.com/stats` and `/stats/*` routes.
//   4. Poll the live `/stats/api/v1/health` endpoint until the new version is
//      serving, then check the page, the totals endpoint and the write gate
//      (a foreign origin and a bare script must both get 403).
//
// The local preview (`npm run dev:stats`) uses the `dev` environment and a
// local D1 database; it never touches this deployment.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const statsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(statsDir, '..')
const wrangler = join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const config = join(statsDir, 'wrangler.jsonc')
const schema = join(statsDir, 'schema.sql')
const base = (process.env.STATS_URL || 'https://stationdesigner.com/stats').replace(/\/+$/, '')

if (!readFileSync(config, 'utf8').includes('"metro-stats"')
    || readFileSync(config, 'utf8').includes('REPLACE_WITH')) {
  console.error('stats/wrangler.jsonc still has a placeholder production database id.')
  process.exit(1)
}

function run(step, commandArgs) {
  console.log(`\n[stats] ${step}`)
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repo,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('checking stats/worker.js syntax', ['--check', join(statsDir, 'worker.js')])
run('checking stats/page.js syntax', ['--check', join(statsDir, 'page.js')])
run('checking stats/favicon.js syntax', ['--check', join(statsDir, 'favicon.js')])
run('checking stats/brand-mark.js syntax', ['--check', join(statsDir, 'brand-mark.js')])

// `--remote` is explicit: this is the production D1 database, not `wrangler
// dev`'s local state. The binding name comes from the base environment.
run('applying stats/schema.sql to the production D1 database', [
  wrangler, 'd1', 'execute', 'STATS_DB',
  '--remote',
  '--file', schema,
  '--config', config,
  '--yes',
])

run('deploying metro-stats (production)', [
  wrangler, 'deploy',
  '--config', config,
  // The config has a `dev` environment; state explicitly that this is the
  // top-level (production) one instead of relying on the default.
  '--env=',
])

async function get(path, init) {
  const response = await fetch(base + path, { ...init, redirect: 'manual' })
  return response
}

async function waitForHealth() {
  let last = 'no response'
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await get('/api/v1/health')
      const body = await response.json().catch(() => null)
      if (response.ok && body?.ok === true && body?.schema === 'ready') {
        console.log(`[stats] health: ${body.environment} · ${body.schema}`)
        return
      }
      last = `HTTP ${response.status} ${JSON.stringify(body)}`
    } catch (error) {
      last = error?.message || String(error)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 2000))
  }
  throw new Error(`stats health check did not pass: ${last}`)
}

try {
  await waitForHealth()

  const redirect = await get('')
  if (redirect.status !== 308 || redirect.headers.get('location') !== '/stats/') {
    throw new Error(`/stats should 308 to /stats/, got ${redirect.status} ${redirect.headers.get('location')}`)
  }

  const page = await get('/')
  const html = await page.text()
  if (!page.ok || !html.includes('/stats/api/v1/global')) {
    throw new Error(`/stats/ page check failed: HTTP ${page.status}`)
  }
  if (!html.includes('rel="icon" type="image/png" sizes="64x64"')) {
    throw new Error('/stats/ page is not using the site favicon')
  }
  if (!html.includes('class="brand__mark"') || !html.includes('mask: url("data:image/png;base64,')) {
    throw new Error('/stats/ top bar is not using the site brand mark')
  }

  const englishRedirect = await get('/en')
  if (englishRedirect.status !== 308 || englishRedirect.headers.get('location') !== '/stats/en/') {
    throw new Error(`/stats/en should 308 to /stats/en/, got ${englishRedirect.status} ${englishRedirect.headers.get('location')}`)
  }

  const englishPage = await get('/en/')
  const englishHtml = await englishPage.text()
  if (!englishPage.ok || !englishHtml.includes('<html lang="en">')) {
    throw new Error(`/stats/en/ page check failed: HTTP ${englishPage.status}`)
  }

  const totals = await get('/api/v1/global')
  const body = await totals.json()
  if (!totals.ok || typeof body.stations !== 'number') {
    throw new Error(`/stats/api/v1/global check failed: HTTP ${totals.status} ${JSON.stringify(body)}`)
  }

  // The write gate: a foreign origin and a bare script must both be refused
  // before the handler ever reads a body.
  const writeBody = JSON.stringify({
    clientId: '00000000-0000-4000-8000-000000000000',
    submitId: '00000000-0000-4000-8000-000000000001',
  })
  const foreignWrite = await get('/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'https://example.com' },
    body: writeBody,
  })
  if (foreignWrite.status !== 403) {
    throw new Error(`foreign-origin /api/v1/submit should 403, got ${foreignWrite.status}`)
  }
  const scriptWrite = await get('/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: writeBody,
  })
  if (scriptWrite.status !== 403) {
    throw new Error(`origin-less /api/v1/submit should 403, got ${scriptWrite.status}`)
  }

  console.log('\n[stats] deployed and verified')
  console.log(`  page   ${base}/`)
  console.log(`  api    ${base}/api/v1/global`)
  console.log(`  gate   ${base}/api/v1/submit → 403 for foreign origins and scripts`)
  console.log(`  totals ${body.stations} stations · ${body.passengersBoarded} boarded · ${body.trainArrivals} train arrivals`)
} catch (error) {
  console.error(`\n[stats] deployment verification failed: ${error.message}`)
  process.exit(1)
}
