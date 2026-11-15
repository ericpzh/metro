// Export the poster catalogue to the Unity runtime as a slug-indexed texture table.
//
//   node tools/unity-assets/export-posters.mjs [--out <dir>]
//
// `render/adArt.ts` keys its posters by the **file stem** of every WebP under
// `game/src/assets/posters/` (`URL_BY_SLUG`), and a saved billboard names one in
// `cfg.poster`. Unity cannot import WebP, so each poster is decoded once here and
// written as a PNG (longest edge capped) plus a manifest mapping slug → file and
// pixel size. `StationDisplayArtwork` binds a billboard's `billboardPoster` surface
// to that texture and prints the source's centred crop window
// (`render/panelUv.ts:panelUvWindow`) through the material's texture transform, so
// a poster is cropped to its panel, never stretched (18 §2).
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const output = outFlag >= 0 ? resolve(args[outFlag + 1]) : join(root, 'unity/Assets/StationDesigner/Resources/Posters')
const source = join(root, 'game/src/assets/posters')
/** The longest PNG edge: a poster prints on a 1–6 m panel, and the source's own art is small. */
const MAX_EDGE = 512

const files = readdirSync(source).filter(name => name.endsWith('.webp')).sort()
if (files.length === 0) {
  console.error('export-posters: no poster WebP files found in ' + source)
  process.exit(1)
}
mkdirSync(output, { recursive: true })

const posters = []
for (const file of files) {
  const image = await loadImage(join(source, file))
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, width, height)
  const png = await canvas.encode('png')
  const slug = basename(file, extname(file))
  writeFileSync(join(output, slug + '.png'), png)
  posters.push({ slug, file: slug + '.png', width, height, sourceBytes: image.width + 'x' + image.height })
}
writeFileSync(join(output, 'posters.json'), JSON.stringify({
  schemaVersion: 1,
  source: 'game/src/assets/posters/*.webp',
  note: 'slug = WebP file stem (render/adArt.ts URL_BY_SLUG); Unity loads Resources/Posters/<slug>',
  maxEdge: MAX_EDGE,
  count: posters.length,
  posters,
}, null, 2) + '\n')
console.log(`POSTERS_EXPORT_OK ${posters.length} posters -> ${output}`)
