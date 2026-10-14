import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { passengerAssets } from '../scripts/passenger-assets.ts'

test('production passenger chunks reassemble the complete baked atlas within the Worker limit', () => {
  const plugin = passengerAssets()
  const context = { addWatchFile() {} }
  const id = plugin.resolveId('../assets/passenger-approved.json')
  const module = plugin.load.call(context, id)
  const names = [], values = [], ids = []
  const body = module.replace(/import (\w+) from (".*?");/g, (_, name, quotedId) => {
    const partId = JSON.parse(quotedId)
    assert.equal(plugin.resolveId(partId), partId)
    const source = plugin.load.call(context, partId)
    assert(Buffer.byteLength(source) < 25 * 1024 * 1024)
    names.push(name)
    values.push(JSON.parse(source.slice('export default '.length, -1)))
    ids.push(partId)
    return ''
  }).replace('export default', 'return')
  const restored = Function(...names, body)(...values)
  const original = JSON.parse(readFileSync(new URL('../src/assets/passenger-approved.json', import.meta.url), 'utf8'))
  assert.deepEqual(restored, original, 'every packed byte and metadata entry survives splitting')
  assert(ids.length > 1)
  const options = {}
  plugin.outputOptions(options)
  const group = options.codeSplitting.groups[0]
  assert(ids.every(id => group.test(id)))
  assert.equal(new Set(ids.map(group.name)).size, ids.length, 'each part stays in a separate output chunk')
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
