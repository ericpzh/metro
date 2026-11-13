import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const mappingPath = join(root, 'unity/asset-recipes/runtime-views.json')
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'))
const { MODULE_OPTIONS } = await import('../../game/src/app/store/catalog.ts')

test('the build palette has no duplicate key', () => {
  const ids = MODULE_OPTIONS.map((option) => option.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate MODULE_OPTIONS id')
  // The tv pair is a second palette row, not another key for the single screen.
  assert.ok(ids.includes('tv'))
  assert.ok(ids.includes('tv-double'))
})

test('every palette key resolves to a promoted prefab or a named generator', () => {
  const byKey = new Map(mapping.views.map((entry) => [entry.key, entry]))
  assert.equal(byKey.size, mapping.views.length, 'duplicate runtime view key')
  for (const option of MODULE_OPTIONS) {
    const entry = byKey.get(option.id)
    assert.ok(entry, `palette id ${option.id} has no runtime view`)
    assert.equal(entry.palette, true, `${option.id} is not flagged as a palette row`)
    if (entry.kind === 'generated') assert.ok(entry.generator, `${option.id} has no generator name`)
    else assert.ok(entry.prefab, `${option.id} has neither a prefab nor a generator`)
  }
})

test('every mapped prefab and its meta exist in the Unity project', () => {
  for (const entry of mapping.views) {
    if (!entry.prefab) continue
    const path = join(root, 'unity', entry.prefab)
    assert.ok(existsSync(path), `missing prefab ${entry.prefab}`)
    assert.ok(existsSync(path + '.meta'), `missing meta for ${entry.prefab}`)
  }
})

test('the recipe catalogue ids are unique and every mapped recipe resolves', () => {
  const catalogue = JSON.parse(readFileSync(join(root, 'unity/asset-recipes/catalogue.json'), 'utf8'))
  const catalogueIds = catalogue.families.map((record) => record.catalogueId)
  assert.equal(new Set(catalogueIds).size, catalogueIds.length, 'duplicate catalogueId in the recipe catalogue')
  const recipeIds = new Set(catalogue.families.map((record) => record.id))
  for (const entry of mapping.views) {
    for (const id of (entry.recipeId ?? '').split(' ').filter(Boolean)) {
      assert.ok(recipeIds.has(id), `${entry.key} names a recipe that does not exist: ${id}`)
    }
  }
  // The duplicated tv key is fixed: the pair maps to its own palette row.
  const pair = catalogue.families.find((record) => record.id === 'station.tv.double')
  assert.equal(pair.catalogueId, 'tv-double')
  assert.equal(pair.parameters.paletteId, 'tv-double')
  assert.equal(catalogue.families.find((record) => record.id === 'station.tv.standard').catalogueId, 'tv')
})

test('the checked-in mapping is current', () => {
  execFileSync(process.execPath, [join(root, 'tools/unity-assets/build-runtime-views.mjs'), '--check'], { cwd: root, stdio: 'pipe' })
})

test('non-palette supplemental variants and city pieces are mapped', () => {
  const byKey = new Map(mapping.views.map((entry) => [entry.key, entry]))
  for (const key of ['bench-steel-2', 'bench-seat-2', 'bench-wood-2', 'door-steel-2', 'glass-1x4', 'platform-edge', 'track-run']) {
    assert.ok(byKey.has(key), `missing supplemental view ${key}`)
  }
  assert.equal(mapping.city.guangzhou['exit-canopy'], 'city:guangzhou:exit-canopy')
  for (const city of Object.keys(mapping.city)) {
    assert.ok(byKey.has(mapping.city[city]['exit-canopy']), `${city} exit canopy is not mapped`)
  }
})
