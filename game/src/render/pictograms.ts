// Fetch and decode the 指示牌 pictograms.
//
// A board's marks are **artwork**, not drawing routines: each one is a PNG made by
// `tools/prep-sign-icons.py` from a photograph of real station signage, held in
// `src/assets/pictograms/`. That script is where a mark's look is decided — every
// pixel there is pure white ink over a fully transparent ground, cut square — so
// this module only has to fetch the files and hand the decoded images to
// `render/signFace.ts`, which prints them into a board (`setPictograms`).
//
// It is the browser half of the pair, and deliberately the only half that touches
// Vite or the DOM: `signFace.ts` keeps the registry and draws, so the drawing code
// runs in a test as well as in the game.
//
// Three things matter:
//
//   * **Decoded before anything is drawn.** `drawImage` given an image with no
//     pixels yet paints nothing, and a board is a texture the scene mints once, so
//     a face printed early would keep the marks off it for the session. `load()`
//     resolves only when every mark is in hand, and every caller awaits it before
//     it draws — the scene reprints the boards already standing when it lands.
//   * **Data URLs, not file URLs.** The assets are imported as base64, so the
//     decode does not wait on the network and a board cannot be printed against a
//     404. Six 512-pixel two-colour PNGs are a few kilobytes each.
//   * **One load per page.** The decode is shared by the scene, the rail's
//     thumbnails and the board editor, all of which can start at the same moment.

import { SIGN_ICONS, isSignIcon, signIconIsDrawn, type SignIcon } from '../sim/sign.ts'
import { pictograms, setPictograms, type SignIconArt } from './signFace.ts'

const DATA_URLS: Record<string, string> = import.meta.glob('../assets/pictograms/*.png', {
  eager: true,
  query: '?inline',
  import: 'default',
})

const URL_BY_ICON = new Map<SignIcon, string>()
for (const [path, url] of Object.entries(DATA_URLS)) {
  const stem = (path.split('/').pop() ?? '').replace(/\.png$/, '')
  if (isSignIcon(stem)) URL_BY_ICON.set(stem, url)
}

let loading: Promise<SignIconArt> | null = null

/** Decode one image, resolving to null when the browser cannot read it. */
async function decode(url: string): Promise<HTMLImageElement | null> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Decode every pictogram, once per page.
 *
 * Await this before drawing a board: a face printed without the marks is a blank
 * plate in the station. A mark whose file is missing is simply absent and the board
 * prints the rest — one missing icon must not take a sign down with it.
 */
export function loadPictograms(): Promise<SignIconArt> {
  if (loading) return loading
  loading = (async () => {
    const decoded = new Map<SignIcon, CanvasImageSource>()
    await Promise.all(
      SIGN_ICONS.map(async (icon) => {
        const url = URL_BY_ICON.get(icon)
        if (!url) return
        const image = await decode(url)
        if (image) decoded.set(icon, image)
      }),
    )
    // Dev-only: the catalogue and the asset folder must agree, or a mark silently
    // never appears on any board and the editor offers a square of nothing. The
    // **drawn** marks (`SIGN_DRAWN_ICONS` — the 出/EXIT plate and the 禁止 roundel)
    // have no file by design: the renderer paints them, so they are not asked for.
    if (import.meta.env?.DEV) {
      const missing = SIGN_ICONS.filter((icon) => !decoded.has(icon) && !signIconIsDrawn(icon))
      if (missing.length > 0) console.warn(`[sign] no pictogram art for: ${missing.join(', ')}`)
    }
    setPictograms(decoded)
    return decoded
  })()
  return loading
}

/** The marks decoded so far — `signFace.ts`'s own registry, re-exported. */
export { pictograms }
