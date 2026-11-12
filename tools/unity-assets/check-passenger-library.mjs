import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Verify the promoted soft-human passenger library in the real Unity project.
//
// The 440 prefabs were built in a GUID-preserving scratch copy of the project, so
// this check proves the copied-back bytes still line up with the real project:
// every inventory row links to a prefab, every prefab references its recipe GLB
// by the GUID its .meta declares, every referenced GUID resolves in the project
// and every GLB matches the sha256 the export manifest recorded.
//
// RIGHTS: these assets are INTERNAL_REVIEW_ONLY. This check never claims
// production clearance; passenger-production-rig stays BLOCKED.

const repo = resolve(import.meta.dirname, '../..')
const planPath = 'unity/plan/soft-human-model-inventory.md'
const generated = 'unity/Assets/StationDesigner/Generated'
const passengers = generated + '/Passengers'
const prefabRoot = passengers
const modelRoot = passengers + '/Models'

const read = path => readFileSync(resolve(repo, path), 'utf8')

// ---------------------------------------------------------------------------
// 1. The inventory table: 440 rows, one recipe id each, one prefab link each.
// ---------------------------------------------------------------------------
const plan = read(planPath)
const tableStart = plan.indexOf('| Index | Exact recipe ID | Wardrobe category | Outfit | Accessory | Unity review |')
assert.ok(tableStart >= 0, 'The 440-row inventory table is missing')
const tableEnd = plan.indexOf('\n\n', tableStart)
const lines = plan.slice(tableStart, tableEnd).split('\n')
const header = lines[0]
const rows = lines.slice(2).filter(line => line.startsWith('|'))

const rowPattern = /^\| (\d+) \| `([^`]+)` \| (male|female) \| `([^`]+)` \| `([^`]+)` \| (.+?) \|$/
const recipes = rows.map(line => {
  const match = rowPattern.exec(line.trim())
  assert.ok(match, `Unparseable inventory row: ${line}`)
  const [, index, id, sex, outfit, accessory, review] = match
  return { index: Number(index), id, sex, outfit, accessory, review: review.trim() }
})
assert.equal(recipes.length, 440, `The inventory table has ${recipes.length} rows, expected 440`)
assert.equal(new Set(recipes.map(row => row.id)).size, 440, 'The inventory repeats a recipe id')
recipes.forEach((row, position) => assert.equal(row.index, position, `Inventory index ${row.index} is out of order`))

const layout = (sex, outfit) => `${sex === 'male' ? 'Male' : 'Female'}/${outfit}`
// Manifest paths are project-relative; file checks are repo-relative.
const assetRoot = 'Assets/StationDesigner/Generated/Passengers'
const modelAsset = row => `${assetRoot}/Models/${layout(row.sex, row.outfit)}/${row.id}.glb`
const prefabAsset = row => `${assetRoot}/${layout(row.sex, row.outfit)}/${row.id}.prefab`
const expectedModel = row => `unity/${modelAsset(row)}`
const expectedPrefab = row => `unity/${prefabAsset(row)}`

const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/
let linked = 0
for (const row of recipes) {
  assert.ok(!row.review.includes('—'), `${row.id}: the Unity review column still has a dash`)
  const match = linkPattern.exec(row.review)
  assert.ok(match, `${row.id}: no prefab link in "${row.review}"`)
  const [, label, target] = match
  const absolute = resolve(repo, 'unity/plan', target)
  assert.ok(existsSync(absolute), `${row.id}: link target ${target} does not exist`)
  assert.equal(relative(repo, absolute).replaceAll('\\', '/'), expectedPrefab(row),
    `${row.id}: link target ${target} is not the recipe prefab`)
  assert.ok(existsSync(resolve(repo, expectedModel(row))), `${row.id}: missing ${expectedModel(row)}`)
  assert.ok(label.length > 0, `${row.id}: empty link label`)
  linked++
}
assert.equal(linked, 440, `Only ${linked} of 440 rows link to a prefab`)

// ---------------------------------------------------------------------------
// 2. The promoted manifest and the exact asset set.
// ---------------------------------------------------------------------------
const manifest = JSON.parse(read(`${passengers}/passenger-library.manifest.json`))
assert.equal(manifest.family, 'passenger-library')
assert.equal(manifest.rights.status, 'INTERNAL_REVIEW_ONLY', `Rights status ${manifest.rights.status}`)
assert.match(manifest.rights.production, /BLOCKED/, 'The manifest does not keep the production rig blocked')
assert.match(manifest.rights.license, /no redistribution/, 'The manifest lost the missing-licence record')
assert.equal(manifest.assets.length, 440, `The manifest lists ${manifest.assets.length} assets`)
assert.equal(manifest.parameters.models, 440)
assert.equal(manifest.parameters.boneCount, 16)
assert.equal(manifest.parameters.clipCount, 49)
assert.deepEqual(manifest.validation, { errors: 0, warnings: 0 }, 'The exporter recorded validation issues')
assert.equal(manifest.failures.length, 0, 'The export recorded failures')

const byId = new Map(manifest.assets.map(asset => [asset.recipe, asset]))
assert.equal(byId.size, 440, 'The manifest repeats a recipe id')
for (const row of recipes) {
  const asset = byId.get(row.id)
  assert.ok(asset, `${row.id}: not in the manifest`)
  assert.equal(asset.sex, row.sex, `${row.id}: sex ${asset.sex} != ${row.sex}`)
  assert.equal(asset.outfit, row.outfit, `${row.id}: outfit ${asset.outfit} != ${row.outfit}`)
  assert.equal(asset.accessory, row.accessory, `${row.id}: accessory ${asset.accessory} != ${row.accessory}`)
  assert.equal(asset.modelPath, modelAsset(row), `${row.id}: model path`)
  assert.equal(asset.prefabPath, prefabAsset(row), `${row.id}: prefab path`)
  assert.equal(asset.rights, 'INTERNAL_REVIEW_ONLY', `${row.id}: rights ${asset.rights}`)
  assert.equal(asset.role, 'adult', `${row.id}: role ${asset.role}`)
  assert.equal(asset.detail, 'full', `${row.id}: detail ${asset.detail}`)
  assert.equal(asset.fit, 1, `${row.id}: fit ${asset.fit}`)
  assert.deepEqual(asset.scale, [1, 1, 1], `${row.id}: canonical scale`)
  assert.equal(asset.boneCount, 16, `${row.id}: joint count`)
  assert.equal(asset.bones.length, 16, `${row.id}: joint table`)
  assert.equal(asset.clips.length, 49, `${row.id}: clip count`)
  assert.equal(asset.materials.length >= 3, true, `${row.id}: material regions`)
  assert.ok(asset.regionTriangles.top > 0 && asset.regionTriangles.bottom > 0, `${row.id}: outfit regions`)
  if (row.accessory === 'none') assert.equal(asset.accessoryRecord.triangles, 0, `${row.id}: unbagged accessory`)
  else assert.ok(asset.accessoryRecord.triangles > 0, `${row.id}: accessory geometry missing`)
}

// ---------------------------------------------------------------------------
// 3. Project-wide GUID index and the prefab references.
// ---------------------------------------------------------------------------
function walk(directory) {
  const out = []
  for (const entry of readdirSync(resolve(repo, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

const assetFiles = walk('unity/Assets')
const guidByPath = new Map()
const guidOwners = new Map()
for (const path of assetFiles) {
  if (!path.endsWith('.meta')) continue
  const match = /^guid: ([0-9a-f]{32})$/m.exec(readFileSync(resolve(repo, path), 'utf8'))
  if (!match) continue
  const asset = path.slice(0, -5)
  guidByPath.set(asset, match[1])
  assert.ok(!guidOwners.has(match[1]) || guidOwners.get(match[1]) === asset,
    `GUID ${match[1]} is used by both ${guidOwners.get(match[1])} and ${asset}`)
  guidOwners.set(match[1], asset)
}
const fileIds = new Set()
for (const row of recipes) {
  const path = expectedPrefab(row)
  const text = read(path)
  const match = /m_SourcePrefab: \{fileID: (-?\d+), guid: ([0-9a-f]{32}), type: 3\}/.exec(text)
  assert.ok(match, `${path}: no source prefab reference`)
  fileIds.add(match[1])
  assert.ok(guidOwners.has(match[2]), `${row.id}: the referenced GLB GUID ${match[2]} is missing`)
}
assert.equal(fileIds.size, 1, 'The 440 prefabs disagree on the imported model fileID')
const expectedModelFileId = [...fileIds][0]

let prefabBytes = 0
for (const row of recipes) {
  const prefabPath = expectedPrefab(row)
  const modelPath = expectedModel(row)
  const prefab = read(prefabPath)
  prefabBytes += Buffer.byteLength(prefab)
  const recipeGuid = guidByPath.get(modelPath)
  assert.ok(recipeGuid, `${row.id}: the GLB has no .meta GUID`)

  const rootName = /^\s+m_Name: (.+)$/m.exec(prefab)
  assert.ok(rootName && rootName[1].trim() === row.id, `${row.id}: prefab root is ${rootName?.[1]}`)
  const nameMatch = /propertyPath: m_Name\r?\n\s+value: (.+?)\r?\n/.exec(prefab)
  if (nameMatch) assert.equal(nameMatch[1].trim(), row.id, `${row.id}: prefab model name ${nameMatch[1]}`)

  const source = /m_SourcePrefab: \{fileID: (-?\d+), guid: ([0-9a-f]{32}), type: 3\}/.exec(prefab)
  assert.ok(source, `${row.id}: prefab has no source prefab reference`)
  assert.equal(source[2], recipeGuid, `${row.id}: prefab references GUID ${source[2]}, expected ${recipeGuid}`)
  assert.equal(source[1], expectedModelFileId, `${row.id}: model fileID ${source[1]} differs from the reviewed samples`)
  fileIds.add(source[1])

  for (const match of prefab.matchAll(/guid: ([0-9a-f]{32})/g)) {
    assert.ok(guidOwners.has(match[1]), `${row.id}: dangling GUID ${match[1]} in ${prefabPath}`)
  }
  // Every reference must be the recipe GLB; nothing else may leak in.
  const referencedGuids = new Set([...prefab.matchAll(/guid: ([0-9a-f]{32})/g)].map(match => match[1]))
  assert.deepEqual([...referencedGuids], [recipeGuid], `${row.id}: unexpected references ${[...referencedGuids]}`)
  assert.ok(existsSync(resolve(repo, `${prefabPath}.meta`)), `${row.id}: prefab has no .meta`)
}
assert.equal(fileIds.size, 1, 'The 440 prefabs disagree on the imported model fileID')

// ---------------------------------------------------------------------------
// 4. Bytes, counts per sex/outfit and the untouched review samples.
// ---------------------------------------------------------------------------
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
let modelBytes = 0
for (const asset of manifest.assets) {
  const bytes = readFileSync(resolve(repo, expectedModel(asset)))
  modelBytes += bytes.length
  assert.equal(sha(bytes), asset.sha256, `${asset.recipe}: the promoted GLB does not match the validated export`)
  assert.equal(bytes.length, asset.bytes, `${asset.recipe}: byte length changed`)
}

const perSex = recipes.reduce((map, row) => (map[row.sex] = (map[row.sex] ?? 0) + 1, map), {})
assert.deepEqual(perSex, { male: 220, female: 220 }, `Sex split ${JSON.stringify(perSex)}`)
const perOutfit = new Map()
for (const row of recipes) {
  const key = `${row.sex}/${row.outfit}`
  perOutfit.set(key, (perOutfit.get(key) ?? 0) + 1)
}
assert.equal(perOutfit.size, 40, `${perOutfit.size} sex/outfit groups, expected 40`)
for (const [key, count] of perOutfit) assert.equal(count, 11, `${key}: ${count} accessories, expected 11`)

console.log(`PASSENGER_LIBRARY_INVENTORY ${recipes.length}/440 rows, ${linked}/440 prefab links, 0 dashes`)
console.log(`PASSENGER_LIBRARY_GUIDS 440/440 prefabs reference their GLB GUID (fileID ${expectedModelFileId}); ` +
  `no dangling references in ${assetFiles.length} asset metas`)
console.log(`PASSENGER_LIBRARY_FILES ${(modelBytes / 1024 / 1024).toFixed(0)} MB of verified GLBs, ` +
  `${(prefabBytes / 1024).toFixed(0)} KB of prefabs, 40 sex/outfit folders x 11 accessories`)
console.log('PASSENGER_LIBRARY_RIGHTS INTERNAL_REVIEW_ONLY production-rig=BLOCKED ' +
  `licence=game-extract-no-redistribution source=${manifest.source.sha256.slice(0, 12)}`)
console.log('PASSENGER_LIBRARY 440/440 PASS')
