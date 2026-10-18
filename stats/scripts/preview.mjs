// Local **development** preview of the global stats Worker.
//
//   npm run dev:stats                 # http://localhost:5176/  — empty, fed by the game
//   npm run dev:stats -- --seed       # add the sample rows for a UI pass
//   npm run dev:stats -- --reset      # clear the local D1 first
//   npm run dev:stats -- --port 5179
//   npm run preview:stats             # alias
//
// This always runs the `dev` Wrangler environment from stats/wrangler.jsonc:
// no routes, a separate local D1 id, and ENVIRONMENT=development, so the page
// shows a Development badge and nothing can touch the production database.
//
// The default database is **empty**: the game at http://localhost:5174 posts
// its real submissions here (its dev collector runs every five seconds). Apply
// stats/schema.sql on start; --seed adds stats/seed.sql only for a sample UI.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const statsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(statsDir, '..')
const wrangler = join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const config = join(statsDir, 'wrangler.jsonc')
const state = join(statsDir, '.wrangler', 'state')
const args = process.argv.slice(2)

if (!existsSync(wrangler)) {
  console.error('wrangler is not installed. Run `npm install` at the repo root first.')
  process.exit(1)
}

// Workerd writes its per-run Miniflare state under the OS temp directory. On
// Windows a sandboxed or profile-owned %TEMP% can reject those directories even
// when the repo itself is writable (`CreateDirectory: Access is denied`), so
// keep the runtime's temp files beside the preview's own ignored state.
const runtimeTemp = join(statsDir, '.wrangler', 'tmp', 'miniflare')
mkdirSync(runtimeTemp, { recursive: true })
const childEnv = { ...process.env, TEMP: runtimeTemp, TMP: runtimeTemp, TMPDIR: runtimeTemp }

function option(name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const port = Number(process.env.STATS_PORT || option('--port', '5176'))
const seed = args.includes('--seed')
const reset = args.includes('--reset')

if (reset) {
  console.log(`[stats] clearing local D1 state (${state})`)
  rmSync(state, { recursive: true, force: true })
}

function run(step, commandArgs) {
  console.log(`\n[stats] ${step}`)
  const result = spawnSync(process.execPath, [wrangler, ...commandArgs], {
    cwd: repo,
    stdio: 'pipe',
    encoding: 'utf8',
    windowsHide: true,
    env: childEnv,
  })
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
}

// Persistent local D1, keyed by the dev environment's own database_id.
run('applying schema to the local D1 database', [
  'd1', 'execute', 'STATS_DB',
  '--local',
  '--file', join(statsDir, 'schema.sql'),
  '--config', config,
  '--env', 'dev',
  '--persist-to', state,
  '--yes',
])

if (seed) {
  run('adding development sample data', [
    'd1', 'execute', 'STATS_DB',
    '--local',
    '--file', join(statsDir, 'seed.sql'),
    '--config', config,
    '--env', 'dev',
    '--persist-to', state,
    '--yes',
  ])
} else {
  console.log('[stats] no sample data: the game at http://localhost:5174 fills this local D1')
}

console.log('\nStation Designer stats — development')
console.log(`  page  http://localhost:${port}/`)
console.log(`  api   http://localhost:${port}/stats/api/v1/global`)
console.log(`  game  http://localhost:5174/  (npm run dev:game)`)
console.log(`  db    local D1 (${state})${seed ? ' + sample data' : ' · game submissions only'}`)
console.log('  note  every local submit shares the 127.0.0.1 hash (dev IP_HASH_SECRET)')
console.log('  prod is never used by this preview; Ctrl+C stops it.\n')

const child = spawn(process.execPath, [
  wrangler, 'dev',
  '--config', config,
  '--env', 'dev',
  '--local',
  '--ip', '127.0.0.1',
  '--port', String(port),
  '--persist-to', state,
  '--show-interactive-dev-session=false',
], { cwd: repo, stdio: 'inherit', windowsHide: true, env: childEnv })

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (child.exitCode === null) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  }
  setTimeout(() => process.exit(code), 500)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
child.on('error', error => {
  console.error(`[stats] ${error.message}`)
  stop(1)
})
child.on('exit', code => {
  if (!stopping) stop(code ?? 0)
})
