// Advertising panels (GAME-SPEC §5.7): the poster catalogue and the UV window
// that fits a poster to a panel without stretching it.
//
// The window arithmetic decides whether a 16:9 campaign smears across a 2.25:1
// lightbox or loses its edges, and whether a poster reads the right way up on
// the wall — so it is checked here in Node, on the real table, rather than by
// eye in the browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { croppedPlane, panelUvWindow } from '../src/render/panelUv.ts'
import { AD_POSTERS, BILLBOARD_SPECS, BILLBOARD_VARIANTS, billboardSpec, posterFor, postersFor } from '../src/sim/billboards.ts'

/**
 * The real pixel size of every poster asset, read from `src/assets/posters/*.jpg`.
 * The catalogue is pure data and cannot measure its own artwork, so the file
 * side of the fit guarantee lives here — a poster that is replaced with a
 * differently shaped image fails the fit test below rather than silently
 * cropping to a sliver.
 */
const ART_ASPECT = {
  'metro-security': 1000 / 507,
  'property-hotline': 2270 / 1279,
  'games-2025-blue': 576 / 324,
  'guangdong-league': 576 / 324,
  'cloud-security': 464 / 251,
  'heinz-league': 680 / 310,
  'animal-help': 833 / 358,
  'rhinitis-spray': 637 / 283,
  'yupao-hiring': 874 / 235,
  'haoyibao': 490 / 180,
  'games-2025-red': 368 / 543,
  'heinz-body': 194 / 259,
}

test('every catalogue slug is a poster file, and every file is a catalogue slug', () => {
  assert.deepEqual(new Set(AD_POSTERS.map((p) => p.slug)), new Set(Object.keys(ART_ASPECT)))
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

test('a poster is cropped to the panel, never stretched', () => {
  for (const variant of BILLBOARD_VARIANTS) {
    const spec = billboardSpec(variant)
    const panelAspect = spec.panelW / spec.panelH
    for (const poster of postersFor(spec.shape)) {
      const imageAspect = ART_ASPECT[poster.slug]
      // The crop is the ratio between the two: 1.0 would be a perfect match, and
      // anything under ~1.45 keeps the campaign's subject and its type readable.
      const crop = Math.max(imageAspect / panelAspect, panelAspect / imageAspect)
      assert.ok(crop < 1.45, `${variant} (${panelAspect.toFixed(2)}) would crop ${poster.slug} (${imageAspect.toFixed(2)}) to ${crop.toFixed(2)}`)
      // And the window that does the cropping keeps the image's own aspect: the
      // visible window, measured back in pixels, is the panel's shape.
      const win = panelUvWindow(imageAspect, panelAspect)
      const windowAspect = ((win.u1 - win.u0) * imageAspect) / (win.v1 - win.v0)
      assert.ok(Math.abs(windowAspect - panelAspect) < 1e-9, `${variant} window aspect ${windowAspect.toFixed(3)} != panel ${panelAspect.toFixed(3)}`)
      assert.ok(win.u0 >= 0 && win.u1 <= 1 && win.v0 >= 0 && win.v1 <= 1, 'the window must stay inside the image')
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

test('a format prints the poster it was given, and an unknown slug a placeholder', () => {
  // The slug is opaque to the sim: the renderer resolves it against the table
  // and falls back to the catalogue head rather than drawing nothing.
  assert.equal(posterFor('games-2025-red').slug, 'games-2025-red')
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
