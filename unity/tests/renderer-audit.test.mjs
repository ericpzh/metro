import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Guard for unity/plan/renderer-source-audit.md. It is deliberately a source
// contract: everything it asserts is either parsed from the two plan files or
// from the renderer dispatch, and every filesystem check is local and fast.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const AUDIT = 'unity/plan/renderer-source-audit.md'
const CHECKLIST = 'unity/plan/model-migration-checklist.md'
const CATALOGUE = 'unity/asset-recipes/catalogue.json'
const MODELS = 'game/src/render/models.ts'

// The one catalogue id whose checklist row uses the canonical variant's name.
// `station.bench.seat-2` is the family sample record keyed `bench`; the
// `bench-seat-2` row covers it and points at the same prefab.
const SAMPLE_EXPORT_ALLOWLIST = new Set(['bench'])

const NO_RECIPE_CASES = new Set(['platform-edge', 'shop', 'booth', 'retail'])
const SAMPLE_ONLY_RECIPE_IDS = [
  'station.escalator.standard',
  'station.lift.standard',
  'station.walkway.standard',
  'station.hanger.roof',
  'station.track.bridge',
  'station.stair.straight',
  'station.stair.center-forward',
  'station.stair.left-180',
  'station.stair.left-90',
  'station.stair.left-forward',
  'station.stair.right-180',
  'station.stair.right-90',
  'station.stair.right-forward',
]
const CLASS_BY_PREFIX = { M: 'prefab', G: 'generator', L: 'live', X: 'exclusion' }
const INVENTORY_CLASSES = new Set(Object.values(CLASS_BY_PREFIX))

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return ''
  const level = (heading.match(/^#+/) ?? [''])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s/)
    if (match && match[1].length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

function tableRows(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.trim().split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 2) continue
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    rows.push(cells)
  }
  return rows
}

function reportedCount(markdown, label) {
  const pattern = new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*([0-9]+)\\s*\\|`, 'm')
  const match = markdown.match(pattern)
  assert.ok(match, `audit is missing the count row: ${label}`)
  return Number(match[1])
}

function checklistLines(markdown) {
  return markdown.split(/\r?\n/).filter((line) => line.trimStart().startsWith('|'))
}

function renderModuleClosure() {
  const seen = new Set()
  const queue = [path.join(ROOT, MODELS)]
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file) || !fs.existsSync(file)) continue
    seen.add(file)
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue
      const base = path.resolve(path.dirname(file), match[1])
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          queue.push(candidate)
          break
        }
      }
    }
  }
  return seen
}

const hasPlanDocs = fs.existsSync(path.join(ROOT, AUDIT)) && fs.existsSync(path.join(ROOT, CHECKLIST))
const planSkip = hasPlanDocs ? false : 'unity/plan/ is gitignored and absent in this checkout'
const audit = hasPlanDocs ? read(AUDIT) : ''
const checklist = hasPlanDocs ? read(CHECKLIST) : ''
const catalogue = JSON.parse(read(CATALOGUE))
const models = read(MODELS)

const dispatchSource = models.slice(models.indexOf('function buildRawModule'), models.indexOf('export type { ModelMaterials'))
const dispatchCases = [...dispatchSource.matchAll(/case '([^']+)'/g)].map((match) => match[1])
const dispatchBuilders = [...dispatchSource.matchAll(/new ([A-Za-z]+)\(ctx\)/g)].map((match) => match[1])
const uniqueBuilders = new Set(dispatchBuilders)

const catalogueIds = catalogue.families.map((record) => record.catalogueId)
const uniqueCatalogueIds = new Set(catalogueIds)
const duplicateCatalogueKeys = [...uniqueCatalogueIds].filter(
  (id) => catalogueIds.filter((candidate) => candidate === id).length > 1,
)

const checklistRows = []
for (const line of checklistLines(checklist)) {
  const match = line.match(/^\|\s*`([^`\n]+)`\s*\|/)
  if (match) checklistRows.push({ id: match[1], line, status: (line.split('|')[3] ?? '').trim() })
}
const checklistIds = new Set(checklistRows.map((row) => row.id))

// Every Unity asset a row links, and the promoted-prefab subset, are validated.
const assetLinks = new Set()
const prefabLinks = new Set()
for (const line of checklistLines(checklist)) {
  for (const match of line.matchAll(/\]\(([^)]+)\)/g)) {
    if (!match[1].startsWith('../Assets/')) continue
    assetLinks.add(match[1])
    if (/\.prefab$/i.test(match[1])) prefabLinks.add(match[1])
  }
}

const inventorySection = getSection(audit, '## Per-part inventory')
const inventoryRows = tableRows(inventorySection).filter((cells) => /^`[MGLX]\d{2}`$/.test(cells[0]))
const inventoryCounts = Object.fromEntries([...INVENTORY_CLASSES].map((kind) => [kind, 0]))
const inventoryIds = new Set()
for (const cells of inventoryRows) {
  const id = cells[0].slice(1, -1)
  assert.ok(!inventoryIds.has(id), `duplicate inventory id ${id}`)
  inventoryIds.add(id)
  const expectedClass = CLASS_BY_PREFIX[id[0]]
  assert.equal(cells[3], expectedClass, `${id} must be classified ${expectedClass}`)
  inventoryCounts[cells[3]] += 1
}

// The five rows this audit proposed were adopted into the checklist; the audit
// records their final status so the two files stay in step.
const proposedSection = getSection(audit, '## Adopted checklist rows')
const proposedRows = tableRows(proposedSection).filter((cells) => /^`[a-z][a-z0-9-]+`$/.test(cells[0]))

test('catalogue recipes resolve to the checklist or a documented sample alias', { skip: planSkip }, () => {
  const missing = [...uniqueCatalogueIds].filter((id) => !checklistIds.has(id))
  assert.deepEqual(missing, ['bench'], 'only the bench family sample key may be absent from the checklist')
  for (const id of missing) {
    assert.ok(SAMPLE_EXPORT_ALLOWLIST.has(id), `${id} is not in the sample/alias allowlist`)
  }

  const benchRecord = catalogue.families.find((record) => record.catalogueId === 'bench')
  assert.ok(benchRecord, 'catalogue bench record is missing')
  const benchRow = checklistRows.find((row) => row.id === 'bench-seat-2')
  assert.ok(benchRow, 'checklist bench-seat-2 row is missing')
  const benchLink = [...benchRow.line.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .find((link) => link.startsWith('../Assets/'))
  assert.ok(benchLink, 'bench-seat-2 does not link a prefab')
  const resolved = path.resolve(path.join(ROOT, 'unity/plan'), benchLink)
  const promoted = path.join(ROOT, 'unity', benchRecord.promoted.prefab)
  assert.equal(resolved, promoted, 'bench-seat-2 must link the catalogue bench prefab')

  assert.equal(duplicateCatalogueKeys.length, 0, 'the catalogue keys must stay unique')
  const doubleTv = catalogue.families.find((record) => record.id === 'station.tv.double')
  assert.ok(doubleTv, 'catalogue is missing station.tv.double')
  assert.equal(doubleTv.catalogueId, 'tv-double', 'the double TV must not reuse the single TV key')
})

test('every checklist asset link exists with its Unity metadata', () => {
  assert.equal(duplicateCatalogueKeys.length, 0, 'the catalogue keys must stay unique')
  if (hasPlanDocs) {
    assert.ok(assetLinks.size > 0)
    const planDir = path.join(ROOT, 'unity/plan')
    for (const link of assetLinks) {
      assert.match(link, /\.(prefab|asset|cs|unity|glb|json)$/i, `checklist link is not a Unity asset: ${link}`)
      const file = path.resolve(planDir, link)
      assert.ok(fs.existsSync(file), `checklist prefab is missing: ${link}`)
      assert.ok(fs.statSync(file).isFile(), `checklist prefab is not a file: ${link}`)
      assert.ok(fs.existsSync(`${file}.meta`), `checklist prefab has no .meta: ${link}`)
    }
  }

  for (const record of catalogue.families) {
    const prefab = path.join(ROOT, 'unity', record.promoted.prefab)
    assert.ok(fs.existsSync(prefab), `catalogue prefab is missing: ${record.promoted.prefab}`)
    assert.ok(fs.existsSync(`${prefab}.meta`), `catalogue prefab has no .meta: ${record.promoted.prefab}`)
  }
})

test('every catalogue record has a builder reachable from the dispatch', () => {
  const closure = renderModuleClosure()
  const unreachable = []
  for (const record of catalogue.families) {
    for (const source of record.sourcePaths) {
      assert.ok(fs.existsSync(path.join(ROOT, source)), `catalogue source path is missing: ${source}`)
      if (!source.startsWith('game/src/render/models')) continue
      const file = path.resolve(ROOT, source)
      if (!closure.has(file)) unreachable.push(`${record.id} -> ${source}`)
    }
  }
  assert.deepEqual(unreachable, [], 'catalogue source builders must be imported by the module dispatch')
})

test('the dispatch table covers every models.ts case exactly once', () => {
  assert.equal(dispatchCases.length, 52, 'models.ts dispatch changed; update the audit and this guard')
  assert.equal(uniqueBuilders.size, 50, 'the unique dispatch-builder count changed')
  if (!hasPlanDocs) return

  const dispatchRows = tableRows(getSection(audit, '## Dispatch table')).filter((cells) =>
    /^`[a-z][a-z0-9-]*`$/.test(cells[0]),
  )
  const auditedCases = dispatchRows.map((cells) => cells[0].slice(1, -1))
  assert.equal(auditedCases.length, dispatchCases.length, 'the dispatch table row count differs from models.ts')
  assert.equal(new Set(auditedCases).size, auditedCases.length, 'the dispatch table repeats a case')
  assert.deepEqual([...auditedCases].sort(), [...new Set(dispatchCases)].sort())
})

test('the dispatch audit classifies every no-recipe case', { skip: planSkip }, () => {
  const noRecipe = getSection(audit, '### Dispatch cases with no catalogue recipe')
  assert.ok(noRecipe.length > 0, 'no-recipe section is missing')
  for (const id of NO_RECIPE_CASES) assert.match(noRecipe, new RegExp('`' + id + '`'))
  assert.equal(reportedCount(audit, 'Dispatch cases with no catalogue recipe'), NO_RECIPE_CASES.size)
})

test('sample-only recipes are documented as generators', { skip: planSkip }, () => {
  const sampleOnly = getSection(audit, '### Sample-only catalogue recipes')
  assert.ok(sampleOnly.length > 0, 'sample-only recipe section is missing')
  for (const id of SAMPLE_ONLY_RECIPE_IDS) {
    assert.ok(catalogue.families.some((record) => record.id === id), `catalogue is missing ${id}`)
    assert.match(sampleOnly, new RegExp('`' + id + '`'))
  }
  assert.equal(reportedCount(audit, 'Sample-only catalogue recipes'), SAMPLE_ONLY_RECIPE_IDS.length)
})

test('reported counts match the plan files and the inventory', { skip: planSkip }, () => {
  assert.equal(reportedCount(audit, 'Dispatch cases in `models.ts`'), dispatchCases.length)
  assert.equal(reportedCount(audit, 'Unique dispatch builders'), uniqueBuilders.size)
  assert.equal(reportedCount(audit, 'Catalogue records'), catalogue.families.length)
  assert.equal(reportedCount(audit, 'Unique catalogue keys'), uniqueCatalogueIds.size)
  assert.equal(reportedCount(audit, 'Duplicate catalogue keys'), duplicateCatalogueKeys.length)
  assert.equal(
    reportedCount(audit, 'Catalogue keys absent from checklist'),
    [...uniqueCatalogueIds].filter((id) => !checklistIds.has(id)).length,
  )
  assert.equal(reportedCount(audit, 'Catalogue recipes with no dispatch builder'), 0)
  assert.equal(reportedCount(audit, 'Dispatch cases with no catalogue recipe'), NO_RECIPE_CASES.size)
  assert.equal(reportedCount(audit, 'Sample-only catalogue recipes'), SAMPLE_ONLY_RECIPE_IDS.length)
  assert.equal(reportedCount(audit, 'Checklist rows (current)'), checklistRows.length)
  assert.equal(reportedCount(audit, 'Prefab links in checklist'), prefabLinks.size)
  assert.equal(reportedCount(audit, 'Checklist asset links'), assetLinks.size)
  assert.equal(reportedCount(audit, 'Inventory rows (`M` prefab)'), inventoryCounts.prefab)
  assert.equal(reportedCount(audit, 'Inventory rows (`G` generator)'), inventoryCounts.generator)
  assert.equal(reportedCount(audit, 'Inventory rows (`L` live)'), inventoryCounts.live)
  assert.equal(reportedCount(audit, 'Inventory rows (`X` exclusion)'), inventoryCounts.exclusion)
  assert.equal(reportedCount(audit, 'Proposed checklist rows'), proposedRows.length)

  assert.equal(checklistRows.length, 268, 'checklist row count changed; reconcile the audit counts')
  assert.equal(checklistIds.size, checklistRows.length, 'checklist row ids must be unique')
  assert.equal(prefabLinks.size, 233, 'checklist prefab-link count changed; reconcile the audit counts')
  assert.equal(assetLinks.size, 242, 'checklist asset-link count changed; reconcile the audit counts')
  assert.equal(inventoryRows.length, 96, 'inventory row count changed; reconcile the summary')
  assert.equal(proposedRows.length, 5, 'proposed checklist row count changed; reconcile the summary')
})

test('every proposed row was adopted with its recorded status', { skip: planSkip }, () => {
  const proposedIds = proposedRows.map((cells) => cells[0].slice(1, -1))
  assert.equal(new Set(proposedIds).size, proposedIds.length, 'duplicate proposed id')
  const checklistStatus = new Map(checklistRows.map((row) => [row.id, row.status]))
  for (const cells of proposedRows) {
    const [rawId, status, evidence] = cells
    const id = rawId.slice(1, -1)
    assert.ok(['DONE', 'PARTIAL', 'BLOCKED — cleared source'].includes(status), `${id} needs an adopted status, got ${status}`)
    assert.ok(evidence.length > 0, `${id} needs its evidence or remaining work`)
    assert.ok(checklistStatus.has(id), `${id} was proposed but never adopted into the checklist`)
    assert.equal(checklistStatus.get(id), status, `${id} status differs between the audit and the checklist`)
  }
  assert.equal(reportedCount(audit, 'Proposed checklist rows'), proposedRows.length)
})

test('all relative links in the audit resolve', { skip: planSkip }, () => {
  const planDir = path.join(ROOT, 'unity/plan')
  for (const match of audit.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^[a-z]+:/i.test(target)) continue
    const resolved = path.resolve(planDir, target)
    assert.ok(fs.existsSync(resolved), `audit link does not resolve: ${match[1]}`)
  }
})
