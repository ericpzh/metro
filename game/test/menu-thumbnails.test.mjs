import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MODULE_OPTIONS } from '../src/app/store/catalog.ts'

const assetDir = new URL('../public/module-thumbnails/', import.meta.url)
const index = JSON.parse(readFileSync(new URL('index.json', assetDir), 'utf8'))
const read = (path) => readFileSync(new URL(path, new URL('../src/', import.meta.url)), 'utf8')

test('the complete menu catalogue has generated 132 px PNG thumbnails', () => {
  const indexedIds = index.thumbnails.map((thumbnail) => thumbnail.id).sort()
  const catalogueIds = MODULE_OPTIONS.map((option) => option.id).sort()
  assert.deepEqual(indexedIds, catalogueIds, 'every palette option has exactly one generated thumbnail')
  assert.equal(index.width, 132)
  assert.equal(index.height, 132)
  assert.equal(index.pixelRatio, 1)

  for (const thumbnail of index.thumbnails) {
    const png = readFileSync(new URL(thumbnail.file, assetDir))
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${thumbnail.id} is a PNG`)
    assert.equal(png.readUInt32BE(16), index.width, `${thumbnail.id} width`)
    assert.equal(png.readUInt32BE(20), index.height, `${thumbnail.id} height`)
    assert.equal(png.byteLength, thumbnail.bytes, `${thumbnail.id} file size matches the generated index`)
  }
})

test('palette thumbnails use static lazy-loaded assets instead of runtime WebGL rendering', () => {
  const grid = read('app/rail/shared/TileGrid.tsx')
  const variants = read('app/rail/menus/VariantMenu.tsx')
  const block = read('app/rail/shared/Block.tsx')
  const urls = read('app/moduleThumbnailAssets.ts')
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(grid, /getModuleThumbnails|moduleThumbnails\.ts/)
  assert.doesNotMatch(variants, /getModuleThumbnails|moduleThumbnails\.ts/)
  assert.match(urls, /module-thumbnails\//)
  assert.match(block, /loading="lazy" decoding="async"/)
  assert.match(vite, /\/en\/module-thumbnails\//, 'Vite development and preview rewrite the English asset path')
})
