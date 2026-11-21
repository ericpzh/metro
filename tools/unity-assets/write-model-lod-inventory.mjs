import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const strict = process.argv.slice(2).includes('--strict')
const [
  inventoryPath = '.preview/unity/model-lod-inventory.json',
  coveragePath = '.preview/unity/model-lod-coverage.json',
  passengerManifestPath = 'unity/Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json',
  passengerLodsPath = '.preview/unity/passenger-lod-library/passenger-lods.json',
  outputPath = '.agents/skills/metro-repo/references/unity-model-lod-inventory.md',
] = process.argv.slice(2).filter(arg => arg !== '--strict')

const inventory = JSON.parse(readFileSync(resolve(inventoryPath), 'utf8'))
const coverage = existsSync(resolve(coveragePath))
  ? JSON.parse(readFileSync(resolve(coveragePath), 'utf8'))
  : null

const pct = (low, high) => high > 0 ? `${((low / high) * 100).toFixed(1)}%` : '—'
const saved = row => row ? pct(row.lod0 - row.lod2, row.lod0) : '—'
const target = row => {
  if (!row || !Number.isInteger(row.lod0) || !Number.isInteger(row.lod2) ||
      row.lod0 < 0 || row.lod2 < 0 || row.lod2 > row.lod0) return 'Unmeasured'
  if (row.lod0 === 0 || (row.lod0 === 2 && row.lod2 === 2)) return 'Exception'
  return row.lod2 * 2 <= row.lod0 ? 'Pass' : 'Miss'
}
const targetCounts = rows => {
  const counts = { Pass: 0, Miss: 0, Exception: 0, Unmeasured: 0 }
  for (const row of rows) counts[target(row)] += row?.count ?? 1
  return counts
}

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
    const lod1 = lods?.lod1
    const lod2 = lods?.lod2
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
lines.push('## Low triangle target')
lines.push('')
lines.push('Low targets at least 50% fewer triangles than High for every model. A pass requires LOD2 × 2 ≤ LOD0 before rounding. Zero-triangle geometry and unchanged two-triangle quads are exceptions. The retained paths listed below have explicit geometry-preservation exceptions.')
lines.push('')
lines.push('| Model family | Pass | Miss | Exception | Unmeasured |')
lines.push('| --- | ---: | ---: | ---: | ---: |')
const targetFamilies = [
  ['Rigid prefabs', targetCounts(rigidSorted)],
  ['Procedural probes', targetCounts(inventory.generatedModules)],
  ['Train formations', targetCounts(inventory.trains)],
  ['Public stand-in passengers', targetCounts(inventory.publicPassengers)],
  ['Review-only passengers', targetCounts(passengerGroups)],
]
for (const [label, counts] of targetFamilies) {
  lines.push(`| ${label} | ${counts.Pass} | ${counts.Miss} | ${counts.Exception} | ${counts.Unmeasured} |`)
}
lines.push('')
lines.push('Regenerate from the open Unity Editor with:')
lines.push('```powershell')
lines.push('unity --no-banner --no-pager --format json command --project-path "$PWD/unity" --timeout 180 metro model_lod_inventory')
lines.push('node tools/unity-assets/write-model-lod-inventory.mjs')
lines.push('```')
lines.push('Pass `--strict` to exit with an error when an inventoried shipped model misses the target or lacks valid triangle counts.')
lines.push('')

// 1. Rigid prefabs
lines.push('## Rigid prefabs (equipment, decor & structures)')
lines.push('')
lines.push(
  'Every runtime rigid prefab under `unity/Assets/StationDesigner/Generated/Prefabs/` with its resolved `StationRigidModelLods` sidecar (`Resources/ModelLods/Rigid/<Prefab>.asset`), summed across all `MeshFilter` instances in the prefab and sorted descending by `LOD0` triangles. ' +
  'Native Mesh LOD baking tries deeper simplification levels to approach the Low triangle budget. Geometry that Unity cannot simplify and non-triangle topology such as court net lines retain their source geometry.',
)
lines.push('')
lines.push('| Prefab | Runtime keys | 3-tier meshes | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Target |')
lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |')
for (const r of rigidSorted) {
  const keys = keysByPrefab.get(r.prefab)
  const keyText = keys && keys.length > 0 ? keys.join(', ') : '—'
  const suffix = r.nonTriangleSubmeshes > 0 ? ` (+${r.nonTriangleSubmeshes} line)` : ''
  lines.push(
    `| \`${r.name}\` | ${keyText} | ${r.threeTiers} / ${r.distinctMeshes} | ${r.lod2} | ${r.lod1} | ${r.lod0}${suffix} | ${pct(r.lod2, r.lod0)} | ${target(r)} |`,
  )
}
lines.push('')

// 2. Generated & retained procedural modules
lines.push('## Generated & retained procedural modules')
lines.push('')
lines.push('Procedural C# builders that emit native 3-tier index ranges via `StationMeshLodIndices`:')
lines.push('')
lines.push('| Procedural model | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Target | Policy |')
lines.push('| --- | ---: | ---: | ---: | ---: | --- | --- |')
for (const g of inventory.generatedModules) {
  lines.push(`| ${g.name} | ${g.lod2} | ${g.lod1} | ${g.lod0} | ${pct(g.lod2, g.lod0)} | ${target(g)} | ${g.note} |`)
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
const trainSavings = inventory.trains
  .filter(row => row.lod0 > 0)
  .map(row => (row.lod0 - row.lod2) / row.lod0)
lines.push('## Train models (车辆)')
lines.push('')
lines.push(
  'All 50 selectable formations (`A`/`B`/`C`/`D`/`L` × 2, 3, 4, 6, or 8 cars × Third-rail / Catenary), measured after Unity runtime consist compaction (`TrainConsistViews.CompactConsistInstance`). ' +
  'Low uses baked geometry from the train exporter for car bodies, moving door leaves, gangways, and pantographs. The original door transforms, material slots, glass and signage stay in place. The compactor also omits selected small opaque details such as bolts, springs, straps, ring lights, and vents.',
)
lines.push('')
if (trainSavings.length) {
  lines.push(
    `Low submits **${pct(Math.min(...trainSavings), 1)}–${pct(Math.max(...trainSavings), 1)} fewer triangles** than High per formation when the whole formation uses LOD2. ` +
    'The buffers carry the High and Low geometry together. These are triangle counts for the selected tier. The camera and graphics profile determine when the renderer selects each tier.',
  )
  lines.push('')
}
lines.push('| Train model | Third-rail LOD2 | Third-rail LOD1 | Third-rail LOD0 | Third-rail saved | Catenary LOD2 | Catenary LOD1 | Catenary LOD0 | Catenary saved |')
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const row of trainList) {
  const tr = row.thirdRail
  const cat = row.catenary
  lines.push(
    `| ${row.id} | ${tr?.lod2 ?? '—'} | ${tr?.lod1 ?? '—'} | ${tr?.lod0 ?? '—'} | ${saved(tr)} (${target(tr)}) | ${cat?.lod2 ?? '—'} | ${cat?.lod1 ?? '—'} | ${cat?.lod0 ?? '—'} | ${saved(cat)} (${target(cat)}) |`,
  )
}
lines.push('')

// 4. Passengers
lines.push('## Passenger models (乘客)')
lines.push('')
lines.push('### Public stand-in passenger assets')
lines.push('')
lines.push('| Asset | Meshes | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Target |')
lines.push('| --- | ---: | ---: | ---: | ---: | --- |')
for (const p of inventory.publicPassengers) {
  lines.push(`| \`${p.name}\` | ${p.meshes} | ${p.lod2} | ${p.lod1} | ${p.lod0} | ${target(p)} |`)
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
  lines.push('| Variants | LOD2 (Low) | LOD1 (Balanced) | LOD0 (High) | Low / High | Target |')
  lines.push('| ---: | ---: | ---: | ---: | ---: | --- |')
  for (const g of passengerGroups) {
    const ratio = g.lod2 === undefined ? '—' : pct(g.lod2, g.lod0)
    lines.push(`| ${g.count} | ${g.lod2 ?? '—'} | ${g.lod1 ?? '—'} | ${g.lod0} | ${ratio} | ${target(g)} |`)
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
  lowTarget: Object.fromEntries(targetFamilies),
}))
if (strict && targetFamilies.slice(0, -1).some(([, counts]) => counts.Miss || counts.Unmeasured)) {
  console.error('The shipped model inventory misses the Low triangle target.')
  process.exitCode = 1
}
