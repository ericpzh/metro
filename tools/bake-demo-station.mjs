// Bake an author's 动物园 save into the demo station the game ships.
//
// The shipped `demo-station.json` is a bare station document (no save envelope):
// `reference-station.ts` imports it as `StationData` and hands out clones. The
// author's file is a full `metro-save` envelope, so this script parses it with
// the game's own loader (`persistence/save.ts`) and writes `toData(toState(...))`
// — the same document the game builds when the player opens the file — so the
// demo cannot carry anything the open path would have repaired away. It reports
// what the loader dropped and materialised, and refuses to finish quietly if the
// result would not round-trip through the loader again.
//
//   node tools/bake-demo-station.mjs [input.metro.json]
//
// Run from the repo root. The default input is the save this demo came from; the
// output is written to game/src/data/demo-station.json and must then pass
// `game/test/demo.test.mjs` and `game/test/placement.test.mjs`.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const OUT = resolve(repo, 'game/src/data/demo-station.json')

const input = process.argv[2] ?? 'C:\\Users\\ericp\\Downloads\\动物园.metro.json'
const text = readFileSync(input, 'utf8')

const { parse } = await import('../game/src/persistence/save.ts')
const { toData, toState } = await import('../game/src/build/model/State.ts')

const result = parse(text)
if (!result.ok) {
  console.error(`refused: ${result.error}`)
  process.exit(1)
}

const raw = JSON.parse(text)
const rawStatic = raw.static
const baked = toData(result.state)

console.log(`input           ${input}`)
console.log(`envelope        ${raw.format} v${raw.formatVersion} game ${raw.gameVersion} savedAt ${raw.savedAt}`)
console.log(`name / seed     ${result.state.name} / ${result.state.seed}`)
console.log(`loader repaired ${result.droppedCells} cells, ${result.droppedModules} modules`)
console.log(`cells           raw ${rawStatic.cells.length} -> shipped ${baked.cells.length}`)
console.log(`modules         raw ${rawStatic.modules.length} -> shipped ${baked.modules.length}`)
console.log(`lines           ${baked.lines.length}`)

// What the bake itself adds on top of the envelope's `static` block, beyond the
// grid repair: ad posters, sign layouts, room furniture, termini defaults.
const added = baked.modules.filter((m) => !rawStatic.modules.some((r) => r.id === m.id))
console.log(`modules the loader materialised: ${added.length} ${JSON.stringify(added.map((m) => m.id))}`)

// Idempotence: the demo must already be in the state the loader would produce,
// because `referenceStation()` hands it out raw.
const again = toData(toState(baked))
console.log(`idempotent      ${JSON.stringify(again) === JSON.stringify(baked) ? 'yes' : 'NO'}`)

writeFileSync(OUT, JSON.stringify(baked), 'utf8')
console.log(`wrote           ${OUT} (${JSON.stringify(baked).length} bytes)`)
