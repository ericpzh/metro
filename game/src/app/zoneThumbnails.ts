// 3D palette icons for the 分区 (fare-zone) folder in the build rail.
//
// The equipment tiles show the *real* in-game model (`moduleThumbnails.ts`), so
// the zone palette follows suit at the scale the tool actually paints: a fare
// zone is a grey floor slab wearing its overlay colour, and a facility room is
// that same slab ringed by low walls — exactly what the rectangle drag builds.
// Rendered once through an offscreen WebGL pass and cached for the session.

import * as THREE from 'three'
import { ZONE_LIST } from '../sim/zones.ts'
import { FACILITY_OPTIONS } from './store.ts'

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

/** A facility room (§5.7): coloured floor ringed by low walls, doorway south. */
function facilityIcon(colour: number): THREE.Group {
  const g = new THREE.Group()
  g.add(floorSlab())
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SLAB_W - 0.16, SLAB_D - 0.16), tintMaterial(colour))
  floor.position.z = SLAB_H + 0.012
  g.add(floor)

  const wallH = 0.62
  const wallT = 0.14
  const wall = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6, metalness: 0.02 })
  const add = (sx: number, sy: number, x: number, y: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, wallH), wall)
    m.position.set(x, y, SLAB_H + wallH / 2)
    g.add(m)
  }
  const ex = SLAB_W / 2 - wallT / 2
  const ey = SLAB_D / 2 - wallT / 2
  add(wallT, SLAB_D, -ex, 0) // west
  add(wallT, SLAB_D, ex, 0) // east
  add(SLAB_W, wallT, 0, ey) // north
  // South wall, split around a doorway like the room the tool drops.
  const door = 0.7
  const stub = (SLAB_W - door) / 2
  add(stub, wallT, -(door / 2 + stub / 2), -ey)
  add(stub, wallT, door / 2 + stub / 2, -ey)
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

/** Render every zone and facility brush once. Throws if WebGL is unavailable. */
export function renderZoneThumbnails(size = 132): Record<string, string> {
  const out: Record<string, string> = {}
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(size, size, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x1d2c3d, 1.15))
  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  key.position.set(5, -7, 9)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9ecbff, 0.85)
  fill.position.set(-7, 5, 4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0x4e8fd0, 0.7)
  rim.position.set(0, 7, -5)
  scene.add(rim)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  // The world is Z-up, so the icon camera must be too.
  camera.up.set(0, 0, 1)

  const icons: Array<[string, THREE.Group]> = [
    ...ZONE_LIST.map((z): [string, THREE.Group] => [z.id, zoneIcon(z.colour)]),
    ...FACILITY_OPTIONS.map((f): [string, THREE.Group] => [f.id, facilityIcon(f.colour)]),
  ]

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
