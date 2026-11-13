import { spawnSync } from 'node:child_process'

const expected = 'wasm-pack 0.13.1'
const version = spawnSync('wasm-pack', ['--version'], { encoding: 'utf8' })
if (version.stdout?.trim() !== expected) {
  console.error('Install wasm-pack 0.13.1 and add it to PATH before building WASM.')
  process.exit(1)
}
const build = spawnSync('wasm-pack', [
  'build', '--target', 'web', '--release', '--out-dir', '../generated/wasm', '--', '--locked',
], { cwd: new URL('../wasm/', import.meta.url), stdio: 'inherit' })
if (build.error) throw build.error
process.exitCode = build.status ?? 1
