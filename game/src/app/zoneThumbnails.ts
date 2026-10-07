// 3D palette icons for the 分区 (fare-zone) folder in the build rail.
//
// A fare zone is a grey floor slab wearing its overlay colour — exactly what the
// rectangle drag paints — rendered once through an offscreen WebGL pass and cached
// for the session.
//
// The 房间 folder's tiles do **not** come from here. A room is identified by what
// it is for, so those tiles wear a blueprint line icon (`LeftRail`'s `roomStore` /
// `roomTicket` / `roomOffice` / `roomRestroom`) instead of a render of the model or
// a colour field, which is the one way a 1 cm tile can say "tickets" and "washroom"
// apart.

import * as THREE from 'three'
import { addStationLights, applyStationRenderer } from '../render/scene/lightRig.ts'
import { DEFAULT_ZONE, type Zone } from '../sim/types.ts'
import { ZONE_LIST } from '../sim/zones.ts'

/** The isometric direction the game opens on (`SceneRenderer.setPreset('iso')`). */
const ISO = new THREE.Vector3(1, -1.2, 0.85).normalize()

/** Floor slab every icon stands on, in metres (one cell ≈ 1 m). */
const SLAB_W = 2.2
const SLAB_D = 2.2
const SLAB_H = 0.16

function slabMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.86, metalness: 0.02 })
}

/** The translucent zone tint, matching the overlay's `opacity: 0.3` intent. */
function tintMaterial(colour: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.55,
    metalness: 0.02,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

function floorSlab(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(SLAB_W, SLAB_D, SLAB_H), slabMaterial())
  m.position.z = SLAB_H / 2
  return m
}

/** A fare zone: the coloured floor the overlay paints, laid out as four tiles. */
function zoneIcon(colour: number): THREE.Group {
  const g = new THREE.Group()
  g.add(floorSlab())
  const tile = new THREE.PlaneGeometry(1.0, 1.0)
  const mat = tintMaterial(colour)
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      const q = new THREE.Mesh(tile, mat)
      q.position.set((ix - 0.5) * 1.04, (iy - 0.5) * 1.04, SLAB_H + 0.012)
      g.add(q)
    }
  }
  return g
}

/** Icons own their materials, so free both geometry and material as we finish. */
function disposeIcon(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) m.dispose()
  })
}

/** Render every zone brush that has a slab to show — every one but 无分区. */
export function renderZoneThumbnails(size = 132): Record<string, string> {
  const out: Record<string, string> = {}
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(size, size, false)
  // The station's own rig.
  applyStationRenderer(renderer, { alpha: 0 })

  const scene = new THREE.Scene()
  addStationLights(scene)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  // The world is Z-up, so the icon camera must be too.
  camera.up.set(0, 0, 1)

  // 无分区 has no slab: it is the *absence* of a zone, and the tile that arms it is
  // the folder's eraser (a line icon, not a render of a floor wearing a colour).
  const icons: Array<[Zone, THREE.Group]> = ZONE_LIST.filter((z) => z.id !== DEFAULT_ZONE).map(
    (z): [Zone, THREE.Group] => [z.id, zoneIcon(z.colour)],
  )

  try {
    for (const [id, group] of icons) {
      scene.add(group)
      const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere())
      const r = Math.max(0.35, sphere.radius)
      const half = r * 1.18
      camera.left = -half
      camera.right = half
      camera.top = half
      camera.bottom = -half
      camera.position.copy(sphere.center).addScaledVector(ISO, r * 6)
      camera.near = r * 0.02
      camera.far = r * 40
      camera.lookAt(sphere.center)
      camera.updateProjectionMatrix()

      renderer.render(scene, camera)
      out[id] = renderer.domElement.toDataURL('image/png')

      scene.remove(group)
      disposeIcon(group)
    }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return out
}

/* --------------------------------------------------------------- session cache */

let cache: Record<string, string> | null = null
let pending: Promise<Record<string, string>> | null = null

/** Thumbnails, generated once and shared by every caller. Empty on failure. */
export function getZoneThumbnails(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache)
  if (!pending) {
    pending = new Promise((resolve) => {
      const run = (): void => {
        try {
          cache = renderZoneThumbnails()
        } catch {
          cache = {}
        }
        resolve(cache)
      }
      // Off the critical path, alongside the module pass.
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        ;(window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 1200 })
      } else {
        setTimeout(run, 60)
      }
    })
  }
  return pending
}
