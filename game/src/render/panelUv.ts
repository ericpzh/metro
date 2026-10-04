// Panel UV windows — the arithmetic that fits a poster to a billboard panel.
//
// A poster is never stretched: a panel shows the centred window of its image
// whose aspect matches the panel's, so a 16:9 poster on a 2.25:1 panel loses its
// left and right edges instead. The window is written into the *quad's* UVs
// (`croppedPlane`) rather than into the texture's `repeat`/`offset`, so one
// texture per poster serves every format that prints it and the crop belongs to
// the panel.
//
// Pure three.js and plain numbers, no DOM and no Vite: `adArt.ts` owns the
// pixels, this module owns the geometry, and `test/billboard.test.mjs` checks
// the maths here in Node.

import * as THREE from 'three'

/** A UV window into an image, in the file's own coordinates (0 = left/bottom). */
export interface UvWindow {
  u0: number
  u1: number
  v0: number
  v1: number
}

/**
 * The window a panel shows of an image: the centred crop that fits `imageAspect`
 * to `panelAspect`. Wider image than panel cuts the sides, narrower cuts the top
 * and bottom, and an exact match is the whole image (0..1 on both axes).
 */
export function panelUvWindow(imageAspect: number, panelAspect: number): UvWindow {
  let u0 = 0
  let u1 = 1
  let v0 = 0
  let v1 = 1
  if (imageAspect > panelAspect) {
    const keep = panelAspect / imageAspect
    u0 = (1 - keep) / 2
    u1 = u0 + keep
  } else if (imageAspect < panelAspect) {
    const keep = imageAspect / panelAspect
    v0 = (1 - keep) / 2
    v1 = v0 + keep
  }
  return { u0, u1, v0, v1 }
}

/**
 * A `PlaneGeometry` whose UVs run over the given window. The corners walk the
 * window the way `PlaneGeometry`'s own UVs walk its image — top-left, top-right,
 * bottom-left, bottom-right — so the poster reads the right way up and the right
 * way round on the wall.
 *
 * `v` is in *texture* space, not image space: `Texture.flipY` (on by default, and
 * never turned off here) flips the file as it uploads, so v = 1 is the image's top
 * row and v = 0 its bottom. The window's `v1` therefore goes on the plane's **top**
 * corners and `v0` on the bottom ones — the same assignment `PlaneGeometry` itself
 * makes. Passing them the other way up prints every poster upside down.
 */
export function croppedPlane(w: number, h: number, win: UvWindow): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h)
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  uv.setXY(0, win.u0, win.v1)
  uv.setXY(1, win.u1, win.v1)
  uv.setXY(2, win.u0, win.v0)
  uv.setXY(3, win.u1, win.v0)
  uv.needsUpdate = true
  return geo
}
