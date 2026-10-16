// Advertising panels (GAME-SPEC §5.7): compact WebP catalogue, matching formats,
// and the centred crop that fills each panel without stretching the artwork.
//
// The real pixel dimensions and window arithmetic pin the compact asset formats,
// full panel coverage and upright UV order directly in Node.
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { croppedPlane, panelUvWindow } from '../src/render/panelUv.ts'
import { AD_POSTERS, BILLBOARD_SPECS, BILLBOARD_VARIANTS, billboardSpec, panelPosters, posterFor, postersFor } from '../src/sim/billboards.ts'

// Read the actual WebP pixel dimensions, rather than a second hand-written catalogue.
const folder = new URL('../src/assets/posters/', import.meta.url)
const ART_SIZE = Object.fromEntries(readdirSync(folder).map((file) => {
  assert.ok(file.endsWith('.webp'), `old/unoptimized asset remains: ${file}`)
  const data = readFileSync(new URL(file, folder))
  assert.equal(data.toString('ascii', 0, 4), 'RIFF')
  assert.equal(data.toString('ascii', 8, 12), 'WEBP')
  let size
  for (let offset = 12; offset + 8 < data.length;) {
    const tag = data.toString('ascii', offset, offset + 4)
    const length = data.readUInt32LE(offset + 4)
    if (tag === 'VP8 ') {
      size = [data.readUInt16LE(offset + 14) & 0x3fff, data.readUInt16LE(offset + 16) & 0x3fff]
      break
    }
    offset += 8 + length + (length % 2)
  }
  assert.ok(size, `${file}: expected compact lossy WebP`)
  return [file.replace(/\.webp$/, ''), size]
}))

test('every catalogue slug is a compact poster file, and every file is a catalogue slug', () => {
  assert.deepEqual(new Set(AD_POSTERS.map((p) => p.slug)), new Set(Object.keys(ART_SIZE)))
  assert.equal(AD_POSTERS.length, new Set(AD_POSTERS.map((p) => p.slug)).size)
  for (const poster of AD_POSTERS) {
    const size = poster.shapes.includes('square') ? [384, 384]
      : poster.shapes.includes('portrait') ? [288, 512] : [512, 288]
    assert.deepEqual(ART_SIZE[poster.slug], size)
  }
})

test('a panel offers only artwork cut for its own silhouette', () => {
  for (const variant of BILLBOARD_VARIANTS) {
    const spec = billboardSpec(variant)
    const choices = postersFor(spec.shape)
    assert.ok(choices.length > 0, `${variant} has no poster to print`)
    for (const poster of choices) assert.ok(poster.shapes.includes(spec.shape), `${poster.slug} is not cut for ${spec.shape}`)
  }
  // Every silhouette is claimed, so no format can ever be offered nothing.
  for (const poster of AD_POSTERS) assert.ok(poster.shapes.length > 0, `${poster.slug} claims no silhouette`)
})

test('artwork fills every offered panel without stretching or margins', () => {
  const panels = [...BILLBOARD_VARIANTS.map((v) => billboardSpec(v)),
    { shape: 'landscape', panelW: 1.2, panelH: .7 }]
  for (const spec of panels) {
    for (const poster of postersFor(spec.shape)) {
      const [w, h] = ART_SIZE[poster.slug]
      const imageAspect = w / h
      const panelAspect = spec.panelW / spec.panelH
      const win = panelUvWindow(imageAspect, panelAspect)
      const visibleAspect = imageAspect * (win.u1 - win.u0) / (win.v1 - win.v0)
      assert.ok(Math.abs(visibleAspect - panelAspect) < 1e-9, 'crop preserves the source aspect')
      const geo = croppedPlane(spec.panelW, spec.panelH, win)
      assert.equal(geo.parameters.width, spec.panelW, 'art fills the panel width')
      assert.equal(geo.parameters.height, spec.panelH, 'art fills the panel height')
      assert.ok(win.u0 >= 0 && win.u1 <= 1 && win.v0 >= 0 && win.v1 <= 1)
      geo.dispose()
    }
  }
})

test('the window is the centred crop of the image', () => {
  // A square panel on a 2:1 image: half the width, full height, centred.
  assert.deepEqual(panelUvWindow(2, 1), { u0: 0.25, u1: 0.75, v0: 0, v1: 1 })
  // A 2:1 panel on a square image: full width, half the height, centred.
  assert.deepEqual(panelUvWindow(1, 2), { u0: 0, u1: 1, v0: 0.25, v1: 0.75 })
  // An exact match shows the whole poster.
  assert.deepEqual(panelUvWindow(1.78, 1.78), { u0: 0, u1: 1, v0: 0, v1: 1 })
})

test('the cropped quad walks the window in the geometry UV order', () => {
  const win = panelUvWindow(2, 1) // { u0 .25, u1 .75, v0 0, v1 1 }
  const geo = croppedPlane(0.86, 0.43, win)
  const uv = geo.getAttribute('uv')
  // PlaneGeometry's own order: top-left, top-right, bottom-left, bottom-right.
  // v is texture space and `Texture.flipY` is on, so the window's top edge (`v1`)
  // lands on the quad's top corners — see `panelUv.ts`. Reversing these prints
  // every poster upside down.
  const pairs = [0, 1, 2, 3].map((i) => [uv.getX(i), uv.getY(i)])
  assert.deepEqual(pairs, [
    [win.u0, win.v1],
    [win.u1, win.v1],
    [win.u0, win.v0],
    [win.u1, win.v0],
  ])
  // The quad keeps the panel's own size; only its UVs are cut.
  const pos = geo.getAttribute('position')
  const xs = [0, 1, 2, 3].map((i) => pos.getX(i))
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.86) < 1e-5, 'the quad is the panel, not the cropped image')
})

test('a multi-panel piece leads with its frozen campaign and repeats no poster', () => {
  // The 公交站's row: two landscape lightboxes and the route cabinet's upright panel. The
  // campaign the shelter was placed with **leads the panels that can print it**, every later
  // panel takes the next poster of its own silhouette, and the upright one — whose pool is
  // disjoint from the landscape pool — varies with the shelter rather than always printing
  // the same portrait ad. Deterministic in the slug alone: no RNG, so nothing reshuffles.
  const shapes = ['landscape', 'landscape', 'portrait']
  for (const slug of [undefined, 'no-such-poster', ...AD_POSTERS.slice(0, 8).map((p) => p.slug)]) {
    const panels = panelPosters(slug, shapes)
    assert.equal(panels.length, shapes.length)
    if (postersFor(shapes[0]).some((p) => p.slug === posterFor(slug).slug)) {
      assert.equal(panels[0].slug, posterFor(slug).slug, `${slug}: the frozen campaign leads the row`)
    }
    assert.equal(new Set(panels.map((p) => p.slug)).size, panels.length, `${slug}: no two panels repeat an ad`)
    for (const [i, panel] of panels.entries()) {
      assert.ok(panel.shapes.includes(shapes[i]), `${slug}: panel ${i} is not cut for its own silhouette`)
    }
    assert.deepEqual(panelPosters(slug, shapes).map((p) => p.slug), panels.map((p) => p.slug))
  }
  // Two different campaigns lead two different rows, including the upright panel.
  const a = panelPosters(AD_POSTERS[0].slug, shapes).map((p) => p.slug)
  const b = panelPosters(AD_POSTERS[1].slug, shapes).map((p) => p.slug)
  assert.notDeepEqual(a, b)
  assert.equal(panelPosters(AD_POSTERS[0].slug, []).length, 0)
})

test('a format prints the poster it was given, and an unknown slug a placeholder', () => {
  // The slug is opaque to the sim: the renderer resolves it against the table
  // and falls back to the catalogue head rather than drawing nothing.
  assert.equal(posterFor(AD_POSTERS[0].slug).slug, AD_POSTERS[0].slug)
  assert.equal(posterFor('no-such-poster').slug, AD_POSTERS[0].slug)
  assert.equal(posterFor(undefined).slug, AD_POSTERS[0].slug)
})

test('the six formats are a palette of real panels', () => {
  assert.equal(BILLBOARD_VARIANTS.length, 6)
  // The drawn panel fits its run and stays clear of the floor and of the ceiling
  // slab two storeys up — the band `moduleEnvelope` reserves is exactly this one
  // (`panelZ` ± `panelH` / 2, `sim/placement.ts`), which is why a 座椅 on the floor
  // under a poster is not in its way.
  for (const variant of BILLBOARD_VARIANTS) {
    const spec = BILLBOARD_SPECS[variant]
    assert.ok(spec.panelW <= spec.w, `${variant}: a ${spec.panelW} m panel cannot fit ${spec.w} cells`)
    assert.ok(spec.panelZ - spec.panelH / 2 > 0.2, `${variant}: the panel would sit on the floor`)
    assert.ok(spec.panelZ + spec.panelH / 2 < 2.4, `${variant}: the panel would poke through the ceiling`)
  }
})

test('one material per poster serves every panel size; one geometry per panel', () => {
  // `render/adArt.ts` resolves its WebPs through Vite's `import.meta.glob`, which
  // plain Node has no implementation of — so the cache contract is pinned here as
  // source, the way `scene-wiring` pins the orchestrator. The split is the whole
  // point of the cache: a material keyed per panel size re-uploads one texture
  // per poster per panel (and a rebuild mints them all again), while a geometry
  // shared across sizes stretches one panel's crop onto another poster's shape.
  // Either regression is silent — the station just draws, heavier or smeared.
  const src = readFileSync(new URL('../src/render/adArt.ts', import.meta.url), 'utf8')
  // Materials are keyed by slug alone, never by dimensions.
  assert.match(src, /const materialKey = slug \?\? ''/)
  assert.match(src, /materials\.get\(materialKey\)/)
  assert.match(src, /materials\.set\(materialKey, material\)/)
  assert.ok(!/materials\.(get|set)\(key\b/.test(src), 'a material keyed per panel size re-uploads every poster per panel')
  // Geometries are keyed by slug and panel size, and the key carries both.
  assert.match(src, /const key = faceKey\(slug, w, h\)/)
  assert.match(src, /geometries\.get\(key\)/)
  assert.match(src, /geometries\.set\(key, geometry\)/)
  assert.match(src, /function faceKey\(slug[^\n]*w[^\n]*h[^\n]*\{\s*\n\s*return `[^`]*@\$\{w\.toFixed\(3\)\}x\$\{h\.toFixed\(3\)\}`/)
  // The quad is cut from the decoded pixels, not the panel aspect: a poster that
  // lands after first paint still fills its panel rather than inheriting a
  // placeholder's crop.
  assert.match(src, /panelUvWindow\(imageAspect, w \/ h\)/)
  // Decoding clears both caches before the scene redraws, so no face keeps a
  // placeholder's material or a wrong-aspect quad.
  const load = src.slice(src.indexOf('async function load'))
  assert.ok(load.includes('materials.clear()') && load.includes('geometries.clear()'),
    'decoded posters must invalidate both caches')
  assert.ok(load.indexOf('onReady()') > Math.max(load.indexOf('materials.clear()'), load.indexOf('geometries.clear()')),
    'the redraw must run after the caches are cleared')
})
