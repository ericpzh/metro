import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

const cargoBin = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin')
const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
const env = { ...process.env, [pathKey]: [cargoBin, process.env[pathKey]].filter(Boolean).join(delimiter) }
const expected = 'wasm-pack 0.13.1'
const version = spawnSync('wasm-pack', ['--version'], { encoding: 'utf8', env })
if (version.stdout?.trim() !== expected) {
  const found = version.stdout?.trim()
  console.error(found ? `Expected ${expected}, found ${found}.` : `Could not find ${expected} in ${cargoBin} or on PATH.`)
  process.exit(1)
}
const build = spawnSync('wasm-pack', [
  'build', '--target', 'web', '--release', '--out-dir', '../generated/wasm', '--', '--locked',
], { cwd: new URL('../wasm/', import.meta.url), stdio: 'inherit', env })
if (build.error) throw build.error
process.exitCode = build.status ?? 1
