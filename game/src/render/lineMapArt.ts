// Line-map art — the supplied 广州地铁 线网示意图 as a lit material.
//
// The network a 线网图 prints is the poster the station wall really carries, saved as
// an asset: `src/assets/linemaps/network-map.jpg` (2048 × 2047). This module is the
// one place that file meets the panel `sim/linemaps.ts` describes, exactly as
// `render/adArt.ts` pairs an ad slug with its JPEG — the table names the size, this
// holds the pixels.
//
// Two things follow from the poster being **supplied** rather than drawn:
//
//   * **The panel is cut to the poster's own aspect**, so the map fills its board
//     without a crop and without a stretch. `LINE_MAP_ASPECT` in `sim/linemaps.ts` is
//     that ratio, and both mounts use it — a wall board and a concourse totem that
//     cropped the same artwork differently would be two pictures of one network.
//   * **The pixels are decoded before any material is made.** A material minted around
//     a texture with no image yet renders blank for good (the GPU upload happens once,
//     empty, and the image that arrives later never reaches it), so `load()` awaits the
//     decode and the scene rebuilds its modules when it lands — until then a map prints
//     the drawn placeholder board (`render/lineMapFace.ts`), never a blank panel.
//
// Browser-only: `import.meta.glob` and the DOM image element are Vite and DOM. The
// panel and its aspect live on the sim side, where a test can read them.

import * as THREE from 'three'
import { croppedPlane, panelUvWindow } from './panelUv.ts'

// The folder is `linemaps/`, and holds one poster. (Not `ads/`: EasyList ships
// `/assets/ads/*$~image`, which blocks Vite's dev-time module URL for anything under an
// `assets/ads/` path, and because the glob below is `eager` one blocked file rejects
// this module's whole graph.)
const MAP_URLS: Record<string, string> = import.meta.glob('../assets/linemaps/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** The asset's stem — the one poster a 线网图 prints. */
export const LINE_MAP_SLUG = 'network-map'

/** The poster's URL, for the one asset in `src/assets/linemaps/`. */
export function lineMapUrl(slug: string = LINE_MAP_SLUG): string | undefined {
  for (const [path, url] of Object.entries(MAP_URLS)) {
    if ((path.split('/').pop() ?? '').replace(/\.jpg$/, '') === slug) return url
  }
  return undefined
}

/** One lit board: the unlit material and the quad geometry cut to the panel's aspect. */
export interface LineMapFace {
  material: THREE.MeshBasicMaterial
  geometry: THREE.PlaneGeometry
}

export interface LineMapArt {
  /**
   * Decode the poster. Resolves once the image is in hand (or has failed), and calls
   * `onReady` when that changes what a map would draw.
   */
  load(onReady?: () => void): Promise<void>
  /** True once the poster's pixels are in hand — what a plate asks before it draws. */
  ready(): boolean
  /**
   * The lit board for a `w` × `h` metre panel, cropped to the panel's aspect. The
   * caller owns the geometry it is given (dispose it with the module); the material is
   * the art's and is shared by every map printing the same panel.
   */
  face(w: number, h: number): LineMapFace
  dispose(): void
}

/** Decode one image, resolving to null when it cannot be fetched. */
async function decode(url: string): Promise<HTMLImageElement | null> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export function createLineMapArt(renderer?: THREE.WebGLRenderer): LineMapArt {
  const maxAnisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1
  let texture: THREE.Texture | null = null
  /**
   * One material per panel size, shared by every map that prints it: the poster is one
   * image, so a row of maps on the same board size holds one texture and one material
   * and nothing re-uploads on a rebuild.
   */
  const materials = new Map<string, THREE.MeshBasicMaterial>()
  /** The same bargain for the quads, keyed the same way (`adArt`'s reasoning). */
  const geometries = new Map<string, THREE.PlaneGeometry>()
  const slug = LINE_MAP_SLUG

  async function load(onReady?: () => void): Promise<void> {
    if (texture) {
      onReady?.()
      return
    }
    const url = lineMapUrl(slug)
    if (!url) {
      // Dev-only: the table and the asset folder must agree, or a map silently never
      // prints its poster. `import.meta.env.DEV` is false in a build.
      if (import.meta.env?.DEV) console.warn(`[linemaps] no image for map slug: ${slug}`)
      return
    }
    const image = await decode(url)
    if (!image) return
    const tex = new THREE.Texture(image)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAnisotropy
    tex.needsUpdate = true
    texture = tex
    // Every map already hanging is now wrong (it printed the placeholder): let the
    // scene rebuild its modules so each board is cut from the real pixels.
    onReady?.()
  }

  function face(w: number, h: number): LineMapFace {
    const key = `${w.toFixed(3)}x${h.toFixed(3)}`
    // Before the poster is in hand there is nothing to cache: a material minted around
    // an image-less texture uploads empty and stays blank, so a caller that asks early
    // gets an uncached blank board and mints the real one once `ready()` says so.
    const cached = texture ? materials.get(key) : undefined
    if (cached) {
      const geometry = geometries.get(key)
      if (geometry) return { material: cached, geometry }
    }
    const material = cached ?? new THREE.MeshBasicMaterial({ map: texture ?? undefined, side: THREE.FrontSide })
    const image = texture?.image as { width?: number; height?: number } | undefined
    const imageAspect = image?.width && image.height ? image.width / image.height : w / h
    const geometry = texture ? geometries.get(key) : undefined
    const quad = geometry ?? croppedPlane(w, h, panelUvWindow(imageAspect, w / h))
    if (texture) {
      materials.set(key, material)
      geometries.set(key, quad)
    }
    return { material, geometry: quad }
  }

  return {
    load,
    ready: () => texture !== null,
    face,
    dispose() {
      for (const mat of materials.values()) mat.dispose()
      materials.clear()
      // The scene owns the quads now: a module group must not dispose one it shares
      // with every other map (`clearModules` → `disposeObject`).
      for (const geo of geometries.values()) geo.dispose()
      geometries.clear()
      texture?.dispose()
      texture = null
    },
  }
}
