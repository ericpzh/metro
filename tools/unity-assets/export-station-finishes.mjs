#!/usr/bin/env node
// Offline export of the station **finish library** for Unity (plan 11, packet E / E2).
//
// The game draws every surface finish from a procedural canvas (`render/materials.ts`)
// chosen by the same table the simulation reads (`sim/finishes.ts`). Unity cannot run
// that canvas code, and a solid-colour stand-in is not a finish, so this tool renders
// the real artwork here, once, and writes it next to a JSON manifest that Unity loads:
//
//   finishes.json      the library contract: id, albedo PNG, UV repeat, roughness,
//                      metalness, family, tint, palette groups, defaults, fallback
//   <id>.png           the albedo the TypeScript renderer builds for that finish
//   detail/<id>.png    a neutral (white-base) copy for finishes a player may tint,
//                      so `wall.enamel#ff4242` is a red enamel panel, not a cube
//   station-<name>.json  (with --station) the exact per-face finish counts of a save
//
// Determinism: `render/materials.ts` scatters with `Math.random`, so the RNG is
// replaced by the same fixed-seed generator the other Unity exporters use before the
// palette is imported. Two runs therefore write byte-identical PNGs, which is what
// `--check` compares.
//
// Usage (from the repository root):
//   node tools/unity-assets/export-station-finishes.mjs
//   node tools/unity-assets/export-station-finishes.mjs --check
//   node tools/unity-assets/export-station-finishes.mjs \
//       --station unity/Assets/StationDesigner/Zoo/ZooSave.json
//   node tools/unity-assets/export-station-finishes.mjs \
//       --stage unity/Assets/Resources/StationFinishes
//   node tools/unity-assets/export-station-finishes.mjs --out .preview/unity/finishes
//
// `--out` may be repeated with `--stage`: the same bytes go to every directory, so a
// verification copy and the Resources copy cannot drift.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import { execFileSync } from 'node:child_process'

const root = join(import.meta.dirname, '../..')
const defaultOut = join(root, 'unity/asset-recipes/finishes')

/** Fixed-seed replacement for `Math.random` (`export-fixture.mjs` uses the same one). */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The palette prints its canvas textures through a DOM canvas. The adapter is the
// same one the model exporters use: shadow `createElement('canvas')` and the canvas
// constructors, then `three` treats each as a real CanvasTexture and the exporter can
// read the pixels straight back out.
Math.random = seeded(0x9e3779b9)
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    return createCanvas(256, 256)
  },
}

const { createMaterials, finishMaterialProperties } = await import('../../game/src/render/materials.ts')
const {
  DEFAULT_FINISH, FINISH_LIST, RAMP_SOFFIT_FINISH, customFinishId, finishBaseId,
  finishDef, finishPaletteGroups, finishTint,
} = await import('../../game/src/sim/finishes.ts')

/* ------------------------------------------------------------------ arguments */

function parseArgs(argv) {
  const options = { out: [], stage: [], station: [], check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out') options.out.push(resolve(argv[++i] ?? defaultOut))
    else if (arg === '--stage') options.stage.push(resolve(argv[++i] ?? '.'))
    else if (arg === '--station') options.station.push(resolve(argv[++i] ?? ''))
    else if (arg === '--check') options.check = true
    else if (arg === '--help' || arg === '-h') { console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 32).join('\n')); process.exit(0) }
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.out.length) options.out.push(defaultOut)
  return options
}

const options = parseArgs(process.argv.slice(2))
const outputs = [...new Set([...options.out, ...options.stage])]

/* ------------------------------------------------------------- finish artwork */

/** A stable file stem for a finish id: `wall.enamel#ff4242` → `wall.enamel__ff4242`. */
const fileStem = (id) => id.replaceAll('#', '__')

/**
 * The finishes the library must carry, in a fixed order so the seeded RNG sees the
 * same sequence on every run: the stock list, the registry-only `wall.soil`, the ramp
 * soffit, then any custom-tinted id a station save actually wears.
 */
const registryIds = [...FINISH_LIST.map((f) => f.id)]
// `wall.soil` is in `finishDef`'s map but not the palette list (a legacy save id).
if (!registryIds.includes('wall.soil')) registryIds.push('wall.soil')
if (!registryIds.includes(RAMP_SOFFIT_FINISH)) registryIds.push(RAMP_SOFFIT_FINISH)

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const mats = createMaterials()
const textures = new Map()

/** The canvas behind one finish id, minted through the game's own material factory. */
function canvasFor(id) {
  let canvas = textures.get(id)
  if (!canvas) {
    // A custom tint keeps its base family wet: `wall.enamel#ff4242` is drawn by the
    // same canvas function with the tint in the id, exactly as the browser does.
    const material = mats.finish(id)
    canvas = material.map.image
    textures.set(id, canvas)
  }
  return canvas
}

/** A neutral, white-base copy for a tintable look: multiply by a colour to tint it. */
function neutralCanvas(id) {
  const def = finishDef(id)
  return canvasFor(customFinishId(finishBaseId(id), 0xffffff))
}

/**
 * Which looks get a neutral white-base copy. Only 涂料 (`wall.plaster`) and 搪瓷板
 * (`wall.enamel`) are tinted by the rail's colour pickers (`PaintFolder.tsx`), and a
 * white-base map is what lets Unity render `wall.enamel#ff4242` as a real red panel
 * without shipping a texture per colour. Any other custom tint resolves to the stock
 * base's baked albedo and a documented colour ratio (`StationFinishLibrary`).
 */
const TINTABLE_LOOKS = new Set(['plaster', 'enamel'])

/** Every finish the library carries for this run, tinted station ids appended. */
const libraryIds = [...registryIds]

function stationCustomIds(stationPath) {
  const save = JSON.parse(readFileSync(stationPath, 'utf8'))
  const cells = save?.static?.cells ?? []
  const modules = save?.static?.modules ?? []
  const ids = new Set()
  for (const cell of cells) for (const id of Object.values(cell.finish ?? {})) if (id) ids.add(id)
  for (const module of modules) {
    const cfg = module.cfg ?? {}
    for (const key of ['finish', 'bridgeFinish']) if (cfg[key]) ids.add(cfg[key])
    for (const id of Object.values(cfg.surfaceFinishes ?? {})) if (id) ids.add(id)
  }
  return [...ids].filter((id) => !registryIds.includes(id)).sort()
}

for (const station of options.station) {
  for (const id of stationCustomIds(station)) if (!libraryIds.includes(id)) libraryIds.push(id)
}

const encoder = new TextEncoder()
const files = new Map() // relative path → Buffer, everything a run writes
const entries = []

for (const id of libraryIds) {
  const def = finishDef(id)
  const baseId = finishBaseId(id)
  const tint = finishTint(id)
  const canvas = canvasFor(id)
  const png = await canvas.toBuffer('image/png')
  const albedo = `${fileStem(id)}.png`
  files.set(albedo, png)
  const props = finishMaterialProperties(def)
  const tintable = TINTABLE_LOOKS.has(def.look)
  let detail = null
  let detailPng = null
  if (tintable) {
    const neutral = finishDef(baseId)
    const neutralPixels = neutralCanvas(id)
    const neutralPng = await neutralPixels.toBuffer('image/png')
    // The stock white-base canvas is the same file for every tint of one base look.
    if (!files.has(`detail/${fileStem(baseId)}.png`)) {
      files.set(`detail/${fileStem(baseId)}.png`, neutralPng)
    }
    detail = `detail/${fileStem(baseId)}.png`
    detailPng = files.get(detail)
    assert.equal(neutral.id, baseId)
  }
  const entry = {
    id,
    baseId,
    label: String(def.label),
    family: def.family,
    look: def.look,
    tint: (tint ?? def.tint).toString(16).padStart(6, '0'),
    speed: def.speed,
    cover: def.cover,
    albedo,
    albedoBytes: png.length,
    albedoSha256: sha256(png),
    detail,
    detailSha256: detailPng ? sha256(detailPng) : null,
    // The PNG above already wears this id's own tint. `baseTint` is the stock colour
    // the look was drawn with, which is what a *runtime* custom tint divides by.
    tintMode: 'baked',
    baseTint: def.id === baseId ? null : finishDef(baseId).tint.toString(16).padStart(6, '0'),
    neutral: detail !== null,
    repeatU: 1,
    repeatV: 1,
    metresPerTile: 1,
    roughness: props.roughness,
    metalness: props.metalness,
    width: canvas.width,
    height: canvas.height,
    doubleSided: def.family === 'ceiling',
    colorSpace: 'sRGB',
  }
  entries.push(entry)
}

const defaults = Object.fromEntries(Object.entries(DEFAULT_FINISH).map(([face, id]) => [face, id]))
const paletteGroups = finishPaletteGroups().map((group) => ({
  fam: group.fam,
  label: String(group.label),
  ids: group.items.map((item) => item.id),
}))

let sourceSha = 'unknown'
try { sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() } catch { /* exported checkout */ }

const manifest = {
  version: 1,
  generatedBy: 'tools/unity-assets/export-station-finishes.mjs',
  source: {
    sha: sourceSha,
    finishes: 'game/src/sim/finishes.ts',
    materials: 'game/src/render/materials.ts',
    contactFinishes: 'game/src/sim/contactFinishes.ts',
  },
  colorSpace: 'sRGB',
  metresPerTile: 1,
  seed: 0x9e3779b9,
  fallback: DEFAULT_FINISH.top,
  rampSoffit: RAMP_SOFFIT_FINISH,
  defaults: Object.entries(defaults).map(([face, id]) => ({ face, id })),
  paletteGroups,
  finishes: entries,
  totals: {
    finishes: entries.length,
    stockFinishes: registryIds.length,
    tintedFinishes: entries.length - registryIds.length,
    textures: entries.filter((entry) => entry.albedo).length,
    detailTextures: new Set(entries.map((entry) => entry.detail).filter(Boolean)).size,
    bytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0),
  },
}

// Key order is fixed by construction (object literal order), and there are no dates or
// environment-dependent values, so the JSON itself is byte-stable.
const manifestText = JSON.stringify(manifest, null, 2) + '\n'
files.set('finishes.json', encoder.encode(manifestText))

/* ---------------------------------------------------- station finish inventory */

/** Counts a station save's cells by fill, shape, tag and per-face finish. */
function stationInventory(stationPath) {
  const bytes = readFileSync(stationPath)
  const save = JSON.parse(bytes.toString('utf8'))
  const cells = save?.static?.cells ?? []
  const faces = {}
  const finishByFace = {}
  const finishes = new Map()
  const tagCounts = {}
  const shapeCounts = {}
  let solids = 0
  let voids = 0
  for (const cell of cells) {
    if (cell.fill === 'solid') solids++
    else voids++
    for (const tag of cell.tags ?? []) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
      const family = tag.split(':')[0]
      if (['half-wall', 'half-corner', 'tri-upper', 'tri-lower'].includes(family)) {
        shapeCounts[tag] = (shapeCounts[tag] ?? 0) + 1
      }
    }
    for (const [face, id] of Object.entries(cell.finish ?? {})) {
      if (!id) continue
      faces[face] = (faces[face] ?? 0) + 1
      ;(finishByFace[face] ??= {})
      finishByFace[face][id] = (finishByFace[face][id] ?? 0) + 1
      finishes.set(id, (finishes.get(id) ?? 0) + 1)
    }
  }
  const modules = save?.static?.modules ?? []
  const moduleTypes = {}
  for (const module of modules) moduleTypes[module.type] = (moduleTypes[module.type] ?? 0) + 1
  return {
    path: relative(root, stationPath).replaceAll('\\', '/'),
    sha256: sha256(bytes),
    name: save?.name ?? null,
    levelBase: save?.levelBase ?? 0,
    storeyHeight: save?.storeyHeight ?? 5,
    cells: cells.length,
    solids,
    voids,
    modules: modules.length,
    moduleTypes,
    tags: tagCounts,
    shapes: shapeCounts,
    faceCounts: faces,
    finishCounts: Object.fromEntries([...finishes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    finishByFace,
    unknownFinishes: Object.keys(Object.fromEntries(finishes)).filter((id) => !libraryIds.includes(id)),
  }
}

const stationFiles = []
for (const stationPath of options.station) {
  const report = stationInventory(stationPath)
  const name = basename(stationPath, '.json').toLowerCase()
  const file = `station-${name}.json`
  const text = JSON.stringify(report, null, 2) + '\n'
  files.set(file, encoder.encode(text))
  stationFiles.push({ file, report })
}

/* --------------------------------------------------------------- write / check */

function write(directory) {
  mkdirSync(directory, { recursive: true })
  const written = []
  for (const [name, bytes] of files) {
    const path = join(directory, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    written.push(relative(root, path).replaceAll('\\', '/'))
  }
  return written
}

/** Compare what this run would write with what is on disk; returns the drift list. */
function check(directory) {
  const drift = []
  if (!existsSync(directory)) return [`${relative(root, directory)}: missing directory`]
  const expected = new Set(files.keys())
  for (const [name, bytes] of files) {
    const path = join(directory, name)
    if (!existsSync(path)) { drift.push(`${name}: missing`); continue }
    if (sha256(readFileSync(path)) !== sha256(bytes)) drift.push(`${name}: changed`)
  }
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stem = prefix ? `${prefix}/${name}` : name
      if (statSync(path).isDirectory()) walk(path, stem)
      else if (!expected.has(stem)) drift.push(`${stem}: unexpected`)
    }
  }
  walk(directory, '')
  return drift
}

let status = 0
if (options.check) {
  for (const directory of outputs) {
    const drift = check(directory)
    if (drift.length) {
      status = 1
      console.error(`finishes: ${relative(root, directory)} DRIFT`)
      for (const line of drift) console.error(`  ${line}`)
    } else {
      console.log(`finishes: ${relative(root, directory)} ok (${files.size} files)`)
    }
  }
} else {
  for (const directory of outputs) {
    const written = write(directory)
    console.log(`finishes: wrote ${written.length} files to ${relative(root, directory)}`)
  }
}

const summary = {
  finishes: entries.length,
  stock: registryIds.length,
  tinted: entries.length - registryIds.length,
  textures: files.size,
  bytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0),
  out: options.out.map((directory) => relative(root, directory).replaceAll('\\', '/')),
  station: stationFiles.map(({ file, report }) => ({ file, cells: report.cells, finishes: Object.keys(report.finishCounts).length, unknown: report.unknownFinishes })),
  check: options.check ? (status === 0 ? 'ok' : 'drift') : undefined,
}
console.log(JSON.stringify(summary))
process.exitCode = status
