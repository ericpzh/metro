import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [inventoryPath, rigidPath, reportPath, flag] = process.argv.slice(2)
if (!inventoryPath || !rigidPath || !reportPath || (flag && flag !== '--strict')) {
  throw new Error('Usage: audit-model-lod-coverage.mjs <runtime inventory JSON> <rigid coverage CSV> <output JSON> [--strict]')
}

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
const [header, ...lines] = readFileSync(rigidPath, 'utf8').trim().split(/\r?\n/)
if (header !== 'prefab,meshes,threeTiers,reused,unresolved,hasMeshSource') {
  throw new Error('Regenerate the rigid coverage CSV with the current Unity Editor audit.')
}

const rigid = new Map()
for (const line of lines) {
  const row = /^"((?:[^"]|"")*)",(\d+),(\d+),(\d+),(\d+),(True|False)$/.exec(line)
  if (!row) throw new Error(`Malformed rigid coverage row ${line}`)
  const [, quotedPath, meshes, threeTiers, reused, unresolved, hasMeshSource] = row
  const path = quotedPath.replaceAll('""', '"')
  if (rigid.has(path)) throw new Error(`Duplicate rigid prefab ${path}`)
  rigid.set(path, {
    meshes: Number(meshes), threeTiers: Number(threeTiers), reused: Number(reused),
    unresolved: Number(unresolved), hasMeshSource: hasMeshSource === 'True',
  })
}

const generated = new Map([
  ['booth', 'Counter bodies, glazing and fascia stay intact. Lower tiers omit thin trim and kick rails.'],
  ['pillar', 'Round structural members use closed 32, 16, and 8 segment meshes.'],
  ['track', 'Track hardware omits bolts and clips across tiers. Rail heads and structure share the original geometry.'],
])
const retained = new Map([
  ['escalator', 'The generated step band, comb plate, landing, side shell and handrails retain their motion and section outlines.'],
  ['gate', 'The gate leaf and adjacent fence share the exact span, gaps, hinges and passable opening at every tier.'],
  ['glass', 'The span is already built from flat panes and straight frames. The same pane edges and cutaway extents define all tiers.'],
  ['lift', 'Generated cabin, door leaf and shaft surfaces retain the shape used for floor stops, motion and vertical cutaways.'],
  ['platform-edge', 'The run retains the platform edge, independent moving leaves, infill gaps and content surfaces at all tiers.'],
  ['psd-end', 'The end assembly retains exact return faces and meets the platform wall without opening seams.'],
  ['stair', 'Generated treads, landings, and rails retain their walk-contact and section silhouettes across tiers.'],
])

const models = inventory.unity.resolvedKeys.map(model => {
  const bake = rigid.get(model.prefabPath)
  let coverage = 'unresolved'
  let detail = 'No verified tier policy for this rendering path.'
  if ((model.classification === 'prefab' || model.classification === 'live-view') &&
    bake?.hasMeshSource && bake.unresolved === 0) {
    coverage = 'baked'
    detail = 'Every source mesh has three tiers or an explicit reuse record.'
  } else if (model.classification === 'generated' && model.types.every(type => generated.has(type))) {
    coverage = 'generated'
    detail = model.types.map(type => generated.get(type)).join(' ')
  } else if (model.classification === 'generated' && model.types.every(type => retained.has(type))) {
    coverage = 'retained'
    detail = model.types.map(type => retained.get(type)).join(' ')
  }
  return { ...model, coverage, detail, bake }
})

const counts = Object.fromEntries(['baked', 'generated', 'retained', 'unresolved']
  .map(status => [status, models.filter(model => model.coverage === status).length]))
const supplemental = [
  {
    key: 'station-cell-chunks',
    coverage: 'retained',
    detail: 'Blocks, walls, floors, and slab edges use the same exposed cell faces at all tiers. Cuts, face picks, finishes, and ambient shading depend on this geometry.',
  },
  {
    key: 'construction-and-catalogue-previews',
    coverage: 'retained',
    detail: 'Use Full so the preview shows the exact geometry used for placement.',
  },
  {
    key: 'train-formations',
    coverage: 'generated',
    detail: 'Compacted train bodies generate two reduced index ranges. Door motion remains on the original meshes.',
  },
  {
    key: 'local-passenger-library',
    coverage: 'generated',
    detail: 'The local catalogue binds compact skinned tiers to the existing rigs and verifies matching joint order and bind poses.',
  },
]
const projectReport = resolve(reportPath)
mkdirSync(dirname(projectReport), { recursive: true })
writeFileSync(projectReport, JSON.stringify({ schemaVersion: 1, counts, models, supplemental }, null, 2) + '\n')
console.log(JSON.stringify({ report: projectReport, ...counts }))
if (flag === '--strict' && counts.unresolved > 0) process.exitCode = 1
