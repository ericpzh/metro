// Packet A1 — produce source station documents for the generic Unity loader.
//
// The TypeScript game stores three baked `StationData` documents under
// `game/src/data/`. A file Open in the game reads a `metro-save` v1 *envelope*,
// so this tool runs the real TypeScript load path (`toStateRepairing`, the same
// repairs `parse` applies) and `serialize` (the same writer a player's Save
// uses) with a fixed `savedAt`. The envelopes under
// `unity/Assets/StationDesigner/Demos/` are therefore exactly what the shipped
// game would write if that station were opened and saved, byte for byte.
//
// Every envelope is reopened through `parse` before it is written, and a second
// `serialize` must reproduce the same bytes: that proves the exported document
// is a fixed point of the game's own load→save loop. `provenance.json` carries
// the source hash, output hash, normalized counts and the command that wrote
// it; `--check` regenerates everything in memory and fails if any byte differs.
//
// Usage:
//   node tools/unity-parity/export-station-documents.mjs [--out <dir>] [--check]
//
// Default `--out` is `unity/Assets/StationDesigner/Demos/`. Never writes graph,
// footprint or route oracles: those live under `tools/unity-parity/` fixtures
// or `.preview/unity/`, never beside the gameplay documents.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_OUT = 'unity/Assets/StationDesigner/Demos'
const SAVED_AT = '2020-01-02T03:04:05.000Z'
const SCHEMA_VERSION = 1
const GENERATED_BY = 'tools/unity-parity/export-station-documents.mjs'

/**
 * The demo contract: a stable id the bridge and the scene manifest use, the
 * baked source document, and the file name written beside `provenance.json`.
 * `zoo` is the baked reference station (`demo-station.json`), which is the
 * station the old fixture adapter served.
 */
const DEMOS = [
  { id: 'zoo', file: 'zoo.metro.json', source: 'game/src/data/demo-station.json' },
  { id: 'tanwei', file: 'tanwei.metro.json', source: 'game/src/data/tanwei-station.json' },
  { id: 'tianhe', file: 'tianhe.metro.json', source: 'game/src/data/tianhe-station.json' },
]

function parseArgs(argv) {
  let out = DEFAULT_OUT
  let check = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') check = true
    else if (arg === '--out') {
      const value = argv[++i]
      if (!value) throw new Error('--out needs a directory')
      out = value
    } else if (arg === '--help' || arg === '-h') {
      console.log('node tools/unity-parity/export-station-documents.mjs [--out <dir>] [--check]')
      process.exit(0)
    } else throw new Error('Unknown argument: ' + arg)
  }
  return { out, check }
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * One demo's pure export: source text → envelope text + provenance entry. The
 * TypeScript modules are imported lazily so `--help` and argument errors do not
 * pay to load the game.
 */
async function exportDemo(demo, sourceText) {
  const { toStateRepairing } = await import('../../game/src/build/model.ts')
  const { parse, serialize } = await import('../../game/src/persistence/save.ts')

  let data
  try {
    data = JSON.parse(sourceText)
  } catch (error) {
    throw new Error(`${demo.source} is not JSON: ${error.message}`)
  }

  const repaired = toStateRepairing(data)
  const savedAt = new Date(SAVED_AT)
  const saved = serialize(repaired.state, savedAt)

  // The game's own file-open path: a damaged envelope must be refused and a
  // valid one must produce the same station. This is the round trip the plan
  // makes a condition of shipping a fixture.
  const reopened = parse(saved)
  if (!reopened.ok) throw new Error(`${demo.id}: exported envelope does not parse: ${reopened.error}`)
  const resaved = serialize(reopened.state, savedAt)
  if (resaved !== saved) throw new Error(`${demo.id}: load→save is not a fixed point (${saved.length} vs ${resaved.length} bytes)`)
  if (reopened.droppedCells !== 0 || reopened.droppedModules !== 0)
    throw new Error(`${demo.id}: reopened envelope still drops cells/modules (${reopened.droppedCells}/${reopened.droppedModules})`)

  const state = reopened.state
  const counts = {
    cells: state.cells.length,
    modules: state.modules.length,
    lines: state.lines.length,
    droppedCells: repaired.droppedCells,
    droppedModules: repaired.droppedModules,
    // A repaired record is a real record: report where the repairs landed so a
    // fixture that needed them is visible in provenance, not a surprise later.
    levelBase: state.levelBase,
    storeyHeight: state.storeyHeight,
  }
  return {
    envelope: saved,
    entry: {
      id: demo.id,
      label: state.name,
      nameEn: state.nameEn,
      city: state.cityStyle,
      file: demo.file,
      source: demo.source,
      sourceSha256: sha256(sourceText),
      outputSha256: sha256(saved),
      savedAt: SAVED_AT,
      counts,
    },
  }
}

function provenanceText(entries) {
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: GENERATED_BY,
    command: `node ${GENERATED_BY} --out ${DEFAULT_OUT}`,
    savedAt: SAVED_AT,
    demos: entries,
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

async function main() {
  const { out, check } = parseArgs(process.argv.slice(2))
  const outDir = resolve(ROOT, out)
  const entries = []
  const outputs = new Map()
  for (const demo of DEMOS) {
    const sourcePath = resolve(ROOT, demo.source)
    if (!existsSync(sourcePath)) throw new Error(`Missing source document: ${demo.source}`)
    const sourceText = readFileSync(sourcePath, 'utf8')
    const { envelope, entry } = await exportDemo(demo, sourceText)
    outputs.set(demo.file, envelope)
    entries.push(entry)
  }
  const provenance = provenanceText(entries)
  outputs.set('provenance.json', provenance)

  if (check) {
    const problems = []
    for (const [file, expected] of outputs) {
      const path = join(outDir, file)
      if (!existsSync(path)) problems.push(`missing ${relative(ROOT, path)}`)
      else if (readFileSync(path, 'utf8') !== expected) problems.push(`changed ${relative(ROOT, path)}`)
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error('export-check: ' + problem)
      console.error(`export-check: ${problems.length} problem(s); re-run without --check to refresh`)
      process.exit(1)
    }
    console.log(JSON.stringify({ ok: true, mode: 'check', out: relative(ROOT, outDir), demos: entries.length }))
    return
  }

  mkdirSync(outDir, { recursive: true })
  for (const [file, text] of outputs) writeFileSync(join(outDir, file), text)
  console.log(JSON.stringify({
    ok: true,
    mode: 'write',
    out: relative(ROOT, outDir),
    demos: entries.map((entry) => ({
      id: entry.id, file: entry.file, cells: entry.counts.cells, modules: entry.counts.modules,
      lines: entry.counts.lines, droppedCells: entry.counts.droppedCells,
      droppedModules: entry.counts.droppedModules, outputSha256: entry.outputSha256,
    })),
  }))
}

main().catch((error) => {
  console.error('export-station-documents: ' + (error?.stack ?? error))
  process.exit(1)
})
