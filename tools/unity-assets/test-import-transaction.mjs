import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const project = resolve(process.argv[2] ?? '')
const out = resolve(process.argv[3] ?? '')
const base = resolve(root, '.preview/unity') + sep
if (!project.startsWith(base) || !out.startsWith(base)) throw Error('Project and evidence must be beneath .preview/unity')
mkdirSync(out, { recursive: true })
const digest = b => createHash('sha256').update(b).digest('hex')
const manifest = JSON.parse(readFileSync(join(root, 'unity/asset-recipes/fixture-manifest.json')))
const original = readFileSync(join(root, manifest.assets[0].source))
const changed = Buffer.from(original)
const marker = Buffer.from('THREE.GLTFExporter r186')
const index = changed.indexOf(marker)
if (index < 20 || index + marker.length > 20 + changed.readUInt32LE(12)) throw Error('Expected generator marker absent from GLB JSON')
changed[index + marker.length - 1] = 55 // r186 -> r187; unchanged geometry and asset structure.
const changedPath = join(out, 'bench-changed.glb')
writeFileSync(changedPath, changed)
manifest.assets[0].source = relative(root, changedPath).replaceAll('\\', '/')
manifest.assets[0].sha256 = digest(changed)
// A real, digest-matching GLB in the train slot imports successfully but does
// not satisfy the train's Unity material validation. Bind the oracle to that
// digest too, so the test reaches Unity validation instead of preflight.
const oracle = JSON.parse(readFileSync(join(root, manifest.assets[1].motionOracle)))
oracle.sha256 = digest(changed)
const oraclePath = join(out, 'invalid-train-oracle.json')
writeFileSync(oraclePath, JSON.stringify(oracle))
manifest.assets[1].source = manifest.assets[0].source
manifest.assets[1].sha256 = manifest.assets[0].sha256
manifest.assets[1].motionOracle = relative(root, oraclePath).replaceAll('\\', '/')
manifest.assets[1].motionOracleSha256 = digest(readFileSync(oraclePath))
const badManifest = join(out, 'invalid-second.json')
writeFileSync(badManifest, JSON.stringify(manifest, null, 2))
const generated = join(project, 'Assets/StationDesigner/Generated')
function inventory(dir) {
  const files = []
  for (const e of readdirSync(dir, {withFileTypes:true})) {
    const path = join(dir, e.name)
    if (e.isDirectory()) files.push(...inventory(path))
    else if (e.isFile()) files.push([relative(generated, path).replaceAll('\\','/'), digest(readFileSync(path))])
  }
  return files.sort((a,b) => a[0].localeCompare(b[0]))
}
const before = inventory(generated)
const wrapper = join(root, 'unity/scripts/metro-unity.ps1')
const command = ['-NoProfile','-File',wrapper,'import-assets','-Manifest',badManifest,'-ProjectPath',project,'-OutputDirectory',out]
const run = spawnSync('pwsh', command, {cwd:root, encoding:'utf8', timeout:300000})
writeFileSync(join(out,'command-console.log'), (run.stdout ?? '') + (run.stderr ?? ''))
if (run.error) throw run.error
if (run.status === 0) throw Error('Invalid second GLB unexpectedly imported')
const log = readFileSync(join(out, 'import-assets-EditMode-Development.log'), 'utf8')
if (!/Missing material: train\.A\.two-car\.catenary/.test(log)) throw Error('Import failed for an unexpected reason')
const after = inventory(generated)
writeFileSync(join(out, 'inventories.json'), JSON.stringify({before, after}, null, 2))
if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Delivered assets changed after rejected batch')
console.log(`PASS: changed first GLB and digest-matching invalid second GLB; ${before.length} delivered files unchanged`)
