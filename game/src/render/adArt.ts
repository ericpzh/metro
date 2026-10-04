// Ad art — the twelve supplied posters as lit screen material.
//
// GAME-SPEC §5.7's 装饰 screens (广告牌, 电视) print real artwork: the JPEGs in
// `src/assets/posters/` are the campaign posters of a real station, and this module
// is the one place the catalogue (`sim/billboards.ts`) meets the files. It is
// browser-only — `import.meta.glob` and the DOM image element are Vite and DOM —
// which is why the slug table lives on the sim side and the pixels live here.
//
// Three things matter for the look:
//
//   * **The artwork is cropped, never stretched.** A poster is cut to the
//     panel's aspect ratio by clipping the quad's UV window to the middle of the
//     image, so a 16:9 poster on a 2.25:1 panel loses its edges instead of
//     smearing sideways. The window is written into the *geometry*, not into
//     the texture's `repeat`/`offset`: one texture per poster then serves every
//     format that prints it, and the crop is a property of the panel rather than
//     a transform three has to apply per draw.
//   * **A screen is static.** One slug, one texture, cached — a station of fifty
//     billboards holds twelve textures and one material per poster and format,
//     and nothing re-uploads when the module rebuilds.
//   * **The pixels are decoded before any material is made.** `load()` awaits
//     every JPEG, because a material minted around a texture that has no image
//     yet renders blank for good — the GPU upload happens once, empty, and the
//     image that arrives later never reaches it. Until the decode lands a screen
//     prints the placeholder face, and `SceneRenderer` redraws the modules once
//     the artwork is in (`onReady`).

import * as THREE from 'three'
import { AD_POSTERS } from '../sim/billboards.ts'
import { croppedPlane, panelUvWindow } from './panelUv.ts'

// The folder is `posters/`, and must not be renamed back to `ads/`: EasyList
// carries `/assets/ads/*$~image`, which blocks Vite's dev-time module URL for
// anything under an `assets/ads/` path (it is served as JavaScript, so the
// `$~image` exemption does not apply). Because the glob below is `eager`, one
// blocked poster rejects this module's whole graph and the game never boots.
//
// Every poster's asset URL, keyed by its file stem (the catalogue slug).
const AD_ART_URLS: Record<string, string> = import.meta.glob('../assets/posters/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
})

const URL_BY_SLUG = new Map<string, string>()
for (const [path, url] of Object.entries(AD_ART_URLS)) {
  const file = path.split('/').pop() ?? ''
  URL_BY_SLUG.set(file.replace(/\.jpg$/, ''), url)
}

/**
 * One lit advertisement: the unlit material and the quad geometry cut to the
 * panel's aspect. The caller owns the geometry (dispose it with the module) and
 * shares the material.
 */
export interface AdFace {
  material: THREE.MeshBasicMaterial
  geometry: THREE.PlaneGeometry
}

/**
 * The lit artwork for every 装饰 screen. One per scene, built synchronously and
 * filled by `load()`; `adFace` is the only reader, so a module never owns a
 * texture and a rebuild never re-uploads one.
 */
export interface AdArt {
  /**
   * Decode every catalogue poster. Resolves once they are all in hand (or have
   * failed), and calls `onReady` when that changes what a screen would draw.
   */
  load(onReady: () => void): Promise<void>
  /**
   * The lit face printing `slug` on a `w` × `h` metre panel, cropped to the
   * panel's aspect. An unknown slug (a save from another build) and a poster
   * that has not decoded (or failed) both fall back to a placeholder, so a panel
   * is never blank.
   */
  adFace(slug: string | undefined, w: number, h: number): AdFace
  /**
   * The next piece of content for a screen that plays whatever the feed sends: a
   * catalogue poster cropped to the `w` × `h` window, as a ready material +
   * geometry pair. Unlike `adFace` this ignores any module's frozen slug — it is
   * the *rotation* of the content, so a caller swapping a window takes what it is
   * given and disposes the geometry it replaces.
   */
  adWindow(w: number, h: number): AdFace & { slug: string }
  dispose(): void
}

/** The panel a poster is cut for, as a face cache key. */
function faceKey(slug: string | undefined, w: number, h: number): string {
  return `${slug ?? ''}@${w.toFixed(3)}x${h.toFixed(3)}`
}

/** The face a poster falls back to when its file is not on disk. */
function missingCanvas(slug: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 288
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#1d2733'
  g.fillRect(0, 0, 512, 288)
  g.strokeStyle = '#4a5b6e'
  g.lineWidth = 6
  g.strokeRect(10, 10, 492, 268)
  g.fillStyle = '#9fb2c6'
  g.textAlign = 'center'
  g.font = 'bold 64px "Microsoft YaHei", sans-serif'
  g.fillText('广告', 256, 140)
  g.font = '24px "Microsoft YaHei", sans-serif'
  g.fillText(slug, 256, 190)
  return c
}

/** A plain "no artwork" face, for a slug this build cannot print. */
function placeholderTexture(slug: string): THREE.Texture {
  const tex = new THREE.CanvasTexture(missingCanvas(slug))
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The UV window a panel shows of an image: the centred crop that fits the image
 * to the panel's aspect. Re-exported so a caller reading `adArt` sees the whole
 * story; the arithmetic itself lives in `panelUv.ts`, which is pure enough to
 * run in Node.
 */
export { croppedPlane, panelUvWindow } from './panelUv.ts'

/** Decode one image, resolving to null when it cannot be fetched. */
async function decode(url: string): Promise<HTMLImageElement | null> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export function createAdArt(renderer?: THREE.WebGLRenderer): AdArt {
  const maxAnisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1
  const textures = new Map<string, THREE.Texture>()
  const materials = new Map<string, THREE.MeshBasicMaterial>()
  /** A placeholder texture per unknown slug, so each blank panel reads its name. */
  const placeholders = new Map<string, THREE.Texture>()
  /** Slugs that have no pixels this session, so the fallback is reported once. */
  const absent = new Set<string>()
  /** Every geometry handed out, so `dispose` can take back what it made. */
  const geometries = new Set<THREE.PlaneGeometry>()

  async function load(onReady: () => void): Promise<void> {
    const decoded = await Promise.all(
      AD_POSTERS.map(async (poster) => {
        const url = URL_BY_SLUG.get(poster.slug)
        if (!url) return { slug: poster.slug, texture: null }
        const image = await decode(url)
        if (!image) return { slug: poster.slug, texture: null }
        const texture = new THREE.Texture(image)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = maxAnisotropy
        texture.needsUpdate = true
        return { slug: poster.slug, texture }
      }),
    )
    let gained = false
    for (const entry of decoded) {
      if (!entry.texture) {
        absent.add(entry.slug)
        continue
      }
      textures.set(entry.slug, entry.texture)
      gained = true
    }
    // Dev-only: the catalogue and the asset folder must agree, or a poster
    // silently never appears. `import.meta.env.DEV` is false in a build.
    if (import.meta.env?.DEV && absent.size > 0) {
      console.warn(`[ads] no image for poster slug(s): ${[...absent].join(', ')}`)
    }
    // Any screen drawn with a placeholder is now wrong: let the scene rebuild its
    // modules so every lit face is cut from real pixels. Dropping the cached
    // materials is enough — the geometry's UV window was written for the panel,
    // not for a particular image.
    if (gained) {
      for (const mat of materials.values()) mat.dispose()
      materials.clear()
      onReady()
    }
  }

  function adFace(slug: string | undefined, w: number, h: number): AdFace {
    const key = faceKey(slug, w, h)
    let material = materials.get(key)
    let texture: THREE.Texture
    if (material?.map) {
      texture = material.map
    } else if (slug !== undefined && textures.has(slug)) {
      texture = textures.get(slug) as THREE.Texture
    } else {
      const name = slug ?? 'ad'
      let placeholder = placeholders.get(name)
      if (!placeholder) {
        placeholder = placeholderTexture(name)
        placeholders.set(name, placeholder)
      }
      texture = placeholder
    }
    if (!material) {
      // **FrontSide, so a screen has a back.** The poster is a plane, and a
      // double-sided one prints its artwork out of the *back* of the piece as well —
      // through the dark backing slab it is mounted on, so what shows is the
      // campaign rather than the panel. A 电视 is the case that makes it obvious:
      // R turns the screen, and the one thing that has to read at a glance is which
      // way it will face, which it cannot if both sides show artwork. The piece's
      // own housing (`models.ts`) is what a viewer sees from behind — the bezel and
      // the black backing — and that is what the back of a television looks like.
      material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide })
      material.userData.adSlug = slug
      materials.set(key, material)
    }
    const image = texture.image as { width?: number; height?: number } | undefined
    const imageAspect = image?.width && image.height ? image.width / image.height : w / h
    const geometry = croppedPlane(w, h, panelUvWindow(imageAspect, w / h))
    geometries.add(geometry)
    return { material, geometry }
  }

  return {
    load,
    adFace,
    adWindow(w: number, h: number): AdFace & { slug: string } {
      // Only artwork cut for a landscape panel. The window is wide, and cropping is
      // not stretching: a portrait poster in it would lose over half its height, so
      // a feed that may show *anything* still shows only what it can show whole.
      // The pick is what makes a wall of screens stop moving as one.
      const feed = AD_POSTERS.filter((p) => p.shapes.includes('landscape') || p.shapes.includes('wide'))
      const pool = feed.length > 0 ? feed : AD_POSTERS
      const poster = pool[Math.floor(Math.random() * pool.length)] ?? AD_POSTERS[0]
      const face = adFace(poster.slug, w, h)
      return { ...face, slug: poster.slug }
    },
    dispose() {
      for (const mat of materials.values()) mat.dispose()
      for (const tex of textures.values()) tex.dispose()
      for (const tex of placeholders.values()) tex.dispose()
      for (const geo of geometries) geo.dispose()
      materials.clear()
      textures.clear()
      placeholders.clear()
      geometries.clear()
    },
  }
}
