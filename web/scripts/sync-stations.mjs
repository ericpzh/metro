// Copies the game's own example-station previews into public/stations, the way
// sync-art.mjs publishes art/. The game owns the pictures — they are its render of
// each demo — so a refreshed `game/src/assets/stations/*.webp` reaches the site's
// picker on the next build instead of being committed twice.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..', 'game', 'src', 'assets', 'stations')
const out = join(here, '..', 'public', 'stations')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const previews = readdirSync(src)
  .filter((f) => f.endsWith('.webp'))
  .sort()

for (const f of previews) {
  if (statSync(join(src, f)).size >= 25 * 1024 * 1024) {
    throw new Error(`${f}: Cloudflare Workers assets must be smaller than 25 MiB.`)
  }
  copyFileSync(join(src, f), join(out, f))
}

console.log(`sync-stations: copied ${previews.length} previews from game/src/assets/stations to public/stations`)
for (const f of previews) console.log('  ' + f)
