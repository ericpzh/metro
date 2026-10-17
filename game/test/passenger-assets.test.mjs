import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { passengerAssets } from '../scripts/passenger-assets.ts'

test('production passenger binary assets preserve the complete baked atlas within the Worker limit', async () => {
  const plugin = passengerAssets()
  const assets = []
  const context = { addWatchFile() {}, emitFile(asset) { assets.push(asset); return `asset${assets.length - 1}` } }
  const id = plugin.resolveId('../assets/passenger-approved.json')
  const module = plugin.load.call(context, id)
  const body = module.replace(/import.meta.ROLLUP_FILE_URL_asset(\d+)/g, (_, index) => index).replace('export default', 'return')
  const evaluate = new (Object.getPrototypeOf(async function () {}).constructor)('fetch', body)
  const restored = await evaluate(async index => ({ ok: true, arrayBuffer: async () => Uint8Array.from(assets[index].source).buffer }))
  const original = JSON.parse(readFileSync(new URL('../src/assets/passenger-approved.json', import.meta.url), 'utf8'))
  for (const field of ['positions', 'normals', 'indices', 'lowIndices', 'regions']) {
    assert.equal(Buffer.from(restored[field]).toString('base64'), original[field], 'every packed byte survives binary delivery')
    delete restored[field]; delete original[field]
  }
  assert.deepEqual(restored, original, 'metadata survives binary delivery')
  assert(assets.length >= 4)
  assert(assets.every(asset => asset.source.byteLength < 25 * 1024 * 1024))
  assert(Buffer.byteLength(module) < 1024 * 1024, 'the JavaScript module contains metadata rather than the pose buffers')
  await assert.rejects(evaluate(async () => ({ ok: false, status: 404 })), /Passenger atlas fetch failed: 404/)
})

test('the production build rejects oversized assets and JavaScript chunks', () => {
  const plugin = passengerAssets()
  const context = { error(message) { throw new Error(message) } }
  const source = new Uint8Array(25 * 1024 * 1024)
  assert.throws(() => plugin.generateBundle.call(context, {}, {
    asset: { type: 'asset', fileName: 'at-limit.bin', source },
  }), /at-limit.bin.*smaller than 25 MiB/)
  plugin.generateBundle.call(context, {}, {
    asset: { type: 'asset', fileName: 'under-limit.bin', source: new Uint8Array(source.length - 1) },
  })
  assert.throws(() => plugin.generateBundle.call(context, {}, {
    asset: { type: 'asset', fileName: 'too-large.bin', source: new Uint8Array(source.length + 1) },
  }), /too-large.bin.*25 MiB/)
  assert.throws(() => plugin.generateBundle.call(context, {}, {
    chunk: { type: 'chunk', fileName: 'too-large.js', code: 'x'.repeat(source.length + 1) },
  }), /too-large.js.*25 MiB/)
})
