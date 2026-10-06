// Copies the generated concept sheets from ../art into public/art so Vite can
// serve them. art/ stays the single source of truth: nothing here is committed.
import { mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..', 'art')
const out = join(here, '..', 'public', 'art')

// Drafts and duplicate working files are not part of the gallery.
const skip = (name) => name.startsWith('_') || name.endsWith('-zoom.svg')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const sheets = readdirSync(src)
  .filter((f) => f.endsWith('.svg') && !skip(f))
  .sort()

for (const f of sheets) copyFileSync(join(src, f), join(out, f))

console.log(`sync-art: copied ${sheets.length} sheets from art/ to public/art/`)
for (const f of sheets) console.log('  ' + f)
