// Copies the generated concept sheets from ../art into public/art so Vite can
// serve them. art/ stays the single source of truth: nothing here is committed.
import { mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs'
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

for (const f of sheets) {
  if (statSync(join(src, f)).size >= 25 * 1024 * 1024) {
    throw new Error(`${f}: Cloudflare Workers assets must be smaller than 25 MiB. Deduplicate embedded assets before publishing.`)
  }
  copyFileSync(join(src, f), join(out, f))
}

console.log(`sync-art: copied ${sheets.length} sheets from art/ to public/art/`)
for (const f of sheets) console.log('  ' + f)
