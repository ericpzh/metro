import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODULE_OPTIONS } from '../../game/src/app/store/catalog.ts'

/**
 * Regression for plan 10-model-runtime-integration.md M4.1: the inventory
 * command must enumerate the live palette, the three shipped demos and the
 * Unity mappings, and it must fail loudly on any gap.
 *
 * The palette-identity check deliberately imports `catalog.ts` here rather than
 * trusting the report: the plan's duplicate-key check is that two palette rows
 * cannot resolve to one registry key.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const tool = join(repoRoot, 'tools/unity-assets/audit-runtime-models.mjs')
const outputPath = join(repoRoot, '.preview/unity/model-inventory', `runtime-model-inventory.test-${process.pid}.json`)
const CLASSIFICATIONS = ['prefab', 'generated', 'live-view', 'intentional-none', 'unresolved']
const DEMO_IDS = ['zoo', 'tanwei', 'tianhe']
const SCHEMA_KEYS = ['schemaVersion', 'generatedAt', 'head', 'dirty', 'palette', 'demos', 'variants', 'coverage', 'problems', 'sources']

const run = spawnSync(process.execPath, [tool, outputPath], {
  cwd: repoRoot,
  encoding: 'utf8',
  timeout: 120000,
})
const report = run.status === 0 && existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : null

after(() => {
  rmSync(outputPath, { force: true })
})

const classificationTotal = (counts) =>
  CLASSIFICATIONS.reduce((total, classification) => total + (counts?.[classification] ?? 0), 0)

test('inventory command exits 0 and writes the documented report schema', () => {
  assert.equal(run.status, 0, `audit exited ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`)
  assert.ok(report, 'report JSON was not written')
  for (const key of SCHEMA_KEYS) assert.ok(Object.hasOwn(report, key), `report is missing "${key}"`)
  assert.equal(report.schemaVersion, 1)
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.match(report.head, /^[0-9a-f]{40}$/)
  assert.equal(typeof report.dirty, 'boolean')
  assert.equal(typeof report.problems, 'object')
  assert.equal(typeof report.sources, 'object')
})

test('palette rows cover exactly the MODULE_OPTIONS ids, with no duplicates', () => {
  assert.ok(report, 'report missing; previous test failed')
  const expected = MODULE_OPTIONS.map((option) => option.id).sort()
  const actual = report.palette.map((row) => row.id).sort()
  assert.deepEqual(actual, expected)
  assert.equal(new Set(actual).size, actual.length, 'report palette contains duplicate ids')
  for (const row of report.palette) {
    assert.equal(typeof row.type, 'string', `${row.id} has no normalized type`)
    assert.ok(row.cfg && typeof row.cfg === 'object', `${row.id} has no normalized cfg`)
    assert.ok(CLASSIFICATIONS.includes(row.classification), `${row.id} has unknown classification ${row.classification}`)
    assert.equal(typeof row.unityCovered, 'boolean', `${row.id} has no unityCovered flag`)
    if (row.classification === 'unresolved') assert.equal(row.resolvedKey, null)
    else assert.equal(typeof row.resolvedKey, 'string', `${row.id} has no resolved key`)
  }
})

test('MODULE_OPTIONS has unique ids (the plan duplicate-key check)', () => {
  const ids = MODULE_OPTIONS.map((option) => option.id)
  assert.equal(new Set(ids).size, ids.length, `duplicate palette id(s): ${ids.filter((id, index) => ids.indexOf(id) !== index).join(', ')}`)
})

test('every demo in the report exists in the repo and its totals add up', () => {
  assert.ok(report, 'report missing; previous test failed')
  assert.deepEqual(Object.keys(report.demos).sort(), [...DEMO_IDS].sort())
  for (const id of DEMO_IDS) {
    const demo = report.demos[id]
    assert.equal(demo.id, id)
    assert.ok(existsSync(join(repoRoot, demo.path)), `${id} report path does not exist: ${demo.path}`)
    const raw = JSON.parse(readFileSync(join(repoRoot, demo.path), 'utf8'))
    assert.equal(demo.moduleCount, raw.modules.length, `${id} moduleCount does not match the shipped document`)
    assert.ok(demo.moduleCount > 0, `${id} has no modules`)

    assert.equal(classificationTotal(demo.classifications), demo.moduleCount, `${id} classification counts do not add up`)
    const keyTotal = Object.values(demo.keys).reduce((total, count) => total + count, 0)
    assert.equal(keyTotal + demo.unresolved.count, demo.moduleCount, `${id} key counts plus unresolved do not add up`)
    assert.equal(demo.classifications.unresolved, demo.unresolved.count, `${id} unresolved count disagrees with classifications`)
  }
})

test('coverage totals add up for palette, variants and instances', () => {
  assert.ok(report, 'report missing; previous test failed')
  for (const scope of ['palette', 'variants', 'instances']) {
    const counts = report.coverage[scope]
    assert.equal(classificationTotal(counts), counts.total, `coverage.${scope} classification rows do not add up`)
  }
  assert.equal(report.coverage.palette.total, report.palette.length)
  assert.equal(report.coverage.variants.total, report.variants.length)
  const demoInstances = DEMO_IDS.reduce((total, id) => total + report.demos[id].moduleCount, 0)
  assert.equal(report.coverage.instances.total, demoInstances)
  assert.equal(report.summary.instances, demoInstances)
})

test('every shipped demo produced at least one resolved prefab key', () => {
  assert.ok(report, 'report missing; previous test failed')
  const prefabKeys = new Set(
    report.variants.filter((variant) => variant.classification === 'prefab' && variant.resolvedKey).map((variant) => variant.resolvedKey),
  )
  for (const id of DEMO_IDS) {
    const demo = report.demos[id]
    assert.ok(demo.classifications.prefab > 0, `${id} has no prefab-classified instances`)
    assert.ok(demo.resolvedPrefabKeys > 0, `${id} has no resolved prefab keys`)
    const hits = Object.entries(demo.keys).filter(([key]) => prefabKeys.has(key))
    assert.ok(hits.length > 0, `${id} has no key backed by a prefab-classified variant`)
  }
})

test('no demo configuration is silently missing from variants', () => {
  assert.ok(report, 'report missing; previous test failed')
  for (const id of DEMO_IDS) {
    const demo = report.demos[id]
    const fromVariants = report.variants.reduce((total, variant) => total + (variant.instances[id] ?? 0), 0)
    assert.equal(fromVariants, demo.moduleCount, `${id} variants account for ${fromVariants} of ${demo.moduleCount} modules`)
    for (const variant of report.variants) {
      assert.equal(variant.total, DEMO_IDS.reduce((total, key) => total + (variant.instances[key] ?? 0), 0), `${variant.type} total does not match its per-demo counts`)
    }
  }
  // Variant rows are unique by normalized type + cfg, so no two rows can claim
  // the same slice of a demo.
  const keys = report.variants.map((variant) => `${variant.type}\u0000${JSON.stringify(variant.cfg)}`)
  assert.equal(new Set(keys).size, keys.length, 'variants contains duplicate normalized type + cfg rows')
})

test('Unity side covers every resolved key, with no reported problems', () => {
  assert.ok(report, 'report missing; previous test failed')
  for (const [name, list] of Object.entries(report.problems)) {
    assert.ok(Array.isArray(list), `problems.${name} is not an array`)
    assert.equal(list.length, 0, `problems.${name}: ${JSON.stringify(list.slice(0, 3))}`)
  }
  assert.equal(report.unity.palette.covered, report.unity.palette.total)
  for (const id of report.unity.palette.partial) {
    assert.ok(report.palette.some((row) => row.id === id), `PARTIAL status names unknown palette id ${id}`)
  }
  for (const key of report.unity.resolvedKeys) {
    assert.equal(key.unityCovered, true, `${key.key} is not covered by Unity artwork`)
  }
})
