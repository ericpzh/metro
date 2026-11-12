// Upsert one recipe row into unity/asset-recipes/catalogue.json.
//
// Several model families can be claimed at once, so the catalogue is a shared
// file. This script serializes the read/modify/write behind a lock file instead
// of asking each agent to hand-edit the same JSON tail.
//
//   node tools/unity-assets/catalogue-add.mjs <row.json>
//
// The input is one JSON object in the shape of an existing `families` entry.
// The row is updated in place when its id already exists, otherwise appended.
import assert from 'node:assert/strict'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cataloguePath = resolve(here, '../../unity/asset-recipes/catalogue.json')
const lockPath = cataloguePath + '.lock'
const input = process.argv[2]
assert(input, 'usage: node tools/unity-assets/catalogue-add.mjs <row.json>')

const row = JSON.parse(await readFile(resolve(input), 'utf8'))
for (const key of ['id', 'catalogueId', 'family', 'category', 'sourcePaths', 'owner', 'provenance', 'licenseRecord', 'classification', 'variants', 'anchors', 'expected', 'triangles', 'materials', 'alphaMaterials', 'textures', 'lod', 'validationScene', 'promoted', 'exportCommand', 'proofCommand']) {
  assert(key in row, `recipe row is missing ${key}`)
}
assert(row.id.startsWith('station.'), 'recipe id must be namespaced station.*')
assert(Array.isArray(row.sourcePaths) && row.sourcePaths.length > 0, 'sourcePaths must be non-empty')
for (const path of Object.values(row.promoted)) assert(path.startsWith('Assets/StationDesigner/Generated/'), `promoted path not under the generated tree: ${path}`)
for (const [name, anchor] of Object.entries(row.anchors)) {
  assert(Array.isArray(anchor) && anchor.length === 3 && anchor.every(v => typeof v === 'number'), `bad anchor ${name}`)
}
assert(row.expected.units === 'metres' && row.expected.min.length === 3 && row.expected.max.length === 3, 'expected must carry metre min/max')

const deadline = Date.now() + 60_000
let lock
while (!lock) {
  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (Date.now() > deadline) throw new Error(`catalogue lock stayed held: ${lockPath}`)
    await new Promise(done => setTimeout(done, 100))
  }
}

try {
  const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'))
  assert.equal(catalogue.schemaVersion, 1, 'unexpected catalogue schemaVersion')
  assert(Array.isArray(catalogue.families), 'catalogue families missing')
  const existing = catalogue.families.findIndex(entry => entry.id === row.id)
  if (existing >= 0) catalogue.families[existing] = row
  else catalogue.families.push(row)
  const duplicate = catalogue.families.filter(entry => entry.id === row.id)
  assert.equal(duplicate.length, 1, 'duplicate recipe id after upsert')
  const temp = cataloguePath + '.tmp'
  await writeFile(temp, JSON.stringify(catalogue, null, 2) + '\n')
  await rename(temp, cataloguePath)
  console.log(`CATALOGUE_OK ${row.id}${existing >= 0 ? ' updated' : ' added'}`)
} finally {
  await lock.close()
  await unlink(lockPath).catch(() => {})
}
