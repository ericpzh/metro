// Run the same benchmark workload on both shipped examples, sequentially.
// A caller-provided BENCH_STATION remains a single-fixture override.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname, resolve } from 'node:path'

const runners = {
  browser: 'tools/bench-browser.mjs',
  sim: 'tools/bench-sim.mjs',
}
const kind = process.argv[2]
const runner = runners[kind]
if (!runner) throw new Error(`Usage: node tools/bench-demos.mjs <browser|sim> [benchmark options]`)

const root = process.cwd()
const outputBase = resolve(process.env.BENCH_OUTPUT ?? `.preview/perf/${kind}.json`)
const extension = extname(outputBase) || '.json'
const outputStem = extname(outputBase) ? outputBase.slice(0, -extension.length) : outputBase
const fixtures = process.env.BENCH_STATION
  ? [{ path: resolve(process.env.BENCH_STATION), output: outputBase, station: resolve(process.env.BENCH_STATION) }]
  : ['demo-station.json', 'tanwei-station.json'].map((file) => {
      const path = resolve(root, 'game/src/data', file)
      const station = JSON.parse(readFileSync(path, 'utf8'))
      const slug = String(station.nameEn ?? station.name ?? file.replace(/\.json$/, ''))
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      // Browser and sim runners recognize these paths as the shipped examples.
      return { path, station: file === 'demo-station.json' ? null : path, output: `${outputStem}-${slug}${extension}` }
    })

for (const fixture of fixtures) {
  console.log(`\n=== ${kind} benchmark: ${fixture.path} ===`)
  const result = spawnSync(process.execPath, [runner, ...process.argv.slice(3)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BENCH_STATION: fixture.station ?? '', BENCH_OUTPUT: fixture.output },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
