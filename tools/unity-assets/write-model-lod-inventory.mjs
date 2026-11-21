import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [
  inventoryPath = '.preview/unity/model-lod-inventory.json',
  coveragePath = '.preview/unity/model-lod-coverage.json',
  passengerManifestPath = 'unity/Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json',
  passengerLodsPath = '.preview/unity/passenger-lod-library/passenger-lods.json',
  outputPath = '.agents/skills/metro-repo/references/unity-model-lod-inventory.md',
] = process.argv.slice(2)

const inventory = JSON.parse(readFileSync(resolve(inventoryPath), 'utf8'))
const coverage = existsSync(resolve(coveragePath))
  ? JSON.parse(readFileSync(resolve(coveragePath), 'utf8'))
  : null

const pct = (low, high) => high > 0 ? `${((low / high) * 100).toFixed(1)}%` : '—'

// Map prefabPath -> runtime keys from model-lod-coverage.json
const keysByPrefab = new Map()
if (coverage?.models) {
  for (const m of coverage.models) {
    if (!m.prefabPath) continue
    const list = keysByPrefab.get(m.prefabPath) ?? []
    list.push(m.key)
    keysByPrefab.set(m.prefabPath, list)
  }
}

const rigidSorted = [...inventory.rigidPrefabs].sort(
  (a, b) => b.lod0 - a.lod0 || a.name.localeCompare(b.name),
)
const rigidReducedCount = rigidSorted.filter(r => r.lod2 < r.lod0).length
const totalRigidMeshes = rigidSorted.reduce((s, r) => s + r.distinctMeshes, 0)
const totalRigidThreeTiers = rigidSorted.reduce((s, r) => s + r.threeTiers, 0)

// Group 50 train formations into A/B/C/D/L x 2/3/4/6/8 rows
const trainRows = new Map()
for (const tr of inventory.trains) {
  const match = /^Formation([A-Z])(\d+)(ThirdRail|Overhead)(?:Zoo)?$/.exec(tr.name)
  if (!match) continue
  const [, stock, cars, power] = match
  const id = `${stock}-${cars}`
  const row = trainRows.get(id) ?? { stock, cars: Number(cars), id }
  row[power === 'ThirdRail' ? 'thirdRail' : 'catenary'] = tr
  trainRows.set(id, row)
}
const trainList = [...trainRows.values()].sort(
  (a, b) => a.stock.localeCompare(b.stock) || a.cars - b.cars,
)

// Local passenger LOD groups (440 variants)
let passengerGroups = []
let passengerTotal = 0
if (existsSync(resolve(passengerManifestPath)) && existsSync(resolve(passengerLodsPath))) {
  const pm = JSON.parse(readFileSync(resolve(passengerManifestPath), 'utf8'))
  const pl = JSON.parse(readFileSync(resolve(passengerLodsPath), 'utf8'))
  const byRecipe = new Map()
  for (const item of pl.assets) {
    const entry = byRecipe.get(item.recipe) ?? {}
    if (item.tier === 1) entry.lod1 = item.triangles
    if (item.tier === 2) entry.lod2 = item.triangles
    byRecipe.set(item.recipe, entry)
  }
  const groups = new Map()
  for (const asset of pm.assets) {
    const lods = byRecipe.get(asset.id)
    const lod0 = asset.triangles
    const lod1 = lods?.lod1 ?? lod0
    const lod2 = lods?.lod2 ?? asset.low?.triangles ?? lod0
    const key = `${lod0}/${lod1}/${lod2}`
    const g = groups.get(key) ?? { count: 0, lod0, lod1, lod2 }
    g.count++
    groups.set(key, g)
    passengerTotal++
  }
  passengerGroups = [...groups.values()].sort(
    (a, b) => b.lod0 - a.lod0 || b.lod1 - a.lod1 || b.lod2 - a.lod2,
  )
}

const lines = []
lines.push('# Unity per-model LOD geometry inventory')
lines.push('')
lines.push(
  `Measured triangle counts for Unity \`${inventory.unityVersion}\` native 3-tier Mesh LODs (\`LOD0\` High / full, \`LOD1\` Balanced / reduced, \`LOD2\` Low / simplified). ` +
  'Counts are per-model geometry inventory across all triangle submeshes, not station totals, draw-call counts, or FPS estimates. ' +
  'See [performance.md](performance.md#unity-native-mesh-lod-generation) for methodology, frame-rate captures, and open gates, and [editor-action-matrix.md](editor-action-matrix.md) for the web editor action matrix.',
)
lines.push('')
lines.push(
  `Summary: **${rigidSorted.length} rigid prefabs** (${rigidReducedCount} with \`LOD2 < LOD0\`, ${totalRigidThreeTiers} / ${totalRigidMeshes} distinct meshes carrying 3 baked tiers), ` +
  `**${inventory.generatedModules.length} procedural LOD probes**, **${inventory.trains.length} runtime compacted train formations**, ` +
  `**${inventory.publicPassengers.length} public stand-in passenger assets**, and **${passengerTotal} local soft-human passenger variants**.`,
)
lines.push('')
lines.push('Regenerate from the open Unity Editor with:')
lines.push('```powershell')
lines.push('unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 180 metro model_lod_inventory')
lines.push('node tools/unity-assets/write-model-lod-inventory.mjs')
lines.push('```')
lines.push('')

// 1. Rigid prefabs
lines.push('## Rigid prefabs (equipment, decor & structures)')
lines.push('')
lines.push(
  'Every runtime rigid prefab under `unity/Assets/StationDesigner/Generated/Prefabs/` with its resolved `StationRigidModelLods` sidecar (`Resources/ModelLods/Rigid/<Prefab>.asset`), summed across all `MeshFilter` instances in the prefab and sorted descending by `LOD0` triangles. ' +
  'Meshes where Unity `MeshLodUtility.GenerateMeshLods(mesh, 2)` could not simplify further (or that use non-triangle topology such as court net lines) reuse `LOD0` across tiers.',
)
lines.push('')
lines.push('| Prefab | Runtime keys | 3-tier meshes | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High |')
lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |')
for (const r of rigidSorted) {
  const keys = keysByPrefab.get(r.prefab)
  const keyText = keys && keys.length > 0 ? keys.join(', ') : '—'
  const suffix = r.nonTriangleSubmeshes > 0 ? ` (+${r.nonTriangleSubmeshes} line)` : ''
  lines.push(
    `| \`${r.name}\` | ${keyText} | ${r.threeTiers} / ${r.distinctMeshes} | ${r.lod2} | ${r.lod1} | ${r.lod0}${suffix} | ${pct(r.lod2, r.lod0)} |`,
  )
}
lines.push('')

// 2. Generated & retained procedural modules
lines.push('## Generated & retained procedural modules')
lines.push('')
lines.push('Procedural C# builders that emit native 3-tier index ranges via `StationMeshLodIndices`:')
lines.push('')
lines.push('| Procedural model | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Policy |')
lines.push('| --- | ---: | ---: | ---: | ---: | --- |')
for (const g of inventory.generatedModules) {
  lines.push(`| ${g.name} | ${g.lod2} | ${g.lod1} | ${g.lod0} | ${pct(g.lod2, g.lod0)} | ${g.note} |`)
}
lines.push('')
lines.push('Explicitly retained procedural paths (same geometry across `LOD0`–`LOD2` to preserve motion, walk-contact, cutaway, or pick fidelity):')
lines.push('')
lines.push('| Family / system | Policy |')
lines.push('| --- | --- |')
lines.push('| `escalator` | Step band, comb plate, landing, side shell, and handrails retain motion and section outlines. |')
lines.push('| `gate` | Gate leaf and adjacent fence retain exact span, gaps, hinges, and passable opening. |')
lines.push('| `glass` | Already built from flat panes and straight frames; pane edges and cutaway extents stay exact. |')
lines.push('| `lift` | Cabin, door leaf, and shaft surfaces retain floor stops, motion, and vertical cutaways. |')
lines.push('| `platform-edge` | Retains platform edge, independent moving leaves, infill gaps, and content surfaces. |')
lines.push('| `psd-end` | Retains exact return faces meeting the platform wall without opening seams. |')
lines.push('| `stair` | Treads, landings, and rails retain walk-contact and section silhouettes. |')
lines.push('| `station-cell-chunks` | Exposed cell faces stay exact across tiers for cuts, face picks, finishes, and ambient shading. |')
lines.push('| `construction-and-catalogue-previews` | Uses `LOD0` (Full) so previews match placed geometry. |')
lines.push('')

// 3. Trains
lines.push('## Train models (车辆)')
lines.push('')
lines.push(
  'All 50 selectable formations (`A`/`B`/`C`/`D`/`L` × 2–8 cars × Third-rail / Catenary), measured after Unity runtime consist compaction (`TrainConsistViews.CompactConsistInstance`). ' +
  'Compacted car bodies drop decorative faces across `LOD1` and `LOD2` while retaining independent animated door leaves on their original meshes.',
)
lines.push('')
lines.push('| Train model | Third-rail LOD2 | Third-rail LOD1 | Third-rail LOD0 | Catenary LOD2 | Catenary LOD1 | Catenary LOD0 |')
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const row of trainList) {
  const tr = row.thirdRail
  const cat = row.catenary
  lines.push(
    `| ${row.id} | ${tr?.lod2 ?? '—'} | ${tr?.lod1 ?? '—'} | ${tr?.lod0 ?? '—'} | ${cat?.lod2 ?? '—'} | ${cat?.lod1 ?? '—'} | ${cat?.lod0 ?? '—'} |`,
  )
}
lines.push('')

// 4. Passengers
lines.push('## Passenger models (乘客)')
lines.push('')
lines.push('### Public stand-in passenger assets')
lines.push('')
lines.push('| Asset | Meshes | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) |')
lines.push('| --- | ---: | ---: | ---: | ---: |')
for (const p of inventory.publicPassengers) {
  lines.push(`| \`${p.name}\` | ${p.meshes} | ${p.lod2} | ${p.lod1} | ${p.lod0} |`)
}
lines.push('')
if (passengerGroups.length > 0) {
  lines.push(`### Local soft-human passenger library (${passengerTotal} variants, review-only)`)
  lines.push('')
  lines.push(
    `All ${passengerTotal} local soft-human passenger recipes (\`INTERNAL_REVIEW_ONLY\`), grouped when exact \`LOD0\` / \`LOD1\` / \`LOD2\` triangle counts match. ` +
    'Source counts come from `passenger-library.manifest.json` (`LOD0`) and `.preview/unity/passenger-lod-library/passenger-lods.json` (`LOD1`, `LOD2`).',
  )
  lines.push('')
  lines.push('| Variants | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High |')
  lines.push('| ---: | ---: | ---: | ---: | ---: |')
  for (const g of passengerGroups) {
    lines.push(`| ${g.count} | ${g.lod2} | ${g.lod1} | ${g.lod0} | ${pct(g.lod2, g.lod0)} |`)
  }
  lines.push('')
}

const out = resolve(outputPath)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, lines.join('\n'))
console.log(JSON.stringify({
  output: out,
  rigidPrefabs: rigidSorted.length,
  rigidReducedCount,
  generatedModules: inventory.generatedModules.length,
  trainFormations: inventory.trains.length,
  passengerGroups: passengerGroups.length,
  passengerTotal,
}))
