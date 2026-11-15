// Export the eight supplied city line maps to the Unity runtime as a slug-indexed table.
//
//   node tools/unity-assets/export-linemaps.mjs [--out <dir>] [--edge <px>]
//
// `render/lineMapCity.ts:cityLineMapSlug` names the poster a city's 线网图 prints:
// `network-map` for Guangzhou, `<city>-map` for the other seven. The artwork is
// **supplied**, not drawn (`render/lineMapArt.ts`), and lives under
// `game/src/assets/linemaps/` as PNG/JPG. Unity reads none of those formats from a
// `Resources` folder without an import, so each file is decoded once here, written as
// a PNG with its longest edge capped, and listed with its source SHA-256 so the
// provenance of the shipped picture is checkable (20 §3).
//
// The panel the runtime prints on is 1.8 m × 1.9 m (`LINE_MAP_PANEL_W/H`), so 1024 px
// on the longest edge is well over 400 px/m and the browser pack stays small.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const output = resolve(flag('--out', join(root, 'unity/Assets/StationDesigner/Resources/LineMaps')))
const edge = Number(flag('--edge', '1024'))
const source = join(root, 'game/src/assets/linemaps')

/** `render/lineMapCity.ts:cityLineMapSlug`, restated: Guangzhou prints the network map. */
const slugFor = city => (city === 'guangzhou' ? 'network-map' : `${city}-map`)

const files = readdirSync(source).filter(name => /\.(?:png|jpe?g)$/i.test(name)).sort()
if (files.length === 0) {
  console.error('export-linemaps: no map images found in ' + source)
  process.exit(1)
}
mkdirSync(output, { recursive: true })

const maps = []
for (const file of files) {
  const slug = basename(file, extname(file))
  const path = join(source, file)
  const image = await loadImage(path)
  const scale = Math.min(1, edge / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  // The posters are printed edge to edge; a transparent margin would read as a hole.
  context.fillStyle = '#f4f1ea'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const png = await canvas.encode('png')
  writeFileSync(join(output, slug + '.png'), png)
  maps.push({
    slug,
    // The city whose `cityLineMapSlug` resolves to this file: Guangzhou is the network map.
    city: slug === 'network-map' ? 'guangzhou' : slug.replace(/-map$/, ''),
    file: slug + '.png',
    width,
    height,
    aspect: Number((image.width / image.height).toFixed(4)),
    source: 'game/src/assets/linemaps/' + file,
    sourceBytes: image.width + 'x' + image.height,
    sourceSha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  })
}
writeFileSync(join(output, 'linemaps.json'), JSON.stringify({
  schemaVersion: 1,
  source: 'game/src/assets/linemaps/*',
  note: 'slug = file stem (render/lineMapCity.ts cityLineMapSlug); Unity loads Resources/LineMaps/<slug>',
  maxEdge: edge,
  count: maps.length,
  cities: Object.fromEntries(maps.map(map => [map.city, map.slug])),
  maps,
}, null, 2) + '\n')
console.log(`LINEMAPS_EXPORT_OK ${maps.length} maps -> ${output}`)
