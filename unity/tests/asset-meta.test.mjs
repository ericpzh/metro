// Every texture in the repo must carry a `.meta` with a real importer block.
//
// Plan 13 §2: the staged finish PNGs were committed with `fileFormatVersion` + `guid`
// only. That is a valid stub for a TextAsset or a folder, but Unity re-derives a
// texture's importer from the extension and, with no `TextureImporter:` block to read,
// imported all 22 as **Cubemaps** — so `Resources.Load<Texture2D>` returned null for
// every finish and the player drew untextured white slabs. The Editor-side
// `StationFinishLibraryTests` pins that the staged library binds its maps; this Node
// test catches the same class of defect at the source, before Unity is ever opened: a
// texture meta that Unity would not import as a texture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '../..')
const assets = join(root, 'unity/Assets')
const textureExtensions = ['.png', '.jpg', '.jpeg', '.tga', '.exr']

function walk(directory, result = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) { walk(path, result); continue }
    if (!name.endsWith('.meta')) result.push(path)
  }
  return result
}

test('every Unity texture has a TextureImporter meta, not a GUID-only stub', () => {
  const stubs = []
  for (const path of walk(assets)) {
    if (!textureExtensions.some(extension => path.toLowerCase().endsWith(extension))) continue
    const meta = readFileSync(`${path}.meta`, 'utf8')
    const label = relative(root, path).replaceAll('\\', '/')
    assert.match(meta, /^fileFormatVersion: 2$/m, `${label} has a malformed meta`)
    assert.match(meta, /^guid: [0-9a-f]{32}$/m, `${label} has no GUID`)
    if (!meta.includes('TextureImporter:')) stubs.push(label)
  }
  assert.deepEqual(stubs, [],
    'a texture without a TextureImporter block imports as a Cubemap and Resources.Load<Texture2D> returns null:\n' +
    stubs.join('\n'))
})

test('every staged finish albedo is a real image the export names', () => {
  const stage = join(assets, 'StationDesigner/Resources/StationFinishes')
  const exportJson = JSON.parse(readFileSync(join(stage, 'finishes.json'), 'utf8'))
  const missing = []
  for (const entry of exportJson.finishes) {
    const path = join(stage, entry.albedo.replaceAll('/', '\\'))
    if (!statSync(path, { throwIfNoEntry: false })) missing.push(entry.id + ' -> ' + entry.albedo)
  }
  assert.deepEqual(missing, [], 'the staged export is missing albedo files')
  assert.ok(exportJson.finishes.length >= 20, 'the export carries the finish library')
})
