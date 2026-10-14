import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// V8 samples the real seeded World and build helpers; open the profile in DevTools.
const directory = resolve('.preview/perf')
mkdirSync(directory, { recursive: true })
const name = `sim-${Date.now()}.cpuprofile`
const result = spawnSync(process.execPath, ['--cpu-prof', '--cpu-prof-dir=' + directory,
  '--cpu-prof-name=' + name, 'tools/bench-sim.mjs'], {
  stdio: 'inherit', env: { ...process.env, BENCH_OUTPUT: process.env.BENCH_OUTPUT ?? resolve(directory, 'sim-profile.json') },
})
if (result.error) throw result.error
console.log('CPU profile: ' + resolve(directory, name))
process.exitCode = result.status ?? 1
