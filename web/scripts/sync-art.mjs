// Copies the concept sheets from ../art into public/art so Vite can serve them.
//
// art/ stays the single source of truth: nothing here is committed. The sheets
// are photographs of the game now — `node tools/shots.mjs` writes them — so a
// sheet the plan no longer draws is left out of the build rather than shown
// stale. The list comes from the site's own gallery for that reason: a sheet is
// shipped exactly when `web/src/artworks.js` points at it.
import { mkdirSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..', 'art')
const out = join(here, '..', 'public', 'art')
const gallery = join(here, '..', 'src', 'artworks.js')

/** The sheet files the gallery shows, in the order it lists them. */
const wanted = [...readFileSync(gallery, 'utf8').matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1])

if (wanted.length === 0) {
  console.error('sync-art: no sheets found in src/artworks.js — refusing to empty public/art')
  process.exit(1)
}

const missing = wanted.filter((f) => !existsSync(join(src, f)))
if (missing.length) {
  console.error(`sync-art: not in art/ yet — run \`node tools/shots.mjs\`:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const f of wanted) copyFileSync(join(src, f), join(out, f))

console.log(`sync-art: copied ${wanted.length} sheets from art/ to public/art/`)
for (const f of wanted) console.log('  ' + f)
